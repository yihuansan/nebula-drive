import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { getDriver, type StorageRecord } from '../storage/registry.js';
import type { Entry } from '../storage/types.js';
import { recycleService } from './recycle.service.js';
import { opLog } from './log.service.js';
import { fileIndex } from './fileIndex.service.js';
import { usageCache } from './usageCache.service.js';

/** P2-5/P2-6: 文件变更后使搜索索引与用量缓存失效 */
function invalidateCaches(storageId: number): void {
  try {
    fileIndex.markDirty(storageId);
    usageCache.invalidate(storageId);
  } catch {
    // 缓存失效失败不影响主流程
  }
}

export function getStorageRecord(id: number): StorageRecord | null {
  const row = getDb().prepare('SELECT * FROM storages WHERE id = ?').get(id) as unknown as StorageRecord | undefined;
  return row || null;
}

/** 一次性下载票据（内存，5 分钟，单次有效）：让浏览器原生流式下载，避免把 JWT 放进 URL */
const downloadTickets = new Map<string, { storageId: number; path: string; exp: number }>();
const DL_TICKET_TTL = 5 * 60 * 1000;

export function issueDownloadTicket(storageId: number, path: string): string {
  const ticket = crypto.randomBytes(16).toString('hex');
  downloadTickets.set(ticket, { storageId, path, exp: Date.now() + DL_TICKET_TTL });
  const now = Date.now();
  for (const [k, v] of downloadTickets) if (v.exp < now) downloadTickets.delete(k);
  return ticket;
}

export function consumeDownloadTicket(ticket: string): { storageId: number; path: string } | null {
  const t = downloadTickets.get(ticket);
  if (!t) return null;
  if (t.exp < Date.now()) {
    downloadTickets.delete(ticket);
    return null;
  }
  downloadTickets.delete(ticket); // 单次有效
  return { storageId: t.storageId, path: t.path };
}

function toEntryDTO(e: Entry) {
  return { name: e.name, path: e.path, isDir: e.isDir, size: e.size, mtime: e.mtime };
}

export const fileService = {
  async list(storageId: number, path: string, sort: string, order: string) {
    const rec = getStorageRecord(storageId);
    if (!rec) throw new Error('存储不存在');
    const driver = getDriver(rec);
    let entries = await driver.list(path);
    entries = entries.map(toEntryDTO);
    const dir = (a: Entry, b: Entry) => a.name.localeCompare(b.name);
    const size = (a: Entry, b: Entry) => a.size - b.size;
    const time = (a: Entry, b: Entry) => a.mtime - b.mtime;
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      let r = 0;
      if (sort === 'size') r = size(a, b);
      else if (sort === 'mtime') r = time(a, b);
      else r = dir(a, b);
      return order === 'desc' ? -r : r;
    });
    return { entries, parent: path === '/' ? null : path.replace(/\/[^/]*\/?$/, '') || '/' };
  },

  async mkdir(storageId: number, path: string, user?: { username: string; id?: number }) {
    const rec = getStorageRecord(storageId);
    if (!rec) throw new Error('存储不存在');
    await getDriver(rec).mkdir(path);
    invalidateCaches(storageId);
    opLog(user?.id, user?.username, 'mkdir', path);
  },

  async rename(storageId: number, path: string, newPath: string, user?: { username: string; id?: number }) {
    const rec = getStorageRecord(storageId);
    if (!rec) throw new Error('存储不存在');
    await getDriver(rec).rename(path, newPath);
    invalidateCaches(storageId);
    opLog(user?.id, user?.username, 'rename', `${path} -> ${newPath}`);
  },

  async move(storageId: number, path: string, destPath: string, user?: { username: string; id?: number }) {
    const rec = getStorageRecord(storageId);
    if (!rec) throw new Error('存储不存在');
    await getDriver(rec).move(path, destPath);
    invalidateCaches(storageId);
    opLog(user?.id, user?.username, 'move', `${path} -> ${destPath}`);
  },

  async copy(storageId: number, path: string, destPath: string, user?: { username: string; id?: number }) {
    const rec = getStorageRecord(storageId);
    if (!rec) throw new Error('存储不存在');
    await getDriver(rec).copy(path, destPath);
    invalidateCaches(storageId);
    opLog(user?.id, user?.username, 'copy', `${path} -> ${destPath}`);
  },

  /** 删除 → 回收站 */
  async delete(storageId: number, path: string, user?: { username: string; id?: number }) {
    const rec = getStorageRecord(storageId);
    if (!rec) throw new Error('存储不存在');
    await recycleService.moveToRecycle(storageId, path, user?.id);
    invalidateCaches(storageId);
    opLog(user?.id, user?.username, 'delete', path);
  },

  async batchDelete(storageId: number, paths: string[], user?: { username: string; id?: number }) {
    for (const p of paths) {
      await this.delete(storageId, p, user);
    }
  },

  /** 批量移动：destPath 为目标目录，逐项移动到 destDir + basename */
  async batchMove(storageId: number, paths: string[], destPath: string, user?: { username: string; id?: number }) {
    const destDir = destPath.endsWith('/') ? destPath : destPath + '/';
    for (const p of paths) {
      const base = p.split('/').filter(Boolean).pop() || '';
      await this.move(storageId, p, destDir + base, user);
    }
  },

  /** 批量复制：destPath 为目标目录，逐项复制到 destDir + basename */
  async batchCopy(storageId: number, paths: string[], destPath: string, user?: { username: string; id?: number }) {
    const destDir = destPath.endsWith('/') ? destPath : destPath + '/';
    for (const p of paths) {
      const base = p.split('/').filter(Boolean).pop() || '';
      await this.copy(storageId, p, destDir + base, user);
    }
  },

  async search(
    q: string,
    storageId?: number,
    filters?: { type?: string; minSize?: number; maxSize?: number; since?: string; until?: string }
  ) {
    const db = getDb();
    const list = (storageId
      ? [db.prepare('SELECT * FROM storages WHERE id = ? AND enabled = 1').get(storageId)]
      : db.prepare('SELECT * FROM storages WHERE enabled = 1').all()
    ).filter(Boolean) as unknown as StorageRecord[];
    const out: Array<{ storageId: number; storageName: string; entry: Entry }> = [];
    for (const rec of list) {
      try {
        // P2-5: local 存储优先查 files_index（脏/空时惰性重建），
        // 远程存储或索引不可用时回退到 driver 递归扫描
        let entries: Entry[];
        if (await fileIndex.ensureReady(rec.id)) {
          entries = fileIndex.search(rec.id, q);
        } else {
          entries = await getDriver(rec).search(q, '/');
        }
        // 应用过滤条件
        if (filters) {
          entries = entries.filter((e) => {
            if (e.isDir) return false; // 目录不参与过滤
            if (filters.type) {
              const ext = e.name.split('.').pop()?.toLowerCase() || '';
              // 支持单扩展名或逗号分隔的扩展名列表（如 "jpg,png,gif"）
              const types = filters.type.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
              if (types.length && !types.includes(ext)) return false;
            }
            if (filters.minSize !== undefined && e.size < filters.minSize) return false;
            if (filters.maxSize !== undefined && e.size > filters.maxSize) return false;
            if (filters.since) {
              const since = new Date(filters.since).getTime();
              if (e.mtime < since) return false;
            }
            if (filters.until) {
              const until = new Date(filters.until).getTime();
              if (e.mtime > until) return false;
            }
            return true;
          });
        }
        for (const e of entries) out.push({ storageId: rec.id, storageName: rec.name, entry: toEntryDTO(e) });
      } catch {
        /* 单个存储失败不影响整体搜索 */
      }
    }
    return out;
  },
};
