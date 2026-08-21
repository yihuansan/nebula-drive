import type { FastifyInstance } from 'fastify';
import { requirePermission, ok, fail } from '../auth/middleware.js';
import { recycleService } from '../services/recycle.service.js';

export async function recycleRoutes(app: FastifyInstance) {
  app.get('/recycle', { preHandler: requirePermission('recycle:view') }, async (req, reply) => {
    return ok(reply, { items: recycleService.list() });
  });

  app.post('/recycle/restore', { preHandler: requirePermission('recycle:restore') }, async (req, reply) => {
    const b = req.body as { id: number };
    try {
      recycleService.restore(b.id);
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '恢复失败');
    }
  });

  app.delete('/recycle/:id', { preHandler: requirePermission('recycle:purge') }, async (req, reply) => {
    try {
      recycleService.remove(Number((req.params as { id: string }).id));
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '删除失败');
    }
  });

  app.delete('/recycle', { preHandler: requirePermission('recycle:purge') }, async (req, reply) => {
    try {
      recycleService.clear();
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '清空失败');
    }
  });
}
