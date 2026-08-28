import crypto from 'node:crypto';
import { getDb } from '../db/index.js';

/**
 * 会话管理服务
 * 追踪用户登录设备，支持撤销访问（真正让 token 失效）
 */

/** 生成 token 的哈希值（不存储原始 token） */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** 记录新会话 */
export function recordSession(userId: number, token: string, deviceName: string, ip: string, userAgent: string): void {
  const db = getDb();
  const tokenHash = hashToken(token);

  // 检查是否已存在
  const existing = db.prepare('SELECT id FROM user_sessions WHERE token_hash = ?').get(tokenHash) as any;
  if (existing) {
    db.prepare('UPDATE user_sessions SET last_active = datetime(\'now\'), is_current = 1 WHERE token_hash = ?')
      .run(tokenHash);
    return;
  }

  // 清除该用户其他会话的 is_current 标记
  db.prepare('UPDATE user_sessions SET is_current = 0 WHERE user_id = ?').run(userId);

  db.prepare('INSERT INTO user_sessions (user_id, token_hash, device_name, ip_address, user_agent, is_current) VALUES (?, ?, ?, ?, ?, 1)')
    .run(userId, tokenHash, deviceName, ip, userAgent);
}

/** 获取用户的所有会话 */
export function getSessions(userId: number): any[] {
  const db = getDb();
  return db.prepare('SELECT id, token_hash, device_name, ip_address, user_agent, is_current, created_at, last_active FROM user_sessions WHERE user_id = ? ORDER BY last_active DESC').all(userId) as any[];
}

/** 撤销指定会话（使 token 失效） */
export function revokeSession(userId: number, sessionId: number, tokenExpiryHours: number): boolean {
  const db = getDb();
  const row = db.prepare('SELECT token_hash FROM user_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId) as any;
  if (!row) return false;

  // 覆盖最长有效期（默认 JWT TTL=7天），避免撤销记录先过期导致 token 复活
  const expiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
  db.prepare('INSERT OR IGNORE INTO revoked_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(row.token_hash, userId, expiresAt);

  // 删除会话记录
  db.prepare('DELETE FROM user_sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);
  return true;
}

/** 撤销所有其他会话（保留当前） */
export function revokeOtherSessions(userId: number, currentTokenHash: string, tokenExpiryHours: number): number {
  const db = getDb();
  const others = db.prepare('SELECT token_hash FROM user_sessions WHERE user_id = ? AND token_hash != ?').all(userId, currentTokenHash) as any[];
  
  // 覆盖最长有效期（默认 JWT TTL=7天），避免撤销记录先过期导致 token 复活
  const expiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
  const insert = db.prepare('INSERT OR IGNORE INTO revoked_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)');
  
  for (const s of others) {
    insert.run(s.token_hash, userId, expiresAt);
  }
  
  const result = db.prepare('DELETE FROM user_sessions WHERE user_id = ? AND token_hash != ?').run(userId, currentTokenHash);
  return Number(result.changes);
}

/** 撤销用户的全部会话（admin 强制下线）：所有 token 加入撤销列表并删除会话记录 */
export function revokeAllSessions(userId: number, tokenExpiryHours: number): number {
  const db = getDb();
  const sessions = db.prepare('SELECT token_hash FROM user_sessions WHERE user_id = ?').all(userId) as any[];
  // 覆盖最长有效期（默认 JWT TTL=7天），避免撤销记录先过期导致 token 复活
  const expiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
  const insert = db.prepare('INSERT OR IGNORE INTO revoked_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)');
  for (const s of sessions) {
    insert.run(s.token_hash, userId, expiresAt);
  }
  const result = db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
  return Number(result.changes);
}

/** 检查 token 是否已被撤销 */
export function isTokenRevoked(tokenHash: string): boolean {
  const db = getDb();
  // P2-14 修复：检查 expires_at，过期的撤销记录不再有效
  const row = db.prepare("SELECT 1 FROM revoked_tokens WHERE token_hash = ? AND expires_at > datetime('now')").get(tokenHash);
  return !!row;
}

/** 更新会话活跃时间 */
export function touchSession(tokenHash: string): void {
  const db = getDb();
  db.prepare('UPDATE user_sessions SET last_active = datetime(\'now\') WHERE token_hash = ?').run(tokenHash);
}

/** 清理过期的撤销记录和旧会话 */
export function cleanup(): { revoked: number; sessions: number } {
  const db = getDb();
  // 清理已过期的撤销记录
  const revoked = db.prepare("DELETE FROM revoked_tokens WHERE expires_at < datetime('now')").run();
  // 清理超过 30 天未活跃的会话
  const sessions = db.prepare("DELETE FROM user_sessions WHERE last_active < datetime('now', '-30 days')").run();
  return { revoked: Number(revoked.changes), sessions: Number(sessions.changes) };
}

/** 从 User-Agent 解析设备名称 */
export function parseDeviceName(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  let browser = 'Unknown';
  let os = 'Unknown';

  // 浏览器
  if (ua.includes('edg')) browser = 'Edge';
  else if (ua.includes('chrome')) browser = 'Chrome';
  else if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('safari')) browser = 'Safari';

  // 操作系统
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
  else if (ua.includes('mac') || ua.includes('os x')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';

  if (browser !== 'Unknown' && os !== 'Unknown') {
    return `${browser} on ${os}`;
  }
  return browser !== 'Unknown' ? browser : os !== 'Unknown' ? os : 'Unknown Device';
}
