import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirs } from '../config.js';

/**
 * 服务端海报生成：用 ffmpeg 从视频 seek 到指定时间抽一帧，输出 JPEG。
 * 完全绕过浏览器端 <video> 捕获，对非 faststart / 大文件同样可靠。
 * 结果按 storageId+path+mtime 落盘缓存，避免重复抽帧。
 */

const VIDEO_EXTS = new Set(['mp4', 'm4v', 'mkv', 'mov', 'webm', 'avi', 'flv', 'wmv', 'ts', '3gp']);

let ffmpegBin: string | null = null;
let ffprobeBin: string | null = null;
let resolvePromise: Promise<void> | null = null;

/** 递归查找目录下名为 target 的文件，返回首个匹配的全路径 */
async function findFile(base: string, target: string, depth = 0): Promise<string | null> {
  if (depth > 4) return null;
  let items: fs.Dirent[];
  try { items = await fsp.readdir(base, { withFileTypes: true }); } catch { return null; }
  for (const it of items) {
    const full = path.join(base, it.name);
    if (it.isFile() && it.name === target) return full;
  }
  for (const it of items) {
    if (it.isDirectory()) {
      const found = await findFile(path.join(base, it.name), target, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** 在 data/ffmpeg 下查找 ffmpeg/ffprobe 可执行文件（兼容不同版本目录名） */
async function resolveBins(): Promise<void> {
  if (ffmpegBin && ffprobeBin) return;
  if (resolvePromise) { await resolvePromise; return; }
  resolvePromise = (async () => {
    const base = path.join(dirs.data, 'ffmpeg');
    if (!fs.existsSync(base)) return;
    ffmpegBin = await findFile(base, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    ffprobeBin = await findFile(base, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  })();
  await resolvePromise;
}

/** 允许通过环境变量覆盖 ffmpeg 路径（部署时指向系统 ffmpeg） */
export function configurePosterBins(ff: string, fp: string): void {
  ffmpegBin = ff;
  ffprobeBin = fp;
}

export function isPosterAvailable(): boolean {
  return Boolean(ffmpegBin && ffprobeBin);
}

/** 获取 ffmpeg/ffprobe 可执行文件路径（异步解析）；不可用时返回 null */
export async function getFfmpegBins(): Promise<{ ff: string; fp: string } | null> {
  await resolveBins();
  return ffmpegBin && ffprobeBin ? { ff: ffmpegBin, fp: ffprobeBin } : null;
}

export function isVideoExt(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTS.has(ext);
}

function cacheDir(): string {
  return path.join(dirs.data, 'poster-cache');
}

function cacheFileFor(storageId: number, relPath: string, mtimeMs: number, size: number, seekSec?: number): string {
  const key = crypto.createHash('sha1').update(`${storageId}|${relPath}|${mtimeMs}|${size}|${seekSec ?? ''}`).digest('hex');
  return path.join(cacheDir(), `${key}.jpg`);
}

/** 运行 ffprobe 取视频时长（秒）；失败返回 0 */
async function probeDuration(fp: string, file: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(fp, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    let out = '';
    const timer = setTimeout(() => { try { proc.kill(); } catch { /* noop */ } resolve(0); }, 15000);
    proc.stdout?.on('data', (d) => { out += d.toString(); });
    proc.on('error', () => { clearTimeout(timer); resolve(0); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        const v = parseFloat(out.trim());
        resolve(Number.isFinite(v) ? v : 0);
      } else resolve(0);
    });
  });
}

/** 用 ffmpeg seek 到 seekSec 抽一帧，缩放到最长边 480px，输出 JPEG 到 outFile */
async function extractFrame(ff: string, file: string, seekSec: number, outFile: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const args = ['-y', '-ss', seekSec.toFixed(2), '-i', file, '-frames:v', '1', '-update', '1', '-q:v', '2', '-vf', 'scale=-2:480', outFile];
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
 * 获取视频海报 JPEG 的 Buffer。
 * @param relPath  相对存储根的路径（用于缓存键，稳定）
 * @param fullPath 磁盘全路径（传给 ffmpeg/ffprobe）
 * @returns JPEG Buffer，或 null（无法生成）
 */
export async function getPoster(storageId: number, relPath: string, fullPath: string, mtimeMs: number, size: number, seekSec?: number): Promise<Buffer | null> {
  await resolveBins();
  if (!ffmpegBin || !ffprobeBin) return null;
  const ff = ffmpegBin;
  const fp = ffprobeBin;

  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true });
  const cacheFile = cacheFileFor(storageId, relPath, mtimeMs, size, seekSec);
  if (fs.existsSync(cacheFile)) {
    try { return fs.readFileSync(cacheFile); } catch { /* fall through to regenerate */ }
  }

  // 用临时文件生成，成功后原子改名，避免半截缓存。
  // 注意：ffmpeg 靠扩展名推断输出格式，临时文件必须以 .jpg 结尾，否则报 "Error opening output file"。
  const tmpFile = `${cacheFile}.tmp.${process.pid}.${Date.now()}.jpg`;
  try {
    const duration = await probeDuration(fp, fullPath);
    // 显式指定 seek 秒数时优先；否则 seek 到 8% 时长，最小 1s，最大 10s（多数视频 10s 内已有代表性画面）
    const seek = seekSec !== undefined ? Math.max(0, seekSec) : Math.min(Math.max(duration * 0.08, 1), 10);
    await extractFrame(ff, fullPath, seek, tmpFile);
    await fsp.rename(tmpFile, cacheFile);
    return fs.readFileSync(cacheFile);
  } catch (e: any) {
    console.error('[poster] 生成失败:', e?.message, 'file=', fullPath, 'tmp=', tmpFile);
    try { await fsp.rm(tmpFile, { force: true }); } catch { /* noop */ }
    return null;
  }
}
