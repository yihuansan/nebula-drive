#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { watch } from 'chokidar';
import { State, normalizeUrl, type Pair } from './state.js';
import { SyncClient } from './client.js';
import { SyncEngine, type SyncReport } from './engine.js';

const program = new Command();
program
  .name('nebula-sync')
  .description('NebulaDrive 星云网盘 - 文件同步引擎')
  .version('0.1.0')
  .option('--state-dir <dir>', '状态目录（默认 ~/.nebula-sync）');

function getState(): State {
  const opts = program.opts<{ stateDir?: string }>();
  return new State(opts.stateDir);
}

function fmtRep(rep: SyncReport): string {
  const parts = [
    `拉取 ${rep.pulled}`,
    `推送 ${rep.pushed}`,
    `本地删除 ${rep.deletedLocal}`,
    `远端删除 ${rep.deletedRemote}`,
    `冲突 ${rep.conflicts}`,
    `无变化 ${rep.unchanged}`,
  ];
  const s = parts.join(' | ');
  return rep.errors.length ? `${s} | 错误 ${rep.errors.length}` : s;
}

program
  .command('login <url> <username> [password]')
  .description('登录服务器并保存令牌（用于 create-pair）')
  .option('--url <url>', '（占位，兼容写法）')
  .action(async (url: string, username: string, password?: string) => {
    // S1: 密码优先读环境变量 NEBULA_PASSWORD（桌面端为避免 argv 明文），fallback 到位置参数
    const pwd = process.env.NEBULA_PASSWORD || password;
    if (!pwd) {
      console.error('缺少密码：请通过位置参数指定，或设置环境变量 NEBULA_PASSWORD');
      process.exitCode = 1;
      return;
    }
    const st = getState();
    const u = normalizeUrl(url);
    const r = await fetch(`${u}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: pwd }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`登录失败: ${j.error || `HTTP ${r.status}`}`);
      process.exitCode = 1;
      return;
    }
    st.saveAuth(u, { token: j.data.token, username, savedAt: new Date().toISOString() });
    console.log(`已登录 ${u}（用户 ${username}），令牌已保存`);
  });

program
  .command('create-pair')
  .description('在服务器创建同步对并返回令牌')
  .requiredOption('--storage-id <id>', '存储 ID')
  .requiredOption('--remote-path <path>', '远端目录，如 / 或 /sync')
  .option('--mode <mode>', 'push | pull | two-way', 'two-way')
  .option('--name <name>', '同步对名称')
  .option('--local-path <path>', '记录在服务器上的本地路径（可选）')
  .option('--url <url>', '服务器地址（默认用已登录的唯一服务器）')
  .option('--json', '以 JSON 输出（供桌面端等程序调用）')
  .action(async (opts) => {
    const st = getState();
    const auth = st.authFor(opts.url);
    if (!auth) {
      console.error('未登录，请先执行: nebula-sync login <url> <username> <password>');
      process.exitCode = 1;
      return;
    }
    const mode = (opts.mode || 'two-way') as 'push' | 'pull' | 'two-way';
    const r = await fetch(`${auth.url}/api/v1/sync/pairs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.entry.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storageId: Number(opts.storageId),
        remotePath: opts.remotePath,
        mode,
        localPath: opts.localPath,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`创建失败: ${j.error || `HTTP ${r.status}`}`);
      process.exitCode = 1;
      return;
    }
    const pair = j.data.pair as { id: number; token: string; remote_path: string; mode: string; storage_id: number };
    if (opts.json) {
      console.log(JSON.stringify({ pair }));
      return;
    }
    console.log(`同步对已创建: id=${pair.id} 远端=${pair.remote_path} 模式=${pair.mode}`);
    console.log(`令牌: ${pair.token}`);
    console.log(`\n下一步: nebula-sync add <名称> --token ${pair.token} --dir <本地目录> --mode ${mode} --url ${auth.url}`);
  });

program
  .command('add <name>')
  .description('注册一个本地同步任务')
  .option('--token <token>', '同步对令牌（create-pair 返回；也可通过环境变量 NEBULA_TOKEN 传入）')
  .requiredOption('--dir <dir>', '本地同步目录')
  .option('--mode <mode>', 'push | pull | two-way', 'two-way')
  .option('--url <url>', '服务器地址（默认用已登录的唯一服务器）')
  .action(async (name: string, opts) => {
    const st = getState();
    // S2: token 优先读环境变量 NEBULA_TOKEN（桌面端为避免 argv 明文），fallback 到 --token
    const token = process.env.NEBULA_TOKEN || opts.token;
    if (!token) {
      console.error('缺少同步令牌：请通过 --token 指定，或设置环境变量 NEBULA_TOKEN');
      process.exitCode = 1;
      return;
    }
    const auth = st.authFor(opts.url);
    const url = opts.url ? normalizeUrl(opts.url) : auth?.url;
    if (!url) {
      console.error('缺少服务器地址：请通过 --url 指定或先 login');
      process.exitCode = 1;
      return;
    }
    const client = new SyncClient(url, token);
    try {
      await client.ping();
    } catch (e) {
      console.error(`令牌无效: ${(e as Error).message}`);
      process.exitCode = 1;
      return;
    }
    const dir = path.resolve(opts.dir);
    const id = st.addPair(name, url, token, dir, (opts.mode || 'two-way') as Pair['mode']);
    console.log(`已添加同步任务 #${id} ${name} -> ${dir}`);
  });

program
  .command('list')
  .description('列出本地同步任务')
  .option('--json', '以 JSON 输出（供桌面端等程序调用）')
  .action((opts) => {
    const st = getState();
    const pairs = st.listPairs();
    if (opts.json) {
      console.log(JSON.stringify({ pairs }));
      return;
    }
    if (!pairs.length) {
      console.log('（无同步任务）');
      return;
    }
    for (const p of pairs) {
      console.log(`#${p.id}  ${p.name}  [${p.mode}]  ${p.url}  ${p.localDir}`);
    }
  });

program
  .command('remove <id>')
  .description('删除本地同步任务（不影响服务器同步对）')
  .action((id: string) => {
    const st = getState();
    st.removePair(Number(id));
    console.log(`已删除任务 #${id}`);
  });

program
  .command('sync')
  .description('执行同步（可 --watch 常驻监听）')
  .option('--pair <id>', '只同步指定任务')
  .option('--watch', '常驻：监听本地变更并周期性全量同步')
  .option('--interval <sec>', 'watch 模式全量同步间隔（秒）', '60')
  .action(async (opts) => {
    const st = getState();
    let pairs = st.listPairs().filter((p) => p.enabled);
    if (opts.pair) pairs = pairs.filter((p) => p.id === Number(opts.pair));
    if (!pairs.length) {
      console.error('没有可同步的任务，请先 login / create-pair / add');
      process.exitCode = 1;
      return;
    }

    const running = new Set<number>();
    const runPair = async (p: Pair): Promise<void> => {
      if (running.has(p.id)) return;
      running.add(p.id);
      try {
        const client = new SyncClient(p.url, p.token);
        const engine = new SyncEngine(st, client, p);
        const rep = await engine.run();
        const status = rep.errors.length ? 'error' : 'ok';
        st.saveResult(p.id, status, rep.errors.slice(0, 3).join('; ') || null, fmtRep(rep));
        console.log(`[${new Date().toISOString()}] #${p.id} ${p.name}: ${fmtRep(rep)}`);
        for (const e of rep.errors) console.error(`  ! ${e}`);
      } catch (e) {
        st.saveResult(p.id, 'error', (e as Error).message, null);
        console.error(`[${new Date().toISOString()}] #${p.id} ${p.name} 同步失败: ${(e as Error).message}`);
      } finally {
        running.delete(p.id);
      }
    };

    await Promise.all(pairs.map((p) => runPair(p)));

    if (!opts.watch) return;

    console.log(`watch 模式已启动（间隔 ${opts.interval}s，Ctrl+C 退出）`);
    const timers = new Map<number, NodeJS.Timeout>();
    const watchers: Array<ReturnType<typeof watch>> = [];
    for (const p of pairs) {
      fs.mkdirSync(p.localDir, { recursive: true });
      const w = watch(p.localDir, { ignoreInitial: true, depth: 10 });
      const bump = (): void => {
        const t = timers.get(p.id);
        if (t) clearTimeout(t);
        timers.set(p.id, setTimeout(() => void runPair(p), 2000));
      };
      w.on('add', bump).on('change', bump).on('unlink', bump).on('unlinkDir', bump).on('addDir', bump);
      watchers.push(w);
    }
    const iv = setInterval(() => {
      for (const p of pairs) void runPair(p);
    }, Math.max(10, Number(opts.interval) || 60) * 1000);

    const shutdown = (): void => {
      console.log('\n正在退出…');
      clearInterval(iv);
      for (const t of timers.values()) clearTimeout(t);
      for (const w of watchers) void w.close();
      st.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program
  .command('status')
  .description('查看各任务最近同步状态')
  .option('--json', '以 JSON 输出（供桌面端等程序调用）')
  .action((opts) => {
    const st = getState();
    const rows = st.loadResults();
    if (opts.json) {
      console.log(JSON.stringify({ results: rows }));
      return;
    }
    if (!rows.length) {
      console.log('（无同步任务）');
      return;
    }
    for (const r of rows) {
      console.log(`#${r.pairId} ${r.name}: ${r.lastStatus ?? '从未同步'}${r.lastSyncAt ? ` @ ${r.lastSyncAt}` : ''}`);
      if (r.lastStats) console.log(`   ${r.lastStats}`);
      if (r.lastError) console.log(`   错误: ${r.lastError}`);
    }
  });

program.parseAsync(process.argv).catch((e) => {
  console.error('执行失败:', e?.message || e);
  process.exit(1);
});
