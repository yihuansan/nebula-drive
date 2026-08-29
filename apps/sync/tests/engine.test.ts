import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 内存版远端：所有 SyncClient 实例共享同一份 fake remote（模拟真实服务器状态）。
 */
const mock = vi.hoisted(() => {
  type Entry = { size: number; mtime: number };
  class FakeRemote {
    files = new Map<string, Buffer>();
    mtimes = new Map<string, number>();
    manifestError: Error | null = null;

    async manifest(): Promise<Map<string, Entry>> {
      if (this.manifestError) throw this.manifestError;
      const out = new Map<string, Entry>();
      for (const [rel, buf] of this.files) {
        out.set(rel, { size: buf.length, mtime: this.mtimes.get(rel) ?? 0 });
      }
      return out;
    }
    async pull(rel: string): Promise<Buffer> {
      const b = this.files.get(rel);
      if (!b) throw new Error('404 ' + rel);
      return b;
    }
    async push(rel: string, data: Buffer): Promise<void> {
      this.files.set(rel, Buffer.from(data));
      // 模拟远端按当前时间落盘（如本地驱动）
      this.mtimes.set(rel, Date.now());
    }
    async remove(rel: string): Promise<void> {
      this.files.delete(rel);
      this.mtimes.delete(rel);
    }
  }
  let shared: FakeRemote | null = null;
  return {
    get remote(): FakeRemote {
      if (!shared) shared = new FakeRemote();
      return shared;
    },
    reset(): void {
      shared = null;
    },
  };
});

vi.mock('../src/client.js', () => ({
  SyncClient: class {
    async manifest() { return mock.remote.manifest(); }
    async pull(rel: string) { return mock.remote.pull(rel); }
    async push(rel: string, data: Buffer) { return mock.remote.push(rel, data); }
    async remove(rel: string) { return mock.remote.remove(rel); }
    async report(_files: unknown[]) {}
    async ping() {}
  },
}));

import { SyncEngine, scanLocal } from '../src/engine.js';
import { State, type Pair } from '../src/state.js';
import { SyncClient } from '../src/client.js';

let stateDir: string;
let localDir: string;
let st: State;
const BASE = 1_000_000; // 基线 mtime（ms）

function makePair(mode: 'push' | 'pull' | 'two-way'): Pair {
  return { id: 1, name: 't', url: 'http://x', token: 't', localDir, mode, enabled: 1, createdAt: '' };
}

/** 写本地文件并显式设置 mtime（ms） */
function writeLocal(rel: string, content: string, mtimeMs = BASE): void {
  const abs = path.join(localDir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  const t = mtimeMs / 1000;
  fs.utimesSync(abs, t, t);
}

/** 设置远端文件 */
function setRemote(rel: string, content: string, mtimeMs = BASE): void {
  mock.remote.files.set(rel, Buffer.from(content));
  mock.remote.mtimes.set(rel, mtimeMs);
}

beforeEach(() => {
  mock.reset();
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-st-'));
  localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-local-'));
  st = new State(stateDir);
});

afterEach(() => {
  st.close();
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(localDir, { recursive: true, force: true });
});

/** 保存基线并执行一轮同步 */
async function runEngine(
  mode: 'push' | 'pull' | 'two-way',
  base: Map<string, { size: number; mtime: number }>,
) {
  st.saveBase(1, base);
  const engine = new SyncEngine(st, new SyncClient(), makePair(mode));
  return engine.run();
}

describe('scanLocal', () => {
  it('递归扫描并跳过系统文件', () => {
    writeLocal('a.txt', '1');
    writeLocal('sub/b.txt', '22');
    writeLocal('.DS_Store', 'x');
    writeLocal('~$tmp.docx', 'x');
    const m = scanLocal(localDir);
    expect([...m.keys()].sort()).toEqual(['a.txt', 'sub/b.txt']);
    expect(m.get('sub/b.txt')?.size).toBe(2);
  });
});

describe('push 模式（本地为准）', () => {
  it('本地新文件 → 推送；远端独有 → 忽略', async () => {
    writeLocal('new.txt', 'hello');
    const rep = await runEngine('push', new Map());
    expect(rep.pushed).toBe(1);
    expect(mock.remote.files.has('new.txt')).toBe(true);

    // 第二轮：远端独有文件在 push 模式下被忽略
    setRemote('only-remote.txt', 'rrr', BASE);
    writeLocal('keep.txt', 'kkk');
    const rep2 = await runEngine(
      'push',
      new Map([
        ['new.txt', { size: 5, mtime: BASE }],
        ['keep.txt', { size: 3, mtime: BASE }],
      ]),
    );
    expect(rep2.errors).toEqual([]);
    expect(mock.remote.files.has('only-remote.txt')).toBe(true);
  });

  it('本地删除（基线存在）→ 传播删除到远端 [回归修复]', async () => {
    setRemote('f.txt', 'remote-v1', BASE);
    const rep = await runEngine('push', new Map([['f.txt', { size: 9, mtime: BASE }]]));
    expect(rep.deletedRemote).toBe(1);
    expect(mock.remote.files.has('f.txt')).toBe(false);
  });

  it('本地修改（mtime 更新）→ 覆盖远端', async () => {
    setRemote('f.txt', 'old-remote-content', BASE);
    writeLocal('f.txt', 'new-local-content!!', BASE + 5000);
    const rep = await runEngine('push', new Map([['f.txt', { size: 8, mtime: BASE }]]));
    expect(rep.pushed).toBe(1);
    expect(mock.remote.files.get('f.txt')!.toString()).toBe('new-local-content!!');
  });
});

describe('pull 模式（远端为准）', () => {
  it('远端新文件 → 拉取到本地；本地独有 → 忽略', async () => {
    setRemote('from-remote.txt', 'data-from-remote', BASE + 1000);
    writeLocal('local-only.txt', 'ignore-me');
    const rep = await runEngine('pull', new Map());
    expect(rep.pulled).toBe(1);
    expect(fs.readFileSync(path.join(localDir, 'from-remote.txt'), 'utf8')).toBe('data-from-remote');
    expect(mock.remote.files.has('local-only.txt')).toBe(false);
  });

  it('远端删除且本地未变 → 删除本地', async () => {
    writeLocal('f.txt', 'base-content', BASE);
    const rep = await runEngine('pull', new Map([['f.txt', { size: 12, mtime: BASE }]]));
    expect(rep.deletedLocal).toBe(1);
    expect(fs.existsSync(path.join(localDir, 'f.txt'))).toBe(false);
  });
});

describe('two-way 模式', () => {
  it('任一侧新增 → 复制到另一侧', async () => {
    writeLocal('new-local.txt', 'from-local');
    setRemote('new-remote.txt', 'from-remote', BASE + 1000);
    const rep = await runEngine('two-way', new Map());
    expect(rep.pushed).toBe(1);
    expect(rep.pulled).toBe(1);
    expect(fs.readFileSync(path.join(localDir, 'new-remote.txt'), 'utf8')).toBe('from-remote');
    expect(mock.remote.files.get('new-local.txt')!.toString()).toBe('from-local');
  });

  it('冲突：mtime 更新的一侧胜出', async () => {
    setRemote('a.txt', 'remote-newer', BASE + 5000);
    writeLocal('a.txt', 'local-older', BASE);
    setRemote('b.txt', 'remote-older', BASE);
    writeLocal('b.txt', 'local-newer-content', BASE + 5000);
    const base = new Map([
      ['a.txt', { size: 1, mtime: BASE }],
      ['b.txt', { size: 1, mtime: BASE }],
    ]);
    const rep = await runEngine('two-way', base);
    expect(rep.pulled).toBe(1);
    expect(rep.pushed).toBe(1);
    expect(fs.readFileSync(path.join(localDir, 'a.txt'), 'utf8')).toBe('remote-newer');
    expect(mock.remote.files.get('b.txt')!.toString()).toBe('local-newer-content');
  });

  it('冲突：mtime 容差内 → 本地胜出，远端版本存为冲突副本', async () => {
    setRemote('c.txt', 'remote-version', BASE + 5);
    writeLocal('c.txt', 'local-version', BASE + 10);
    const base = new Map([['c.txt', { size: 1, mtime: BASE }]]);
    const rep = await runEngine('two-way', base);
    expect(rep.conflicts).toBe(1);
    const conflictFiles = fs.readdirSync(localDir).filter((f) => f.includes('(conflict'));
    expect(conflictFiles.length).toBe(1);
    expect(fs.readFileSync(path.join(localDir, conflictFiles[0]), 'utf8')).toBe('remote-version');
    // 本地版本已推送，两侧收敛
    expect(mock.remote.files.get('c.txt')!.toString()).toBe('local-version');
  });

  it('本地删除且远端未变 → 传播删除，不复活 [回归修复]', async () => {
    setRemote('d.txt', 'same-content', BASE);
    const base = new Map([['d.txt', { size: 12, mtime: BASE }]]);
    const rep = await runEngine('two-way', base);
    expect(rep.deletedRemote).toBe(1);
    expect(mock.remote.files.has('d.txt')).toBe(false);
    // 第二轮：基线已清、远端已删 → 不应拉回
    const rep2 = await runEngine('two-way', new Map());
    expect(rep2.errors).toEqual([]);
    expect(mock.remote.files.has('d.txt')).toBe(false);
    expect(fs.existsSync(path.join(localDir, 'd.txt'))).toBe(false);
  });

  it('本地删除但远端已修改 → 拉回远端版本（不丢数据）', async () => {
    setRemote('e.txt', 'modified-remotely!!', BASE + 5000);
    const base = new Map([['e.txt', { size: 1, mtime: BASE }]]);
    const rep = await runEngine('two-way', base);
    expect(rep.pulled).toBe(1);
    expect(fs.readFileSync(path.join(localDir, 'e.txt'), 'utf8')).toBe('modified-remotely!!');
  });
});

describe('健壮性', () => {
  it('manifest 失败 → 报错且不产生任何变更', async () => {
    writeLocal('x.txt', 'x');
    mock.remote.manifestError = new Error('network down');
    const rep = await runEngine('two-way', new Map());
    expect(rep.errors.some((e) => e.startsWith('manifest:'))).toBe(true);
    expect(rep.pushed + rep.pulled + rep.deletedLocal + rep.deletedRemote).toBe(0);
  });

  it('推送后远端 mtime 对齐，下轮不误判为远端修改', async () => {
    writeLocal('align.txt', 'content-align');
    const rep1 = await runEngine('two-way', new Map());
    expect(rep1.pushed).toBe(1);
    // 第二轮：本地未变、远端 mtime 已被首轮对齐 → unchanged（不重复推送）
    const st2 = new State(stateDir);
    try {
      const engine2 = new SyncEngine(st2, new SyncClient(), makePair('two-way'));
      const rep2 = await engine2.run();
      expect(rep2.errors).toEqual([]);
      expect(rep2.pushed + rep2.pulled + rep2.conflicts).toBe(0);
    } finally {
      st2.close();
    }
  });
});
