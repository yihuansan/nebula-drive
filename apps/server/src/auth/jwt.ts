import crypto from 'node:crypto';

function b64url(d: unknown): string {
  return Buffer.from(typeof d === 'string' ? d : JSON.stringify(d)).toString('base64url');
}

export interface JwtPayload {
  sub: number;
  username: string;
  role: 'admin' | 'user';
  /** 2FA 临时 token 标记；仅 /auth/login/2fa 可接受 */
  type?: '2fa-temp';
  iat: number;
  exp: number;
}

export function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, ttlSec = 7 * 86400): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body: JwtPayload = { ...payload, iat: now, exp: now + ttlSec };
  const h = b64url(header);
  const p = b64url(body);
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expect = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload as JwtPayload;
  } catch {
    return null;
  }
}
