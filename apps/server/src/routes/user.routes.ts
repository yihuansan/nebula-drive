import type { FastifyInstance } from 'fastify';
import { requirePermission, ok, fail } from '../auth/middleware.js';
import {
  listUsersPaginated,
  getUserStats,
  getTotalStorageUsage,
  getUserDetail,
  exportUserRows,
  countActiveAdmins,
  createUser,
  updateUser,
  deleteUser,
  findById,
  publicUser,
  randomPassword,
} from '../services/user.service.js';
import { revokeAllSessions } from '../services/session.service.js';
import { profileService } from '../services/profile.service.js';
import { settingNum } from '../services/settings.service.js';
import { opLog } from '../services/log.service.js';

/** 密码长度策略：返回 null 表示通过，否则返回错误消息 */
function checkPasswordLen(pwd: string): string | null {
  const minLen = settingNum('minPasswordLen', 8);
  return pwd.length < minLen ? `密码至少 ${minLen} 位` : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** CSV 字段转义 */
function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export async function userRoutes(app: FastifyInstance) {
  // ---------------- 列表（服务端分页 + 搜索 + 筛选 + 排序）+ 统计 ----------------
  app.get('/users', { preHandler: requirePermission('users:view') }, async (req, reply) => {
    const query = req.query as Record<string, string>;
    const list = listUsersPaginated({
      keyword: query.keyword,
      role: query.role,
      status: query.status,
      sort: query.sort,
      order: query.order,
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 20,
    });
    const usage = await getTotalStorageUsage();
    const stats = { ...getUserStats(), usedBytes: usage.bytes, usedFiles: usage.files };
    return ok(reply, { users: list.users, total: list.total, page: list.page, pageSize: list.pageSize, stats });
  });

  // ---------------- CSV 导出（沿用当前筛选条件，导出全部匹配行） ----------------
  app.get('/users/export.csv', { preHandler: requirePermission('users:view') }, async (req, reply) => {
    const query = req.query as Record<string, string>;
    const rows = exportUserRows({ keyword: query.keyword, role: query.role, status: query.status });
    const header = ['用户名', '昵称', '角色', '状态', '容量(字节)', '邮箱', '最近登录', '最近登录IP', '注册时间'];
    const lines = rows.map((r) => [
      r.username,
      r.displayName,
      r.role === 'admin' ? '管理员' : '普通用户',
      r.status === 'active' ? '正常' : '禁用',
      String(r.quota),
      r.email,
      r.lastLoginAt || '',
      r.lastLoginIp || '',
      r.createdAt,
    ]);
    const csv = [header, ...lines].map((row) => row.map(csvEscape).join(',')).join('\r\n');
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="users_${Date.now()}.csv"`);
    return reply.send('\uFEFF' + csv);
  });

  // ---------------- 用户详情（资料 + 会话 + 登录记录 + 回收站占用 + 2FA） ----------------
  app.get('/users/:id', { preHandler: requirePermission('users:view') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const detail = getUserDetail(id);
    if (!detail) return fail(reply, 404, '用户不存在');
    return ok(reply, detail);
  });

  // ---------------- 快速状态切换（带"最后一个管理员"锁定保护） ----------------
  app.put('/users/:id/status', { preHandler: requirePermission('users:manage') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as { status?: string };
    const status = b.status === 'active' ? 'active' : b.status === 'disabled' ? 'disabled' : null;
    if (!status) return fail(reply, 400, '状态必须为 active 或 disabled');
    if (id === req.user!.sub) return fail(reply, 400, '不能修改自己的状态');
    const target = findById(id);
    if (!target) return fail(reply, 404, '用户不存在');
    if (status === 'disabled' && target.role === 'admin' && target.status === 'active' && countActiveAdmins() <= 1) {
      return fail(reply, 403, '不能禁用最后一个管理员');
    }
    try {
      updateUser(id, { status });
      opLog(req.user!.sub, req.user!.username, 'user_status_change', `用户 #${id} → ${status}`);
      return ok(reply, { ok: true, status });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '更新状态失败');
    }
  });

  // ---------------- 强制下线（撤销该用户全部会话） ----------------
  app.post('/users/:id/force-logout', { preHandler: requirePermission('users:manage') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (id === req.user!.sub) return fail(reply, 400, '不能强制下线自己（会导致自己登出）');
    const target = findById(id);
    if (!target) return fail(reply, 404, '用户不存在');
    const timeoutHours = settingNum('sessionTimeoutHours', 168);
    const count = revokeAllSessions(id, timeoutHours);
    opLog(req.user!.sub, req.user!.username, 'user_force_logout', `用户 #${id}（${target.username}）`);
    return ok(reply, { ok: true, revoked: count });
  });

  // ---------------- 批量操作（禁用 / 启用 / 删除） ----------------
  app.post('/users/batch', { preHandler: requirePermission('users:manage') }, async (req, reply) => {
    const b = req.body as { action?: string; ids?: number[] };
    const action = b.action;
    const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    if (!action || !['disable', 'enable', 'delete'].includes(action)) return fail(reply, 400, '非法的批量操作');
    if (ids.length === 0) return fail(reply, 400, '未选择任何用户');

    const results: { id: number; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      if (id === req.user!.sub) {
        results.push({ id, ok: false, error: '不能操作自己' });
        continue;
      }
      const target = findById(id);
      if (!target) {
        results.push({ id, ok: false, error: '用户不存在' });
        continue;
      }
      try {
        if (action === 'delete') {
          if (target.role === 'admin') {
            results.push({ id, ok: false, error: '管理员账号不可删除' });
            continue;
          }
          deleteUser(id);
        } else {
          const disabling = action === 'disable';
          if (disabling && target.role === 'admin' && target.status === 'active' && countActiveAdmins() <= 1) {
            results.push({ id, ok: false, error: '不能禁用最后一个管理员' });
            continue;
          }
          updateUser(id, { status: disabling ? 'disabled' : 'active' });
        }
        results.push({ id, ok: true });
      } catch (e: any) {
        results.push({ id, ok: false, error: e?.message || '操作失败' });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    opLog(req.user!.sub, req.user!.username, 'user_batch', `批量${action} ${ids.length} 个用户`);
    return ok(reply, { ok: true, results, succeeded });
  });

  // ---------------- 创建用户（支持邮箱） ----------------
  app.post('/users', { preHandler: requirePermission('users:manage') }, async (req, reply) => {
    const b = req.body as {
      username: string;
      password: string;
      role: 'admin' | 'user';
      displayName?: string;
      quota?: number;
      email?: string;
    };
    if (!b.username || !b.password) return fail(reply, 400, '用户名和密码必填');
    if (b.username.length < 3 || b.username.length > 32) return fail(reply, 400, '用户名长度 3-32');
    const pwdErr = checkPasswordLen(b.password);
    if (pwdErr) return fail(reply, 400, pwdErr);
    const emailVal = (b.email || '').trim();
    if (emailVal && !EMAIL_RE.test(emailVal)) return fail(reply, 400, '邮箱格式不正确');
    try {
      const u = createUser(b.username, b.password, b.role || 'user', b.displayName || '', b.quota || 0);
      if (emailVal) profileService.update(u.id, { email: emailVal });
      return ok(reply, { user: publicUser(u) });
    } catch (e: any) {
      return fail(reply, 409, e?.message?.includes('UNIQUE') ? '用户名已存在' : '创建用户失败');
    }
  });

  // ---------------- 更新用户（支持邮箱；状态变更带"最后一个管理员"保护） ----------------
  app.put('/users/:id', { preHandler: requirePermission('users:manage') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as {
      password?: string;
      role?: string;
      displayName?: string;
      quota?: number;
      status?: string;
      email?: string;
    };
    if (b.password) {
      const pwdErr = checkPasswordLen(b.password);
      if (pwdErr) return fail(reply, 400, pwdErr);
    }
    const emailVal = (b.email || '').trim();
    if (emailVal && !EMAIL_RE.test(emailVal)) return fail(reply, 400, '邮箱格式不正确');
    if (b.status === 'disabled') {
      const target = findById(id);
      if (target && target.role === 'admin' && target.status === 'active' && countActiveAdmins() <= 1) {
        return fail(reply, 403, '不能禁用最后一个管理员');
      }
    }
    try {
      updateUser(id, { password: b.password, role: b.role, displayName: b.displayName, quota: b.quota, status: b.status });
      if (b.email !== undefined) profileService.update(id, { email: emailVal });
      const u = findById(id)!;
      return ok(reply, { user: publicUser(u) });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '更新用户失败');
    }
  });

  // ---------------- 删除用户 ----------------
  app.delete('/users/:id', { preHandler: requirePermission('users:manage') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (id === req.user!.sub) return fail(reply, 400, '不能删除自己');
    const target = findById(id);
    if (!target) return fail(reply, 404, '用户不存在');
    if (target.role === 'admin') return fail(reply, 403, '管理员账号不可删除');
    try {
      deleteUser(id);
      return ok(reply, { ok: true });
    } catch (e: any) {
      return fail(reply, 400, e?.message || '删除用户失败');
    }
  });

  // ---------------- 重置密码 ----------------
  app.post('/users/:id/reset-password', { preHandler: requirePermission('users:manage') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const pwd = randomPassword();
    updateUser(id, { password: pwd });
    opLog(req.user!.sub, req.user!.username, 'user_reset_password', `用户 #${id}`);
    return ok(reply, { password: pwd, notice: '此密码仅显示一次，请妥善保管' });
  });
}
