import type { FastifyInstance } from 'fastify';
import { requirePermission, ok, fail } from '../auth/middleware.js';
import { versionService } from '../services/version.service.js';
import { tagService } from '../services/tag.service.js';
import { commentService } from '../services/comment.service.js';
import { favoriteService } from '../services/favorite.service.js';
import { profileService } from '../services/profile.service.js';
import { searchHistoryService } from '../services/searchHistory.service.js';
import { shareStatsService } from '../services/shareStats.service.js';
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { findById, updateUser, publicUser } from '../services/user.service.js';
import { verifyPassword } from '../auth/password.js';
import fs from 'node:fs';
import path from 'node:path';

export async function extendedRoutes(app: FastifyInstance) {
  // ===== 文件版本 =====
  app.get('/files/:path/versions', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const q = req.query as { storageId?: string };
    const storageId = Number(q.storageId);
    const filePath = decodeURIComponent((req.params as { path: string }).path);
    try {
      const versions = versionService.list(storageId, filePath);
      return ok(reply, { versions });
    } catch (e: any) {
      return fail(reply, 404, e?.message || '获取版本失败');
    }
  });

  app.post('/files/:path/versions/:version/restore', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const q = req.query as { storageId?: string };
    const storageId = Number(q.storageId);
    const filePath = decodeURIComponent((req.params as { path: string }).path);
    const version = Number((req.params as { version: string }).version);
    try {
      versionService.restore(storageId, filePath, version);
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '恢复版本失败');
    }
  });

  app.delete('/files/:path/versions/:version', { preHandler: requirePermission('files:delete') }, async (req, reply) => {
    const q = req.query as { storageId?: string };
    const storageId = Number(q.storageId);
    const filePath = decodeURIComponent((req.params as { path: string }).path);
    const version = Number((req.params as { version: string }).version);
    try {
      versionService.remove(storageId, filePath, version);
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '删除版本失败');
    }
  });

  // ===== 文件标签 =====
  app.get('/files/:path/tags', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const q = req.query as { storageId?: string };
    const storageId = Number(q.storageId);
    const filePath = decodeURIComponent((req.params as { path: string }).path);
    const tags = tagService.list(storageId, filePath);
    return ok(reply, { tags });
  });

  app.post('/files/:path/tags', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const q = req.query as { storageId?: string };
    const storageId = Number(q.storageId);
    const filePath = decodeURIComponent((req.params as { path: string }).path);
    const b = req.body as { tag?: string };
    if (!b.tag?.trim()) return fail(reply, 400, '标签不能为空');
    tagService.add(storageId, filePath, b.tag);
    return ok(reply, { tags: tagService.list(storageId, filePath) });
  });

  app.delete('/files/:path/tags/:tag', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const q = req.query as { storageId?: string };
    const storageId = Number(q.storageId);
    const filePath = decodeURIComponent((req.params as { path: string }).path);
    const tag = decodeURIComponent((req.params as { tag: string }).tag);
    tagService.remove(storageId, filePath, tag);
    return ok(reply, { tags: tagService.list(storageId, filePath) });
  });

  app.get('/tags', { preHandler: requirePermission('files:view') }, async (_req, reply) => {
    return ok(reply, { tags: tagService.allTags(), counts: tagService.tagCounts() });
  });

  // 按标签筛选文件
  app.get('/files-by-tag', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const q = req.query as { tag?: string };
    if (!q.tag) return fail(reply, 400, '标签不能为空');
    const files = tagService.filesByTag(q.tag);
    return ok(reply, { files });
  });

  // 创建新标签
  app.post('/tags', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const b = req.body as { tag?: string };
    if (!b.tag?.trim()) return fail(reply, 400, '标签不能为空');
    return ok(reply, { tags: tagService.allTags() });
  });

  // 删除标签
  app.delete('/tags/:tag', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const tag = decodeURIComponent((req.params as { tag: string }).tag);
    const db = getDb();
    db.prepare('DELETE FROM file_tags WHERE tag = ?').run(tag);
    return ok(reply, { tags: tagService.allTags() });
  });

  // ===== 文件注释 =====
  app.get('/files/:path/comments', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const q = req.query as { storageId?: string };
    const storageId = Number(q.storageId);
    const filePath = decodeURIComponent((req.params as { path: string }).path);
    const comments = commentService.list(storageId, filePath);
    return ok(reply, { comments });
  });

  app.post('/files/:path/comments', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const q = req.query as { storageId?: string };
    const storageId = Number(q.storageId);
    const filePath = decodeURIComponent((req.params as { path: string }).path);
    const b = req.body as { content?: string };
    if (!b.content?.trim()) return fail(reply, 400, '注释不能为空');
    commentService.add(storageId, filePath, req.user!.sub, req.user!.username, b.content);
    const comments = commentService.list(storageId, filePath);
    return ok(reply, { comments });
  });

  app.delete('/files/:path/comments/:id', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    // P1-6 修复：只有注释作者或管理员才能删除
    const comment = commentService.byId(id);
    if (!comment) return fail(reply, 404, '注释不存在');
    if (comment.user_id !== req.user!.sub && req.user!.role !== 'admin') {
      return fail(reply, 403, '无权限删除此注释');
    }
    commentService.remove(id);
    return ok(reply, { ok: true });
  });

  // ===== 文件收藏 =====
  app.get('/favorites', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const favs = favoriteService.list(req.user!.sub);
    return ok(reply, { favorites: favs });
  });

  app.post('/favorites', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const b = req.body as { storageId?: number; path?: string };
    if (!b.path) return fail(reply, 400, '缺少路径');
    favoriteService.add(req.user!.sub, b.storageId || 0, b.path);
    return ok(reply, { ok: true });
  });

  app.delete('/favorites', { preHandler: requirePermission('files:write') }, async (req, reply) => {
    const q = req.query as { storageId?: string; path?: string };
    // P2-13 修复：Fastify 已自动解码 query 参数，不需要再次 decodeURIComponent
    favoriteService.remove(req.user!.sub, Number(q.storageId), q.path || '');
    return ok(reply, { ok: true });
  });

  // ===== 用户资料 =====
  app.get('/profile', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const profile = profileService.get(req.user!.sub);
    return ok(reply, { profile });
  });

  app.put('/profile', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const b = req.body as { avatar?: string; email?: string; bio?: string; phone?: string };
    try {
      const profile = profileService.update(req.user!.sub, b);
      return ok(reply, { profile });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '更新资料失败');
    }
  });

  // 修改账号（用户名/密码）
  app.put('/profile/account', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const b = req.body as { username?: string; oldPassword?: string; newPassword?: string };
    const userId = req.user!.sub;
    const user = findById(userId);
    if (!user) return fail(reply, 404, '用户不存在');

    // 修改用户名
    if (b.username && b.username !== user.username) {
      if (b.username.length < 3 || b.username.length > 32) {
        return fail(reply, 400, '用户名长度 3-32 位');
      }
      try {
        updateUser(userId, { username: b.username });
      } catch (e: any) {
        return fail(reply, 409, e?.message?.includes('UNIQUE') ? '用户名已存在' : '修改用户名失败');
      }
    }

    // 修改密码
    if (b.newPassword) {
      if (!b.oldPassword) return fail(reply, 400, '请输入原密码');
      const valid = verifyPassword(b.oldPassword, user.password_hash);
      if (!valid) return fail(reply, 401, '原密码错误');
      if (b.newPassword.length < 8) return fail(reply, 400, '新密码至少 8 位');
      updateUser(userId, { password: b.newPassword });
    }

    const updated = findById(userId)!;
    return ok(reply, { user: publicUser(updated) });
  });

  // ===== 搜索历史 =====
  app.get('/search-history', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const q = req.query as { limit?: string };
    const history = searchHistoryService.list(req.user!.sub, Number(q.limit) || 20);
    return ok(reply, { history });
  });

  app.post('/search-history', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const b = req.body as { query?: string };
    if (b.query?.trim()) searchHistoryService.record(req.user!.sub, b.query);
    return ok(reply, { ok: true });
  });

  app.delete('/search-history', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    searchHistoryService.clear(req.user!.sub);
    return ok(reply, { ok: true });
  });

  // ===== 分享统计 =====
  app.get('/shares/:id/stats', { preHandler: requirePermission('files:share') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const stats = shareStatsService.get(id);
    return ok(reply, { stats });
  });

  // ===== 头像上传（multipart/form-data）=====
  app.post('/avatar', { preHandler: requirePermission('files:view') }, async (req, reply) => {
    const userId = req.user!.sub;
    try {
      const fileStream = await req.file();
      if (!fileStream) return fail(reply, 400, '缺少文件');
      
      const filename = fileStream.filename || 'avatar.png';
      const ext = path.extname(filename) || '.png';
      const allowedExts = new Set(['.png', '.jpg', '.jpeg', '.webp']);
      if (!allowedExts.has(ext.toLowerCase())) return fail(reply, 400, '仅支持 png/jpg/jpeg/webp');
      
      // 读取文件内容（流式）
      const data = await fileStream.toBuffer();
      
      if (data.length === 0) return fail(reply, 400, '文件为空');
      if (data.length > 5 * 1024 * 1024) return fail(reply, 400, '头像不能超过 5MB');
      
      // 保存头像到 avatars 目录
      const avatarDir = path.join(config.dataDir, 'avatars');
      if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });
      
      const avatarPath = path.join(avatarDir, `avatar_${userId}${ext}`);
      fs.writeFileSync(avatarPath, data);
      
      // 更新 profile 的 avatar 字段
      const avatarUrl = `/api/v1/avatar/${userId}`;
      profileService.update(userId, { avatar: avatarUrl });
      
      return ok(reply, { avatar: avatarUrl });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '上传失败');
    }
  });

  // ===== 头像下载 =====
  app.get('/avatar/:userId', async (req, reply) => {
    const userId = Number((req.params as { userId: string }).userId);
    const avatarDir = path.join(config.dataDir, 'avatars');
    const candidates = [
      { ext: '.png', mime: 'image/png' },
      { ext: '.jpg', mime: 'image/jpeg' },
      { ext: '.jpeg', mime: 'image/jpeg' },
      { ext: '.webp', mime: 'image/webp' },
    ];
    for (const { ext, mime } of candidates) {
      const filePath = path.join(avatarDir, `avatar_${userId}${ext}`);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath);
        reply.header('Content-Type', mime);
        return reply.send(data);
      }
    }
    return fail(reply, 404, '头像不存在');
  });
}
