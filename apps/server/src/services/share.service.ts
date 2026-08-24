import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { getDriver } from '../storage/registry.js';
import type { StorageDriver } from '../storage/types.js';
import { fileService } from './file.service.js';
import { opLog } from './log.service.js';

export interface ShareRow {
  id: number;
  token: string;
  storage_id: number;
  path: string;
  name: string;
  password_hash: string | null;
  expires_at: string | null;
  max_downloads: number | null;
  download_count: number;
  enabled: number;
  created_by: number | null;
  created_at: string;
}

/** 提取码 ticket（内存，15 分钟） */
const tickets = new Map<string, { token: string; exp: number }>();
const TICKET_TTL = 15 * 60 * 1000;

function cleanTicket() {
  const now = Date.now();
  for (const [k, v] of tickets) if (v.exp < now) tickets.delete(k);
}

export const shareService = {
  list(userId: number) {
    return getDb()
      .prepare('SELECT * FROM shares WHERE created_by = ? ORDER BY id DESC')
      .all(userId) as unknown as ShareRow[];
  },

  all() {
    return getDb().prepare('SELECT * FROM shares ORDER BY id DESC').all() as unknown as ShareRow[];
  },

  create(params: { storageId: number; path: string; name?: string; password?: string; expiresAt?: string | null; maxDownloads?: number | null; userId?: number }) {
    const name = params.name || params.path.split('/').filter(Boolean).pop() || '分享';
    // P2-2 修复：token 从 8 字节提升到 32 字节，增加熵
    const token = crypto.randomBytes(32).toString('hex');
    const info = getDb()
      .prepare(
        `INSERT INTO shares (token, storage_id, path, name, password_hash, expires_at, max_downloads, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        token,
        params.storageId,
        params.path,
        name,
        params.password ? hashPassword(params.password) : null,
        params.expiresAt || null,
        params.maxDownloads ?? null,
        params.userId ?? null,
      );
    opLog(params.userId, undefined, 'share_create', params.path);
    return this.byId(Number(info.lastInsertRowid))!;
  },

  byId(id: number): ShareRow | null {
    return (getDb().prepare('SELECT * FROM shares WHERE id = ?').get(id) as unknown as ShareRow | undefined) || null;
  },

  byToken(token: string): ShareRow | null {
    return (getDb().prepare('SELECT * FROM shares WHERE token = ?').get(token) as unknown as ShareRow | undefined) || null;
  },

  update(id: number, patch: { name?: string; password?: string | null; expiresAt?: string | null; maxDownloads?: number | null; enabled?: boolean }) {
    const s = this.byId(id);
    if (!s) throw new Error('分享不存在');
    getDb()
      .prepare(
        `UPDATE shares SET name = ?, password_hash = ?, expires_at = ?, max_downloads = ?, enabled = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(
        patch.name ?? s.name,
        patch.password !== undefined ? (patch.password ? hashPassword(patch.password) : null) : s.password_hash,
        patch.expiresAt !== undefined ? (patch.expiresAt || null) : s.expires_at,
        patch.maxDownloads !== undefined ? patch.maxDownloads : s.max_downloads,
        patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : s.enabled,
        id,
      );
    return this.byId(id);
  },

  remove(id: number) {
    getDb().prepare('DELETE FROM shares WHERE id = ?').run(id);
  },

  /** 公开接口：分享信息（不含密码等敏感字段）；isDir/size 实时判断 */
  async publicInfo(token: string) {
    const s = this.byToken(token);
    if (!s || !s.enabled) return null;
    if (s.expires_at && new Date(s.expires_at + 'Z') < new Date()) return null;
    const driver = getDriver(getDb().prepare('SELECT * FROM storages WHERE id = ?').get(s.storage_id) as any);
    const st = await driver.stat(s.path);
    if (!st) return null; // 资源已不存在 → 分享失效
    return {
      token,
      name: s.name,
      hasPassword: !!s.password_hash,
      expiresAt: s.expires_at,
      maxDownloads: s.max_downloads,
      downloadCount: s.download_count,
      path: s.path,
      storageId: s.storage_id,
      isDir: st.isDir,
      size: st.size,
    };
  },

  /** 校验公开请求路径在分享范围内，返回真实存储路径（防路径越权） */
  async resolvePublicPath(s: ShareRow, driver: StorageDriver, clientPath: string, wantDir?: boolean): Promise<string> {
    const st = await driver.stat(s.path);
    if (!st) throw new Error('分享资源不存在');
    if (wantDir && !st.isDir) throw new Error('分享为单个文件');
    const p = (clientPath || '/').replace(/\\/g, '/');
    if (p.split('/').some((seg) => seg === '..')) throw new Error('非法路径');
    if (st.isDir) {
      if (p !== s.path && !p.startsWith(s.path + '/')) throw new Error('路径超出分享范围');
      return p;
    }
    // 文件分享：只能访问该文件本身
    if (p !== s.path) throw new Error('路径超出分享范围');
    return s.path;
  },

  /** 校验提取码，签发 ticket */
  extract(token: string, password: string): string | null {
    const s = this.byToken(token);
    if (!s || !s.enabled) return null;
    if (s.expires_at && new Date(s.expires_at + 'Z') < new Date()) return null;
    if (s.password_hash && !verifyPassword(password, s.password_hash)) return null;
    if (!s.password_hash) {
      // 无密码分享也签发 ticket，统一鉴权
    }
    cleanTicket();
    const ticket = crypto.randomBytes(16).toString('hex');
    tickets.set(ticket, { token, exp: Date.now() + TICKET_TTL });
    return ticket;
  },

  verifyTicket(ticket: string, token: string): boolean {
    const t = tickets.get(ticket);
    if (!t || t.token !== token) return false;
    if (t.exp < Date.now()) {
      tickets.delete(ticket);
      return false;
    }
    return true;
  },

  async publicList(token: string, path: string) {
    const s = this.byToken(token);
    if (!s || !s.enabled) throw new Error('分享不存在');
    const driver = getDriver(getDb().prepare('SELECT * FROM storages WHERE id = ?').get(s.storage_id) as any);
    const real = await this.resolvePublicPath(s, driver, path, true);
    const entries = await driver.list(real);
    return { entries, parent: real === s.path ? null : real.replace(/\/[^/]*\/?$/, '') || '/' };
  },

  async publicDownload(token: string, path?: string) {
    const s = this.byToken(token);
    if (!s || !s.enabled) throw new Error('分享不存在');
    // P2-2 修复：校验分享过期时间
    if (s.expires_at && new Date(s.expires_at + 'Z') < new Date()) throw new Error('分享已过期');
    if (s.max_downloads !== null && s.download_count >= s.max_downloads) throw new Error('下载次数已用完');
    getDb().prepare('UPDATE shares SET download_count = download_count + 1 WHERE id = ?').run(s.id);
    const driver = getDriver(getDb().prepare('SELECT * FROM storages WHERE id = ?').get(s.storage_id) as any);
    const real = await this.resolvePublicPath(s, driver, path || s.path);
    const stream = await driver.download(real);
    return { stream, name: real.split('/').filter(Boolean).pop() || 'download' };
  },
};
