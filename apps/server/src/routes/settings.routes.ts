import type { FastifyInstance } from 'fastify';
import { requirePermission, ok, fail } from '../auth/middleware.js';
import { getAllSettings, setSetting, publicSettings } from '../services/settings.service.js';
import { sendTestEmail, isSmtpConfigured } from '../services/email.service.js';
import { dirs } from '../config.js';
import { encryptField, decryptFieldIfEncrypted } from '../utils/crypto.js';
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

  /**
   * 完整设置（需 settings:view 权限）：返回全部键值，含 SMTP 等管理项。
   * 供管理员设置页加载使用；公开接口 /settings 不含敏感键。
   */
  app.get('/settings/all', { preHandler: requirePermission('settings:view') }, async (req, reply) => {
    return ok(reply, getAllSettings());
  });

  app.put('/settings', { preHandler: requirePermission('settings:manage') }, async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    try {
      for (const [k, v] of Object.entries(b)) {
        // SMTP 密码加密入库（读取时按需解密）
        if (k === 'smtpPassword' && String(v)) {
          const s = String(v);
          // 若已是密文（管理页回显未修改时），避免二次加密
          setSetting(k, decryptFieldIfEncrypted(s) === s ? encryptField(s) : s);
        } else {
          setSetting(k, String(v));
        }
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
      if (r.data.length > 10 * 1024 * 1024) return fail(reply, 400, '背景图不能超过 10MB');
      const buf = r.data;
      let valid = false;
      if (ext === 'jpg' || ext === 'jpeg') valid = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
      else if (ext === 'png') valid = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
      else if (ext === 'gif') valid = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
      else if (ext === 'webp') valid = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf.toString('ascii', 8, 12) === 'WEBP';
      if (!valid) return fail(reply, 400, '背景图格式不合法');
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
      if (!BG_MIME[mime] && !['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
        return fail(reply, 400, '仅支持 jpg/png/webp/gif Logo');
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

  /** SMTP 测试邮件：向指定邮箱发送一封测试邮件，用于验证配置 */
  app.post('/settings/smtp/test', { preHandler: requirePermission('settings:manage') }, async (req, reply) => {
    const { to } = (req.body || {}) as { to?: string };
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return fail(reply, 400, '请输入有效的测试邮箱地址');
    }
    if (!isSmtpConfigured()) {
      return fail(reply, 400, 'SMTP 尚未配置完整（需启用并填写服务器地址与发件邮箱）');
    }
    try {
      const r = await sendTestEmail(to);
      if (!r.ok) return fail(reply, 502, r.error || '测试邮件发送失败');
      return ok(reply, { ok: true, to });
    } catch (e: any) {
      return fail(reply, 502, e?.message || '测试邮件发送失败');
    }
  });
}
