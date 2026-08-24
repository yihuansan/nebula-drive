import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config, ensureDirs, initJwtSecret, dirs } from './config.js';
import { getDb } from './db/index.js';
import { seedAdmin } from './services/user.service.js';
import { ensureRolePermissions } from './services/role.service.js';

import { authRoutes } from './routes/auth.routes.js';
import { fileRoutes } from './routes/files.routes.js';
import { uploadRoutes } from './routes/upload.routes.js';
import { shareRoutes } from './routes/share.routes.js';
import { userRoutes } from './routes/user.routes.js';
import { storageRoutes } from './routes/storage.routes.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { logRoutes } from './routes/log.routes.js';
import { recycleRoutes } from './routes/recycle.routes.js';
import { statsRoutes } from './routes/stats.routes.js';
import { syncRoutes } from './routes/sync.routes.js';
import { roleRoutes } from './routes/role.routes.js';
import { extendedRoutes } from './routes/extended.routes.js';
import { newFeaturesRoutes } from './routes/new-features.routes.js';
import { updateRoutes } from './routes/update.routes.js';
import { shareCollabRoutes } from './routes/shareCollab.routes.js';
import { twoFactorRoutes } from './routes/twoFactor.routes.js';
import sessionRoutes from './routes/session.routes.js';

import { uploadService } from './services/upload.service.js';
import { recycleService } from './services/recycle.service.js';
import { settingNum } from './services/settings.service.js';
import { fileIndex } from './services/fileIndex.service.js';

function seedDefaultStorage(): void {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS c FROM storages').get() as { c: number };
  if (row.c === 0) {
    db.prepare('INSERT INTO storages (name, type, config, sort) VALUES (?, ?, ?, ?)').run(
      '本地存储',
      'local',
      JSON.stringify({ root: dirs.storageRoot }),
      0,
    );
    console.log('[seed] 已创建默认本地存储（根目录: storage/）');
    return;
  }
  // Self-heal: fix an existing default local storage whose root is empty/relative
  const rec = db
    .prepare('SELECT id, config FROM storages WHERE type = ? ORDER BY id LIMIT 1')
    .get('local') as { id: number; config: string } | undefined;
  if (rec) {
    try {
      const cfg = JSON.parse(rec.config) as { root?: string };
      if (!cfg.root || !path.isAbsolute(cfg.root)) {
        db.prepare('UPDATE storages SET config = ? WHERE id = ?').run(
          JSON.stringify({ root: dirs.storageRoot }),
          rec.id,
        );
        console.log('[seed] 已修正默认本地存储根目录为绝对路径');
      }
    } catch {
      /* ignore malformed config */
    }
  }
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // P2-3 修复：日志中 redact token 字段，防止 JWT 进入日志/代理日志
    logger: {
      level: 'info',
      redact: ['req.headers.authorization', 'req.query.token'],
    },
    bodyLimit: 1024 * 1024 * 1024, // 1GB，分片上传
    // Fastify 5：maxParamLength 顶层属性已弃用（fastify@6 移除），迁移到 routerOptions
    routerOptions: {
      maxParamLength: 512,
    },
  });

  // P1-5 修复：全局限流 300 次/分钟/IP（默认按 IP 计数），防止接口滥用与暴力破解
  // 特定端点（验证码/登录）在各自路由上以更严格的 config.rateLimit 覆盖（见 routes/auth.routes.ts）
  await app.register(rateLimit, {
    max: 300,
    timeWindow: 60 * 1000,
  });

  // P1-5：限流触发时统一返回 { error: '请求过于频繁，请稍后再试' }（429）
  // @fastify/rate-limit 通过抛出 statusCode=429 的错误触发限流，由本 handler 统一其响应体
  // 其余错误沿用 { error } 约定（与 fail() 一致）
  // Fastify 5：setErrorHandler 的 error 参数默认类型为 unknown（v4 为 FastifyError），
  // 显式指定 FastifyError 泛型以保留 statusCode/message 的类型安全访问。
  app.setErrorHandler<FastifyError>((err, _req, reply) => {
    if (err.statusCode === 429) {
      return reply.status(429).send({ error: '请求过于频繁，请稍后再试' });
    }
    const statusCode =
      typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;
    return reply.status(statusCode).send({ error: err.message || '服务器内部错误' });
  });

  // P2-6 安全响应头：所有响应统一附加（轻量 onSend hook，无需额外依赖）
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Download-Options', 'noopen');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  });

  // P1-1 修复：CORS 收敛为显式 origin 列表（默认同源，无 CORS 头），防止任意来源带凭证跨域访问
  // 开发环境可设 CORS_ORIGINS=http://localhost:5173 允许 Vite dev server 跨域
  if (config.corsOrigins.length > 0) {
    await app.register(cors, { origin: config.corsOrigins, credentials: true });
  }
  await app.register(multipart, {
    limits: { fileSize: 1024 * 1024 * 1024, files: 100 },
  });
  // 原始二进制体：同步推送 /sync/push 与非 multipart 的 /upload/chunk
  // 注意：Fastify 的 content-type parser 必须调用 done(null, body) 才会完成请求，
  // 仅 return 非 Promise 值会导致请求永久挂起。
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req: unknown, body: Buffer, done: (err: Error | null, b?: unknown) => void) => done(null, body));
  app.addContentTypeParser('application/x-raw', { parseAs: 'buffer' }, (_req: unknown, body: Buffer, done: (err: Error | null, b?: unknown) => void) => done(null, body));

  app.get('/health', async () => ({ status: 'ok', app: config.appName, time: new Date().toISOString() }));
  app.get('/api/v1/health', async () => ({ status: 'ok' }));

  const api = async (instance: FastifyInstance) => {
    await instance.register(authRoutes);
    await instance.register(fileRoutes);
    await instance.register(uploadRoutes);
    await instance.register(shareRoutes);
    await instance.register(userRoutes);
    await instance.register(storageRoutes);
    await instance.register(settingsRoutes);
    await instance.register(logRoutes);
    await instance.register(recycleRoutes);
    await instance.register(statsRoutes);
    await instance.register(syncRoutes);
    await instance.register(roleRoutes);
    await instance.register(extendedRoutes);
    await instance.register(newFeaturesRoutes);
    await instance.register(updateRoutes);
    await instance.register(shareCollabRoutes);
    await instance.register(twoFactorRoutes);
    await instance.register(sessionRoutes);
  };
  await app.register(api, { prefix: '/api/v1' });

  // 背景图服务：/uploads/background/xxx -> data/backgrounds/xxx
  // 用手动路由而非第二个 fstatic（fstatic 每次注册都会装饰 reply.sendFile，重复注册会冲突）
  const bgMime: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.gif': 'image/gif',
  };
  app.get('/uploads/background/:name', (req, reply) => {
    const name = (req.params as { name: string }).name;
    // P1-2 修复：校验 name 是单层文件名，拒绝含 /、.. 的值
    if (name.includes('/') || name.includes('..') || name.includes('\\')) {
      return reply.code(404).send({ error: 'Not Found' });
    }
    const file = path.join(dirs.backgrounds, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return reply.code(404).send({ error: 'Not Found' });
    }
    const ext = path.extname(name).toLowerCase();
    return reply.type(bgMime[ext] || 'application/octet-stream').send(fs.createReadStream(file));
  });

  // Logo 服务：/uploads/logo/xxx -> data/logo/xxx
  const logoMime: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  };
  app.get('/uploads/logo/:name', (req, reply) => {
    const name = (req.params as { name: string }).name;
    // P1-2 修复：校验 name 是单层文件名，拒绝含 /、.. 的值
    if (name.includes('/') || name.includes('..') || name.includes('\\')) {
      return reply.code(404).send({ error: 'Not Found' });
    }
    const file = path.join(dirs.logo, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return reply.code(404).send({ error: 'Not Found' });
    }
    const ext = path.extname(name).toLowerCase();
    return reply.type(logoMime[ext] || 'application/octet-stream').send(fs.createReadStream(file));
  });

  // 静态托管 Web 前端构建产物（若存在）
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../web/dist'),          // 开发/构建后：apps/server/dist/../.. -> apps/web/dist
    path.resolve(process.cwd(), 'apps/web/dist'),  // 从仓库根运行
  ];
  const webDist = candidates.find((p) => fs.existsSync(p));
  if (webDist) {
    await app.register(fstatic, { root: webDist, index: 'index.html' });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api/')) return reply.code(404).send({ error: 'Not Found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}

async function main() {
  ensureDirs();
  initJwtSecret();
  getDb(); // 初始化数据库与迁移
  seedAdmin();
  seedDefaultStorage();
  ensureRolePermissions(); // 初始化角色权限（首次启动写入默认；同时是防锁死保护）

  const app = await buildApp();

  // 定期清理过期上传会话
  const timer = setInterval(() => uploadService.prune(), 6 * 3600 * 1000);
  timer.unref();

  // 回收站自动清理（recycleRetentionDays > 0 时生效，每小时检查一次）
  const purgeRecycle = () => {
    const days = settingNum('recycleRetentionDays', 0);
    if (days <= 0) return;
    try {
      const n = recycleService.purgeOlderThan(days);
      if (n > 0) console.log(`[recycle] 自动清理 ${n} 条超过 ${days} 天的回收站记录`);
    } catch (e: any) {
      console.error('[recycle] 自动清理失败:', e?.message || e);
    }
  };
  purgeRecycle();
  const recycleTimer = setInterval(purgeRecycle, 3600 * 1000);
  recycleTimer.unref();

  // P2-5: 定期刷新文件搜索索引（重建脏/空/过期的 local 存储索引）
  const refreshIndex = () => {
    fileIndex.refreshAll().catch((e: unknown) => {
      console.error('[fileIndex] 定期刷新失败:', e instanceof Error ? e.message : e);
    });
  };
  refreshIndex(); // 启动时预热（异步，不阻塞启动）
  const indexTimer = setInterval(refreshIndex, 15 * 60 * 1000);
  indexTimer.unref();

  await app.listen({ port: config.port, host: config.host });
  console.log(`\n  ${config.appName} 已启动: http://${config.host}:${config.port}`);
  console.log(`  API 前缀: /api/v1  健康检查: /health\n`);
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
