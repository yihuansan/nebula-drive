import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { authMiddleware, ok, fail } from '../auth/middleware.js';
import { getDb } from '../db/index.js';
import {
  generateSecret,
  verifyCode,
  generateRecoveryCodes,
  getOtpAuthUri,
  hashRecoveryCode,
  matchRecoveryCode,
} from '../services/totp.service.js';
import { encryptField, decryptFieldIfEncrypted } from '../utils/crypto.js';

/** 2FA secret 加密入库；读取时解密（兼容历史明文） */
const plainSecret = (row: any): string => decryptFieldIfEncrypted(row?.secret || '');

export async function twoFactorRoutes(app: FastifyInstance) {
  /** 获取用户 2FA 状态 */
  app.get('/2fa/status', { preHandler: authMiddleware }, async (req, reply) => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM user_2fa WHERE user_id = ?').get(req.user!.sub) as any;
    if (!row) return ok(reply, { enabled: false });
    return ok(reply, {
      enabled: !!row.enabled,
      secret: row.enabled ? '' : plainSecret(row), // 未启用时返回 secret 供前端显示
    });
  });

  /** 启用 2FA：生成密钥，返回 QR 码 URI */
  app.post('/2fa/enable', { preHandler: authMiddleware }, async (req, reply) => {
    const db = getDb();
    const userId = req.user!.sub;
    const username = req.user!.username;

    // 检查是否已有记录
    const existing = db.prepare('SELECT * FROM user_2fa WHERE user_id = ?').get(userId) as any;
    if (existing?.enabled) {
      return fail(reply, 400, '2FA 已启用');
    }

    const secret = generateSecret();
    const uri = getOtpAuthUri(secret, username);

    if (existing) {
      db.prepare('UPDATE user_2fa SET secret = ?, enabled = 0, updated_at = datetime(\'now\') WHERE user_id = ?')
        .run(encryptField(secret), userId);
    } else {
      db.prepare('INSERT INTO user_2fa (user_id, secret, enabled) VALUES (?, ?, 0)').run(userId, encryptField(secret));
    }

    // 生成 QR 码 data URL
    const qrDataUrl = await QRCode.toDataURL(uri, { width: 200, margin: 2 });

    return ok(reply, { secret, qrUri: uri, qrDataUrl });
  });

  /** 验证并确认启用 2FA */
  app.post('/2fa/verify', { preHandler: authMiddleware }, async (req, reply) => {
    const { code } = (req.body || {}) as { code?: string };
    if (!code || code.length !== 6) return fail(reply, 400, '请输入 6 位验证码');

    const db = getDb();
    const userId = req.user!.sub;
    const row = db.prepare('SELECT * FROM user_2fa WHERE user_id = ?').get(userId) as any;
    if (!row) return fail(reply, 400, '请先启用 2FA');

    // 验证代码
    if (!verifyCode(plainSecret(row), parseInt(code, 10))) {
      return fail(reply, 400, '验证码错误');
    }

    // 生成恢复码并启用（仅存 sha256 哈希，明文只在本次响应中展示一次）
    const recoveryCodes = generateRecoveryCodes(10);
    const codesJson = JSON.stringify(recoveryCodes.map(hashRecoveryCode));
    db.prepare('UPDATE user_2fa SET enabled = 1, recovery_codes = ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(codesJson, userId);

    return ok(reply, { enabled: true, recoveryCodes });
  });

  /** 禁用 2FA */
  app.post('/2fa/disable', { preHandler: authMiddleware }, async (req, reply) => {
    const { code } = (req.body || {}) as { code?: string };
    const db = getDb();
    const userId = req.user!.sub;
    const row = db.prepare('SELECT * FROM user_2fa WHERE user_id = ?').get(userId) as any;
    if (!row?.enabled) return fail(reply, 400, '2FA 未启用');

    // 需要验证当前代码才能禁用
    if (!verifyCode(plainSecret(row), parseInt(code || '0', 10))) {
      return fail(reply, 400, '验证码错误，无法禁用');
    }

    db.prepare('UPDATE user_2fa SET enabled = 0, updated_at = datetime(\'now\') WHERE user_id = ?').run(userId);
    return ok(reply, { enabled: false });
  });

  /** 获取恢复码（已启用时）：仅返回历史明文码；新恢复码以哈希存储，无法再次查看 */
  app.get('/2fa/recovery-codes', { preHandler: authMiddleware }, async (req, reply) => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM user_2fa WHERE user_id = ? AND enabled = 1').get(req.user!.sub) as any;
    if (!row) return fail(reply, 400, '2FA 未启用');
    try {
      const codes: string[] = JSON.parse(row.recovery_codes || '[]');
      const visible = codes.filter((c) => !/^[0-9a-f]{64}$/i.test(String(c)));
      return ok(reply, { codes: visible, hiddenHashed: codes.length - visible.length });
    } catch {
      return ok(reply, { codes: [], hiddenHashed: 0 });
    }
  });

  /** 验证 2FA 代码（登录时用） */
  app.post('/2fa/verify-login', { preHandler: authMiddleware }, async (req, reply) => {
    const { code } = (req.body || {}) as { code?: string };
    if (!code) return fail(reply, 400, '请输入验证码');

    const db = getDb();
    const userId = req.user!.sub;
    const row = db.prepare('SELECT * FROM user_2fa WHERE user_id = ? AND enabled = 1').get(userId) as any;
    if (!row) return fail(reply, 400, '2FA 未启用');

    // 先检查 TOTP 代码
    if (verifyCode(plainSecret(row), parseInt(code, 10))) {
      return ok(reply, { verified: true, method: 'totp' });
    }

    // 再检查恢复码（库内存 sha256 哈希，兼容历史明文；命中后消耗）
    try {
      const codes: string[] = JSON.parse(row.recovery_codes || '[]');
      const idx = matchRecoveryCode(codes, code);
      if (idx !== -1) {
        codes.splice(idx, 1);
        db.prepare('UPDATE user_2fa SET recovery_codes = ?, updated_at = datetime(\'now\') WHERE user_id = ?')
          .run(JSON.stringify(codes), userId);
        return ok(reply, { verified: true, method: 'recovery', remaining: codes.length });
      }
    } catch { /* ignore */ }

    return fail(reply, 400, '验证码错误');
  });
}
