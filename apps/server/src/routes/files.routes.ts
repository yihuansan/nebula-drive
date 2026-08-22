import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission, ok, fail } from '../auth/middleware.js';
import { verifyJwt } from '../auth/jwt.js';
import { jwtSecret, dirs } from '../config.js';
import { fileService } from '../services/file.service.js';
import { getStorageRecord, issueDownloadTicket, consumeDownloadTicket } from '../services/file.service.js';
import { getDriver } from '../storage/registry.js';
import { getDb } from '../db/index.js';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

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
      
      const stream = await driver.download(p);
      const name = p.split('/').filter(Boolean).pop() || 'download';
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      reply.header('Content-Length', st.size);
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
        // 记录失败不影响预览
      }
      
      const total = st.size;
      // 解析 Range 头：本地存储支持范围读取，用于视频在线播放拖动
      const isLocal = rec.type === 'local';
      const rangeHdr = (req.headers.range as string | undefined) || '';
      let range: { start: number; end: number } | undefined;
      if (isLocal && rangeHdr.startsWith('bytes=')) {
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
        ts: 'text/typescript', py: 'text/x-python', java: 'text/x-java',
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
        reply.header('Content-Range', `bytes ${range.start}-${range.end} ${total}`);
        reply.header('Content-Length', range.end - range.start + 1);
      } else {
        reply.header('Content-Length', total);
      }
      return reply.send(stream);
    } catch (e: any) {
      return fail(reply, 404, e?.message || '预览失败');
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

  // ===== 批量下载（打包 zip）=====
  app.post('/files/batch-download', { preHandler: requirePermission('files:download') }, async (req, reply) => {
    const b = req.body as { storageId?: number; paths?: string[] };
    if (!b.paths?.length) return fail(reply, 400, '缺少文件列表');
    const storageId = b.storageId || 0;
    const rec = getStorageRecord(storageId);
    if (!rec) return fail(reply, 404, '存储不存在');

    const zip = new AdmZip();
    /** 递归添加目录内容到 zip */
    function addDirRecursive(dirPath: string, zipFolder: string) {
      const items = fs.readdirSync(dirPath);
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stat = fs.statSync(itemPath);
        if (stat.isDirectory()) {
          addDirRecursive(itemPath, zipFolder ? `${zipFolder}/${item}` : item);
        } else {
          const zipEntryPath = zipFolder ? `${zipFolder}/${item}` : item;
          zip.addLocalFile(itemPath, undefined, zipEntryPath);
        }
      }
    }
    for (const p of b.paths) {
      const fullPath = safeStoragePath(p);
      if (!fullPath) continue; // 路径穿越尝试：跳过
      if (!fs.existsSync(fullPath)) continue;
      const stat = fs.statSync(fullPath);
      const zipBase = p.replace(/^\//, '').split('/').pop() || p;
      if (stat.isDirectory()) {
        // 文件夹：递归打包，以文件夹名为根
        addDirRecursive(fullPath, zipBase);
      } else {
        // 文件：直接添加
        zip.addLocalFile(fullPath, undefined, zipBase);
      }
    }
    const buffer = zip.toBuffer();
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', 'attachment; filename="batch-download.zip"');
    reply.header('Content-Length', buffer.length);
    return reply.send(buffer);
  });

  // ===== 压缩：将选中文件/文件夹打包为 zip 保存到服务器 =====
  app.post('/files/compress', { preHandler: requirePermission('files:upload') }, async (req, reply) => {
    const b = req.body as { storageId?: number; paths?: string[]; destPath?: string };
    if (!b.paths?.length) return fail(reply, 400, '缺少文件列表');
    const storageId = b.storageId || 0;
    const rec = getStorageRecord(storageId);
    if (!rec) return fail(reply, 404, '存储不存在');

    // 默认保存到当前目录，文件名 = 第一个选中项名称 + .zip
    const firstPath = b.paths[0].replace(/^\//, '');
    const baseName = firstPath.split('/').pop() || 'archive';
    const zipName = baseName.endsWith('.zip') ? baseName : baseName + '.zip';
    const destDir = b.destPath ? path.join(dirs.storageRoot, b.destPath.replace(/^\//, '')) : dirs.storageRoot;
    const zipPath = path.join(destDir, zipName);

    const zip = new AdmZip();
    function addDirRecursive(dirPath: string, zipFolder: string) {
      const items = fs.readdirSync(dirPath);
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stat = fs.statSync(itemPath);
        if (stat.isDirectory()) {
          addDirRecursive(itemPath, zipFolder ? `${zipFolder}/${item}` : item);
        } else {
          const zipEntryPath = zipFolder ? `${zipFolder}/${item}` : item;
          zip.addLocalFile(itemPath, undefined, zipEntryPath);
        }
      }
    }
    for (const p of b.paths) {
      const fullPath = safeStoragePath(p);
      if (!fullPath) continue; // 路径穿越尝试：跳过
      if (!fs.existsSync(fullPath)) continue;
      const stat = fs.statSync(fullPath);
      const zipBase = p.replace(/^\//, '').split('/').pop() || p;
      if (stat.isDirectory()) {
        addDirRecursive(fullPath, zipBase);
      } else {
        zip.addLocalFile(fullPath, undefined, zipBase);
      }
    }
    // 写入 zip 文件
    fs.writeFileSync(zipPath, zip.toBuffer());
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
      zip.extractAllTo(destDir, true);
      const entries = zip.getEntries();
      return ok(reply, { extracted: entries.length });
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
    const entries: any[] = [];
    try {
      if (ext === 'zip') {
        const zip = new AdmZip(fs.readFileSync(fullPath));
        for (const entry of zip.getEntries()) {
          entries.push({
            name: entry.entryName,
            size: entry.isDirectory ? 0 : entry.size,
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
