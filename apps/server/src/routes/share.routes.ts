import type { FastifyInstance } from 'fastify';
import { requirePermission, ok, fail } from '../auth/middleware.js';
import { shareService } from '../services/share.service.js';
import { shareStatsService } from '../services/shareStats.service.js';
import { config } from '../config.js';
import { settingNum } from '../services/settings.service.js';
import { safeRelPath } from '../utils/path.js';

export async function shareRoutes(app: FastifyInstance) {
  app.get('/shares', { preHandler: requirePermission('files:share') }, async (req, reply) => {
    return ok(reply, { shares: shareService.list(req.user!.sub) });
  });

  app.post('/shares', { preHandler: requirePermission('files:share') }, async (req, reply) => {
    const b = req.body as {
      storageId: number;
      path: string;
      name?: string;
      password?: string;
      expiresAt?: string;
      maxDownloads?: number;
    };
    try {
      // 未指定有效期时，应用系统默认（0 = 永久）
      let expiresAt = b.expiresAt || null;
      if (!expiresAt) {
        const days = settingNum('shareDefaultExpireDays', 0);
        if (days > 0) expiresAt = new Date(Date.now() + days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
      }
      const s = shareService.create({ ...b, expiresAt, userId: req.user!.sub });
      return ok(reply, { share: s, url: `${config.appUrl}/s/${s.token}` });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '创建分享失败');
    }
  });

  app.put('/shares/:id', { preHandler: requirePermission('files:share') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const s = shareService.byId(id);
    if (!s) return fail(reply, 404, '分享不存在');
    if (s.created_by !== req.user!.sub && req.user!.role !== 'admin') return fail(reply, 403, '无权操作');
    const b = req.body as { name?: string; password?: string | null; expiresAt?: string | null; maxDownloads?: number | null; enabled?: boolean };
    try {
      const updated = shareService.update(id, b);
      return ok(reply, { share: updated });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '更新分享失败');
    }
  });

  app.delete('/shares/:id', { preHandler: requirePermission('files:share') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const s = shareService.byId(id);
    if (!s) return fail(reply, 404, '分享不存在');
    if (s.created_by !== req.user!.sub && req.user!.role !== 'admin') return fail(reply, 403, '无权操作');
    try {
      shareService.remove(id);
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '删除分享失败');
    }
  });

  // ===== 公开分享接口 =====
  app.get('/s/:token', async (req, reply) => {
    const token = String((req.params as { token: string }).token);
    const info = await shareService.publicInfo(token);
    if (!info) return fail(reply, 404, '分享不存在或已失效');
    // 记录浏览
    const s = shareService.byToken(token);
    if (s) shareStatsService.recordView(s.id);
    return ok(reply, { share: info, appUrl: config.appUrl });
  });

  app.post('/s/:token/extract', { config: { rateLimit: { max: 10, timeWindow: 60000, keyGenerator: (req) => String((req.params as any).token || req.ip) } } }, async (req, reply) => {
    const b = req.body as { password?: string };
    const ticket = shareService.extract(String((req.params as { token: string }).token), b.password || '');
    if (!ticket) return fail(reply, 403, '提取码错误或分享已失效');
    return ok(reply, { ticket });
  });

  app.get('/s/:token/files', async (req, reply) => {
    const q = req.query as { ticket?: string; path?: string };
    if (!shareService.verifyTicket(q.ticket || '', String((req.params as { token: string }).token))) {
      return fail(reply, 401, 'ticket 无效');
    }
    try {
      const r = await shareService.publicList(String((req.params as { token: string }).token), q.path || '/');
      return ok(reply, r);
    } catch (e: any) {
      return fail(reply, 404, e?.message || '目录列表失败');
    }
  });

  app.get('/s/:token/download', async (req, reply) => {
    const token = String((req.params as { token: string }).token);
    const q = req.query as { ticket?: string; path?: string };
    if (!shareService.verifyTicket(q.ticket || '', token)) {
      return fail(reply, 401, 'ticket 无效');
    }
    try {
      const { stream, name } = await shareService.publicDownload(token, q.path);
      // 记录下载
      const s = shareService.byToken(token);
      if (s) shareStatsService.recordDownload(s.id);
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      return reply.send(stream);
    } catch (e: any) {
      return fail(reply, 404, e?.message || '下载失败');
    }
  });

  // ===== 分享转存（登录用户将分享文件保存到网盘）=====
  app.post('/s/:token/transfer', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const b = req.body as { ticket?: string; paths?: string[]; destPath?: string };
    const token = String((req.params as { token: string }).token);
    if (!shareService.verifyTicket(b.ticket || '', token)) {
      return fail(reply, 401, 'ticket 无效');
    }
    if (!b.paths?.length) return fail(reply, 400, '缺少文件列表');

    // 查找第一个启用的存储（全局共享）
    const { getDb } = await import('../db/index.js');
    const db = getDb();
    const storage = db.prepare('SELECT * FROM storages WHERE enabled = 1 ORDER BY sort, id LIMIT 1').get() as any;
    if (!storage) return fail(reply, 404, '请先创建存储空间');

    const { dirs } = await import('../config.js');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const destBase = b.destPath || '/';
    // P0-5 修复：校验 destPath 在 storageRoot 内，防止任意位置写文件
    const destDirValidated = safeRelPath(destBase === '/' ? '' : destBase, dirs.storageRoot);
    if (!destDirValidated) return fail(reply, 400, '非法目标路径');
    const transferred: string[] = [];
    const errors: string[] = [];

    for (const p of b.paths) {
      try {
        const { stream, name } = await shareService.publicDownload(token, p);
        const destDir = destDirValidated;
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        const destFile = path.join(destDir, name);
        // 流式写入
        const writer = fs.createWriteStream(destFile);
        await new Promise<void>((resolve, reject) => {
          stream.pipe(writer);
          writer.on('finish', resolve);
          writer.on('error', reject);
          stream.on('error', reject);
        });
        transferred.push(p);
      } catch (e: any) {
        errors.push(`${p}: ${e?.message || '转存失败'}`);
      }
    }
    return ok(reply, { transferred, errors, destPath: destBase });
  });
}
