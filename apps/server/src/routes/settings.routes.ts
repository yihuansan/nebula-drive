import type { FastifyInstance } from 'fastify';
import { requirePermission, ok, fail } from '../auth/middleware.js';
import { getAllSettings, setSetting, publicSettings } from '../services/settings.service.js';
import { dirs } from '../config.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 允许的背景图 MIME 与扩展名 */
const BG_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** 解析 multipart，取第一个 file 的 buffer 与 filename */
async function readUpload(req: any): Promise<{ data: Buffer; filename: string } | null> {
  let data: Buffer | null = null;
  let filename = '';
  for await (const p of req.parts()) {
    if (p.type === 'file' && !data) {
      data = await p.toBuffer();
      filename = p.filename || '';
    }
  }
  return data ? { data: data as Buffer, filename } : null;
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/settings', async (req, reply) => {
    return ok(reply, publicSettings());
  });

  app.put('/settings', { preHandler: requirePermission('settings:manage') }, async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    try {
      for (const [k, v] of Object.entries(b)) {
        setSetting(k, String(v));
      }
      return ok(reply, { settings: getAllSettings() });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '保存设置失败');
    }
  });

  /** 上传背景图到 data/backgrounds/，返回可公开访问的 URL */
  app.post('/settings/background', { preHandler: requirePermission('settings:manage') }, async (req, reply) => {
    try {
      const r = await readUpload(req);
      if (!r) return fail(reply, 400, '缺少文件');
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
      const ext = BG_MIME[mime] || path.extname(r.filename).replace('.', '').toLowerCase() || 'jpg';
      if (!BG_MIME[mime] && !['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
        return fail(reply, 400, '仅支持 jpg/png/webp/gif 背景图');
      }
      const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(dirs.backgrounds, name), r.data);
      const url = `/uploads/background/${name}`;
      return ok(reply, { url });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '背景上传失败');
    }
  });

  /** 上传 Logo 到 data/logo/，返回可公开访问的 URL */
  app.post('/settings/logo', { preHandler: requirePermission('settings:manage') }, async (req, reply) => {
    try {
      const r = await readUpload(req);
      if (!r) return fail(reply, 400, '缺少文件');
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
      const ext = BG_MIME[mime] || path.extname(r.filename).replace('.', '').toLowerCase() || 'png';
      if (!BG_MIME[mime] && !['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext)) {
        return fail(reply, 400, '仅支持 jpg/png/webp/gif/svg Logo');
      }
      // Logo 限制 2MB
      if (r.data.length > 2 * 1024 * 1024) {
        return fail(reply, 400, 'Logo 图片不能超过 2MB');
      }
      const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(dirs.logo, name), r.data);
      const url = `/uploads/logo/${name}`;
      return ok(reply, { url });
    } catch (e: any) {
      return fail(reply, 400, e?.message || 'Logo 上传失败');
    }
  });
}
