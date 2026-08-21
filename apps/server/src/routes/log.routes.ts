import type { FastifyInstance } from 'fastify';
import { requirePermission, ok, fail } from '../auth/middleware.js';
import { listOpLogs, listLoginLogs, clearLogs } from '../services/log.service.js';

export async function logRoutes(app: FastifyInstance) {
  app.get('/logs', { preHandler: requirePermission('logs:view') }, async (req, reply) => {
    const q = req.query as { type?: string; page?: string; size?: string; mine?: string };
    const page = Math.max(1, Number(q.page) || 1);
    const size = Math.min(200, Math.max(1, Number(q.size) || 50));
    if (q.type === 'login') {
      const mine = q.mine === 'true' || q.mine === '1';
      const username = mine ? req.user!.username : undefined;
      return ok(reply, listLoginLogs(page, size, username));
    }
    return ok(reply, listOpLogs(page, size));
  });

  app.delete('/logs', { preHandler: requirePermission('logs:view') }, async (req, reply) => {
    clearLogs();
    return ok(reply, { ok: true });
  });
}
