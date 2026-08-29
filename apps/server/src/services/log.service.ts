import { getDb } from '../db/index.js';

export function opLog(userId: number | undefined, username: string | undefined, action: string, path?: string, ip?: string, ua?: string): void {
  getDb()
    .prepare('INSERT INTO op_logs (user_id, username, action, path, ip, ua) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId ?? null, username ?? null, action, path ?? null, ip ?? null, ua ?? null);
}

export function listOpLogs(page: number, size: number) {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) AS c FROM op_logs').get() as { c: number }).c;
  const rows = db
    .prepare('SELECT * FROM op_logs ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(size, (page - 1) * size);
  return { total, page, size, rows };
}

export function listLoginLogs(page: number, size: number, username?: string) {
  const db = getDb();
  if (username) {
    const total = (db.prepare('SELECT COUNT(*) AS c FROM login_logs WHERE username = ?').get(username) as { c: number }).c;
    const rows = db
      .prepare('SELECT * FROM login_logs WHERE username = ? ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(username, size, (page - 1) * size);
    return { total, page, size, rows };
  }
  const total = (db.prepare('SELECT COUNT(*) AS c FROM login_logs').get() as { c: number }).c;
  const rows = db
    .prepare('SELECT * FROM login_logs ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(size, (page - 1) * size);
  return { total, page, size, rows };
}

export function clearLogs(): void {
  getDb().prepare('DELETE FROM op_logs').run();
  getDb().prepare('DELETE FROM login_logs').run();
}

/* ---------- 导出（CSV）：全量查询，上限 5 万条防止超大表阻塞 ---------- */
const EXPORT_LIMIT = 50000;
export function allOpLogs() {
  return getDb()
    .prepare('SELECT * FROM op_logs ORDER BY id DESC LIMIT ?')
    .all(EXPORT_LIMIT) as { created_at: string; username: string | null; action: string; path: string | null; ip: string | null }[];
}
export function allLoginLogs() {
  return getDb()
    .prepare('SELECT * FROM login_logs ORDER BY id DESC LIMIT ?')
    .all(EXPORT_LIMIT) as { created_at: string; username: string; ip: string | null; ua: string | null; success: number }[];
}
