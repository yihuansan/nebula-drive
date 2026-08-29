<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, fmtSize, fmtTime, loadThumbs } from '../api';

const items = ref<any[]>([]);
const loading = ref(false);
const selected = ref<any[]>([]);
const retentionDays = ref(0);

async function load() {
  loading.value = true;
  try {
    const r = await api('/recycle');
    items.value = r.items;
    startThumbs();
  } catch (e: any) {
    ElMessage.error(e.message || '加载回收站失败');
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
  abortThumbs = loadThumbs(
    items.value.filter((it) => !it.is_dir).map((it) => ({ storageId: it.storage_id, path: it.path })),
    (path, url) => {
      thumbs.value[path] = url;
    },
    96
  );
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

/* 剩余保留天数徽章（按删除时间 + 保留期计算） */
function remainInfo(row: any): { text: string; cls: string } {
  if (retentionDays.value <= 0) return { text: '永久保留', cls: 'neutral' };
  const t = new Date(row.deleted_at).getTime();
  if (isNaN(t)) return { text: '-', cls: 'neutral' };
  const days = Math.ceil((t + retentionDays.value * 86400000 - Date.now()) / 86400000);
  if (days <= 0) return { text: '即将清理', cls: 'danger' };
  if (days <= 3) return { text: `剩 ${days} 天`, cls: 'warn' };
  return { text: `剩 ${days} 天`, cls: 'ok' };
}

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
  try {
    const r = await api('/recycle/batch', {
      method: 'POST',
      body: JSON.stringify({ action: 'restore', ids: selected.value.map((x) => x.id) }),
    });
    ElMessage.success(`已恢复 ${r.succeeded} / ${selected.value.length} 项`);
  } catch (e: any) {
    ElMessage.error(e.message || '批量恢复失败');
  }
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
  try {
    const r = await api('/recycle/batch', {
      method: 'POST',
      body: JSON.stringify({ action: 'purge', ids: selected.value.map((x) => x.id) }),
    });
    ElMessage.success(`已删除 ${r.succeeded} / ${selected.value.length} 项`);
  } catch (e: any) {
    ElMessage.error(e.message || '批量删除失败');
  }
  load();
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
onUnmounted(() => abortThumbs?.());
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
        <span class="panel-sub">删除的文件会先进入回收站{{ retentionDays > 0 ? `，超过 ${retentionDays} 天自动清理` : '，不会自动清理' }}</span>
        <div class="head-right">
          <el-button size="small" @click="load"><el-icon><Refresh /></el-icon>&nbsp;刷新</el-button>
          <el-button size="small" type="success" :disabled="!selected.length" @click="doBatchRestore">
            <el-icon><RefreshRight /></el-icon>&nbsp;恢复选中
          </el-button>
          <el-button size="small" type="danger" :disabled="!selected.length" @click="doBatchDelete">
            <el-icon><Delete /></el-icon>&nbsp;删除选中
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
              <img v-if="thumbs[row.path]" :src="thumbs[row.path]" class="file-thumb" :alt="row.name" loading="lazy" />
              <el-icon v-else class="file-icon" :color="fileType(row).color">
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
        <el-table-column label="剩余保留" width="110">
          <template #default="{ row }">
            <span class="status-badge" :class="remainInfo(row).cls">{{ remainInfo(row).text }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="doRestore(row)">恢复</el-button>
            <el-button link type="danger" size="small" @click="doDelete(row)">彻底删除</el-button>
          </template>
        </el-table-column>
        <!-- 空态：替代默认的"暂无数据"文案 -->
        <template #empty>
          <div class="recycle-empty">
            <el-icon :size="36"><Delete /></el-icon>
            <div class="recycle-empty-title">回收站是空的</div>
            <div class="recycle-empty-sub">删除的文件会先来到这里，可随时恢复或彻底删除</div>
          </div>
        </template>
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
.file-thumb {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--glass-border);
}
.file-name {
  font-weight: 500;
  color: var(--text);
}
.muted {
  color: var(--text-secondary);
  font-size: 12px;
}
.recycle-empty {
  padding: 40px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
}
.recycle-empty .el-icon {
  opacity: 0.4;
}
.recycle-empty-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
}
.recycle-empty-sub {
  font-size: 12px;
}
</style>
