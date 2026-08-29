<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api, fmtSize, loadThumbs } from '../api';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';

const router = useRouter();

const loading = ref(false);
const hasLoaded = ref(false);
const showSkeleton = ref(false);
let skeletonTimer: ReturnType<typeof setTimeout> | null = null;
const favorites = ref<any[]>([]);
const storageMap = ref<Record<number, string>>({});

/* ---------- 文件类型识别 ---------- */
const IMG_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'];
// FE-3: HTML/JS 文件强制下载，禁止内联预览（防 XSS / 脚本执行）
const DANGEROUS_HTML_JS_EXTS = ['html', 'htm', 'js', 'jsx', 'mjs'];
const CODE_EXTS = ['js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'html', 'css', 'json', 'sh', 'vue', 'go', 'rs', 'xml', 'yml', 'yaml', 'md', 'txt', 'sql', 'ini', 'conf', 'env'];
function extOf(name: string) { return name.split('.').pop()?.toLowerCase() || ''; }
function isImage(n: string) { return IMG_EXTS.includes(extOf(n)); }
function isCode(n: string) { return CODE_EXTS.includes(extOf(n)); }
function isPdf(n: string) { return extOf(n) === 'pdf'; }
function isVideo(n: string) { return ['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'wmv', 'm4v', 'ts', '3gp'].includes(extOf(n)); }
function isAudio(n: string) { return ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'].includes(extOf(n)); }
function isPreviewable(n: string) { return isImage(n) || isVideo(n) || isAudio(n) || isPdf(n) || isCode(n); }

function fileName(path: string) { return path.split('/').pop() || path; }
function fileDir(path: string) { return path.replace(/\/[^/]*$/, '') || '/'; }
function formatTime(t: string) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- 收藏状态集合（即时星标反馈） ---------- */
const starredSet = ref<Set<string>>(new Set());
function starKey(storageId: number, path: string) { return storageId + '||' + path; }
function isFav(storageId: number, path: string) { return starredSet.value.has(starKey(storageId, path)); }

/* ---------- 类型筛选 ---------- */
const favFilter = ref<'all' | 'folder' | 'media' | 'doc' | 'other'>('all');
function favTypeOf(row: any): 'folder' | 'media' | 'doc' | 'other' {
  if (row.isDir) return 'folder';
  const n = fileName(row.path);
  if (isImage(n) || isVideo(n) || isAudio(n)) return 'media';
  if (isPdf(n) || isCode(n) || /\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(n)) return 'doc';
  return 'other';
}
const favFilters = computed(() => [
  { key: 'all', label: '全部', count: favorites.value.length },
  { key: 'folder', label: '文件夹', count: favorites.value.filter((f) => favTypeOf(f) === 'folder').length },
  { key: 'media', label: '媒体', count: favorites.value.filter((f) => favTypeOf(f) === 'media').length },
  { key: 'doc', label: '文档', count: favorites.value.filter((f) => favTypeOf(f) === 'doc').length },
  { key: 'other', label: '其他', count: favorites.value.filter((f) => favTypeOf(f) === 'other').length },
]);
const filteredFavorites = computed(() =>
  favFilter.value === 'all' ? favorites.value : favorites.value.filter((f) => favTypeOf(f) === favFilter.value),
);

/* ---------- 数据加载 ---------- */
async function load() {
  loading.value = true;
  // 延迟 150ms 后才显示骨架屏，快速加载时不闪烁
  skeletonTimer = setTimeout(() => {
    if (!hasLoaded.value) showSkeleton.value = true;
  }, 150);
  try {
    // /storages 和 /favorites 并行加载，/storages 不阻塞主流程
    // fast=1 跳过用量计算，快速返回
    const storagesPromise = api('/storages?fast=1').then((sr: any) => {
      sr.storages.forEach((s: any) => { storageMap.value[s.id] = s.name; });
    }).catch(() => {});
    const r = await api('/favorites');
    const favs = r.favorites || [];
    // 构建星标集合
    starredSet.value = new Set(favs.map((f: any) => starKey(f.storage_id, f.path)));
    // 立即显示收藏列表（基础信息），不等待 meta 解析
    favorites.value = favs.map((f: any) => ({ ...f, name: fileName(f.path), size: 0, isDir: false, mtime: '', valid: true }));
    hasLoaded.value = true; // 立即标记为已加载，解除骨架屏阻塞
    if (skeletonTimer) { clearTimeout(skeletonTimer); skeletonTimer = null; }
    showSkeleton.value = false;
    loading.value = false; // 初始数据已显示，关闭 loading
    // 后台异步解析每项文件详细信息
    const resolved = await Promise.all(favs.map(async (f: any) => {
      try {
        const mr = await api(`/files/${encodeURIComponent(f.path)}/meta?storageId=${f.storage_id}`);
        return { ...f, name: mr.meta.name, size: mr.meta.size, isDir: mr.meta.isDir, mtime: mr.meta.mtime, valid: true };
      } catch {
        return { ...f, name: fileName(f.path), size: 0, isDir: false, mtime: '', valid: false };
      }
    }));
    favorites.value = resolved;
    startThumbs();
  } catch (e: any) {
    ElMessage.error(e.message || '加载收藏失败');
    hasLoaded.value = true;
  } finally {
    if (skeletonTimer) { clearTimeout(skeletonTimer); skeletonTimer = null; }
    loading.value = false;
    showSkeleton.value = false;
  }
}

/* 图片文件缩略图（带鉴权拉取，失败回退图标） */
const thumbs = ref<Record<string, string>>({});
let abortThumbs: (() => void) | null = null;
function startThumbs() {
  abortThumbs?.();
  thumbs.value = {};
  abortThumbs = loadThumbs(
    favorites.value.filter((f) => f.valid && !f.isDir).map((f) => ({ storageId: f.storage_id, path: f.path })),
    (path, url) => {
      thumbs.value[path] = url;
    },
    96
  );
}

/* ---------- 文件夹浏览 ---------- */
const view = ref<'list' | 'browse'>('list');
const browseStorageId = ref(1);
const browsePath = ref('/');
const browseEntries = ref<any[]>([]);
const browseLoading = ref(false);

const browseCrumbs = computed(() => {
  const out = [{ name: '根目录', path: '/' }];
  if (browsePath.value !== '/') {
    const segs = browsePath.value.split('/').filter(Boolean);
    let acc = '';
    for (const s of segs) { acc += '/' + s; out.push({ name: s, path: acc }); }
  }
  return out;
});

async function openFolder(fav: any) {
  browseStorageId.value = fav.storage_id;
  browsePath.value = fav.path;
  view.value = 'browse';
  await loadBrowse();
}

async function loadBrowse() {
  browseLoading.value = true;
  try {
    const r = await api(`/files?storageId=${browseStorageId.value}&path=${encodeURIComponent(browsePath.value)}&sort=name&order=asc`);
    browseEntries.value = r.entries.map((e: any) => ({ ...e, storage_id: browseStorageId.value }));
    // 浏览视图同样拉缩略图（覆盖列表视图的中止）
    abortThumbs?.();
    const sid = browseStorageId.value;
    abortThumbs = loadThumbs(
      browseEntries.value.filter((e: any) => !e.isDir).map((e: any) => ({ storageId: sid, path: e.path })),
      (path, url) => {
        thumbs.value[path] = url;
      },
      96
    );
  } catch (e: any) {
    ElMessage.error(e.message || '打开文件夹失败');
  } finally {
    browseLoading.value = false;
  }
}

function browseTo(path: string) {
  browsePath.value = path;
  loadBrowse();
}

function backToList() {
  view.value = 'list';
  load();
}

/* ---------- 星标切换（浏览视图中收藏/取消） ---------- */
async function toggleStar(storageId: number, path: string, name: string) {
  const key = starKey(storageId, path);
  try {
    if (starredSet.value.has(key)) {
      await api(`/favorites?storageId=${storageId}&path=${encodeURIComponent(path)}`, { method: 'DELETE' });
      starredSet.value.delete(key);
      ElMessage.success('已取消收藏');
    } else {
      await api('/favorites', { method: 'POST', body: JSON.stringify({ storageId, path }) });
      starredSet.value.add(key);
      ElMessage.success('已收藏「' + name + '」');
    }
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败');
  }
}

/* ---------- 预览 ---------- */
const previewDialog = ref(false);
const previewUrl = ref('');
const previewName = ref('');
const previewKind = ref<'image' | 'video' | 'audio' | 'pdf' | 'code'>('image');
const previewCode = ref('');
const previewLoading = ref(false);

async function openPreview(fav: any) {
  if (fav.isDir) return;
  const n = fileName(fav.path);
  // FE-3: HTML/JS 文件强制下载，禁止内联预览
  if (DANGEROUS_HTML_JS_EXTS.includes(extOf(n))) return download(fav);
  const kind = isVideo(n) ? 'video' : isAudio(n) ? 'audio' : isPdf(n) ? 'pdf' : isImage(n) ? 'image' : isCode(n) ? 'code' : null;
  if (!kind) return download(fav);
  previewName.value = n;
  previewKind.value = kind;
  previewDialog.value = true;
  previewLoading.value = true;
  previewUrl.value = '';
  previewCode.value = '';
  try {
    const token = localStorage.getItem('nebula_token') || '';
    const base = `/api/v1/files/preview?storageId=${fav.storage_id}&path=${encodeURIComponent(fav.path)}`;
    const res = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('预览加载失败');
    if (kind === 'code') {
      const text = await res.text();
      previewCode.value = text.length > 50000 ? text.slice(0, 50000) + '\n... (内容过长，仅显示前 50KB)' : text;
      previewUrl.value = 'code-loaded';
    } else {
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
  if (previewUrl.value && previewUrl.value.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = '';
}

/* ---------- 下载 ---------- */
async function download(fav: any) {
  try {
    const r = await api('/files/download-ticket', { method: 'POST', body: JSON.stringify({ storageId: fav.storage_id, path: fav.path }) });
    const a = document.createElement('a');
    a.href = `/api/v1/files/download?ticket=${r.ticket}`;
    a.click();
  } catch (e: any) {
    ElMessage.error(e.message || '下载失败');
  }
}

/* ---------- 重命名 ---------- */
const renameDialog = ref(false);
const renameTarget = ref<any>(null);
const renameValue = ref('');
function openRename(fav: any) {
  renameTarget.value = fav;
  renameValue.value = fileName(fav.path);
  renameDialog.value = true;
}
async function doRename() {
  const name = renameValue.value.trim();
  if (!name) return ElMessage.warning('名称不能为空');
  const p = renameTarget.value.path;
  const dir = fileDir(p);
  const newPath = (dir === '/' ? '' : dir) + '/' + name;
  try {
    await api('/files/rename', { method: 'POST', body: JSON.stringify({ storageId: renameTarget.value.storage_id, path: p, newPath }) });
    // 若是收藏项，同步指向新路径
    if (isFav(renameTarget.value.storage_id, p)) {
      await api(`/favorites?storageId=${renameTarget.value.storage_id}&path=${encodeURIComponent(p)}`, { method: 'DELETE' });
      await api('/favorites', { method: 'POST', body: JSON.stringify({ storageId: renameTarget.value.storage_id, path: newPath }) });
      starredSet.value.delete(starKey(renameTarget.value.storage_id, p));
      starredSet.value.add(starKey(renameTarget.value.storage_id, newPath));
    }
    ElMessage.success('重命名成功');
    renameDialog.value = false;
    afterFileOp();
  } catch (e: any) {
    ElMessage.error(e.message || '重命名失败');
  }
}

/* ---------- 移动 ---------- */
const moveDialog = ref(false);
const moveTarget = ref<any>(null);
const moveDest = ref('/');
const dirPickerLoading = ref(false);
const dirPickerEntries = ref<any[]>([]);
const dirPickerCrumbs = computed(() => {
  const out = [{ name: '根目录', path: '/' }];
  if (moveDest.value !== '/') {
    const segs = moveDest.value.split('/').filter(Boolean);
    let acc = '';
    for (const s of segs) { acc += '/' + s; out.push({ name: s, path: acc }); }
  }
  return out;
});
async function loadDirPicker(dirPath?: string) {
  const p = dirPath || moveDest.value;
  dirPickerLoading.value = true;
  try {
    const r = await api(`/files?storageId=${moveTarget.value.storage_id}&path=${encodeURIComponent(p)}&sort=name&order=asc`);
    dirPickerEntries.value = r.entries.filter((e: any) => e.isDir);
  } catch (e: any) {
    ElMessage.error(e.message || '加载目录失败');
  } finally {
    dirPickerLoading.value = false;
  }
}
function dirPickerEnter(dirPath: string) { moveDest.value = dirPath; loadDirPicker(dirPath); }
function dirPickerGoTo(idx: number) {
  const c = dirPickerCrumbs.value[idx];
  if (c) { moveDest.value = c.path; loadDirPicker(c.path); }
}
function openMove(fav: any) {
  moveTarget.value = fav;
  moveDest.value = '/';
  moveDialog.value = true;
  loadDirPicker('/');
}
async function doMove() {
  const dest = moveDest.value.trim() || '/';
  const destDir = dest.endsWith('/') ? dest : dest + '/';
  const destPath = (destDir === '/' ? '' : destDir) + fileName(moveTarget.value.path);
  try {
    await api('/files/move', { method: 'POST', body: JSON.stringify({ storageId: moveTarget.value.storage_id, path: moveTarget.value.path, destPath }) });
    if (isFav(moveTarget.value.storage_id, moveTarget.value.path)) {
      await api(`/favorites?storageId=${moveTarget.value.storage_id}&path=${encodeURIComponent(moveTarget.value.path)}`, { method: 'DELETE' });
      await api('/favorites', { method: 'POST', body: JSON.stringify({ storageId: moveTarget.value.storage_id, path: destPath }) });
      starredSet.value.delete(starKey(moveTarget.value.storage_id, moveTarget.value.path));
      starredSet.value.add(starKey(moveTarget.value.storage_id, destPath));
    }
    ElMessage.success('移动成功');
    moveDialog.value = false;
    afterFileOp();
  } catch (e: any) {
    ElMessage.error(e.message || '移动失败');
  }
}

/* ---------- 分享 ---------- */
const shareDialog = ref(false);
const shareTarget = ref<any>(null);
const shareForm = ref({ name: '', password: '', expireDays: 0, maxDownloads: 0 });
const shareResult = ref<{ url: string; token: string } | null>(null);
const shareBusy = ref(false);
function openShare(fav: any) {
  shareTarget.value = fav;
  shareForm.value = { name: fileName(fav.path), password: '', expireDays: 0, maxDownloads: 0 };
  shareResult.value = null;
  shareDialog.value = true;
}
async function doShare() {
  if (!shareTarget.value) return;
  shareBusy.value = true;
  try {
    const body: any = { storageId: shareTarget.value.storage_id, path: shareTarget.value.path, name: shareForm.value.name || undefined };
    if (shareForm.value.password) body.password = shareForm.value.password;
    if (shareForm.value.expireDays > 0) {
      body.expiresAt = new Date(Date.now() + shareForm.value.expireDays * 86400000).toISOString().replace('T', ' ').slice(0, 19);
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
    () => ElMessage.warning('请手动复制：' + shareResult.value!.url)
  );
}

/* ---------- 删除 ---------- */
async function doDelete(fav: any) {
  try {
    await ElMessageBox.confirm(`确定删除「${fileName(fav.path)}」吗？删除后可在回收站恢复。`, '删除确认', { type: 'warning' });
  } catch { return; }
  try {
    await api('/files/delete', { method: 'POST', body: JSON.stringify({ storageId: fav.storage_id, path: fav.path }) });
    if (isFav(fav.storage_id, fav.path)) {
      await api(`/favorites?storageId=${fav.storage_id}&path=${encodeURIComponent(fav.path)}`, { method: 'DELETE' });
      starredSet.value.delete(starKey(fav.storage_id, fav.path));
    }
    ElMessage.success('已删除到回收站');
    afterFileOp();
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败');
  }
}

/* ---------- 取消收藏（收藏列表中） ---------- */
async function unstar(fav: any) {
  try {
    await api(`/favorites?storageId=${fav.storage_id}&path=${encodeURIComponent(fav.path)}`, { method: 'DELETE' });
    starredSet.value.delete(starKey(fav.storage_id, fav.path));
    ElMessage.success('已取消收藏');
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '取消收藏失败');
  }
}

/** 文件操作后刷新当前视图 */
function afterFileOp() {
  if (view.value === 'browse') loadBrowse();
  load();
}

/* ---------- 更多菜单命令分发 ---------- */
function handleMoreCmd(cmd: string, row: any) {
  switch (cmd) {
    case 'rename': openRename(row); break;
    case 'move': openMove(row); break;
    case 'share': openShare(row); break;
    case 'unstar': unstar(row); break;
  }
}

/** 浏览视图更多菜单（收藏是切换，不是取消） */
function handleBrowseMoreCmd(cmd: string, row: any) {
  switch (cmd) {
    case 'toggleStar': toggleStar(browseStorageId.value, row.path, row.name); break;
    case 'rename': openRename(row); break;
    case 'move': openMove(row); break;
    case 'share': openShare(row); break;
  }
}

/* ---------- 前往文件（次要：跳转到文件管理定位目录） ---------- */
function goToFile(fav: any) {
  router.push({ path: '/', query: { storage: fav.storage_id, path: fileDir(fav.path) } });
}

onMounted(async () => { await load(); });
onUnmounted(() => abortThumbs?.());
</script>

<template>
  <div class="fav-page">
    <PageHeader
      icon="StarFilled"
      title="我的收藏"
      :subtitle="favorites.length ? `共 ${favorites.length} 项 · 在文件管理中点星标即可收藏` : '在文件管理中点星标即可收藏'"
    >
      <template #actions>
        <el-button size="small" @click="view === 'browse' ? loadBrowse() : load()" :loading="loading || browseLoading">
          <el-icon><Refresh /></el-icon>&nbsp;刷新
        </el-button>
      </template>
    </PageHeader>

    <!-- 收藏列表视图 -->
    <template v-if="view === 'list'">
      <!-- 类型筛选条 -->
      <div v-if="favorites.length" class="filter-chips fav-filters page-enter">
        <span
          v-for="f in favFilters"
          :key="f.key"
          class="chip"
          :class="{ active: favFilter === f.key }"
          @click="favFilter = f.key as any"
        >
          {{ f.label }}
          <span class="chip-count">{{ f.count }}</span>
        </span>
      </div>
      <!-- 骨架屏：仅在加载超过 150ms 时显示 -->
      <template v-if="showSkeleton">
        <div class="skeleton-table glass">
          <div v-for="i in 6" :key="'sk-' + i" class="skeleton-row">
            <div class="skeleton-icon"></div>
            <div class="skeleton-name"></div>
            <div class="skeleton-meta"></div>
            <div class="skeleton-actions"></div>
          </div>
        </div>
      </template>
      <template v-else>
      <EmptyState
        v-if="hasLoaded && !favorites.length"
        title="还没有收藏"
        description="去文件管理里给常用文件或文件夹点星标，它们会出现在这里"
      />
      <EmptyState
        v-else-if="hasLoaded && favorites.length && !filteredFavorites.length"
        title="当前筛选无结果"
        description="换个类型筛选试试"
      />
      <el-table v-else-if="filteredFavorites.length" :data="filteredFavorites" v-loading="loading" class="fav-table fade-in">
        <el-table-column label="名称" min-width="220">
          <template #default="{ row }">
            <div class="fav-name-cell" :class="{ clickable: row.isDir }" @click="row.isDir && openFolder(row)">
              <img v-if="thumbs[row.path]" :src="thumbs[row.path]" class="fav-thumb" :alt="fileName(row.path)" loading="lazy" />
              <el-icon v-else :size="20" :color="row.isDir ? '#e8b04b' : (isImage(fileName(row.path)) ? '#ec4899' : '#409eff')">
                <FolderOpened v-if="row.isDir" />
                <Picture v-else-if="isImage(fileName(row.path))" />
                <VideoPlay v-else-if="isVideo(fileName(row.path))" />
                <Headset v-else-if="isAudio(fileName(row.path))" />
                <Document v-else />
              </el-icon>
              <span class="fav-name" :title="row.path">{{ fileName(row.path) }}</span>
              <el-tag v-if="!row.valid" type="warning" size="small">已失效</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="路径" min-width="200">
          <template #default="{ row }">{{ row.path }}</template>
        </el-table-column>
        <el-table-column label="大小" width="100">
          <template #default="{ row }">{{ row.isDir ? '文件夹' : fmtSize(row.size) }}</template>
        </el-table-column>
        <el-table-column label="修改时间" width="160">
          <template #default="{ row }">{{ formatTime(row.mtime) }}</template>
        </el-table-column>
        <el-table-column label="操作" min-width="320">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button v-if="row.isDir" link size="small" @click="openRename(row)">重命名</el-button>
              <el-button v-if="row.isDir" link type="primary" size="small" @click="openFolder(row)">打开</el-button>
              <el-button v-else-if="isPreviewable(fileName(row.path))" link type="primary" size="small" @click="openPreview(row)">预览</el-button>
              <el-button link type="primary" size="small" :disabled="row.isDir" @click="download(row)">下载</el-button>
              <el-button link type="danger" size="small" @click="doDelete(row)">删除</el-button>
              <el-dropdown trigger="click" @command="(cmd: string) => handleMoreCmd(cmd, row)">
                <el-button link size="small" class="more-btn"><el-icon><MoreFilled /></el-icon></el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="!row.isDir" command="rename">重命名</el-dropdown-item>
                    <el-dropdown-item command="move">移动</el-dropdown-item>
                    <el-dropdown-item command="share">分享</el-dropdown-item>
                    <el-dropdown-item command="unstar" divided>取消收藏</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
      </template>
    </template>

    <!-- 文件夹浏览视图 -->
    <template v-else>
      <div class="browse-bar glass">
        <el-button size="small" @click="backToList"><el-icon><ArrowLeft /></el-icon>&nbsp;返回收藏列表</el-button>
        <el-breadcrumb separator="/" class="browse-crumbs">
          <el-breadcrumb-item v-for="(c, i) in browseCrumbs" :key="c.path" @click="browseTo(c.path)" style="cursor: pointer">{{ c.name }}</el-breadcrumb-item>
        </el-breadcrumb>
      </div>
      <el-table :data="browseEntries" v-loading="browseLoading" class="fav-table">
        <el-table-column label="名称" min-width="240">
          <template #default="{ row }">
            <div class="fav-name-cell" :class="{ clickable: row.isDir }" @click="row.isDir && browseTo(row.path)">
              <img v-if="!row.isDir && thumbs[row.path]" :src="thumbs[row.path]" class="fav-thumb" :alt="row.name" loading="lazy" />
              <el-icon v-else :size="20" :color="row.isDir ? '#e8b04b' : (isImage(row.name) ? '#ec4899' : '#409eff')">
                <FolderOpened v-if="row.isDir" />
                <Picture v-else-if="isImage(row.name)" />
                <VideoPlay v-else-if="isVideo(row.name)" />
                <Headset v-else-if="isAudio(row.name)" />
                <Document v-else />
              </el-icon>
              <span class="fav-name">{{ row.name }}</span>
              <el-icon v-if="isFav(browseStorageId, row.path)" :size="14" color="#f5a623"><StarFilled /></el-icon>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="100">
          <template #default="{ row }">{{ row.isDir ? '文件夹' : fmtSize(row.size) }}</template>
        </el-table-column>
        <el-table-column label="修改时间" width="160">
          <template #default="{ row }">{{ formatTime(row.mtime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="300">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button v-if="row.isDir" link size="small" @click="openRename(row)">重命名</el-button>
              <el-button v-if="!row.isDir && isPreviewable(row.name)" link type="primary" size="small" @click="openPreview(row)">预览</el-button>
              <el-button link type="primary" size="small" :disabled="row.isDir" @click="download(row)">下载</el-button>
              <el-button link type="danger" size="small" @click="doDelete(row)">删除</el-button>
              <el-dropdown trigger="click" @command="(cmd: string) => handleBrowseMoreCmd(cmd, row)">
                <el-button link size="small" class="more-btn"><el-icon><MoreFilled /></el-icon></el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="!row.isDir" command="rename">重命名</el-dropdown-item>
                    <el-dropdown-item command="toggleStar" divided>{{ isFav(browseStorageId, row.path) ? '取消收藏' : '收藏' }}</el-dropdown-item>
                    <el-dropdown-item command="move">移动</el-dropdown-item>
                    <el-dropdown-item command="share">分享</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!browseLoading && !browseEntries.length" class="browse-empty">
        <el-icon :size="36"><FolderOpened /></el-icon>
        <span>此文件夹为空</span>
      </div>
    </template>

    <!-- 预览对话框 -->
    <el-dialog v-model="previewDialog" :title="previewName" width="800px" :before-close="closePreview">
      <div v-loading="previewLoading" class="fav-preview">
        <img v-if="previewKind === 'image' && previewUrl" :src="previewUrl" class="pv-img" />
        <video v-if="previewKind === 'video' && previewUrl" :src="previewUrl" controls class="pv-video" />
        <audio v-if="previewKind === 'audio' && previewUrl" :src="previewUrl" controls style="width: 100%" />
        <iframe v-if="previewKind === 'pdf' && previewUrl" :src="previewUrl" class="pv-pdf" sandbox="allow-scripts" />
        <pre v-if="previewKind === 'code'" class="pv-code">{{ previewCode }}</pre>
      </div>
    </el-dialog>

    <!-- 重命名对话框 -->
    <el-dialog v-model="renameDialog" title="重命名" width="440px">
      <el-input v-model="renameValue" placeholder="新名称" @keyup.enter="doRename" />
      <template #footer>
        <el-button @click="renameDialog = false">取消</el-button>
        <el-button type="primary" @click="doRename">确定</el-button>
      </template>
    </el-dialog>

    <!-- 移动对话框（目录选择器） -->
    <el-dialog v-model="moveDialog" title="移动到" width="500px">
      <div class="move-dest">当前目录：{{ moveDest }}</div>
      <div class="move-crumbs">
        <el-breadcrumb separator="/">
          <el-breadcrumb-item v-for="(c, i) in dirPickerCrumbs" :key="c.path" @click="dirPickerGoTo(i)" style="cursor: pointer">{{ c.name }}</el-breadcrumb-item>
        </el-breadcrumb>
      </div>
      <div class="move-dirs" v-loading="dirPickerLoading">
        <div v-for="d in dirPickerEntries" :key="d.path" class="move-dir-item" @click="dirPickerEnter(d.path)">
          <el-icon><FolderOpened /></el-icon> {{ d.name }}
        </div>
        <div v-if="!dirPickerLoading && !dirPickerEntries.length" class="move-dir-empty">没有子文件夹</div>
      </div>
      <template #footer>
        <el-button @click="moveDialog = false">取消</el-button>
        <el-button type="primary" @click="doMove">移动到此处</el-button>
      </template>
    </el-dialog>

    <!-- 分享对话框 -->
    <el-dialog v-model="shareDialog" title="创建分享" width="480px">
      <el-form label-width="90px">
        <el-form-item label="名称"><el-input v-model="shareForm.name" /></el-form-item>
        <el-form-item label="提取密码"><el-input v-model="shareForm.password" placeholder="留空则无密码" /></el-form-item>
        <el-form-item label="有效期(天)"><el-input-number v-model="shareForm.expireDays" :min="0" :max="365" /></el-form-item>
        <el-form-item label="下载次数"><el-input-number v-model="shareForm.maxDownloads" :min="0" :max="1000" /></el-form-item>
      </el-form>
      <div v-if="shareResult" class="share-result">
        <div class="share-url">{{ shareResult.url }}</div>
        <el-button size="small" @click="copyShareUrl">复制链接</el-button>
      </div>
      <template #footer>
        <el-button @click="shareDialog = false">关闭</el-button>
        <el-button type="primary" :loading="shareBusy" @click="doShare">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.fav-page { padding: 20px; }
.fav-filters { margin-bottom: 14px; }

/* ---------- 骨架屏 + 淡入动画 ---------- */
.skeleton-table {
  border-radius: 16px;
  padding: 16px;
}
.skeleton-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.skeleton-row:last-child { border-bottom: none; }
.skeleton-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: linear-gradient(90deg, var(--glass-bg) 25%, rgba(255,255,255,0.15) 50%, var(--glass-bg) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
}
.skeleton-name {
  flex: 1;
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--glass-bg) 25%, rgba(255,255,255,0.15) 50%, var(--glass-bg) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
}
.skeleton-meta {
  width: 80px;
  height: 12px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--glass-bg) 25%, rgba(255,255,255,0.12) 50%, var(--glass-bg) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
}
.skeleton-actions {
  width: 120px;
  height: 12px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--glass-bg) 25%, rgba(255,255,255,0.1) 50%, var(--glass-bg) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
}
@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.fade-in {
  animation: fade-in-up 0.35s ease-out both;
}
@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  margin-bottom: 20px;
}
.page-header h2 { margin: 0; font-size: 20px; }
.fav-toolbar { display: flex; align-items: center; gap: 12px; }
.fav-count { font-size: 13px; color: var(--text-secondary); }
.fav-name-cell { display: flex; align-items: center; gap: 8px; }
.fav-thumb {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--glass-border);
}
.fav-name-cell.clickable { cursor: pointer; }
.fav-name-cell.clickable:hover .fav-name { color: var(--el-color-primary, #409eff); }
.fav-name {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-align: left;
}
.row-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.row-actions .el-button:not(.more-btn) { width: 72px; }
.more-btn { padding: 4px; }
.browse-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.browse-crumbs { flex: 1; }
.browse-empty { text-align: center; color: var(--text-secondary); padding: 48px; font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.browse-empty .el-icon { opacity: 0.5; }
.fav-preview { min-height: 200px; display: flex; align-items: center; justify-content: center; }
.pv-img { max-width: 100%; max-height: 70vh; object-fit: contain; }
.pv-video { max-width: 100%; max-height: 70vh; }
.pv-pdf { width: 100%; height: 70vh; border: 0; }
.pv-code { width: 100%; height: 70vh; overflow: auto; background: rgba(0,0,0,0.4); padding: 12px; font-size: 13px; }
.move-dest { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
.move-crumbs { margin-bottom: 12px; }
.move-dirs { max-height: 300px; overflow-y: auto; border: 1px solid var(--border-color, rgba(255,255,255,0.1)); border-radius: 8px; padding: 8px; }
.move-dir-item { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 14px; }
.move-dir-item:hover { background: rgba(255,255,255,0.08); }
.move-dir-empty { text-align: center; color: var(--text-secondary); padding: 16px; font-size: 13px; }
.share-result { margin-top: 12px; display: flex; align-items: center; gap: 8px; }
.share-url { font-size: 12px; color: var(--text-secondary); word-break: break-all; flex: 1; }
</style>
