import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function intEnv(name: string, dft: number): number {
  const v = process.env[name];
  if (!v) return dft;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dft;
}

const projectRoot = process.cwd();
const port = intEnv('PORT', 8080);

/** 持久化的 JWT 密钥：首次启动随机生成 */
function loadJwtSecret(dataDir: string): string {
  const f = path.join(dataDir, '.jwt-secret');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, secret, { mode: 0o600 });
  return secret;
}

export const config = {
  port,
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || path.join(projectRoot, 'data'),
  storageRoot: process.env.STORAGE_ROOT || path.join(projectRoot, 'storage'),
  appName: process.env.APP_NAME || 'NebulaDrive 星云网盘',
  appUrl: process.env.APP_URL || `http://localhost:${port}`,
  uploadChunkSize: intEnv('UPLOAD_CHUNK_SIZE', 5 * 1024 * 1024),
} as const;

export const dirs = {
  data: config.dataDir,
  db: path.join(config.dataDir, 'nebula.db'),
  uploads: path.join(config.dataDir, 'uploads'),
  recycle: path.join(config.dataDir, 'recycle'),
  storageRoot: config.storageRoot,
  backgrounds: path.join(config.dataDir, 'backgrounds'),
  logo: path.join(config.dataDir, 'logo'),
  jwtSecretFile: path.join(config.dataDir, '.jwt-secret'),
} as const;

/** 初始化目录结构 */
export function ensureDirs(): void {
  for (const d of [dirs.data, dirs.uploads, dirs.recycle, dirs.storageRoot, dirs.backgrounds, dirs.logo]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

export let jwtSecret = '';
export function initJwtSecret(): void {
  jwtSecret = process.env.JWT_SECRET || loadJwtSecret(dirs.data);
}
