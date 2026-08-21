import { FastifyInstance } from 'fastify';
import { ok, fail, requirePermission } from '../auth/middleware';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';

// 获取 GitHub Token（优先环境变量，其次 data/.github-token 文件）
function getGithubToken(): string {
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) return envToken;
  try {
    const tokenFile = path.join(process.cwd(), 'data', '.github-token');
    if (fs.existsSync(tokenFile)) {
      const t = fs.readFileSync(tokenFile, 'utf-8').trim();
      if (t) return t;
    }
  } catch { /* ignore */ }
  return '';
}

// 从 package.json 读取当前版本
function getCurrentVersion(): string {
  try {
    // 使用 process.argv[1] 定位主脚本，向上查找 package.json
    const scriptDir = path.dirname(process.argv[1] || '');
    const candidates = [
      path.join(scriptDir, '..', 'package.json'), // dist/ -> server/
      path.join(scriptDir, '..', '..', 'package.json'), // dist/ -> apps/
      path.join(scriptDir, '..', '..', '..', 'package.json'), // dist/ -> root
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const pkg = JSON.parse(raw.replace(/^\uFEFF/, ''));
        if (pkg.version) return pkg.version;
      }
    }
  } catch {
    /* 忽略 */
  }
  return '0.1.0'; // 默认版本
}

/**
 * 在线更新检查路由
 * 从 GitHub Releases 检查最新版本
 */
// 缓存：避免频繁请求 GitHub API（1 小时 TTL）
let updateCache: { data: any; time: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 小时

export async function updateRoutes(app: FastifyInstance) {
  /**
   * 检查是否有新版本
   * GET /api/v1/system/check-update
   */
  app.get('/system/check-update', { preHandler: requirePermission('settings:view') }, async (req, reply) => {
    // 检查缓存
    if (updateCache && Date.now() - updateCache.time < CACHE_TTL) {
      return ok(reply, updateCache.data);
    }
    
    try {
      // 从 GitHub API 获取最新 release（使用 Token 认证，避免 60/h 限流）
      const token = getGithubToken();
      const headers: Record<string, string> = {
        'User-Agent': 'NebulaDrive',
        'Accept': 'application/vnd.github.v3+json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('https://api.github.com/repos/yihuansan/nebula-drive/releases/latest', {
        headers,
      });
      
      // 404 = 还没有创建任何 release
      if (res.status === 404) {
        const currentVersion = getCurrentVersion();
        return ok(reply, {
          currentVersion,
          latestVersion: currentVersion,
          isUpdateAvailable: false,
          message: 'GitHub 上还没有发布版本，当前已是最新',
        });
      }
      
      if (!res.ok) {
        return fail(reply, 500, '无法连接 GitHub，请检查网络');
      }
      
      const latest = await res.json();
      
      // 获取当前版本（从 package.json 读取）
      const currentVersion = getCurrentVersion();
      const latestVersion = latest.tag_name?.replace(/^v/, '') || latest.version || 'unknown';
      
      // 比较版本
      const isUpdateAvailable = compareVersions(currentVersion, latestVersion) < 0;
      
      const result = {
        currentVersion,
        latestVersion,
        isUpdateAvailable,
        releaseNotes: latest.body || '',
        publishedAt: latest.published_at,
        downloadUrl: latest.html_url,
      };
      
      // 更新缓存
      updateCache = { data: result, time: Date.now() };
      
      return ok(reply, result);
    } catch (e: any) {
      return fail(reply, 500, e.message || '检查更新失败');
    }
  });

  /**
   * 执行在线更新
   * POST /api/v1/system/perform-update
   */
  app.post('/system/perform-update', { preHandler: requirePermission('settings:view') }, async (_req, reply) => {
    const log = (msg: string) => {
      const line = `[UPDATE ${new Date().toISOString()}] ${msg}`;
      console.log(line);
      try { fs.appendFileSync(path.join(process.cwd(), 'update_debug.log'), line + '\n'); } catch { /* ignore */ }
    };

    try {
      log('=== 开始在线更新 ===');

      // 1. 获取最新 release 信息
      log('1. 获取最新版本信息...');
      const res = await fetch('https://api.github.com/repos/yihuansan/nebula-drive/releases/latest', {
        headers: {
          'User-Agent': 'NebulaDrive',
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      if (!res.ok) {
        log(`ERROR: GitHub API 返回 ${res.status}`);
        return fail(reply, 500, '无法获取最新版本信息');
      }
      const latest = await res.json();
      log(`最新版本: ${latest.tag_name}`);

      // 2. 下载版本包
      const asset = latest.assets?.[0];
      if (!asset) {
        log('ERROR: 最新版本没有可用的安装包');
        return fail(reply, 500, '最新版本没有可用的安装包');
      }

      const tmpDir = path.join(process.cwd(), 'tmp_update');
      fs.mkdirSync(tmpDir, { recursive: true });
      const zipPath = path.join(tmpDir, 'update.zip');

      log('2. 下载版本包...');
      const zipRes = await fetch(asset.browser_download_url, {
        headers: { 'User-Agent': 'NebulaDrive' },
      });
      if (!zipRes.ok) {
        log(`ERROR: 下载失败 ${zipRes.status}`);
        return fail(reply, 500, '下载版本包失败');
      }

      const buffer = await zipRes.arrayBuffer();
      fs.writeFileSync(zipPath, Buffer.from(buffer));
      log(`下载完成: ${buffer.byteLength} bytes`);

      // 3. 解压
      const extractDir = path.join(tmpDir, 'extracted');
      fs.mkdirSync(extractDir, { recursive: true });

      log('3. 解压版本包...');
      let extractError = '';
      try {
        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`, { timeout: 60000 });
      } catch (e: any) {
        extractError = e.message;
        try {
          execSync(`tar -xf "${zipPath}" -C "${extractDir}"`, { timeout: 60000 });
        } catch (e2: any) {
          extractError += ' | ' + e2.message;
        }
      }

      const extractedFiles = fs.existsSync(extractDir) ? fs.readdirSync(extractDir) : [];
      log(`解压完成: [${extractedFiles.join(', ')}] (error: ${extractError || 'none'})`);

      // 4. 查找版本包目录
      const serverPkgDir = path.join(extractDir, 'server');
      const webPkgDir = path.join(extractDir, 'web');
      const distPkgDir = path.join(extractDir, 'dist');

      if (!fs.existsSync(serverPkgDir) && !fs.existsSync(distPkgDir)) {
        log('ERROR: 版本包格式错误');
        return fail(reply, 500, `版本包格式错误：未找到 server/、web/ 或 dist/ 目录。已解压内容: ${extractedFiles.join(', ')}`);
      }

      // 5. 确定新版本号（直接用 tag_name，不依赖包内 package.json）
      const newVersion = latest.tag_name?.replace(/^v/, '') || latest.version || '';
      log(`新版本号: ${newVersion}`);

      // 6. 生成 Node.js 重启脚本（先停服务器 → 替换文件 → 更新版本 → 启动新服务器）
      const scriptPath = path.join(tmpDir, 'restart.mjs');
      const serverDist = path.join(process.cwd(), 'dist');
      const webDist = path.join(process.cwd(), '..', 'web', 'dist');
      const serverPkgPath = path.join(process.cwd(), 'package.json');
      const rootPkgPath = path.join(process.cwd(), '..', '..', 'package.json'); // 修复：root 是 ../../package.json

      let script = `
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const logFile = ${JSON.stringify(path.join(process.cwd(), 'update_debug.log'))};
const log = (msg) => {
  const line = \`[RESTART \${new Date().toISOString()}] \${msg}\`;
  console.log(line);
  try { fs.appendFileSync(logFile, line + '\\n'); } catch {}
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

log('=== 重启脚本开始 ===');
log('等待 2 秒让 HTTP 响应完成...');
await sleep(2000);

// 停止当前服务器
const serverPid = ${process.pid};
log(\`停止当前服务器 (PID: \${serverPid})...\`);
try {
  process.kill(serverPid, 'SIGTERM');
  log('服务器已停止');
} catch (e) {
  log('停止失败: ' + e.message);
}
await sleep(1000);

// 替换文件
log('替换文件...');
`;

      if (fs.existsSync(serverPkgDir) && fs.existsSync(webPkgDir)) {
        script += `
try {
  fs.rmSync(${JSON.stringify(serverDist)}, { recursive: true, force: true });
  log('已删除旧 server dist');
  fs.cpSync(${JSON.stringify(serverPkgDir)}, ${JSON.stringify(serverDist)}, { recursive: true });
  log('已复制新 server dist');
  fs.rmSync(${JSON.stringify(webDist)}, { recursive: true, force: true });
  log('已删除旧 web dist');
  fs.cpSync(${JSON.stringify(webPkgDir)}, ${JSON.stringify(webDist)}, { recursive: true });
  log('已复制新 web dist');
} catch (e) {
  log('文件替换失败: ' + e.message);
}
`;
      } else {
        script += `
try {
  fs.rmSync(${JSON.stringify(serverDist)}, { recursive: true, force: true });
  log('已删除旧 dist');
  fs.cpSync(${JSON.stringify(distPkgDir)}, ${JSON.stringify(serverDist)}, { recursive: true });
  log('已复制新 dist');
} catch (e) {
  log('文件替换失败: ' + e.message);
}
`;
      }

      if (newVersion) {
        script += `
log('更新版本号到 ${newVersion}...');
const readPkg = (p) => {
  const raw = fs.readFileSync(p, 'utf-8');
  return JSON.parse(raw.replace(/^\\uFEFF/, ''));
};
try {
  const pkg = readPkg(${JSON.stringify(serverPkgPath)});
  pkg.version = '${newVersion}';
  fs.writeFileSync(${JSON.stringify(serverPkgPath)}, JSON.stringify(pkg, null, 2));
  log('server package.json 已更新');
} catch (e) {
  log('更新 server package.json 失败: ' + e.message);
}
try {
  const pkg = readPkg(${JSON.stringify(rootPkgPath)});
  pkg.version = '${newVersion}';
  fs.writeFileSync(${JSON.stringify(rootPkgPath)}, JSON.stringify(pkg, null, 2));
  log('root package.json 已更新');
} catch (e) {
  log('更新 root package.json 失败: ' + e.message);
}
`;
      }

      script += `
// 启动新服务器
log('启动新服务器...');
try {
  const child = spawn(process.execPath, [${JSON.stringify(path.join(process.cwd(), 'dist', 'index.js'))}], {
    cwd: ${JSON.stringify(process.cwd())},
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  log('服务器已启动');
} catch (e) {
  log('启动服务器失败: ' + e.message);
}

// 清理临时文件
log('清理临时文件...');
try {
  fs.rmSync(${JSON.stringify(tmpDir)}, { recursive: true, force: true });
  log('临时文件已清理');
} catch (e) {
  log('清理失败: ' + e.message);
}
log('=== 重启脚本完成 ===');
`;

      fs.writeFileSync(scriptPath, script);
      log(`6. 重启脚本已生成: ${scriptPath}`);

      // 7. 执行重启脚本（用 Node.js 运行，避免 PowerShell 编码问题）
      log('7. 执行重启脚本...');
      const child = spawn(process.execPath, [scriptPath], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      child.on('error', (err) => {
        log(`ERROR: spawn failed: ${err.message}`);
      });

      log('=== 更新已启动，服务器将在几秒后重启 ===');

      return ok(reply, { message: '更新成功，服务器即将重启' });
    } catch (e: any) {
      log(`ERROR: ${e.message}`);
      return fail(reply, 500, e.message || '更新失败');
    }
  });

  /**
   * 获取更新日志
   * GET /api/v1/system/update-log
   */
  app.get('/system/update-log', { preHandler: requirePermission('settings:view') }, async (req, reply) => {
    try {
      const res = await fetch('https://api.github.com/repos/yihuansan/nebula-drive/releases?per_page=5', {
        headers: {
          'User-Agent': 'NebulaDrive',
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      
      if (!res.ok) {
        return fail(reply, 500, '无法获取更新日志');
      }
      
      const releases = await res.json();
      return ok(reply, {
        releases: releases.map((r: any) => ({
          version: r.tag_name?.replace(/^v/, '') || 'unknown',
          name: r.name,
          notes: r.body,
          publishedAt: r.published_at,
        })),
      });
    } catch (e: any) {
      return fail(reply, 500, e.message || '获取更新日志失败');
    }
  });
}

/**
 * 比较版本号
 * 返回 <0 表示 a < b, 0 表示相等, >0 表示 a > b
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}
