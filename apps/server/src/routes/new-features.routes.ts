import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { authMiddleware, ok, fail } from '../auth/middleware.js';
import { getDb } from '../db/index.js';
import { getStorageRecord, fileService } from '../services/file.service.js';
import { fileIndex } from '../services/fileIndex.service.js';
import { usageCache } from '../services/usageCache.service.js';
import { getDriver } from '../storage/registry.js';

/** by-type 结果缓存：递归扫描成本高，按 storageId+type 缓存 30 秒（兼顾新鲜度与扫描成本） */
const byTypeCache = new Map<string, { at: number; entries: any[] }>();
const BY_TYPE_TTL = 30 * 1000;

export async function newFeaturesRoutes(app: FastifyInstance) {
  // 按文件类型搜索（视频/文档）
  app.get('/files/by-type', { preHandler: authMiddleware }, async (req, reply) => {
    const { storageId, type } = req.query as Record<string, string>;
    if (!storageId) return fail(reply, 400, '缺少 storageId');
    try {
      const rec = getStorageRecord(Number(storageId));
      if (!rec) return fail(reply, 404, '存储不存在');

      // 定义文件类型扩展名
      const VIDEO_EXTS = ['mp4', 'avi', 'mkv', 'mov', 'flv', 'wmv', 'webm', 'm4v', '3gp', 'ts'];
      const DOC_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'md'];
      const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'avif', 'heic', 'jfif'];
      const AUDIO_EXTS = ['mp3', 'flac', 'wav', 'ogg', 'aac', 'm4a', 'opus', 'wma', 'ape'];

      let exts: string[] = [];
      if (type === 'video') exts = VIDEO_EXTS;
      else if (type === 'document') exts = DOC_EXTS;
      else if (type === 'image') exts = IMAGE_EXTS;
      else if (type === 'audio') exts = AUDIO_EXTS;

      const cacheKey = `${storageId}:${type}`;
      const cached = byTypeCache.get(cacheKey);
      if (cached && Date.now() - cached.at < BY_TYPE_TTL) {
        return ok(reply, { entries: cached.entries, cached: true });
      }

      // 递归扫描所有子目录
      const allEntries: any[] = [];
      const scanDir = async (dirPath: string) => {
        const { entries } = await fileService.list(Number(storageId), dirPath, 'name', 'asc');
        for (const e of entries) {
          if (e.isDir) {
            // 递归扫描子目录
            await scanDir(dirPath === '/' ? '/' + e.name : dirPath + '/' + e.name);
          } else {
            const ext = e.name.split('.').pop()?.toLowerCase() || '';
            if (exts.includes(ext)) {
              allEntries.push(e);
            }
          }
        }
      };
      await scanDir('/');

      // 容量上限，防止 Map 无限增长
      if (byTypeCache.size >= 100) {
        const oldest = byTypeCache.keys().next().value;
        if (oldest) byTypeCache.delete(oldest);
      }
      byTypeCache.set(cacheKey, { at: Date.now(), entries: allEntries });
      return ok(reply, { entries: allEntries, cached: false });
    } catch (e: any) {
      return fail(reply, 500, e.message || '加载失败');
    }
  });

  // 最近访问文件（基于真实访问历史）
  app.get('/files/recent', { preHandler: authMiddleware }, async (req, reply) => {
    const { storageId, limit = '50' } = req.query as Record<string, string>;
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    if (!storageId) return fail(reply, 400, '缺少 storageId');
    try {
      const rec = getStorageRecord(Number(storageId));
      if (!rec) return fail(reply, 404, '存储不存在');
      const db = getDb();
      const userId = req.user ? (req.user as any).sub : null;
      const driver = getDriver(rec);
      
      // 从 recent_access 表获取该用户的访问记录
      const rows = db.prepare(
        'SELECT * FROM recent_access WHERE user_id = ? AND storage_id = ? ORDER BY accessed_at DESC LIMIT ?'
      ).all(userId, Number(storageId), safeLimit) as any[];
      
      // P2-9 修复：批量 stat，避免 N+1
      const stats = await Promise.all(rows.map((row) => driver.stat(row.path).catch(() => null)));
      
      // 验证文件是否还存在，移除不存在的
      const validEntries: any[] = [];
      const deleteIds: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const stat = stats[i];
        if (stat) {
          validEntries.push({
            path: row.path,
            name: row.name,
            isDir: row.is_dir === 1,
            size: stat.size || 0,
            mtime: stat.mtime || row.accessed_at,
            accessed_at: row.accessed_at,
          });
        } else {
          deleteIds.push(row.id);
        }
      }
      // 批量删除不存在的记录
      if (deleteIds.length) {
        const placeholders = deleteIds.map(() => '?').join(', ');
        db.prepare(`DELETE FROM recent_access WHERE id IN (${placeholders})`).run(...deleteIds);
      }
      
      return ok(reply, { entries: validEntries });
    } catch (e: any) {
      return fail(reply, 500, e.message || '加载失败');
    }
  });

  // 清空最近访问记录
  app.delete('/files/recent', { preHandler: authMiddleware }, async (req, reply) => {
    const { storageId } = req.query as Record<string, string>;
    if (!storageId) return fail(reply, 400, '缺少 storageId');
    try {
      const db = getDb();
      const userId = req.user ? (req.user as any).sub : null;
      const info = db.prepare('DELETE FROM recent_access WHERE user_id = ? AND storage_id = ?').run(userId, Number(storageId));
      return ok(reply, { deleted: info.changes });
    } catch (e: any) {
      return fail(reply, 500, e.message || '清空失败');
    }
  });

  // 快捷访问（固定文件）
  app.get('/files/quick-access', { preHandler: authMiddleware }, async (req, reply) => {
    const { storageId } = req.query as Record<string, string>;
    if (!storageId) return fail(reply, 400, '缺少 storageId');
    const rec = getStorageRecord(Number(storageId));
    if (!rec) return fail(reply, 404, '存储不存在');
    const db = getDb();
    const rows = db.prepare('SELECT * FROM quick_access WHERE storage_id = ? ORDER BY created_at DESC').all(Number(storageId)) as any[];
    const driver = getDriver(rec);
    const statsP = Promise.all(rows.map(row => driver.stat(row.path).catch(() => null)));
    const statsArr = await statsP;
    const entries: any[] = [];
    const deleteIds: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const stat = statsArr[i];
      if (stat) {
        entries.push({
          id: row.id,
          path: row.path,
          name: row.name,
          isDir: row.is_dir === 1,
          size: stat.size || 0,
          createdAt: row.created_at,
        });
      } else {
        deleteIds.push(row.id);
      }
    }
    if (deleteIds.length) {
      const placeholders = deleteIds.map(() => '?').join(', ');
      db.prepare(`DELETE FROM quick_access WHERE id IN (${placeholders})`).run(...deleteIds);
    }
    return ok(reply, { entries });
  });

  app.post('/files/quick-access/:path', { preHandler: authMiddleware }, async (req, reply) => {
    const { storageId } = req.query as Record<string, string>;
    const { path: paramPath } = req.params as Record<string, string>;
    if (!storageId) return fail(reply, 400, '缺少 storageId');
    const rec = getStorageRecord(Number(storageId));
    if (!rec) return fail(reply, 404, '存储不存在');
    const db = getDb();
    // Fastify 已对 :path 参数解码一次，勿二次 decodeURIComponent（含 % 的文件名会 500）
    const fullPath = paramPath.startsWith('/') ? paramPath : '/' + paramPath;
    // 检查是否已存在
    const existing = db.prepare('SELECT * FROM quick_access WHERE storage_id = ? AND path = ?').get(Number(storageId), fullPath) as any;
    if (existing) {
      // 已存在则删除（取消固定）
      db.prepare('DELETE FROM quick_access WHERE id = ?').run(existing.id);
      return ok(reply, { action: 'removed' });
    }
    // 不存在则添加（stat 一次，记录真实 is_dir）
    let isDir = 0;
    try {
      const st = await getDriver(rec).stat(fullPath);
      if (!st) return fail(reply, 404, '路径不存在');
      isDir = st.isDir ? 1 : 0;
    } catch {
      // 无法 stat 时按文件记录
    }
    db.prepare('INSERT INTO quick_access (storage_id, path, name, is_dir, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))').run(
      Number(storageId), fullPath, fullPath.split('/').pop() || '', isDir
    );
    return ok(reply, { action: 'added' });
  });

  // 隐藏空间状态：是否已设置密码
  app.get('/hidden-space/status', { preHandler: authMiddleware }, async (req, reply) => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM hidden_space_settings').all() as any[];
    return ok(reply, { hasPassword: rows.length > 0 });
  });

  // 设置隐藏空间密码
  app.post('/hidden-space/set-password', { preHandler: authMiddleware }, async (req, reply) => {
    if (req.user!.role !== 'admin') return fail(reply, 403, '无权操作');
    const { storageId, password } = req.body as { storageId?: number; password?: string };
    if (!storageId || !password) return fail(reply, 400, '缺少参数');
    if (password.length < 4) return fail(reply, 400, '密码至少 4 位');
    
    const db = getDb();
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    const existing = db.prepare('SELECT * FROM hidden_space_settings WHERE storage_id = ?').get(Number(storageId)) as any;
    if (existing) {
      db.prepare('UPDATE hidden_space_settings SET password_hash = ?, salt = ? WHERE storage_id = ?').run(hash, salt, Number(storageId));
    } else {
      db.prepare('INSERT INTO hidden_space_settings (storage_id, password_hash, salt, created_at) VALUES (?, ?, ?, datetime(\'now\'))').run(Number(storageId), hash, salt);
    }
    return ok(reply, { success: true });
  });

  // 隐藏空间解锁
  app.post('/hidden-space/unlock', { preHandler: authMiddleware }, async (req, reply) => {
    if (req.user!.role !== 'admin') return fail(reply, 403, '无权操作');
    const { storageId, password } = req.body as { storageId?: number; password?: string };
    if (!storageId || !password) return fail(reply, 400, '缺少参数');
    
    const db = getDb();
    const existing = db.prepare('SELECT * FROM hidden_space_settings WHERE storage_id = ?').get(Number(storageId)) as any;
    if (!existing) {
      return fail(reply, 400, '请先设置密码');
    }
    
    const salt = existing.salt || '';
    const hashBuf = crypto.scryptSync(password, salt, 64);
    const expectedBuf = Buffer.from(existing.password_hash, 'hex');
    if (hashBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(hashBuf, expectedBuf)) {
      return ok(reply, { unlocked: false });
    }
    
    try {
      const rec = getStorageRecord(Number(storageId));
      if (rec) {
        const driver = getDriver(rec);
        await driver.mkdir('/hidden');
        fileIndex.markDirty(Number(storageId));
        usageCache.invalidate(Number(storageId));
      }
    } catch {
    }
    
    return ok(reply, { unlocked: true });
  });

  // 订阅列表（仅当前用户）
  app.get('/subscriptions', { preHandler: authMiddleware }, async (req, reply) => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC').all(req.user!.sub) as any[];
    return ok(reply, {
      subscriptions: rows.map((r) => ({
        id: r.id,
        title: r.title,
        sharer: r.sharer,
        autoRefresh: r.auto_refresh === 1,
        shareId: r.share_id,
        createdAt: r.created_at,
      })),
    });
  });

  // 转存记录（仅当前用户）
  app.get('/transfers', { preHandler: authMiddleware }, async (req, reply) => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM transfers WHERE user_id = ? ORDER BY created_at DESC').all(req.user!.sub) as any[];
    return ok(reply, {
      transfers: rows.map((r) => ({
        id: r.id,
        shareUrl: r.share_url,
        fileCount: r.file_count ?? 0,
        createdAt: r.created_at,
      })),
    });
  });

  // 转存分享
  app.post('/transfers', { preHandler: authMiddleware }, async (req, reply) => {
    const { shareUrl } = req.body as { shareUrl?: string };
    if (!shareUrl) return fail(reply, 400, '请输入分享链接');
    // 简化实现：只记录转存请求（归属当前登录用户）
    const db = getDb();
    db.prepare('INSERT INTO transfers (user_id, share_url, file_count, created_at) VALUES (?, ?, ?, datetime(\'now\'))').run(req.user!.sub, shareUrl, 0);
    return ok(reply, { transferred: 0, message: '转存请求已记录' });
  });
}
