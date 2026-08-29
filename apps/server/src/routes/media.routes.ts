import type { FastifyInstance } from 'fastify';
import fsp from 'node:fs/promises';
import { requirePermission, ok, fail } from '../auth/middleware.js';
import { getStorageRecord } from '../services/file.service.js';
import { getDriver } from '../storage/registry.js';
import { LocalDriver } from '../storage/local.js';
import { compressImage, getThumbnail } from '../services/imageProcess.service.js';
import { transcodeService } from '../services/transcode.service.js';
import { isVideoExt } from '../services/poster.service.js';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'avif', 'heic']);

export async function mediaRoutes(app: FastifyInstance) {
  /**
   * 文件缩略图（JPEG）：?storageId&path&size（最长边像素，默认 320）
   * 视频/图片均支持；结果按 存储+路径+mtime+尺寸 落盘缓存。仅本地存储。
   */
  app.get('/files/thumbnail', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const q = req.query as { storageId?: string; path?: string; size?: string };
    const storageId = Number(q.storageId);
    const p = q.path || '';
    const maxSide = Math.max(64, Math.min(Number(q.size) || 320, 1024));
    try {
      const rec = getStorageRecord(storageId);
      if (!rec) return fail(reply, 404, '存储不存在');
      if (rec.type !== 'local') return fail(reply, 400, '仅本地存储支持缩略图');
      const driver = getDriver(rec);
      const st = await driver.stat(p);
      if (!st || st.isDir) return fail(reply, 404, '文件不存在');
      const name = p.split('/').filter(Boolean).pop() || '';
      const ext = name.split('.').pop()?.toLowerCase() || '';
      const isImage = IMAGE_EXTS.has(ext) || ext === 'jfif';
      const isVideo = isVideoExt(name);
      if (!isImage && !isVideo) return fail(reply, 400, '非图片/视频文件');
      const local = driver as unknown as LocalDriver;
      const fullPath = local.resolveFull(p);
      const buf = await getThumbnail(storageId, p, fullPath, st.mtime, st.size, maxSide);
      if (!buf) {
        /* 图片回退：无 ffmpeg 环境时，浏览器可直显格式的小图直接返回原图（前端 object-fit 缩放裁剪），
           视频仍返回 503 */
        const RAW_CT: Record<string, string> = {
          jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
          png: 'image/png', webp: 'image/webp', gif: 'image/gif',
        };
        if (isImage && RAW_CT[ext] && st.size <= 8 * 1024 * 1024) {
          try {
            const raw = await fsp.readFile(fullPath);
            reply.header('Content-Type', RAW_CT[ext]);
            reply.header('Cache-Control', 'public, max-age=86400');
            return reply.send(raw);
          } catch { /* 落入下方 503 */ }
        }
        return fail(reply, 503, '缩略图生成失败（ffmpeg 不可用）');
      }
      reply.header('Content-Type', 'image/jpeg');
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(buf);
    } catch (e: any) {
      return fail(reply, 404, e?.message || '缩略图失败');
    }
  });

  /**
   * 图片压缩/转码（multipart：file + format(jpeg|png|webp) + quality(1-100)）
   * 返回处理后的图片二进制。
   */
  app.post('/media/image/compress', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    let fileData: Buffer | null = null;
    let format = 'jpeg';
    let quality = 85;
    for await (const p of req.parts()) {
      if (p.type === 'file') {
        fileData = await p.toBuffer();
      } else if (p.type === 'field') {
        if (p.fieldname === 'format') format = String(p.value) || 'jpeg';
        if (p.fieldname === 'quality') quality = Number(p.value) || 85;
      }
    }
    if (!fileData) return fail(reply, 400, '缺少图片文件');
    if (fileData.length > 100 * 1024 * 1024) return fail(reply, 400, '图片超过 100MB 上限');
    const fmt = format === 'png' ? 'png' : format === 'webp' ? 'webp' : 'jpeg';
    try {
      const out = await compressImage(fileData, fmt, quality);
      const ct = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg';
      reply.header('Content-Type', ct);
      reply.header('Content-Disposition', `inline; filename="processed.${fmt === 'jpeg' ? 'jpg' : fmt}"`);
      return reply.send(out);
    } catch (e: any) {
      return fail(reply, 400, e?.message || '图片处理失败');
    }
  });

  /** 创建视频转码任务 */
  app.post('/media/transcode', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const b = req.body as { storageId: number; path: string; destPath?: string; quality?: 'high' | 'medium' | 'low' };
    try {
      const id = transcodeService.create({
        userId: req.user!.sub,
        username: req.user!.username,
        storageId: b.storageId,
        path: b.path,
        destPath: b.destPath,
        quality: b.quality || 'medium',
      });
      return ok(reply, { taskId: id });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '创建转码任务失败');
    }
  });

  /** 查询转码任务列表 */
  app.get('/media/transcode', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    return ok(reply, { tasks: transcodeService.list(req.user!.sub) });
  });

  /** 取消转码任务 */
  app.delete('/media/transcode/:id', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    try {
      transcodeService.cancel(Number((req.params as any).id), req.user!.sub);
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '取消任务失败');
    }
  });
}
