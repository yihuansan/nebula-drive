import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { requirePermission, ok, fail } from '../auth/middleware.js';
import { uploadService } from '../services/upload.service.js';
import { settingNum } from '../services/settings.service.js';
import { getDb } from '../db/index.js';
import { dirs } from '../config.js';
import { fileIndex } from '../services/fileIndex.service.js';
import { usageCache } from '../services/usageCache.service.js';

/** 单文件大小上限（字节）；0 = 不限制 */
function maxFileSizeBytes(): number {
  const gb = settingNum('maxFileSizeGB', 0);
  return gb > 0 ? Math.floor(gb * 1024 * 1024 * 1024) : 0;
}

/**
 * 解析 multipart 请求（@fastify/multipart v8）：
 * 遍历 parts，收集所有 field 与第一个 file 的二进制数据。
 * 注意：file 部分必须在循环内调用 toBuffer() 消费流，
 * 否则 parts() 迭代器不会结束，大文件会永久挂起。
 */
async function readMultipart(req: any): Promise<{ data: Buffer; fields: Record<string, string>; filename: string } | null> {
  const fields: Record<string, string> = {};
  let data: Buffer | null = null;
  let filename = '';
  for await (const p of req.parts()) {
    if (p.type === 'file') {
      const buf = await p.toBuffer();
      if (!data) {
        data = buf;
        filename = p.filename || '';
      }
    } else if (p.type === 'field') {
      fields[p.fieldname] = p.value;
    }
  }
  return data ? { data: data as Buffer, fields, filename } : null;
}

export async function uploadRoutes(app: FastifyInstance) {
  app.post('/upload/init', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const b = req.body as { storageId: number; path: string; name: string; size: number; chunkSize?: number };
    const maxBytes = maxFileSizeBytes();
    if (maxBytes > 0 && (b.size || 0) > maxBytes) {
      return fail(reply, 400, `超出单文件大小上限（${settingNum('maxFileSizeGB', 0)} GB）`);
    }
    try {
      const r = uploadService.init({
        storageId: b.storageId,
        path: b.path,
        name: b.name,
        size: b.size,
        chunkSize: b.chunkSize,
        userId: req.user!.sub,
      });
      return ok(reply, r);
    } catch (e: any) {
      return fail(reply, 400, e?.message || '初始化上传失败');
    }
  });

  // 分片上传：multipart（file 字段）或 raw 二进制体（query 传 uploadId/chunkIndex）
  // 分片上传是高频端点（大文件 = 数千个分片请求），豁免全局限流，
  // 避免 30GB 之类的大文件上传撞 300 次/分钟/IP 限流后把整个页面卡死。
  // 该端点已有 files:write 权限门槛 + 单片大小受限，滥用风险可控。
  app.post('/upload/chunk', { preHandler: requirePermission('files:write'), config: { rateLimit: false } }, async (req, reply) => {
    const isMultipart = String(req.headers['content-type'] || '').includes('multipart');
    let uploadId = '';
    let chunkIndex = 0;
    try {
      if (isMultipart) {
        const r = await readMultipart(req);
        if (!r) return fail(reply, 400, '缺少分片数据');
        uploadId = r.fields.uploadId || '';
        chunkIndex = Number(r.fields.chunkIndex || 0);
        await uploadService.chunk(uploadId, chunkIndex, r.data, req.user!.sub); // P2-1：绑定用户
      } else {
        const q = req.query as { uploadId?: string; chunkIndex?: string };
        uploadId = q.uploadId || '';
        chunkIndex = Number(q.chunkIndex || 0);
        const data = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body));
        await uploadService.chunk(uploadId, chunkIndex, data, req.user!.sub); // P2-1：绑定用户
      }
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '上传分片失败');
    }
  });

  /** 查询上传会话状态（断点续传：返回已收到的分片序号，前端跳过已传分片） */
  app.get('/upload/status', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const q = req.query as { uploadId?: string };
    const st = uploadService.status(q.uploadId || '', req.user!.sub);
    if (!st) return fail(reply, 404, '上传会话不存在');
    return ok(reply, st);
  });

  /** 列出当前用户未完成的上传会话（页面刷新后恢复上传队列） */
  app.get('/uploads', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    try {
      const rows = getDb().prepare('SELECT * FROM upload_sessions WHERE user_id = ? AND status = ? ORDER BY created_at DESC').all(req.user!.sub, 'uploading') as any[];
      return ok(reply, rows.map((r) => ({
        uploadId: r.upload_id,
        storageId: r.storage_id,
        name: r.name,
        destPath: r.dest_path,
        size: r.size,
        chunkSize: r.chunk_size,
        createdAt: r.created_at,
      })));
    } catch (e: any) {
      return fail(reply, 500, e?.message || '查询上传会话失败');
    }
  });

  /** 放弃上传会话（删除临时分片与元数据） */
  app.delete('/upload/:uploadId', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const st = uploadService.status((req.params as any).uploadId, req.user!.sub);
    if (!st) return fail(reply, 404, '上传会话不存在');
    const db = getDb();
    try {
      const row = db.prepare('SELECT storage_id FROM upload_sessions WHERE upload_id = ?').get((req.params as any).uploadId) as any;
      db.prepare('DELETE FROM upload_sessions WHERE upload_id = ?').run((req.params as any).uploadId);
      const dir = path.join(dirs.uploads, (req.params as any).uploadId);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      if (row) {
        try {
          fileIndex.markDirty(row.storage_id);
          usageCache.invalidate(row.storage_id);
        } catch { /* 忽略 */ }
      }
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '取消上传失败');
    }
  });

  app.post('/upload/complete', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const b = req.body as { uploadId: string };
    try {
      await uploadService.complete(b.uploadId, { username: req.user!.username, id: req.user!.sub });
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '完成上传失败');
    }
  });

  app.post('/upload/direct', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    try {
      const r = await readMultipart(req);
      if (!r) return fail(reply, 400, '缺少文件');
      const maxBytes = maxFileSizeBytes();
      if (maxBytes > 0 && r.data.length > maxBytes) {
        return fail(reply, 400, `超出单文件大小上限（${settingNum('maxFileSizeGB', 0)} GB）`);
      }
      const effectiveMax = maxBytes > 0 ? maxBytes : 500 * 1024 * 1024;
      if (r.data.length > effectiveMax) return fail(reply, 400, '单文件超过上限（500MB）');
      const storageId = Number(r.fields.storageId);
      const p = r.fields.path || '';
      const name = r.filename || r.fields.name || 'file';
      const destPath = p.endsWith('/') ? p + name : p;
      await uploadService.direct({ storageId, path: destPath, name }, r.data, {
        username: req.user!.username,
        id: req.user!.sub,
      });
      return ok(reply, { ok: true, path: destPath });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '直传失败');
    }
  });
}
