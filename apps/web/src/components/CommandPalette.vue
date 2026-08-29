<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { useAuthStore } from '../stores/auth';
import { useTransferStore } from '../stores/transfer';

/**
 * 全局命令面板（Ctrl/⌘ + K 唤起，全主题可用）
 * 三段内容：页面导航（按权限过滤）/ 文件搜索（300ms 防抖走 /search）/ 快捷动作
 * 键盘：↑↓ 移动、Enter 执行、Esc 关闭
 */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const transfer = useTransferStore();

const open = ref(false);
const query = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

function perm(p: string) {
  const perms = (auth.user as any)?.permissions;
  return !perms || perms.includes(p);
}

/* ---------- ① 页面导航 ---------- */
const NAV_ITEMS = [
  { path: '/dashboard', label: '工作台', icon: 'HomeFilled', perm: 'files:view' },
  { path: '/', label: '我的文件', icon: 'Folder', perm: 'files:view' },
  { path: '/recent', label: '最近', icon: 'Clock', perm: 'files:view' },
  { path: '/favorites', label: '我的收藏', icon: 'StarFilled', perm: 'files:view' },
  { path: '/quick-access', label: '快捷访问', icon: 'Star', perm: 'files:view' },
  { path: '/media', label: '媒体库', icon: 'VideoCamera', perm: 'files:view' },
  { path: '/hidden', label: '隐藏空间', icon: 'Lock', perm: 'files:view' },
  { path: '/tags', label: '标签', icon: 'PriceTag', perm: 'files:view' },
  { path: '/subscriptions', label: '转存和订阅', icon: 'Download', perm: 'files:share' },
  { path: '/shares', label: '共享', icon: 'Share', perm: 'files:share' },
  { path: '/share-collab', label: '共享管理', icon: 'User', perm: 'files:share' },
  { path: '/recycle', label: '回收站', icon: 'Delete', perm: 'recycle:view' },
  { path: '/profile', label: '我的资料', icon: 'User', perm: 'files:view' },
  { path: '/admin/users', label: '用户管理', icon: 'User', perm: 'users:view' },
  { path: '/admin/roles', label: '角色权限', icon: 'Lock', perm: 'users:manage' },
  { path: '/admin/storages', label: '存储管理', icon: 'Box', perm: 'storages:view' },
  { path: '/admin/settings', label: '系统设置', icon: 'Tools', perm: 'settings:view' },
  { path: '/admin/logs', label: '操作日志', icon: 'Document', perm: 'logs:view' },
  { path: '/admin/sync', label: '同步管理', icon: 'Refresh', perm: 'sync:view' },
  { path: '/admin/stats', label: '系统统计', icon: 'DataLine', perm: 'stats:view' },
];

/* ---------- ③ 快捷动作 ---------- */
const ACTION_ITEMS = [
  { id: 'reload', label: '刷新当前页', icon: 'Refresh', hint: '重新加载页面数据' },
  { id: 'theme', label: '切换主题', icon: 'Brush', hint: '打开主题选择器' },
  { id: 'transfer', label: '打开传输中心', icon: 'Promotion', hint: '查看上传/下载任务' },
];

function runAction(id: string) {
  if (id === 'reload') {
    window.location.reload();
  } else if (id === 'theme') {
    window.dispatchEvent(new CustomEvent('nd:open-theme-picker'));
  } else if (id === 'transfer') {
    if (!transfer.hasTasks) {
      ElMessage.info('当前没有传输任务');
      return;
    }
    transfer.expanded = true;
  }
}

/* ---------- ② 文件搜索（防抖） ---------- */
const searchResults = ref<any[]>([]);
const searching = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
const storageNames = ref<Record<number, string>>({});
let storagesLoaded = false;

async function loadStorages() {
  if (storagesLoaded) return;
  storagesLoaded = true;
  try {
    const r = await api('/storages?fast=1');
    for (const s of r.storages || []) storageNames.value[s.id] = s.name;
  } catch { /* 忽略：仅影响存储名展示 */ }
}

watch(query, (q) => {
  if (searchTimer) clearTimeout(searchTimer);
  const kw = q.trim();
  if (!kw) {
    searchResults.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  searchTimer = setTimeout(async () => {
    try {
      const r = await api(`/search?q=${encodeURIComponent(kw)}`);
      // 竞态保护：仅接受最新关键词的结果
      if (query.value.trim() === kw) searchResults.value = (r.results || []).slice(0, 8);
    } catch {
      searchResults.value = [];
    } finally {
      if (query.value.trim() === kw) searching.value = false;
    }
  }, 300);
});

/* ---------- 结果过滤与扁平索引 ---------- */
function match(label: string, q: string) {
  return !q || label.toLowerCase().includes(q);
}
const q = computed(() => query.value.trim().toLowerCase());

const navFiltered = computed(() =>
  NAV_ITEMS.filter((n) => perm(n.perm) && match(n.label, q.value))
);
const actionFiltered = computed(() => ACTION_ITEMS.filter((a) => match(a.label, q.value)));

type FlatItem =
  | { kind: 'nav'; nav: (typeof NAV_ITEMS)[number] }
  | { kind: 'action'; action: (typeof ACTION_ITEMS)[number] }
  | { kind: 'file'; file: any };

const flatItems = computed<FlatItem[]>(() => [
  ...navFiltered.value.map((nav) => ({ kind: 'nav' as const, nav })),
  ...actionFiltered.value.map((action) => ({ kind: 'action' as const, action })),
  ...searchResults.value.map((file) => ({ kind: 'file' as const, file })),
]);

const activeIndex = ref(0);
watch(query, () => { activeIndex.value = 0; });
watch(flatItems, () => {
  if (activeIndex.value >= flatItems.value.length) activeIndex.value = Math.max(0, flatItems.value.length - 1);
});

const isEmpty = computed(() => open.value && !searching.value && flatItems.value.length === 0);

/* ---------- 打开 / 关闭 / 执行 ---------- */
function openPalette() {
  open.value = true;
  query.value = '';
  activeIndex.value = 0;
  searchResults.value = [];
  loadStorages();
  nextTick(() => inputRef.value?.focus());
}
function closePalette() {
  open.value = false;
  query.value = '';
  searchResults.value = [];
}

function execute(item: FlatItem) {
  closePalette();
  if (item.kind === 'nav') {
    router.push(item.nav.path);
  } else if (item.kind === 'action') {
    runAction(item.action.id);
  } else {
    // 文件：深链到文件管理页（复用 Files 的 ?storage=&path= watch）
    const r = item.file;
    const dir = r.entry.isDir ? r.entry.path : (r.entry.path.replace(/\/[^/]*$/, '') || '/');
    router.push({ path: '/', query: { storage: String(r.storageId), path: dir } });
  }
}

function executeActive() {
  const item = flatItems.value[activeIndex.value];
  if (item) execute(item);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closePalette();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    const len = flatItems.value.length;
    activeIndex.value = len ? (activeIndex.value + 1) % len : 0;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const len = flatItems.value.length;
    activeIndex.value = len ? (activeIndex.value - 1 + len) % len : 0;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    executeActive();
  }
}

/** 全局快捷键：Ctrl/⌘ + K（仅在已登录时响应） */
function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    if (!localStorage.getItem('nebula_token')) return;
    e.preventDefault();
    if (open.value) closePalette();
    else openPalette();
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown));
onUnmounted(() => window.removeEventListener('keydown', onGlobalKeydown));

function groupName(kind: string) {
  return kind === 'nav' ? '页面导航' : kind === 'action' ? '快捷动作' : '文件';
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="cp-mask" @click.self="closePalette">
      <div class="cp-panel glass fade-up" role="dialog" aria-label="命令面板">
        <div class="cp-input-wrap">
          <el-icon class="cp-search-icon"><Search /></el-icon>
          <input
            ref="inputRef"
            v-model="query"
            class="cp-input"
            placeholder="搜索页面、文件或输入命令…"
            @keydown="onKeydown"
          />
          <kbd class="cp-kbd">Esc</kbd>
        </div>
        <div class="cp-list">
          <template v-if="!isEmpty">
            <!-- 导航 -->
            <template v-if="navFiltered.length">
              <div class="cp-group">{{ groupName('nav') }}</div>
              <div
                v-for="(n, i) in navFiltered"
                :key="'nav-' + n.path"
                class="cp-item"
                :class="{ active: activeIndex === i }"
                @click="execute({ kind: 'nav', nav: n })"
                @mouseenter="activeIndex = i"
              >
                <el-icon class="cp-icon"><component :is="n.icon" /></el-icon>
                <span class="cp-label">{{ n.label }}</span>
                <span class="cp-hint">前往</span>
              </div>
            </template>
            <!-- 快捷动作 -->
            <template v-if="actionFiltered.length">
              <div class="cp-group">{{ groupName('action') }}</div>
              <div
                v-for="(a, i) in actionFiltered"
                :key="'act-' + a.id"
                class="cp-item"
                :class="{ active: activeIndex === navFiltered.length + i }"
                @click="execute({ kind: 'action', action: a })"
                @mouseenter="activeIndex = navFiltered.length + i"
              >
                <el-icon class="cp-icon"><component :is="a.icon" /></el-icon>
                <span class="cp-label">{{ a.label }}</span>
                <span class="cp-hint">{{ a.hint }}</span>
              </div>
            </template>
            <!-- 文件搜索 -->
            <template v-if="query.trim()">
              <div class="cp-group">
                {{ groupName('file') }}
                <span v-if="searching" class="cp-searching">搜索中…</span>
              </div>
              <div
                v-for="(f, i) in searchResults"
                :key="'file-' + f.storageId + ':' + f.entry.path"
                class="cp-item"
                :class="{ active: activeIndex === navFiltered.length + actionFiltered.length + i }"
                @click="execute({ kind: 'file', file: f })"
                @mouseenter="activeIndex = navFiltered.length + actionFiltered.length + i"
              >
                <el-icon class="cp-icon"><Folder v-if="f.entry.isDir" /><Document v-else /></el-icon>
                <span class="cp-label">{{ f.entry.name }}</span>
                <span class="cp-hint cp-path">
                  {{ storageNames[f.storageId] ? storageNames[f.storageId] + ' · ' : '' }}{{ f.entry.path }}
                </span>
              </div>
              <div v-if="!searching && !searchResults.length" class="cp-empty">未找到匹配的文件</div>
            </template>
          </template>
          <div v-else class="cp-empty">无匹配结果，换个关键词试试</div>
        </div>
        <div class="cp-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> 移动</span>
          <span><kbd>Enter</kbd> 执行</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cp-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 14vh;
}
.cp-panel {
  width: min(620px, calc(100vw - 32px));
  max-height: min(520px, 72vh);
  border-radius: 18px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
}
.cp-input-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--glass-border);
}
.cp-search-icon {
  color: var(--text-secondary);
  font-size: 17px;
  flex-shrink: 0;
}
.cp-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 15px;
  color: var(--text);
}
.cp-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.7;
}
.cp-kbd,
.cp-footer kbd {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 6px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text-secondary);
  font-family: inherit;
}
.cp-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.cp-group {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  padding: 10px 10px 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.cp-searching {
  font-weight: 400;
  opacity: 0.8;
}
.cp-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text);
}
.cp-item.active {
  background: var(--glass-bg-hover);
}
.cp-icon {
  font-size: 16px;
  color: var(--accent);
  flex-shrink: 0;
}
.cp-label {
  flex-shrink: 0;
  max-width: 40%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.cp-hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.cp-path {
  direction: rtl;
  text-align: left;
}
.cp-empty {
  padding: 20px 12px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}
.cp-footer {
  display: flex;
  gap: 14px;
  padding: 10px 16px;
  border-top: 1px solid var(--glass-border);
  font-size: 12px;
  color: var(--text-secondary);
}
.cp-footer kbd {
  margin-right: 4px;
}

/* 入场动画（尊重系统减弱动效偏好） */
.fade-up {
  animation: cp-fade-up 0.18s ease-out both;
}
@keyframes cp-fade-up {
  from {
    opacity: 0;
    transform: translateY(-10px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .fade-up {
    animation: none;
  }
}
</style>
