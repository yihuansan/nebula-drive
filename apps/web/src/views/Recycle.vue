<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, fmtSize, fmtTime } from '../api';

const items = ref<any[]>([]);
const loading = ref(false);
const selected = ref<any[]>([]);
const retentionDays = ref(0);

async function load() {
  loading.value = true;
  try {
    const r = await api('/recycle');
    items.value = r.items;
  } catch (e: any) {
    ElMessage.error(e.message || '加载回收站失败');
  } finally {
    loading.value = false;
  }
}

/* 读取回收站保留天数（系统设置） */
async function loadRetention() {
  try {
    const s = await api('/settings');
    retentionDays.value = Number(s.recycleRetentionDays) || 0;
  } catch {
    /* 忽略 */
  }
}

/* ---------- 文件类型图标 ---------- */
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
function fileType(row: any) {
  if (row.is_dir) return { icon: 'Folder', color: 'var(--accent)' };
  const ext = row.name.split('.').pop()?.toLowerCase() || '';
  for (const t of FILE_TYPES) if (t.exts.includes(ext)) return t;
  return { icon: 'Document', color: '#94a3b8' };
}

const stats = computed(() => {
  const total = items.value.length;
  const size = items.value.reduce((sum, it) => sum + (it.size || 0), 0);
  return { total, size };
});

/* ---------- 恢复 ---------- */
async function doRestore(row: any) {
  try {
    await api('/recycle/restore', { method: 'POST', body: JSON.stringify({ id: row.id }) });
    ElMessage.success('已恢复');
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '恢复失败');
  }
}

async function doBatchRestore() {
  if (!selected.value.length) return;
  try {
    await ElMessageBox.confirm(`确定恢复选中的 ${selected.value.length} 项吗？`, '批量恢复', { type: 'info' });
  } catch {
    return;
  }
  let okCount = 0;
  for (const row of selected.value) {
    try {
      await api('/recycle/restore', { method: 'POST', body: JSON.stringify({ id: row.id }) });
      okCount++;
    } catch {
      /* 继续 */
    }
  }
  ElMessage.success(`已恢复 ${okCount} / ${selected.value.length} 项`);
  load();
}

/* ---------- 彻底删除 ---------- */
async function doDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定彻底删除「${row.name}」吗？此操作不可恢复。`, '彻底删除', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api(`/recycle/${row.id}`, { method: 'DELETE' });
    ElMessage.success('已彻底删除');
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败');
  }
}

async function doBatchDelete() {
  if (!selected.value.length) return;
  try {
    await ElMessageBox.confirm(`确定彻底删除选中的 ${selected.value.length} 项吗？此操作不可恢复。`, '批量删除', { type: 'warning' });
  } catch {
    return;
  }
  let okCount = 0;
  for (const row of selected.value) {
    try {
      await api(`/recycle/${row.id}`, { method: 'DELETE' });
      okCount++;
    } catch {
      /* 继续 */
    }
  }
  ElMessage.success(`已删除 ${okCount} / ${selected.value.length} 项`);
  load();
}

/* ---------- 立即清理（按保留天数手动触发） ---------- */
async function doPurge() {
  if (retentionDays.value <= 0) return;
  try {
    await ElMessageBox.confirm(
      `将立即执行自动清理：彻底删除超过 ${retentionDays.value} 天的回收站条目（不可恢复）。`,
      '立即清理',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    const r = await api('/recycle/purge', { method: 'POST' });
    ElMessage.success(`已清理 ${r.purged} 条超过 ${r.days} 天的记录`);
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '清理失败');
  }
}

/* ---------- 清空 ---------- */
async function doClear() {
  try {
    await ElMessageBox.confirm('确定清空回收站吗？所有文件将被彻底删除，不可恢复。', '清空回收站', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api('/recycle', { method: 'DELETE' });
    ElMessage.success('回收站已清空');
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '清空失败');
  }
}

onMounted(() => {
  load();
  loadRetention();
});
</script>

<template>
  <div class="recycle-page">
    <!-- KPI 卡片 -->
    <div class="kpi-grid">
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-blue"><el-icon :size="24"><Delete /></el-icon></div>
        <div>
          <div class="kpi-num">{{ stats.total }}</div>
          <div class="kpi-label">回收站项目</div>
        </div>
      </div>
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-purple"><el-icon :size="24"><Box /></el-icon></div>
        <div>
          <div class="kpi-num">{{ fmtSize(stats.size) }}</div>
          <div class="kpi-label">占用空间</div>
        </div>
      </div>
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-teal"><el-icon :size="24"><Timer /></el-icon></div>
        <div>
          <div class="kpi-num">{{ retentionDays > 0 ? retentionDays + ' 天' : '不自动清理' }}</div>
          <div class="kpi-label">自动清理周期</div>
        </div>
      </div>
    </div>

    <!-- 回收站列表 -->
    <div class="panel glass-card">
      <div class="panel-head">
        <el-icon class="panel-icon"><Delete /></el-icon>
        <span class="panel-title">回收站</span>
        <span class="panel-sub">删除的文件会先进入回收站，可恢复或彻底删除</span>
        <div class="head-right">
          <el-button size="small" @click="load"><el-icon><Refresh /></el-icon>&nbsp;刷新</el-button>
          <el-button size="small" type="success" :disabled="!selected.length" @click="doBatchRestore">
            <el-icon><RefreshRight /></el-icon>&nbsp;恢复选中
          </el-button>
          <el-button size="small" type="danger" :disabled="!selected.length" @click="doBatchDelete">
            <el-icon><Delete /></el-icon>&nbsp;删除选中
          </el-button>
          <el-button size="small" type="warning" :disabled="retentionDays <= 0 || !items.length" @click="doPurge">
            <el-icon><Timer /></el-icon>&nbsp;立即清理
          </el-button>
          <el-button size="small" type="danger" :disabled="!items.length" @click="doClear">
            <el-icon><Delete /></el-icon>&nbsp;清空回收站
          </el-button>
        </div>
      </div>

      <el-table
        v-loading="loading"
        :data="items"
        row-key="id"
        @selection-change="(v: any[]) => (selected = v)"
      >
        <el-table-column type="selection" width="44" />
        <el-table-column label="名称" min-width="220">
          <template #default="{ row }">
            <div class="file-cell">
              <el-icon class="file-icon" :color="fileType(row).color">
                <component :is="fileType(row).icon" />
              </el-icon>
              <span class="file-name">{{ row.name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="原路径" min-width="240" prop="path" show-overflow-tooltip />
        <el-table-column label="大小" width="120">
          <template #default="{ row }">{{ row.is_dir ? '-' : fmtSize(row.size) }}</template>
        </el-table-column>
        <el-table-column label="本地副本" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.local_copy" size="small" type="success">有</el-tag>
            <span v-else class="muted">无</span>
          </template>
        </el-table-column>
        <el-table-column label="删除时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.deleted_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="170">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="doRestore(row)">恢复</el-button>
            <el-button link type="danger" size="small" @click="doDelete(row)">彻底删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.recycle-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ---------- KPI 卡片 ---------- */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
@media (max-width: 900px) {
  .kpi-grid {
    grid-template-columns: repeat(1, 1fr);
  }
}
.kpi {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border-radius: 18px;
}
.kpi:hover {
  transform: none;
}
.kpi-icon {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  color: #fff;
  border: 1px solid var(--glass-border);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}
.kpi-blue {
  background: linear-gradient(135deg, #3b82f6, #6366f1);
}
.kpi-purple {
  background: linear-gradient(135deg, #8b5cf6, #ec4899);
}
.kpi-teal {
  background: linear-gradient(135deg, #14b8a6, #0ea5e9);
}
.kpi-num {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.kpi-label {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 2px;
}

/* ---------- 面板 ---------- */
.panel {
  border-radius: 18px;
  padding: 20px 22px;
}
.panel:hover {
  transform: none;
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.panel-icon {
  color: var(--accent);
  font-size: 18px;
}
.panel-title {
  font-size: 15px;
  font-weight: 600;
}
.panel-sub {
  font-size: 12px;
  color: var(--text-secondary);
}
.head-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* ---------- 表格 ---------- */
.file-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.file-icon {
  font-size: 18px;
  flex-shrink: 0;
}
.file-name {
  font-weight: 500;
  color: var(--text);
}
.muted {
  color: var(--text-secondary);
  font-size: 12px;
}
</style>
