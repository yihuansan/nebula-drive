import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';
import { authMiddleware, requirePermission, ok, fail } from '../auth/middleware.js';
import { createDriver, invalidateDriver, STORAGE_TYPES } from '../storage/registry.js';
import { opLog } from '../services/log.service.js';
import { encryptStorageConfig, decryptStorageConfig } from '../utils/crypto.js';
import { usageCache } from '../services/usageCache.service.js';
import { fileIndex } from '../services/fileIndex.service.js';

/**
 * P0-7 修复：对非 admin 用户脱敏存储配置中的敏感字段。
 * 保留非敏感字段（region、bucket、basePath、port、root 等），
 * 遮蔽敏感字段（accessKeyId、secretAccessKey、password、token、username）。
 */
function redactStorageConfig(config: Record<string, any>): Record<string, any> {
  const sensitiveKeys = ['accessKeyId', 'secretAccessKey', 'password', 'token', 'username'];
  const result: Record<string, any> = { ...config };
  for (const key of sensitiveKeys) {
    if (result[key]) {
      result[key] = '***';
    }
  }
  return result;
}

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
      const rawConfig = JSON.parse(r.config || '{}');
      // P2-11 修复：admin 用户解密凭据，非 admin 用户脱敏
      const config = req.user!.role === 'admin'
        ? decryptStorageConfig(rawConfig)
        : redactStorageConfig(rawConfig);
      const storage = {
        id: r.id,
        name: r.name,
        type: r.type,
        enabled: !!r.enabled,
        sort: r.sort,
        config,
        used: 0,
        files: 0,
      };
      // 计算实际用量（fast 模式跳过）
      if (!fast) {
        try {
          // P2-6: 优先返回 5 分钟内的缓存；过期则重新计算并写回缓存
          const cached = usageCache.get(r.id);
          if (cached) {
            storage.used = cached.totalBytes;
            storage.files = cached.fileCount;
          } else {
            // P2-11 修复：解密配置后创建 driver
            const driver = createDriver({ ...r, config: decryptStorageConfig(JSON.parse(r.config || '{}')) });
            const usage = await driver.usage();
            usageCache.set(r.id, usage.used, usage.files);
            storage.used = usage.used;
            storage.files = usage.files;
          }
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
      // P2-11 修复：加密敏感字段后存储
      const encryptedConfig = encryptStorageConfig(b.config || {});
      const info = getDb()
        .prepare('INSERT INTO storages (name, type, config, sort) VALUES (?, ?, ?, ?)')
        .run(b.name, b.type, JSON.stringify(encryptedConfig), b.sort || 0);
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
      // P2-11 修复：加密敏感字段后存储
      const newConfig = b.config ?? JSON.parse(row.config || '{}');
      const encryptedConfig = encryptStorageConfig(newConfig);
      getDb()
        .prepare(
          `UPDATE storages SET name = ?, type = ?, config = ?, enabled = ?, sort = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(
          b.name ?? row.name,
          b.type ?? row.type,
          JSON.stringify(encryptedConfig),
          b.enabled ?? row.enabled,
          b.sort ?? row.sort,
          id,
        );
      invalidateDriver(id);
      // P2-5/P2-6: 配置（可能含 root）变更 → 索引与用量缓存失效
      fileIndex.markDirty(id);
      usageCache.invalidate(id);
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
      // P2-5/P2-6: 清理该存储的索引与用量缓存
      fileIndex.clear(id);
      usageCache.clear(id);
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
      // P2-11 修复：解密配置后创建 driver
      const driver = createDriver({ ...row, config: decryptStorageConfig(JSON.parse(row.config || '{}')) });
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
