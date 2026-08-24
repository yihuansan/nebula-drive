import { getDb } from '../db/index.js';

/**
 * 文件注释服务：给文件加备注/注释。
 */
export const commentService = {
  list(storageId: number, filePath: string) {
    const db = getDb();
    return db
      .prepare('SELECT * FROM file_comments WHERE storage_id = ? AND path = ? ORDER BY created_at DESC')
      .all(storageId, filePath) as any[];
  },

  add(storageId: number, filePath: string, userId: number, username: string, content: string) {
    const db = getDb();
    db.prepare('INSERT INTO file_comments (storage_id, path, user_id, username, content) VALUES (?, ?, ?, ?, ?)')
      .run(storageId, filePath, userId, username, content.trim());
  },

  remove(id: number) {
    const db = getDb();
    db.prepare('DELETE FROM file_comments WHERE id = ?').run(id);
  },

  byId(id: number) {
    const db = getDb();
    return db.prepare('SELECT * FROM file_comments WHERE id = ?').get(id) as any;
  },
};
