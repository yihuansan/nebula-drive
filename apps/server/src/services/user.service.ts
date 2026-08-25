import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { getSessions } from './session.service.js';
import { usageCache } from './usageCache.service.js';
import { createDriver } from '../storage/registry.js';
import { decryptStorageConfig } from '../utils/crypto.js';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'user';
  display_name: string;
  quota: number;
  status: string;
  last_login_at: string | null;
  created_at: string;
}

export function publicUser(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    displayName: u.display_name,
    quota: u.quota,
    status: u.status,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
  };
}

export function seedAdmin(): void {
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  if (count === 0) {
    db.prepare(
      'INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)',
    ).run('admin', hashPassword('admin123'), 'admin', '管理员');
    console.log('[seed] 已创建默认管理员 admin / admin123（请尽快修改密码）');
  }
}

export function findByUsername(username: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) as unknown as UserRow | undefined;
}

export function findById(id: number): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined;
}

export function verifyLogin(username: string, password: string): UserRow | null {
  const u = findByUsername(username);
  if (!u) return null;
  if (!verifyPassword(password, u.password_hash)) return null;
  if (u.status !== 'active') return null;
  return u;
}

export function listUsers() {
  return getDb().prepare('SELECT * FROM users ORDER BY id').all() as unknown as UserRow[];
}

export function createUser(username: string, password: string, role: 'admin' | 'user', displayName = '', quota = 0): UserRow {
  const db = getDb();
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, role, display_name, quota) VALUES (?, ?, ?, ?, ?)',
  ).run(username, hashPassword(password), role, displayName, quota);
  return findById(Number(info.lastInsertRowid))!;
}

export function updateUser(id: number, patch: { username?: string; password?: string; role?: string; displayName?: string; quota?: number; status?: string }): void {
  const db = getDb();
  const u = findById(id);
  if (!u) throw new Error('用户不存在');
  db.prepare(
    `UPDATE users SET
       username = ?, password_hash = ?, role = ?, display_name = ?, quota = ?, status = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    patch.username || u.username,
    patch.password ? hashPassword(patch.password) : u.password_hash,
    patch.role || u.role,
    patch.displayName ?? u.display_name,
    patch.quota ?? u.quota,
    patch.status || u.status,
    id,
  );
}

export function deleteUser(id: number): void {
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function touchLogin(id: number, ip: string, ua: string, success: boolean): void {
  const db = getDb();
  db.prepare('INSERT INTO login_logs (username, ip, ua, success) VALUES (?, ?, ?, ?)').run(
    findById(id)?.username || '', ip, ua, success ? 1 : 0,
  );
  if (success) db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(id);
}

export function randomPassword(len = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

/* ============================================================
   用户管理增强：分页 / 搜索 / 筛选 / 排序 + 详情 + 统计
   ============================================================ */

export interface ListUsersOpts {
  keyword?: string;
  role?: string;
  status?: string;
  sort?: string;
  order?: string;
  page?: number;
  pageSize?: number;
}

export interface UserListRow {
  id: number;
  username: string;
  role: string;
  displayName: string;
  quota: number;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  avatar: string;
  email: string;
  online: boolean;
  lastLoginIp: string | null;
  recycleBytes: number;
}

/** 可排序字段白名单（前端 prop → 数据库列） */
const SORTABLE_COLUMNS: Record<string, string> = {
  username: 'username',
  quota: 'quota',
  lastLogin: 'last_login_at',
  createdAt: 'created_at',
};

/** 在线判定：存在 24h 内活跃的会话 */
function isOnline(lastSessionActive: string | null): boolean {
  if (!lastSessionActive) return false;
  const t = new Date(String(lastSessionActive).replace(' ', 'T') + 'Z').getTime();
  return Date.now() - t < 24 * 3600 * 1000;
}

/** 构造筛选 WHERE（keyword 匹配 用户名/昵称/邮箱，role/status 精确） */
function buildUserWhere(opts: ListUsersOpts): { sql: string; params: any[] } {
  const where: string[] = [];
  const params: any[] = [];
  const keyword = (opts.keyword || '').trim();
  if (keyword) {
    where.push("(u.username LIKE ? OR u.display_name LIKE ? OR COALESCE(p.email, '') LIKE ?)");
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  if (opts.role && ['admin', 'user'].includes(opts.role)) {
    where.push('u.role = ?');
    params.push(opts.role);
  }
  if (opts.status && ['active', 'disabled'].includes(opts.status)) {
    where.push('u.status = ?');
    params.push(opts.status);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function toListRow(r: any): UserListRow {
  return {
    id: r.id,
    username: r.username,
    role: r.role,
    displayName: r.display_name,
    quota: r.quota,
    status: r.status,
    lastLoginAt: r.last_login_at,
    createdAt: r.created_at,
    avatar: r.avatar || '',
    email: r.email || '',
    online: isOnline(r.last_session_active),
    lastLoginIp: r.last_login_ip || null,
    recycleBytes: r.recycle_bytes || 0,
  };
}

/** 富化查询（单条 SQL，子查询取 头像/邮箱/在线/最近登录IP/回收站占用，避免 N+1） */
function queryUserRows(opts: ListUsersOpts, limit: number, offset: number): any[] {
  const db = getDb();
  const { sql: whereSql, params } = buildUserWhere(opts);
  const sortCol = SORTABLE_COLUMNS[opts.sort || ''] || 'created_at';
  const order = opts.order === 'asc' ? 'ASC' : 'DESC';
  return db
    .prepare(
      `SELECT u.id, u.username, u.role, u.display_name, u.quota, u.status, u.last_login_at, u.created_at,
        p.avatar AS avatar, p.email AS email,
        (SELECT MAX(s.last_active) FROM user_sessions s WHERE s.user_id = u.id) AS last_session_active,
        (SELECT l.ip FROM login_logs l WHERE l.username = u.username
          ORDER BY l.created_at DESC, l.id DESC LIMIT 1) AS last_login_ip,
        (SELECT COALESCE(SUM(r.size), 0) FROM recycle r WHERE r.deleted_by = u.id AND r.is_dir = 0) AS recycle_bytes
      FROM users u
      LEFT JOIN user_profiles p ON p.user_id = u.id
      ${whereSql}
      ORDER BY u.${sortCol} ${order}, u.id ASC
      LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as any[];
}

/** 分页用户列表（服务端分页 + 搜索 + 筛选 + 排序） */
export function listUsersPaginated(opts: ListUsersOpts): {
  users: UserListRow[];
  total: number;
  page: number;
  pageSize: number;
} {
  const db = getDb();
  const { sql: whereSql, params } = buildUserWhere(opts);
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id ${whereSql}`)
      .get(...params) as any
  ).c;
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 20));
  const rows = queryUserRows(opts, pageSize, (page - 1) * pageSize);
  return { users: rows.map(toListRow), total, page, pageSize };
}

/** 导出用：返回所有匹配行（不受分页限制） */
export function exportUserRows(opts: ListUsersOpts): UserListRow[] {
  const rows = queryUserRows(opts, 100000, 0);
  return rows.map(toListRow);
}

/** 全局统计（整表一次聚合） */
export function getUserStats(): { total: number; admins: number; active: number; online: number } {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as any).c;
  const admins = (db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as any).c;
  const active = (db.prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'active'").get() as any).c;
  const online = (
    db
      .prepare("SELECT COUNT(DISTINCT user_id) AS c FROM user_sessions WHERE last_active >= datetime('now', '-1 day')")
      .get() as any
  ).c;
  return { total, admins, active, online };
}

/**
 * 系统总存储用量：与存储列表一致的缓存优先策略（5 分钟缓存，过期则实时计算）。
 * 架构上存储为全局（管理员管理），文件无逐用户归属，故为系统级指标。
 */
export async function getTotalStorageUsage(): Promise<{ bytes: number; files: number }> {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM storages ORDER BY sort, id').all() as any[];
  let bytes = 0;
  let files = 0;
  for (const r of rows) {
    const cached = usageCache.get(r.id);
    if (cached) {
      bytes += cached.totalBytes;
      files += cached.fileCount;
      continue;
    }
    try {
      const driver = createDriver({ ...r, config: decryptStorageConfig(JSON.parse(r.config || '{}')) });
      const usage = await driver.usage();
      usageCache.set(r.id, usage.used, usage.files);
      bytes += usage.used;
      files += usage.files;
    } catch {
      /* 单个存储用量计算失败时忽略，不影响整体 */
    }
  }
  return { bytes, files };
}

/** 用户详情：基础信息 + 资料 + 会话 + 登录记录 + 回收站占用 + 2FA */
export function getUserDetail(id: number): any | null {
  const db = getDb();
  const u = findById(id);
  if (!u) return null;
  const profile = db
    .prepare('SELECT avatar, email, bio, phone FROM user_profiles WHERE user_id = ?')
    .get(id) as any;
  const sessions = getSessions(id).map((s) => ({
    id: s.id,
    deviceName: s.device_name,
    ipAddress: s.ip_address,
    isCurrent: !!s.is_current,
    createdAt: s.created_at,
    lastActive: s.last_active,
  }));
  const logins = db
    .prepare(
      'SELECT ip, ua, success, created_at FROM login_logs WHERE username = ? ORDER BY created_at DESC, id DESC LIMIT 20',
    )
    .all(u.username) as any[];
  const recycle = db
    .prepare('SELECT COALESCE(SUM(size), 0) AS b, COUNT(*) AS c FROM recycle rc WHERE rc.deleted_by = ? AND rc.is_dir = 0')
    .get(id) as any;
  const twoFactor = db.prepare('SELECT enabled FROM user_2fa WHERE user_id = ?').get(id) as any;
  return {
    user: publicUser(u),
    profile: profile || { avatar: '', email: '', bio: '', phone: '' },
    sessions,
    logins: logins.map((l) => ({ ip: l.ip, ua: l.ua, success: !!l.success, createdAt: l.created_at })),
    recycle: { bytes: recycle.b, count: recycle.c },
    twoFactor: !!twoFactor?.enabled,
  };
}

/** 当前处于 active 状态的管理员数量（用于"最后一个管理员"锁定保护） */
export function countActiveAdmins(): number {
  return (
    getDb().prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'").get() as any
  ).c;
}
