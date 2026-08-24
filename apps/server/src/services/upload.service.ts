import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getDb } from '../db/index.js';
import { getDriver } from '../storage/registry.js';
import { dirs, config } from '../config.js';
import { opLog } from './log.service.js';
import { fileIndex } from './fileIndex.service.js';
import { usageCache } from './usageCache.service.js';

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

const memory = new Map<string, UploadMeta>();

function tmpDir(uploadId: string): string {
  return path.join(dirs.uploads, uploadId);
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
    memory.set(uploadId, {
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
    });
    return { uploadId, chunkSize };
  },

  async chunk(uploadId: string, chunkIndex: number, body: Buffer, userId?: number): Promise<void> {
    const m = memory.get(uploadId);
    if (!m) throw new Error('上传会话不存在');
    // P2-1 修复：校验用户身份
    if (m.userId !== undefined && m.userId !== userId) throw new Error('无权操作此上传会话');
    if (m.status === 'completed') throw new Error('上传已完成');
    const expected = Math.ceil(m.size / m.chunkSize);
    if (chunkIndex >= expected) throw new Error('分片序号越界');
    fs.writeFileSync(path.join(tmpDir(uploadId), String(chunkIndex)), body);
    m.received += body.length;
  },

  async complete(uploadId: string, user?: { username: string; id?: number }): Promise<void> {
    const m = memory.get(uploadId);
    if (!m) throw new Error('上传会话不存在');
    // P2-1 修复：校验用户身份
    if (m.userId !== undefined && m.userId !== user?.id) throw new Error('无权操作此上传会话');
    if (m.status === 'completed') return;
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
      read() {
        if (chunkIndex >= chunks.length) {
          this.push(null);
          return;
        }
        const buf = fs.readFileSync(path.join(dir, chunks[chunkIndex]));
        chunkIndex++;
        this.push(buf);
      },
    });
    await driver.upload(m.destPath, stream);
    fs.rmSync(dir, { recursive: true, force: true });
    m.status = 'completed';
    invalidateCaches(m.storageId);
    opLog(user?.id, user?.username, 'upload', m.destPath);
  },

  /** 小文件直传（multipart file 已落到内存/磁盘由 fastify-multipart 处理，这里接收 Buffer 流） */
  async direct(params: { storageId: number; path: string; name: string }, data: Buffer, user?: { username: string; id?: number }): Promise<void> {
    const rec = getDb().prepare('SELECT * FROM storages WHERE id = ? AND enabled = 1').get(params.storageId) as any;
    if (!rec) throw new Error('存储不存在或已禁用');
    const driver = getDriver(rec);
    await driver.upload(params.path, Readable.from([data]));
    invalidateCaches(params.storageId);
    opLog(user?.id, user?.username, 'upload_direct', params.path);
  },

  /** 清理过期会话 */
  prune(maxAgeMs = 24 * 3600 * 1000): void {
    const now = Date.now();
    for (const [id, m] of memory) {
      if (m.status === 'uploading' && now - m.createdAt > maxAgeMs) {
        fs.rmSync(tmpDir(id), { recursive: true, force: true });
        memory.delete(id);
      }
    }
  },
};
