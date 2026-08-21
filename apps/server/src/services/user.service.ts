import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword } from '../auth/password.js';

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
