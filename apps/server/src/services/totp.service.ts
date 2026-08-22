import { TOTP } from 'otpauth';
import crypto from 'node:crypto';

/**
 * TOTP 服务 - 使用 otpauth 库（标准实现）
 * 兼容 Google Authenticator / 1Password 等 TOTP 应用
 */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function toBase32(buf: Buffer): string {
  let result = '';
  let bits = 0;
  let value = 0;
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      result += B32[(value >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += B32[(value << (5 - bits)) & 31];
  }
  return result;
}

/** 生成 20 字节随机密钥（Base32 编码） */
export function generateSecret(): string {
  const raw = crypto.randomBytes(20);
  return toBase32(raw);
}

/** 生成 TOTP 6 位验证码 */
export function generateCode(secret: string, timeWindow = 30): number {
  const totp = new TOTP({
    secret,
    window: 1,
  });
  return parseInt(totp.generate(), 10);
}

/** 验证 TOTP 代码（允许前后 1 个时间窗口容错） */
export function verifyCode(secret: string, code: number, timeWindow = 30): boolean {
  const totp = new TOTP({
    secret,
    window: 1,
  });
  return totp.validate({ token: String(code).padStart(6, '0') }) !== null;
}

/** 生成恢复码（10 个，每个 8 位） */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const hex = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(hex);
  }
  return codes;
}

/** 生成 otpauth:// URI（供 QR 码扫描） */
export function getOtpAuthUri(secret: string, username: string, issuer = 'NebulaDrive'): string {
  const totp = new TOTP({
    name: username,
    issuer,
    secret,
    window: 1,
  });
  return totp.toString();
}
