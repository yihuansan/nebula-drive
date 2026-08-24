import type { FastifyInstance } from 'fastify';
import { requirePermission, authMiddleware, ok, fail } from '../auth/middleware.js';
import { shareCollabService } from '../services/shareCollab.service.js';

export async function shareCollabRoutes(app: FastifyInstance) {
  // ===== 共享管理（创建者视角）=====

  /** 列出我创建的共享 */
  app.get('/share-collab', { preHandler: requirePermission('files:share') }, async (req, reply) => {
    const items = shareCollabService.listByCreator(req.user!.sub);
    // 附加接收者数量
    const { getDb } = await import('../db/index.js');
    const db = getDb();
    const result = items.map((item) => ({
      ...item,
      recipients: db
        .prepare('SELECT user_id, permission FROM share_recipients WHERE share_id = ?')
        .all(item.id) as any[],
    }));
    return ok(reply, { items: result });
  });

  /** 创建共享 */
  app.post('/share-collab', { preHandler: requirePermission('files:share') }, async (req, reply) => {
    const b = req.body as {
      storageId: number;
      path: string;
      name: string;
      isDir: boolean;
      usernames?: string[];
      permission: 'view' | 'download' | 'manage';
      expiresAt?: string;
    };
    try {
      // 通过用户名查找用户 ID
      if (!b.usernames?.length) return fail(reply, 400, '请输入至少一个用户名');
      
      const { getDb } = await import('../db/index.js');
      const db = getDb();
      
      const userIds: number[] = [];
      const notFound: string[] = [];
      
      for (const username of b.usernames) {
        const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as any;
        if (user) {
          userIds.push(user.id);
        } else {
          notFound.push(username);
        }
      }
      
      if (notFound.length) {
        return fail(reply, 400, `用户不存在: ${notFound.join(', ')}`);
      }
      
      const item = shareCollabService.create({ 
        storageId: b.storageId,
        path: b.path,
        name: b.name,
        isDir: b.isDir,
        userIds,
        permission: b.permission,
        expiresAt: b.expiresAt,
        createdBy: req.user!.sub 
      });
      return ok(reply, { item });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '创建共享失败');
    }
  });

  /** 删除共享 */
  app.delete('/share-collab/:id', { preHandler: requirePermission('files:share') }, async (req, reply) => {
    try {
      const id = Number((req.params as { id: string }).id);
      const s = shareCollabService.byId(id);
      if (!s || s.created_by !== req.user!.sub) return fail(reply, 403, '无权操作');
      shareCollabService.remove(id);
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '删除共享失败');
    }
  });

  /** 更新共享 */
  app.put('/share-collab/:id', { preHandler: requirePermission('files:share') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as { name?: string; expiresAt?: string | null };
    try {
      const s = shareCollabService.byId(id);
      if (!s || s.created_by !== req.user!.sub) return fail(reply, 403, '无权操作');
      const item = shareCollabService.update(id, b);
      return ok(reply, { item });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '更新共享失败');
    }
  });

  /** 获取共享的接收者 */
  app.get('/share-collab/:id/recipients', { preHandler: requirePermission('files:share') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const recipients = shareCollabService.getRecipients(id);
    return ok(reply, { recipients });
  });

  /** 添加接收者 */
  app.post('/share-collab/:id/recipients', { preHandler: requirePermission('files:share') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as { userId: number; permission: 'view' | 'download' | 'manage' };
    try {
      const s = shareCollabService.byId(id);
      if (!s || s.created_by !== req.user!.sub) return fail(reply, 403, '无权操作');
      shareCollabService.addRecipient(id, b.userId, b.permission);
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '添加接收者失败');
    }
  });

  /** 移除接收者 */
  app.delete('/share-collab/:id/recipients/:userId', { preHandler: requirePermission('files:share') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const userId = Number((req.params as { userId: string }).userId);
    try {
      const s = shareCollabService.byId(id);
      if (!s || s.created_by !== req.user!.sub) return fail(reply, 403, '无权操作');
      shareCollabService.removeRecipient(id, userId);
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '移除接收者失败');
    }
  });

  /** 更新接收者权限 */
  app.put('/share-collab/:id/recipients/:userId', { preHandler: requirePermission('files:share') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const userId = Number((req.params as { userId: string }).userId);
    const b = req.body as { permission: 'view' | 'download' | 'manage' };
    try {
      const s = shareCollabService.byId(id);
      if (!s || s.created_by !== req.user!.sub) return fail(reply, 403, '无权操作');
      shareCollabService.updateRecipientPermission(id, userId, b.permission);
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '更新权限失败');
    }
  });

  /** 获取共享活动记录 */
  app.get('/share-collab/:id/activity', { preHandler: requirePermission('files:share') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const activity = shareCollabService.getActivity(id);
    return ok(reply, { activity });
  });

  // ===== 共享访问（接收者视角）=====

  /** 列出共享给我的 */
  app.get('/share-collab/received', { preHandler: authMiddleware }, async (req, reply) => {
    const items = shareCollabService.listByRecipient(req.user!.sub);
    // 附加权限信息
    const { getDb } = await import('../db/index.js');
    const db = getDb();
    const result = items.map((item) => {
      const perm = db
        .prepare('SELECT permission FROM share_recipients WHERE share_id = ? AND user_id = ?')
        .get(item.id, req.user!.sub) as any;
      return { ...item, permission: perm?.permission || null };
    });
    return ok(reply, { items: result });
  });

  /** 检查用户是否有权限访问某个共享 */
  app.get('/share-collab/:id/check', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const perm = shareCollabService.hasPermission(id, req.user!.sub);
    return ok(reply, { permission: perm });
  });

  /** 访问共享内容（记录活动） */
  app.get('/share-collab/:id/files', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const perm = shareCollabService.hasPermission(id, req.user!.sub);
    if (!perm) return fail(reply, 403, '无权访问');

    const { getDb } = await import('../db/index.js');
    const { getDriver } = await import('../storage/registry.js');
    const db = getDb();
    const item = shareCollabService.byId(id);
    if (!item) return fail(reply, 404, '共享不存在');

    const q = req.query as { path?: string };
    const storage = db.prepare('SELECT * FROM storages WHERE id = ?').get(item.storage_id) as any;
    const driver = getDriver(storage);
    const basePath = item.path;
    const reqPath = q.path || '/';

    // 计算实际路径
    let realPath: string;
    if (item.is_dir) {
      if (reqPath === '/' || reqPath === basePath) {
        realPath = basePath;
      } else {
        realPath = basePath + (reqPath.startsWith('/') ? reqPath : '/' + reqPath);
      }
    } else {
      realPath = basePath;
    }

    try {
      const entries = await driver.list(realPath);
      // 记录活动
      shareCollabService.recordActivity(id, req.user!.sub, 'view', reqPath);
      return ok(reply, { entries, basePath, permission: perm });
    } catch (e: any) {
      return fail(reply, 404, e?.message || '获取文件列表失败');
    }
  });

  /** 下载共享文件（记录活动） */
  app.get('/share-collab/:id/download', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const perm = shareCollabService.hasPermission(id, req.user!.sub);
    if (!perm || perm === 'view') return fail(reply, 403, '无下载权限');

    const { getDb } = await import('../db/index.js');
    const { getDriver } = await import('../storage/registry.js');
    const db = getDb();
    const item = shareCollabService.byId(id);
    if (!item) return fail(reply, 404, '共享不存在');

    const q = req.query as { path?: string };
    const storage = db.prepare('SELECT * FROM storages WHERE id = ?').get(item.storage_id) as any;
    const driver = getDriver(storage);

    let realPath: string;
    if (item.is_dir) {
      const reqPath = q.path || '/';
      realPath = reqPath === '/' ? item.path : item.path + (reqPath.startsWith('/') ? reqPath : '/' + reqPath);
    } else {
      realPath = item.path;
    }

    try {
      const stream = await driver.download(realPath);
      const name = realPath.split('/').filter(Boolean).pop() || 'download';
      // 记录活动
      shareCollabService.recordActivity(id, req.user!.sub, 'download', q.path);
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      return reply.send(stream);
    } catch (e: any) {
      return fail(reply, 404, e?.message || '下载失败');
    }
  });

  /** 获取所有用户列表（用于选择共享对象） */
  app.get('/share-collab/users', { preHandler: requirePermission('files:share') }, async (_req, reply) => {
    const users = shareCollabService.getAllUsers();
    return ok(reply, { users });
  });
}
