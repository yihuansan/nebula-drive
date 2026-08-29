<script setup lang="ts">
import { ref, reactive, nextTick, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, fmtTime, downloadFile } from '../../api';

const activeTab = ref<'op' | 'login'>('op');
const size = ref(20);

/** 每个 tab 独立缓存：切换时秒显缓存数据，后台静默刷新，不重渲染表格 */
const data = reactive({
  op: { rows: [] as any[], total: 0, page: 1, loading: false },
  login: { rows: [] as any[], total: 0, page: 1, loading: false },
});

const opTable = ref<any>(null);
const loginTable = ref<any>(null);

function cur() {
  return data[activeTab.value];
}

async function load(showMask: boolean) {
  const c = cur();
  if (showMask) c.loading = true;
  try {
    const r = await api(`/logs?type=${activeTab.value}&page=${c.page}&size=${size.value}`);
    c.rows = r.rows;
    c.total = r.total;
  } catch (e: any) {
    if (showMask) ElMessage.error(e.message || '加载日志失败');
  } finally {
    c.loading = false;
  }
}

/** 切 tab：v-show 瞬时切换（无重渲染）+ 重算新表格列宽 + 后台刷新（首次访问才显示加载态） */
function onTab() {
  nextTick(() => {
    const t = activeTab.value === 'op' ? opTable.value : loginTable.value;
    t?.debouncedUpdateLayout?.();
  });
  load(cur().rows.length === 0);
}

function onPage() {
  load(true);
}

async function doClear() {
  try {
    await ElMessageBox.confirm('确定清空全部日志（操作日志 + 登录日志）吗？', '清空日志', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api('/logs', { method: 'DELETE' });
    ElMessage.success('日志已清空');
    // 服务端全部清空，两个 tab 的缓存都失效
    data.op.rows = [];
    data.op.total = 0;
    data.op.page = 1;
    data.login.rows = [];
    data.login.total = 0;
    data.login.page = 1;
    load(true);
  } catch (e: any) {
    ElMessage.error(e.message || '清空失败');
  }
}

/** 操作 → 图标 / 中文名 / 色调 */
const ACTION_META: Record<string, { icon: string; label: string; tone: string }> = {
  upload: { icon: 'Upload', label: '上传', tone: 'blue' },
  upload_direct: { icon: 'Upload', label: '直传', tone: 'blue' },
  mkdir: { icon: 'Folder', label: '新建目录', tone: 'green' },
  delete: { icon: 'Delete', label: '删除', tone: 'red' },
  rename: { icon: 'Edit', label: '重命名', tone: 'orange' },
  move: { icon: 'Right', label: '移动', tone: 'purple' },
  copy: { icon: 'DocumentCopy', label: '复制', tone: 'purple' },
  share_create: { icon: 'Share', label: '创建分享', tone: 'teal' },
  storage_create: { icon: 'Box', label: '创建存储', tone: 'blue' },
  storage_update: { icon: 'Box', label: '更新存储', tone: 'blue' },
  sync_push: { icon: 'Refresh', label: '同步推送', tone: 'green' },
  sync_pull: { icon: 'Refresh', label: '同步拉取', tone: 'green' },
  sync_delete: { icon: 'Refresh', label: '同步删除', tone: 'red' },
};

function actMeta(action: string) {
  return ACTION_META[action] || { icon: 'Document', label: action, tone: 'gray' };
}

/* ---------- 导出 CSV（后端 /logs/export.csv，按当前 tab 导出） ---------- */
const exporting = ref(false);
async function doExport() {
  exporting.value = true;
  try {
    await downloadFile('/logs/export.csv', { type: activeTab.value }, `logs-${activeTab.value}.csv`);
    ElMessage.success('导出成功');
  } catch (e: any) {
    ElMessage.error(e.message || '导出失败');
  } finally {
    exporting.value = false;
  }
}

onMounted(() => load(true));
</script>

<template>
  <div class="logs-page glass-card">
    <div class="toolbar">
      <div class="seg">
        <el-radio-group v-model="activeTab" size="small" @change="onTab">
          <el-radio-button value="op">操作日志</el-radio-button>
          <el-radio-button value="login">登录日志</el-radio-button>
        </el-radio-group>
      </div>
      <div class="spacer" />
      <span class="count-chip">共 {{ data[activeTab].total }} 条</span>
      <el-button size="small" :loading="exporting" :disabled="!data[activeTab].total" @click="doExport">
        <el-icon><Download /></el-icon>&nbsp;导出 CSV
      </el-button>
      <el-button type="danger" plain size="small" @click="doClear">清空日志</el-button>
    </div>

    <!-- 操作日志表（固定列，v-show 切换不重渲染） -->
    <el-table
      ref="opTable"
      v-show="activeTab === 'op'"
      v-loading="data.op.loading"
      :data="data.op.rows"
      class="log-table"
      empty-text="暂无日志"
    >
      <el-table-column label="时间" width="170">
        <template #default="{ row }">
          <span class="mono">{{ fmtTime(row.created_at) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="用户" width="140" prop="username" />
      <el-table-column label="操作" width="170">
        <template #default="{ row }">
          <span class="act" :class="'act-' + actMeta(row.action).tone">
            <el-icon><component :is="actMeta(row.action).icon" /></el-icon>
            {{ actMeta(row.action).label }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="路径" min-width="200" prop="path">
        <template #default="{ row }">
          <span class="mono path">{{ row.path }}</span>
        </template>
      </el-table-column>
      <el-table-column label="IP" width="140">
        <template #default="{ row }">
          <span class="mono">{{ row.ip || '-' }}</span>
        </template>
      </el-table-column>
    </el-table>

    <!-- 登录日志表 -->
    <el-table
      ref="loginTable"
      v-show="activeTab === 'login'"
      v-loading="data.login.loading"
      :data="data.login.rows"
      class="log-table"
      empty-text="暂无日志"
    >
      <el-table-column label="时间" width="170">
        <template #default="{ row }">
          <span class="mono">{{ fmtTime(row.created_at) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="用户名" width="160" prop="username" />
      <el-table-column label="IP" width="140">
        <template #default="{ row }">
          <span class="mono">{{ row.ip }}</span>
        </template>
      </el-table-column>
      <el-table-column label="User-Agent" min-width="220" prop="ua" show-overflow-tooltip />
      <el-table-column label="结果" width="90">
        <template #default="{ row }">
          <span class="status-badge" :class="row.success ? 'ok' : 'danger'">
            <i class="dot" />
            {{ row.success ? '成功' : '失败' }}
          </span>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        v-model:current-page="data[activeTab].page"
        v-model:page-size="size"
        :total="data[activeTab].total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @current-change="onPage"
        @size-change="onPage"
      />
    </div>
  </div>
</template>

<style scoped>
.logs-page {
  border-radius: 18px;
  padding: 18px 20px;
}
/* 大卡片不做缩放悬浮，避免溢出压到侧边栏（保留背景/阴影变化） */
.logs-page:hover {
  transform: none;
}

/* ---------- 工具条 ---------- */
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
}
.seg {
  background: var(--surface);
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  padding: 4px;
  display: inline-flex;
}
.count-chip {
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--surface);
  border: 1px solid var(--glass-border);
  padding: 4px 12px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}

/* ---------- 表格透明化（融入玻璃卡片） ---------- */
.log-table {
  background: transparent !important;
}
.log-table :deep(th.el-table__cell) {
  background-color: var(--surface) !important;
  color: var(--text-secondary);
  font-weight: 600;
  border-bottom: 1px solid var(--glass-border) !important;
}
.log-table :deep(.el-table__row) {
  background: transparent;
}
.log-table :deep(.el-table--enable-row-hover .el-table__body tr:hover > td.el-table__cell) {
  background: var(--glass-bg-hover) !important;
}
.log-table :deep(td.el-table__cell) {
  border-bottom-color: var(--glass-border) !important;
}
.log-table :deep(.el-table__border--right),
.log-table :deep(.el-table--bordered) {
  border-color: var(--glass-border) !important;
}

/* ---------- 单元格内容 ---------- */
.mono {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 12.5px;
}
.path {
  color: var(--text-secondary);
}

/* ---------- 操作图标 + 色调（胶囊徽章） ---------- */
.act {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 13%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
}
.act :deep(.el-icon) {
  font-size: 14px;
}
.act-blue {
  color: var(--accent);
}
.act-green {
  color: #2ea24f;
}
.act-red {
  color: #e5484d;
}
.act-orange {
  color: #e8933a;
}
.act-purple {
  color: #9a6fe8;
}
.act-teal {
  color: #2aa8a8;
}
.act-gray {
  color: var(--text-secondary);
}

/* ---------- 分页 ---------- */
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
</style>
