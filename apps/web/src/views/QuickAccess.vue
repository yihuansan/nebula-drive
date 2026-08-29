<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { api, loadThumbs } from '../api';
import { ElMessage } from 'element-plus';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';

const loading = ref(false);
const entries = ref<any[]>([]);
const storageId = ref<number | null>(null);
const storages = ref<any[]>([]);

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
    const r = await api(`/files/quick-access?storageId=${storageId.value}`);
    entries.value = r.entries;
    startThumbs();
  } catch (e: any) {
    ElMessage.error(e.message || '加载快捷访问失败');
  } finally {
    loading.value = false;
  }
}

/* 图片文件缩略图（带鉴权拉取，失败回退图标） */
const thumbs = ref<Record<string, string>>({});
let abortThumbs: (() => void) | null = null;
function startThumbs() {
  abortThumbs?.();
  thumbs.value = {};
  const sid = storageId.value;
  if (!sid) return;
  abortThumbs = loadThumbs(
    entries.value.filter((e) => !e.isDir).map((e) => ({ storageId: sid, path: e.path })),
    (path, url) => {
      if (storageId.value === sid) thumbs.value[path] = url;
    },
    160
  );
}

async function togglePin(row: any) {
  try {
    await api(`/files/quick-access/${encodeURIComponent(row.path)}?storageId=${storageId.value}`, { method: 'POST' });
    ElMessage.success('已取消固定');
    await load();
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败');
  }
}

function fmtSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

onUnmounted(() => abortThumbs?.());
</script>

<template>
  <div class="quick-page">
    <PageHeader
      icon="Star"
      title="快捷访问"
      subtitle="固定的常用文件与文件夹，一键直达"
    >
      <template #actions>
        <el-select v-model="storageId" size="small" @change="load" style="width: 180px">
          <el-option v-for="s in storages" :key="s.id" :label="s.name" :value="s.id" />
        </el-select>
      </template>
    </PageHeader>

    <div class="quick-grid page-enter-stagger" v-loading="loading">
      <div v-for="(row, i) in entries" :key="row.path" class="quick-item glass-card hover-lift" :style="{ '--i': i }">
        <img v-if="thumbs[row.path]" :src="thumbs[row.path]" class="quick-thumb" :alt="row.name" loading="lazy" />
        <el-icon v-else :size="36" :color="row.isDir ? '#409eff' : '#909399'">
          <Folder v-if="row.isDir" />
          <Document v-else />
        </el-icon>
        <div class="quick-name">{{ row.name }}</div>
        <div class="quick-meta">{{ row.isDir ? '文件夹' : fmtSize(row.size) }}</div>
        <el-button size="small" title="取消固定" @click="togglePin(row)">
          <el-icon><StarFilled /></el-icon>
        </el-button>
      </div>
      <EmptyState
        v-if="!loading && !entries.length"
        title="暂无快捷访问项"
        description="在「文件管理」中右键点击文件或文件夹，选择「添加到快捷访问」即可"
      />
    </div>
  </div>
</template>

<style scoped>
.quick-page { padding: 20px; }
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  margin-bottom: 20px;
}
.page-header h2 { margin: 0; font-size: 20px; }
.quick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 14px;
}
.quick-item {
  border-radius: 18px;
  padding: 18px 14px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.quick-name {
  font-size: 14px;
  font-weight: 500;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.quick-meta { font-size: 12px; color: var(--text-secondary); }
.quick-thumb {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  object-fit: cover;
  border: 1px solid var(--glass-border);
}
.empty { grid-column: 1 / -1; text-align: center; padding: 60px; color: var(--text-secondary); }
.tip { font-size: 12px; margin-top: 8px; }
</style>
