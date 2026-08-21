import { getDb } from '../db/index.js';

/**
 * 系统设置（键值表）。
 * 新增值：
 * - copyright / aboutText / contactEmail 基本信息
 * - minPasswordLen / sessionTimeoutHours 注册与安全
 * - maxFileSizeGB 上传限制
 * - shareDefaultExpireDays 分享默认有效期
 * - recycleRetentionDays 回收站自动清理（天，0=关闭）
 * - brandColor 品牌主题色（#hex，空=跟随主题）
 * - bgType 背景类型：theme(跟随主题)/image/gradient/color
 * - bgImage 背景图 URL（image 模式）
 * - bgGradientFrom / bgGradientTo / bgGradientAngle 渐变（gradient 模式）
 * - bgColor 纯色（color 模式）
 * - bgOverlay 背景遮罩强度 0-100（保证玻璃卡片可读）
 * - smtpEnabled / smtpHost / smtpPort / smtpSecure / smtpUser / smtpPassword
 *   smtpFrom / smtpFromName  SMTP 邮件服务（注册欢迎邮件 / 测试邮件）
 */
const DEFAULTS: Record<string, string> = {
  appName: 'NebulaDrive 星云网盘',
  logo: '',
  notice: '',
  registerEnabled: 'true',
  uploadChunkSize: '5242880',
  copyright: '',
  aboutText: '',
  contactEmail: '',
  minPasswordLen: '8',
  sessionTimeoutHours: '168',
  maxFileSizeGB: '0',
  shareDefaultExpireDays: '0',
  recycleRetentionDays: '0',
  brandColor: '',
  theme: 'light-glass',
  bgType: 'theme',
  bgImage: '',
  bgGradientFrom: '',
  bgGradientTo: '',
  bgGradientAngle: '135',
  bgColor: '',
  bgOverlay: '40',
  loginCaptchaThreshold: '3',
  smtpEnabled: 'false',
  smtpHost: '',
  smtpPort: '465',
  smtpSecure: 'true',
  smtpUser: '',
  smtpPassword: '',
  smtpFrom: '',
  smtpFromName: '',
};

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

/** 读取数值型设置，非法值回退默认 */
export function settingNum(key: string, def: number): number {
  const v = getSetting(key);
  if (v === null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function setSetting(key: string, value: string): void {
  getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULTS };
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** 公开设置（未登录可取：登录页 / 公开分享页 / 前端展示用） */
export function publicSettings() {
  const all = getAllSettings();
  return {
    appName: all.appName,
    logo: all.logo,
    notice: all.notice,
    registerEnabled: all.registerEnabled === 'true',
    uploadChunkSize: all.uploadChunkSize,
    copyright: all.copyright,
    aboutText: all.aboutText,
    contactEmail: all.contactEmail,
    minPasswordLen: settingNum('minPasswordLen', 8),
    maxFileSizeGB: settingNum('maxFileSizeGB', 0),
    shareDefaultExpireDays: settingNum('shareDefaultExpireDays', 0),
    brandColor: all.brandColor,
    theme: all.theme || 'light-glass',
    bgType: all.bgType || 'theme',
    bgImage: all.bgImage,
    bgGradientFrom: all.bgGradientFrom,
    bgGradientTo: all.bgGradientTo,
    bgGradientAngle: settingNum('bgGradientAngle', 135),
    bgColor: all.bgColor,
    bgOverlay: settingNum('bgOverlay', 40),
  };
}
