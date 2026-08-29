import type { FastifyInstance } from 'fastify';
import { requirePermission, ok, fail } from '../auth/middleware.js';
import { listOpLogs, listLoginLogs, clearLogs, allOpLogs, allLoginLogs } from '../services/log.service.js';

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

  // ---------------- 导出 CSV（type=op|login，Excel 直接打开：BOM + CRLF） ----------------
  app.get('/logs/export.csv', { preHandler: requirePermission('logs:view') }, async (req, reply) => {
    const q = req.query as { type?: string };
    const csvField = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    let lines: string[];
    if (q.type === 'login') {
      lines = [
        '时间,用户,IP,UA,结果',
        ...allLoginLogs().map((r) => [r.created_at, r.username, r.ip, r.ua, r.success ? '成功' : '失败'].map(csvField).join(',')),
      ];
    } else {
      lines = [
        '时间,用户,操作,路径,IP',
        ...allOpLogs().map((r) => [r.created_at, r.username, r.action, r.path, r.ip].map(csvField).join(',')),
      ];
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="logs-${q.type === 'login' ? 'login' : 'op'}.csv"`);
    return reply.send('\uFEFF' + lines.join('\r\n'));
  });

  app.delete('/logs', { preHandler: requirePermission('settings:manage') }, async (req, reply) => {
    clearLogs();
    return ok(reply, { ok: true });
  });
}
