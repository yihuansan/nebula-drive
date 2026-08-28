import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirs } from '../config.js';
import { getFfmpegBins } from './poster.service.js';

/**
 * 图片处理（ffmpeg 实现，零新增依赖）：
 * - compressImage：重编码/压缩（jpeg/png/webp），质量 1-100
 * - getThumbnail：视频/图片缩略图（按 存储+路径+mtime+尺寸 落盘缓存）
 */

function runFfmpeg(ff: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ff, args);
    let err = '';
    const timer = setTimeout(() => { try { proc.kill(); } catch { /* noop */ } reject(new Error('ffmpeg 超时')); }, 60000);
    proc.stderr?.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 退出码 ${code}: ${err.slice(-300)}`));
    });
  });
}

/**
 * 重编码/压缩图片。
 * @param input    图片 Buffer（任意格式：jpg/png/webp 等 ffmpeg 可识别的）
 * @param format   输出格式 jpeg | png | webp
 * @param quality  质量 1-100（jpeg/webp 生效；png 无损）
 * @returns 输出 Buffer
 */
export async function compressImage(input: Buffer, format: 'jpeg' | 'png' | 'webp', quality: number): Promise<Buffer> {
  const bins = await getFfmpegBins();
  if (!bins) throw new Error('ffmpeg 不可用');
  const ff = bins.ff;
  const ext = format === 'jpeg' ? '.jpg' : `.${format}`;
  const dir = path.join(dirs.data, 'image-process');
  fs.mkdirSync(dir, { recursive: true });
  const inFile = path.join(dir, `in-${process.pid}-${Date.now()}`);
  const outFile = `${dir}/out-${process.pid}-${Date.now()}.${crypto.randomBytes(4).toString('hex')}${ext}`;
  try {
    await fsp.writeFile(inFile, input);
    const args = ['-y', '-i', inFile];
    // jpeg/webp 支持质量参数（ffmpeg q:v 2=最好 31=最差）；png 无损
    if (format !== 'png') {
      const q = Math.max(1, Math.min(100, Math.round(quality)));
      const qv = 31 - Math.round((q / 100) * 29); // quality 100 → qv 2, quality 20 → qv 25
      args.push('-q:v', String(qv));
    }
    args.push(outFile);
    await runFfmpeg(ff, args);
    const out = await fsp.readFile(outFile);
    await fsp.rm(inFile, { force: true });
    return out;
  } catch (e: any) {
    await fsp.rm(inFile, { force: true }).catch(() => { /* noop */ });
    await fsp.rm(outFile, { force: true }).catch(() => { /* noop */ });
    throw new Error(e?.message || '图片处理失败');
  }
}

function thumbCacheDir(): string {
  return path.join(dirs.data, 'thumb-cache');
}

function thumbCacheFile(key: string): string {
  return path.join(thumbCacheDir(), `${key}.jpg`);
}

/**
 * 生成/获取文件缩略图（JPEG，最长边 maxSide px）。
 * 缓存键含 mtime+size，文件变更后自动重新生成。
 * @returns JPEG Buffer 或 null
 */
export async function getThumbnail(storageId: number, relPath: string, fullPath: string, mtimeMs: number, size: number, maxSide: number): Promise<Buffer | null> {
  const bins = await getFfmpegBins();
  if (!bins) return null;
  const ff = bins.ff;
  const key = crypto.createHash('sha1').update(`${storageId}|${relPath}|${mtimeMs}|${size}|${maxSide}`).digest('hex');
  const cacheFile = thumbCacheFile(key);
  if (fs.existsSync(cacheFile)) {
    try {
      return fs.readFileSync(cacheFile);
    } catch { /* 重新生成 */ }
  }
  const dir = thumbCacheDir();
  fs.mkdirSync(dir, { recursive: true });
  const tmpFile = `${cacheFile}.tmp.${process.pid}.${Date.now()}.jpg`;
  try {
    await runFfmpeg(ff, ['-y', '-i', fullPath, '-vf', `scale=-2:${maxSide}`, '-q:v', '3', tmpFile]);
    await fsp.rename(tmpFile, cacheFile);
    return fs.readFileSync(cacheFile);
  } catch (e: any) {
    console.error('[thumbnail] 生成失败:', e?.message, 'file=', fullPath);
    await fsp.rm(tmpFile, { force: true }).catch(() => { /* noop */ });
    return null;
  }
}
