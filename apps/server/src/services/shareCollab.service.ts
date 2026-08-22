import { getDb } from '../db/index.js';
import { opLog } from './log.service.js';

export interface SharedItem {
  id: number;
  storage_id: number;
  path: string;
  name: string;
  is_dir: number;
  created_by: number;
  expires_at: string | null;
  created_at: string;
}

export interface ShareRecipient {
  id: number;
  share_id: number;
  user_id: number;
  permission: 'view' | 'download' | 'manage';
  created_at: string;
}

export interface ShareActivity {
  id: number;
  share_id: number;
  user_id: number;
  action: 'view' | 'download' | 'transfer';
  path: string | null;
  created_at: string;
}

export const shareCollabService = {
  /** 创建共享项（共享给多个用户） */
  create(params: {
    storageId: number;
    path: string;
    name: string;
    isDir: boolean;
    userIds: number[];
    permission: 'view' | 'download' | 'manage';
    expiresAt?: string | null;
    createdBy: number;
  }) {
    const db = getDb();
    const info = db
      .prepare(
        `INSERT INTO shared_items (storage_id, path, name, is_dir, created_by, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.storageId,
        params.path,
        params.name,
        params.isDir ? 1 : 0,
        params.createdBy,
        params.expiresAt || null,
      );
    const shareId = Number(info.lastInsertRowid);

    // 添加接收者
    const insertRecipient = db.prepare(
      `INSERT OR IGNORE INTO share_recipients (share_id, user_id, permission) VALUES (?, ?, ?)`,
    );
    for (const uid of params.userIds) {
      insertRecipient.run(shareId, uid, params.permission);
    }

    opLog(params.createdBy, params.path, 'share_collab_create', params.path);
    return this.byId(shareId)!;
  },

  /** 获取共享项详情 */
  byId(id: number): SharedItem | null {
    return (
      (getDb().prepare('SELECT * FROM shared_items WHERE id = ?').get(id) as unknown as SharedItem | undefined) || null
    );
  },

  /** 列出我创建的共享 */
  listByCreator(userId: number) {
    return getDb()
      .prepare('SELECT * FROM shared_items WHERE created_by = ? ORDER BY id DESC')
      .all(userId) as unknown as SharedItem[];
  },

  /** 列出共享给我的 */
  listByRecipient(userId: number) {
    return getDb()
      .prepare(
        `SELECT si.* FROM shared_items si
         JOIN share_recipients sr ON sr.share_id = si.id
         WHERE sr.user_id = ?
         ORDER BY si.id DESC`,
      )
      .all(userId) as unknown as SharedItem[];
  },

  /** 获取共享的接收者列表 */
  getRecipients(shareId: number): (ShareRecipient & { username: string; display_name: string })[] {
    return getDb()
      .prepare(
        `SELECT sr.*, u.username, u.display_name
         FROM share_recipients sr
         JOIN users u ON u.id = sr.user_id
         WHERE sr.share_id = ?
         ORDER BY sr.created_at`,
      )
      .all(shareId) as any[];
  },

  /** 添加接收者 */
  addRecipient(shareId: number, userId: number, permission: 'view' | 'download' | 'manage') {
    getDb()
      .prepare(`INSERT OR IGNORE INTO share_recipients (share_id, user_id, permission) VALUES (?, ?, ?)`)
      .run(shareId, userId, permission);
  },

  /** 移除接收者 */
  removeRecipient(shareId: number, userId: number) {
    getDb().prepare('DELETE FROM share_recipients WHERE share_id = ? AND user_id = ?').run(shareId, userId);
  },

  /** 更新接收者权限 */
  updateRecipientPermission(shareId: number, userId: number, permission: 'view' | 'download' | 'manage') {
    getDb()
      .prepare('UPDATE share_recipients SET permission = ? WHERE share_id = ? AND user_id = ?')
      .run(permission, shareId, userId);
  },

  /** 删除共享项 */
  remove(shareId: number) {
    const db = getDb();
    db.prepare('DELETE FROM share_recipients WHERE share_id = ?').run(shareId);
    db.prepare('DELETE FROM share_activity WHERE share_id = ?').run(shareId);
    db.prepare('DELETE FROM shared_items WHERE id = ?').run(shareId);
  },

  /** 更新共享项 */
  update(shareId: number, patch: { name?: string; expiresAt?: string | null }) {
    const s = this.byId(shareId);
    if (!s) throw new Error('共享不存在');
    getDb()
      .prepare('UPDATE shared_items SET name = ?, expires_at = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(
        patch.name ?? s.name,
        patch.expiresAt !== undefined ? (patch.expiresAt || null) : s.expires_at,
        shareId,
      );
    return this.byId(shareId);
  },

  /** 检查用户是否有权限访问共享项 */
  hasPermission(shareId: number, userId: number): 'view' | 'download' | 'manage' | null {
    const row = getDb()
      .prepare('SELECT permission FROM share_recipients WHERE share_id = ? AND user_id = ?')
      .get(shareId, userId) as any;
    if (!row) return null;
    // 检查是否过期
    const s = this.byId(shareId);
    if (s?.expires_at && new Date(s.expires_at + 'Z') < new Date()) return null;
    return row.permission;
  },

  /** 记录活动 */
  recordActivity(shareId: number, userId: number, action: 'view' | 'download' | 'transfer', path?: string) {
    getDb()
      .prepare('INSERT INTO share_activity (share_id, user_id, action, path) VALUES (?, ?, ?, ?)')
      .run(shareId, userId, action, path || null);
  },

  /** 获取活动记录 */
  getActivity(shareId: number, limit = 50): (ShareActivity & { username: string })[] {
    return getDb()
      .prepare(
        `SELECT sa.*, u.username FROM share_activity sa
         JOIN users u ON u.id = sa.user_id
         WHERE sa.share_id = ?
         ORDER BY sa.created_at DESC
         LIMIT ?`,
      )
      .all(shareId, limit) as any[];
  },

  /** 获取所有用户列表（用于选择共享对象） */
  getAllUsers() {
    return getDb()
      .prepare("SELECT id, username, display_name, role FROM users WHERE status = 'active' ORDER BY id")
      .all() as any[];
  },
};
