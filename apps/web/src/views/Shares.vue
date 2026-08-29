<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import QRCode from 'qrcode';
import { api, fmtTime } from '../api';
import EmptyState from '../components/EmptyState.vue';

const shares = ref<any[]>([]);
const loading = ref(false);
const filter = ref('');

async function load() {
  loading.value = true;
  try {
    const r = await api('/shares');
    shares.value = r.shares;
  } catch (e: any) {
    ElMessage.error(e.message || '加载分享列表失败');
  } finally {
    loading.value = false;
  }
}

/* ---------- 有效期状态（对标百度网盘：已过期 / 即将过期 / 有效 / 永久） ---------- */
function shareStatus(row: any) {
  if (!row.expires_at) return { type: 'info', label: '永久有效' };
  const exp = new Date(String(row.expires_at).replace(' ', 'T') + 'Z').getTime();
  const now = Date.now();
  if (exp < now) return { type: 'danger', label: '已过期' };
  if (exp - now < 86400000) return { type: 'warning', label: '即将过期' };
  return { type: 'success', label: '有效' };
}
/** el-tag type → 全局徽章色系 */
function badgeCls(type: string) {
  return ({ success: 'ok', danger: 'danger', warning: 'warn', info: 'info' } as Record<string, string>)[type] || 'neutral';
}

const filtered = computed(() => {
  const k = filter.value.trim().toLowerCase();
  if (!k) return shares.value;
  return shares.value.filter(
    (s) => (s.name || '').toLowerCase().includes(k) || (s.path || '').toLowerCase().includes(k)
  );
});

const stats = computed(() => {
  const total = shares.value.length;
  const expired = shares.value.filter((s) => shareStatus(s).label === '已过期').length;
  return { total, expired, active: total - expired };
});

/* ---------- 创建分享 ---------- */
const createDialog = ref(false);
const form = ref({
  storageId: 0,
  path: '/',
  name: '',
  password: '',
  expireDays: 0,
  maxDownloads: 0,
});
const storages = ref<any[]>([]);

async function openCreate() {
  form.value = { storageId: 0, path: '/', name: '', password: '', expireDays: 0, maxDownloads: 0 };
  try {
    const r = await api('/storages');
    storages.value = r.storages;
    if (r.storages.length) form.value.storageId = r.storages[0].id;
  } catch {
    /* 忽略 */
  }
  // 预填系统默认分享有效期
  try {
    const s = await api('/settings');
    if (Number(s.shareDefaultExpireDays) > 0) form.value.expireDays = Number(s.shareDefaultExpireDays);
  } catch {
    /* 忽略 */
  }
  createDialog.value = true;
}

async function doCreate() {
  if (!form.value.storageId) return ElMessage.warning('请选择存储');
  const body: any = {
    storageId: form.value.storageId,
    path: form.value.path || '/',
  };
  if (form.value.name) body.name = form.value.name;
  if (form.value.password) body.password = form.value.password;
  if (form.value.expireDays > 0) {
    // 有效期 = 现在 + N 天；服务端按 SQLite datetime（UTC）比较
    const ms = Date.now() + form.value.expireDays * 86400000;
    body.expiresAt = new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  }
  if (form.value.maxDownloads > 0) body.maxDownloads = form.value.maxDownloads;
  try {
    const r = await api('/shares', { method: 'POST', body: JSON.stringify(body) });
    ElMessage.success('分享已创建');
    createDialog.value = false;
    load();
    const token = r.share?.token;
    if (token && form.value.password) rememberPassword(token, form.value.password);
    copyUrl(r.url, token);
  } catch (e: any) {
    ElMessage.error(e.message || '创建分享失败');
  }
}

/* ---------- 提取码缓存（后端仅存 hash，明文只在创建时可知，缓存到 sessionStorage 供复制/二维码展示） ---------- */
const PW_KEY = 'nd-share-passwords';
function sharePasswords(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(PW_KEY) || '{}');
  } catch {
    return {};
  }
}
function rememberPassword(token: string, password: string) {
  if (!token || !password) return;
  const map = sharePasswords();
  map[token] = password;
  try {
    sessionStorage.setItem(PW_KEY, JSON.stringify(map));
  } catch { /* 忽略 */ }
}

/* ---------- 复制链接（链接 + 提取码组合文本） ---------- */
function copyUrl(url?: string, token?: string) {
  const u = url || (token ? `${location.origin}/s/${token}` : '');
  if (!u) return;
  const t = token || u.split('/s/').pop() || '';
  const pwd = sharePasswords()[t];
  const text = pwd ? `链接：${u}\n提取码：${pwd}` : u;
  navigator.clipboard?.writeText(text).then(
    () => ElMessage.success(pwd ? '链接和提取码已复制' : '分享链接已复制'),
    () => ElMessage.warning('请手动复制：' + text)
  );
}

function copyRow(row: any) {
  copyUrl(undefined, row.token);
}

function openShare(row: any) {
  const u = `${location.origin}/s/${row.token}`;
  window.open(u, '_blank');
}

/* ---------- 二维码（对标百度网盘：扫码直达分享页） ---------- */
const qrDialog = ref(false);
const qrTarget = ref<any>(null);
const qrDataUrl = ref('');
const qrLink = ref('');
async function openQr(row: any) {
  qrTarget.value = row;
  qrDataUrl.value = '';
  qrLink.value = `${location.origin}/s/${row.token}`;
  qrDialog.value = true;
  try {
    qrDataUrl.value = await QRCode.toDataURL(qrLink.value, {
      width: 240,
      margin: 1,
      color: { dark: '#1e293b', light: '#ffffff' },
    });
  } catch {
    ElMessage.error('二维码生成失败');
  }
}

/* ---------- 删除 ---------- */
async function doDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除分享「${row.name || row.token}」吗？`, '删除确认', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api(`/shares/${row.id}`, { method: 'DELETE' });
    ElMessage.success('已删除');
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败');
  }
}

function fmtExp(v: any) {
  return v ? fmtTime(v) : '永久有效';
}

/* ---------- 分享统计 ---------- */
const statsDialog = ref(false);
const statsTarget = ref<any>(null);
const statsData = ref<any>(null);
const statsLoading = ref(false);

async function openStats(row: any) {
  statsTarget.value = row;
  statsDialog.value = true;
  statsLoading.value = true;
  statsData.value = null;
  try {
    const r = await api(`/shares/${row.id}/stats`);
    statsData.value = r.stats;
  } catch (e: any) {
    ElMessage.error(e.message || '获取统计失败');
  } finally {
    statsLoading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="shares-page">
    <!-- KPI 卡片 -->
    <div class="kpi-grid">
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-blue"><el-icon :size="24"><Share /></el-icon></div>
        <div>
          <div class="kpi-num">{{ stats.total }}</div>
          <div class="kpi-label">分享总数</div>
        </div>
      </div>
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-green"><el-icon :size="24"><Link /></el-icon></div>
        <div>
          <div class="kpi-num">{{ stats.active }}</div>
          <div class="kpi-label">有效分享</div>
        </div>
      </div>
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-red"><el-icon :size="24"><Timer /></el-icon></div>
        <div>
          <div class="kpi-num">{{ stats.expired }}</div>
          <div class="kpi-label">已过期</div>
        </div>
      </div>
    </div>

    <!-- 分享列表 -->
    <div class="panel glass-card">
      <div class="panel-head">
        <el-icon class="panel-icon"><Share /></el-icon>
        <span class="panel-title">我的分享</span>
        <span class="panel-sub">公开链接，无需登录即可访问（/s/:token）</span>
        <div class="head-right">
          <el-input
            v-model="filter"
            class="filter-input"
            placeholder="搜索名称 / 路径"
            clearable
            :prefix-icon="'Search'"
          />
          <el-button type="primary" size="small" @click="openCreate">
            <el-icon><Link /></el-icon>&nbsp;创建分享
          </el-button>
        </div>
      </div>

      <el-table v-if="loading || filtered.length" v-loading="loading" :data="filtered" class="shares-table">
        <el-table-column label="名称" min-width="180">
          <template #default="{ row }">
            <div class="share-cell">
              <div class="share-badge">
                <el-icon><Share /></el-icon>
              </div>
              <span class="share-name">{{ row.name || '未命名分享' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="路径" min-width="200" prop="path" show-overflow-tooltip />
        <el-table-column label="提取码" width="100">
          <template #default="{ row }">
            <span v-if="row.password_hash" class="status-badge warn"><el-icon :size="12"><Lock /></el-icon>有密码</span>
            <span v-else class="muted">无</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="150">
          <template #default="{ row }">
            <div class="status-cell">
              <span class="status-badge" :class="badgeCls(shareStatus(row).type)">{{ shareStatus(row).label }}</span>
              <span class="exp-text">{{ fmtExp(row.expires_at) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="下载次数" width="110">
          <template #default="{ row }">
            <span class="dl-count">{{ row.download_count }}</span>
            <span v-if="row.max_downloads" class="muted"> / {{ row.max_downloads }}</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="290">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="copyRow(row)">复制链接</el-button>
            <el-button link type="primary" size="small" @click="openQr(row)">二维码</el-button>
            <el-button link type="primary" size="small" @click="openShare(row)">打开</el-button>
            <el-button link type="primary" size="small" @click="openStats(row)">统计</el-button>
            <el-button link type="danger" size="small" @click="doDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 空状态 -->
      <EmptyState
        v-if="!loading && !shares.length"
        title="还没有分享链接"
        description="创建一个分享，把文件或文件夹以链接形式发给别人"
      >
        <template #actions>
          <el-button type="primary" size="small" @click="openCreate">
            <el-icon><Link /></el-icon>&nbsp;创建分享
          </el-button>
        </template>
      </EmptyState>
    </div>

    <!-- 分享统计 -->
    <el-dialog v-model="statsDialog" title="分享统计" width="480px">
      <div v-loading="statsLoading" class="stats-wrap">
        <div v-if="statsData" class="stats-grid">
          <div class="stats-item">
            <div class="stats-num">{{ statsData.view_count }}</div>
            <div class="stats-label">浏览次数</div>
          </div>
          <div class="stats-item">
            <div class="stats-num">{{ statsData.download_count }}</div>
            <div class="stats-label">下载次数</div>
          </div>
          <div class="stats-item">
            <div class="stats-num">{{ statsData.last_view_at ? fmtTime(statsData.last_view_at) : '-' }}</div>
            <div class="stats-label">最后浏览</div>
          </div>
          <div class="stats-item">
            <div class="stats-num">{{ statsData.last_download_at ? fmtTime(statsData.last_download_at) : '-' }}</div>
            <div class="stats-label">最后下载</div>
          </div>
        </div>
        <div v-else-if="!statsLoading" class="empty-tip">无统计数据</div>
      </div>
    </el-dialog>

    <!-- 分享二维码 -->
    <el-dialog v-model="qrDialog" title="分享二维码" width="380px">
      <div class="qr-wrap">
        <img v-if="qrDataUrl" :src="qrDataUrl" class="qr-img" alt="分享二维码" />
        <div v-else class="qr-placeholder">生成中…</div>
        <div class="qr-name">{{ qrTarget?.name || '未命名分享' }}</div>
        <div class="qr-link">{{ qrLink }}</div>
        <div v-if="qrTarget && sharePasswords()[qrTarget.token]" class="qr-pwd">
          提取码：<b>{{ sharePasswords()[qrTarget.token] }}</b>
        </div>
        <div v-else-if="qrTarget?.password_hash" class="qr-pwd muted">该分享设有提取码</div>
      </div>
      <template #footer>
        <el-button @click="copyRow(qrTarget)">复制链接</el-button>
        <el-button type="primary" @click="qrDialog = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 创建分享 -->
    <el-dialog v-model="createDialog" title="创建分享" width="520px">
      <el-form label-width="90px">
        <el-form-item label="存储">
          <el-select v-model="form.storageId" style="width: 100%">
            <el-option v-for="s in storages" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="路径">
          <el-input v-model="form.path" placeholder="存储内路径，如 /docs 或 /docs/ 表示目录" />
        </el-form-item>
        <el-form-item label="分享名称">
          <el-input v-model="form.name" placeholder="可选，默认使用路径名" />
        </el-form-item>
        <el-form-item label="提取码">
          <el-input v-model="form.password" placeholder="可选" />
        </el-form-item>
        <el-form-item label="有效期">
          <el-radio-group v-model="form.expireDays">
            <el-radio-button :label="0">永久</el-radio-button>
            <el-radio-button :label="1">1 天</el-radio-button>
            <el-radio-button :label="7">1 周</el-radio-button>
            <el-radio-button :label="30">1 个月</el-radio-button>
            <el-radio-button :label="90">3 个月</el-radio-button>
            <el-radio-button :label="180">6 个月</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="下载次数">
          <el-input v-model.number="form.maxDownloads" type="number" placeholder="0 表示不限" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialog = false">取消</el-button>
        <el-button type="primary" @click="doCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.shares-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ---------- KPI 卡片 ---------- */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
@media (max-width: 900px) {
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
.kpi-green {
  background: linear-gradient(135deg, #22c55e, #14b8a6);
}
.kpi-red {
  background: linear-gradient(135deg, #ef4444, #f97316);
}
.kpi-num {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
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
.panel-sub {
  font-size: 12px;
  color: var(--text-secondary);
}
.head-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
.filter-input {
  width: 220px;
}

/* ---------- 表格 ---------- */
.share-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.share-badge {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: #fff;
  background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #ffffff));
}
.share-name {
  font-weight: 500;
  color: var(--text);
}
.status-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.exp-text {
  font-size: 12px;
  color: var(--text-secondary);
}
.dl-count {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.muted {
  color: var(--text-secondary);
  font-size: 12px;
}

/* 分享统计 */
.stats-wrap {
  padding: 8px 0;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
.stats-item {
  text-align: center;
  padding: 16px;
  border-radius: 14px;
  background: var(--accent-soft);
}
.stats-num {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 4px;
}
.stats-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.empty-tip {
  text-align: center;
  padding: 20px 0;
  color: var(--text-secondary);
  font-size: 13px;
}

/* ---------- 二维码 ---------- */
.qr-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 8px 0 4px;
}
.qr-img {
  width: 240px;
  height: 240px;
  border-radius: 12px;
  border: 1px solid var(--glass-border);
  background: #fff;
}
.qr-placeholder {
  width: 240px;
  height: 240px;
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  font-size: 13px;
  border-radius: 12px;
  border: 1px dashed var(--glass-border);
}
.qr-name {
  font-weight: 600;
  font-size: 14px;
}
.qr-link {
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-all;
  text-align: center;
}
.qr-pwd {
  font-size: 13px;
  color: var(--text);
}
</style>
