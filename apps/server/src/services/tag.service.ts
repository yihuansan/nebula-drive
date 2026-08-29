import { getDb } from '../db/index.js';

/**
 * 文件标签服务：给文件打标签，按标签筛选。
 */
export const tagService = {
  list(storageId: number, filePath: string): string[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT tag FROM file_tags WHERE storage_id = ? AND path = ? ORDER BY tag')
      .all(storageId, filePath) as any[];
    return rows.map((r) => r.tag);
  },

  add(storageId: number, filePath: string, tag: string) {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO file_tags (storage_id, path, tag) VALUES (?, ?, ?)')
      .run(storageId, filePath, tag.trim());
  },

  remove(storageId: number, filePath: string, tag: string) {
    const db = getDb();
    db.prepare('DELETE FROM file_tags WHERE storage_id = ? AND path = ? AND tag = ?')
      .run(storageId, filePath, tag);
  },

  /** 按标签列出文件（跨存储） */
  filesByTag(tag: string) {
    const db = getDb();
    return db
      .prepare('SELECT storage_id, path, tag FROM file_tags WHERE tag = ? ORDER BY path')
      .all(tag) as any[];
  },

  /** 所有标签（去重） */
  allTags() {
    const db = getDb();
    const rows = db.prepare('SELECT DISTINCT tag FROM file_tags ORDER BY tag').all() as any[];
    return rows.map((r) => r.tag);
  },

  /** 标签 → 文件数统计（标签页展示用） */
  tagCounts(): Record<string, number> {
    const db = getDb();
    const rows = db.prepare('SELECT tag, COUNT(*) AS c FROM file_tags GROUP BY tag').all() as any[];
    return Object.fromEntries(rows.map((r) => [r.tag, r.c]));
  },
};
