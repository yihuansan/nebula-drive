import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { getDb } from '../db/index.js';
import { getFfmpegBins } from './poster.service.js';
import { getStorageRecord } from './file.service.js';
import { getDriver } from '../storage/registry.js';
import { LocalDriver } from '../storage/local.js';
import { fileIndex } from './fileIndex.service.js';
import { usageCache } from './usageCache.service.js';
import { opLog } from './log.service.js';

/**
 * 视频转码任务系统：
 * - ffmpeg 后台转码（libx264/libvpx），stderr 解析 time= 计算进度
 * - 任务持久化到 transcode_tasks 表；最多 2 个并发，其余排队
 * - 支持取消（kill 进程）
 */

const VIDEO_EXTS = new Set(['mp4', 'm4v', 'mkv', 'mov', 'webm', 'avi', 'flv', 'wmv', 'ts', '3gp']);
const OUTPUT_EXTS = new Set(['mp4', 'webm']);

type Quality = 'high' | 'medium' | 'low';

interface Task {
  id: number;
  userId: number;
  username: string;
  storageId: number;
  srcPath: string;
  destPath: string;
  quality: Quality;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  error: string;
  canceled?: boolean;
  duration?: number;
  proc?: ChildProcess;
}

const running = new Map<number, Task>(); // id -> 运行中任务（含 proc 句柄）
let activeCount = 0;

function isVideo(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTS.has(ext);
}

function ffmpegArgs(destPath: string, quality: Quality): string[] {
  const args = ['-y'];
  if (destPath.toLowerCase().endsWith('.webm')) {
    const bitrate = quality === 'high' ? '2500k' : quality === 'medium' ? '1200k' : '600k';
    if (quality === 'low') args.push('-vf', 'scale=-2:540');
    return [...args, '-c:v', 'libvpx', '-b:v', bitrate, '-c:a', 'libopus'];
  }
  const crf = quality === 'high' ? '20' : quality === 'medium' ? '23' : '28';
  if (quality === 'low') args.push('-vf', 'scale=-2:720');
  return [...args, '-c:v', 'libx264', '-preset', 'fast', '-crf', crf, '-c:a', 'aac'];
}

/** 取视频时长（秒）；失败返回 0 */
function probeDuration(fp: string, file: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(fp, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    let out = '';
    const timer = setTimeout(() => resolve(0), 15000);
    p.stdout?.on('data', (d) => { out += d.toString(); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        const v = parseFloat(out.trim());
        resolve(Number.isFinite(v) ? v : 0);
      } else resolve(0);
    });
    p.on('error', () => { clearTimeout(timer); resolve(0); });
  });
}

function execTranscode(task: Task): Promise<void> {
  return new Promise((resolve, reject) => {
    void (async () => {
      const bins = await getFfmpegBins();
      if (!bins) return reject(new Error('ffmpeg 不可用'));
      const rec = getStorageRecord(task.storageId);
      if (!rec || rec.type !== 'local') return reject(new Error('仅本地存储支持转码'));
      const driver = getDriver(rec) as unknown as LocalDriver;
      const srcFull = driver.resolveFull(task.srcPath);
      const destFull = driver.resolveFull(task.destPath);
      try {
        await fsp.stat(srcFull);
      } catch {
        return reject(new Error('源文件不存在'));
      }
      const args = ['-v', 'error', '-i', srcFull, ...ffmpegArgs(task.destPath, task.quality), destFull];
      const proc = spawn(bins.ff, args);
      task.proc = proc;
      let err = '';
      proc.stderr?.on('data', (d) => {
        err += d.toString();
        // 从 stderr 解析 time= 计算进度
        const matches = err.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g);
        if (matches && task.duration && task.duration > 0 && task.progress < 100) {
          const last = matches[matches.length - 1];
          const nums = last.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
          if (nums) {
            const t = Number(nums[1]) * 3600 + Number(nums[2]) * 60 + Number(nums[3]);
            task.progress = Math.min(99, Math.round((t / task.duration) * 100));
            try {
              getDb().prepare('UPDATE transcode_tasks SET progress = ? WHERE id = ?').run(task.progress, task.id);
            } catch { /* 忽略 */ }
          }
        }
      });
      proc.on('error', (e) => { try { proc.kill(); } catch { /* noop */ } reject(e); });
      proc.on('close', (code) => {
        delete task.proc;
        if (code === 0) resolve();
        else if (task.canceled) reject(new Error('已取消'));
        else reject(new Error(`ffmpeg 退出码 ${code}: ${err.slice(-300)}`));
      });
    })().catch(reject);
  });
}

export const transcodeService = {
  /** 创建转码任务（异步入队，最多 2 个并发） */
  create(params: { userId: number; username: string; storageId: number; path: string; destPath?: string; quality?: Quality }): number {
    const db = getDb();
    const name = params.path.split('/').filter(Boolean).pop() || '';
    if (!isVideo(name)) throw new Error('非视频文件');
    const quality: Quality = params.quality || 'medium';
    const base = name.replace(/\.[^.]*$/, '');
    const destDir = params.destPath ? (params.destPath.endsWith('/') ? params.destPath : params.destPath + '/') : '';
    const ext = params.destPath ? path.extname(params.destPath) : '.mp4';
    if (!OUTPUT_EXTS.has(ext.toLowerCase().replace('.', ''))) throw new Error('仅支持输出 mp4 / webm');
    const destPath = destDir + `${base}-converted${ext}`;
    const res = db.prepare(
      "INSERT INTO transcode_tasks (user_id, storage_id, src_path, dest_path, status, progress, error) VALUES (?, ?, ?, ?, 'queued', 0, '')"
    ).run(params.userId, params.storageId, params.path, destPath);
    const id = Number(res.lastInsertRowid);
    const task: Task = {
      id,
      userId: params.userId,
      username: params.username,
      storageId: params.storageId,
      srcPath: params.path,
      destPath,
      quality,
      status: 'queued',
      progress: 0,
      error: '',
    };

    void (async () => {
      const start = async () => {
        try {
          if (activeCount >= 2) {
            await new Promise((r) => setTimeout(r, 1000));
            return start();
          }
          activeCount++;
          task.status = 'running';
          try { db.prepare('UPDATE transcode_tasks SET status = ? WHERE id = ?').run('running', task.id); } catch { /* 忽略 */ }
          running.set(task.id, task);
          const bins = await getFfmpegBins();
          if (!bins) throw new Error('ffmpeg 不可用');
          const rec = getStorageRecord(task.storageId);
          if (!rec || rec.type !== 'local') throw new Error('仅本地存储支持转码');
          const driver = getDriver(rec) as unknown as LocalDriver;
          task.duration = await probeDuration(bins.fp, driver.resolveFull(task.srcPath));
          await execTranscode(task);
          task.status = 'done';
          task.progress = 100;
          try {
            db.prepare("UPDATE transcode_tasks SET status = 'done', progress = 100, finished_at = datetime('now') WHERE id = ?").run(task.id);
          } catch { /* 忽略 */ }
          try {
            fileIndex.markDirty(task.storageId);
            usageCache.invalidate(task.storageId);
          } catch { /* 忽略 */ }
          opLog(task.userId, task.username, 'transcode', `${task.srcPath} -> ${task.destPath}`);
        } catch (e: any) {
          task.status = 'error';
          task.error = e?.message || '转码失败';
          try {
            db.prepare("UPDATE transcode_tasks SET status = 'error', error = ?, finished_at = datetime('now') WHERE id = ?").run(task.error, task.id);
          } catch { /* 忽略 */ }
        } finally {
          activeCount--;
          running.delete(task.id);
        }
      };
      void start();
    })();
    return id;
  },

  /** 列出用户的转码任务 */
  list(userId: number): any[] {
    try {
      return getDb().prepare('SELECT * FROM transcode_tasks WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(userId) as any[];
    } catch {
      return [];
    }
  },

  /** 取消任务 */
  cancel(taskId: number, userId: number): void {
    const db = getDb();
    const row = db.prepare('SELECT * FROM transcode_tasks WHERE id = ? AND user_id = ?').get(taskId, userId) as any;
    if (!row) throw new Error('任务不存在');
    const rt = running.get(taskId);
    if (rt) {
      rt.canceled = true;
      try { rt.proc?.kill(); } catch { /* noop */ }
    }
    try {
      db.prepare("UPDATE transcode_tasks SET status = 'error', error = '已取消', finished_at = datetime('now') WHERE id = ? AND status IN ('queued','running')").run(taskId);
    } catch { /* 忽略 */ }
  },
};
