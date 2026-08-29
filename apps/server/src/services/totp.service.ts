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
  const totp = new TOTP({ secret, period: timeWindow });
  return parseInt(totp.generate(), 10);
}

/** 验证 TOTP 代码（允许前后 1 个时间窗口容错） */
export function verifyCode(secret: string, code: number, timeWindow = 30): boolean {
  const totp = new TOTP({ secret, period: timeWindow });
  // window: 1 表示允许前后 1 个时间步长容错
  return totp.validate({ token: String(code).padStart(6, '0'), window: 1 }) !== null;
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

/** 恢复码哈希：统一大写后取 sha256 hex（恢复码仅以哈希形式入库） */
export function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

/**
 * 校验恢复码：存储项为 64 位 hex 视为哈希（比对哈希），否则按历史明文恒定时间比对。
 * 返回匹配项索引，未命中返回 -1。
 */
export function matchRecoveryCode(codes: string[], input: string): number {
  const normalized = input.trim().toUpperCase();
  const inputHash = hashRecoveryCode(normalized);
  return codes.findIndex((c) => {
    const stored = String(c);
    const target = /^[0-9a-f]{64}$/i.test(stored) ? inputHash : normalized;
    const a = Buffer.from(target);
    const b = Buffer.from(stored);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

/** 生成 otpauth:// URI（供 QR 码扫描） */
export function getOtpAuthUri(secret: string, username: string, issuer = 'NebulaDrive'): string {
  const totp = new TOTP({
    label: username,
    issuer,
    secret,
  });
  return totp.toString();
}
