import { getDb } from '../db/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { dirs } from '../config.js';

/**
 * 文件版本服务：覆盖上传时保留旧版本，支持列表 / 恢复 / 删除版本。
 * 版本文件存放在 storage/.versions/<storageId>/<hash> 下。
 */
function validateFilePath(filePath: string): void {
  if (filePath.includes('../') || filePath.includes('..\\')) {
    throw new Error('非法路径');
  }
  const normalized = path.normalize(filePath);
  const segments = normalized.split('/').filter(Boolean);
  if (segments.includes('..')) {
    throw new Error('非法路径');
  }
}

export const versionService = {
  /** 保存一个版本（覆盖前调用） */
  save(storageId: number, filePath: string, oldPath: string, size: number, mtime: string): number {
    validateFilePath(filePath);
    const db = getDb();
    const row = db
      .prepare('SELECT MAX(version) AS v FROM file_versions WHERE storage_id = ? AND path = ?')
      .get(storageId, filePath) as { v: number | null };
    const nextVersion = (row.v || 0) + 1;
    const hash = Buffer.from(filePath).toString('hex');
    const verDir = path.join(dirs.storageRoot, '.versions', String(storageId));
    fs.mkdirSync(verDir, { recursive: true });
    const verFile = path.join(verDir, `${hash}.v${nextVersion}`);
    fs.copyFileSync(oldPath, verFile);
    db.prepare('INSERT INTO file_versions (storage_id, path, version, size, mtime, blob_path) VALUES (?, ?, ?, ?, ?, ?)')
      .run(storageId, filePath, nextVersion, size, mtime, verFile);
    return nextVersion;
  },

  /** 列出某文件的所有版本 */
  list(storageId: number, filePath: string) {
    const db = getDb();
    return db
      .prepare('SELECT * FROM file_versions WHERE storage_id = ? AND path = ? ORDER BY version DESC')
      .all(storageId, filePath) as any[];
  },

  /** 恢复某版本 */
  restore(storageId: number, filePath: string, version: number): string {
    validateFilePath(filePath);
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM file_versions WHERE storage_id = ? AND path = ? AND version = ?')
      .get(storageId, filePath, version) as any;
    if (!row) throw new Error('版本不存在');
    const storageRoot = dirs.storageRoot;
    const currentPath = path.join(storageRoot, filePath);
    const normalizedCurrent = path.normalize(currentPath);
    const normalizedRoot = path.normalize(storageRoot);
    const rootWithSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
    if (normalizedCurrent !== normalizedRoot && !normalizedCurrent.startsWith(rootWithSep)) {
      throw new Error('非法路径');
    }
    if (fs.existsSync(currentPath)) {
      const stat = fs.statSync(currentPath);
      this.save(storageId, filePath, currentPath, stat.size, new Date(stat.mtime).toISOString());
    }
    fs.copyFileSync(row.blob_path, currentPath);
    return currentPath;
  },

  /** 删除某版本 */
  remove(storageId: number, filePath: string, version: number) {
    validateFilePath(filePath);
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM file_versions WHERE storage_id = ? AND path = ? AND version = ?')
      .get(storageId, filePath, version) as any;
    if (!row) throw new Error('版本不存在');
    if (fs.existsSync(row.blob_path)) fs.unlinkSync(row.blob_path);
    db.prepare('DELETE FROM file_versions WHERE storage_id = ? AND path = ? AND version = ?')
      .run(storageId, filePath, version);
  },
};
