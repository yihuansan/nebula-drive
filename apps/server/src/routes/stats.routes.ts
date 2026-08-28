import type { FastifyInstance } from 'fastify';
import fs, { promises as fsp } from 'node:fs';
import { getDb } from '../db/index.js';
import { requirePermission, ok } from '../auth/middleware.js';
import { dirs } from '../config.js';

/** 异步递归统计目录大小（非阻塞） */
async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const stack: string[] = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let items: fs.Dirent[] = [];
    try {
      items = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const it of items) {
      const p = `${d}/${it.name}`;
      if (it.isDirectory()) stack.push(p);
      else {
        try {
          total += (await fsp.stat(p)).size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return total;
}

/** 磁盘统计缓存：递归扫盘成本高，30 秒 TTL */
const diskCache: { at: number; disk: { dbSize: number; uploadSize: number; recycleSize: number } } = { at: 0, disk: { dbSize: 0, uploadSize: 0, recycleSize: 0 } };
const DISK_TTL = 30 * 1000;

export async function statsRoutes(app: FastifyInstance) {
  app.get('/stats', { preHandler: requirePermission('stats:view') }, async (req, reply) => {
    const db = getDb();
    const users = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
    const storages = (db.prepare('SELECT COUNT(*) AS c FROM storages').get() as { c: number }).c;
    const shares = (db.prepare('SELECT COUNT(*) AS c FROM shares').get() as { c: number }).c;
    const opLogs = (db.prepare('SELECT COUNT(*) AS c FROM op_logs').get() as { c: number }).c;
    const recycle = (db.prepare('SELECT COUNT(*) AS c FROM recycle').get() as { c: number }).c;
    if (Date.now() - diskCache.at >= DISK_TTL) {
      const dbSize = fs.existsSync(dirs.db) ? fs.statSync(dirs.db).size : 0;
      const [uploadSize, recycleSize] = await Promise.all([dirSize(dirs.uploads), dirSize(dirs.recycle)]);
      diskCache.at = Date.now();
      diskCache.disk = { dbSize, uploadSize, recycleSize };
    }
    return ok(reply, {
      users,
      storages,
      shares,
      opLogs,
      recycle,
      disk: diskCache.disk,
      uptime: process.uptime(),
    });
  });
}
