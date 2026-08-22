<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api';
import { ElMessage } from 'element-plus';

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
  } catch (e: any) {
    ElMessage.error(e.message || '加载快捷访问失败');
  } finally {
    loading.value = false;
  }
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
</script>

<template>
  <div class="quick-page">
    <div class="page-header glass">
      <h2>快捷访问</h2>
      <el-select v-model="storageId" size="small" @change="load" style="width: 180px">
        <el-option v-for="s in storages" :key="s.id" :label="s.name" :value="s.id" />
      </el-select>
    </div>

    <div class="quick-grid" v-loading="loading">
      <div v-for="row in entries" :key="row.path" class="quick-item glass-card">
        <el-icon :size="36" :color="row.isDir ? '#409eff' : '#909399'">
          <Folder v-if="row.isDir" />
          <Document v-else />
        </el-icon>
        <div class="quick-name">{{ row.name }}</div>
        <div class="quick-meta">{{ row.isDir ? '文件夹' : fmtSize(row.size) }}</div>
        <el-button size="small" title="取消固定" @click="togglePin(row)">
          <el-icon><StarFilled /></el-icon>
        </el-button>
      </div>
      <div v-if="!loading && !entries.length" class="empty">
        <p>暂无快捷访问项</p>
        <p class="tip">在「文件管理」中右键点击文件或文件夹，选择「添加到快捷访问」即可</p>
      </div>
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
.empty { grid-column: 1 / -1; text-align: center; padding: 60px; color: var(--text-secondary); }
.tip { font-size: 12px; margin-top: 8px; }
</style>
