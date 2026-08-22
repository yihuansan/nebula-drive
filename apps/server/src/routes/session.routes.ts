import type { FastifyInstance } from 'fastify';
import { authMiddleware, ok, fail } from '../auth/middleware.js';
import {
  getSessions,
  revokeSession,
  revokeOtherSessions,
  hashToken,
} from '../services/session.service.js';
import { settingNum } from '../services/settings.service.js';

/**
 * 会话管理路由
 */
export default async function sessionRoutes(app: FastifyInstance): Promise<void> {
  /** 获取当前用户的所有会话 */
  app.get('/sessions', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = req.user!.sub;
    const sessions = getSessions(userId);
    return ok(reply, {
      sessions: sessions.map(s => ({
        id: s.id,
        deviceName: s.device_name,
        ipAddress: s.ip_address,
        isCurrent: s.is_current === 1,
        createdAt: s.created_at,
        lastActive: s.last_active,
      })),
    });
  });

  /** 撤销指定会话（使该设备 token 失效） */
  app.delete('/sessions/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = req.user!.sub;
    const { id } = req.params as { id: string };
    const sessionId = parseInt(id, 10);

    if (isNaN(sessionId)) return fail(reply, 400, '无效的会话 ID');

    // 获取会话超时时间（小时）
    const timeoutHours = settingNum('sessionTimeoutHours', 168);
    const success = revokeSession(userId, sessionId, timeoutHours);
    if (!success) return fail(reply, 404, '会话不存在');

    return ok(reply, { revoked: true });
  });

  /** 撤销所有其他会话（保留当前） */
  app.post('/sessions/revoke-others', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = req.user!.sub;
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    const tokenHash = hashToken(token);

    // 获取会话超时时间（小时）
    const timeoutHours = settingNum('sessionTimeoutHours', 168);
    const count = revokeOtherSessions(userId, tokenHash, timeoutHours);
    return ok(reply, { revoked: count });
  });
}
