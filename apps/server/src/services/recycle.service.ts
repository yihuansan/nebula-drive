import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.js';
import { getDriver } from '../storage/registry.js';
import { dirs } from '../config.js';
import { safeRelPath } from '../utils/path.js';
import { fileIndex } from './fileIndex.service.js';
import { usageCache } from './usageCache.service.js';

/** P2-5/P2-6: 回收站操作会改变存储内容，使搜索索引与用量缓存失效 */
function invalidateCaches(storageId: number): void {
  try {
    fileIndex.markDirty(storageId);
    usageCache.invalidate(storageId);
  } catch {
    // 缓存失效失败不影响主流程
  }
}

export interface RecycleRow {
  id: number;
  storage_id: number;
  path: string;
  name: string;
  size: number;
  is_dir: number;
  local_copy: string | null;
  deleted_by: number | null;
  deleted_at: string;
}

export const recycleService = {
  /**
   * 移入回收站：
   * - local 存储：物理移动到 data/recycle/<uuid>/，可恢复
   * - 远程存储：直接驱动删除，仅保留元数据（恢复需重新上传，此处恢复=报错提示）
   */
  async moveToRecycle(storageId: number, filePath: string, userId?: number): Promise<void> {
    const db = getDb();
    const rec = db.prepare('SELECT * FROM storages WHERE id = ?').get(storageId) as any;
    if (!rec) throw new Error('存储不存在');
    const driver = getDriver(rec);
    const stat = await driver.stat(filePath);
    const name = filePath.split('/').filter(Boolean).pop() || '未知';
    let localCopy: string | null = null;

    if (rec.type === 'local') {
      const cfg = typeof rec.config === 'string' ? JSON.parse(rec.config || '{}') : (rec.config || {});
      const root = cfg.root || dirs.storageRoot;
      // P0-1 修复：校验 filePath 在存储根目录内，防止任意文件移入回收站
      const real = safeRelPath(filePath, root);
      if (!real) throw new Error('非法路径：文件不在存储范围内');
      const target = path.join(dirs.recycle, crypto.randomUUID());
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(real, target);
      localCopy = target;
    } else {
      await driver.delete(filePath, true);
    }

    db.prepare(
      `INSERT INTO recycle (storage_id, path, name, size, is_dir, local_copy, deleted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(storageId, filePath, name, stat?.size || 0, stat?.isDir ? 1 : 0, localCopy, userId ?? null);
    invalidateCaches(storageId);
  },

  list() {
    return getDb().prepare('SELECT * FROM recycle ORDER BY id DESC').all() as unknown as RecycleRow[];
  },

  restore(id: number): void {
    const db = getDb();
    const row = db.prepare('SELECT * FROM recycle WHERE id = ?').get(id) as unknown as RecycleRow | undefined;
    if (!row) throw new Error('回收站记录不存在');
    if (row.local_copy) {
      const rec = db.prepare('SELECT * FROM storages WHERE id = ?').get(row.storage_id) as any;
      const cfg = rec ? (typeof rec.config === 'string' ? JSON.parse(rec.config || '{}') : (rec.config || {})) : {};
      const root = cfg.root || dirs.storageRoot;
      // P0-2 修复：校验 DB 中记录的 path 在存储根目录内，防止任意文件写回
      const real = safeRelPath(row.path, root);
      if (!real) throw new Error('非法路径：恢复目标不在存储范围内');
      fs.mkdirSync(path.dirname(real), { recursive: true });
      fs.renameSync(row.local_copy, real);
      invalidateCaches(row.storage_id);
    } else {
      throw new Error('远程存储项已物理删除，无法恢复（请重新上传）');
    }
    db.prepare('DELETE FROM recycle WHERE id = ?').run(id);
  },

  remove(id: number): void {
    const row = getDb().prepare('SELECT * FROM recycle WHERE id = ?').get(id) as unknown as RecycleRow | undefined;
    if (!row) return;
    if (row.local_copy && fs.existsSync(row.local_copy)) {
      fs.rmSync(row.local_copy, { recursive: true, force: true });
    }
    getDb().prepare('DELETE FROM recycle WHERE id = ?').run(id);
    invalidateCaches(row.storage_id);
  },

  clear(): void {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM recycle').all() as unknown as RecycleRow[];
    for (const r of rows) {
      if (r.local_copy && fs.existsSync(r.local_copy)) {
        fs.rmSync(r.local_copy, { recursive: true, force: true });
      }
    }
    db.prepare('DELETE FROM recycle').run();
    // 收集受影响的存储并使其缓存失效
    const storageIds = Array.from(new Set(rows.map((r) => r.storage_id)));
    for (const sid of storageIds) invalidateCaches(sid);
  },

  /**
   * 自动清理：删除超过 N 天的回收站条目（物理文件 + 元数据）。
   * 返回清理条数。
   */
  purgeOlderThan(days: number): number {
    if (!Number.isFinite(days) || days <= 0) return 0;
    const db = getDb();
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    const rows = db.prepare('SELECT * FROM recycle WHERE deleted_at < ?').all(cutoff) as unknown as RecycleRow[];
    for (const r of rows) {
      if (r.local_copy && fs.existsSync(r.local_copy)) {
        fs.rmSync(r.local_copy, { recursive: true, force: true });
      }
    }
    const info = db.prepare('DELETE FROM recycle WHERE deleted_at < ?').run(cutoff);
    // 清理了物理文件 → 使受影响存储的缓存失效
    const storageIds = Array.from(new Set(rows.map((r) => r.storage_id)));
    for (const sid of storageIds) invalidateCaches(sid);
    return Number(info.changes) || 0;
  },
};
