<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus';
import { api, downloadFile, fmtSize, fmtTime } from '../../api';

/* ============================================================
   状态
   ============================================================ */
const users = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const keyword = ref('');
const roleFilter = ref('');
const statusFilter = ref('');
const sort = ref('');
const order = ref('');
const stats = ref<any>({ total: 0, admins: 0, active: 0, online: 0, usedBytes: 0 });
const selected = ref<any[]>([]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- 当前登录管理员 id（从 JWT 解析，用于禁用"操作自己"） ---------- */
function myId(): number | null {
  try {
    const t = localStorage.getItem('nebula_token');
    if (!t) return null;
    const payload = JSON.parse(atob(t.split('.')[1]));
    const id = Number(payload.sub);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
const meId = ref<number | null>(null);

/* ============================================================
   列表加载（服务端分页 + 搜索 + 筛选 + 排序）
   ============================================================ */
async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams();
    const kw = keyword.value.trim();
    if (kw) q.set('keyword', kw);
    if (roleFilter.value) q.set('role', roleFilter.value);
    if (statusFilter.value) q.set('status', statusFilter.value);
    if (sort.value) {
      q.set('sort', sort.value);
      if (order.value) q.set('order', order.value);
    }
    q.set('page', String(page.value));
    q.set('pageSize', String(pageSize.value));
    const r = await api(`/users?${q.toString()}`);
    users.value = r.users;
    total.value = r.total;
    stats.value = r.stats;
  } catch (e: any) {
    ElMessage.error(e.message || '加载用户失败');
  } finally {
    loading.value = false;
  }
}

let kwTimer: any = null;
function onKeywordInput() {
  clearTimeout(kwTimer);
  kwTimer = setTimeout(() => {
    page.value = 1;
    load();
  }, 300);
}
function onFilterChange() {
  page.value = 1;
  load();
}

/* ---------- 排序（prop → 后端排序字段） ---------- */
const SORT_PROP_MAP: Record<string, string> = {
  username: 'username',
  quota: 'quota',
  lastLoginAt: 'lastLogin',
  createdAt: 'createdAt',
};
function onSortChange({ prop, order: o }: { prop: string; order: 'ascending' | 'descending' | null }) {
  sort.value = SORT_PROP_MAP[prop] || '';
  order.value = o === 'ascending' ? 'asc' : o === 'descending' ? 'desc' : '';
  load();
}

/* ============================================================
   头像（无图片时用彩色首字母圆）
   ============================================================ */
const AVATAR_COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4'];
function avatarColor(username: string): string {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function avatarInitial(username: string): string {
  return (username || '?').charAt(0).toUpperCase();
}

/* ============================================================
   角色 / 状态辅助
   ============================================================ */
function roleTag(role: string) {
  return role === 'admin' ? 'danger' : 'info';
}
function roleLabel(role: string) {
  return role === 'admin' ? '管理员' : '普通用户';
}
function roleBadge(role: string) {
  return role === 'admin' ? 'danger' : 'info';
}
function statusTag(status: string) {
  return status === 'active' ? 'success' : 'info';
}
function statusLabel(status: string) {
  return status === 'active' ? '正常' : '禁用';
}

/* ============================================================
   快速状态切换
   ============================================================ */
async function toggleStatus(row: any, active: boolean) {
  const newStatus = active ? 'active' : 'disabled';
  try {
    await api(`/users/${row.id}/status`, { method: 'PUT', body: { status: newStatus } });
    ElMessage.success(`已${active ? '启用' : '禁用'}用户「${row.username}」`);
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败');
    load();
  }
}

/* ============================================================
   强制下线
   ============================================================ */
async function doForceLogout(row: any) {
  try {
    await ElMessageBox.confirm(`确定强制用户「${row.username}」下线吗？其所有会话将被撤销。`, '强制下线', { type: 'warning' });
  } catch {
    return;
  }
  try {
    const { revoked } = await api(`/users/${row.id}/force-logout`, { method: 'POST' });
    ElMessage.success(`已撤销 ${revoked} 个会话`);
    load();
    if (detail.value && detail.value.user?.id === row.id) openDetail(row);
  } catch (e: any) {
    ElMessage.error(e.message || '强制下线失败');
  }
}

/* ============================================================
   批量操作
   ============================================================ */
function onSelectionChange(rows: any[]) {
  selected.value = rows;
}
async function doBatch(action: 'disable' | 'enable' | 'delete') {
  const ids = selected.value.map((r) => r.id);
  const labels = { disable: '禁用', enable: '启用', delete: '删除' };
  try {
    await ElMessageBox.confirm(`确定${labels[action]}选中的 ${ids.length} 个用户吗？`, '批量操作', { type: 'warning' });
  } catch {
    return;
  }
  try {
    const { results, succeeded } = await api('/users/batch', { method: 'POST', body: { action, ids } });
    const failed = (results || []).filter((r: any) => !r.ok);
    if (failed.length) {
      ElMessage.warning(`成功 ${succeeded} 个，失败 ${failed.length} 个（${failed.map((f: any) => f.error).join('、')}）`);
    } else {
      ElMessage.success(`已${labels[action]} ${succeeded} 个用户`);
    }
    selected.value = [];
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '批量操作失败');
  }
}

/* ============================================================
   CSV 导出
   ============================================================ */
async function doExport() {
  try {
    const params: Record<string, string> = {};
    const kw = keyword.value.trim();
    if (kw) params.keyword = kw;
    if (roleFilter.value) params.role = roleFilter.value;
    if (statusFilter.value) params.status = statusFilter.value;
    await downloadFile('/users/export.csv', params, 'users.csv');
    ElMessage.success('已导出用户列表');
  } catch (e: any) {
    ElMessage.error(e.message || '导出失败');
  }
}

/* ============================================================
   用户详情抽屉
   ============================================================ */
const drawerVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<any>(null);

async function openDetail(row: any) {
  drawerVisible.value = true;
  detailLoading.value = true;
  try {
    const d = await api(`/users/${row.id}`);
    detail.value = d;
  } catch (e: any) {
    ElMessage.error(e.message || '加载详情失败');
  } finally {
    detailLoading.value = false;
  }
}

/* ============================================================
   创建用户
   ============================================================ */
const createDialog = ref(false);
const createFormRef = ref<FormInstance>();
const createForm = ref({ username: '', password: '', role: 'user', displayName: '', quota: 0, email: '' });
const createRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 32, message: '用户名 3-32 位', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, message: '密码至少 8 位', trigger: 'blur' },
  ],
  email: [{ pattern: EMAIL_RE, message: '邮箱格式不正确', trigger: 'blur' }],
};

async function doCreate() {
  try {
    await createFormRef.value?.validate();
  } catch {
    return;
  }
  try {
    await api('/users', {
      method: 'POST',
      body: {
        username: createForm.value.username,
        password: createForm.value.password,
        role: createForm.value.role,
        displayName: createForm.value.displayName,
        quota: createForm.value.quota || 0,
        email: createForm.value.email,
      },
    });
    ElMessage.success('用户已创建');
    createDialog.value = false;
    createForm.value = { username: '', password: '', role: 'user', displayName: '', quota: 0, email: '' };
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '创建失败');
  }
}

/* ============================================================
   编辑用户（状态由表格开关管理，此处不修改状态）
   ============================================================ */
const editDialog = ref(false);
const editFormRef = ref<FormInstance>();
const editForm = ref<any>({});
const editRules = {
  email: [{ pattern: EMAIL_RE, message: '邮箱格式不正确', trigger: 'blur' }],
  password: [{ min: 8, message: '密码至少 8 位', trigger: 'blur' }],
};

function openEdit(row: any) {
  editForm.value = {
    id: row.id,
    role: row.role,
    displayName: row.displayName || '',
    quota: row.quota || 0,
    email: row.email || '',
    password: '',
  };
  editDialog.value = true;
}

async function doEdit() {
  try {
    await editFormRef.value?.validate();
  } catch {
    return;
  }
  try {
    const payload: any = {
      role: editForm.value.role,
      displayName: editForm.value.displayName,
      quota: editForm.value.quota || 0,
      email: editForm.value.email,
    };
    if (editForm.value.password) payload.password = editForm.value.password;
    await api(`/users/${editForm.value.id}`, { method: 'PUT', body: payload });
    ElMessage.success('用户已更新');
    editDialog.value = false;
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '更新失败');
  }
}

/* ============================================================
   重置密码（后端生成随机密码，仅显示一次）
   ============================================================ */
async function doResetPassword(row: any) {
  try {
    await ElMessageBox.confirm(`确定重置用户「${row.username}」的密码吗？系统将生成新密码。`, '重置密码', { type: 'warning' });
  } catch {
    return;
  }
  try {
    const { password } = await api(`/users/${row.id}/reset-password`, { method: 'POST' });
    await ElMessageBox.alert(password, '新密码（仅显示一次，请妥善保管）', {
      confirmButtonText: '我已保存',
      type: 'success',
    });
    load();
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.message || '重置失败');
  }
}

/* ============================================================
   删除用户
   ============================================================ */
async function doDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除用户「${row.username}」吗？此操作不可恢复。`, '删除确认', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api(`/users/${row.id}`, { method: 'DELETE' });
    ElMessage.success('已删除');
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败');
  }
}

/* ============================================================
   下拉菜单命令分发
   ============================================================ */
function handleCommand(cmd: string, row: any) {
  if (cmd === 'reset') doResetPassword(row);
  else if (cmd === 'force') doForceLogout(row);
  else if (cmd === 'delete') doDelete(row);
}

/* ============================================================
   详情抽屉辅助：在线判定 / 最近登录IP / 容量百分比
   ============================================================ */
function isRecentSession(sessions: any[]): boolean {
  if (!sessions?.length) return false;
  return sessions.some((s) => {
    if (!s.lastActive) return false;
    const t = new Date(String(s.lastActive).replace(' ', 'T') + 'Z').getTime();
    return Date.now() - t < 24 * 3600 * 1000;
  });
}
function lastLoginIp(): string | null {
  return detail.value?.logins?.[0]?.ip || null;
}
function quotaPercent(quota: number): number {
  if (!quota) return 0;
  const used = stats.value.usedBytes || 0;
  const pct = (used / quota) * 100;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

onMounted(() => {
  meId.value = myId();
  load();
});
</script>

<template>
  <div class="users-page">
    <!-- KPI 卡片 -->
    <div class="kpi-grid">
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-blue"><el-icon :size="24"><User /></el-icon></div>
        <div>
          <div class="kpi-num">{{ stats.total }}</div>
          <div class="kpi-label">用户总数</div>
        </div>
      </div>
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-red"><el-icon :size="24"><Setting /></el-icon></div>
        <div>
          <div class="kpi-num">{{ stats.admins }}</div>
          <div class="kpi-label">管理员</div>
        </div>
      </div>
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-green"><el-icon :size="24"><CircleCheck /></el-icon></div>
        <div>
          <div class="kpi-num">{{ stats.active }}</div>
          <div class="kpi-label">正常用户</div>
        </div>
      </div>
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-purple"><el-icon :size="24"><Monitor /></el-icon></div>
        <div>
          <div class="kpi-num">{{ stats.online }}</div>
          <div class="kpi-label">在线用户</div>
        </div>
      </div>
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-cyan"><el-icon :size="24"><Folder /></el-icon></div>
        <div>
          <div class="kpi-num kpi-num-sm">{{ fmtSize(stats.usedBytes) }}</div>
          <div class="kpi-label">系统已用存储</div>
        </div>
      </div>
    </div>

    <!-- 用户列表 -->
    <div class="panel glass-card">
      <div class="panel-head">
        <el-icon class="panel-icon"><User /></el-icon>
        <span class="panel-title">用户管理</span>
        <div class="head-right">
          <el-select v-model="roleFilter" class="filter-select" placeholder="全部角色" clearable @change="onFilterChange">
            <el-option label="管理员" value="admin" />
            <el-option label="普通用户" value="user" />
          </el-select>
          <el-select v-model="statusFilter" class="filter-select" placeholder="全部状态" clearable @change="onFilterChange">
            <el-option label="正常" value="active" />
            <el-option label="禁用" value="disabled" />
          </el-select>
          <el-input
            v-model="keyword"
            class="filter-input"
            placeholder="搜索用户名 / 昵称 / 邮箱"
            clearable
            @input="onKeywordInput"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-button size="small" @click="doExport">
            <el-icon><Download /></el-icon>&nbsp;导出
          </el-button>
          <el-button type="primary" size="small" @click="createDialog = true">
            <el-icon><Plus /></el-icon>&nbsp;创建用户
          </el-button>
        </div>
      </div>

      <!-- 批量操作条 -->
      <div v-if="selected.length" class="batch-bar">
        <span class="batch-count">已选 {{ selected.length }} 项</span>
        <el-button size="small" type="warning" @click="doBatch('disable')">批量禁用</el-button>
        <el-button size="small" type="success" @click="doBatch('enable')">批量启用</el-button>
        <el-button size="small" type="danger" @click="doBatch('delete')">批量删除</el-button>
        <el-button size="small" link @click="selected = []">取消选择</el-button>
      </div>

      <el-table
        v-loading="loading"
        :data="users"
        :row-class-name="() => 'page-enter'"
        @selection-change="onSelectionChange"
        @sort-change="onSortChange"
        row-key="id"
      >
        <el-table-column type="selection" width="46" />
        <el-table-column label="用户" min-width="200">
          <template #default="{ row }">
            <div class="user-cell">
              <div class="avatar" :style="{ background: avatarColor(row.username) }">
                <img v-if="row.avatar" :src="row.avatar" alt="" />
                <span v-else>{{ avatarInitial(row.username) }}</span>
              </div>
              <div class="user-meta">
                <div class="user-name">{{ row.username }}</div>
                <div class="user-sub">{{ row.displayName || '未设置昵称' }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="角色" width="110">
          <template #default="{ row }">
            <span class="status-badge" :class="roleBadge(row.role)">{{ roleLabel(row.role) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="170">
          <template #default="{ row }">
            <div class="status-cell">
              <el-switch
                :model-value="row.status === 'active'"
                :disabled="row.id === meId"
                @change="(v) => toggleStatus(row, !!v)"
              />
              <span class="status-badge" :class="row.status === 'active' ? 'ok' : 'neutral'">
                <i class="dot" :class="{ pulse: row.status === 'active' }" />
                {{ row.status === 'active' ? '启用' : '禁用' }}
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="在线" width="90">
          <template #default="{ row }">
            <span class="online-dot" :class="{ on: row.online }"></span>
            <span class="online-label">{{ row.online ? '在线' : '离线' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="容量" width="110" prop="quota" sortable>
          <template #default="{ row }">{{ row.quota ? fmtSize(row.quota) : '不限' }}</template>
        </el-table-column>
        <el-table-column label="回收站" width="110">
          <template #default="{ row }">{{ row.recycleBytes ? fmtSize(row.recycleBytes) : '-' }}</template>
        </el-table-column>
        <el-table-column label="最近登录" min-width="160" prop="lastLoginAt" sortable>
          <template #default="{ row }">
            <template v-if="row.lastLoginAt">
              <div>{{ fmtTime(row.lastLoginAt) }}</div>
              <div class="muted" v-if="row.lastLoginIp">{{ row.lastLoginIp }}</div>
            </template>
            <span v-else class="muted">从未登录</span>
          </template>
        </el-table-column>
        <el-table-column label="注册时间" min-width="140" prop="createdAt" sortable>
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="178" fixed="right" align="center">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
              <span class="action-sep" aria-hidden="true"></span>
              <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
              <span class="action-sep" aria-hidden="true"></span>
              <el-dropdown @command="(cmd) => handleCommand(cmd, row)">
                <el-button link type="primary" size="small" class="more-btn">
                  更多
                  <el-icon class="more-arrow"><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="reset">重置密码</el-dropdown-item>
                    <el-dropdown-item command="force" :disabled="row.id === meId">强制下线</el-dropdown-item>
                    <el-dropdown-item command="delete" :disabled="row.role === 'admin' || row.id === meId">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next, sizes"
          :page-sizes="[10, 20, 50, 100]"
          @current-change="(p) => { page = p; load(); }"
          @size-change="(s) => { pageSize = s; page = 1; load(); }"
        />
      </div>
    </div>

    <!-- 用户详情抽屉 -->
    <el-drawer v-model="drawerVisible" size="500px">
      <template #header>
        <div class="drawer-head">
          <div class="avatar avatar-lg" :style="{ background: avatarColor(detail?.user?.username) }">
            <img v-if="detail?.profile?.avatar" :src="detail.profile.avatar" alt="" />
            <span v-else>{{ avatarInitial(detail?.user?.username) }}</span>
          </div>
          <div class="drawer-title">
            <div class="drawer-name">{{ detail?.user?.username }}</div>
            <div class="drawer-sub">{{ detail?.user?.displayName || '未设置昵称' }}</div>
          </div>
        </div>
      </template>
      <div v-if="detail" v-loading="detailLoading" class="detail-body">
        <!-- 标签 + 状态 + 在线 -->
        <div class="detail-tags">
          <el-tag size="small" :type="roleTag(detail.user.role)">{{ roleLabel(detail.user.role) }}</el-tag>
          <el-tag size="small" :type="statusTag(detail.user.status)">{{ statusLabel(detail.user.status) }}</el-tag>
          <span class="online-dot" :class="{ on: detail.sessions?.length && isRecentSession(detail.sessions) }"></span>
          <span class="online-label">{{ detail.sessions?.length && isRecentSession(detail.sessions) ? '在线' : '离线' }}</span>
          <el-tag v-if="detail.twoFactor" size="small" type="warning" effect="plain">已开 2FA</el-tag>
        </div>

        <!-- 容量进度 -->
        <div class="quota-card">
          <div class="quota-head">
            <span>容量配额</span>
            <span class="quota-used">{{ detail.user.quota ? `${fmtSize(stats.usedBytes)} / ${fmtSize(detail.user.quota)}` : '不限' }}</span>
          </div>
          <div class="quota-bar">
            <div
              class="quota-fill"
              :style="{ width: quotaPercent(detail.user.quota) + '%' }"
            ></div>
          </div>
          <div class="quota-note">存储为全局共享，已用量为系统级</div>
          <div class="quota-recycle" v-if="detail.recycle?.bytes">回收站占用：{{ fmtSize(detail.recycle.bytes) }}（{{ detail.recycle.count }} 项）</div>
        </div>

        <!-- 操作按钮 -->
        <div class="detail-actions">
          <el-button size="small" @click="openEdit(detail.user)">编辑</el-button>
          <el-button size="small" @click="doResetPassword(detail.user)">重置密码</el-button>
          <el-button size="small" :type="detail.user.status === 'active' ? 'warning' : 'success'" @click="toggleStatus(detail.user, detail.user.status !== 'active')">
            {{ detail.user.status === 'active' ? '禁用' : '启用' }}
          </el-button>
          <el-button size="small" type="danger" :disabled="detail.user.id === meId" @click="doForceLogout(detail.user)">强制下线</el-button>
        </div>

        <!-- 标签页 -->
        <el-tabs class="detail-tabs">
          <el-tab-pane label="基本信息">
            <div class="info-grid">
              <div class="info-item"><span class="info-k">邮箱</span><span class="info-v">{{ detail.profile?.email || '-' }}</span></div>
              <div class="info-item"><span class="info-k">手机</span><span class="info-v">{{ detail.profile?.phone || '-' }}</span></div>
              <div class="info-item"><span class="info-k">注册时间</span><span class="info-v">{{ fmtTime(detail.user.createdAt) }}</span></div>
              <div class="info-item"><span class="info-k">最近登录</span><span class="info-v">{{ detail.user.lastLoginAt ? fmtTime(detail.user.lastLoginAt) : '从未登录' }}</span></div>
              <div class="info-item" v-if="detail.user.lastLoginAt"><span class="info-k">最近登录IP</span><span class="info-v">{{ lastLoginIp() || '-' }}</span></div>
              <div class="info-item"><span class="info-k">2FA</span><span class="info-v">{{ detail.twoFactor ? '已开启' : '未开启' }}</span></div>
              <div class="info-item info-full" v-if="detail.profile?.bio"><span class="info-k">简介</span><span class="info-v">{{ detail.profile.bio }}</span></div>
            </div>
          </el-tab-pane>
          <el-tab-pane label="登录设备">
            <div v-if="detail.sessions?.length" class="session-list">
              <div v-for="s in detail.sessions" :key="s.id" class="session-item">
                <div class="session-main">
                  <span class="session-device">{{ s.deviceName }}</span>
                  <el-tag v-if="s.isCurrent" size="small" type="success" effect="plain">当前</el-tag>
                </div>
                <div class="session-meta">
                  <span class="muted">{{ s.ipAddress }}</span>
                  <span class="muted">{{ fmtTime(s.lastActive) }}</span>
                </div>
              </div>
            </div>
            <el-empty v-else description="无登录设备" :image-size="60" />
          </el-tab-pane>
          <el-tab-pane label="登录记录">
            <div v-if="detail.logins?.length" class="login-list">
              <div v-for="(l, i) in detail.logins" :key="i" class="login-item">
                <span class="login-time">{{ fmtTime(l.createdAt) }}</span>
                <span class="login-ip">{{ l.ip }}</span>
                <el-tag size="small" :type="l.success ? 'success' : 'danger'" effect="plain">{{ l.success ? '成功' : '失败' }}</el-tag>
                <span class="login-ua muted">{{ l.ua }}</span>
              </div>
            </div>
            <el-empty v-else description="无登录记录" :image-size="60" />
          </el-tab-pane>
        </el-tabs>
      </div>
      <el-empty v-else description="加载中…" :image-size="60" />
    </el-drawer>

    <!-- 创建用户 -->
    <el-dialog v-model="createDialog" title="创建用户" width="480px">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="90px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="createForm.username" placeholder="3-32 位" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="createForm.password" type="password" show-password placeholder="至少 8 位" />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="createForm.email" placeholder="可选" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-radio-group v-model="createForm.role">
            <el-radio value="user">普通用户</el-radio>
            <el-radio value="admin">管理员</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="昵称" prop="displayName">
          <el-input v-model="createForm.displayName" placeholder="可选" />
        </el-form-item>
        <el-form-item label="容量" prop="quota">
          <el-input v-model.number="createForm.quota" type="number" placeholder="0 表示不限" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialog = false">取消</el-button>
        <el-button type="primary" @click="doCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 编辑用户 -->
    <el-dialog v-model="editDialog" title="编辑用户" width="480px">
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="90px">
        <el-form-item label="昵称" prop="displayName">
          <el-input v-model="editForm.displayName" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-radio-group v-model="editForm.role">
            <el-radio value="user">普通用户</el-radio>
            <el-radio value="admin">管理员</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="容量" prop="quota">
          <el-input v-model.number="editForm.quota" type="number" placeholder="0 表示不限" />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="editForm.email" placeholder="可选" />
        </el-form-item>
        <el-form-item label="重置密码" prop="password">
          <el-input v-model="editForm.password" type="password" show-password placeholder="留空则不修改" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialog = false">取消</el-button>
        <el-button type="primary" @click="doEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.users-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ---------- KPI 卡片 ---------- */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 14px;
}
@media (max-width: 1100px) {
  .kpi-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 700px) {
  .kpi-grid {
    grid-template-columns: repeat(1, 1fr);
  }
}
.kpi {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border-radius: 18px;
}
.kpi:hover {
  transform: none;
}
.kpi-icon {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  color: #fff;
  border: 1px solid var(--glass-border);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}
.kpi-blue {
  background: linear-gradient(135deg, #3b82f6, #6366f1);
}
.kpi-red {
  background: linear-gradient(135deg, #ef4444, #f97316);
}
.kpi-green {
  background: linear-gradient(135deg, #22c55e, #14b8a6);
}
.kpi-purple {
  background: linear-gradient(135deg, #8b5cf6, #a855f7);
}
.kpi-cyan {
  background: linear-gradient(135deg, #06b6d4, #3b82f6);
}
.kpi-num {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.kpi-num-sm {
  font-size: 20px;
  padding-top: 6px;
}
.kpi-label {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 2px;
}

/* ---------- 面板 ---------- */
.panel {
  border-radius: 18px;
  padding: 20px 22px;
}
.panel:hover {
  transform: none;
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.panel-icon {
  color: var(--accent);
  font-size: 18px;
}
.panel-title {
  font-size: 15px;
  font-weight: 600;
}
.head-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.filter-input {
  width: 240px;
}
.filter-select {
  width: 110px;
}

/* ---------- 批量操作条 ---------- */
.batch-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 12px;
  margin-bottom: 12px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border: 1px solid var(--glass-border);
}
.batch-count {
  font-size: 13px;
  color: var(--text);
  margin-right: 8px;
}

/* ---------- 用户单元格 ---------- */
.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 700;
  font-size: 16px;
  overflow: hidden;
  border: 1px solid var(--glass-border);
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar-lg {
  width: 56px;
  height: 56px;
  font-size: 22px;
}
.user-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.user-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
}
.user-sub {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- 在线状态 ---------- */
.online-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-secondary);
  opacity: 0.5;
  margin-right: 6px;
}
.online-dot.on {
  background: #22c55e;
  opacity: 1;
  box-shadow: 0 0 6px #22c55e;
}
.online-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.status-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ---------- 行内操作（详情 / 编辑 / 更多） ---------- */
.row-actions {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}
.row-actions .el-button {
  padding: 2px 4px;
  margin: 0;
  font-size: 13px;
  line-height: 1;
}
.action-sep {
  width: 1px;
  height: 14px;
  background: var(--glass-border);
  margin: 0 6px;
  flex-shrink: 0;
}
.more-btn {
  display: inline-flex;
  align-items: center;
}
.more-arrow {
  margin-left: 3px;
  font-size: 12px;
}

/* ---------- 分页 ---------- */
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

/* ---------- 详情抽屉 ---------- */
.drawer-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.drawer-title {
  display: flex;
  flex-direction: column;
}
.drawer-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}
.drawer-sub {
  font-size: 13px;
  color: var(--text-secondary);
}
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.detail-tags {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.quota-card {
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}
.quota-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text);
  margin-bottom: 8px;
}
.quota-used {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.quota-bar {
  height: 10px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--text-secondary) 18%, transparent);
  overflow: hidden;
}
.quota-fill {
  height: 100%;
  border-radius: 6px;
  background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #ffffff));
  transition: width 0.4s ease;
}
.quota-note {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 8px;
}
.quota-recycle {
  font-size: 12px;
  color: var(--text);
  margin-top: 6px;
}
.detail-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.detail-tabs {
  margin-top: 4px;
}
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
}
.info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.info-full {
  grid-column: 1 / -1;
}
.info-k {
  font-size: 12px;
  color: var(--text-secondary);
}
.info-v {
  font-size: 14px;
  color: var(--text);
  word-break: break-all;
}
.session-list,
.login-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.session-item,
.login-item {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}
.session-main {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.session-device {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.session-meta,
.login-item {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.login-time {
  font-size: 12px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.login-ip {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: monospace;
}
.login-ua {
  font-size: 11px;
  flex: 1;
  min-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted {
  color: var(--text-secondary);
  font-size: 12px;
}
</style>
