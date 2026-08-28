import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

export interface Pair {
  id: number;
  name: string;
  url: string;
  token: string;
  localDir: string;
  mode: 'push' | 'pull' | 'two-way';
  enabled: number;
  createdAt: string;
}

export interface FileState {
  size: number;
  mtime: number;
  hash?: string;
}

export interface AuthEntry {
  token: string;
  username: string;
  savedAt: string;
}

export interface SyncResult {
  pairId: number;
  name: string;
  lastSyncAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastStats: string | null;
}

function defaultStateDir(): string {
  return path.join(os.homedir(), '.nebula-sync');
}

export class State {
  readonly dir: string;
  private db: DatabaseSync;

  constructor(stateDir?: string) {
    this.dir = stateDir || defaultStateDir();
    fs.mkdirSync(this.dir, { recursive: true });
    this.db = new DatabaseSync(path.join(this.dir, 'nebula-sync.db'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pairs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        token TEXT NOT NULL,
        local_dir TEXT NOT NULL,
        mode TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS manifest (
        pair_id INTEGER NOT NULL,
        rel_path TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        hash TEXT,
        PRIMARY KEY (pair_id, rel_path)
      );
      CREATE TABLE IF NOT EXISTS sync_state (
        pair_id INTEGER PRIMARY KEY,
        last_sync_at TEXT,
        last_status TEXT,
        last_error TEXT,
        last_stats TEXT
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  // ---------- 登录凭据 ----------
  private authFile(): string {
    return path.join(this.dir, 'auth.json');
  }

  loadAuth(): Record<string, AuthEntry> {
    try {
      return JSON.parse(fs.readFileSync(this.authFile(), 'utf8')) as Record<string, AuthEntry>;
    } catch {
      return {};
    }
  }

  saveAuth(url: string, entry: AuthEntry): void {
    const all = this.loadAuth();
    all[url] = entry;
    fs.writeFileSync(this.authFile(), JSON.stringify(all, null, 2));
  }

  authFor(url?: string): { url: string; entry: AuthEntry } | undefined {
    const all = this.loadAuth();
    if (url) {
      const u = normalizeUrl(url);
      const e = all[u];
      return e ? { url: u, entry: e } : undefined;
    }
    const keys = Object.keys(all);
    if (keys.length === 1) return { url: keys[0], entry: all[keys[0]] };
    if (keys.length > 1) throw new Error('存在多个登录服务器，请通过 --url 指定');
    return undefined;
  }

  // ---------- 同步对 ----------
  addPair(name: string, url: string, token: string, localDir: string, mode: 'push' | 'pull' | 'two-way'): number {
    const info = this.db
      .prepare('INSERT INTO pairs (name, url, token, local_dir, mode) VALUES (?, ?, ?, ?, ?)')
      .run(name, normalizeUrl(url), token, localDir, mode);
    return Number(info.lastInsertRowid);
  }

  listPairs(): Pair[] {
    const rows = this.db.prepare('SELECT * FROM pairs ORDER BY id').all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as number,
      name: r.name as string,
      url: r.url as string,
      token: r.token as string,
      localDir: r.local_dir as string,
      mode: r.mode as 'push' | 'pull' | 'two-way',
      enabled: r.enabled as number,
      createdAt: r.created_at as string,
    }));
  }

  getPair(id: number): Pair | undefined {
    const r = this.db.prepare('SELECT * FROM pairs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      id: r.id as number,
      name: r.name as string,
      url: r.url as string,
      token: r.token as string,
      localDir: r.local_dir as string,
      mode: r.mode as 'push' | 'pull' | 'two-way',
      enabled: r.enabled as number,
      createdAt: r.created_at as string,
    };
  }

  removePair(id: number): void {
    this.db.prepare('DELETE FROM manifest WHERE pair_id = ?').run(id);
    this.db.prepare('DELETE FROM sync_state WHERE pair_id = ?').run(id);
    this.db.prepare('DELETE FROM pairs WHERE id = ?').run(id);
  }

  // ---------- 本地清单基线 ----------
  loadBase(pairId: number): Map<string, FileState> {
    const rows = this.db
      .prepare('SELECT rel_path, size, mtime, hash FROM manifest WHERE pair_id = ?')
      .all(pairId) as Array<{ rel_path: string; size: number; mtime: number; hash: string | null }>;
    const m = new Map<string, FileState>();
    for (const r of rows) m.set(r.rel_path, { size: r.size, mtime: r.mtime, hash: r.hash ?? undefined });
    return m;
  }

  saveBase(pairId: number, base: Map<string, FileState>): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM manifest WHERE pair_id = ?').run(pairId);
      const ins = this.db.prepare('INSERT OR REPLACE INTO manifest (pair_id, rel_path, size, mtime, hash) VALUES (?, ?, ?, ?, ?)');
      for (const [rel, s] of base) {
        ins.run(pairId, rel, s.size, s.mtime, s.hash ?? null);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- 同步结果 ----------
  saveResult(pairId: number, status: string, error: string | null, stats: string): void {
    this.db
      .prepare(
        `INSERT INTO sync_state (pair_id, last_sync_at, last_status, last_error, last_stats)
         VALUES (?, datetime('now'), ?, ?, ?)
         ON CONFLICT(pair_id) DO UPDATE SET last_sync_at = excluded.last_sync_at, last_status = excluded.last_status, last_error = excluded.last_error, last_stats = excluded.last_stats`,
      )
      .run(pairId, status, error, stats);
  }

  loadResults(): SyncResult[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.name, s.last_sync_at, s.last_status, s.last_error, s.last_stats
         FROM pairs p LEFT JOIN sync_state s ON s.pair_id = p.id ORDER BY p.id`,
      )
      .all() as Array<{ id: number; name: string; last_sync_at: string | null; last_status: string | null; last_error: string | null; last_stats: string | null }>;
    return rows.map((r) => ({
      pairId: r.id,
      name: r.name,
      lastSyncAt: r.last_sync_at,
      lastStatus: r.last_status,
      lastError: r.last_error,
      lastStats: r.last_stats,
    }));
  }
}

export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}
