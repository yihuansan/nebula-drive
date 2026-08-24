import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { dirs } from '../config.js';
import { runMigrations } from './schema.js';

let db: DatabaseSync | null = null;

export type DB = DatabaseSync;

export function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(dirs.db);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    // P2-17 修复：设置 busy_timeout，避免并发写时 SQLITE_BUSY
    db.exec('PRAGMA busy_timeout = 5000;');
    runMigrations(db);
  }
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
