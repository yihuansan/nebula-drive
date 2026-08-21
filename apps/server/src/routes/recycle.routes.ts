import type { FastifyInstance } from 'fastify';
import { requirePermission, ok, fail } from '../auth/middleware.js';
import { recycleService } from '../services/recycle.service.js';
import { settingNum } from '../services/settings.service.js';

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

  /**
   * 手动触发自动清理（按回收站保留天数删除超期条目）
   * POST /recycle/purge
   */
  app.post('/recycle/purge', { preHandler: requirePermission('recycle:purge') }, async (req, reply) => {
    try {
      const days = settingNum('recycleRetentionDays', 0);
      if (days <= 0) return fail(reply, 400, '未设置回收站保留天数（当前为 0 = 关闭自动清理）');
      const purged = recycleService.purgeOlderThan(days);
      return ok(reply, { purged, days });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '清理失败');
    }
  });
}
