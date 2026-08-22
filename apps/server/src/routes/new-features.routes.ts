import type { FastifyInstance } from 'fastify';
import { authMiddleware, ok, fail } from '../auth/middleware.js';
import { getDb } from '../db/index.js';
import { getStorageRecord, fileService } from '../services/file.service.js';
import { getDriver } from '../storage/registry.js';

export async function newFeaturesRoutes(app: FastifyInstance) {
  // 按文件类型搜索（视频/文档）
  app.get('/files/by-type', { preHandler: authMiddleware }, async (req, reply) => {
    const { storageId, type } = req.query as Record<string, string>;
    if (!storageId) return fail(reply, 400, '缺少 storageId');
    try {
      const rec = getStorageRecord(Number(storageId));
      if (!rec) return fail(reply, 404, '存储不存在');
      const { entries } = await fileService.list(Number(storageId), '/', 'name', 'asc');
      
      // 定义文件类型扩展名
      const VIDEO_EXTS = ['mp4', 'avi', 'mkv', 'mov', 'flv', 'wmv', 'webm'];
      const DOC_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'md'];
      
      let exts: string[] = [];
      if (type === 'video') exts = VIDEO_EXTS;
      else if (type === 'document') exts = DOC_EXTS;
      
      // 过滤文件
      const filtered = entries.filter((e) => {
        if (e.isDir) return false;
        const ext = e.name.split('.').pop()?.toLowerCase() || '';
        return exts.includes(ext);
      });
      
      return ok(reply, { entries: filtered });
    } catch (e: any) {
      return fail(reply, 500, e.message || '加载失败');
    }
  });

  // 最近访问文件（基于真实访问历史）
  app.get('/files/recent', { preHandler: authMiddleware }, async (req, reply) => {
    const { storageId, limit = '50' } = req.query as Record<string, string>;
    if (!storageId) return fail(reply, 400, '缺少 storageId');
    try {
      const rec = getStorageRecord(Number(storageId));
      if (!rec) return fail(reply, 404, '存储不存在');
      const db = getDb();
      const userId = req.user ? (req.user as any).sub : null;
      
      // 从 recent_access 表获取该用户的访问记录
      const rows = db.prepare(
        'SELECT * FROM recent_access WHERE user_id = ? AND storage_id = ? ORDER BY accessed_at DESC LIMIT ?'
      ).all(userId, Number(storageId), Number(limit)) as any[];
      
      // 验证文件是否还存在，移除不存在的
      const validEntries: any[] = [];
      for (const row of rows) {
        try {
          const driver = getDriver(rec);
          const stat = await driver.stat(row.path);
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
            // 文件不存在，从记录中删除
            db.prepare('DELETE FROM recent_access WHERE id = ?').run(row.id);
          }
        } catch {
          // 文件不存在，从记录中删除
          db.prepare('DELETE FROM recent_access WHERE id = ?').run(row.id);
        }
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
    // 逐条映射为 camelCase + 实时 stat（size/isDir），失效项自动清理
    const entries: any[] = [];
    for (const row of rows) {
      try {
        const stat = await driver.stat(row.path);
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
          db.prepare('DELETE FROM quick_access WHERE id = ?').run(row.id);
        }
      } catch {
        db.prepare('DELETE FROM quick_access WHERE id = ?').run(row.id);
      }
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
      Number(storageId), fullPath, fullPath.split('/').pop(), isDir
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
    const { storageId, password } = req.body as { storageId?: number; password?: string };
    if (!storageId || !password) return fail(reply, 400, '缺少参数');
    if (password.length < 4) return fail(reply, 400, '密码至少 4 位');
    
    const db = getDb();
    // 检查是否已存在
    const existing = db.prepare('SELECT * FROM hidden_space_settings WHERE storage_id = ?').get(Number(storageId)) as any;
    if (existing) {
      // 更新密码（简单哈希）
      const hash = Buffer.from(password).toString('hex');
      db.prepare('UPDATE hidden_space_settings SET password_hash = ? WHERE storage_id = ?').run(hash, Number(storageId));
    } else {
      // 创建新记录
      const hash = Buffer.from(password).toString('hex');
      db.prepare('INSERT INTO hidden_space_settings (storage_id, password_hash, created_at) VALUES (?, ?, datetime(\'now\'))').run(Number(storageId), hash);
    }
    return ok(reply, { success: true });
  });

  // 隐藏空间解锁
  app.post('/hidden-space/unlock', { preHandler: authMiddleware }, async (req, reply) => {
    const { storageId, password } = req.body as { storageId?: number; password?: string };
    if (!storageId || !password) return fail(reply, 400, '缺少参数');
    
    const db = getDb();
    const existing = db.prepare('SELECT * FROM hidden_space_settings WHERE storage_id = ?').get(Number(storageId)) as any;
    if (!existing) {
      return fail(reply, 400, '请先设置密码');
    }
    
    // 验证密码（简单哈希）
    const hash = Buffer.from(password).toString('hex');
    if (existing.password_hash !== hash) {
      return ok(reply, { unlocked: false });
    }
    
    // 确保 hidden 目录存在
    try {
      const rec = getStorageRecord(Number(storageId));
      if (rec) {
        const driver = getDriver(rec);
        // 尝试创建 hidden 目录
        await driver.mkdir('/hidden');
      }
    } catch {
      // 目录可能已存在，忽略错误
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
