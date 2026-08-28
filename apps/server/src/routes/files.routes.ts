import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission, ok, fail } from '../auth/middleware.js';
import { verifyJwt } from '../auth/jwt.js';
import { jwtSecret, dirs } from '../config.js';
import { fileService } from '../services/file.service.js';
import { getStorageRecord, issueDownloadTicket, consumeDownloadTicket } from '../services/file.service.js';
import { fileIndex } from '../services/fileIndex.service.js';
import { getDriver } from '../storage/registry.js';
import { LocalDriver } from '../storage/local.js';
import { getPoster, isVideoExt } from '../services/poster.service.js';
import { isFaststart, needsFaststartExt, ensureFaststartAsync } from '../services/videoProcess.service.js';
import { getDb } from '../db/index.js';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
// archiver 为 CJS 模块，Node ESM 下无 default 导出，用 createRequire 加载
import { createRequire } from 'node:module';
const requireCjs = createRequire(import.meta.url);
const archiver = requireCjs('archiver') as typeof import('archiver');

/** 预览专用认证：兼容 Bearer 头与 ?token=（<video> 流无法带自定义请求头） */
async function previewAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    const q = req.query as { token?: string };
    if (q.token) token = q.token;
  }
  if (!token) return reply.code(401).header('Cache-Control', 'no-store').send({ error: '未登录' });
  const payload = verifyJwt(token, jwtSecret);
  if (!payload) return reply.code(401).header('Cache-Control', 'no-store').send({ error: '登录已过期，请重新登录' });
  req.user = payload;
}

/** 将相对路径安全解析到 storageRoot 内；越界返回 null（防路径穿越） */
function safeStoragePath(rel: string): string | null {
  const root = path.resolve(dirs.storageRoot);
  const full = path.resolve(root, rel.replace(/^\//, ''));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

/** 打包/解压安全上限：防止 zip bomb 与 OOM */
const MAX_ZIP_FILES = 2000;
const MAX_ZIP_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

/** 递归统计选中项的文件数与总大小（仅 stat，不读内容；异步 API 避免阻塞事件循环） */
async function collectFileBudget(items: { full: string; base: string }[], budget: { files: number; bytes: number }): Promise<void> {
  const walk = async (full: string): Promise<void> => {
    const st = await fs.promises.stat(full);
    if (st.isDirectory()) {
      const names = await fs.promises.readdir(full);
      for (const name of names) await walk(path.join(full, name));
    } else {
      budget.files += 1;
      budget.bytes += st.size;
    }
  };
  for (const it of items) await walk(it.full);
}

export async function fileRoutes(app: FastifyInstance) {
  app.get('/files', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const q = req.query as { storageId?: string; path?: string; sort?: string; order?: string };
    const storageId = Number(q.storageId);
    const path = q.path || '/';
    try {
      const rec = getStorageRecord(storageId);
      const { entries, parent } = await fileService.list(storageId, path, q.sort || 'name', q.order || 'asc');
      return ok(reply, { entries, parent, storage: rec ? { id: rec.id, name: rec.name, type: rec.type } : null });
    } catch (e: any) {
      return fail(reply, 500, e?.message || '目录列表失败');
    }
  });

  app.post('/files/mkdir', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const { storageId, path: p } = req.body as { storageId: number; path: string };
    try {
      await fileService.mkdir(storageId, p, { username: req.user!.username, id: req.user!.sub });
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '创建目录失败');
    }
  });

  app.post('/files/rename', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const { storageId, path: p, newPath } = req.body as { storageId: number; path: string; newPath: string };
    try {
      await fileService.rename(storageId, p, newPath, { username: req.user!.username, id: req.user!.sub });
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '重命名失败');
    }
  });

  app.post('/files/move', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const { storageId, path: p, destPath } = req.body as { storageId: number; path: string; destPath: string };
    try {
      await fileService.move(storageId, p, destPath, { username: req.user!.username, id: req.user!.sub });
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '移动失败');
    }
  });

  app.post('/files/copy', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const { storageId, path: p, destPath } = req.body as { storageId: number; path: string; destPath: string };
    try {
      await fileService.copy(storageId, p, destPath, { username: req.user!.username, id: req.user!.sub });
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '复制失败');
    }
  });

  app.post('/files/delete', { preHandler: requirePermission('files:delete') }, async (req, reply) => {
    const { storageId, path: p } = req.body as { storageId: number; path: string };
    try {
      await fileService.delete(storageId, p, { username: req.user!.username, id: req.user!.sub });
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '删除失败');
    }
  });

  app.post('/files/batch-delete', { preHandler: requirePermission('files:delete') }, async (req, reply) => {
    const { storageId, paths } = req.body as { storageId: number; paths: string[] };
    try {
      await fileService.batchDelete(storageId, paths, { username: req.user!.username, id: req.user!.sub });
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '批量删除失败');
    }
  });

  app.post('/files/batch-move', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const { storageId, paths, destPath } = req.body as { storageId: number; paths: string[]; destPath: string };
    if (!paths?.length) return fail(reply, 400, '缺少文件列表');
    try {
      await fileService.batchMove(storageId, paths, destPath, { username: req.user!.username, id: req.user!.sub });
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '批量移动失败');
    }
  });

  app.post('/files/batch-copy', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const { storageId, paths, destPath } = req.body as { storageId: number; paths: string[]; destPath: string };
    if (!paths?.length) return fail(reply, 400, '缺少文件列表');
    try {
      await fileService.batchCopy(storageId, paths, destPath, { username: req.user!.username, id: req.user!.sub });
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '批量复制失败');
    }
  });

  /** 签发一次性下载票据（需登录）：大文件走浏览器原生下载，不再 JS 整包缓冲 */
  app.post('/files/download-ticket', { preHandler: requirePermission('files:download') }, async (req, reply) => {
    const { storageId, path } = req.body as { storageId: number; path: string };
    try {
      const rec = getStorageRecord(storageId);
      if (!rec) return fail(reply, 404, '存储不存在');
      const st = await getDriver(rec).stat(path);
      if (!st) return fail(reply, 404, '文件不存在');
      if (st.isDir) return fail(reply, 400, '只能下载文件');
      return ok(reply, { ticket: issueDownloadTicket(storageId, path) });
    } catch (e: any) {
      return fail(reply, 500, e?.message || '获取下载链接失败');
    }
  });

  /** 下载：支持登录态（storageId+path）或一次性票据（ticket）两种方式 */
  app.get('/files/download', async (req, reply) => {
    const q = req.query as { storageId?: string; path?: string; ticket?: string };
    try {
      let storageId: number;
      let p: string;
      if (q.ticket) {
        const t = consumeDownloadTicket(q.ticket);
        if (!t) return fail(reply, 401, '下载链接已失效，请重新获取');
        storageId = t.storageId;
        p = t.path;
      } else {
        await requirePermission('files:download')(req, reply);
        if (reply.sent) return;
        storageId = Number(q.storageId);
        p = q.path || '';
      }
      const rec = getStorageRecord(storageId);
      if (!rec) return fail(reply, 404, '存储不存在');
      const driver = getDriver(rec);
      const st = await driver.stat(p);
      if (!st || st.isDir) return fail(reply, 404, '文件不存在');
      
      // 记录访问历史
      try {
        const db = getDb();
        const userId = req.user ? (req.user as any).sub : null;
        if (userId) {
          const name = p.split('/').pop() || 'file';
          db.prepare(
            'INSERT INTO recent_access (user_id, storage_id, path, name, is_dir, accessed_at) VALUES (?, ?, ?, ?, 0, datetime(\'now\')) ' +
            'ON CONFLICT (user_id, storage_id, path) DO UPDATE SET accessed_at = datetime(\'now\'), name = excluded.name'
          ).run(userId, storageId, p, name);
        }
      } catch {
        // 记录失败不影响下载
      }
      
      // 解析 Range 头：支持断点续传 / 多线程下载工具
      const total = st.size;
      const rangeHdr = (req.headers.range as string | undefined) || '';
      let range: { start: number; end: number } | undefined;
      if (rangeHdr.startsWith('bytes=')) {
        const m = rangeHdr.match(/bytes=(\d*)-(\d*)/);
        if (m) {
          const start = m[1] ? parseInt(m[1], 10) : 0;
          const end = m[2] ? parseInt(m[2], 10) : total - 1;
          const s = Math.max(0, Math.min(start, total - 1));
          const e = Math.max(s, Math.min(end, total - 1));
          if (s <= e) range = { start: s, end: e };
        }
      }
      const stream = await driver.download(p, range);
      const name = p.split('/').filter(Boolean).pop() || 'download';
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      reply.header('Accept-Ranges', 'bytes');
      if (range) {
        reply.code(206);
        reply.header('Content-Range', `bytes ${range.start}-${range.end}/${total}`);
        reply.header('Content-Length', range.end - range.start + 1);
      } else {
        reply.header('Content-Length', total);
      }
      return reply.send(stream);
    } catch (e: any) {
      return fail(reply, 404, e?.message || '下载失败');
    }
  });

  app.get('/files/preview', { preHandler: async (req, reply) => { await previewAuth(req, reply); if (!reply.sent) await requirePermission('files:view')(req, reply); } }, async (req, reply) => {
    const q = req.query as { storageId?: string; path?: string };
    const storageId = Number(q.storageId);
    const p = q.path || '';
    try {
      const rec = getStorageRecord(storageId);
      if (!rec) return fail(reply, 404, '存储不存在');
      const driver = getDriver(rec);
      let st = await driver.stat(p);
      if (!st || st.isDir) return fail(reply, 404, '文件不存在');
      
      // 记录访问历史
      try {
        const db = getDb();
        const userId = req.user ? (req.user as any).sub : null;
        if (userId) {
          const name = p.split('/').pop() || 'file';
          db.prepare(
            'INSERT INTO recent_access (user_id, storage_id, path, name, is_dir, accessed_at) VALUES (?, ?, ?, ?, 0, datetime(\'now\')) ' +
            'ON CONFLICT (user_id, storage_id, path) DO UPDATE SET accessed_at = datetime(\'now\'), name = excluded.name'
          ).run(userId, storageId, p, name);
        }
      } catch {
        // 记录失败不影响预览
      }
      
      // 本地存储标记（Range 读取 + faststart 兜底都需要）
      const isLocal = rec.type === 'local';
      // 自动 faststart 兜底：本地 MP4/M4V 若 non-faststart，不阻塞当前请求——
      // 先返回原始文件让用户播放，响应完成后再后台异步转换（moov 前置），
      // 下次请求即可直接使用 faststart 版本（边下边播）。
      if (isLocal && needsFaststartExt(p)) {
        const localDriver = driver as unknown as LocalDriver;
        const fullPath = localDriver.resolveFull(p);
        if (!(await isFaststart(fullPath))) {
          reply.raw.on('close', () => {
            ensureFaststartAsync(fullPath);
          });
        }
      }
      const total = st.size;
      // 解析 Range 头：各存储驱动均支持范围读取，用于视频在线播放拖动
      const rangeHdr = (req.headers.range as string | undefined) || '';
      let range: { start: number; end: number } | undefined;
      if (rangeHdr.startsWith('bytes=')) {
        const m = rangeHdr.match(/bytes=(\d*)-(\d*)/);
        if (m) {
          const start = m[1] ? parseInt(m[1], 10) : 0;
          const end = m[2] ? parseInt(m[2], 10) : total - 1;
          const s = Math.max(0, Math.min(start, total - 1));
          const e = Math.max(s, Math.min(end, total - 1));
          if (s <= e) range = { start: s, end: e };
        }
      }
      const stream = await driver.download(p, range);
      // 诊断日志：追踪流的生命周期 + 实际发送字节数
      const streamLabel = `[preview:${p.split('/').pop()}]`;
      const t0 = Date.now();
      let bytesSent = 0;
      stream.on('open', (fd: any) => {
        console.log(`${streamLabel} OPEN fd=${fd} range=${range ? `${range.start}-${range.end}` : 'full'} total=${total} t=0ms`);
      });
      stream.on('data', (chunk: Buffer) => {
        bytesSent += chunk.length;
      });
      stream.on('close', () => {
        console.log(`${streamLabel} CLOSED bytesSent=${bytesSent} t=${Date.now() - t0}ms`);
      });
      stream.on('error', (err: Error) => {
        console.log(`${streamLabel} STREAM_ERROR: ${err.message} bytesSent=${bytesSent} t=${Date.now() - t0}ms`);
      });
      reply.raw.on('close', () => {
        console.log(`${streamLabel} RAW_CLOSED bytesSent=${bytesSent} t=${Date.now() - t0}ms`);
      });
      // 记录请求头（诊断用）
      console.log(`${streamLabel} REQUEST headers=${JSON.stringify({ range: req.headers.range, ua: (req.headers['user-agent'] || '').slice(0, 80), accept: req.headers.accept })}`);
      // 根据文件扩展名设置正确的 Content-Type
      const ext = p.split('.').pop()?.toLowerCase() || '';
      const MIME_MAP: Record<string, string> = {
        // 视频
        mp4: 'video/mp4', mkv: 'video/x-matroska', mov: 'video/quicktime',
        webm: 'video/webm', avi: 'video/x-msvideo', flv: 'video/x-flv',
        wmv: 'video/x-ms-wmv', m4v: 'video/x-m4v', ts: 'video/mp2t', '3gp': 'video/3gpp',
        // 音频
        mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac',
        ogg: 'audio/ogg', aac: 'audio/aac', m4a: 'audio/x-m4a',
        // 图片
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
        svg: 'image/svg+xml', ico: 'image/x-icon',
        // 文档
        pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
        html: 'text/html', css: 'text/css', js: 'text/javascript',
        json: 'application/json', csv: 'text/csv',
        // 代码
        py: 'text/x-python', java: 'text/x-java',
        c: 'text/x-c', cpp: 'text/x-c++', h: 'text/x-chdr',
        sh: 'text/x-shell', go: 'text/x-go', rs: 'text/x-rust', vue: 'text/vue',
      };
      const contentType = MIME_MAP[ext] || 'application/octet-stream';
      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(p.split('/').pop() || 'file')}"`);
      reply.header('Cache-Control', 'private, max-age=3600');
      reply.header('Accept-Ranges', 'bytes');
      if (range) {
        reply.code(206);
        reply.header('Content-Range', `bytes ${range.start}-${range.end}/${total}`);
        reply.header('Content-Length', range.end - range.start + 1);
      } else {
        reply.header('Content-Length', total);
      }
      return reply.send(stream);
    } catch (e: any) {
      return fail(reply, 404, e?.message || '预览失败');
    }
  });

  /** 服务端海报：ffmpeg seek 抽帧生成 JPEG（绕过浏览器捕获，对非 faststart/大文件可靠）。?storageId&path，可选 ?t 指定 seek 秒数 */
  app.get('/files/poster', { preHandler: async (req, reply) => { await previewAuth(req, reply); if (!reply.sent) await requirePermission('files:view')(req, reply); } }, async (req, reply) => {
    const q = req.query as { storageId?: string; path?: string; t?: string };
    const storageId = Number(q.storageId);
    const p = q.path || '';
    try {
      const rec = getStorageRecord(storageId);
      if (!rec) return fail(reply, 404, '存储不存在');
      if (rec.type !== 'local') return fail(reply, 400, '仅本地存储支持服务端海报');
      const driver = getDriver(rec);
      const st = await driver.stat(p);
      if (!st || st.isDir) return fail(reply, 404, '文件不存在');
      const name = p.split('/').filter(Boolean).pop() || '';
      if (!isVideoExt(name)) return fail(reply, 400, '非视频文件');
      const local = driver as unknown as LocalDriver;
      const fullPath = local.resolveFull(p);
      const t = q.t ? Number(q.t) : undefined;
      const buf = await getPoster(storageId, p, fullPath, st.mtime, st.size, Number.isFinite(t) ? t : undefined);
      if (!buf) return fail(reply, 503, '海报生成失败（ffmpeg 不可用或抽帧出错）');
      reply.header('Content-Type', 'image/jpeg');
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(buf);
    } catch (e: any) {
      return fail(reply, 404, e?.message || '海报生成失败');
    }
  });

  app.get('/search', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const q = req.query as { q?: string; storageId?: string; type?: string; minSize?: string; maxSize?: string; since?: string; until?: string };
    try {
      const results = await fileService.search(
        q.q || '',
        q.storageId ? Number(q.storageId) : undefined,
        {
          type: q.type || undefined,
          minSize: q.minSize ? Number(q.minSize) : undefined,
          maxSize: q.maxSize ? Number(q.maxSize) : undefined,
          since: q.since || undefined,
          until: q.until || undefined,
        }
      );
      return ok(reply, { results });
    } catch (e: any) {
      return fail(reply, 500, e?.message || '搜索失败');
    }
  });

  // ===== 批量下载（打包 zip，流式输出）=====
  app.post('/files/batch-download', { preHandler: requirePermission('files:download') }, async (req, reply) => {
    const b = req.body as { storageId?: number; paths?: string[] };
    if (!b.paths?.length) return fail(reply, 400, '缺少文件列表');
    const storageId = b.storageId || 0;
    const rec = getStorageRecord(storageId);
    if (!rec) return fail(reply, 404, '存储不存在');

    const items: { full: string; base: string }[] = [];
    const budget = { files: 0, bytes: 0 };
    for (const p of b.paths) {
      const fullPath = safeStoragePath(p);
      if (!fullPath || !fs.existsSync(fullPath)) continue; // 路径穿越/不存在：跳过
      items.push({ full: fullPath, base: p.replace(/^\//, '').split('/').pop() || p });
    }
    if (!items.length) return fail(reply, 404, '文件不存在');
    // 预校验：文件数与总大小上限，防止 OOM
    await collectFileBudget(items, budget);
    if (budget.files > MAX_ZIP_FILES) return fail(reply, 400, `文件数超过上限（最多 ${MAX_ZIP_FILES} 个）`);
    if (budget.bytes > MAX_ZIP_BYTES) return fail(reply, 400, '文件总大小超过上限（最多 2GB）');

    // 流式打包：archiver → reply.raw（不整包驻留内存）
    const raw = reply.raw;
    const zip = archiver({ stream: true, zlib: { level: 6 } });
    zip.on('error', (err) => {
      if (!raw.headersSent) raw.writeHead(500, { 'Content-Type': 'application/json' });
      raw.end(`{"error":"${(err as Error).message}"}`);
    });
    raw.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="batch-download.zip"',
    });
    zip.pipe(raw);
    for (const it of items) {
      const st = fs.statSync(it.full);
      if (st.isDirectory()) zip.dir(it.full, it.base);
      else zip.file(it.full, { name: it.base });
    }
    await zip.finalize();
    return;
  });

  // ===== 压缩：将选中文件/文件夹打包为 zip 保存到服务器 =====
  app.post('/files/compress', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const b = req.body as { storageId?: number; paths?: string[]; destPath?: string };
    if (!b.paths?.length) return fail(reply, 400, '缺少文件列表');
    const storageId = b.storageId || 0;
    const rec = getStorageRecord(storageId);
    if (!rec) return fail(reply, 404, '存储不存在');

    // 默认保存到当前目录，文件名 = 第一个选中项名称 + .zip
    const firstPath = b.paths[0].replace(/^\//, '');
    const baseName = firstPath.split('/').pop() || 'archive';
    const zipName = baseName.endsWith('.zip') ? baseName : baseName + '.zip';
    // P0-3 修复：校验 destPath 在 storageRoot 内，防止任意位置写 zip
    const destDir = b.destPath ? safeStoragePath(b.destPath) : dirs.storageRoot;
    if (!destDir) return fail(reply, 400, '非法目标路径');
    const zipPath = path.join(destDir, zipName);

    const items: { full: string; base: string }[] = [];
    const budget = { files: 0, bytes: 0 };
    for (const p of b.paths) {
      const fullPath = safeStoragePath(p);
      if (!fullPath || !fs.existsSync(fullPath)) continue; // 路径穿越/不存在：跳过
      items.push({ full: fullPath, base: p.replace(/^\//, '').split('/').pop() || p });
    }
    if (!items.length) return fail(reply, 404, '文件不存在');
    await collectFileBudget(items, budget);
    if (budget.files > MAX_ZIP_FILES) return fail(reply, 400, `文件数超过上限（最多 ${MAX_ZIP_FILES} 个）`);
    if (budget.bytes > MAX_ZIP_BYTES) return fail(reply, 400, '文件总大小超过上限（最多 2GB）');

    // 流式写入 tmp 文件，完成后原子 rename（避免半成品 zip）
    const tmpPath = zipPath + '.tmp';
    const out = fs.createWriteStream(tmpPath);
    const zip = archiver({ stream: true, zlib: { level: 6 } });
    zip.pipe(out);
    for (const it of items) {
      const st = fs.statSync(it.full);
      if (st.isDirectory()) zip.dir(it.full, it.base);
      else zip.file(it.full, { name: it.base });
    }
    const done = new Promise<void>((resolve, reject) => {
      out.on('close', () => resolve());
      out.on('error', (e) => reject(e));
      zip.on('error', (e) => reject(e as Error));
    });
    zip.finalize();
    try {
      await done;
      fs.renameSync(tmpPath, zipPath);
    } catch (e: any) {
      try { fs.rmSync(tmpPath, { force: true }); } catch { /* ignore */ }
      return fail(reply, 500, e?.message || '压缩失败');
    }
    // P2-5/P2-6: 直接写盘到 storageRoot → 使对应 local 存储的索引与用量缓存失效
    fileIndex.invalidateForRoot(dirs.storageRoot);
    return ok(reply, { path: `/${zipName}`, name: zipName });
  });

  // ===== 解压：将 zip 文件解压到指定目录 =====
  app.post('/files/decompress', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const b = req.body as { storageId?: number; path?: string; destPath?: string };
    if (!b.path) return fail(reply, 400, '缺少 zip 文件路径');
    const storageId = b.storageId || 0;
    const rec = getStorageRecord(storageId);
    if (!rec) return fail(reply, 404, '存储不存在');

    const zipFullPath = safeStoragePath(b.path);
    if (!zipFullPath) return fail(reply, 400, '非法路径');
    if (!fs.existsSync(zipFullPath)) return fail(reply, 404, 'zip 文件不存在');
    if (!fs.statSync(zipFullPath).isFile()) return fail(reply, 400, '不是文件');

    // 默认解压到 zip 文件所在目录
    let destDir: string;
    if (b.destPath) {
      const d = safeStoragePath(b.destPath);
      if (!d) return fail(reply, 400, '非法目标目录');
      destDir = d;
    } else {
      destDir = path.dirname(zipFullPath);
    }

    try {
      const zip = new AdmZip(zipFullPath); // 读取 zip 文件
      const entries = zip.getEntries();
      // 防 zip bomb：条目数与解压总大小上限
      if (entries.length > MAX_ZIP_FILES) return fail(reply, 400, `zip 条目数超过上限（最多 ${MAX_ZIP_FILES}）`);
      const totalUncompressed = entries.reduce((s: number, e: any) => s + (e.isDirectory ? 0 : (e as any).size), 0);
      if (totalUncompressed > MAX_ZIP_BYTES) return fail(reply, 400, '解压后总大小超过上限（最多 2GB）');
      // P0-4 修复：逐条校验 zip 条目路径，防止 zip-slip 任意文件写
      let extracted = 0;
      for (const entry of entries) {
        const entryName = entry.entryName;
        const target = safeStoragePath(entryName);
        if (!target) continue; // 越界条目：跳过
        // 确保目标目录存在
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (entry.isDirectory) {
          fs.mkdirSync(target, { recursive: true });
        } else {
          fs.writeFileSync(target, entry.getData());
          extracted++;
        }
      }
      // P2-5/P2-6: 解压直接写盘到 storageRoot → 使对应 local 存储的索引与用量缓存失效
      fileIndex.invalidateForRoot(dirs.storageRoot);
      return ok(reply, { extracted });
    } catch (e: any) {
      return fail(reply, 500, '解压失败: ' + e.message);
    }
  });

  // ===== 文件元数据（属性面板）=====
  app.get('/files/:path/meta', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const q = req.query as { storageId?: string };
    const storageId = Number(q.storageId);
    const filePath = decodeURIComponent((req.params as { path: string }).path);
    const fullPath = safeStoragePath(filePath);
    if (!fullPath) return fail(reply, 404, '非法路径');
    try {
      const stat = fs.statSync(fullPath);
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const meta: any = {
        name: filePath.split('/').pop(),
        path: filePath,
        size: stat.size,
        isDir: stat.isDirectory(),
        mtime: stat.mtime.toISOString(),
        created: stat.birthtime.toISOString(),
        ext,
      };
      // 图片：读取宽高（简单解析 PNG/JPEG 头）
      if (!meta.isDir && ['png', 'jpeg', 'jpg'].includes(ext)) {
        try {
          const buf = fs.readFileSync(fullPath);
          if (ext === 'png' && buf.length > 24) {
            meta.width = buf.readUInt32BE(16);
            meta.height = buf.readUInt32BE(20);
          } else if (ext === 'jpeg' || ext === 'jpg') {
            // JPEG 尺寸解析较复杂，这里简化处理
            meta.width = null;
            meta.height = null;
          }
        } catch { /* ignore */ }
      }
      return ok(reply, { meta });
    } catch (e: any) {
      return fail(reply, 404, e?.message || '获取元数据失败');
    }
  });

  // ===== 压缩包内容列表 =====
  app.get('/files/:path/archive-list', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const q = req.query as { storageId?: string };
    const storageId = Number(q.storageId);
    const rec = getStorageRecord(storageId);
    if (!rec) return fail(reply, 404, '存储不存在');
    const p = (req.params as any).path as string;
    const fullPath = safeStoragePath(p);
    if (!fullPath) return fail(reply, 404, '非法路径');
    if (!fs.existsSync(fullPath)) return fail(reply, 404, '文件不存在');

    const ext = path.extname(fullPath).replace('.', '').toLowerCase();
    // 列出压缩包需整包读入内存（AdmZip），限制 100MB 防止 OOM（2GB 上限仅适用于流式打包/解压）
    const MAX_ARCHIVE_LIST_BYTES = 100 * 1024 * 1024;
    const stZip = fs.statSync(fullPath);
    if (stZip.size > MAX_ARCHIVE_LIST_BYTES) {
      return fail(reply, 400, `压缩包过大，不支持在线列表（最大 ${MAX_ARCHIVE_LIST_BYTES / 1024 / 1024}MB）`);
    }
    const entries: any[] = [];
    try {
      if (ext === 'zip') {
        const zip = new AdmZip(fs.readFileSync(fullPath));
        const all = zip.getEntries();
        if (all.length > MAX_ZIP_FILES) {
          return fail(reply, 400, `zip 条目数超过上限（最多 ${MAX_ZIP_FILES} 个）`);
        }
        for (const entry of all) {
          entries.push({
            name: entry.entryName,
            size: entry.isDirectory ? 0 : (entry as any).size,
            isDir: entry.isDirectory,
          });
        }
      } else if (ext === 'tar' || ext === 'gz' || ext === 'tgz' || ext === 'bz2') {
        // tar/gz/bz2 需要额外库，这里返回提示
        return ok(reply, { entries: [], message: `暂不支持 ${ext} 格式预览` });
      } else if (ext === '7z') {
        return ok(reply, { entries: [], message: '暂不支持 7z 格式预览' });
      } else {
        return fail(reply, 400, `不支持的压缩包格式: ${ext}`);
      }
    } catch (e: any) {
      return fail(reply, 500, e?.message || '解析压缩包失败');
    }
    return ok(reply, { entries });
  });
}
