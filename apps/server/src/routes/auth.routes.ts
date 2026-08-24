import type { FastifyInstance } from 'fastify';
import { authMiddleware, ok, fail } from '../auth/middleware.js';
import { signJwt } from '../auth/jwt.js';
import { jwtSecret } from '../config.js';
import {
  verifyLogin,
  findById,
  touchLogin,
  publicUser,
  createUser,
} from '../services/user.service.js';
import { profileService } from '../services/profile.service.js';
import { getSetting, settingNum } from '../services/settings.service.js';
import { sendWelcomeEmail, isSmtpEnabled } from '../services/email.service.js';
import { getUserPermissions } from '../services/role.service.js';
import {
  createCaptcha,
  verifyCaptcha,
  recordLoginFailure,
  clearLoginFailures,
  getFailureCount,
} from '../services/captcha.service.js';
import { getDb } from '../db/index.js';
import { verifyCode } from '../services/totp.service.js';
import { recordSession, parseDeviceName } from '../services/session.service.js';

export async function authRoutes(app: FastifyInstance) {
  // 获取验证码
  // P1-4 修复：响应只回 { id, image }，code 仅存内存 store，不返回明文
  // P1-5：验证码端点单独限流 10 次/分钟/IP（覆盖全局 300），防止验证码爆破
  app.get('/auth/captcha', { config: { rateLimit: { max: 10, timeWindow: 60000 } } }, async (_req, reply) => {
    const { id, image } = createCaptcha();
    return ok(reply, { id, image });
  });

  // P1-5：登录端点单独限流 5 次/分钟/IP（覆盖全局 300），防止密码爆破
  app.post('/auth/login', { config: { rateLimit: { max: 5, timeWindow: 60000 } } }, async (req, reply) => {
    const { username, password, captchaId, captchaCode, twoFactorCode } = (req.body || {}) as {
      username?: string;
      password?: string;
      captchaId?: string;
      captchaCode?: string;
      twoFactorCode?: string;
    };
    if (!username || !password) return fail(reply, 400, '请输入用户名和密码');

    // 检查是否需要验证码
    const threshold = settingNum('loginCaptchaThreshold', 3);
    const failCount = getFailureCount(username);
    if (threshold > 0 && failCount >= threshold) {
      if (!captchaId || !captchaCode) {
        return fail(reply, 401, '需要验证码', { requireCaptcha: true });
      }
      if (!verifyCaptcha(captchaId, captchaCode)) {
        return fail(reply, 401, '验证码错误', { requireCaptcha: true });
      }
    }

    const ip = req.ip;
    const ua = String(req.headers['user-agent'] || '');
    const u = verifyLogin(username, password);
    if (!u) {
      const count = recordLoginFailure(username);
      touchLogin(0, ip, ua, false);
      const needCaptcha = threshold > 0 && count >= threshold;
      return fail(reply, 401, '用户名或密码错误', { requireCaptcha: needCaptcha, failCount: count });
    }
    clearLoginFailures(username);

    // 检查是否启用 2FA
    const db = getDb();
    const twoFa = db.prepare('SELECT * FROM user_2fa WHERE user_id = ? AND enabled = 1').get(u.id) as any;
    if (twoFa) {
      if (!twoFactorCode) {
        // 需要 2FA 验证，返回临时 token 供前端进行第二步验证
        // P0-6 修复：临时 token 携带 type='2fa-temp' 标记，中间件拒绝其访问其他端点
        const tempToken = signJwt({ sub: u.id, username: u.username, role: u.role, type: '2fa-temp' }, jwtSecret, 300); // 5 分钟临时 token
        return ok(reply, {
          requiresTwoFactor: true,
          tempToken,
          user: { ...publicUser(u), avatar: profileService.get(u.id).avatar || '' },
        });
      }
      // 验证 2FA 代码
      if (!verifyCode(twoFa.secret, parseInt(twoFactorCode, 10))) {
        // 检查恢复码
        const codes: string[] = JSON.parse(twoFa.recovery_codes || '[]');
        if (!codes.includes(twoFactorCode.toUpperCase())) {
          return fail(reply, 401, '验证码错误');
        }
        // 使用恢复码
        codes.splice(codes.indexOf(twoFactorCode.toUpperCase()), 1);
        db.prepare('UPDATE user_2fa SET recovery_codes = ?, updated_at = datetime(\'now\') WHERE user_id = ?')
          .run(JSON.stringify(codes), u.id);
      }
    }

    touchLogin(u.id, ip, ua, true);
    const ttlSec = settingNum('sessionTimeoutHours', 168) * 3600;
    const token = signJwt({ sub: u.id, username: u.username, role: u.role }, jwtSecret, ttlSec);
    // 记录会话
    recordSession(u.id, token, parseDeviceName(ua), ip, ua);
    const profile = profileService.get(u.id);
    return ok(reply, { token, user: { ...publicUser(u), avatar: profile.avatar || '', permissions: getUserPermissions(u.role) } });
  });

  /** 2FA 登录第二步：验证 2FA 代码，颁发完整 token */
  app.post('/auth/login/2fa', async (req, reply) => {
    const { tempToken, code } = (req.body || {}) as { tempToken?: string; code?: string };
    if (!tempToken || !code) return fail(reply, 400, '缺少参数');

    // 验证临时 token
    const payload = (await import('../auth/jwt.js')).verifyJwt(tempToken, jwtSecret);
    if (!payload) return fail(reply, 401, '临时 token 无效或已过期');

    const db = getDb();
    const twoFa = db.prepare('SELECT * FROM user_2fa WHERE user_id = ? AND enabled = 1').get(payload.sub) as any;
    if (!twoFa) return fail(reply, 401, '2FA 未启用');

    // 验证 TOTP 代码
    if (verifyCode(twoFa.secret, parseInt(code, 10))) {
      const u = findById(payload.sub);
      if (!u) return fail(reply, 401, '用户不存在');
      const ttlSec = settingNum('sessionTimeoutHours', 168) * 3600;
      const token = signJwt({ sub: u.id, username: u.username, role: u.role }, jwtSecret, ttlSec);
      // 记录会话
      const ip = req.ip;
      const ua = String(req.headers['user-agent'] || '');
      recordSession(u.id, token, parseDeviceName(ua), ip, ua);
      const profile = profileService.get(u.id);
      return ok(reply, {
        token,
        user: { ...publicUser(u), avatar: profile.avatar || '', permissions: getUserPermissions(u.role) },
      });
    }

    // 检查恢复码
    const codes: string[] = JSON.parse(twoFa.recovery_codes || '[]');
    const idx = codes.indexOf(code.toUpperCase());
    if (idx !== -1) {
      codes.splice(idx, 1);
      db.prepare('UPDATE user_2fa SET recovery_codes = ?, updated_at = datetime(\'now\') WHERE user_id = ?')
        .run(JSON.stringify(codes), payload.sub);
      const u = findById(payload.sub);
      if (!u) return fail(reply, 401, '用户不存在');
      const ttlSec = settingNum('sessionTimeoutHours', 168) * 3600;
      const token = signJwt({ sub: u.id, username: u.username, role: u.role }, jwtSecret, ttlSec);
      // 记录会话
      const ip = req.ip;
      const ua = String(req.headers['user-agent'] || '');
      recordSession(u.id, token, parseDeviceName(ua), ip, ua);
      const profile = profileService.get(u.id);
      return ok(reply, {
        token,
        user: { ...publicUser(u), avatar: profile.avatar || '', permissions: getUserPermissions(u.role) },
      });
    }

    return fail(reply, 401, '验证码错误');
  });

  app.post('/auth/logout', { preHandler: authMiddleware }, async (req, reply) => {
    return ok(reply, { ok: true });
  });

  app.get('/auth/me', { preHandler: authMiddleware }, async (req, reply) => {
    const u = findById(req.user!.sub);
    if (!u) return fail(reply, 401, '用户不存在');
    const profile = profileService.get(u.id);
    return ok(reply, { ...publicUser(u), avatar: profile.avatar || '', permissions: getUserPermissions(u.role) });
  });

  app.post('/auth/register', async (req, reply) => {
    if (getSetting('registerEnabled') === 'false') return fail(reply, 403, '注册已关闭');
    const { username, password, displayName, email } = (req.body || {}) as {
      username?: string;
      password?: string;
      displayName?: string;
      email?: string;
    };
    if (!username || !password) return fail(reply, 400, '请输入用户名和密码');
    if (username.length < 3 || username.length > 32) return fail(reply, 400, '用户名长度 3-32');
    const minLen = settingNum('minPasswordLen', 8);
    if (password.length < minLen) return fail(reply, 400, `密码至少 ${minLen} 位`);
    const emailVal = (email || '').trim();
    if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      return fail(reply, 400, '邮箱格式不正确');
    }
    try {
      const u = createUser(username, password, 'user', displayName || '', 0);
      // 保存邮箱到用户资料
      if (emailVal) profileService.update(u.id, { email: emailVal });
      // SMTP 启用且填写了邮箱 → 发送欢迎邮件（尽力而为，不阻断注册）
      let emailSent = false;
      let emailError: string | undefined;
      if (isSmtpEnabled() && emailVal) {
        const r = await sendWelcomeEmail(emailVal, u.username, displayName || '');
        emailSent = r.ok;
        emailError = r.error;
      }
      const ttlSec = settingNum('sessionTimeoutHours', 168) * 3600;
      const token = signJwt({ sub: u.id, username: u.username, role: u.role }, jwtSecret, ttlSec);
      return ok(reply, { token, user: publicUser(u), emailSent, emailError });
    } catch (e: any) {
      return fail(reply, 409, e?.message?.includes('UNIQUE') ? '用户名已存在' : '注册失败');
    }
  });
}
