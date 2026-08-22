import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyJwt, type JwtPayload } from './jwt.js';
import { jwtSecret } from '../config.js';
import { getRolePermissions } from '../services/role.service.js';
import { isTokenRevoked, hashToken, touchSession } from '../services/session.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply) {
  // 若 req.user 已被前置处理器设置（如 previewAuth 通过 ?token= 验证），跳过重复认证
  if (req.user) return;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return reply.code(401).header('Cache-Control', 'no-store').send({ error: '未登录' });
  const payload = verifyJwt(token, jwtSecret);
  if (!payload) return reply.code(401).header('Cache-Control', 'no-store').send({ error: '登录已过期，请重新登录' });
  // 检查 token 是否已被撤销
  const tokenHash = hashToken(token);
  if (isTokenRevoked(tokenHash)) {
    return reply.code(401).header('Cache-Control', 'no-store').send({ error: '登录已失效，请重新登录' });
  }
  // 更新会话活跃时间
  touchSession(tokenHash);
  req.user = payload;
}

/**
 * 权限守卫工厂：返回一个 preHandler，检查用户角色是否拥有指定权限点。
 * 权限点从 role_permissions 表实时读取（改动即时生效）。
 */
export function requirePermission(key: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await authMiddleware(req, reply);
    if (reply.sent) return;
    const role = req.user?.role;
    if (!role) return reply.code(403).header('Cache-Control', 'no-store').send({ error: '无权限' });
    const perms = getRolePermissions(role);
    if (!perms.includes(key)) {
      return reply.code(403).header('Cache-Control', 'no-store').send({ error: '无权限执行此操作' });
    }
  };
}

/** 兼容旧调用：管理员 = 拥有 users:manage 的角色。 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requirePermission('users:manage')(req, reply);
}

export function ok<T>(reply: FastifyReply, data: T) {
  return reply.send({ data });
}

export function fail(reply: FastifyReply, code: number, error: string, extra?: Record<string, any>) {
  return reply.code(code).header('Cache-Control', 'no-store').send({ error, ...(extra || {}) });
}
