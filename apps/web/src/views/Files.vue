<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, fmtSize, fmtTime } from '../api';
import { useTheme, THEMES, type ThemeKey } from '../useTheme';
import { useAuthStore } from '../stores/auth';

const storages = ref<any[]>([]);
const usageTotal = ref(0); // 真实配额用量（所有存储 used 之和），挂载时异步加载
const storageId = ref(0);
const path = ref('/');
const entries = ref<any[]>([]);
const loading = ref(false);
const hasLoaded = ref(false);
const selected = ref<any[]>([]);
const tableRef = ref();
/* 视图持久化（F2）：从 localStorage 恢复，切换时写回 */
const _storedView = localStorage.getItem('nd-view');
const view = ref<'grid' | 'list' | 'photo'>(
  _storedView === 'grid' || _storedView === 'list' || _storedView === 'photo' ? _storedView : 'grid'
);
watch(view, (v) => localStorage.setItem('nd-view', v));
const multiSelectMode = ref(false);

/* ---------- 共享给用户功能 ---------- */
const collabShareDialog = ref(false);
const collabShareTarget = ref<any>(null);
const collabShareForm = ref({
  name: '',
  usernames: '' as string,
  permission: 'view' as 'view' | 'download' | 'manage',
  expiresAt: '',
});
const collabShareLoading = ref(false);

async function openCollabShareDialog(row: any) {
  collabShareTarget.value = row;
  collabShareForm.value = {
    name: row.name,
    usernames: '',
    permission: 'view',
    expiresAt: '',
  };
  collabShareDialog.value = true;
}

async function doCollabShare() {
  if (!collabShareTarget.value) return;
  const usernames = collabShareForm.value.usernames
    .split(/[,，\s]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  
  if (!usernames.length) {
    ElMessage.warning('请输入至少一个用户名');
    return;
  }
  collabShareLoading.value = true;
  try {
    await api('/share-collab', {
      method: 'POST',
      body: JSON.stringify({
        storageId: storageId.value,
        path: collabShareTarget.value.path,
        name: collabShareForm.value.name,
        isDir: collabShareTarget.value.isDir,
        usernames,
        permission: collabShareForm.value.permission,
        expiresAt: collabShareForm.value.expiresAt || null,
      }),
    });
    ElMessage.success('共享已创建');
    collabShareDialog.value = false;
  } catch (e: any) {
    ElMessage.error(e.message || '创建共享失败');
  } finally {
    collabShareLoading.value = false;
  }
}

// 布局类型（根据主题决定）
const { theme } = useTheme();
const layoutType = computed(() => {
  const t = THEMES[theme.value as ThemeKey];
  return t?.layout || 'sidebar';
});

// 统计卡片配置（仪表盘主题：4 张卡 + 趋势 chip）
const auth = useAuthStore();
const statCards = computed(() => {
  const now = Date.now();
  const weekMs = 7 * 24 * 3600 * 1000;
  const recent = entries.value.filter(e => (e.mtime || 0) >= now - weekMs);
  const prev = entries.value.filter(e => {
    const m = e.mtime || 0;
    return m < now - weekMs && m >= now - 2 * weekMs;
  });
  const totalSize = entries.value.reduce((sum, e) => sum + (e.size || 0), 0);
  const recentFiles = recent.filter(e => !e.isDir).length;
  const fileCount = entries.value.filter(e => !e.isDir).length;
  const quota = Number((auth.user as any)?.quota) || 0;
  const quotaPct = quota > 0 ? Math.min(100, Math.round((usageTotal.value / quota) * 100)) : null;
  const diff = recent.length - prev.length;
  return [
    {
      id: 'size',
      icon: 'DataLine',
      iconClass: 'si-blue',
      label: '总容量',
      value: fmtSize(totalSize),
      trend: recent.length
        ? { dir: 'up', text: `本周 +${recent.length}` }
        : { dir: 'down', text: '近期无变化' },
    },
    {
      id: 'files',
      icon: 'Document',
      iconClass: 'si-green',
      label: '文件数',
      value: fileCount,
      trend: recentFiles
        ? { dir: 'up', text: `本周 +${recentFiles}` }
        : { dir: 'down', text: '无新增' },
    },
    {
      id: 'recent',
      icon: 'Upload',
      iconClass: 'si-purple',
      label: '本周修改（当前文件夹）',
      value: recent.length,
      trend: diff > 0
        ? { dir: 'up', text: `较上期 +${diff}` }
        : diff < 0
          ? { dir: 'down', text: `较上期 ${diff}` }
          : { dir: 'up', text: '与上期持平' },
    },
    {
      id: 'quota',
      icon: 'Odometer',
      iconClass: 'si-orange',
      label: '配额使用率',
      value: quotaPct === null ? '不限' : `${quotaPct}%`,
      trend: quotaPct === null
        ? { dir: 'up', text: '无上限' }
        : quotaPct >= 80
          ? { dir: 'down', text: '接近上限' }
          : { dir: 'up', text: '空间充足' },
    },
  ];
});

/* ---------- ⌘K 命令面板（仅 command 主题激活） ---------- */
const cmdkOpen = ref(false);
const cmdkQuery = ref('');
const cmdkActiveIndex = ref(0);
const cmdkInputRef = ref<HTMLInputElement | null>(null);

/** 模糊打分：子串 > 子序列；不匹配返回 -1 */
function cmdkScore(name: string, q: string): number {
  const n = name.toLowerCase();
  const s = q.trim().toLowerCase();
  if (!s) return 100;
  const idx = n.indexOf(s);
  if (idx >= 0) return 10000 - idx; // 子串命中：位置越靠前分越高
  let i = 0;
  let score = 0;
  let gap = 0;
  for (let j = 0; j < n.length && i < s.length; j++) {
    if (n[j] === s[i]) {
      i++;
      score += Math.max(0, 50 - gap);
      gap = 0;
    } else {
      gap++;
    }
  }
  if (i < s.length) return -1; // 非子序列
  return score;
}

const cmdkResults = computed(() => {
  const q = cmdkQuery.value.trim().toLowerCase();
  return entries.value
    .map((entry, index) => ({ entry, index, score: cmdkScore(entry.name, q) }))
    .filter(r => r.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 20)
    .map(r => r.entry);
});

watch(cmdkQuery, () => {
  cmdkActiveIndex.value = 0;
});

function openCmdk() {
  cmdkOpen.value = true;
  cmdkQuery.value = '';
  cmdkActiveIndex.value = 0;
  nextTick(() => cmdkInputRef.value?.focus());
}
function closeCmdk() {
  cmdkOpen.value = false;
  cmdkQuery.value = '';
  cmdkActiveIndex.value = 0;
}
// 离开 command 主题时自动关闭面板，避免状态残留
watch(layoutType, (t) => {
  if (t !== 'command') closeCmdk();
});
function executeCmdk() {
  const entry = cmdkResults.value[cmdkActiveIndex.value];
  if (!entry) return;
  closeCmdk();
  if (entry.isDir) {
    path.value = entry.path;
    load();
  } else {
    openPreview(entry);
  }
}
function selectCmdk(i: number) {
  cmdkActiveIndex.value = i;
  executeCmdk();
}
/** 面板打开时的键盘导航：↑/↓ 移动、Enter 执行、Esc 关闭 */
function onCmdkKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    closeCmdk();
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    const len = cmdkResults.value.length;
    cmdkActiveIndex.value = len ? (cmdkActiveIndex.value + 1) % len : 0;
    e.preventDefault();
  } else if (e.key === 'ArrowUp') {
    const len = cmdkResults.value.length;
    cmdkActiveIndex.value = len ? (cmdkActiveIndex.value - 1 + len) % len : 0;
    e.preventDefault();
  } else if (e.key === 'Enter') {
    executeCmdk();
    e.preventDefault();
  }
}
/** 全局快捷键：Meta+K / Control+K（仅 command 主题响应） */
function onGlobalKeydown(e: KeyboardEvent) {
  if (layoutType.value !== 'command') return;
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    if (cmdkOpen.value) closeCmdk();
    else openCmdk();
  }
}
onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
});

/** 便当盒布局：featured 2×2（首卡）+ medium 2×1（第 2/3 卡）+ 彩色 tile（每屏 2-3 张） */
function bentoCardClass(index: number): string {
  if (index === 0) return 'bento-featured tile-indigo';
  if (index === 1 || index === 2) return 'bento-medium';
  if (index === 4) return 'tile-amber';
  if (index === 8) return 'tile-emerald';
  return '';
}



/* ---------- 标签系统 ---------- */
const allTags = ref<string[]>([]);
const activeTagFilter = ref<string | null>(null);
const tagFilterDialog = ref(false);
const tagDialogVisible = ref(false);
const tagDialogTarget = ref<any>(null);
const tagDialogTags = ref<string[]>([]);
const newTagInput = ref('');

async function loadAllTags() {
  try {
    const r = await api('/tags');
    allTags.value = r.tags || [];
  } catch { /* ignore */ }
}

async function loadFileTags(filePath: string): Promise<string[]> {
  try {
    const r = await api(`/files/${encodeURIComponent(filePath)}/tags?storageId=${storageId.value}`);
    return r.tags || [];
  } catch { return []; }
}

async function openTagDialog(row: any) {
  tagDialogTarget.value = row;
  tagDialogTags.value = await loadFileTags(row.path);
  tagDialogVisible.value = true;
}

async function addTagToCurrent() {
  const tag = newTagInput.value.trim();
  if (!tag || !tagDialogTarget.value) return;
  try {
    await api(`/files/${encodeURIComponent(tagDialogTarget.value.path)}/tags?storageId=${storageId.value}`, {
      method: 'POST',
      body: JSON.stringify({ tag }),
    });
    tagDialogTags.value.push(tag);
    newTagInput.value = '';
    loadAllTags();
  } catch (e: any) {
    ElMessage.error(e.message || '添加标签失败');
  }
}

async function removeTagFromCurrent(tag: string) {
  if (!tagDialogTarget.value) return;
  try {
    await api(`/files/${encodeURIComponent(tagDialogTarget.value.path)}/tags/${encodeURIComponent(tag)}?storageId=${storageId.value}`, {
      method: 'DELETE',
    });
    tagDialogTags.value = tagDialogTags.value.filter(t => t !== tag);
    loadAllTags();
  } catch (e: any) {
    ElMessage.error(e.message || '删除标签失败');
  }
}

async function createNewTag() {
  const tag = newTagInput.value.trim();
  if (!tag) return;
  try {
    await api('/tags', { method: 'POST', body: JSON.stringify({ tag }) });
    allTags.value.push(tag);
    newTagInput.value = '';
  } catch (e: any) {
    ElMessage.error(e.message || '创建标签失败');
  }
}

async function deleteTag(tag: string) {
  try {
    await api(`/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' });
    allTags.value = allTags.value.filter(t => t !== tag);
    if (activeTagFilter.value === tag) activeTagFilter.value = null;
  } catch (e: any) {
    ElMessage.error(e.message || '删除标签失败');
  }
}

function filterByTag(tag: string) {
  if (activeTagFilter.value === tag) {
    activeTagFilter.value = null;
    load();
  } else {
    activeTagFilter.value = tag;
    load();
  }
}

async function loadTagFiles() {
  if (!activeTagFilter.value) return;
  loading.value = true;
  try {
    const r = await api(`/files-by-tag?tag=${encodeURIComponent(activeTagFilter.value)}`);
    entries.value = r.files.map((f: any) => ({
      name: f.path.split('/').pop(),
      path: f.path,
      isDir: false,
      size: 0,
      mtime: 0,
      tag: f.tag,
    }));
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

/* ---------- 右键上下文菜单 ---------- */
const contextMenu = ref({ visible: false, x: 0, y: 0, target: null as any });
function showContextMenu(e: MouseEvent, row: any) {
  e.preventDefault();
  e.stopPropagation();
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, target: row };
}
function closeContextMenu() {
  contextMenu.value.visible = false;
}
function ctxAction(cmd: string) {
  const row = contextMenu.value.target;
  closeContextMenu();
  if (!row) return;
  switch (cmd) {
    case 'open': openDir(row); break;
    case 'preview': openPreview(row); break;
    case 'download': download(row); break;
    case 'decompress': doDecompress(row); break;
    case 'compress': doCompressSingle(row); break;
    case 'share': openShare(row); break;
    case 'collab-share': openCollabShareDialog(row); break;
    case 'rename': openRename(row); break;
    case 'move': openMove(row, 'move'); break;
    case 'copy': openMove(row, 'copy'); break;
    case 'props': openProps(row); break;
    case 'delete': doDelete(row); break;
  }
}
/** 压缩单个文件/文件夹 */
async function doCompressSingle(row: any) {
  compressing.value = true;
  try {
    const r = await api('/files/compress', {
      method: 'POST',
      body: JSON.stringify({
        storageId: storageId.value,
        paths: [row.path],
        destPath: path.value,
      }),
    });
    ElMessage.success(`已压缩为 ${r.name}`);
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '压缩失败');
  } finally {
    compressing.value = false;
  }
}
// 点击其他位置关闭菜单
onMounted(() => {
  document.addEventListener('click', closeContextMenu);
  document.addEventListener('contextmenu', (e) => {
    // 如果点击的不是文件卡片，关闭菜单
    if (!(e.target as HTMLElement).closest?.('.file-card, .el-table__row')) {
      closeContextMenu();
    }
  });
});
onUnmounted(() => {
  document.removeEventListener('click', closeContextMenu);
});

/** 判断文件是否被选中 */
function isSelected(row: any) {
  return selected.value.some((x: any) => x.path === row.path);
}

/** 切换文件选中状态 */
function toggleSelect(row: any) {
  const idx = selected.value.findIndex((x: any) => x.path === row.path);
  if (idx >= 0) {
    selected.value.splice(idx, 1);
  } else {
    selected.value.push(row);
  }
}

/** 清空选中并退出多选模式 */
function clearSelection() {
  selected.value = [];
  multiSelectMode.value = false;
}

/** 卡片点击：多选模式下选中，否则正常打开 */
function onCardClick(row: any) {
  if (multiSelectMode.value) {
    toggleSelect(row);
  } else {
    openDir(row);
  }
}

/* ---------- 文件类型图标（按扩展名着色，对标百度网盘） ---------- */
const FILE_TYPES: { exts: string[]; icon: string; color: string }[] = [
  { exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'], icon: 'Picture', color: '#ec4899' },
  { exts: ['mp4', 'avi', 'mkv', 'mov', 'flv', 'wmv'], icon: 'VideoPlay', color: '#ef4444' },
  { exts: ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'], icon: 'Headset', color: '#f59e0b' },
  { exts: ['pdf'], icon: 'Document', color: '#dc2626' },
  { exts: ['doc', 'docx'], icon: 'Document', color: '#2563eb' },
  { exts: ['xls', 'xlsx', 'csv'], icon: 'DataLine', color: '#16a34a' },
  { exts: ['ppt', 'pptx'], icon: 'Document', color: '#ea580c' },
  { exts: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'], icon: 'Files', color: '#ca8a04' },
  { exts: ['js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'html', 'css', 'json', 'sh', 'vue', 'go', 'rs'], icon: 'DataLine', color: '#0d9488' },
];
function fileType(name: string, isDir: boolean) {
  if (isDir) return { icon: 'Folder', color: 'var(--accent)' };
  const ext = name.split('.').pop()?.toLowerCase() || '';
  for (const t of FILE_TYPES) if (t.exts.includes(ext)) return t;
  return { icon: 'Document', color: '#94a3b8' };
}

/* ---------- 排序（服务端支持 name/size/mtime × asc/desc） ---------- */
const sortKey = ref<'name' | 'size' | 'mtime'>('name');
const sortOrder = ref<'asc' | 'desc'>('asc');

/* 列表表头排序（F1）：el-table sort-change → 更新 sortKey/sortOrder 并请求服务端排序 */
function onSortChange({ prop, order }: { prop: string; order: 'ascending' | 'descending' | null }) {
  if (order) {
    sortKey.value = prop as 'name' | 'size' | 'mtime';
    sortOrder.value = order === 'ascending' ? 'asc' : 'desc';
  }
  load();
}

/* ---------- 工具栏：搜索框 + 更多菜单（低频操作收纳） ---------- */
function runSearchFromBox() {
  searchDialog.value = true;
  doSearch();
}
function handleToolbarMore(cmd: string) {
  switch (cmd) {
    case 'refresh': load(); break;
    case 'sort-name': sortKey.value = 'name'; load(); break;
    case 'sort-size': sortKey.value = 'size'; load(); break;
    case 'sort-mtime': sortKey.value = 'mtime'; load(); break;
    case 'tag-filter': tagFilterDialog.value = true; break;
    case 'multi-select':
      multiSelectMode.value = !multiSelectMode.value;
      if (!multiSelectMode.value) selected.value = [];
      break;
  }
}

/* ---------- 移动端（<768px，P8）：仅 UI 状态 —— 全屏搜索覆盖层 + ⋯ 更多菜单；复用既有 handler ---------- */
const mobileSearchOpen = ref(false);
const mobileMoreRef = ref();
/* ---------- 平板（768–1199px，F0）：行2 收敛为 [搜索][⋯]，视图/排序/上传/新建/存储 收进 ⋯ ElPopover ---------- */
const tabletMoreRef = ref();

const parent = computed(() =>
  path.value === '/' ? null : path.value.replace(/\/[^/]*\/?$/, '') || '/'
);
const crumbs = computed(() => {
  const full = [{ name: '根目录', path: '/' }];
  if (path.value !== '/') {
    const segs = path.value.split('/').filter(Boolean);
    let acc = '';
    for (const s of segs) {
      acc += '/' + s;
      full.push({ name: s, path: acc });
    }
  }
  /* 深层路径（>3 级）：中段折叠为 "…"，保留 根目录 + … + 末两级（F3） */
  if (full.length > 4) {
    const firstHidden = full[1];
    return [full[0], { name: '…', path: firstHidden.path, isEllipsis: true }, ...full.slice(-2)];
  }
  return full;
});

async function loadStorages() {
  try {
    // fast=1 跳过用量计算，快速返回存储列表
    const r = await api('/storages?fast=1');
    storages.value = r.storages;
    if (!storageId.value && r.storages.length) {
      storageId.value = r.storages[0].id;
    }
  } catch (e: any) {
    ElMessage.error(e.message || '加载存储失败');
  }
}

async function load() {
  if (!storageId.value) return;
  // 如果正在按标签筛选，加载标签文件
  if (activeTagFilter.value) {
    await loadTagFiles();
    hasLoaded.value = true;
    return;
  }
  loading.value = true;
  try {
    const r = await api(
      `/files?storageId=${storageId.value}&path=${encodeURIComponent(path.value)}&sort=${sortKey.value}&order=${sortOrder.value}`
    );
    entries.value = r.entries;
  } catch (e: any) {
    ElMessage.error(e.message || '加载目录失败');
  } finally {
    loading.value = false;
    hasLoaded.value = true;
  }
}

function onStorageChange() {
  path.value = '/';
  load();
}

function openDir(e: any) {
  if (e.isDir) {
    path.value = e.path;
    load();
  }
}

function goCrumb(p: string) {
  path.value = p;
  load();
}

/* ---------- 文件收藏（星标） ---------- */
const starredSet = ref<Set<string>>(new Set());
function starKey(row: any) {
  return storageId.value + '||' + row.path;
}
function isStarred(row: any) {
  return starredSet.value.has(starKey(row));
}
async function loadFavorites() {
  try {
    const r = await api('/favorites');
    const set = new Set<string>();
    for (const f of r.favorites) set.add(f.storage_id + '||' + f.path);
    starredSet.value = set;
  } catch { /* ignore */ }
}
async function toggleStar(row: any) {
  const key = starKey(row);
  const starred = starredSet.value.has(key);
  try {
    if (starred) {
      await api(`/favorites?storageId=${storageId.value}&path=${encodeURIComponent(row.path)}`, { method: 'DELETE' });
      starredSet.value.delete(key);
      ElMessage.success('已取消收藏');
    } else {
      await api('/favorites', { method: 'POST', body: JSON.stringify({ storageId: storageId.value, path: row.path }) });
      starredSet.value.add(key);
      ElMessage.success('已收藏');
    }
  } catch (e: any) {
    if (starred) starredSet.value.add(key);
    else starredSet.value.delete(key);
    ElMessage.error(e.message || '操作失败');
  }
}

/* ---------- 快捷访问（固定文件） ---------- */
const quickAccessSet = ref<Set<string>>(new Set());
function qaKey(row: any) {
  return storageId.value + '||' + row.path;
}
function isQuickAccess(row: any) {
  return quickAccessSet.value.has(qaKey(row));
}
async function loadQuickAccess() {
  try {
    const r = await api(`/files/quick-access?storageId=${storageId.value}`);
    const set = new Set<string>();
    for (const e of r.entries) set.add(storageId.value + '||' + e.path);
    quickAccessSet.value = set;
  } catch { /* ignore */ }
}
async function toggleQuickAccess(row: any) {
  const key = qaKey(row);
  const added = quickAccessSet.value.has(key);
  try {
    const r = await api(`/files/quick-access/${encodeURIComponent(row.path)}?storageId=${storageId.value}`, { method: 'POST' });
    if (r.action === 'added') {
      quickAccessSet.value.add(key);
      ElMessage.success('已添加到快捷访问');
    } else {
      quickAccessSet.value.delete(key);
      ElMessage.success('已从快捷访问移除');
    }
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败');
  }
}

/** 更多菜单命令分发 */
function handleMoreCmd(cmd: string, row: any) {
  switch (cmd) {
    case 'star': toggleStar(row); break;
    case 'quick-access': toggleQuickAccess(row); break;
    case 'share': openShare(row); break;
    case 'rename': openRename(row); break;
    case 'props': openProps(row); break;
    case 'archive': openArchivePreview(row); break;
    case 'decompress': doDecompress(row); break;
    case 'move': openMove(row, 'move'); break;
    case 'copy': openMove(row, 'copy'); break;
  }
}

/* ---------- 新建文件夹 ---------- */
const mkdirDialog = ref(false);
const mkdirName = ref('');
async function doMkdir() {
  const name = mkdirName.value.trim();
  if (!name) return ElMessage.warning('请输入文件夹名称');
  const p = (path.value === '/' ? '' : path.value) + '/' + name;
  try {
    await api('/files/mkdir', { method: 'POST', body: JSON.stringify({ storageId: storageId.value, path: p }) });
    ElMessage.success('已创建');
    mkdirDialog.value = false;
    mkdirName.value = '';
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '创建失败');
  }
}

/* ---------- 重命名 ---------- */
const renameDialog = ref(false);
const renameTarget = ref<any>(null);
const renameValue = ref('');
function openRename(row: any) {
  renameTarget.value = row;
  renameValue.value = row.name;
  renameDialog.value = true;
}
async function doRename() {
  const name = renameValue.value.trim();
  if (!name) return ElMessage.warning('名称不能为空');
  const p = renameTarget.value.path;
  const dir = p.replace(/\/[^/]*$/, '') || '/';
  const newPath = (dir === '/' ? '' : dir) + '/' + name;
  try {
    await api('/files/rename', {
      method: 'POST',
      body: JSON.stringify({ storageId: storageId.value, path: p, newPath }),
    });
    ElMessage.success('重命名成功');
    renameDialog.value = false;
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '重命名失败');
  }
}

/* ---------- 移动 / 复制 ---------- */
const moveDialog = ref(false);
const moveTarget = ref<any>(null);
const moveMode = ref<'move' | 'copy'>('move');
const moveDest = ref('/');

/* 目录选择器状态 */
const dirPickerLoading = ref(false);
const dirPickerEntries = ref<any[]>([]);
const dirPickerCrumbs = computed(() => {
  const out = [{ name: '根目录', path: '/' }];
  if (moveDest.value !== '/') {
    const segs = moveDest.value.split('/').filter(Boolean);
    let acc = '';
    for (const s of segs) {
      acc += '/' + s;
      out.push({ name: s, path: acc });
    }
  }
  return out;
});
async function loadDirPicker(dirPath?: string) {
  const p = dirPath || moveDest.value;
  dirPickerLoading.value = true;
  try {
    const r = await api(`/files?storageId=${storageId.value}&path=${encodeURIComponent(p)}&sort=name&order=asc`);
    dirPickerEntries.value = r.entries.filter((e: any) => e.isDir);
  } catch (e: any) {
    ElMessage.error(e.message || '加载目录失败');
  } finally {
    dirPickerLoading.value = false;
  }
}
function dirPickerEnter(dirPath: string) {
  moveDest.value = dirPath;
  loadDirPicker(dirPath);
}
function dirPickerGoTo(idx: number) {
  const crumb = dirPickerCrumbs.value[idx];
  if (crumb) {
    moveDest.value = crumb.path;
    loadDirPicker(crumb.path);
  }
}
async function dirPickerNewFolder() {
  try {
    const { value } = await ElMessageBox.prompt('输入新文件夹名称', '新建文件夹', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
    });
    const name = (value || '').trim();
    if (!name) return;
    const parentPath = moveDest.value === '/' ? '' : moveDest.value;
    const newPath = parentPath + '/' + name;
    await api('/files/mkdir', { method: 'POST', body: JSON.stringify({ storageId: storageId.value, path: newPath }) });
    ElMessage.success('已创建');
    loadDirPicker();
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.message || '创建失败');
  }
}

function openMove(row: any, mode: 'move' | 'copy') {
  moveTarget.value = row;
  moveMode.value = mode;
  moveDest.value = parent.value || '/';
  moveDialog.value = true;
  loadDirPicker(moveDest.value);
}
async function doMove() {
  const dest = moveDest.value.trim() || '/';
  const destDir = dest.endsWith('/') ? dest : dest + '/';
  const destPath = (destDir === '/' ? '' : destDir) + moveTarget.value.name;
  try {
    await api(moveMode.value === 'move' ? '/files/move' : '/files/copy', {
      method: 'POST',
      body: JSON.stringify({ storageId: storageId.value, path: moveTarget.value.path, destPath }),
    });
    ElMessage.success(moveMode.value === 'move' ? '移动成功' : '复制成功');
    moveDialog.value = false;
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败');
  }
}

/* ---------- 删除 ---------- */
async function doDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.name}」吗？删除后可在回收站恢复。`, '删除确认', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api('/files/delete', { method: 'POST', body: JSON.stringify({ storageId: storageId.value, path: row.path }) });
    ElMessage.success('已删除到回收站');
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败');
  }
}

async function doBatchDelete() {
  if (!selected.value.length) return ElMessage.warning('请先选择文件');
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.length} 项吗？`, '批量删除', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api('/files/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ storageId: storageId.value, paths: selected.value.map((x: any) => x.path) }),
    });
    ElMessage.success('批量删除完成');
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '批量删除失败');
  }
}

/* ---------- 下载 ---------- */
/* 大文件不能 fetch+blob 整包缓冲（内存爆掉报 Failed to fetch），
   改为：签发一次性票据 → 锚点跳转，浏览器原生流式下载到磁盘（有进度条、可取消） */
async function download(row: any) {
  try {
    const r = await api('/files/download-ticket', { method: 'POST', body: JSON.stringify({ storageId: storageId.value, path: row.path }) });
    const a = document.createElement('a');
    a.href = `/api/v1/files/download?ticket=${r.ticket}`;
    a.click();
  } catch (e: any) {
    ElMessage.error(e.message || '下载失败');
  }
}

/* ---------- 图片 / 视频预览 ---------- */
const IMG_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'];
const VIDEO_EXTS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'wmv', 'm4v', 'ts', '3gp'];
const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'];
const previewDialog = ref(false);
const previewUrl = ref('');
const previewLoading = ref(false);
const previewName = ref('');
const previewPath = ref('');  // 完整文件路径（用于新窗口打开）
const previewSize = ref(0);
const previewKind = ref<'image' | 'video' | 'audio' | 'pdf' | 'code'>('image');
/* ---------- 图片增强功能（对标百度网盘/夸克/Google Drive） ---------- */
const imgScale = ref(1);          // 缩放比例 (0.1 ~ 5.0)
const imgRotation = ref(0);       // 旋转角度 (0/90/180/270)
const imgFit = ref<'original' | 'fit-width' | 'fit-height' | 'fullscreen'>('fit-width');
const isFullscreen = ref(false);
const imgInfo = ref<{ width: number; height: number; type: string } | null>(null);
const imgLoading = ref(false);

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];
const ZOOM_STEP_MULT = 1.25;      // 每次缩放倍数

function zoomIn() {
  if (imgScale.value < 5) imgScale.value = Math.min(5, imgScale.value * ZOOM_STEP_MULT);
}
function zoomOut() {
  if (imgScale.value > 0.1) imgScale.value = Math.max(0.1, imgScale.value / ZOOM_STEP_MULT);
}
function resetZoom() {
  imgScale.value = 1;
  imgRotation.value = 0;
  imgFit.value = 'fit-width';
}
function rotateLeft() {
  imgRotation.value = (imgRotation.value + 270) % 360;
}
function rotateRight() {
  imgRotation.value = (imgRotation.value + 90) % 360;
}
function setFit(mode: 'original' | 'fit-width' | 'fit-height' | 'fullscreen') {
  imgFit.value = mode;
  if (mode === 'fullscreen') {
    isFullscreen.value = true;
  } else {
    isFullscreen.value = false;
  }
  imgScale.value = 1;
}
function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value;
}

// 鼠标滚轮缩放
function onWheel(e: WheelEvent) {
  if (previewKind.value !== 'image') return;
  e.preventDefault();
  if (e.deltaY < 0) zoomIn();
  else zoomOut();
}

// 键盘快捷键
function onImageKey(e: KeyboardEvent) {
  if (previewKind.value !== 'image') return;
  switch (e.key) {
    case '+': case '=': zoomIn(); break;
    case '-': zoomOut(); break;
    case '0': resetZoom(); break;
    case 'r': case 'R': rotateRight(); break;
    case 'f': case 'F': toggleFullscreen(); break;
    case '1': setFit('original'); break;
    case '2': setFit('fit-width'); break;
    case '3': setFit('fit-height'); break;
    case '4': setFit('fullscreen'); break;
  }
}

// 加载图片信息
async function loadImgInfo(url: string) {
  imgLoading.value = true;
  imgInfo.value = null;
  try {
    const img = new Image();
    img.src = url;
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    imgInfo.value = {
      width: img.naturalWidth,
      height: img.naturalHeight,
      type: url.split('.').pop()?.toUpperCase() || 'UNKNOWN',
    };
  } catch {
    imgInfo.value = null;
  } finally {
    imgLoading.value = false;
  }
}

function extOf(name: string) {
  return name.split('.').pop()?.toLowerCase() || '';
}
function isImage(name: string) {
  return IMG_EXTS.includes(extOf(name));
}
function isVideo(name: string) {
  return VIDEO_EXTS.includes(extOf(name));
}
function isAudio(name: string) {
  return AUDIO_EXTS.includes(extOf(name));
}
const CODE_EXTS = ['js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'html', 'css', 'json', 'sh', 'vue', 'go', 'rs', 'xml', 'yml', 'yaml', 'md', 'txt', 'sql', 'ini', 'conf', 'env'];
function isCode(name: string) {
  return CODE_EXTS.includes(extOf(name));
}
function isPreviewable(name: string) {
  return isImage(name) || isVideo(name) || isAudio(name) || isPdf(name) || isCode(name);
}

const previewCode = ref('');

/* ---------- 压缩包预览 ---------- */
const archiveDialog = ref(false);
const archiveName = ref('');
const archiveEntries = ref<any[]>([]);
const archiveLoading = ref(false);
const ARCHIVE_EXTS = ['zip', 'tar', 'gz', 'tgz', 'bz2', '7z'];
function isArchive(name: string) {
  return ARCHIVE_EXTS.includes(extOf(name));
}
async function openArchivePreview(row: any) {
  archiveName.value = row.name;
  archiveDialog.value = true;
  archiveLoading.value = true;
  archiveEntries.value = [];
  try {
    const token = localStorage.getItem('nebula_token') || '';
    const res = await fetch(
      `/api/v1/files/${encodeURIComponent(row.path)}/archive-list?storageId=${storageId.value}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error('获取压缩包内容失败');
    const data = await res.json();
    archiveEntries.value = data.data.entries || [];
  } catch (e: any) {
    ElMessage.error(e.message || '获取压缩包内容失败');
  } finally {
    archiveLoading.value = false;
  }
}
async function openPreview(row: any) {
  if (row.isDir) return;
  const kind = isVideo(row.name) ? 'video' : isAudio(row.name) ? 'audio' : isPdf(row.name) ? 'pdf' : isImage(row.name) ? 'image' : isCode(row.name) ? 'code' : null;
  if (!kind) return download(row);
  
  previewName.value = row.name;
  previewPath.value = row.path;
  previewSize.value = row.size || 0;
  previewKind.value = kind;
  previewDialog.value = true;
  previewLoading.value = true;
  previewUrl.value = '';
  previewCode.value = '';
  imgScale.value = 1;
  imgRotation.value = 0;
  imgFit.value = 'fit-width';
  isFullscreen.value = false;
  imgInfo.value = null;
  
  try {
    const token = localStorage.getItem('nebula_token') || '';
    const base = `/api/v1/files/preview?storageId=${storageId.value}&path=${encodeURIComponent(row.path)}`;
    
    if (previewKind.value === 'image' || previewKind.value === 'pdf' || previewKind.value === 'code') {
      const res = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('预览加载失败');
      if (previewKind.value === 'code') {
        const text = await res.text();
        previewCode.value = text.length > 50000 ? text.slice(0, 50000) + '\n... (内容过长，仅显示前 50KB)' : text;
        previewUrl.value = 'code-loaded';
      } else {
        const blob = await res.blob();
        previewUrl.value = URL.createObjectURL(blob);
        if (previewKind.value === 'image') {
          loadImgInfo(previewUrl.value);
        }
      }
    } else {
      const res = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('预览加载失败');
      const blob = await res.blob();
      previewUrl.value = URL.createObjectURL(blob);
    }
  } catch (e: any) {
    ElMessage.error(e.message || '预览加载失败');
    previewDialog.value = false;
  } finally {
    previewLoading.value = false;
  }
}

function closePreview() {
  previewDialog.value = false;
  if (previewUrl.value && previewUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(previewUrl.value);
  }
  previewUrl.value = '';
  previewPath.value = '';
}

/** 在新窗口打开图片 */
async function openInNewTab() {
  if (previewKind.value !== 'image') return;
  const token = localStorage.getItem('nebula_token') || '';
  const filePath = previewPath.value || previewName.value;
  const base = `/api/v1/files/preview?storageId=${storageId.value}&path=${encodeURIComponent(filePath)}`;
  try {
    const res = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('打开失败');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(`<html><head><title>${encodeURIComponent(previewName.value)}</title><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#1a1a1a}img{max-width:100%;max-height:100vh;object-fit:contain;user-select:none}</style></head><body><img src="${url}" alt="${encodeURIComponent(previewName.value)}"/></body></html>`);
    }
  } catch (e: any) {
    ElMessage.error(e.message || '打开新窗口失败');
  }
}

/* ---------- 上传 ---------- */
const fileInput = ref<HTMLInputElement>();
const uploadDialog = ref(false);
const uploads = ref<{ name: string; percent: number; status: string }[]>([]);

function pickFiles() {
  fileInput.value?.click();
}

function onPick(e: Event) {
  const files = (e.target as HTMLInputElement).files;
  if (files && files.length) {
    uploadDialog.value = true;
    startUploads(Array.from(files));
  }
  (e.target as HTMLInputElement).value = '';
}

async function startUploads(files: File[]) {
  for (const f of files) {
    // 先 push 再取回，确保拿到的是响应式代理（直接改普通对象不会触发视图更新）
    uploads.value.push({ name: f.name, percent: 0, status: '上传中' });
    const u = uploads.value[uploads.value.length - 1];
    try {
      if (f.size <= 10 * 1024 * 1024) {
        await directUpload(f, u);
      } else {
        await chunkUpload(f, u);
      }
      u.status = '完成';
      u.percent = 100;
    } catch (err: any) {
      u.status = '失败: ' + (err.message || '未知错误');
    }
  }
  load();
  if (uploads.value.every((x) => x.status === '完成')) {
    setTimeout(() => { uploadDialog.value = false; }, 1200);
  }
}

/* ---------- 直接分享 ---------- */
const shareDialog = ref(false);
const shareTarget = ref<any>(null);
const shareForm = ref({ name: '', password: '', expireDays: 0, maxDownloads: 0 });
const shareResult = ref<{ url: string; token: string } | null>(null);
const shareBusy = ref(false);

function openShare(row: any) {
  shareTarget.value = row;
  shareForm.value = { name: row.name, password: '', expireDays: 0, maxDownloads: 0 };
  shareResult.value = null;
  shareDialog.value = true;
}

async function doShare() {
  if (!shareTarget.value) return;
  shareBusy.value = true;
  try {
    const body: any = {
      storageId: storageId.value,
      path: shareTarget.value.path,
      name: shareForm.value.name || undefined,
    };
    if (shareForm.value.password) body.password = shareForm.value.password;
    if (shareForm.value.expireDays > 0) {
      // 有效期 = 现在 + N 天；服务端按 SQLite datetime（UTC）比较
      const ms = Date.now() + shareForm.value.expireDays * 86400000;
      body.expiresAt = new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
    }
    if (shareForm.value.maxDownloads > 0) body.maxDownloads = shareForm.value.maxDownloads;
    const r = await api('/shares', { method: 'POST', body: JSON.stringify(body) });
    shareResult.value = { url: r.url, token: r.share?.token };
  } catch (e: any) {
    ElMessage.error(e.message || '创建分享失败');
  } finally {
    shareBusy.value = false;
  }
}

function copyShareUrl() {
  if (!shareResult.value) return;
  navigator.clipboard?.writeText(shareResult.value.url).then(
    () => ElMessage.success('分享链接已复制'),
    () => ElMessage.warning('请手动复制：' + shareResult.value.url)
  );
}

async function directUpload(f: File, u: any) {
  const fd = new FormData();
  fd.append('storageId', String(storageId.value));
  fd.append('path', path.value);
  fd.append('name', f.name);
  fd.append('file', f);
  await api('/upload/direct', { method: 'POST', body: fd });
  u.percent = 100;
}

async function chunkUpload(f: File, u: any) {
  const init = await api('/upload/init', {
    method: 'POST',
    body: JSON.stringify({ storageId: storageId.value, path: path.value, name: f.name, size: f.size }),
  });
  const { uploadId, chunkSize } = init;
  const total = Math.ceil(f.size / chunkSize);
  const token = localStorage.getItem('nebula_token') || '';
  for (let i = 0; i < total; i++) {
    const off = i * chunkSize;
    const chunk = f.slice(off, Math.min(off + chunkSize, f.size));
    const res = await fetch(`/api/v1/upload/chunk?uploadId=${uploadId}&chunkIndex=${i}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body: chunk,
    });
    if (!res.ok) throw new Error(`分片 ${i} 上传失败 (HTTP ${res.status})`);
    u.percent = Math.round(((i + 1) / total) * 100);
  }
  await api('/upload/complete', { method: 'POST', body: JSON.stringify({ uploadId }) });
  u.percent = 100;
}

/* ---------- 压缩（保存到服务器）---------- */
const compressing = ref(false);
async function doCompress() {
  if (!selected.value.length) return ElMessage.warning('请先选择文件或文件夹');
  compressing.value = true;
  try {
    const r = await api('/files/compress', {
      method: 'POST',
      body: JSON.stringify({
        storageId: storageId.value,
        paths: selected.value.map((x: any) => x.path),
        destPath: path.value,
      }),
    });
    ElMessage.success(`已压缩为 ${r.name}`);
    clearSelection();
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '压缩失败');
  } finally {
    compressing.value = false;
  }
}

/* ---------- 解压 zip ---------- */
const decompressing = ref(false);
async function doDecompress(row: any) {
  if (!row.name.toLowerCase().endsWith('.zip')) return;
  try {
    await ElMessageBox.confirm(`确定解压「${row.name}」吗？`, '解压确认', { type: 'info' });
  } catch { return; }
  decompressing.value = true;
  try {
    const destDir = row.path.replace(/\/[^/]*$/, '') || '/';
    await api('/files/decompress', {
      method: 'POST',
      body: JSON.stringify({
        storageId: storageId.value,
        path: row.path,
        destPath: destDir,
      }),
    });
    ElMessage.success('解压完成');
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '解压失败');
  } finally {
    decompressing.value = false;
  }
}

/* ---------- 批量下载（zip）---------- */
const batchDownloading = ref(false);
async function doBatchDownload() {
  if (!selected.value.length) return ElMessage.warning('请先选择文件或文件夹');
  batchDownloading.value = true;
  try {
    const token = localStorage.getItem('nebula_token') || '';
    const res = await fetch('/api/v1/files/batch-download', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ storageId: storageId.value, paths: selected.value.map((x: any) => x.path) }),
    });
    if (!res.ok) throw new Error('打包失败');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'batch-download.zip';
    a.click();
    URL.revokeObjectURL(a.href);
    ElMessage.success('批量下载完成');
  } catch (e: any) {
    ElMessage.error(e.message || '批量下载失败');
  } finally {
    batchDownloading.value = false;
  }
}

/* ---------- 文件属性面板 ---------- */
const propsDrawer = ref(false);
const propsMeta = ref<any>(null);
const propsLoading = ref(false);
const propsTarget = ref<any>(null);
async function openProps(row: any) {
  if (row.isDir) return;
  propsTarget.value = row;
  propsDrawer.value = true;
  propsLoading.value = true;
  propsMeta.value = null;
  try {
    const r = await api(`/files/${encodeURIComponent(row.path)}/meta?storageId=${storageId.value}`);
    propsMeta.value = r.meta;
  } catch (e: any) {
    ElMessage.error(e.message || '获取属性失败');
  } finally {
    propsLoading.value = false;
  }
}

/* ---------- 图片画廊（前后导航）---------- */
const galleryIndex = ref(0);
const galleryImages = ref<any[]>([]);
function openGallery(row: any) {
  // 收集当前目录所有图片
  galleryImages.value = entries.value.filter((e: any) => !e.isDir && isImage(e.name));
  galleryIndex.value = galleryImages.value.findIndex((e: any) => e.path === row.path);
  if (galleryIndex.value < 0) galleryIndex.value = 0;
  openPreview(row);
}
function galleryPrev() {
  if (galleryIndex.value > 0) {
    galleryIndex.value--;
    openPreview(galleryImages.value[galleryIndex.value]);
  }
}
function galleryNext() {
  if (galleryIndex.value < galleryImages.value.length - 1) {
    galleryIndex.value++;
    openPreview(galleryImages.value[galleryIndex.value]);
  }
}
function onGalleryKey(e: KeyboardEvent) {
  if (previewDialog.value && previewKind.value === 'image' && galleryImages.value.length > 1) {
    if (e.key === 'ArrowLeft') galleryPrev();
    if (e.key === 'ArrowRight') galleryNext();
  }
}
onMounted(() => {
  document.addEventListener('keydown', onGalleryKey);
});
onUnmounted(() => {
  document.removeEventListener('keydown', onGalleryKey);
});

/* ---------- PDF 预览 ---------- */
const PDF_EXTS = ['pdf'];
function isPdf(name: string) {
  return PDF_EXTS.includes(extOf(name));
}

/* ---------- 搜索 ---------- */
const searchDialog = ref(false);
const searchQ = ref('');
const searchResults = ref<any[]>([]);
const searching = ref(false);
const searchFilters = ref({ type: '', minSize: '', maxSize: '', since: '', until: '' });
async function doSearch() {
  const q = searchQ.value.trim();
  if (!q) return;
  searching.value = true;
  try {
    let url = `/search?q=${encodeURIComponent(q)}`;
    if (searchFilters.value.type) url += `&type=${encodeURIComponent(searchFilters.value.type)}`;
    if (searchFilters.value.minSize) url += `&minSize=${searchFilters.value.minSize}`;
    if (searchFilters.value.maxSize) url += `&maxSize=${searchFilters.value.maxSize}`;
    if (searchFilters.value.since) url += `&since=${encodeURIComponent(searchFilters.value.since)}`;
    if (searchFilters.value.until) url += `&until=${encodeURIComponent(searchFilters.value.until)}`;
    const r = await api(url);
    searchResults.value = r.results;
    // 记录搜索历史
    api('/search-history', { method: 'POST', body: JSON.stringify({ query: q }) }).catch(() => {});
  } catch (e: any) {
    ElMessage.error(e.message || '搜索失败');
  } finally {
    searching.value = false;
  }
}
function openSearchResult(r: any) {
  const e = r.entry;
  searchDialog.value = false;
  if (r.storageId !== storageId.value) {
    storageId.value = r.storageId;
  }
  path.value = e.isDir ? e.path : (e.path.replace(/\/[^/]*$/, '') || '/');
  load();
}

/* ---------- 照片视图 ---------- */
const PHOTO_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'];
const photoEntries = computed(() =>
  entries.value.filter((e) => {
    if (e.isDir) return false;
    const ext = e.name.split('.').pop()?.toLowerCase() || '';
    return PHOTO_EXTS.includes(ext);
  })
);
function photoUrl(row: any) {
  return `/api/v1/files/preview?storageId=${storageId.value}&path=${encodeURIComponent(row.path)}`;
}

const route = useRoute();
onMounted(async () => {
  // 立即加载文件（使用默认存储 ID），存储列表在后台加载
  // 深链：从收藏页等跳转携带 storage/path 参数时，定位到指定位置
  const qStorage = route.query.storage ? Number(route.query.storage) : null;
  const qPath = route.query.path ? String(route.query.path) : null;
  if (qStorage) storageId.value = qStorage;
  else if (!storageId.value) storageId.value = 1; // 默认存储
  if (qPath) path.value = qPath;
  // 文件列表立即加载
  load();
  // 存储列表和标签在后台加载，不阻塞文件显示
  loadStorages().then(() => {
    // 存储列表加载完成后，如果当前存储 ID 无效则切换到第一个
    if (!storages.value.some((s: any) => s.id === storageId.value)) {
      if (storages.value.length) {
        storageId.value = storages.value[0].id;
        load();
      }
    }
  });
  loadAllTags();
  loadFavorites();
  loadQuickAccess();
  // 异步加载真实配额用量（非 fast 模式，计算所有存储的 used 之和）
  api('/storages')
    .then((res: any) => {
      const list = res?.storages || [];
      usageTotal.value = list.reduce((s: number, st: any) => s + (st.used || 0), 0);
    })
    .catch(() => { /* 用量加载失败不阻塞，保持 0 */ });
});
</script>

<template>
  <div class="files-page" :class="{
    'files-dashboard': layoutType === 'dashboard',
    'files-bento': layoutType === 'bento',
    'files-command': layoutType === 'command',
    'files-topnav': layoutType === 'topnav'
  }">
    <!-- ⌘K 命令面板（仅 command 主题；Meta+K / Ctrl+K 打开，↑↓/Enter/Esc 键盘导航） -->
    <div v-if="layoutType === 'command' && cmdkOpen" class="cmdk-panel">
      <input
        ref="cmdkInputRef"
        v-model="cmdkQuery"
        class="cmdk-input"
        placeholder="搜索当前文件夹…"
        @keydown="onCmdkKeydown"
      />
      <div class="cmdk-list">
        <div
          v-for="(item, i) in cmdkResults"
          :key="item.path"
          class="cmdk-item"
          :class="{ active: i === cmdkActiveIndex }"
          @click="selectCmdk(i)"
          @mouseenter="cmdkActiveIndex = i"
        >
          <span class="cmdk-icon">{{ item.isDir ? '📁' : '📄' }}</span>
          <span class="cmdk-name">{{ item.name }}</span>
        </div>
        <div v-if="cmdkResults.length === 0" class="cmdk-empty">无匹配结果</div>
      </div>
    </div>
    <!-- 仪表盘统计卡片（4 张 + 趋势 chip + --i 入场 stagger） -->
    <div v-if="layoutType === 'dashboard'" class="stats-bar">
      <div
        v-for="(card, i) in statCards"
        :key="card.id"
        class="stat-card glass"
        :style="{ '--i': i }"
      >
        <div class="stat-icon" :class="card.iconClass">
          <el-icon><component :is="card.icon" /></el-icon>
        </div>
        <div class="stat-info">
          <div class="stat-value">{{ card.value }}</div>
          <div class="stat-label">{{ card.label }}</div>
        </div>
        <div class="stat-trend" :class="card.trend.dir">
          {{ card.trend.text }}
        </div>
      </div>
    </div>
    <!-- 紧凑统计条（全主题 1 行；dashboard 主题保留大 4 卡，数据源同一 statCards） -->
    <div v-if="layoutType !== 'dashboard'" class="stats-strip glass" aria-label="存储统计">
      <!-- 配额（usageTotal/quota） -->
      <div class="ss-item">
        <span class="ss-icon si-orange"><el-icon><Odometer /></el-icon></span>
        <span class="ss-label">配额</span>
        <span class="ss-track" aria-hidden="true">
          <span
            class="ss-fill"
            :class="{ warn: statCards[3].value !== '不限' && parseInt(statCards[3].value, 10) >= 80 }"
            :style="{ width: statCards[3].value === '不限' ? '0%' : statCards[3].value }"
          ></span>
        </span>
        <span class="ss-value">{{ statCards[3].value }}</span>
      </div>
      <span class="ss-sep" aria-hidden="true"></span>
      <!-- 总量（totalSize） -->
      <div class="ss-item">
        <span class="ss-icon si-blue"><el-icon><DataLine /></el-icon></span>
        <span class="ss-label">总量</span>
        <span class="ss-value">{{ statCards[0].value }}</span>
      </div>
      <span class="ss-sep" aria-hidden="true"></span>
      <!-- 文件数（fileCount） -->
      <div class="ss-item">
        <span class="ss-icon si-green"><el-icon><Document /></el-icon></span>
        <span class="ss-label">文件数</span>
        <span class="ss-value">{{ statCards[1].value }}</span>
      </div>
      <span class="ss-sep" aria-hidden="true"></span>
      <!-- 本周趋势（recent.length） -->
      <div class="ss-item">
        <span class="ss-icon si-purple"><el-icon><Upload /></el-icon></span>
        <span class="ss-label">本周</span>
        <span class="ss-value">{{ statCards[2].value }}</span>
        <span class="ss-chip" :class="statCards[2].trend.dir">{{ statCards[2].trend.text }}</span>
      </div>
    </div>
    <div class="files-glass glass">
      <!-- 两行工具栏（Google Drive 模式）：行 1 面包屑 / 行 2 控件 -->
      <div class="toolbar">
        <!-- 行 1：面包屑（全宽，深层路径溢出省略，保留末级可见） -->
        <div class="toolbar-row1">
          <el-breadcrumb separator="/" class="crumbs">
            <el-breadcrumb-item v-for="c in crumbs" :key="c.path + (c.isEllipsis ? '-e' : '')">
              <span v-if="c.isEllipsis" class="crumb-ellipsis" title="深层路径已折叠">…</span>
              <a v-else class="crumb" @click="goCrumb(c.path)">{{ c.name }}</a>
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <!-- 行 2：控件（左：存储 + 搜索；右：视图 / 排序 / 上传 / 新建，右对齐） -->
        <div class="toolbar-row2">
          <el-select v-model="storageId" size="default" class="storage-select" @change="onStorageChange">
            <el-option v-for="s in storages" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
          <!-- 全局搜索（常驻搜索框，回车或点击图标触发） -->
          <div class="toolbar-search glass">
            <el-icon class="toolbar-search-icon"><Search /></el-icon>
            <input
              v-model="searchQ"
              class="toolbar-search-input"
              placeholder="搜索文件…"
              @keyup.enter="runSearchFromBox"
            />
            <button class="toolbar-search-btn" title="搜索" @click="runSearchFromBox">
              <el-icon><Search /></el-icon>
            </button>
          </div>
          <div class="toolbar-actions">
            <!-- 视图切换：网格 / 列表 / 照片 -->
            <div class="view-toggle glass-btn">
              <button class="vt-btn" :class="{ active: view === 'grid' }" title="网格视图" @click="view = 'grid'">
                <el-icon><Grid /></el-icon>
              </button>
              <button class="vt-btn" :class="{ active: view === 'list' }" title="列表视图" @click="view = 'list'">
                <el-icon><List /></el-icon>
              </button>
              <button class="vt-btn" :class="{ active: view === 'photo' }" title="照片视图" @click="view = 'photo'">
                <el-icon><PictureFilled /></el-icon>
              </button>
            </div>
            <!-- 排序 -->
            <el-select v-model="sortKey" class="sort-select" @change="load">
              <el-option value="name" label="名称" />
              <el-option value="size" label="大小" />
              <el-option value="mtime" label="时间" />
            </el-select>
            <el-button size="small" @click="mkdirDialog = true; mkdirName = ''"><el-icon><FolderAdd /></el-icon>&nbsp;新建文件夹</el-button>
            <el-button size="small" type="primary" @click="pickFiles"><el-icon><Upload /></el-icon>&nbsp;上传文件</el-button>
            <!-- 更多：低频操作收纳（标签 / 刷新 / 多选） -->
            <el-dropdown trigger="click" @command="handleToolbarMore">
              <el-button size="small" :type="multiSelectMode ? 'warning' : 'default'">
                <el-icon><MoreFilled /></el-icon>&nbsp;更多
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="tag-filter"><el-icon><PriceTag /></el-icon> 标签筛选</el-dropdown-item>
                  <el-dropdown-item command="refresh"><el-icon><Refresh /></el-icon> 刷新</el-dropdown-item>
                  <el-dropdown-item command="multi-select"><el-icon><Check /></el-icon> {{ multiSelectMode ? '退出多选' : '多选模式' }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <!-- 多选模式批量操作 -->
            <el-button v-if="multiSelectMode" size="small" type="danger" :disabled="!selected.length" @click="doBatchDelete">
              <el-icon><Delete /></el-icon>&nbsp;删除选中
            </el-button>
            <el-button v-if="multiSelectMode" size="small" type="success" :disabled="!selected.length" :loading="batchDownloading" @click="doBatchDownload">
              <el-icon><Download /></el-icon>&nbsp;批量下载
            </el-button>
            <el-button v-if="multiSelectMode" size="small" type="warning" :disabled="!selected.length" :loading="compressing" @click="doCompress">
              <el-icon><Box /></el-icon>&nbsp;压缩
            </el-button>
          </div>
          <!-- 平板（768–1199px，F0）：行2 仅留 [搜索][⋯] —— 存储/视图/排序/上传/新建 收进 ⋯ ElPopover -->
          <div class="toolbar-tablet-actions">
            <el-popover ref="tabletMoreRef" placement="bottom-end" width="220" trigger="click">
              <template #reference>
                <button class="tablet-more-btn glass-btn" aria-label="更多操作" aria-haspopup="true">
                  <el-icon><MoreFilled /></el-icon>
                </button>
              </template>
              <div class="mobile-more-menu">
                <!-- 存储切换 -->
                <div class="mm-item mm-sort">
                  <span class="mm-sort-label">存储</span>
                  <el-select v-model="storageId" size="small" @change="onStorageChange">
                    <el-option v-for="s in storages" :key="s.id" :value="s.id" :label="s.name" />
                  </el-select>
                </div>
                <!-- 视图切换 -->
                <div class="mm-item mm-view">
                  <button class="vt-btn" :class="{ active: view === 'grid' }" title="网格视图" @click="tabletMoreRef?.hide(); view = 'grid'"><el-icon><Grid /></el-icon></button>
                  <button class="vt-btn" :class="{ active: view === 'list' }" title="列表视图" @click="tabletMoreRef?.hide(); view = 'list'"><el-icon><List /></el-icon></button>
                  <button class="vt-btn" :class="{ active: view === 'photo' }" title="照片视图" @click="tabletMoreRef?.hide(); view = 'photo'"><el-icon><PictureFilled /></el-icon></button>
                </div>
                <!-- 排序 -->
                <div class="mm-item mm-sort">
                  <span class="mm-sort-label">排序</span>
                  <el-select v-model="sortKey" size="small" @change="load">
                    <el-option value="name" label="名称" />
                    <el-option value="size" label="大小" />
                    <el-option value="mtime" label="时间" />
                  </el-select>
                </div>
                <div class="mm-sep"></div>
                <button class="mm-item" @click="tabletMoreRef?.hide(); pickFiles()">
                  <el-icon><Upload /></el-icon><span>上传</span>
                </button>
                <button class="mm-item" @click="tabletMoreRef?.hide(); mkdirDialog = true; mkdirName = ''">
                  <el-icon><FolderAdd /></el-icon><span>新建文件夹</span>
                </button>
                <button class="mm-item" @click="tabletMoreRef?.hide(); handleToolbarMore('multi-select')">
                  <el-icon><Check /></el-icon><span>{{ multiSelectMode ? '退出多选' : '多选模式' }}</span>
                </button>
                <button class="mm-item" @click="tabletMoreRef?.hide(); handleToolbarMore('tag-filter')">
                  <el-icon><PriceTag /></el-icon><span>标签筛选</span>
                </button>
                <button class="mm-item" @click="tabletMoreRef?.hide(); handleToolbarMore('refresh')">
                  <el-icon><Refresh /></el-icon><span>刷新</span>
                </button>
                <template v-if="multiSelectMode">
                  <div class="mm-sep"></div>
                  <button class="mm-item" :disabled="!selected.length || batchDownloading" @click="tabletMoreRef?.hide(); doBatchDelete()">
                    <el-icon><Delete /></el-icon><span>删除选中</span>
                  </button>
                  <button class="mm-item" :disabled="!selected.length || batchDownloading" @click="tabletMoreRef?.hide(); doBatchDownload()">
                    <el-icon><Download /></el-icon><span>批量下载</span>
                  </button>
                  <button class="mm-item" :disabled="!selected.length || compressing" @click="tabletMoreRef?.hide(); doCompress()">
                    <el-icon><Box /></el-icon><span>压缩</span>
                  </button>
                </template>
              </div>
            </el-popover>
          </div>
          <!-- 移动端（<768px，P8）：仅留 [搜索][⋯] —— 搜索为全屏覆盖层，操作收进 ⋯ ElPopover -->
          <div class="toolbar-mobile-actions">
            <button class="mobile-search-btn glass-btn" @click="mobileSearchOpen = true">
              <el-icon><Search /></el-icon><span>搜索</span>
            </button>
            <el-popover ref="mobileMoreRef" placement="bottom-end" width="200" trigger="click">
              <template #reference>
                <button class="mobile-more-btn glass-btn" aria-label="更多操作" aria-haspopup="true">
                  <el-icon><MoreFilled /></el-icon>
                </button>
              </template>
              <div class="mobile-more-menu">
                <button class="mm-item" @click="mobileMoreRef?.hide(); pickFiles()">
                  <el-icon><Upload /></el-icon><span>上传</span>
                </button>
                <button class="mm-item" @click="mobileMoreRef?.hide(); mkdirDialog = true; mkdirName = ''">
                  <el-icon><FolderAdd /></el-icon><span>新建文件夹</span>
                </button>
                <button class="mm-item" @click="mobileMoreRef?.hide(); handleToolbarMore('multi-select')">
                  <el-icon><Check /></el-icon><span>{{ multiSelectMode ? '退出多选' : '多选模式' }}</span>
                </button>
                <div class="mm-item mm-sort">
                  <span class="mm-sort-label">排序</span>
                  <el-select v-model="sortKey" size="small" @change="load">
                    <el-option value="name" label="名称" />
                    <el-option value="size" label="大小" />
                    <el-option value="mtime" label="时间" />
                  </el-select>
                </div>
                <template v-if="multiSelectMode">
                  <div class="mm-sep"></div>
                  <button class="mm-item" :disabled="!selected.length || batchDownloading" @click="mobileMoreRef?.hide(); doBatchDelete()">
                    <el-icon><Delete /></el-icon><span>删除选中</span>
                  </button>
                  <button class="mm-item" :disabled="!selected.length || batchDownloading" @click="mobileMoreRef?.hide(); doBatchDownload()">
                    <el-icon><Download /></el-icon><span>批量下载</span>
                  </button>
                  <button class="mm-item" :disabled="!selected.length || compressing" @click="mobileMoreRef?.hide(); doCompress()">
                    <el-icon><Box /></el-icon><span>压缩</span>
                  </button>
                </template>
              </div>
            </el-popover>
          </div>
        </div>
      </div>

      <!-- 移动端（<768px，P8）：全屏搜索覆盖层（顶栏 + 输入 + 结果列表）；复用 searchQ/doSearch -->
      <div v-if="mobileSearchOpen" class="mobile-search-overlay">
        <div class="ms-topbar">
          <button class="ms-close" aria-label="关闭搜索" @click="mobileSearchOpen = false">
            <el-icon><Close /></el-icon>
          </button>
          <div class="ms-input-wrap">
            <el-icon class="ms-icon"><Search /></el-icon>
            <input
              v-model="searchQ"
              class="ms-input"
              placeholder="搜索文件…"
              @keyup.enter="doSearch"
            />
          </div>
          <button class="ms-go" :disabled="searching" @click="doSearch">
            {{ searching ? '搜索中…' : '搜索' }}
          </button>
        </div>
        <div class="ms-results" v-loading="searching">
          <div v-if="!searching && searchResults.length === 0" class="ms-empty">无结果</div>
          <div
            v-for="r in searchResults"
            :key="r.entry.path"
            class="ms-item"
            @click="openSearchResult(r); mobileSearchOpen = false"
          >
            <el-icon class="ms-f-icon"><Folder v-if="r.entry.isDir" /><Document v-else /></el-icon>
            <div class="ms-f-info">
              <div class="ms-f-name">{{ r.entry.name }}</div>
              <div class="ms-f-path">{{ r.entry.path }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 选中信息栏（仅多选模式） -->
      <div v-if="multiSelectMode && selected.length" class="selection-bar">
        <span>已选择 <b>{{ selected.length }}</b> 项</span>
        <el-button link size="small" @click="clearSelection">取消选择</el-button>
      </div>

      <!-- 网格视图（毛玻璃卡片 + 悬浮微动画） -->
      <div v-if="view === 'grid'" class="file-grid">
        <!-- 骨架屏：首次加载时显示 -->
        <template v-if="!hasLoaded">
          <div v-for="i in 8" :key="'sk-' + i" class="file-card glass-card skeleton-card">
            <div class="skeleton-icon"></div>
            <div class="skeleton-name"></div>
            <div class="skeleton-meta"></div>
          </div>
        </template>
        <!-- 真实文件：带淡入动画 -->
        <template v-else>
        <div
          v-for="(row, i) in entries"
          :key="row.path"
          class="file-card glass-card file-fade-in"
          :class="[
            { selected: isSelected(row) },
            layoutType === 'bento' ? bentoCardClass(i) : ''
          ]"
          @click="onCardClick(row)"
          @contextmenu="showContextMenu($event, row)"
        >
          <!-- 选择框：仅多选模式显示 -->
          <div v-if="multiSelectMode" class="fc-checkbox" @click.stop>
            <el-checkbox
              :model-value="isSelected(row)"
              @change="toggleSelect(row)"
            />
          </div>
          <div class="fc-icon">
            <el-icon :size="42" :color="fileType(row.name, row.isDir).color">
              <component :is="fileType(row.name, row.isDir).icon" />
            </el-icon>
          </div>
          <div class="fc-name" :title="row.name">{{ row.name }}</div>
          <div class="fc-meta">{{ row.isDir ? '文件夹' : fmtSize(row.size) }}</div>
          <div class="fc-actions" @click.stop>
            <!-- 统一按钮顺序：核心操作 → 删除 → 三个点菜单 -->
            <!-- 文件夹：分享 → 重命名 → 删除 → 三个点 -->
            <template v-if="row.isDir">
              <el-tooltip content="分享" placement="top">
                <el-button link @click="openShare(row)"><el-icon><Share /></el-icon></el-button>
              </el-tooltip>
              <el-tooltip content="重命名" placement="top">
                <el-button link @click="openRename(row)"><el-icon><EditPen /></el-icon></el-button>
              </el-tooltip>
              <el-tooltip content="删除" placement="top">
                <el-button link type="danger" @click="doDelete(row)"><el-icon><Delete /></el-icon></el-button>
              </el-tooltip>
              <el-dropdown trigger="click" @command="(cmd: string) => handleMoreCmd(cmd, row)">
                <el-button link class="more-btn"><el-icon><MoreFilled /></el-icon></el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="star">
                      <el-icon><StarFilled v-if="isStarred(row)" /><Star v-else /></el-icon>
                      {{ isStarred(row) ? '取消收藏' : '收藏' }}
                    </el-dropdown-item>
                    <el-dropdown-item command="quick-access">
                      <el-icon><StarFilled v-if="isQuickAccess(row)" /><Star v-else /></el-icon>
                      {{ isQuickAccess(row) ? '从快捷访问移除' : '添加到快捷访问' }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
            <!-- 文件：预览 → 下载 → 删除 → 三个点 -->
            <template v-else>
              <el-tooltip v-if="isPreviewable(row.name)" content="预览" placement="top">
                <el-button link @click="openPreview(row)"><el-icon><View /></el-icon></el-button>
              </el-tooltip>
              <el-tooltip content="下载" placement="top">
                <el-button link @click="download(row)"><el-icon><Download /></el-icon></el-button>
              </el-tooltip>
              <el-tooltip content="删除" placement="top">
                <el-button link type="danger" @click="doDelete(row)"><el-icon><Delete /></el-icon></el-button>
              </el-tooltip>
              <el-dropdown trigger="click" @command="(cmd: string) => handleMoreCmd(cmd, row)">
                <el-button link class="more-btn"><el-icon><MoreFilled /></el-icon></el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="star">
                      <el-icon><StarFilled v-if="isStarred(row)" /><Star v-else /></el-icon>
                      {{ isStarred(row) ? '取消收藏' : '收藏' }}
                    </el-dropdown-item>
                    <el-dropdown-item command="quick-access">
                      <el-icon><StarFilled v-if="isQuickAccess(row)" /><Star v-else /></el-icon>
                      {{ isQuickAccess(row) ? '从快捷访问移除' : '添加到快捷访问' }}
                    </el-dropdown-item>
                    <el-dropdown-item command="share"><el-icon><Share /></el-icon>分享</el-dropdown-item>
                    <el-dropdown-item command="rename"><el-icon><EditPen /></el-icon>重命名</el-dropdown-item>
                    <el-dropdown-item command="props"><el-icon><InfoFilled /></el-icon>属性</el-dropdown-item>
                    <el-dropdown-item v-if="isArchive(row.name)" command="archive"><el-icon><Files /></el-icon>压缩包内容</el-dropdown-item>
                    <el-dropdown-item v-if="row.name.toLowerCase().endsWith('.zip')" command="decompress"><el-icon><Box /></el-icon>解压</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
          </div>
        </div>
        </template>
        <div v-if="hasLoaded && !loading && !entries.length" class="empty">此文件夹为空</div>
      </div>

      <!-- 列表视图 -->
      <el-table
        v-if="view === 'list'"
        ref="tableRef"
        v-loading="loading"
        class="file-table"
        :data="entries"
        row-key="path"
        @selection-change="(v: any[]) => (selected = v)"
        @row-contextmenu="(row: any, col: any, event: MouseEvent) => showContextMenu(event, row.row)"
        @sort-change="onSortChange"
      >
        <el-table-column v-if="multiSelectMode" type="selection" width="40" />
        <el-table-column prop="name" label="名称" min-width="300" sortable>
          <template #default="{ row }">
            <el-icon class="f-icon" :color="fileType(row.name, row.isDir).color">
              <component :is="fileType(row.name, row.isDir).icon" />
            </el-icon>
            <span class="f-name" :class="{ dir: row.isDir }" @click.stop="openDir(row)">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="size" label="大小" width="120" sortable>
          <template #default="{ row }">{{ row.isDir ? '-' : fmtSize(row.size) }}</template>
        </el-table-column>
        <el-table-column prop="mtime" label="修改时间" width="180" sortable>
          <template #default="{ row }">{{ fmtTime(row.mtime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="330">
          <template #default="{ row }">
            <div class="row-actions-wrap">
              <el-button link size="small" @click.stop="toggleStar(row)">
                <el-icon><StarFilled v-if="isStarred(row)" /><Star v-else /></el-icon>&nbsp;{{ isStarred(row) ? '已收藏' : '收藏' }}
              </el-button>
              <!-- 文件夹：保持原有操作 -->
              <template v-if="row.isDir">
                <el-button link type="primary" size="small" @click.stop="openShare(row)">分享</el-button>
                <el-button link type="primary" size="small" @click.stop="openRename(row)">重命名</el-button>
                <el-button link type="primary" size="small" @click.stop="openMove(row, 'move')">移动</el-button>
                <el-button link type="primary" size="small" @click.stop="openMove(row, 'copy')">复制</el-button>
                <el-button link type="danger" size="small" @click.stop="doDelete(row)">删除</el-button>
                <el-dropdown trigger="click" @command="(cmd: string) => handleMoreCmd(cmd, row)">
                  <el-button link size="small" class="more-btn"><el-icon><MoreFilled /></el-icon></el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="star">
                        <el-icon><StarFilled v-if="isStarred(row)" /><Star v-else /></el-icon>
                        {{ isStarred(row) ? '取消收藏' : '收藏' }}
                      </el-dropdown-item>
                      <el-dropdown-item command="quick-access">
                        <el-icon><StarFilled v-if="isQuickAccess(row)" /><Star v-else /></el-icon>
                        {{ isQuickAccess(row) ? '从快捷访问移除' : '添加到快捷访问' }}
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </template>
              <!-- 文件：核心操作 + 更多菜单 -->
              <div v-else class="row-actions">
                <el-button v-if="isPreviewable(row.name)" link type="primary" size="small" @click.stop="openPreview(row)">预览</el-button>
                <el-button link type="primary" size="small" @click.stop="download(row)">下载</el-button>
                <el-button v-if="row.name.toLowerCase().endsWith('.zip')" link type="warning" size="small" @click.stop="doDecompress(row)">解压</el-button>
                <el-button link type="danger" size="small" @click.stop="doDelete(row)">删除</el-button>
                <el-dropdown trigger="click" @command="(cmd: string) => handleMoreCmd(cmd, row)">
                  <el-button link size="small" class="more-btn"><el-icon><MoreFilled /></el-icon></el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="share">分享</el-dropdown-item>
                      <el-dropdown-item command="rename">重命名</el-dropdown-item>
                      <el-dropdown-item command="move">移动</el-dropdown-item>
                      <el-dropdown-item command="copy">复制</el-dropdown-item>
                      <el-dropdown-item command="props">属性</el-dropdown-item>
                      <el-dropdown-item command="quick-access">
                        <el-icon><StarFilled v-if="isQuickAccess(row)" /><Star v-else /></el-icon>
                        {{ isQuickAccess(row) ? '从快捷访问移除' : '添加到快捷访问' }}
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <!-- 照片视图（纯图片画廊） -->
      <div v-if="view === 'photo'" v-loading="loading" class="photo-grid">
        <div
          v-for="row in photoEntries"
          :key="row.path"
          class="photo-card"
          @click="openPreview(row)"
        >
          <img :src="photoUrl(row)" :alt="row.name" loading="lazy" />
          <div class="photo-overlay">{{ row.name }}</div>
        </div>
        <div v-if="hasLoaded && !loading && !photoEntries.length" class="empty">此文件夹没有图片文件</div>
      </div>
    </div>

    <!-- 新建文件夹 -->
    <!-- 共享给用户对话框 -->
    <el-dialog v-model="collabShareDialog" title="共享给用户" width="560px">
      <el-form label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="collabShareForm.name" placeholder="共享名称" />
        </el-form-item>
        <el-form-item label="用户名">
          <el-input
            v-model="collabShareForm.usernames"
            placeholder="输入用户名，多个用户用逗号分隔"
          />
          <p class="collab-hint">输入要共享的用户名，例如：zhangsan, lisi</p>
        </el-form-item>
        <el-form-item label="权限">
          <el-radio-group v-model="collabShareForm.permission">
            <el-radio value="view">仅查看</el-radio>
            <el-radio value="download">可查看+下载</el-radio>
            <el-radio value="manage">可管理</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="有效期">
          <el-date-picker
            v-model="collabShareForm.expiresAt"
            type="date"
            placeholder="永久有效"
            style="width: 100%"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="collabShareDialog = false">取消</el-button>
        <el-button type="primary" :loading="collabShareLoading" @click="doCollabShare">确认共享</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="mkdirDialog" title="新建文件夹" width="420px">
      <el-input v-model="mkdirName" placeholder="文件夹名称" @keyup.enter="doMkdir" />
      <template #footer>
        <el-button @click="mkdirDialog = false">取消</el-button>
        <el-button type="primary" @click="doMkdir">创建</el-button>
      </template>
    </el-dialog>

    <!-- 重命名 -->
    <el-dialog v-model="renameDialog" title="重命名" width="420px">
      <el-input v-model="renameValue" @keyup.enter="doRename" />
      <template #footer>
        <el-button @click="renameDialog = false">取消</el-button>
        <el-button type="primary" @click="doRename">确定</el-button>
      </template>
    </el-dialog>

    <!-- 移动 / 复制：目录选择器 -->
    <el-dialog v-model="moveDialog" :title="moveMode === 'move' ? '移动到' : '复制到'" width="520px">
      <div class="dir-picker">
        <!-- 面包屑 -->
        <div class="dir-picker-breadcrumb">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item
              v-for="(crumb, idx) in dirPickerCrumbs"
              :key="crumb.path"
              :href="''"
              @click.native="dirPickerGoTo(idx)"
            >
              {{ crumb.name }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <!-- 文件夹列表 -->
        <div class="dir-picker-list" v-loading="dirPickerLoading">
          <div
            v-for="d in dirPickerEntries"
            :key="d.path"
            class="dir-picker-item"
            @click="dirPickerEnter(d.path)"
          >
            <el-icon class="dir-icon"><Folder /></el-icon>
            <span class="dir-name">{{ d.name }}</span>
            <span class="dir-hint">进入</span>
          </div>
          <div v-if="!dirPickerLoading && !dirPickerEntries.length" class="dir-picker-empty">
            此目录没有子文件夹
          </div>
        </div>
        <!-- 当前目录信息 + 操作 -->
        <div class="dir-picker-footer">
          <div class="dir-picker-current">
            <span>当前目录：</span>
            <code>{{ moveDest }}</code>
          </div>
          <div class="dir-picker-actions">
            <el-button size="small" @click="dirPickerNewFolder">
              <el-icon><FolderAdd /></el-icon> 新建文件夹
            </el-button>
            <el-button size="small" type="primary" @click="doMove">
              选择此目录
            </el-button>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="moveDialog = false">取消</el-button>
      </template>
    </el-dialog>

    <!-- 直接分享 -->
    <el-dialog v-model="shareDialog" title="分享" width="520px">
      <div v-if="!shareResult">
        <div class="form-tip">
          分享对象：<b>{{ shareTarget?.path }}</b>（{{ shareTarget?.isDir ? '文件夹' : '文件' }}）
        </div>
        <el-form label-width="90px" style="margin-top: 12px">
          <el-form-item label="分享名称">
            <el-input v-model="shareForm.name" placeholder="默认使用文件/文件夹名称" />
          </el-form-item>
          <el-form-item label="提取码">
            <el-input v-model="shareForm.password" placeholder="可选，访问者需输入提取码" />
          </el-form-item>
          <el-form-item label="有效期">
            <el-radio-group v-model="shareForm.expireDays">
              <el-radio-button :label="0">永久</el-radio-button>
              <el-radio-button :label="1">1 天</el-radio-button>
              <el-radio-button :label="7">1 周</el-radio-button>
              <el-radio-button :label="30">1 个月</el-radio-button>
              <el-radio-button :label="90">3 个月</el-radio-button>
              <el-radio-button :label="180">6 个月</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="下载次数">
            <el-input v-model.number="shareForm.maxDownloads" type="number" placeholder="0 表示不限" />
          </el-form-item>
        </el-form>
      </div>
      <div v-else>
        <div class="form-tip">分享已创建！把下面的链接发给别人即可访问：</div>
        <el-input :model-value="shareResult.url" readonly style="margin-top: 12px" />
      </div>
      <template #footer>
        <template v-if="!shareResult">
          <el-button @click="shareDialog = false">取消</el-button>
          <el-button type="primary" :loading="shareBusy" @click="doShare">创建分享</el-button>
        </template>
        <template v-else>
          <el-button @click="shareResult = null">再创建一个</el-button>
          <el-button type="primary" @click="copyShareUrl">复制链接</el-button>
        </template>
      </template>
    </el-dialog>

    <!-- 搜索 -->
    <el-dialog v-model="searchDialog" title="全局搜索" width="640px">
      <div class="search-bar">
        <el-input v-model="searchQ" placeholder="输入文件名关键字" @keyup.enter="doSearch" />
        <el-button type="primary" :loading="searching" @click="doSearch">搜索</el-button>
      </div>
      <!-- 高级过滤 -->
      <div class="search-filters">
        <el-input v-model="searchFilters.type" placeholder="扩展名 (如 pdf, jpg)" size="small" style="width: 160px" />
        <el-input v-model="searchFilters.minSize" placeholder="最小大小(B)" size="small" style="width: 120px" />
        <el-input v-model="searchFilters.maxSize" placeholder="最大大小(B)" size="small" style="width: 120px" />
        <el-date-picker v-model="searchFilters.since" type="date" placeholder="起始日期" size="small" style="width: 140px" />
        <el-date-picker v-model="searchFilters.until" type="date" placeholder="截止日期" size="small" style="width: 140px" />
      </div>
      <el-table :data="searchResults" max-height="360" class="search-table">
        <el-table-column label="名称" min-width="200">
          <template #default="{ row }">
            <el-icon class="f-icon" :color="row.entry.isDir ? '#409eff' : '#909399'">
              <Folder v-if="row.entry.isDir" />
              <Document v-else />
            </el-icon>
            <span class="f-name">{{ row.entry.name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="存储" width="140" prop="storageName" />
        <el-table-column label="路径" min-width="220" prop="entry.path" show-overflow-tooltip />
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openSearchResult(row)">打开</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- 上传进度 -->
    <el-dialog v-model="uploadDialog" title="上传进度" width="480px">
      <div v-for="u in uploads" :key="u.name" class="upload-item">
        <div class="upload-name">{{ u.name }}</div>
        <el-progress :percentage="u.percent" :status="u.status === '完成' ? 'success' : u.status === '上传中' ? undefined : 'exception'" :stroke-width="10" />
        <div class="upload-status">{{ u.status }}</div>
      </div>
    </el-dialog>

    <!-- 文件属性抽屉 -->
    <el-drawer v-model="propsDrawer" title="文件属性" size="360px" direction="rtl">
      <div v-loading="propsLoading" class="props-wrap">
        <div v-if="propsMeta" class="props-list">
          <div class="props-row"><span class="props-label">名称</span><span class="props-value">{{ propsMeta.name }}</span></div>
          <div class="props-row"><span class="props-label">路径</span><span class="props-value">{{ propsMeta.path }}</span></div>
          <div class="props-row"><span class="props-label">大小</span><span class="props-value">{{ fmtSize(propsMeta.size) }}</span></div>
          <div class="props-row"><span class="props-label">扩展名</span><span class="props-value">{{ propsMeta.ext || '-' }}</span></div>
          <div class="props-row"><span class="props-label">修改时间</span><span class="props-value">{{ fmtTime(propsMeta.mtime) }}</span></div>
          <div class="props-row"><span class="props-label">创建时间</span><span class="props-value">{{ fmtTime(propsMeta.created) }}</span></div>
          <div v-if="propsMeta.width" class="props-row"><span class="props-label">尺寸</span><span class="props-value">{{ propsMeta.width }} × {{ propsMeta.height }}</span></div>
        </div>
        <div v-else-if="!propsLoading" class="empty">无数据</div>
      </div>
    </el-drawer>

    <!-- 图片 / 视频 / 音频 / PDF / 代码 预览（增强版） -->
    <el-dialog
      v-model="previewDialog"
      :title="previewName"
      :width="previewKind === 'image' ? (isFullscreen ? '100%' : '90%') : '880px'"
      :top="isFullscreen ? '0' : '3vh'"
      :fullscreen="isFullscreen"
      class="preview-dialog"
      @close="closePreview"
    >
      <div class="preview-wrap" v-loading="previewLoading">
        <!-- 图片预览（增强版：缩放/旋转/适应/全屏/信息） -->
        <template v-if="previewKind === 'image' && previewUrl">
          <div class="image-preview-container" @wheel.prevent="onWheel">
            <img
              :src="previewUrl"
              class="preview-img-enhanced"
              :style="{
                transform: `scale(${imgScale}) rotate(${imgRotation}deg)`,
                objectFit: imgFit === 'original' ? 'none' : imgFit === 'fit-width' ? 'contain' : imgFit === 'fit-height' ? 'cover' : 'contain',
              }"
              :alt="previewName"
            />
          </div>
          <!-- 画廊导航 -->
          <div class="gallery-controls" v-if="galleryImages.length > 1">
            <button class="gallery-nav gallery-prev" @click="galleryPrev">
              <el-icon><ArrowLeft /></el-icon>
            </button>
            <span class="gallery-counter">{{ galleryIndex + 1 }} / {{ galleryImages.length }}</span>
            <button class="gallery-nav gallery-next" @click="galleryNext">
              <el-icon><ArrowRight /></el-icon>
            </button>
          </div>
          <!-- 图片工具栏 -->
          <div class="image-toolbar">
            <div class="toolbar-section">
              <el-button-group size="small">
                <el-button @click="zoomOut" title="缩小 (−)">
                  <el-icon><ZoomOut /></el-icon>
                </el-button>
                <el-button @click="resetZoom" title="重置 (0)">
                  <el-icon><Refresh /></el-icon>
                </el-button>
                <el-button @click="zoomIn" title="放大 (+)">
                  <el-icon><ZoomIn /></el-icon>
                </el-button>
              </el-button-group>
              <span class="zoom-label">{{ Math.round(imgScale * 100) }}%</span>
            </div>
            <div class="toolbar-section">
              <el-button-group size="small">
                <el-button @click="rotateLeft" title="左转">
                  <el-icon><RefreshLeft /></el-icon>
                </el-button>
                <el-button @click="rotateRight" title="右转">
                  <el-icon><RefreshRight /></el-icon>
                </el-button>
              </el-button-group>
            </div>
            <div class="toolbar-section">
              <el-radio-group v-model="imgFit" size="small">
                <el-radio-button value="original">原始</el-radio-button>
                <el-radio-button value="fit-width">适应宽</el-radio-button>
                <el-radio-button value="fit-height">适应高</el-radio-button>
                <el-radio-button value="fullscreen">全屏</el-radio-button>
              </el-radio-group>
            </div>
            <div class="toolbar-section">
              <el-button size="small" @click="toggleFullscreen" :type="isFullscreen ? 'primary' : 'default'">
                <el-icon><FullScreen /></el-icon>&nbsp;{{ isFullscreen ? '退出全屏' : '全屏' }}
              </el-button>
            </div>
          </div>
          <!-- 图片信息 -->
          <div class="image-info" v-if="imgInfo">
            <span class="info-badge">{{ imgInfo.width }} × {{ imgInfo.height }} px</span>
            <span class="info-badge">{{ imgInfo.type }}</span>
            <span v-if="previewSize" class="info-badge">{{ fmtSize(previewSize) }}</span>
          </div>
        </template>
        <!-- PDF 预览 -->
        <iframe
          v-else-if="previewKind === 'pdf' && previewUrl"
          :src="previewUrl"
          class="preview-pdf"
          width="100%"
          height="65vh"
        ></iframe>
        <!-- 代码预览 -->
        <pre v-else-if="previewKind === 'code' && previewUrl" class="preview-code">
          <code>{{ previewCode }}</code>
        </pre>
        <!-- 视频预览 -->
        <video
          v-else-if="previewKind === 'video' && previewUrl"
          :src="previewUrl"
          class="preview-media"
          controls
          preload="auto"
        ></video>
        <!-- 音频预览 -->
        <div v-else-if="previewKind === 'audio' && previewUrl" class="audio-box">
          <el-icon class="audio-icon"><Headset /></el-icon>
          <audio :src="previewUrl" class="preview-media" controls></audio>
        </div>
        <!-- 底部操作栏 -->
        <div v-if="!previewLoading && previewUrl" class="preview-actions">
          <el-button size="small" type="primary" @click="download(propsTarget || { path: previewName })">
            <el-icon><Download /></el-icon>&nbsp;下载
          </el-button>
          <el-button size="small" v-if="previewKind === 'image'" @click="openInNewTab">
            <el-icon><Top /></el-icon>&nbsp;新窗口打开
          </el-button>
        </div>
      </div>
    </el-dialog>

    <!-- 压缩包预览 -->
    <el-dialog v-model="archiveDialog" :title="`压缩包内容：${archiveName}`" width="640px">
      <div v-loading="archiveLoading">
        <el-table :data="archiveEntries" max-height="400">
          <el-table-column label="文件名" min-width="200" prop="name" />
          <el-table-column label="大小" width="100">
            <template #default="{ row }">{{ row.isDir ? '-' : fmtSize(row.size) }}</template>
          </el-table-column>
          <el-table-column label="类型" width="80">
            <template #default="{ row }">{{ row.isDir ? '文件夹' : '文件' }}</template>
          </el-table-column>
        </el-table>
        <div v-if="!archiveLoading && !archiveEntries.length" class="empty">无法读取压缩包内容</div>
      </div>
    </el-dialog>

    <!-- 标签筛选对话框 -->
    <el-dialog v-model="tagFilterDialog" title="按标签筛选" width="480px">
      <div class="tag-filter-list">
        <div v-if="allTags.length === 0" class="empty">暂无标签</div>
        <div v-for="t in allTags" :key="t" class="tag-filter-item" @click="activeTagFilter = t; tagFilterDialog = false; load()">
          <el-icon><PriceTag /></el-icon>&nbsp;{{ t }}
        </div>
      </div>
      <template #footer>
        <el-button @click="tagFilterDialog = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 文件标签管理对话框 -->
    <el-dialog v-model="tagDialogVisible" :title="`标签：${tagDialogTarget?.name || ''}`" width="480px">
      <div class="tag-manage-list">
        <div v-if="tagDialogTags.length === 0" class="empty">该文件暂无标签</div>
        <div v-for="tag in tagDialogTags" :key="tag" class="tag-manage-item">
          <span class="tag-badge">{{ tag }}</span>
          <el-button link size="small" @click="removeTagFromCurrent(tag)"><el-icon><Close /></el-icon></el-button>
        </div>
      </div>
      <div class="tag-input-row">
        <el-input v-model="newTagInput" placeholder="输入新标签名称" size="small" @keyup.enter="addTagToCurrent" />
        <el-button type="primary" size="small" @click="addTagToCurrent">添加</el-button>
      </div>
      <div class="tag-existing">
        <span class="tag-existing-label">已有标签：</span>
        <el-tag v-for="t in allTags" :key="t" size="small" @click="newTagInput = t" style="cursor: pointer; margin-right: 6px;">{{ t }}</el-tag>
      </div>
    </el-dialog>

    <!-- 加密对话框 -->
    <input ref="fileInput" type="file" multiple class="file-picker" @change="onPick" />

    <!-- 右键上下文菜单 -->
    <div
      v-if="contextMenu.visible"
      class="ctx-menu glass"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click="closeContextMenu"
    >
      <!-- 收藏（文件/文件夹通用） -->
      <button class="ctx-item" @click.stop="toggleStar(contextMenu.target)">
        <el-icon><StarFilled v-if="isStarred(contextMenu.target)" /><Star v-else /></el-icon> {{ isStarred(contextMenu.target) ? '取消收藏' : '收藏' }}
      </button>
      <!-- 快捷访问（文件/文件夹通用） -->
      <button class="ctx-item" @click.stop="toggleQuickAccess(contextMenu.target)">
        <el-icon><StarFilled v-if="isQuickAccess(contextMenu.target)" /><Star v-else /></el-icon> {{ isQuickAccess(contextMenu.target) ? '从快捷访问移除' : '添加到快捷访问' }}
      </button>
      <div class="ctx-sep" />
      <template v-if="contextMenu.target?.isDir">
        <!-- 文件夹菜单 -->
        <button class="ctx-item" @click.stop="ctxAction('open')">
          <el-icon><Folder /></el-icon> 打开
        </button>
        <div class="ctx-sep" />
        <button class="ctx-item" @click.stop="ctxAction('share')">
          <el-icon><Share /></el-icon> 分享
        </button>
        <button class="ctx-item" @click.stop="ctxAction('collab-share')">
          <el-icon><User /></el-icon> 共享给用户
        </button>
        <button class="ctx-item" @click.stop="ctxAction('compress')">
          <el-icon><Box /></el-icon> 压缩
        </button>
        <div class="ctx-sep" />
        <button class="ctx-item" @click.stop="ctxAction('rename')">
          <el-icon><EditPen /></el-icon> 重命名
        </button>
        <button class="ctx-item" @click.stop="ctxAction('move')">
          <el-icon><Right /></el-icon> 移动
        </button>
        <button class="ctx-item" @click.stop="ctxAction('copy')">
          <el-icon><Copy /></el-icon> 复制
        </button>
        <div class="ctx-sep" />
        <button class="ctx-item ctx-danger" @click.stop="ctxAction('delete')">
          <el-icon><Delete /></el-icon> 删除
        </button>
      </template>
      <template v-else>
        <!-- 文件菜单 -->
        <button v-if="isPreviewable(contextMenu.target?.name)" class="ctx-item" @click.stop="ctxAction('preview')">
          <el-icon><View /></el-icon> 预览
        </button>
        <button class="ctx-item" @click.stop="ctxAction('download')">
          <el-icon><Download /></el-icon> 下载
        </button>
        <button v-if="contextMenu.target?.name?.toLowerCase()?.endsWith('.zip')" class="ctx-item" @click.stop="ctxAction('decompress')">
          <el-icon><Box /></el-icon> 解压
        </button>
        <button v-if="!isArchive(contextMenu.target?.name)" class="ctx-item" @click.stop="ctxAction('compress')">
          <el-icon><Box /></el-icon> 压缩
        </button>
        <div class="ctx-sep" />
        <button class="ctx-item" @click.stop="ctxAction('share')">
          <el-icon><Share /></el-icon> 分享
        </button>
        <button class="ctx-item" @click.stop="ctxAction('collab-share')">
          <el-icon><User /></el-icon> 共享给用户
        </button>
        <button class="ctx-item" @click.stop="ctxAction('rename')">
          <el-icon><EditPen /></el-icon> 重命名
        </button>
        <button class="ctx-item" @click.stop="ctxAction('move')">
          <el-icon><Right /></el-icon> 移动
        </button>
        <button class="ctx-item" @click.stop="ctxAction('copy')">
          <el-icon><Copy /></el-icon> 复制
        </button>
        <button class="ctx-item" @click.stop="ctxAction('props')">
          <el-icon><InfoFilled /></el-icon> 属性
        </button>
        <button class="ctx-item" @click.stop="openTagDialog(contextMenu.target)">
          <el-icon><PriceTag /></el-icon> 标签
        </button>
        <div class="ctx-sep" />
        <button class="ctx-item ctx-danger" @click.stop="ctxAction('delete')">
          <el-icon><Delete /></el-icon> 删除
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 仪表盘统计卡片 */
.stats-bar {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}
.stat-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border-radius: 14px;
}
.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 22px;
  color: #fff;
  flex-shrink: 0;
}
.si-blue { background: linear-gradient(135deg, #5b8cff, #7c6ff0); }
.si-green { background: linear-gradient(135deg, #2ea24f, #6fcf9a); }
.si-purple { background: linear-gradient(135deg, #7c6ff0, #b8a4f5); }
.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
}
.stat-label {
  font-size: 13px;
  color: var(--text-secondary);
}

/* ---------- 紧凑统计条（全主题 1 行；dashboard 主题保留大 4 卡，数据源同一 statCards） ---------- */
.stats-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: center;
  gap: 10px 16px;
  padding: 12px 16px;
  border-radius: var(--card-radius);
  margin-bottom: 16px;
}
/* 单行布局仅 ≥1200px（F0：768–1199px 平板带保持 2 列网格，避免统计条横向溢出） */
@media (min-width: 1200px) {
  .stats-strip {
    display: flex;
    gap: 0;
    padding: 12px 18px;
  }
}
.ss-item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.ss-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 14px;
  color: #fff;
  flex-shrink: 0;
}
.ss-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.ss-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
}
/* 配额进度槽（████，宽度 = usageTotal/quota） */
.ss-track {
  flex: 0 1 96px;
  min-width: 48px;
  height: 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  overflow: hidden;
}
.ss-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), #8a93fb);
  transition: width 0.3s ease;
}
.ss-fill.warn {
  background: linear-gradient(90deg, #f59e0b, #ef4444);
}
/* 趋势 chip（复用 stat-trend 涨绿/跌红语义） */
.ss-chip {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.ss-chip.up {
  color: #34d399;
  background: rgba(52, 211, 153, 0.12);
}
.ss-chip.down {
  color: #f87171;
  background: rgba(248, 113, 113, 0.12);
}
/* 分隔符：仅桌面单行布局（≥1200px）显示 */
.ss-sep {
  display: none;
}
@media (min-width: 1200px) {
  .ss-sep {
    display: block;
    width: 1px;
    height: 22px;
    margin: 0 16px;
    background: var(--glass-border);
  }
}

/* 目录选择器 */
.dir-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dir-picker-breadcrumb {
  padding: 8px 0;
}
.dir-picker-list {
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  padding: 8px;
}
.dir-picker-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.dir-picker-item:hover {
  background: var(--accent-soft);
}
.dir-icon {
  color: var(--accent);
  font-size: 20px;
}
.dir-name {
  flex: 1;
  font-size: 14px;
}
.dir-hint {
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0;
  transition: opacity 0.15s;
}
.dir-picker-item:hover .dir-hint {
  opacity: 1;
}
.dir-picker-empty {
  text-align: center;
  padding: 24px;
  color: var(--text-secondary);
  font-size: 13px;
}
.dir-picker-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.dir-picker-current {
  font-size: 13px;
  color: var(--text-secondary);
}
.dir-picker-current code {
  background: var(--glass-bg);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.dir-picker-actions {
  display: flex;
  gap: 8px;
}

/* 右键上下文菜单 */
.ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 160px;
  padding: 6px 0;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 13px;
  color: var(--text);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  width: 100%;
}
.ctx-item:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
.ctx-item .el-icon {
  font-size: 16px;
  color: var(--text-secondary);
}
.ctx-item:hover .el-icon {
  color: var(--accent);
}
.ctx-danger {
  color: #ef4444;
}
.ctx-danger .el-icon {
  color: #ef4444;
}
.ctx-danger:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}
.ctx-sep {
  height: 1px;
  background: var(--glass-border);
  margin: 4px 8px;
}

.files-glass {
  border-radius: 20px;
  padding: 18px;
  min-height: 0; /* P10：移除 calc(100vh - 100px) 魔数 */
  position: relative;
  z-index: 1;
  /* 两行工具栏高度变量（spec §2/§3；默认 40/48） */
  --toolbar-h1: 40px;
  --toolbar-h2: 48px;
}
/* top-nav：行 2 更紧凑（spec §2） */
.files-topnav .files-glass {
  --toolbar-h2: 44px;
}
/* command：最紧凑（spec §2） */
.files-command .files-glass {
  --toolbar-h1: 36px;
  --toolbar-h2: 40px;
}
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 18px;
}
/* 行 1：面包屑（全宽，溢出省略，保留末级可见） */
.toolbar-row1 {
  display: flex;
  align-items: center;
  height: var(--toolbar-h1);
  min-width: 0;
}
/* 行 2：控件（左：存储 + 搜索；右：.toolbar-actions 右对齐） */
.toolbar-row2 {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--toolbar-h2);
}
.storage-select {
  width: 150px;
  flex-shrink: 0;
}
.crumbs {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
/* 深层路径截断（P2）：项右对齐 + 不收缩，裁剪前级、保留"…/父级/当前"可见 */
.crumbs :deep(.el-breadcrumb__list) {
  display: flex;
  flex-wrap: nowrap;
  justify-content: flex-end;
  overflow: hidden;
  white-space: nowrap;
}
.crumbs :deep(.el-breadcrumb__item) {
  flex-shrink: 0;
  white-space: nowrap;
}
.crumb {
  color: var(--accent);
  cursor: pointer;
}
.crumb:hover {
  filter: brightness(1.1);
}
/* 深层路径折叠省略号（F3）：非交互，弱色 */
.crumb-ellipsis {
  color: var(--text-secondary);
  cursor: default;
  opacity: 0.7;
}
/* 行 2 右侧动作组（视图切换 / 排序 / 上传 / 新建，右对齐） */
.toolbar-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ---------- 平板带（768–1199px，F0）：行2 收敛为 [搜索][⋯]，避免横向滚动 ----------
   存储 / 视图切换 / 排序 / 上传 / 新建 全部收进 ⋯ ElPopover（复用移动端 ⋯ 菜单模式）。
   ≥1200px 行2 全展开（存储 + 搜索 + 视图 + 排序 + 上传/新建）。 */
.toolbar-tablet-actions {
  display: none;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.tablet-more-btn {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 18px;
}
.tablet-more-btn:hover {
  color: var(--text);
}
/* ⋯ 菜单内的视图切换组（复用 .vt-btn 视觉） */
.mm-view {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}
.mm-view .vt-btn {
  width: 36px;
  height: 32px;
}
@media (min-width: 768px) and (max-width: 1199px) {
  .toolbar-row2 .storage-select,
  .toolbar-row2 .toolbar-actions {
    display: none;
  }
  .toolbar-tablet-actions {
    display: flex;
  }
  /* command 主题：保留自身最小工具栏（存储/排序/视图切换），不用 ⋯ 菜单 */
  .files-command .toolbar-row2 .storage-select {
    display: inline-flex;
  }
  .files-command .toolbar-row2 .toolbar-actions {
    display: flex;
  }
  .files-command .toolbar-tablet-actions {
    display: none;
  }
}

/* 全局搜索框（常驻） */
.toolbar-search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  width: clamp(220px, 24vw, 360px);
}
.toolbar-search-icon {
  color: var(--text-secondary);
  flex-shrink: 0;
}
.toolbar-search-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 13px;
  color: var(--text);
  min-width: 100px;
}
.toolbar-search-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.7;
}
.toolbar-search-btn {
  border: none;
  background: var(--accent-soft);
  color: var(--accent);
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
}
.toolbar-search-btn:hover {
  filter: brightness(1.05);
}

/* 视图切换 */
.view-toggle {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 12px;
}
.vt-btn {
  width: 32px;
  height: 30px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  border-radius: 9px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}
.vt-btn:hover {
  color: var(--text);
}
.vt-btn.active {
  background: var(--accent-soft);
  color: var(--accent);
}

/* 排序控件 */
.sort-select {
  width: 110px;
}
.sort-order-btn {
  width: 32px;
  height: 30px;
  display: inline-grid;
  place-items: center;
  border: none;
  border-radius: 10px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}
.sort-order-btn:hover {
  color: var(--text);
  background: var(--accent-soft);
}

/* 图片预览 */
.preview-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  min-height: 200px;
}
.preview-img {
  max-width: 100%;
  max-height: 65vh;
  border-radius: 12px;
  box-shadow: var(--shadow-hover);
}
.preview-media {
  width: 100%;
  max-height: 65vh;
  border-radius: 12px;
  box-shadow: var(--shadow-hover);
  background: #000;
}
.audio-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding: 30px 20px;
  width: 100%;
}
.audio-icon {
  font-size: 72px;
  color: var(--accent);
  opacity: 0.85;
}
.audio-box .preview-media {
  width: 100%;
  max-width: 560px;
  max-height: none;
  background: transparent;
  box-shadow: none;
}
.preview-meta {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: var(--text-secondary);
}

/* 图片预览增强 */
.image-preview-container {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 65vh;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 12px;
  cursor: crosshair;
}
.preview-img-enhanced {
  transition: transform 0.2s ease;
  border-radius: 4px;
  box-shadow: var(--shadow-hover);
  user-select: none;
}
.gallery-controls {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
}
.gallery-counter {
  font-size: 14px;
  color: var(--text-secondary);
  min-width: 60px;
  text-align: center;
}
.gallery-nav {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: var(--accent-soft);
  color: var(--accent);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all 0.2s;
}
.gallery-nav:hover {
  background: var(--accent);
  color: #fff;
}
.image-toolbar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  padding: 8px 0;
}
.toolbar-section {
  display: flex;
  align-items: center;
  gap: 8px;
}
.zoom-label {
  font-size: 13px;
  color: var(--text-secondary);
  min-width: 48px;
  text-align: center;
}
.image-info {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}
.info-badge {
  padding: 4px 10px;
  background: var(--accent-soft);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.preview-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  padding-top: 8px;
}

/* 选中信息栏 */
.selection-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  margin-bottom: 12px;
  background: var(--accent-soft);
  border-radius: 10px;
  font-size: 13px;
  color: var(--text-secondary);
}
.selection-bar b {
  color: var(--accent);
}

/* 网格视图（P4）：auto-fill + clamp 列宽；gap/pad/radius 跟随主题 --card-* 变量 */
.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(clamp(150px, 18vw, 220px), 1fr));
  gap: var(--card-gap, 14px);
}
.file-card {
  border-radius: var(--card-radius, 18px);
  padding: var(--card-pad, 18px 14px);
  cursor: pointer;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  position: relative;
  transition: all 0.2s;
}
.file-card.selected {
  border: 2px solid var(--accent);
  background: var(--accent-soft);
}
.file-card.selected .fc-name {
  color: var(--accent);
}
/* 移动端（<768px，F5）：显式 2 列 + 紧凑间距/内边距 */
@media (max-width: 767px) {
  .file-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .file-card {
    padding: 12px 10px;
  }
}

/* ---------- 骨架屏 + 淡入动画 ---------- */
.skeleton-card {
  pointer-events: none;
  user-select: none;
}
.skeleton-icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  margin: 8px auto 0;
  background: linear-gradient(90deg, var(--glass-bg) 25%, rgba(255,255,255,0.15) 50%, var(--glass-bg) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
}
.skeleton-name {
  width: 60%;
  height: 14px;
  border-radius: 4px;
  margin: 10px auto 0;
  background: linear-gradient(90deg, var(--glass-bg) 25%, rgba(255,255,255,0.15) 50%, var(--glass-bg) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
}
.skeleton-meta {
  width: 40%;
  height: 12px;
  border-radius: 4px;
  margin: 8px auto 0;
  background: linear-gradient(90deg, var(--glass-bg) 25%, rgba(255,255,255,0.12) 50%, var(--glass-bg) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
}
@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.file-fade-in {
  animation: fade-in-up 0.35s ease-out both;
}
@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
/* 选择框：左上角，始终可见 */
.fc-checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 1;
}
.fc-checkbox .el-checkbox {
  vertical-align: middle;
}
.fc-icon {
  height: 56px;
  display: grid;
  place-items: center;
}
.fc-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fc-meta {
  font-size: 12px;
  color: var(--text-secondary);
}
.fc-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 6px;
  opacity: 0;
  transition: opacity 0.2s;
}
.file-card:hover .fc-actions,
.file-card.selected .fc-actions {
  opacity: 1;
}
.row-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.row-actions-wrap {
  opacity: 0;
  transition: opacity 0.2s;
}
.file-table :deep(.el-table__row:hover) .row-actions-wrap {
  opacity: 1;
}
/* 触屏（无 hover）设备：操作按钮常显，避免丢失文件级操作入口 */
@media (hover: none) {
  .fc-actions {
    opacity: 1;
  }
  .row-actions-wrap {
    opacity: 1;
  }
}
.more-btn {
  padding: 4px;
}
.empty {
  grid-column: 1 / -1;
  text-align: center;
  padding: 60px 0;
  color: var(--text-secondary);
  font-size: 14px;
}

/* 列表视图 */
.file-table {
  width: 100%;
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: transparent;
}
.file-table :deep(.el-table) {
  background: transparent;
}
.file-table :deep(.el-table__header) {
  background: transparent;
}
.f-icon {
  margin-right: 6px;
  vertical-align: -2px;
}
.f-name {
  vertical-align: -2px;
  cursor: pointer;
  color: var(--text);
}
.f-name.dir {
  color: var(--accent);
  font-weight: 500;
}
.form-tip {
  font-size: 12px;
  color: #909399;
  margin-bottom: 8px;
}
.search-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.search-table {
  width: 100%;
}
.upload-item {
  margin-bottom: 14px;
}
.upload-name {
  font-size: 13px;
  color: var(--text);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.upload-status {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

/* 隐藏但可点击的文件选择器（display:none 会导致 .click() 无法打开选择框） */
.file-picker {
  position: absolute;
  top: 0;
  left: 0;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
}

/* 图片画廊 */
.gallery-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.gallery-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
  z-index: 10;
}
.gallery-nav:hover {
  background: rgba(0, 0, 0, 0.6);
}
.gallery-prev { left: 12px; }
.gallery-next { right: 12px; }
.gallery-counter {
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 8px;
}

/* PDF 预览 */
.preview-pdf {
  border: none;
  border-radius: 12px;
  box-shadow: var(--shadow-hover);
}

/* 代码预览 */
.preview-code {
  max-height: 65vh;
  overflow: auto;
  padding: 16px;
  border-radius: 12px;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
.preview-code code {
  font-family: inherit;
}

/* 文件属性抽屉 */
.props-wrap {
  padding: 8px 0;
}
.props-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.props-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--accent-soft);
}
.props-label {
  font-size: 13px;
  color: var(--text-secondary);
}
.props-value {
  font-size: 13px;
  color: var(--text);
  font-weight: 500;
  text-align: right;
  max-width: 200px;
  word-break: break-all;
}

/* 搜索高级过滤 */
.search-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

/* 照片视图 - 纯图片画廊 */
.photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  padding: 8px 0;
}
.photo-card {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  background: #000;
  transition: transform 0.2s, box-shadow 0.2s;
}
.photo-card:hover {
  transform: scale(1.02);
  box-shadow: var(--shadow-hover);
}
.photo-card img {
  width: 100%;
  height: 220px;
  object-fit: cover;
  display: block;
}
.photo-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 8px 12px;
  font-size: 12px;
  color: #fff;
  background: linear-gradient(transparent, rgba(0,0,0,0.7));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  transition: opacity 0.2s;
}
.photo-card:hover .photo-overlay {
  opacity: 1;
}

/* ---------- 仪表盘布局：统计卡网格（4 列 + 趋势 chip + 入场 stagger） ---------- */
.files-dashboard .stats-bar {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
@media (max-width: 1199px) {
  .files-dashboard .stats-bar {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 767px) {
  .files-dashboard .stats-bar {
    grid-template-columns: 1fr;
  }
}
.files-dashboard .stat-card {
  min-height: 108px;
  border-radius: 12px;
  padding: 16px 20px;
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.6), rgba(51, 65, 85, 0.6));
  animation: dash-in 240ms ease-out both;
  animation-delay: calc(var(--i) * 40ms);
}
.files-dashboard .stat-value {
  font-size: 28px;
  font-weight: 700;
  transition: transform 150ms;
}
/* 点睛：统计卡 hover 时数值轻微放大 */
.files-dashboard .stat-card:hover .stat-value {
  transform: scale(1.02);
}
.files-dashboard .stat-label {
  font-size: 13px;
}
/* 趋势 chip：涨绿 / 跌红 */
.stat-trend {
  margin-left: auto;
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.stat-trend.up {
  color: #34d399;
  background: rgba(52, 211, 153, 0.12);
}
.stat-trend.down {
  color: #f87171;
  background: rgba(248, 113, 113, 0.12);
}
/* 第 4 张卡（配额）图标底色 */
.si-orange {
  background: linear-gradient(135deg, #f59e0b, #fbbf24);
}
@keyframes dash-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}

/* ---------- 便当盒布局：mobile-first bento 网格（P5：3 断点） ----------
   <768px：2 列（featured/medium 通栏）；768–1199px：3 列（featured 2×2、medium 2）；≥1200px：4 列 */
.files-bento .file-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
/* 普通卡：实底白 + 1px 边框，非玻璃 */
.files-bento .file-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 20px;
}
/* 次级文本对比度（F7）：白卡 meta 加深至 ≥4.5:1（tile 卡由下方 color:inherit 规则覆盖） */
.files-bento .file-card .fc-meta {
  color: #5b6b82;
}
/* featured：大卡（首卡；移动端通栏，≥768px 为 2×2） */
.files-bento .bento-featured {
  grid-column: span 2;
  min-height: 340px;
  background: #4f46e5;
  color: #ffffff;
  transition: transform 150ms ease-out, box-shadow 150ms ease-out;
}
/* 点睛：featured hover 轻微上浮 + 强调投影 */
.files-bento .bento-featured:hover {
  transform: translateY(-4px);
  box-shadow: 0 16px 40px rgba(79, 70, 229, 0.3);
}
/* medium：2×1 中卡（第 2/3 卡） */
.files-bento .bento-medium {
  grid-column: span 2;
  min-height: 168px;
}
/* 彩色 tile（每屏 2-3 张） */
.files-bento .tile-indigo {
  background: #4f46e5;
  color: #fff;
}
.files-bento .tile-amber {
  background: #f59e0b;
  color: #451a03;
}
.files-bento .tile-emerald {
  background: #10b981;
  color: #052e16;
}
/* 点睛：tile 卡 hover 颜色轻微加深 */
.files-bento .tile-indigo,
.files-bento .tile-amber,
.files-bento .tile-emerald {
  transition: filter 150ms ease-out;
}
.files-bento .tile-indigo:hover,
.files-bento .tile-amber:hover,
.files-bento .tile-emerald:hover {
  filter: brightness(1.05);
}
/* tile 卡内文字跟随 tile 配色（覆盖通用 var(--text)） */
.files-bento .bento-featured .fc-name,
.files-bento .tile-indigo .fc-name,
.files-bento .tile-amber .fc-name,
.files-bento .tile-emerald .fc-name {
  color: inherit;
}
.files-bento .bento-featured .fc-meta,
.files-bento .tile-indigo .fc-meta,
.files-bento .tile-amber .fc-meta,
.files-bento .tile-emerald .fc-meta {
  color: inherit;
  opacity: 0.85;
}
/* 平板 768–1199px（P5）：3 列，featured 2×2，medium 2 */
@media (min-width: 768px) {
  .files-bento .file-grid {
    grid-template-columns: repeat(3, 1fr);
  }
  .files-bento .bento-featured {
    grid-row: span 2;
  }
}
/* 桌面 ≥1200px：4 列 */
@media (min-width: 1200px) {
  .files-bento .file-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

/* ---------- 命令式布局：最小工具栏 + 真 ⌘K 命令面板 ----------
   P6：行 2 仅保留 [存储切换][排序][视图切换]（搜索/上传/新建/更多/批量隐藏）；⌘K 面板不变 */
.files-command .toolbar-search {
  display: none;
}
.files-command .toolbar-actions :deep(.el-button),
.files-command .toolbar-actions :deep(.el-dropdown) {
  display: none;
}
.files-command .file-grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.files-command .file-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-radius: 6px;
  background: transparent;
  border: none;
}
.files-command .file-card:hover {
  background: var(--accent-soft);
}
.files-command .fc-icon {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
}
.files-command .fc-icon .el-icon {
  font-size: 20px !important;
}
.files-command .fc-name {
  flex: 1;
  font-size: 14px;
  font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, monospace;
}
.files-command .fc-meta {
  font-size: 12px;
  color: var(--text-secondary);
}
.files-command .fc-actions {
  display: none;
}

/* ⌘K 命令面板（等宽仅 .fc-name / .cmdk-*，body 保持 sans） */
.cmdk-panel {
  position: fixed;
  top: 20vh;
  left: 50%;
  transform: translateX(-50%);
  width: min(640px, calc(100vw - 32px));
  max-height: min(480px, calc(100vh - 24vh));
  background: #1e2128;
  border: 1px solid #2e323c;
  border-radius: 8px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  z-index: 2000;
  display: flex;
  flex-direction: column;
}
.cmdk-input {
  height: 48px;
  font-size: 16px;
  font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, monospace;
  background: transparent;
  border: none;
  border-bottom: 1px solid #2e323c;
  color: #e6e8ec;
  padding: 0 16px;
  outline: none;
}
.cmdk-list {
  overflow-y: auto;
  padding: 8px;
}
.cmdk-item {
  height: 40px;
  font-size: 14px;
  font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, monospace;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-radius: 4px;
  cursor: pointer;
  color: #e6e8ec;
  border-left: 2px solid transparent; /* 占位：active 指示条不引起行内容位移 */
  transition: background 80ms;
}
.cmdk-item.active {
  background: #262a33;
  border-left: 2px solid #ff6b35; /* 点睛：active 行左侧橙色指示条 */
}
.cmdk-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.cmdk-empty {
  padding: 16px 12px;
  font-size: 14px;
  font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, monospace;
  color: #9aa1ad;
  text-align: center;
}

/* ---------- 顶部导航布局：更紧凑（P9：与 spec §8 topnav 观感统一） ---------- */
.files-topnav .files-glass {
  border-radius: 0;
  margin: 0;
  padding: 16px;
}

.stat-card {
  position: relative;
  cursor: default;
  transition: all 0.2s;
}

/* ---------- 标签系统 ---------- */
.tag-select {
  width: 140px;
}
.tag-filter-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tag-filter-item {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--glass-bg);
  cursor: pointer;
  transition: all 0.2s;
}
.tag-filter-item:hover {
  background: var(--accent-soft);
  transform: translateX(4px);
}
.tag-manage-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
.tag-manage-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--glass-bg);
}
.tag-badge {
  font-size: 13px;
  font-weight: 500;
  color: var(--accent);
}
.tag-input-row {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.tag-input-row .el-input {
  flex: 1;
}
.tag-existing {
  font-size: 12px;
  color: var(--text-secondary);
}
.tag-existing-label {
  margin-right: 8px;
}

/* 共享给用户提示 */
.collab-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

/* ---------- 移动端（<768px，P8）：工具栏仅留 [搜索][⋯]，搜索为全屏覆盖层 ---------- */
.toolbar-mobile-actions {
  display: none;
}
.mobile-search-overlay {
  display: none;
}
@media (max-width: 767px) {
  /* 桌面控件隐藏，仅留移动端动作组 */
  .toolbar-row2 .storage-select,
  .toolbar-row2 .toolbar-search,
  .toolbar-row2 .toolbar-actions {
    display: none;
  }
  .toolbar-mobile-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }
  .mobile-search-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 44px;
    padding: 0 14px;
    border-radius: 12px;
    font-size: 13px;
    color: var(--text);
    cursor: pointer;
    flex-shrink: 0;
  }
  .mobile-more-btn {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    color: var(--text);
    cursor: pointer;
    flex-shrink: 0;
  }
  /* ⋯ 更多菜单（ElPopover 内容） */
  .mobile-more-menu {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .mm-item {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 0 12px;
    border-radius: 10px;
    font-size: 14px;
    color: var(--text);
    cursor: pointer;
    background: transparent;
    border: none;
    width: 100%;
    text-align: left;
    transition: background 0.15s;
  }
  .mm-item:hover {
    background: var(--accent-soft);
  }
  .mm-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .mm-item .el-icon {
    color: var(--accent);
    flex-shrink: 0;
  }
  .mm-sort {
    gap: 8px;
  }
  .mm-sort-label {
    font-size: 14px;
    color: var(--text);
    flex-shrink: 0;
  }
  .mm-sort .el-select {
    flex: 1;
    width: auto;
  }
  .mm-sep {
    height: 1px;
    background: var(--glass-border);
    margin: 4px 0;
  }
  /* 全屏搜索覆盖层 */
  .mobile-search-overlay {
    display: flex;
    flex-direction: column;
    position: fixed;
    inset: 0;
    z-index: 200;
    background: var(--surface, #0b0e14);
  }
  .ms-topbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--glass-border);
  }
  .ms-close {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    border: none;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    flex-shrink: 0;
  }
  .ms-input-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    padding: 0 12px;
    border-radius: 12px;
    background: var(--glass-bg);
    min-width: 0;
  }
  .ms-icon {
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .ms-input {
    flex: 1;
    border: none;
    background: transparent;
    outline: none;
    font-size: 15px;
    color: var(--text);
    min-width: 0;
  }
  .ms-input::placeholder {
    color: var(--text-secondary);
    opacity: 0.7;
  }
  .ms-go {
    height: 44px;
    padding: 0 18px;
    border-radius: 12px;
    border: none;
    background: var(--accent);
    color: #fff;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
  }
  .ms-go:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .ms-results {
    flex: 1;
    overflow-y: auto;
    padding: 8px 16px 24px;
  }
  .ms-item {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 8px 12px;
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .ms-item:hover {
    background: var(--accent-soft);
  }
  .ms-f-icon {
    color: var(--accent);
    font-size: 22px;
    flex-shrink: 0;
  }
  .ms-f-info {
    flex: 1;
    min-width: 0;
  }
  .ms-f-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ms-f-path {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ms-empty {
    padding: 48px 16px;
    text-align: center;
    font-size: 14px;
    color: var(--text-secondary);
  }
}
</style>
