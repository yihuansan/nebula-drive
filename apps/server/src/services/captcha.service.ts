import crypto from 'node:crypto';

/** 登录失败次数追踪（内存存储，进程重启后清零） */
const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();

/** 验证码存储（内存存储，5 分钟过期） */
const captchaStore = new Map<string, { code: string; expires: number }>();

/** 生成验证码 ID */
export function generateCaptchaId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** 生成 4 位数字验证码 */
export function generateCaptchaCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/** 创建验证码，返回 { id, code, image } */
export function createCaptcha(): { id: string; code: string; image: string } {
  const id = generateCaptchaId();
  const code = generateCaptchaCode();
  captchaStore.set(id, { code, expires: Date.now() + 5 * 60 * 1000 });
  const image = generateCaptchaImage(code);
  return { id, code, image };
}

/**
 * P1-4 修复：生成验证码 SVG 图片（base64），替代明文 code 返回。
 * 前端展示图片，用户看图输入，code 不直接返回。
 */
function generateCaptchaImage(code: string): string {
  const width = 160;
  const height = 56;
  // 生成干扰线
  const lines: string[] = [];
  for (let i = 0; i < 4; i++) {
    const x1 = Math.random() * width;
    const y1 = Math.random() * height;
    const x2 = Math.random() * width;
    const y2 = Math.random() * height;
    lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ccc" stroke-width="1"/>`);
  }
  // 生成数字
  const chars = code.split('');
  const charWidth = width / (chars.length + 1);
  const texts = chars.map((c, i) => {
    const x = charWidth * (i + 1) + (Math.random() * 6 - 3);
    const y = 38 + (Math.random() * 8 - 4);
    const rotate = Math.random() * 30 - 15;
    return `<text x="${x}" y="${y}" font-size="32" font-family="monospace" fill="#333" transform="rotate(${rotate}, ${x}, ${y})">${c}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#f5f5f5"/>
    ${lines.join('')}
    ${texts}
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** 验证验证码 */
export function verifyCaptcha(id: string, code: string): boolean {
  const entry = captchaStore.get(id);
  if (!entry) return false;
  if (Date.now() > entry.expires) {
    captchaStore.delete(id);
    return false;
  }
  if (entry.code !== code) return false;
  // 验证成功后删除（一次性使用）
  captchaStore.delete(id);
  return true;
}

/** 记录登录失败 */
export function recordLoginFailure(username: string): number {
  const key = username.toLowerCase();
  const entry = loginAttempts.get(key);
  const count = (entry?.count || 0) + 1;
  loginAttempts.set(key, { count, lastAttempt: Date.now() });
  return count;
}

/** 登录成功，清除失败记录 */
export function clearLoginFailures(username: string): void {
  loginAttempts.delete(username.toLowerCase());
}

/** 获取某用户的失败次数 */
export function getFailureCount(username: string): number {
  return loginAttempts.get(username.toLowerCase())?.count || 0;
}

/** 清理过期的验证码（定期调用） */
export function cleanupCaptchas(): void {
  const now = Date.now();
  for (const [id, entry] of captchaStore) {
    if (now > entry.expires) {
      captchaStore.delete(id);
    }
  }
}

/** 获取所有登录失败记录（用于管理界面） */
export function getAllFailures(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, entry] of loginAttempts) {
    result[key] = entry.count;
  }
  return result;
}
