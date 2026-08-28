import crypto from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getDb } from '../db/index.js';
import { getDriver } from '../storage/registry.js';
import { opLog } from './log.service.js';
import { fileIndex } from './fileIndex.service.js';
import { usageCache } from './usageCache.service.js';

/** P2-5/P2-6: 同步推送/删除会改变存储内容，使搜索索引与用量缓存失效 */
function invalidateCaches(storageId: number): void {
  try {
    fileIndex.markDirty(storageId);
    usageCache.invalidate(storageId);
  } catch {
    // 缓存失效失败不影响主流程
  }
}

export interface SyncPairRow {
  id: number;
  token: string;
  user_id: number;
  storage_id: number;
  remote_path: string;
  local_path: string | null;
  mode: 'push' | 'pull' | 'two-way';
  enabled: number;
  created_at: string;
}

export const syncService = {
  create(params: { userId: number; storageId: number; remotePath: string; mode: 'push' | 'pull' | 'two-way'; localPath?: string }): SyncPairRow {
    const db = getDb();
    const rec = db.prepare('SELECT * FROM storages WHERE id = ? AND enabled = 1').get(params.storageId) as any;
    if (!rec) throw new Error('存储不存在或已禁用');
    const token = crypto.randomBytes(24).toString('hex');
    const info = db
      .prepare(
        `INSERT INTO sync_pairs (token, user_id, storage_id, remote_path, local_path, mode)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(token, params.userId, params.storageId, params.remotePath.replace(/\/$/, '') || '/', params.localPath || null, params.mode);
    return (db.prepare('SELECT * FROM sync_pairs WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as SyncPairRow)!;
  },

  listByUser(userId: number): SyncPairRow[] {
    return getDb().prepare('SELECT * FROM sync_pairs WHERE user_id = ? ORDER BY id DESC').all(userId) as unknown as SyncPairRow[];
  },

  byToken(token: string): SyncPairRow | null {
    const row = getDb().prepare('SELECT * FROM sync_pairs WHERE token = ? AND enabled = 1').get(token) as unknown as SyncPairRow | undefined;
    return row || null;
  },

  remove(id: number, userId: number): void {
    getDb().prepare('DELETE FROM sync_pairs WHERE id = ? AND user_id = ?').run(id, userId);
  },

  /** 远端清单：遍历 remote_path 下所有文件 */
  async manifest(token: string) {
    const pair = this.byToken(token);
    if (!pair) throw new Error('同步令牌无效');
    const rec = getDb().prepare('SELECT * FROM storages WHERE id = ?').get(pair.storage_id) as any;
    const driver = getDriver(rec);
    const out: Array<{ relPath: string; size: number; mtime: number }> = [];
    const base = pair.remote_path === '/' ? '' : pair.remote_path.replace(/\/$/, '');
    const walk = async (p: string) => {
      let entries: Awaited<ReturnType<typeof driver.list>>;
      try {
        entries = await driver.list(p);
      } catch {
        return;
      }
      for (const e of entries) {
        if (base) {
          const baseWithSlash = base + '/';
          if (e.path !== base && !e.path.startsWith(baseWithSlash)) {
            continue;
          }
        }
        const rel = base ? (e.path.slice(base.length) || '/') : '/' + e.path;
        if (e.isDir) await walk(e.path);
        else out.push({ relPath: rel, size: e.size, mtime: e.mtime });
      }
    };
    await walk(base || '/');
    return out;
  },

  /** 回写清单 */
  report(token: string, files: Array<{ relPath: string; hash: string; size: number; mtime: number }>): void {
    const pair = this.byToken(token);
    if (!pair) throw new Error('同步令牌无效');
    const db = getDb();
    db.prepare('DELETE FROM sync_files WHERE pair_id = ?').run(pair.id);
    const ins = db.prepare('INSERT OR REPLACE INTO sync_files (pair_id, rel_path, hash, size, mtime) VALUES (?, ?, ?, ?, ?)');
    for (const f of files) {
      ins.run(pair.id, f.relPath, f.hash, f.size, f.mtime);
    }
  },

  /** 拉取远端文件 */
  async pull(token: string, relPath: string): Promise<Readable> {
    const pair = this.byToken(token);
    if (!pair) throw new Error('同步令牌无效');
    const segments = relPath.split('/').filter(Boolean);
    if (segments.includes('..')) throw new Error('非法路径');
    const rec = getDb().prepare('SELECT * FROM storages WHERE id = ?').get(pair.storage_id) as any;
    const driver = getDriver(rec);
    const full = pair.remote_path === '/' ? relPath : pair.remote_path + relPath;
    const bp = pair.remote_path === '/' ? '' : pair.remote_path.replace(/\/$/, '');
    if (bp) {
      const normalizedFull = path.normalize(full);
      const normalizedBp = path.normalize(bp);
      const bpWithSlash = normalizedBp.endsWith('/') ? normalizedBp : normalizedBp + '/';
      if (normalizedFull !== normalizedBp && !normalizedFull.startsWith(bpWithSlash)) {
        throw new Error('非法路径');
      }
    }
    opLog(pair.user_id, undefined, 'sync_pull', full);
    return driver.download(full);
  },

  /** 推送本地文件 */
  async push(token: string, relPath: string, body: Buffer): Promise<void> {
    const pair = this.byToken(token);
    if (!pair) throw new Error('同步令牌无效');
    const segments = relPath.split('/').filter(Boolean);
    if (segments.includes('..')) throw new Error('非法路径');
    const rec = getDb().prepare('SELECT * FROM storages WHERE id = ?').get(pair.storage_id) as any;
    const driver = getDriver(rec);
    const full = pair.remote_path === '/' ? relPath : pair.remote_path + relPath;
    const bp = pair.remote_path === '/' ? '' : pair.remote_path.replace(/\/$/, '');
    if (bp) {
      const normalizedFull = path.normalize(full);
      const normalizedBp = path.normalize(bp);
      const bpWithSlash = normalizedBp.endsWith('/') ? normalizedBp : normalizedBp + '/';
      if (normalizedFull !== normalizedBp && !normalizedFull.startsWith(bpWithSlash)) {
        throw new Error('非法路径');
      }
    }
    await driver.upload(full, Readable.from([body]));
    invalidateCaches(pair.storage_id);
    opLog(pair.user_id, undefined, 'sync_push', full);
  },

  /** 删除远端文件 */
  async removeFile(token: string, relPath: string): Promise<void> {
    const pair = this.byToken(token);
    if (!pair) throw new Error('同步令牌无效');
    const segments = relPath.split('/').filter(Boolean);
    if (segments.includes('..')) throw new Error('非法路径');
    const rec = getDb().prepare('SELECT * FROM storages WHERE id = ?').get(pair.storage_id) as any;
    const driver = getDriver(rec);
    const full = pair.remote_path === '/' ? relPath : pair.remote_path + relPath;
    const bp = pair.remote_path === '/' ? '' : pair.remote_path.replace(/\/$/, '');
    if (bp) {
      const normalizedFull = path.normalize(full);
      const normalizedBp = path.normalize(bp);
      const bpWithSlash = normalizedBp.endsWith('/') ? normalizedBp : normalizedBp + '/';
      if (normalizedFull !== normalizedBp && !normalizedFull.startsWith(bpWithSlash)) {
        throw new Error('非法路径');
      }
    }
    await driver.delete(full, false);
    invalidateCaches(pair.storage_id);
    opLog(pair.user_id, undefined, 'sync_delete', full);
  },
};
