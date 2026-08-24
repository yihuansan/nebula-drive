import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getDb } from '../db/index.js';
import { dirs } from '../config.js';
import { decryptStorageConfig } from '../utils/crypto.js';
import type { Entry } from '../storage/types.js';
import { usageCache } from './usageCache.service.js';

/**
 * P2-5: 文件搜索索引（files_index 表）
 *
 * - 为 local 存储缓存文件元数据（path/name/size/mtime/is_dir），
 *   搜索直接查表（LIKE 匹配 name），不再每次请求递归扫描磁盘。
 * - 文件变更（上传/删除/移动/重命名等）时调用 markDirty() 标记脏；
 *   下次搜索（ensureReady）或定期任务（refreshAll）会重建脏/空的索引。
 * - 安全网：索引超过 MAX_AGE_MS（24h）未更新也视为过期并重建，
 *   覆盖应用外直接改动磁盘的情况。
 * - 远程存储（webdav/s3/...）无法本地扫盘，返回 false 由调用方回退到 driver.search。
 */

const MAX_AGE_MS = 24 * 3600 * 1000;

function dirtyKey(id: number): string {
  return `files_index_dirty_${id}`;
}

function builtKey(id: number): string {
  return `files_index_built_${id}`;
}

interface StorageRow {
  id: number;
  name: string;
  type: string;
  config: string | Record<string, unknown>;
}

function getStorageRow(id: number): StorageRow | null {
  const row = getDb().prepare('SELECT * FROM storages WHERE id = ?').get(id) as StorageRow | undefined;
  return row || null;
}

/** 解析 local 存储的根目录；非 local 返回 null */
function localRoot(rec: StorageRow): string | null {
  if (rec.type !== 'local') return null;
  const raw = rec.config as unknown;
  const parsed: Record<string, unknown> =
    typeof raw === 'string' ? (raw ? JSON.parse(raw) : {}) : ((raw as Record<string, unknown>) || {});
  const cfg = decryptStorageConfig(parsed) as Record<string, unknown>;
  const root = String(cfg.root || '');
  return root ? path.resolve(root) : path.resolve(dirs.storageRoot);
}

export const fileIndex = {
  /** 标记存储的文件已变更（搜索索引 + 用量缓存需刷新）。幂等、可重复调用。 */
  markDirty(storageId: number): void {
    getDb()
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, '1')")
      .run(dirtyKey(storageId));
  },

  /** 删除存储时清理其索引与脏标记 */
  clear(storageId: number): void {
    const db = getDb();
    db.prepare('DELETE FROM files_index WHERE storage_id = ?').run(storageId);
    db.prepare('DELETE FROM settings WHERE key = ?').run(dirtyKey(storageId));
    db.prepare('DELETE FROM settings WHERE key = ?').run(builtKey(storageId));
    usageCache.invalidate(storageId);
  },

  /**
   * 针对直接写盘到某根目录的场景（压缩/解压等绕过 driver 的操作）：
   * 找出根目录匹配的所有 local 存储，使搜索索引与用量缓存失效。
   */
  invalidateForRoot(root: string): void {
    const resolved = path.resolve(root);
    const rows = getDb().prepare("SELECT * FROM storages WHERE type = 'local'").all() as unknown as StorageRow[];
    for (const rec of rows) {
      if (localRoot(rec) === resolved) {
        this.markDirty(rec.id);
        usageCache.invalidate(rec.id);
      }
    }
  },

  /**
   * 惰性确保索引可用：脏 / 空 / 超过 24h 时重建。
   * 返回 true 表示该存储的索引已就绪（仅 local 存储可走索引）。
   */
  async ensureReady(storageId: number): Promise<boolean> {
    const rec = getStorageRow(storageId);
    if (!rec || rec.type !== 'local') return false;
    const db = getDb();
    const dirty = db.prepare('SELECT 1 AS x FROM settings WHERE key = ?').get(dirtyKey(storageId));
    const cnt = db.prepare('SELECT COUNT(*) AS c FROM files_index WHERE storage_id = ?').get(storageId) as { c: number };
    if (dirty || cnt.c === 0) {
      await this.rebuild(storageId);
      return true;
    }
    // 安全网：长时间未更新的索引视为过期（覆盖应用外直接改动磁盘的情况）
    const built = db.prepare('SELECT value FROM settings WHERE key = ?').get(builtKey(storageId)) as { value: string } | undefined;
    if (built && Date.now() - Number(built.value || 0) > MAX_AGE_MS) {
      await this.rebuild(storageId);
    }
    return true;
  },

  /** 全量重建某 local 存储的索引（事务内清空 + 重填） */
  async rebuild(storageId: number): Promise<void> {
    const rec = getStorageRow(storageId);
    const root = rec ? localRoot(rec) : null;
    if (!root) return;

    // [relPath, name, size, mtimeMs, isDir]
    const rows: Array<[string, string, number, number, number]> = [];
    const collect = async (dir: string, rel: string): Promise<void> => {
      const items = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const it of items) {
        const full = path.join(dir, it.name);
        const r = rel + '/' + it.name;
        let st: fs.Stats;
        try {
          st = await fsp.stat(full);
        } catch {
          continue; // 竞态删除等
        }
        rows.push([r, it.name, st.isDirectory() ? 0 : st.size, Math.floor(st.mtimeMs), st.isDirectory() ? 1 : 0]);
        if (it.isDirectory()) await collect(full, r);
      }
    };
    if (fs.existsSync(root) && fs.statSync(root).isDirectory()) {
      await collect(root, '');
    }

    const db = getDb();
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM files_index WHERE storage_id = ?').run(storageId);
      const ins = db.prepare(
        'INSERT INTO files_index (storage_id, path, name, size, mtime, is_dir) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const [p, n, s, m, d] of rows) ins.run(storageId, p, n, s, String(m), d);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    // 记录构建时间并清除脏标记
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(builtKey(storageId), String(Date.now()));
    db.prepare('DELETE FROM settings WHERE key = ?').run(dirtyKey(storageId));
  },

  /**
   * 基于索引的搜索：按 name 模糊匹配（大小写不敏感，与旧版 toLowerCase().includes 语义一致），
   * 返回文件与目录条目，供上层应用 type/size/time 过滤。
   */
  search(storageId: number, query: string): Entry[] {
    const db = getDb();
    const esc = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const rows = db
      .prepare(
        "SELECT path, name, size, mtime, is_dir FROM files_index WHERE storage_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY path",
      )
      .all(storageId, `%${esc}%`) as Array<{ path: string; name: string; size: number; mtime: string; is_dir: number }>;
    return rows.map((r) => ({
      name: r.name,
      path: r.path,
      isDir: !!r.is_dir,
      size: Number(r.size) || 0,
      mtime: Number(r.mtime) || 0,
    }));
  },

  /** 定期刷新：重建所有 local 存储中脏/空/过期的索引（启动预热与定时器共用） */
  async refreshAll(): Promise<void> {
    const rows = getDb().prepare("SELECT id FROM storages WHERE type = 'local'").all() as Array<{ id: number }>;
    for (const r of rows) {
      try {
        await this.ensureReady(r.id);
      } catch (e: any) {
        console.error('[fileIndex] 重建索引失败:', r.id, e?.message || e);
      }
    }
  },
};
