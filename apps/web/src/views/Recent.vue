<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ZoomOut, ZoomIn, Refresh, RefreshLeft, RefreshRight, FullScreen, Loading, Delete } from '@element-plus/icons-vue';

const router = useRouter();
const loading = ref(false);
const hasLoaded = ref(false); // 是否已完成过首次加载
const entries = ref<any[]>([]);
const storageId = ref<number | null>(null);
const storages = ref<any[]>([]);
const filterType = ref<'all' | 'files' | 'folders'>('all');

onMounted(async () => {
  try {
    const r = await api('/storages');
    storages.value = r.storages;
    if (r.storages.length) storageId.value = r.storages[0].id;
    await load();
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败');
    hasLoaded.value = true;
  }
});

async function load() {
  if (!storageId.value) return;
  loading.value = true;
  try {
    const r = await api(`/files/recent?storageId=${storageId.value}&limit=100`);
    entries.value = r.entries;
  } catch (e: any) {
    ElMessage.error(e.message || '加载最近文件失败');
  } finally {
    loading.value = false;
    hasLoaded.value = true;
  }
}

/** 过滤后的条目 */
const filteredEntries = computed(() => {
  if (filterType.value === 'all') return entries.value;
  if (filterType.value === 'folders') return entries.value.filter(e => e.isDir);
  return entries.value.filter(e => !e.isDir);
});

/** 统计信息 */
const stats = computed(() => {
  const files = entries.value.filter(e => !e.isDir);
  const folders = entries.value.filter(e => e.isDir);
  return { total: entries.value.length, files: files.length, folders: folders.length };
});

/** 获取文件类型图标和颜色 */
function getFileType(row: any) {
  const name = row.name.toLowerCase();
  if (row.isDir) return { icon: 'Folder', color: '#409eff', label: '文件夹' };
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|ico)$/i.test(name)) return { icon: 'Picture', color: '#67c23a', label: '图片' };
  if (/\.(mp4|mkv|mov|webm|avi|flv|wmv|m4v|ts)$/i.test(name)) return { icon: 'VideoCamera', color: '#e6a23c', label: '视频' };
  if (/\.(mp3|wav|flac|ogg|aac|m4a)$/i.test(name)) return { icon: 'Headset', color: '#f56c6c', label: '音频' };
  if (/\.pdf$/i.test(name)) return { icon: 'Document', color: '#909399', label: 'PDF' };
  if (/\.(txt|md|doc|docx|xls|xlsx|ppt|pptx)$/i.test(name)) return { icon: 'Document', color: '#409eff', label: '文档' };
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return { icon: 'Files', color: '#b37feb', label: '压缩包' };
  return { icon: 'Document', color: '#909399', label: '文件' };
}

/** 点击文件夹：跳转到文件页 */
function openFolder(row: any) {
  router.push({ path: '/files', query: { storageId: storageId.value, path: row.path } });
}

/** 预览弹窗状态 */
const previewDialog = ref(false);
const previewName = ref('');
const previewSize = ref(0);
const previewKind = ref<'image' | 'video' | 'audio' | 'pdf'>('image');
const previewLoading = ref(false);
const previewUrl = ref('');
const imgScale = ref(1);
const imgRotation = ref(0);
const imgFit = ref<'original' | 'fit-width' | 'fit-height' | 'fullscreen'>('fit-width');
const imgInfo = ref<{ width: number; height: number } | null>(null);
const isFullscreen = ref(false);

/** 点击文件：打开预览弹窗（图片/视频/音频/PDF）或下载（其他） */
function openFile(row: any) {
  const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg|ico)$/i.test(row.name);
  const isVideo = /\.(mp4|mkv|mov|webm|avi|flv|wmv|m4v|ts)$/i.test(row.name);
  const isAudio = /\.(mp3|wav|flac|ogg|aac|m4a)$/i.test(row.name);
  const isPdf = /\.pdf$/i.test(row.name);

  if (isImage || isVideo || isAudio || isPdf) {
    openPreview(row);
  } else {
    const token = localStorage.getItem('nebula_token') || '';
    const base = `/api/v1/files/download?storageId=${storageId.value}&path=${encodeURIComponent(row.path)}`;
    const url = `${base}&token=${encodeURIComponent(token)}`;
    window.open(url, '_blank');
  }
}

async function openPreview(row: any) {
  const name = row.name;
  const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg|ico)$/i.test(name);
  const isVideo = /\.(mp4|mkv|mov|webm|avi|flv|wmv|m4v|ts)$/i.test(name);
  const isAudio = /\.(mp3|wav|flac|ogg|aac|m4a)$/i.test(name);
  const isPdf = /\.pdf$/i.test(name);

  previewName.value = name;
  previewSize.value = row.size || 0;
  previewKind.value = isImage ? 'image' : isVideo ? 'video' : isAudio ? 'audio' : 'pdf';
  previewUrl.value = '';
  imgScale.value = 1;
  imgRotation.value = 0;
  imgFit.value = 'fit-width';
  imgInfo.value = null;
  isFullscreen.value = false;
  previewDialog.value = true;
  previewLoading.value = true;

  try {
    const token = localStorage.getItem('nebula_token') || '';
    const resp = await fetch(`/api/v1/files/preview?storageId=${storageId.value}&path=${encodeURIComponent(row.path)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    previewUrl.value = URL.createObjectURL(blob);

    if (previewKind.value === 'image') {
      const img = new Image();
      img.onload = () => {
        imgInfo.value = { width: img.naturalWidth, height: img.naturalHeight };
      };
      img.src = previewUrl.value;
    }
  } catch (e: any) {
    ElMessage.error(e.message || '预览失败');
    previewDialog.value = false;
  } finally {
    previewLoading.value = false;
  }
}

function closePreview() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = '';
  }
  previewDialog.value = false;
}

function fmtSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

function fmtTime(ts: string) {
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** 格式化访问时间（SQLite datetime('now') 存的是 UTC "YYYY-MM-DD HH:MM:SS"） */
function fmtAccessTime(ts: string) {
  if (!ts) return '';
  const iso = ts.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** 清空最近记录 */
const clearing = ref(false);
async function clearAll() {
  if (!storageId.value) return;
  try {
    await ElMessageBox.confirm('确定要清空当前存储下的所有最近访问记录吗？', '清空最近记录', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    return; // 用户取消
  }
  clearing.value = true;
  try {
    await api(`/files/recent?storageId=${storageId.value}`, { method: 'DELETE' });
    entries.value = [];
    ElMessage.success('已清空最近记录');
  } catch (e: any) {
    ElMessage.error(e.message || '清空失败');
  } finally {
    clearing.value = false;
  }
}
</script>

<template>
  <div class="recent-page">
    <!-- 头部 -->
    <div class="page-header glass">
      <div class="header-left">
        <h2>
          <el-icon :size="24" class="header-icon"><Clock /></el-icon>
          最近全部
        </h2>
        <div class="stats-badges">
          <span class="stat-badge" :class="{ active: filterType === 'all' }" @click="filterType = 'all'">
            <el-icon :size="14"><Files /></el-icon>
            全部 {{ stats.total }}
          </span>
          <span class="stat-badge" :class="{ active: filterType === 'files' }" @click="filterType = 'files'">
            <el-icon :size="14"><Document /></el-icon>
            文件 {{ stats.files }}
          </span>
          <span class="stat-badge" :class="{ active: filterType === 'folders' }" @click="filterType = 'folders'">
            <el-icon :size="14"><Folder /></el-icon>
            文件夹 {{ stats.folders }}
          </span>
        </div>
      </div>
      <div class="header-right">
        <el-select v-model="storageId" size="small" @change="load" style="width: 160px">
          <el-option v-for="s in storages" :key="s.id" :label="s.name" :value="s.id" />
        </el-select>
        <el-button
          size="small"
          :disabled="!entries.length || clearing"
          :loading="clearing"
          @click="clearAll"
          class="clear-btn"
        >
          <el-icon><Delete /></el-icon>&nbsp;清空
        </el-button>
      </div>
    </div>

    <!-- 首次加载占位 -->
    <div v-if="!hasLoaded" class="recent-loading">
      <el-icon class="is-loading" :size="28"><Loading /></el-icon>
      <span>加载中…</span>
    </div>

    <!-- 文件网格 -->
    <div class="recent-grid" v-else v-loading="loading">
      <div 
        v-for="row in filteredEntries" 
        :key="row.path" 
        class="recent-card glass-card"
        @click="row.isDir ? openFolder(row) : openFile(row)"
      >
        <div class="card-icon" :style="{ background: getFileType(row).color + '15' }">
          <el-icon :size="28" :color="getFileType(row).color">
            <Folder v-if="row.isDir" />
            <Picture v-else-if="getFileType(row).label === '图片'" />
            <VideoCamera v-else-if="getFileType(row).label === '视频'" />
            <Headset v-else-if="getFileType(row).label === '音频'" />
            <Files v-else-if="getFileType(row).label === '压缩包'" />
            <Document v-else />
          </el-icon>
        </div>
        <div class="card-body">
          <div class="card-name" :title="row.name">{{ row.name }}</div>
          <div class="card-meta">
            <span class="meta-type" :style="{ color: getFileType(row).color }">{{ getFileType(row).label }}</span>
            <span v-if="!row.isDir" class="meta-size">{{ fmtSize(row.size) }}</span>
            <span class="meta-time" :title="'最近访问：' + fmtAccessTime(row.accessed_at)">
              <el-icon :size="11"><Clock /></el-icon>
              {{ fmtAccessTime(row.accessed_at) }}
            </span>
          </div>
        </div>
        <div class="card-action">
          <el-icon :size="16" class="action-icon">
            <ArrowRight />
          </el-icon>
        </div>
      </div>
      
      <!-- 空状态 -->
      <div v-if="!loading && !filteredEntries.length" class="empty-state">
        <el-icon :size="64" class="empty-icon"><Clock /></el-icon>
        <h3>暂无最近访问记录</h3>
        <p>浏览文件后，这里会显示最近访问的文件和文件夹</p>
      </div>
    </div>

    <!-- 预览弹窗（图片/视频/音频/PDF） -->
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
        <!-- 图片预览 -->
        <template v-if="previewKind === 'image' && previewUrl">
          <div class="image-preview-container">
            <img
              :src="previewUrl"
              class="preview-img"
              :style="{
                transform: `scale(${imgScale}) rotate(${imgRotation}deg)`,
                objectFit: imgFit === 'original' ? 'none' : imgFit === 'fit-width' ? 'contain' : imgFit === 'fit-height' ? 'cover' : 'contain',
              }"
              :alt="previewName"
            />
          </div>
          <!-- 图片工具栏 -->
          <div class="image-toolbar">
            <div class="toolbar-section">
              <el-button-group size="small">
                <el-button @click="imgScale = Math.max(0.1, imgScale - 0.1)" title="缩小">
                  <el-icon><ZoomOut /></el-icon>
                </el-button>
                <el-button @click="imgScale = 1; imgRotation = 0" title="重置">
                  <el-icon><Refresh /></el-icon>
                </el-button>
                <el-button @click="imgScale = Math.min(5, imgScale + 0.1)" title="放大">
                  <el-icon><ZoomIn /></el-icon>
                </el-button>
              </el-button-group>
              <span class="zoom-label">{{ Math.round(imgScale * 100) }}%</span>
            </div>
            <div class="toolbar-section">
              <el-button-group size="small">
                <el-button @click="imgRotation = (imgRotation - 90 + 360) % 360" title="左转">
                  <el-icon><RefreshLeft /></el-icon>
                </el-button>
                <el-button @click="imgRotation = (imgRotation + 90) % 360" title="右转">
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
              <el-button size="small" @click="isFullscreen = !isFullscreen" :type="isFullscreen ? 'primary' : 'default'">
                <el-icon><FullScreen /></el-icon>&nbsp;{{ isFullscreen ? '退出全屏' : '全屏' }}
              </el-button>
            </div>
          </div>
          <!-- 图片信息 -->
          <div class="image-info" v-if="imgInfo">
            <span class="info-badge">{{ imgInfo.width }} × {{ imgInfo.height }} px</span>
            <span class="info-badge">{{ previewSize ? fmtSize(previewSize) : '' }}</span>
          </div>
        </template>

        <!-- 视频预览 -->
        <template v-if="previewKind === 'video' && previewUrl">
          <video :src="previewUrl" class="preview-video" controls></video>
        </template>

        <!-- 音频预览 -->
        <template v-if="previewKind === 'audio' && previewUrl">
          <audio :src="previewUrl" class="preview-audio" controls></audio>
        </template>

        <!-- PDF 预览 -->
        <template v-if="previewKind === 'pdf' && previewUrl">
          <iframe :src="previewUrl" class="preview-pdf"></iframe>
        </template>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.recent-page { padding: 20px; }

/* 头部 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  margin-bottom: 20px;
  border-radius: 18px;
}
.header-left {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.page-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 10px;
}
.header-icon { color: var(--accent); }
.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.clear-btn {
  border-radius: 10px;
}
.stats-badges {
  display: flex;
  gap: 8px;
}
.stat-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  cursor: pointer;
  transition: all 0.2s;
}
.stat-badge:hover {
  background: var(--glass-bg-hover);
}
.stat-badge.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}

/* 文件网格 */
.recent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}
.recent-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border-radius: 18px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}
.recent-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%);
  opacity: 0;
  transition: opacity 0.25s;
}
.recent-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-hover);
}
.recent-card:hover::before {
  opacity: 1;
}

/* 图标区域 */
.card-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

/* 内容区域 */
.card-body {
  flex: 1;
  min-width: 0;
}
.card-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 6px;
}
.card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.meta-type {
  font-weight: 500;
}
.meta-size {
  color: var(--text-secondary);
}
.meta-time {
  color: var(--text-secondary);
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* 操作图标 */
.card-action {
  flex-shrink: 0;
  opacity: 0;
  transform: translateX(-8px);
  transition: all 0.25s;
}
.recent-card:hover .card-action {
  opacity: 1;
  transform: translateX(0);
}
.action-icon {
  color: var(--text-secondary);
}

/* 加载占位 */
.recent-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 100px 0;
  color: var(--text-secondary);
  font-size: 15px;
}

/* 空状态 */
.empty-state {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}
.empty-icon {
  color: var(--text-secondary);
  opacity: 0.4;
  margin-bottom: 16px;
}
.empty-state h3 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 500;
  color: var(--text);
}
.empty-state p {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
}

/* 预览弹窗 */
.preview-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.image-preview-container {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-height: 70vh;
  overflow: auto;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
  padding: 16px;
}
.preview-img {
  max-width: 100%;
  user-select: none;
}
.image-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: center;
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
  gap: 12px;
}
.info-badge {
  font-size: 12px;
  color: var(--text-secondary);
  background: rgba(0, 0, 0, 0.05);
  padding: 4px 8px;
  border-radius: 4px;
}
.preview-video {
  width: 100%;
  max-height: 70vh;
  border-radius: 8px;
}
.preview-audio {
  width: 100%;
}
.preview-pdf {
  width: 100%;
  height: 70vh;
  border: none;
  border-radius: 8px;
}
</style>
