import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dirs } from '../config.js';

/**
 * P2-11 修复：存储凭据字段级加密（AES-256-GCM）
 * 密钥从 data/secret.key 文件派生（首次自动生成）
 */

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const keyFile = path.join(dirs.data, 'secret.key');
  if (!fs.existsSync(keyFile)) {
    // 首次生成密钥
    const key = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 });
    return key;
  }
  return Buffer.from(fs.readFileSync(keyFile, 'utf-8'), 'hex');
}

/** 加密单个字段值 */
export function encryptField(value: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // 格式: iv:encrypted:tag (base64)
  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${tag.toString('base64')}`;
}

/** 解密单个字段值 */
export function decryptField(encryptedValue: string): string {
  const [ivB64, encB64, tagB64] = encryptedValue.split(':');
  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const encBuf = Buffer.from(encB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encBuf), decipher.final()]).toString('utf-8');
}

/** 加密存储配置中的敏感字段 */
export function encryptStorageConfig(config: Record<string, any>): Record<string, any> {
  const sensitiveKeys = ['accessKeyId', 'secretAccessKey', 'password', 'token', 'username'];
  const result: Record<string, any> = { ...config };
  for (const key of sensitiveKeys) {
    if (result[key] && typeof result[key] === 'string') {
      result[key] = encryptField(result[key]);
    }
  }
  return result;
}

/** 若值处于加密格式（iv:enc:tag）则解密，否则原样返回（兼容历史明文数据） */
export function decryptFieldIfEncrypted(value: string): string {
  if (!value) return value;
  const parts = value.split(':');
  if (parts.length !== 3) return value;
  try {
    return decryptField(value);
  } catch {
    return value;
  }
}

/** 解密存储配置中的敏感字段 */
export function decryptStorageConfig(config: Record<string, any>): Record<string, any> {
  const sensitiveKeys = ['accessKeyId', 'secretAccessKey', 'password', 'token', 'username'];
  const result: Record<string, any> = { ...config };
  for (const key of sensitiveKeys) {
    if (result[key] && typeof result[key] === 'string') {
      try {
        // 尝试解密（格式: iv:encrypted:tag）
        const parts = result[key].split(':');
        if (parts.length === 3) {
          result[key] = decryptField(result[key]);
        }
      } catch {
        // 解密失败，保留原值
      }
    }
  }
  return result;
}
