import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getDb } from '../db/index.js';
import { getDriver } from '../storage/registry.js';
import { LocalDriver } from '../storage/local.js';
import { dirs, config } from '../config.js';
import { opLog } from './log.service.js';
import { fileIndex } from './fileIndex.service.js';
import { usageCache } from './usageCache.service.js';
import { ensureFaststartAsync, needsFaststartExt } from './videoProcess.service.js';

/** P2-5/P2-6: 上传完成后使搜索索引与用量缓存失效 */
function invalidateCaches(storageId: number): void {
  try {
    fileIndex.markDirty(storageId);
    usageCache.invalidate(storageId);
  } catch {
    // 缓存失效失败不影响主流程
  }
}

interface UploadMeta {
  uploadId: string;
  storageId: number;
  destPath: string;
  name: string;
  size: number;
  chunkSize: number;
  received: number;
  status: 'uploading' | 'completed';
  createdAt: number;
  /** P2-1 修复：绑定用户 ID，防止跨用户操作 */
  userId?: number;
}

/**
 * 会话元数据以 DB 为准（upload_sessions 表，持久化支持断点续传），
 * memory Map 仅作热路径缓存，重启后从 DB 恢复。
 */
const memory = new Map<string, UploadMeta>();

function tmpDir(uploadId: string): string {
  return path.join(dirs.uploads, uploadId);
}

function loadFromDb(uploadId: string): UploadMeta | null {
  try {
    const row = getDb().prepare('SELECT * FROM upload_sessions WHERE upload_id = ?').get(uploadId) as any;
    if (!row || row.status !== 'uploading') return null;
    return {
      uploadId: row.upload_id,
      storageId: row.storage_id,
      destPath: row.dest_path,
      name: row.name,
      size: row.size,
      chunkSize: row.chunk_size,
      received: row.received,
      status: 'uploading',
      createdAt: row.created_at,
      userId: row.user_id,
    };
  } catch {
    return null;
  }
}

function getMeta(uploadId: string): UploadMeta | null {
  return memory.get(uploadId) || loadFromDb(uploadId) || null;
}

function persistMeta(m: UploadMeta): void {
  try {
    getDb().prepare(
      'INSERT INTO upload_sessions (upload_id, user_id, storage_id, dest_path, name, size, chunk_size, received, status, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT (upload_id) DO UPDATE SET received = excluded.received, status = excluded.status'
    ).run(m.uploadId, m.userId || 0, m.storageId, m.destPath, m.name, m.size, m.chunkSize, m.received, m.status, m.createdAt);
  } catch {
    // DB 写入失败时仍保留内存态，不影响本次上传
  }
}

export const uploadService = {
  init(params: { storageId: number; path: string; name: string; size: number; chunkSize?: number; userId?: number }): { uploadId: string; chunkSize: number } {
    const db = getDb();
    const rec = db.prepare('SELECT * FROM storages WHERE id = ? AND enabled = 1').get(params.storageId) as any;
    if (!rec) throw new Error('存储不存在或已禁用');
    const uploadId = crypto.randomUUID();
    const chunkSize = params.chunkSize || config.uploadChunkSize;
    const dir = tmpDir(uploadId);
    fs.mkdirSync(dir, { recursive: true });
    const destDir = params.path.endsWith('/') ? params.path : params.path + '/';
    const meta: UploadMeta = {
      uploadId,
      storageId: params.storageId,
      destPath: destDir + params.name,
      name: params.name,
      size: params.size,
      chunkSize,
      received: 0,
      status: 'uploading',
      createdAt: Date.now(),
      userId: params.userId, // P2-1 修复：绑定用户
    };
    memory.set(uploadId, meta);
    persistMeta(meta); // 持久化，支持断点续传
    return { uploadId, chunkSize };
  },

  /** 查询会话状态（含已收到的分片序号，供前端断点续传跳过已传分片） */
  status(uploadId: string, userId?: number): { chunkSize: number; size: number; totalChunks: number; receivedChunks: number[] } | null {
    const m = getMeta(uploadId);
    if (!m) return null;
    if (m.userId !== undefined && m.userId !== userId) return null;
    let receivedChunks: number[] = [];
    try {
      receivedChunks = fs.readdirSync(tmpDir(uploadId)).filter((f) => /^\d+$/.test(f)).map(Number);
    } catch {
      receivedChunks = [];
    }
    return { chunkSize: m.chunkSize, size: m.size, totalChunks: Math.ceil(m.size / m.chunkSize), receivedChunks };
  },

  async chunk(uploadId: string, chunkIndex: number, body: Buffer, userId?: number): Promise<void> {
    const m = getMeta(uploadId);
    if (!m) throw new Error('上传会话不存在');
    // P2-1 修复：校验用户身份
    if (m.userId !== undefined && m.userId !== userId) throw new Error('无权操作此上传会话');
    if (m.status === 'completed') throw new Error('上传已完成');
    const expected = Math.ceil(m.size / m.chunkSize);
    if (chunkIndex >= expected) throw new Error('分片序号越界');
    if (body.length > m.chunkSize) throw new Error('分片大小超出 chunkSize');
    if (m.received + body.length > m.size) throw new Error('累计字节超出声明大小');
    await fsp.writeFile(path.join(tmpDir(uploadId), String(chunkIndex)), body);
    m.received += body.length;
    // 同步更新 DB（原子自增，避免并发覆盖）
    try {
      getDb().prepare('UPDATE upload_sessions SET received = received + ? WHERE upload_id = ?').run(body.length, uploadId);
    } catch {
      // 忽略
    }
  },

  async complete(uploadId: string, user?: { username: string; id?: number }): Promise<void> {
    const m = getMeta(uploadId);
    if (!m) throw new Error('上传会话不存在');
    // P2-1 修复：校验用户身份
    if (m.userId !== undefined && m.userId !== user?.id) throw new Error('无权操作此上传会话');
    if (m.status === 'completed') return;
    m.status = 'completed';
    try {
      const dir = tmpDir(uploadId);
      const chunks = fs.readdirSync(dir).filter((f) => /^\d+$/.test(f)).sort((a, b) => Number(a) - Number(b));
      const total = Math.ceil(m.size / m.chunkSize);
      if (chunks.length < total) {
        throw new Error(`分片不完整: ${chunks.length}/${total}`);
      }
      const rec = getDb().prepare('SELECT * FROM storages WHERE id = ?').get(m.storageId) as any;
      const driver = getDriver(rec);
      // P1-3 修复：流式合并分片，避免全量读入内存
      let chunkIndex = 0;
      const stream = new Readable({
        async read() {
          if (chunkIndex >= chunks.length) {
            this.push(null);
            return;
          }
          const buf = await fsp.readFile(path.join(dir, chunks[chunkIndex]));
          chunkIndex++;
          this.push(buf);
        },
      });
      await driver.upload(m.destPath, stream);
      fs.rmSync(dir, { recursive: true, force: true });
      memory.delete(uploadId);
      try { getDb().prepare('DELETE FROM upload_sessions WHERE upload_id = ?').run(uploadId); } catch { /* 忽略 */ }
      invalidateCaches(m.storageId);
      opLog(user?.id, user?.username, 'upload', m.destPath);
      // 自动 faststart（透明）：MP4/M4V 上传后自动转 moov 前置，浏览器可边下边播
      if (needsFaststartExt(m.name) && rec.type === 'local') {
        const localDriver = driver as unknown as LocalDriver;
        const fullPath = localDriver.resolveFull(m.destPath);
        ensureFaststartAsync(fullPath);
      }
    } catch (e) {
      m.status = 'uploading';
      throw e;
    }
  },

  /** 小文件直传（multipart file 已落到内存/磁盘由 fastify-multipart 处理，这里接收 Buffer 流） */
  async direct(params: { storageId: number; path: string; name: string }, data: Buffer, user?: { username: string; id?: number }): Promise<void> {
    const rec = getDb().prepare('SELECT * FROM storages WHERE id = ? AND enabled = 1').get(params.storageId) as any;
    if (!rec) throw new Error('存储不存在或已禁用');
    const driver = getDriver(rec);
    await driver.upload(params.path, Readable.from([data]));
    invalidateCaches(params.storageId);
    opLog(user?.id, user?.username, 'upload_direct', params.path);
    // 自动 faststart（透明）：MP4/M4V 直传后自动转 moov 前置
    if (needsFaststartExt(params.name) && rec.type === 'local') {
      const localDriver = driver as unknown as LocalDriver;
      const fullPath = localDriver.resolveFull(params.path);
      ensureFaststartAsync(fullPath);
    }
  },

  /** 清理过期会话（内存 + DB + 磁盘分片） */
  prune(maxAgeMs = 7 * 24 * 3600 * 1000): void {
    const now = Date.now();
    const cutoff = now - maxAgeMs;
    try {
      const rows = getDb().prepare('SELECT upload_id FROM upload_sessions WHERE status = ? AND created_at < ?').all('uploading', cutoff) as any[];
      for (const r of rows) {
        fs.rmSync(tmpDir(r.upload_id), { recursive: true, force: true });
        memory.delete(r.upload_id);
      }
      if (rows.length) getDb().prepare('DELETE FROM upload_sessions WHERE status = ? AND created_at < ?').run('uploading', cutoff);
    } catch {
      // DB 不可用时退化为仅清理内存
    }
    for (const [id, m] of memory) {
      if (m.status === 'uploading' && now - m.createdAt > maxAgeMs) {
        fs.rmSync(tmpDir(id), { recursive: true, force: true });
        memory.delete(id);
      }
    }
  },
};
