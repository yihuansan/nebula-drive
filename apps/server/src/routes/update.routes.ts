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
        const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
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
    try {
      // 1. 获取最新 release 信息
      const res = await fetch('https://api.github.com/repos/yihuansan/nebula-drive/releases/latest', {
        headers: {
          'User-Agent': 'NebulaDrive',
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      if (!res.ok) {
        return fail(reply, 500, '无法获取最新版本信息');
      }
      const latest = await res.json();
      
      // 2. 下载版本包
      const asset = latest.assets?.[0];
      if (!asset) {
        return fail(reply, 500, '最新版本没有可用的安装包');
      }
      
      const tmpDir = path.join(process.cwd(), 'tmp_update');
      fs.mkdirSync(tmpDir, { recursive: true });
      const zipPath = path.join(tmpDir, 'update.zip');
      
      // 下载 zip
      const zipRes = await fetch(asset.browser_download_url, {
        headers: { 'User-Agent': 'NebulaDrive' },
      });
      if (!zipRes.ok) {
        return fail(reply, 500, '下载版本包失败');
      }
      
      const buffer = await zipRes.arrayBuffer();
      fs.writeFileSync(zipPath, Buffer.from(buffer));
      
      // 3. 解压
      const extractDir = path.join(tmpDir, 'extracted');
      fs.mkdirSync(extractDir, { recursive: true });
      
      // 使用 PowerShell 解压（Windows）
      let extractError = '';
      try {
        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`, { timeout: 60000 });
      } catch (e: any) {
        extractError = e.message;
        // 尝试 tar（Linux/Mac）
        try {
          execSync(`tar -xf "${zipPath}" -C "${extractDir}"`, { timeout: 60000 });
        } catch (e2: any) {
          extractError += ' | ' + e2.message;
        }
      }
      
      // 调试：列出解压后的内容
      const extractedFiles = fs.existsSync(extractDir) ? fs.readdirSync(extractDir) : [];
      const logMsg = `[UPDATE] Extract dir: ${extractDir}\n[UPDATE] Extracted files: ${extractedFiles}\n[UPDATE] Extract error: ${extractError || 'none'}\n[UPDATE] cwd: ${process.cwd()}`;
      fs.writeFileSync(path.join(process.cwd(), 'update_debug.log'), logMsg);
      console.log(logMsg);
      
      // 4. 查找版本包目录（支持新格式 server/+web/ 或旧格式 dist/）
      const serverPkgDir = path.join(extractDir, 'server');
      const webPkgDir = path.join(extractDir, 'web');
      const distPkgDir = path.join(extractDir, 'dist');
      
      // 新格式：有 server/ 和 web/ 目录
      if (fs.existsSync(serverPkgDir) && fs.existsSync(webPkgDir)) {
        // 替换 server dist
        const serverDist = path.join(process.cwd(), 'dist');
        if (fs.existsSync(serverDist)) fs.rmSync(serverDist, { recursive: true, force: true });
        fs.cpSync(serverPkgDir, serverDist, { recursive: true });
        
        // 替换 web dist
        const webDist = path.join(process.cwd(), '..', 'web', 'dist');
        if (fs.existsSync(webDist)) fs.rmSync(webDist, { recursive: true, force: true });
        fs.cpSync(webPkgDir, webDist, { recursive: true });
      } else if (fs.existsSync(distPkgDir)) {
        // 旧格式：单个 dist/ 目录
        const serverDist = path.join(process.cwd(), 'dist');
        if (fs.existsSync(serverDist)) fs.rmSync(serverDist, { recursive: true, force: true });
        fs.cpSync(distPkgDir, serverDist, { recursive: true });
        
        const webDist = path.join(process.cwd(), '..', 'web', 'dist');
        const webAssets = path.join(distPkgDir, 'assets');
        if (fs.existsSync(webAssets)) {
          if (fs.existsSync(webDist)) fs.rmSync(webDist, { recursive: true, force: true });
          fs.cpSync(webAssets, webDist, { recursive: true });
        }
      } else {
        return fail(reply, 500, `版本包格式错误：未找到 server/、web/ 或 dist/ 目录。已解压内容: ${extractedFiles.join(', ')}`);
      }
      
      // 5. 更新版本号（优先从版本包读取，否则从 latest tag 获取）
      let newVersion = latest.tag_name?.replace(/^v/, '') || latest.version || '';
      
      // 尝试从版本包中的 package.json 读取版本
      const pkgInPkg = path.join(extractDir, 'server-package.json');
      if (fs.existsSync(pkgInPkg)) {
        const pkgData = JSON.parse(fs.readFileSync(pkgInPkg, 'utf-8'));
        if (pkgData.version) newVersion = pkgData.version;
      }
      
      if (newVersion) {
        // 更新 server 的 package.json（process.cwd() 就是 apps/server）
        const serverPkgPath = path.join(process.cwd(), 'package.json');
        if (fs.existsSync(serverPkgPath)) {
          const spkg = JSON.parse(fs.readFileSync(serverPkgPath, 'utf-8'));
          spkg.version = newVersion;
          fs.writeFileSync(serverPkgPath, JSON.stringify(spkg, null, 2));
        }
        // 更新根目录的 package.json
        const rootPkgPath = path.join(process.cwd(), '..', 'package.json');
        if (fs.existsSync(rootPkgPath)) {
          const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
          rootPkg.version = newVersion;
          fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2));
        }
      }
      
      // 6. 清理临时文件
      fs.rmSync(tmpDir, { recursive: true, force: true });
      
      // 6. 延迟重启服务器
      setTimeout(() => {
        // 重新 spawn 自己
        const child = spawn(process.execPath, [process.argv[1]], {
          cwd: process.cwd(),
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        process.exit(0);
      }, 2000);
      
      return ok(reply, { message: '更新成功，服务器即将重启' });
    } catch (e: any) {
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
