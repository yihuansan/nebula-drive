<script setup lang="ts">
/**
 * 工作台：登录后落地页。问候 Hero + 概览卡 + 存储环形图 +
 * 最近访问 + 快捷访问。数据全部来自现有接口，无新增后端依赖。
 */
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api, fmtSize } from '../api';
import { useAuthStore } from '../stores/auth';
import RingChart from '../components/RingChart.vue';
import MiniBars from '../components/MiniBars.vue';
import EmptyState from '../components/EmptyState.vue';

const router = useRouter();
const auth = useAuthStore();
const loading = ref(false);

const storages = ref<any[]>([]);
const recentList = ref<any[]>([]);
const favorites = ref<any[]>([]);
const shares = ref<any[]>([]);
const quickList = ref<any[]>([]);

/* ---------- 问候语 ---------- */
const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
});
const today = computed(() =>
  new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }),
);
const userName = computed(() => auth.user?.displayName || auth.user?.username || '');

/* ---------- 存储用量 ---------- */
const usedTotal = computed(() => storages.value.reduce((s, st) => s + (st.used || 0), 0));
const quota = computed(() => Number((auth.user as any)?.quota) || 0);
const quotaPercent = computed(() => (quota.value > 0 ? Math.min(100, Math.round((usedTotal.value / quota.value) * 100)) : null));
const quotaSub = computed(() =>
  quota.value > 0 ? `${fmtSize(usedTotal.value)} / ${fmtSize(quota.value)}` : `已用 ${fmtSize(usedTotal.value)}`,
);

/* ---------- 概览卡 ---------- */
const kpiCards = computed(() => [
  { icon: 'Odometer', label: '存储用量', value: fmtSize(usedTotal.value), tint: 'si-orange' },
  { icon: 'Clock', label: '最近访问', value: String(recentList.value.length), tint: 'si-blue' },
  { icon: 'StarFilled', label: '我的收藏', value: String(favorites.value.length), tint: 'si-purple' },
  { icon: 'Share', label: '分享链接', value: String(shares.value.length), tint: 'si-green' },
]);

/* ---------- 近 7 天活跃趋势（按访问时间聚合） ---------- */
const trend = computed(() => {
  const days: { label: string; count: number }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, count: 0 });
  }
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
  for (const r of recentList.value) {
    const t = parseAccessTime(r.accessed_at);
    if (!t) continue;
    const idx = 6 - Math.floor((todayEnd - t.getTime()) / 86400000);
    if (idx >= 0 && idx <= 6) days[idx].count++;
  }
  return days;
});

function parseAccessTime(ts: string): Date | null {
  if (!ts) return null;
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

/* ---------- 数据加载 ---------- */
async function load() {
  loading.value = true;
  try {
    const [sRes, fRes] = await Promise.all([api('/storages'), api('/favorites').catch(() => ({ favorites: [] }))]);
    storages.value = sRes.storages || [];
    favorites.value = fRes.favorites || [];

    // 最近访问 / 快捷访问：逐存储拉取并合并（按访问时间倒序）
    const recents: any[] = [];
    const quicks: any[] = [];
    await Promise.all(
      storages.value.map(async (st: any) => {
        try {
          const [r, q] = await Promise.all([
            api(`/files/recent?storageId=${st.id}&limit=20`),
            api(`/files/quick-access?storageId=${st.id}`).catch(() => ({ entries: [] })),
          ]);
          recents.push(...(r.entries || []).map((e: any) => ({ ...e, storageId: st.id })));
          quicks.push(...(q.entries || []).map((e: any) => ({ ...e, storageId: st.id })));
        } catch {
          /* 单个存储失败不阻塞整体 */
        }
      }),
    );
    recentList.value = recents
      .sort((a, b) => (parseAccessTime(b.accessed_at)?.getTime() || 0) - (parseAccessTime(a.accessed_at)?.getTime() || 0))
      .slice(0, 8);
    quickList.value = quicks.slice(0, 8);

    // 分享列表需要 files:share 权限，无权时静默置空
    if (auth.user?.permissions?.includes('files:share')) {
      const sh = await api('/shares').catch(() => ({ shares: [] }));
      shares.value = sh.shares || [];
    }
  } catch (e: any) {
    ElMessage.error(e.message || '加载工作台数据失败');
  } finally {
    loading.value = false;
  }
}
onMounted(load);

/* ---------- 跳转 ---------- */
function openRecent(row: any) {
  if (row.isDir) {
    router.push({ path: '/', query: { storage: String(row.storageId), path: row.path } });
  } else {
    router.push({ path: '/recent' });
  }
}
function openQuick(row: any) {
  router.push({ path: '/', query: { storage: String(row.storageId), path: row.isDir ? row.path : dirname(row.path) } });
}
function dirname(p: string) {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

function fmtTime(ts: string) {
  const d = parseAccessTime(ts);
  if (!d) return '';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <div class="dash-page" v-loading="loading">
    <!-- 问候 Hero -->
    <div class="dash-hero glass page-enter">
      <div class="hero-text">
        <h1>{{ greeting }}，{{ userName }}</h1>
        <p>{{ today }} · 欢迎回到你的云空间</p>
      </div>
      <div class="hero-trend">
        <div class="hero-trend-title">近 7 天访问</div>
        <MiniBars :data="trend.map((d) => d.count)" :labels="trend.map((d) => d.label)" :height="44" />
      </div>
    </div>

    <!-- 概览卡 -->
    <div class="kpi-row">
      <div v-for="(k, i) in kpiCards" :key="k.label" class="kpi glass-card hover-lift page-enter" :style="{ '--i': i + 1 }">
        <div class="kpi-icon" :class="k.tint"><el-icon :size="22"><component :is="k.icon" /></el-icon></div>
        <div class="kpi-body">
          <div class="kpi-value">{{ k.value }}</div>
          <div class="kpi-label">{{ k.label }}</div>
        </div>
      </div>
    </div>

    <!-- 中部：存储环形图 + 最近访问 -->
    <div class="dash-mid">
      <div class="panel glass-card page-enter" style="--i: 5">
        <div class="panel-head">
          <el-icon class="panel-icon"><Box /></el-icon>
          <span class="panel-title">存储空间</span>
          <span class="status-badge info" v-if="storages.length">{{ storages.length }} 个存储</span>
        </div>
        <div class="quota-wrap">
          <RingChart :percent="quotaPercent" :center-text="quota > 0 ? undefined : '不限'" :center-sub="quotaSub" />
          <div class="quota-note">
            <template v-if="quota > 0">个人配额使用率</template>
            <template v-else>未设置配额限制</template>
          </div>
        </div>
      </div>

      <div class="panel glass-card page-enter" style="--i: 6">
        <div class="panel-head">
          <el-icon class="panel-icon"><Clock /></el-icon>
          <span class="panel-title">最近访问</span>
          <a class="panel-more" @click="router.push('/recent')">查看全部</a>
        </div>
        <div v-if="recentList.length" class="recent-list page-enter-stagger">
          <div v-for="(r, i) in recentList" :key="r.storageId + ':' + r.path" class="recent-item" :style="{ '--i': i }" @click="openRecent(r)">
            <el-icon class="recent-icon" :color="r.isDir ? 'var(--accent)' : 'var(--text-secondary)'">
              <Folder v-if="r.isDir" />
              <Document v-else />
            </el-icon>
            <div class="recent-text">
              <div class="recent-name">{{ r.name }}</div>
              <div class="recent-meta">{{ fmtTime(r.accessed_at) }}{{ r.size ? ' · ' + fmtSize(r.size) : '' }}</div>
            </div>
            <el-icon class="recent-arrow"><ArrowRight /></el-icon>
          </div>
        </div>
        <EmptyState v-else title="暂无访问记录" description="浏览文件后，这里会展示你最近打开的内容" />
      </div>
    </div>

    <!-- 底部：快捷访问 -->
    <div class="panel glass-card page-enter" style="--i: 7">
      <div class="panel-head">
        <el-icon class="panel-icon"><Star /></el-icon>
        <span class="panel-title">快捷访问</span>
        <a class="panel-more" @click="router.push('/quick-access')">管理</a>
      </div>
      <div v-if="quickList.length" class="quick-row page-enter-stagger">
        <div v-for="(q, i) in quickList" :key="q.storageId + ':' + q.path" class="quick-chip" :style="{ '--i': i }" @click="openQuick(q)">
          <el-icon :color="q.isDir ? 'var(--accent)' : 'var(--text-secondary)'">
            <Folder v-if="q.isDir" />
            <Document v-else />
          </el-icon>
          <span class="quick-chip-name">{{ q.name }}</span>
        </div>
      </div>
      <EmptyState v-else title="还没有固定项" description="在「文件管理」中右键文件选择「添加到快捷访问」" />
    </div>
  </div>
</template>

<style scoped>
.dash-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 2px;
}

/* ---------- Hero ---------- */
.dash-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 24px 28px;
  border-radius: var(--card-radius, 20px);
}
.hero-text h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 800;
  background: linear-gradient(120deg, var(--text) 40%, var(--accent));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hero-text p {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
}
.hero-trend {
  width: 200px;
  flex-shrink: 0;
}
.hero-trend-title {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

/* ---------- 概览卡 ---------- */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}
.kpi {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 18px;
  cursor: default;
}
.kpi-icon {
  width: 48px;
  height: 48px;
  border-radius: 15px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border: 1px solid var(--glass-border);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}
.si-orange { color: #e6a23c; background: rgba(230, 162, 60, 0.13); }
.si-blue { color: #409eff; background: rgba(64, 158, 255, 0.13); }
.si-purple { color: #b37feb; background: rgba(179, 127, 235, 0.13); }
.si-green { color: #67c23a; background: rgba(103, 194, 58, 0.13); }
.kpi-value {
  font-size: 21px;
  font-weight: 700;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
}
.kpi-label {
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-top: 2px;
}

/* ---------- 面板 ---------- */
.dash-mid {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 14px;
}
.panel {
  border-radius: 18px;
  padding: 18px 20px;
}
.panel:hover {
  transform: none;
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.panel-icon {
  color: var(--accent);
  font-size: 17px;
}
.panel-title {
  font-size: 14.5px;
  font-weight: 600;
}
.panel-more {
  margin-left: auto;
  font-size: 12.5px;
  color: var(--accent);
  cursor: pointer;
  user-select: none;
}
.panel-more:hover {
  text-decoration: underline;
}

/* ---------- 配额环形图 ---------- */
.quota-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 8px 0 2px;
}
.quota-note {
  font-size: 12.5px;
  color: var(--text-secondary);
}

/* ---------- 最近访问列表 ---------- */
.recent-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.recent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.2s var(--ease-smooth);
}
.recent-item:hover {
  background: var(--accent-soft);
}
.recent-icon {
  font-size: 19px;
  flex-shrink: 0;
}
.recent-text {
  flex: 1;
  min-width: 0;
}
.recent-name {
  font-size: 13.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.recent-meta {
  font-size: 11.5px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.recent-arrow {
  color: var(--text-secondary);
  font-size: 13px;
  opacity: 0;
  transition: opacity 0.2s;
}
.recent-item:hover .recent-arrow {
  opacity: 1;
}

/* ---------- 快捷访问 ---------- */
.quick-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.quick-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.22s var(--ease-smooth);
}
.quick-chip:hover {
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  transform: translateY(-2px);
  box-shadow: 0 8px 20px var(--accent-soft);
}
.quick-chip-name {
  max-width: 160px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------- 响应式 ---------- */
@media (max-width: 1100px) {
  .kpi-row {
    grid-template-columns: repeat(2, 1fr);
  }
  .dash-mid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  .dash-hero {
    flex-direction: column;
    align-items: flex-start;
  }
  .hero-trend {
    width: 100%;
  }
  .kpi-row {
    grid-template-columns: 1fr;
  }
}
</style>
