<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { api } from '../api';
import { ElMessage } from 'element-plus';

const loading = ref(false);
const entries = ref<any[]>([]);
const storageId = ref<number | null>(null);
const storages = ref<any[]>([]);
const mediaType = ref<'video' | 'document'>('video');

const pageTitle = computed(() => mediaType.value === 'video' ? '视频' : '文档');

// 预览状态
const previewDialog = ref(false);
const previewUrl = ref('');
const previewLoading = ref(false);
const previewName = ref('');
const previewKind = ref<'video' | 'pdf' | 'code'>('video');

onMounted(async () => {
  try {
    const r = await api('/storages');
    storages.value = r.storages;
    if (r.storages.length) storageId.value = r.storages[0].id;
    await load();
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败');
  }
});

async function load() {
  if (!storageId.value) return;
  loading.value = true;
  try {
    const type = mediaType.value === 'video' ? 'video' : 'document';
    const r = await api(`/files/by-type?storageId=${storageId.value}&type=${type}`);
    entries.value = r.entries;
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function switchType(type: 'video' | 'document') {
  mediaType.value = type;
  load();
}

/** 打开预览 */
async function openPreview(row: any) {
  if (row.isDir) return;
  const name = row.name.toLowerCase();
  const isVideo = /\.(mp4|mkv|mov|webm|avi|flv|wmv|m4v|ts)$/i.test(name);
  const isPdf = /\.pdf$/i.test(name);
  const isCode = /\.(txt|md|csv)$/i.test(name);
  
  if (!isVideo && !isPdf && !isCode) {
    // 其他文档：下载
    const token = localStorage.getItem('nebula_token') || '';
    const base = `/api/v1/files/download?storageId=${storageId.value}&path=${encodeURIComponent(row.path)}`;
    const url = `${base}&token=${encodeURIComponent(token)}`;
    window.open(url, '_blank');
    return;
  }
  
  previewName.value = row.name;
  previewKind.value = isVideo ? 'video' : isPdf ? 'pdf' : 'code';
  previewDialog.value = true;
  previewLoading.value = true;
  previewUrl.value = '';
  
  try {
    const token = localStorage.getItem('nebula_token') || '';
    const base = `/api/v1/files/preview?storageId=${storageId.value}&path=${encodeURIComponent(row.path)}`;
    
    if (previewKind.value === 'video') {
      // 视频：用 Bearer 头获取 blob
      const res = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('预览加载失败');
      const blob = await res.blob();
      previewUrl.value = URL.createObjectURL(blob);
    } else if (previewKind.value === 'pdf') {
      // PDF：用 Bearer 头获取 blob
      const res = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('预览加载失败');
      const blob = await res.blob();
      previewUrl.value = URL.createObjectURL(blob);
    } else {
      // 代码/文本：读取文本
      const res = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('预览加载失败');
      const text = await res.text();
      previewUrl.value = 'code-loaded';
      // 显示文本内容
      const codeEl = document.querySelector('.preview-code code');
      if (codeEl) codeEl.textContent = text.length > 50000 ? text.slice(0, 50000) + '\n... (内容过长)' : text;
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
}

function fmtSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

function fmtTime(ts: string) {
  return new Date(ts).toLocaleString('zh-CN');
}
</script>

<template>
  <div class="media-page">
    <div class="page-header glass">
      <h2>{{ pageTitle }}</h2>
      <div class="header-controls">
        <el-radio-group v-model="mediaType" @change="(v) => switchType(v as 'video' | 'document')">
          <el-radio-button value="video">视频</el-radio-button>
          <el-radio-button value="document">文档</el-radio-button>
        </el-radio-group>
        <el-select v-model="storageId" size="small" @change="load" style="width: 180px">
          <el-option v-for="s in storages" :key="s.id" :label="s.name" :value="s.id" />
        </el-select>
      </div>
    </div>

    <div class="media-grid" v-loading="loading">
      <div v-for="row in entries" :key="row.path" class="media-item glass-card" @click="openPreview(row)">
        <el-icon :size="42" :color="mediaType === 'video' ? '#ef4444' : '#2563eb'">
          <VideoPlay v-if="mediaType === 'video'" />
          <Document v-else />
        </el-icon>
        <div class="media-name">{{ row.name }}</div>
        <div class="media-meta">{{ row.isDir ? '文件夹' : fmtSize(row.size) }}</div>
      </div>
      <div v-if="!loading && !entries.length" class="empty">暂无{{ pageTitle }}文件</div>
    </div>

    <!-- 预览对话框 -->
    <el-dialog
      v-model="previewDialog"
      :title="previewName"
      :width="previewKind === 'video' ? '880px' : '720px'"
      class="preview-dialog"
      @close="closePreview"
    >
      <div class="preview-wrap" v-loading="previewLoading">
        <video
          v-if="previewKind === 'video' && previewUrl"
          :src="previewUrl"
          class="preview-media"
          controls
          autoplay
        ></video>
        <iframe
          v-else-if="previewKind === 'pdf' && previewUrl"
          :src="previewUrl"
          class="preview-pdf"
          width="100%"
          height="65vh"
          sandbox="allow-scripts"
        ></iframe>
        <pre v-else-if="previewKind === 'code' && previewUrl" class="preview-code">
          <code>{{ previewName }}</code>
        </pre>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.media-page { padding: 20px; }
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  margin-bottom: 20px;
}
.page-header h2 { margin: 0; font-size: 20px; }
.header-controls { display: flex; gap: 12px; align-items: center; }
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 14px;
}
.media-item {
  border-radius: 18px;
  padding: 18px 14px;
  cursor: pointer;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
}
.media-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
}
.media-name {
  font-size: 14px;
  font-weight: 500;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.media-meta { font-size: 12px; color: var(--text-secondary); }
.empty { grid-column: 1 / -1; text-align: center; padding: 60px; color: var(--text-secondary); }

/* 预览样式 */
.preview-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 200px;
}
.preview-media {
  width: 100%;
  max-height: 65vh;
  border-radius: 12px;
  background: #000;
}
.preview-pdf {
  border-radius: 12px;
}
.preview-code {
  width: 100%;
  max-height: 65vh;
  overflow: auto;
  padding: 16px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.6;
}
</style>
