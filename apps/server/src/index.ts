import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
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
import { uploadService } from './services/upload.service.js';
import { recycleService } from './services/recycle.service.js';
import { settingNum } from './services/settings.service.js';

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
    logger: { level: 'info' },
    bodyLimit: 1024 * 1024 * 1024, // 1GB，分片上传
    maxParamLength: 512,
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(multipart, {
    limits: { fileSize: 1024 * 1024 * 1024, files: 100 },
  });
  // 原始二进制体：同步推送 /sync/push 与非 multipart 的 /upload/chunk
  // 注意：Fastify 的 content-type parser 必须调用 done(null, body) 才会完成请求，
  // 仅 return 非 Promise 值会导致请求永久挂起。
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req: unknown, body: Buffer, done: (e: unknown, b: Buffer) => void) => done(null, body));
  app.addContentTypeParser('application/x-raw', { parseAs: 'buffer' }, (_req: unknown, body: Buffer, done: (e: unknown, b: Buffer) => void) => done(null, body));

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

  await app.listen({ port: config.port, host: config.host });
  console.log(`\n  ${config.appName} 已启动: http://${config.host}:${config.port}`);
  console.log(`  API 前缀: /api/v1  健康检查: /health\n`);
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
