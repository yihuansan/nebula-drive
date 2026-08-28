import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SyncClient } from './client.js';
import { State, type FileState, type Pair } from './state.js';

export interface SyncReport {
  pairId: number;
  pulled: number;
  pushed: number;
  deletedLocal: number;
  deletedRemote: number;
  conflicts: number;
  unchanged: number;
  errors: string[];
}

const SKIP_NAMES = new Set(['.DS_Store', 'desktop.ini', 'Thumbs.db']);
const MTIME_TOL = 1000; // 1s 容差，避免不同存储驱动的时间精度差异

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function conflictName(rel: string): string {
  const i = rel.lastIndexOf('/');
  const dir = i >= 0 ? rel.slice(0, i + 1) : '';
  const name = i >= 0 ? rel.slice(i + 1) : rel;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const d = new Date();
  const ts =
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` +
    `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}` +
    `${String(d.getMilliseconds()).padStart(3, '0')}`;
  return `${dir}${stem} (conflict ${ts})${ext}`;
}

/** 递归扫描本地目录，返回 relPath(POSIX) -> {size, mtime(ms)} */
export function scanLocal(root: string): Map<string, { size: number; mtime: number }> {
  const out = new Map<string, { size: number; mtime: number }>();
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('~$') || SKIP_NAMES.has(e.name) || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = path.relative(root, full).split(path.sep).join('/');
      try {
        const st = fs.statSync(full);
        out.set(rel, { size: st.size, mtime: Math.floor(st.mtimeMs) });
      } catch {
        /* 文件可能在扫描期间消失 */
      }
    }
  };
  walk(root);
  return out;
}

export class SyncEngine {
  private base: Map<string, FileState>;
  private dirty = false;
  private pushedRels: string[] = [];

  constructor(
    private st: State,
    private client: SyncClient,
    private pair: Pair,
  ) {
    this.base = st.loadBase(pair.id);
  }

  private localAbs(rel: string): string {
    return path.join(this.pair.localDir, ...rel.split('/'));
  }

  private setBase(rel: string, size: number, mtime: number, hash?: string): void {
    this.base.set(rel, { size, mtime, hash });
    this.dirty = true;
  }

  private delBase(rel: string): void {
    this.base.delete(rel);
    this.dirty = true;
  }

  private removeLocal(rel: string): void {
    const abs = this.localAbs(rel);
    fs.rmSync(abs, { force: true });
    // 尽力清理空目录（最多 5 层）
    let dir = path.dirname(abs);
    const root = this.pair.localDir;
    for (let i = 0; i < 5; i++) {
      if (dir === root || dir === path.dirname(root)) break;
      try {
        if (fs.readdirSync(dir).length > 0) break;
        fs.rmdirSync(dir);
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
  }

  private async pullFile(rel: string, remoteMtime: number): Promise<void> {
    const dest = this.localAbs(rel);
    const tmp = `${dest}.tmp_${process.pid}_${Date.now()}`;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const buf = await this.client.pull(rel);
    try {
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      throw e;
    }
    const t = remoteMtime / 1000;
    try {
      fs.utimesSync(dest, t, t);
    } catch {
      /* utimes 失败不影响正确性 */
    }
    this.setBase(rel, buf.length, remoteMtime, sha256(buf));
  }

  private async pushFile(rel: string, localMtime: number): Promise<void> {
    const src = this.localAbs(rel);
    const buf = fs.readFileSync(src);
    await this.client.push(rel, buf);
    this.setBase(rel, buf.length, localMtime, sha256(buf));
    this.pushedRels.push(rel);
  }

  /**
   * 执行一次同步。
   * 模式语义：
   *  - push     本地为准：本地新增/修改 → 推送；本地删除 → 远端删除；远端新增忽略
   *  - pull     远端为准：远端新增/修改 → 拉取；远端删除 → 本地删除；本地新增忽略
   *  - two-way  双向合并：任一侧新增 → 复制到另一侧；冲突时 mtime 新者胜，
   *             时间相同则保留本地并将远端存为 “name (conflict YYYYMMDDHHmmss).ext”
   */
  async run(): Promise<SyncReport> {
    const rep: SyncReport = {
      pairId: this.pair.id,
      pulled: 0,
      pushed: 0,
      deletedLocal: 0,
      deletedRemote: 0,
      conflicts: 0,
      unchanged: 0,
      errors: [],
    };
    const mode = this.pair.mode;
    let remoteValidated = true;

    fs.mkdirSync(this.pair.localDir, { recursive: true });
    let remote: Map<string, { size: number; mtime: number; hash?: string }>;
    try {
      remote = await this.client.manifest();
    } catch (e) {
      rep.errors.push('manifest: ' + (e as Error).message);
      return rep;
    }
    const local = scanLocal(this.pair.localDir);
    const base = this.base;
    this.pushedRels = [];

    const all = new Set<string>([...remote.keys(), ...local.keys(), ...base.keys()]);

    for (const rel of all) {
      const L = local.get(rel);
      const R = remote.get(rel);
      const S = base.get(rel);
      try {
        if (L && R) {
          if (L.size === R.size && Math.abs(L.mtime - R.mtime) <= MTIME_TOL) {
            rep.unchanged++;
            this.setBase(rel, L.size, R.mtime, S?.hash);
            continue;
          }
          if (S && S.size === L.size && S.size === R.size && Math.abs(S.mtime - L.mtime) <= MTIME_TOL) {
            // 本地自基线以来未变化，且远端大小与基线一致（远端 mtime 漂移，如 WebDAV 精度差异）
            rep.unchanged++;
            this.setBase(rel, R.size, R.mtime, S?.hash);
            continue;
          }
          // 冲突
          if (mode === 'push') {
            await this.pushFile(rel, L.mtime);
            rep.pushed++;
          } else if (mode === 'pull') {
            await this.pullFile(rel, R.mtime);
            rep.pulled++;
          } else {
            if (R.mtime > L.mtime + MTIME_TOL) {
              await this.pullFile(rel, R.mtime);
              rep.pulled++;
            } else if (L.mtime > R.mtime + MTIME_TOL) {
              await this.pushFile(rel, L.mtime);
              rep.pushed++;
            } else {
              // 时间相同：本地胜出；远端版本存为冲突副本（不写基线，下轮作为新文件正常推送），
              // 并把本地版本推送到远端，使两侧收敛
              const cRel = conflictName(rel);
              const cAbs = this.localAbs(cRel);
              fs.mkdirSync(path.dirname(cAbs), { recursive: true });
              const buf = await this.client.pull(rel);
              fs.writeFileSync(cAbs, buf);
              await this.pushFile(rel, L.mtime);
              rep.conflicts++;
            }
          }
        } else if (L && !R) {
          if (mode === 'pull') {
            if (S && S.size === L.size && Math.abs(S.mtime - L.mtime) <= MTIME_TOL) {
              // 远端已删除且本地未变 → 同步删除本地
              this.removeLocal(rel);
              this.delBase(rel);
              rep.deletedLocal++;
            }
            // 本地新文件：pull 模式忽略
          } else if (mode === 'two-way' && S && S.size === L.size && Math.abs(S.mtime - L.mtime) <= MTIME_TOL) {
            // 远端已删除且本地未变 → 传播删除
            this.removeLocal(rel);
            this.delBase(rel);
            rep.deletedLocal++;
          } else {
            // 本地新增/修改 → 推送（push 模式下远端删除也重新推送，本地为准）
            await this.pushFile(rel, L.mtime);
            rep.pushed++;
          }
        } else if (!L && R) {
          if (mode === 'push') {
            if (S && L && S.size === L.size && Math.abs(S.mtime - L.mtime) <= MTIME_TOL) {
              // 本地已删除且该文件曾同步 → 传播删除到远端
              await this.client.remove(rel);
              this.delBase(rel);
              rep.deletedRemote++;
            }
            // 远端独有文件：push 模式忽略
          } else if (mode === 'pull') {
            await this.pullFile(rel, R.mtime);
            rep.pulled++;
          } else {
            // two-way
            if (S && S.size === R.size && Math.abs(S.mtime - R.mtime) <= MTIME_TOL) {
              // 远端自基线未变、本地已删 → 删除已传播，清除基线
              this.delBase(rel);
            } else {
              // 远端有修改而本地删除 → 保留远端版本，拉回本地
              await this.pullFile(rel, R.mtime);
              rep.pulled++;
            }
          }
        } else {
          // 两侧都不存在，仅基线残留 → 清除
          this.delBase(rel);
        }
      } catch (e) {
        rep.errors.push(`${rel}: ${(e as Error).message}`);
      }
    }

    // 推送后远端可能按当前时间落盘（如本地驱动），重新取 manifest 对齐本地 mtime，
    // 避免下轮因 mtime 漂移误判为远端修改而重复拉取
    if (this.pushedRels.length > 0) {
      try {
        const fresh = await this.client.manifest();
        for (const rel of this.pushedRels) {
          const R = fresh.get(rel);
          const L = local.get(rel);
          const S = this.base.get(rel);
          if (R && L && S && Math.abs(R.mtime - L.mtime) > MTIME_TOL) {
            const abs = this.localAbs(rel);
            const t = R.mtime / 1000;
            try {
              fs.utimesSync(abs, t, t);
            } catch {
              /* utimes 失败不影响正确性 */
            }
            this.setBase(rel, S.size, R.mtime, S.hash);
          }
        }
      } catch {
        /* 对齐失败不影响正确性，下轮会自愈 */
      }
    }

    if (this.dirty) {
      this.st.saveBase(this.pair.id, this.base);
    }
    try {
      await this.client.report(
        [...this.base.entries()].map(([rel, s]) => ({
          relPath: rel,
          hash: s.hash ?? '',
          size: s.size,
          mtime: s.mtime,
        })),
      );
    } catch (e) {
      rep.errors.push(`report: ${(e as Error).message}`);
    }
    return rep;
  }
}
