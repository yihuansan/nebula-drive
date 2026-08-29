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

  // ---------------- 批量操作（恢复 / 彻底删除），权限按 action 在 handler 内校验 ----------------
  app.post('/recycle/batch', async (req, reply) => {
    const b = req.body as { action?: string; ids?: number[] };
    const action = b.action;
    const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    if (!action || !['restore', 'purge'].includes(action)) return fail(reply, 400, '非法的批量操作');
    if (ids.length === 0) return fail(reply, 400, '未选择任何项目');
    await requirePermission(action === 'restore' ? 'recycle:restore' : 'recycle:purge')(req, reply);
    if (reply.sent) return;

    const results: { id: number; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        if (action === 'restore') recycleService.restore(id);
        else recycleService.remove(id);
        results.push({ id, ok: true });
      } catch (e: any) {
        results.push({ id, ok: false, error: e?.message || '操作失败' });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    return ok(reply, { ok: true, results, succeeded });
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
