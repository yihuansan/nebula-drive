<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api, fmtSize } from '../api';
import { ElMessage } from 'element-plus';

const router = useRouter();

const loading = ref(false);
const favorites = ref<any[]>([]);
const storages = ref<any[]>([]);
const storageMap = ref<Record<number, string>>({});

/* ---------- 文件类型图标（与文件管理一致） ---------- */
const IMG_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'];
const CODE_EXTS = ['js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'html', 'css', 'json', 'sh', 'vue', 'go', 'rs', 'xml', 'yml', 'yaml', 'md', 'txt', 'sql', 'ini', 'conf', 'env'];
function extOf(name: string) {
  return name.split('.').pop()?.toLowerCase() || '';
}
function isImage(n: string) { return IMG_EXTS.includes(extOf(n)); }
function isCode(n: string) { return CODE_EXTS.includes(extOf(n)); }
function isPdf(n: string) { return extOf(n) === 'pdf'; }
function isVideo(n: string) { return ['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'wmv', 'm4v', 'ts', '3gp'].includes(extOf(n)); }
function isAudio(n: string) { return ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'].includes(extOf(n)); }
function isPreviewable(n: string) { return isImage(n) || isVideo(n) || isAudio(n) || isPdf(n) || isCode(n); }

function fileName(path: string) { return path.split('/').pop() || path; }
function fileDir(path: string) { return path.replace(/\/[^/]*$/, '') || '/'; }

/* ---------- 预览 ---------- */
const previewDialog = ref(false);
const previewUrl = ref('');
const previewName = ref('');
const previewKind = ref<'image' | 'video' | 'audio' | 'pdf' | 'code'>('image');
const previewCode = ref('');
const previewLoading = ref(false);

async function openPreview(fav: any) {
  const n = fileName(fav.path);
  const kind = isVideo(n) ? 'video' : isAudio(n) ? 'audio' : isPdf(n) ? 'pdf' : isImage(n) ? 'image' : isCode(n) ? 'code' : null;
  if (!kind) return;
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

/* ---------- 数据加载 ---------- */
onMounted(async () => {
  try {
    const r = await api('/storages');
    storages.value = r.storages;
    for (const s of r.storages) storageMap.value[s.id] = s.name;
  } catch { /* ignore */ }
  await load();
});

async function load() {
  loading.value = true;
  try {
    const r = await api('/favorites');
    favorites.value = r.favorites;
  } catch (e: any) {
    ElMessage.error(e.message || '加载收藏失败');
  } finally {
    loading.value = false;
  }
}

/* ---------- 操作 ---------- */
async function unstar(fav: any) {
  try {
    await api(`/favorites?storageId=${fav.storage_id}&path=${encodeURIComponent(fav.path)}`, { method: 'DELETE' });
    ElMessage.success('已取消收藏');
    await load();
  } catch (e: any) {
    ElMessage.error(e.message || '取消收藏失败');
  }
}

/** 前往文件：跳转到文件管理并定位到该文件所在目录 */
function goToFile(fav: any) {
  const dir = fileDir(fav.path);
  router.push({ path: '/', query: { storage: fav.storage_id, path: dir } });
}

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
</script>

<template>
  <div class="fav-page">
    <div class="page-header glass">
      <h2>我的收藏</h2>
      <span class="fav-count" v-if="favorites.length">共 {{ favorites.length }} 项</span>
    </div>

    <div class="fav-grid" v-loading="loading">
      <div v-for="fav in favorites" :key="fav.id" class="fav-item glass-card">
        <el-icon :size="38" :color="isImage(fileName(fav.path)) ? '#ec4899' : '#409eff'">
          <Picture v-if="isImage(fileName(fav.path))" />
          <VideoPlay v-else-if="isVideo(fileName(fav.path))" />
          <Headset v-else-if="isAudio(fileName(fav.path))" />
          <Document v-else />
        </el-icon>
        <div class="fav-name" :title="fav.path">{{ fileName(fav.path) }}</div>
        <div class="fav-meta">{{ storageMap[fav.storage_id] || '存储' }} · {{ fileDir(fav.path) }}</div>
        <div class="fav-actions">
          <el-button size="small" link @click="goToFile(fav)"><el-icon><FolderOpened /></el-icon>&nbsp;前往</el-button>
          <el-button v-if="isPreviewable(fileName(fav.path))" size="small" link @click="openPreview(fav)"><el-icon><View /></el-icon>&nbsp;预览</el-button>
          <el-button v-if="!fileDir(fav.path).endsWith('/')" size="small" link @click="download(fav)"><el-icon><Download /></el-icon>&nbsp;下载</el-button>
          <el-button size="small" link type="danger" @click="unstar(fav)"><el-icon><StarFilled /></el-icon>&nbsp;取消</el-button>
        </div>
      </div>
      <div v-if="!loading && !favorites.length" class="empty">
        <p>暂无收藏文件</p>
        <p class="tip">在文件管理中点击星标图标即可收藏，方便快速访问</p>
      </div>
    </div>

    <!-- 预览对话框 -->
    <el-dialog v-model="previewDialog" :title="previewName" width="800px" :before-close="closePreview">
      <div v-loading="previewLoading" class="fav-preview">
        <img v-if="previewKind === 'image' && previewUrl" :src="previewUrl" class="pv-img" />
        <video v-if="previewKind === 'video' && previewUrl" :src="previewUrl" controls class="pv-video" />
        <audio v-if="previewKind === 'audio' && previewUrl" :src="previewUrl" controls style="width: 100%" />
        <iframe v-if="previewKind === 'pdf' && previewUrl" :src="previewUrl" class="pv-pdf" />
        <pre v-if="previewKind === 'code'" class="pv-code">{{ previewCode }}</pre>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.fav-page { padding: 20px; }
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  margin-bottom: 20px;
}
.page-header h2 { margin: 0; font-size: 20px; }
.fav-count { font-size: 13px; color: var(--text-secondary); }
.fav-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 14px;
}
.fav-item {
  border-radius: 18px;
  padding: 18px 14px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.fav-name {
  font-size: 14px;
  font-weight: 500;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fav-meta { font-size: 12px; color: var(--text-secondary); max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fav-actions { display: flex; gap: 2px; flex-wrap: wrap; justify-content: center; }
.empty { grid-column: 1 / -1; text-align: center; padding: 60px; color: var(--text-secondary); }
.tip { font-size: 12px; margin-top: 8px; }
.fav-preview { min-height: 200px; display: flex; align-items: center; justify-content: center; }
.pv-img { max-width: 100%; max-height: 70vh; object-fit: contain; }
.pv-video { max-width: 100%; max-height: 70vh; }
.pv-pdf { width: 100%; height: 70vh; border: 0; }
.pv-code { width: 100%; height: 70vh; overflow: auto; background: rgba(0,0,0,0.4); padding: 12px; font-size: 13px; }
</style>
