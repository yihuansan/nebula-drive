import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';
import { authMiddleware, requirePermission, ok, fail } from '../auth/middleware.js';
import { createDriver, invalidateDriver, STORAGE_TYPES } from '../storage/registry.js';
import { opLog } from '../services/log.service.js';

export async function storageRoutes(app: FastifyInstance) {
  // 任何登录用户可列出存储（admin 看全部，普通用户仅看已启用的），供文件页/最近/快捷访问选择器使用
  app.get('/storages', { preHandler: authMiddleware }, async (req, reply) => {
    const db = getDb();
    const query = req.query as Record<string, string>;
    const fast = query.fast === '1'; // fast=1 时跳过用量计算，快速返回
    const rows =
      req.user!.role === 'admin'
        ? (db.prepare('SELECT * FROM storages ORDER BY sort, id').all() as any[])
        : (db.prepare('SELECT * FROM storages WHERE enabled = 1 ORDER BY sort, id').all() as any[]);
    const out = [];
    for (const r of rows) {
      const storage = {
        id: r.id,
        name: r.name,
        type: r.type,
        enabled: !!r.enabled,
        sort: r.sort,
        config: JSON.parse(r.config || '{}'),
      };
      // 计算实际用量（fast 模式跳过）
      if (!fast) {
        try {
          const driver = createDriver({ ...r, config: JSON.parse(r.config || '{}') });
          const usage = await driver.usage();
          storage.used = usage.used;
          storage.files = usage.files;
        } catch {
          storage.used = 0;
          storage.files = 0;
        }
      } else {
        storage.used = 0;
        storage.files = 0;
      }
      out.push(storage);
    }
    return ok(reply, { storages: out, types: STORAGE_TYPES });
  });

  app.post('/storages', { preHandler: requirePermission('storages:manage') }, async (req, reply) => {
    const b = req.body as { name: string; type: string; config: Record<string, unknown>; sort?: number };
    try {
      const info = getDb()
        .prepare('INSERT INTO storages (name, type, config, sort) VALUES (?, ?, ?, ?)')
        .run(b.name, b.type, JSON.stringify(b.config || {}), b.sort || 0);
      opLog(req.user!.sub, req.user!.username, 'storage_create', b.name);
      return ok(reply, { id: Number(info.lastInsertRowid) });
    } catch (e: any) {
      return fail(reply, 409, e?.message?.includes('UNIQUE') ? '存储名已存在' : '创建存储失败');
    }
  });

  app.put('/storages/:id', { preHandler: requirePermission('storages:manage') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as { name?: string; type?: string; config?: Record<string, unknown>; enabled?: number; sort?: number };
    try {
      const row = getDb().prepare('SELECT * FROM storages WHERE id = ?').get(id) as any;
      if (!row) return fail(reply, 404, '存储不存在');
      getDb()
        .prepare(
          `UPDATE storages SET name = ?, type = ?, config = ?, enabled = ?, sort = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(
          b.name ?? row.name,
          b.type ?? row.type,
          JSON.stringify(b.config ?? JSON.parse(row.config || '{}')),
          b.enabled ?? row.enabled,
          b.sort ?? row.sort,
          id,
        );
      invalidateDriver(id);
      opLog(req.user!.sub, req.user!.username, 'storage_update', b.name ?? row.name);
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '更新存储失败');
    }
  });

  app.delete('/storages/:id', { preHandler: requirePermission('storages:manage') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    try {
      getDb().prepare('DELETE FROM storages WHERE id = ?').run(id);
      invalidateDriver(id);
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '删除存储失败');
    }
  });

  app.post('/storages/:id/test', { preHandler: requirePermission('storages:manage') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const row = getDb().prepare('SELECT * FROM storages WHERE id = ?').get(id) as any;
    if (!row) return fail(reply, 404, '存储不存在');
    try {
      const driver = createDriver({ ...row, config: JSON.parse(row.config || '{}') });
      await driver.test();
      return ok(reply, { ok: true });
    } catch (e: any) {
      return ok(reply, { ok: false, error: e?.message || '连接失败' });
    }
  });

  app.post('/storages/:id/toggle', { preHandler: requirePermission('storages:manage') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const row = getDb().prepare('SELECT * FROM storages WHERE id = ?').get(id) as any;
    if (!row) return fail(reply, 404, '存储不存在');
    getDb().prepare('UPDATE storages SET enabled = ? WHERE id = ?').run(row.enabled ? 0 : 1, id);
    invalidateDriver(id);
    return ok(reply, { enabled: !row.enabled });
  });
}
