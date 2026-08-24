import { getDb } from '../db/index.js';

/**
 * P2-6: 存储用量缓存（storage_usage_cache 表）
 *
 * - GET /storages 计算用量前先查缓存；缓存 5 分钟内有效则直接返回，
 *   否则重新计算（driver.usage() 递归遍历）并写回缓存。
 * - 文件变更（上传/删除/移动/重命名/回收站操作）时调用 invalidate() 使缓存失效，
 *   保证下次请求拿到最新值。
 */

const TTL_MS = 5 * 60 * 1000;

export interface UsageCacheRow {
  totalBytes: number;
  fileCount: number;
  updatedAt: string;
}

export const usageCache = {
  /** 返回 5 分钟内的缓存；过期或不存在返回 null */
  get(storageId: number): UsageCacheRow | null {
    const row = getDb()
      .prepare(
        `SELECT total_bytes, file_count, updated_at,
                CAST(strftime('%s', updated_at) AS INTEGER) AS ts
         FROM storage_usage_cache WHERE storage_id = ?`,
      )
      .get(storageId) as { total_bytes: number; file_count: number; updated_at: string; ts: number } | undefined;
    if (!row) return null;
    const age = Date.now() / 1000 - (row.ts || 0);
    if (!Number.isFinite(age) || age < 0 || age * 1000 > TTL_MS) return null;
    return {
      totalBytes: Number(row.total_bytes) || 0,
      fileCount: Number(row.file_count) || 0,
      updatedAt: row.updated_at,
    };
  },

  /** 写入/更新缓存（datetime('now') 为 UTC，与 strftime('%s') 解析一致） */
  set(storageId: number, totalBytes: number, fileCount: number): void {
    getDb()
      .prepare(
        `INSERT INTO storage_usage_cache (storage_id, total_bytes, file_count, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(storage_id) DO UPDATE SET
           total_bytes = excluded.total_bytes,
           file_count = excluded.file_count,
           updated_at = datetime('now')`,
      )
      .run(storageId, totalBytes, fileCount);
  },

  /** 文件变更时使缓存失效（下次请求将重新计算） */
  invalidate(storageId: number): void {
    getDb().prepare('DELETE FROM storage_usage_cache WHERE storage_id = ?').run(storageId);
  },

  /** 删除存储时彻底清理缓存行 */
  clear(storageId: number): void {
    this.invalidate(storageId);
  },
};
