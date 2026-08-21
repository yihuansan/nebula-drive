<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, fmtSize, fmtTime } from '../api';
import { useTheme, THEMES, type ThemeKey } from '../useTheme';

const storages = ref<any[]>([]);
const storageId = ref(0);
const path = ref('/');
const entries = ref<any[]>([]);
const loading = ref(false);
const selected = ref<any[]>([]);
const tableRef = ref();
const view = ref<'grid' | 'list' | 'photo'>('grid');
const multiSelectMode = ref(false);

// 布局类型（根据主题决定）
const { theme } = useTheme();
const layoutType = computed(() => {
  const t = THEMES[theme.value as ThemeKey];
  return t?.layout || 'sidebar';
});

// 统计卡片配置
const statCards = computed(() => [
  { id: 'folders', icon: 'Folder', iconClass: 'si-blue', label: '文件夹', value: entries.value.filter(e => e.isDir).length },
  { id: 'files', icon: 'Document', iconClass: 'si-green', label: '文件', value: entries.value.filter(e => !e.isDir).length },
  { id: 'size', icon: 'DataLine', iconClass: 'si-purple', label: '总大小', value: fmtSize(entries.value.reduce((sum, e) => sum + (e.size || 0), 0)) },
]);

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

const parent = computed(() =>
  path.value === '/' ? null : path.value.replace(/\/[^/]*\/?$/, '') || '/'
);
const crumbs = computed(() => {
  const out = [{ name: '根目录', path: '/' }];
  if (path.value !== '/') {
    const segs = path.value.split('/').filter(Boolean);
    let acc = '';
    for (const s of segs) {
      acc += '/' + s;
      out.push({ name: s, path: acc });
    }
  }
  return out;
});

async function loadStorages() {
  try {
    const r = await api('/storages');
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

/** 更多菜单命令分发 */
function handleMoreCmd(cmd: string, row: any) {
  switch (cmd) {
    case 'share': openShare(row); break;
    case 'rename': openRename(row); break;
    case 'props': openProps(row); break;
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
  previewPath.value = row.path;  // 保存完整路径
  previewSize.value = row.size || 0;
  previewKind.value = kind;
  previewDialog.value = true;
  previewLoading.value = true;
  previewUrl.value = '';
  previewCode.value = '';
  // 重置图片状态
  imgScale.value = 1;
  imgRotation.value = 0;
  imgFit.value = 'fit-width';
  isFullscreen.value = false;
  imgInfo.value = null;
  try {
    const token = localStorage.getItem('nebula_token') || '';
    const base = `/api/v1/files/preview?storageId=${storageId.value}&path=${encodeURIComponent(row.path)}`;
    if (previewKind.value === 'image' || previewKind.value === 'pdf' || previewKind.value === 'code') {
      // 图片 / PDF / 代码：带 Bearer 头拉取 blob
      const res = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('预览加载失败');
      if (previewKind.value === 'code') {
        // 代码文件：读取文本内容
        const text = await res.text();
        previewCode.value = text.length > 50000 ? text.slice(0, 50000) + '\n... (内容过长，仅显示前 50KB)' : text;
        previewUrl.value = 'code-loaded';
      } else {
        const blob = await res.blob();
        previewUrl.value = URL.createObjectURL(blob);
        // 加载图片信息
        if (previewKind.value === 'image') {
          loadImgInfo(previewUrl.value);
        }
      }
    } else {
      // 视频 / 音频：用 Bearer 头获取 blob（认证可靠）
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
  await loadStorages();
  await loadAllTags();
  await loadFavorites();
  // 深链：从收藏页等跳转携带 storage/path 参数时，定位到指定位置
  const qStorage = route.query.storage ? Number(route.query.storage) : null;
  const qPath = route.query.path ? String(route.query.path) : null;
  if (qStorage && storages.value.some((s: any) => s.id === qStorage)) storageId.value = qStorage;
  if (qPath) path.value = qPath;
  if (storageId.value) load();
});
</script>

<template>
  <div class="files-page" :class="{
    'files-dashboard': layoutType === 'dashboard',
    'files-bento': layoutType === 'bento',
    'files-command': layoutType === 'command',
    'files-topnav': layoutType === 'topnav'
  }">
    <!-- 仪表盘统计卡片 -->
    <div v-if="layoutType === 'dashboard'" class="stats-bar">
      <div
        v-for="card in statCards"
        :key="card.id"
        class="stat-card glass"
      >
        <div class="stat-icon" :class="card.iconClass">
          <el-icon><component :is="card.icon" /></el-icon>
        </div>
        <div class="stat-info">
          <div class="stat-value">{{ card.value }}</div>
          <div class="stat-label">{{ card.label }}</div>
        </div>
      </div>
    </div>
    <div class="files-glass glass">
      <div class="toolbar">
        <el-select v-model="storageId" size="default" class="storage-select" @change="onStorageChange">
          <el-option v-for="s in storages" :key="s.id" :label="s.name" :value="s.id" />
        </el-select>
        <el-breadcrumb separator="/" class="crumbs">
          <el-breadcrumb-item v-for="c in crumbs" :key="c.path">
            <a class="crumb" @click="goCrumb(c.path)">{{ c.name }}</a>
          </el-breadcrumb-item>
        </el-breadcrumb>
        <div class="spacer" />
        <!-- 排序：字段 + 升降序 -->
        <el-select v-model="sortKey" size="small" class="sort-select" @change="load">
          <el-option label="按名称" value="name" />
          <el-option label="按大小" value="size" />
          <el-option label="按时间" value="mtime" />
        </el-select>
        <button class="sort-order-btn glass-btn" :title="sortOrder === 'asc' ? '当前升序，点击切换降序' : '当前降序，点击切换升序'" @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'; load()">
          <el-icon><ArrowUp v-if="sortOrder === 'asc'" /><ArrowDown v-else /></el-icon>
        </button>
        <!-- 标签筛选 -->
        <el-select v-if="activeTagFilter" v-model="activeTagFilter" size="small" class="tag-select" clearable placeholder="按标签筛选" @change="load">
          <el-option v-for="t in allTags" :key="t" :label="t" :value="t" />
        </el-select>
        <el-button v-if="!activeTagFilter" size="small" @click="tagFilterDialog = true"><el-icon><PriceTag /></el-icon>&nbsp;标签筛选</el-button>
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
        <el-button size="small" @click="load"><el-icon><Refresh /></el-icon>&nbsp;刷新</el-button>
        <el-button size="small" @click="searchDialog = true"><el-icon><Search /></el-icon>&nbsp;搜索</el-button>
        <el-button size="small" @click="mkdirDialog = true; mkdirName = ''"><el-icon><FolderAdd /></el-icon>&nbsp;新建文件夹</el-button>
        <el-button size="small" type="primary" @click="pickFiles"><el-icon><Upload /></el-icon>&nbsp;上传文件</el-button>
        <el-button
          size="small"
          :type="multiSelectMode ? 'warning' : 'default'"
          @click="multiSelectMode = !multiSelectMode; if (!multiSelectMode) selected = []"
        >
          <el-icon><Check /></el-icon>&nbsp;{{ multiSelectMode ? '退出多选' : '多选模式' }}
        </el-button>
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

      <!-- 选中信息栏（仅多选模式） -->
      <div v-if="multiSelectMode && selected.length" class="selection-bar">
        <span>已选择 <b>{{ selected.length }}</b> 项</span>
        <el-button link size="small" @click="clearSelection">取消选择</el-button>
      </div>

      <!-- 网格视图（毛玻璃卡片 + 悬浮微动画） -->
      <div v-if="view === 'grid'" v-loading="loading" class="file-grid">
        <div
          v-for="row in entries"
          :key="row.path"
          class="file-card glass-card"
          :class="{ selected: isSelected(row) }"
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
            <!-- 收藏星标（文件/文件夹均可） -->
            <el-tooltip :content="isStarred(row) ? '取消收藏' : '收藏'" placement="top" :show-after="300">
              <el-button link @click="toggleStar(row)"><el-icon><StarFilled v-if="isStarred(row)" /><Star v-else /></el-icon></el-button>
            </el-tooltip>
            <!-- 文件夹：保持原有操作 -->
            <template v-if="row.isDir">
              <el-tooltip content="分享" placement="top" :show-after="300">
                <el-button link @click="openShare(row)"><el-icon><Share /></el-icon></el-button>
              </el-tooltip>
              <el-tooltip content="重命名" placement="top" :show-after="300">
                <el-button link @click="openRename(row)"><el-icon><EditPen /></el-icon></el-button>
              </el-tooltip>
              <el-tooltip content="删除" placement="top" :show-after="300">
                <el-button link type="danger" @click="doDelete(row)"><el-icon><Delete /></el-icon></el-button>
              </el-tooltip>
            </template>
            <!-- 文件：核心操作 + 更多菜单 -->
            <template v-else>
              <el-tooltip v-if="isPreviewable(row.name)" content="预览" placement="top" :show-after="300">
                <el-button link @click="openPreview(row)"><el-icon><View /></el-icon></el-button>
              </el-tooltip>
              <el-tooltip content="下载" placement="top" :show-after="300">
                <el-button link @click="download(row)"><el-icon><Download /></el-icon></el-button>
              </el-tooltip>
              <el-tooltip v-if="isArchive(row.name)" content="压缩包内容" placement="top" :show-after="300">
                <el-button link @click="openArchivePreview(row)"><el-icon><Files /></el-icon></el-button>
              </el-tooltip>
              <el-tooltip v-if="row.name.toLowerCase().endsWith('.zip')" content="解压到当前目录" placement="top" :show-after="300">
                <el-button link @click="doDecompress(row)"><el-icon><Box /></el-icon></el-button>
              </el-tooltip>
              <el-tooltip content="删除" placement="top" :show-after="300">
                <el-button link type="danger" @click="doDelete(row)"><el-icon><Delete /></el-icon></el-button>
              </el-tooltip>
              <el-dropdown trigger="click" @command="(cmd: string) => handleMoreCmd(cmd, row)">
                <el-button link class="more-btn"><el-icon><MoreFilled /></el-icon></el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="share"><el-icon><Share /></el-icon>分享</el-dropdown-item>
                    <el-dropdown-item command="rename"><el-icon><EditPen /></el-icon>重命名</el-dropdown-item>
                    <el-dropdown-item command="props"><el-icon><InfoFilled /></el-icon>属性</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
          </div>
        </div>
        <div v-if="!loading && !entries.length" class="empty">此文件夹为空</div>
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
      >
        <el-table-column v-if="multiSelectMode" type="selection" width="40" />
        <el-table-column label="名称" min-width="300">
          <template #default="{ row }">
            <el-icon class="f-icon" :color="fileType(row.name, row.isDir).color">
              <component :is="fileType(row.name, row.isDir).icon" />
            </el-icon>
            <span class="f-name" :class="{ dir: row.isDir }" @click.stop="openDir(row)">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="120">
          <template #default="{ row }">{{ row.isDir ? '-' : fmtSize(row.size) }}</template>
        </el-table-column>
        <el-table-column label="修改时间" width="180">
          <template #default="{ row }">{{ fmtTime(row.mtime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="330">
          <template #default="{ row }">
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
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
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
        <div v-if="!loading && !photoEntries.length" class="empty">此文件夹没有图片文件</div>
      </div>
    </div>

    <!-- 新建文件夹 -->
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
  min-height: calc(100vh - 100px);
  position: relative;
  z-index: 1;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.storage-select {
  width: 200px;
}
.spacer {
  flex: 1;
}
.crumbs {
  flex: 1;
  min-width: 120px;
}
.crumb {
  color: var(--accent);
  cursor: pointer;
}
.crumb:hover {
  filter: brightness(1.1);
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

/* 网格视图 */
.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 14px;
}
.file-card {
  border-radius: 18px;
  padding: 18px 14px;
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
.file-card:hover .fc-actions {
  opacity: 1;
}
.row-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
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

/* ---------- 便当盒布局：混合大小卡片 ---------- */
.files-bento .file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}
.files-bento .file-card {
  border-radius: 20px;
  padding: 20px;
}
/* 每第 5 个卡片跨 2 列 */
.files-bento .file-card:nth-child(5n+1) {
  grid-column: span 2;
}
/* 每第 7 个卡片跨 2 行 */
.files-bento .file-card:nth-child(7n+3) {
  grid-row: span 2;
}

/* ---------- 命令式布局：极简列表 ---------- */
.files-command .toolbar {
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
  font-family: inherit;
}
.files-command .fc-meta {
  font-size: 12px;
  color: var(--text-secondary);
}
.files-command .fc-actions {
  display: none;
}
.files-command::before {
  content: '⌘ 搜索文件...';
  display: block;
  padding: 12px 16px;
  font-size: 16px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--glass-border);
  margin-bottom: 8px;
}

/* ---------- 顶部导航布局：更紧凑 ---------- */
.files-topnav .files-glass {
  border-radius: 0;
  margin: 0;
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
</style>
