import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirs } from '../config.js';

/**
 * 服务端视频处理：自动 faststart（moov 前置），让浏览器能边下边播。
 * 完全透明——用户上传后无需手动转格式，服务端自动处理。
 *
 * 原理：MP4 的 moov atom（索引）如果在文件末尾，浏览器必须下载整个文件才能解码。
 * faststart 把 moov 移到文件开头，浏览器下载前几 MB 就能开始播放。
 *
 * 实现：`ffmpeg -c copy -movflags +faststart` 纯重排 atom，不重编码，质量无损。
 * 7.3GB 电影约 9 秒（纯 I/O），用户无感。
 */

// 与 poster.service 共享 ffmpeg 定位逻辑（独立一份，避免跨服务耦合）
let ffmpegBin: string | null = null;
let resolvePromise: Promise<void> | null = null;

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

async function resolveBins(): Promise<void> {
  if (ffmpegBin) return;
  if (resolvePromise) { await resolvePromise; return; }
  resolvePromise = (async () => {
    const base = path.join(dirs.data, 'ffmpeg');
    if (!fs.existsSync(base)) return;
    ffmpegBin = await findFile(base, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  })();
  await resolvePromise;
}

export function isVideoProcessAvailable(): boolean {
  return Boolean(ffmpegBin);
}

/** 仅 MP4/M4V 需要 faststart（其它容器浏览器本身不支持流式或已有自己的机制） */
const FASTSTART_EXTS = new Set(['mp4', 'm4v']);

export function needsFaststartExt(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return FASTSTART_EXTS.has(ext);
}

/**
 * 检测 MP4 是否 faststart：读文件头，找 moov atom 是否在 mdat 之前。
 * 支持 64-bit large atom（>4GB 文件）。
 * 读不到足够数据时保守返回 false（触发转换，ffmpeg 会幂等处理）。
 */
export async function isFaststart(fullPath: string): Promise<boolean> {
  try {
    const fh = await fsp.open(fullPath, 'r');
    try {
      // 读前 1MB（moov 通常在文件头几 MB 内）
      const buf = Buffer.alloc(1024 * 1024);
      await fh.read(buf, 0, buf.length, 0);
      const data = buf;

      // 遍历 top-level atoms
      let off = 0;
      let moovPos = -1;
      let mdatPos = -1;
      while (off + 8 <= data.length) {
        let size = data.readUInt32BE(off);
        const type = data.toString('ascii', off + 4, off + 8);
        // 64-bit large atom：size=1 表示真实大小在后续 8 字节
        if (size === 1) {
          if (off + 16 > data.length) break;
          size = data.readBigUInt64BE(off + 8) as unknown as number;
        }
        if (size < 8) break; // 非法
        if (type === 'moov' && moovPos < 0) moovPos = off;
        if (type === 'mdat' && mdatPos < 0) mdatPos = off;
        off += size;
        // 如果 moov 和 mdat 都找到了，可以提前判断
        if (moovPos >= 0 && mdatPos >= 0) break;
      }

      // faststart: moov 在 mdat 之前（或没有 mdat）
      if (moovPos < 0) return false; // 前 1MB 没找到 moov，大概率 non-faststart
      return mdatPos < 0 || moovPos < mdatPos;
    } finally {
      await fh.close();
    }
  } catch {
    return false; // 读不到时保守返回 false
  }
}

/**
 * 确保视频是 faststart：如果 non-faststart，用 ffmpeg 转成 faststart（-c copy，不重编码）。
 * 返回 true 表示已 faststart（无需转换或转换成功），false 表示转换失败。
 *
 * 策略：
 * 1. 先检测是否已 faststart，是则直接返回。
 * 2. 否则 ffmpeg 转换到临时文件，成功后原子替换原文件。
 * 3. 原文件保留为 .bak（用户可手动删除）。
 */
export async function ensureFaststart(fullPath: string): Promise<boolean> {
  await resolveBins();
  if (!ffmpegBin) return false;
  const ff = ffmpegBin;

  // 1. 检测是否已 faststart
  if (await isFaststart(fullPath)) return true;

  // 2. ffmpeg 转换（tmp 文件与源文件同目录，短名避免 Windows 路径超限）
  const tmpFile = path.join(path.dirname(fullPath), `.fs_tmp_${process.pid}_${Date.now()}.mp4`);
  try {
    await new Promise<void>((resolve, reject) => {
      const args = ['-y', '-i', fullPath, '-c', 'copy', '-movflags', '+faststart', tmpFile];
      const proc = spawn(ff, args);
      let err = '';
      // 大文件转换可能需要较长时间（7.3GB 约 9 秒），给 5 分钟超时
      const timer = setTimeout(() => { try { proc.kill(); } catch { /* noop */ } reject(new Error('ffmpeg 超时')); }, 300000);
      proc.stderr?.on('data', (d) => { err += d.toString(); });
      proc.on('error', (e) => { clearTimeout(timer); reject(e); });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg 退出码 ${code}: ${err.slice(-300)}`));
      });
    });

    // 3. 验证转换结果
    if (!(await isFaststart(tmpFile))) {
      throw new Error('转换后仍非 faststart');
    }

    // 4. 原子替换：原文件 → .bak，临时文件 → 原文件名
    const bakFile = `${fullPath}.bak`;
    await fsp.rename(fullPath, bakFile);
    await fsp.rename(tmpFile, fullPath);
    return true;
  } catch (e: any) {
    console.error('[videoProcess] faststart 转换失败:', e?.message, 'file=', fullPath);
    try { await fsp.rm(tmpFile, { force: true }); } catch { /* noop */ }
    return false;
  }
}

// 进行中的转换记录（按文件路径去重，避免并发请求重复触发 ffmpeg 转换）
const inflight = new Map<string, Promise<unknown>>();

/**
 * 异步确保 faststart（不阻塞调用方响应）。
 * 失败只记日志，不影响主流程。同一文件并发调用只触发一次转换。
 */
export function ensureFaststartAsync(fullPath: string): void {
  const key = path.resolve(fullPath);
  if (inflight.has(key)) return;
  const p = ensureFaststart(fullPath)
    .catch((e) => {
      console.error('[videoProcess] 异步 faststart 失败:', e?.message);
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
}
