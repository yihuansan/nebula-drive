<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Loading } from '@element-plus/icons-vue';
import { api } from '../../api';

const storages = ref<any[]>([]);
const types = ref<any[]>([]);
const loading = ref(false);
const hasLoaded = ref(false); // 是否已完成过首次加载

async function load() {
  loading.value = true;
  try {
    const r = await api('/storages');
    storages.value = r.storages;
    types.value = r.types;
  } catch (e: any) {
    ElMessage.error(e.message || '加载存储失败');
  } finally {
    loading.value = false;
    hasLoaded.value = true;
  }
}

function typeLabel(t: string) {
  return types.value.find((x) => x.type === t)?.label || t;
}

/* ---------- 类型图标 ---------- */
const TYPE_ICONS: Record<string, { icon: string; color: string }> = {
  local: { icon: 'Monitor', color: '#3b82f6' },
  webdav: { icon: 'Link', color: '#8b5cf6' },
  s3: { icon: 'Box', color: '#f59e0b' },
  onedrive: { icon: 'Cloudy', color: '#0ea5e9' },
  alist: { icon: 'Grid', color: '#14b8a6' },
  ftp: { icon: 'OfficeBuilding', color: '#64748b' },
};
function typeInfo(t: string) {
  return TYPE_ICONS[t] || { icon: 'Box', color: '#94a3b8' };
}

const stats = computed(() => {
  const total = storages.value.length;
  const enabled = storages.value.filter((s) => s.enabled).length;
  return { total, enabled, disabled: total - enabled };
});

/* ---------- 新建 / 编辑 ---------- */
const dialog = ref(false);
const isEdit = ref(false);
const editId = ref(0);
const form = reactive({ name: '', type: 'local', sort: 0, config: {} as Record<string, string> });
const typeFields = ref<any[]>([]);

function openCreate() {
  isEdit.value = false;
  editId.value = 0;
  form.name = '';
  form.type = 'local';
  form.sort = 0;
  form.config = {};
  typeFields.value = (types.value.find((t) => t.type === 'local')?.fields || []) as any[];
  dialog.value = true;
}

function openEdit(row: any) {
  isEdit.value = true;
  editId.value = row.id;
  form.name = row.name;
  form.type = row.type;
  form.sort = row.sort || 0;
  form.config = { ...(row.config || {}) };
  typeFields.value = (types.value.find((t) => t.type === row.type)?.fields || []) as any[];
  dialog.value = true;
}

function onTypeChange() {
  typeFields.value = (types.value.find((t) => t.type === form.type)?.fields || []) as any[];
  form.config = {};
}

async function doSave() {
  if (!form.name.trim()) return ElMessage.warning('请输入存储名称');
  const body: any = {
    name: form.name.trim(),
    type: form.type,
    config: { ...form.config },
    sort: form.sort || 0,
  };
  try {
    if (isEdit.value) {
      await api(`/storages/${editId.value}`, { method: 'PUT', body: JSON.stringify(body) });
      ElMessage.success('已保存');
    } else {
      await api('/storages', { method: 'POST', body: JSON.stringify(body) });
      ElMessage.success('已创建');
    }
    dialog.value = false;
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '保存失败');
  }
}

/* ---------- 测试 / 启用 / 删除 ---------- */
const testing = ref<number | null>(null);
async function doTest(row: any) {
  testing.value = row.id;
  try {
    const r = await api(`/storages/${row.id}/test`, { method: 'POST' });
    if (r.ok) ElMessage.success('连接正常');
    else ElMessage.error(r.error || '连接失败');
  } catch (e: any) {
    ElMessage.error(e.message || '测试失败');
  } finally {
    testing.value = null;
  }
}

async function doToggle(row: any) {
  try {
    await api(`/storages/${row.id}/toggle`, { method: 'POST' });
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败');
  }
}

async function doDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除存储「${row.name}」吗？`, '删除确认', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api(`/storages/${row.id}`, { method: 'DELETE' });
    ElMessage.success('已删除');
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败');
  }
}

onMounted(load);
</script>

<template>
  <div class="storages-page">
    <!-- KPI 卡片 -->
    <div class="kpi-grid">
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-blue"><el-icon :size="24"><Box /></el-icon></div>
        <div>
          <div class="kpi-num">{{ stats.total }}</div>
          <div class="kpi-label">存储总数</div>
        </div>
      </div>
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-green"><el-icon :size="24"><CircleCheck /></el-icon></div>
        <div>
          <div class="kpi-num">{{ stats.enabled }}</div>
          <div class="kpi-label">已启用</div>
        </div>
      </div>
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-gray"><el-icon :size="24"><CircleClose /></el-icon></div>
        <div>
          <div class="kpi-num">{{ stats.disabled }}</div>
          <div class="kpi-label">已停用</div>
        </div>
      </div>
    </div>

    <!-- 存储列表 -->
    <div class="panel glass-card">
      <div class="panel-head">
        <el-icon class="panel-icon"><Box /></el-icon>
        <span class="panel-title">存储管理</span>
        <span class="panel-sub">本地 / WebDAV / S3 / OneDrive / Alist / FTP</span>
        <div class="head-right">
          <el-button type="primary" size="small" @click="openCreate">
            <el-icon><Plus /></el-icon>&nbsp;添加存储
          </el-button>
        </div>
      </div>

      <div v-if="!hasLoaded" class="table-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>加载中…</span>
      </div>
      <el-table v-else v-loading="loading" :data="storages">
        <el-table-column label="名称" min-width="160">
          <template #default="{ row }">
            <div class="storage-cell">
              <div class="storage-badge" :style="{ background: typeInfo(row.type).color }">
                <el-icon><component :is="typeInfo(row.type).icon" /></el-icon>
              </div>
              <span class="storage-name">{{ row.name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="140">
          <template #default="{ row }">
            <el-tag size="small" type="info">{{ typeLabel(row.type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="配置摘要" min-width="260">
          <template #default="{ row }">
            <span class="cfg">
              <template v-if="row.type === 'local'">{{ row.config?.root }}</template>
              <template v-else-if="row.type === 'webdav'">{{ row.config?.url }}{{ row.config?.baseDir ? ' ' + row.config.baseDir : '' }}</template>
              <template v-else-if="row.type === 's3'">{{ row.config?.endpoint }} {{ row.config?.bucket }}</template>
              <template v-else-if="row.type === 'onedrive'">{{ row.config?.driveId || 'root' }}</template>
              <template v-else-if="row.type === 'alist'">{{ row.config?.url }}{{ row.config?.root ? ' ' + row.config.root : '' }}</template>
              <template v-else-if="row.type === 'ftp'">{{ row.config?.host }}:{{ row.config?.port }}{{ row.config?.baseDir ? ' ' + row.config.baseDir : '' }}</template>
              <template v-else>-</template>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'danger'" size="small">
              {{ row.enabled ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="260">
          <template #default="{ row }">
            <el-button link type="primary" size="small" :loading="testing === row.id" @click="doTest(row)">测试</el-button>
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="warning" size="small" @click="doToggle(row)">{{ row.enabled ? '停用' : '启用' }}</el-button>
            <el-button link type="danger" size="small" @click="doDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 新建 / 编辑存储 -->
    <el-dialog v-model="dialog" :title="isEdit ? '编辑存储' : '添加存储'" width="560px">
      <el-form label-width="110px">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="存储显示名称（唯一）" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type" style="width: 100%" :disabled="isEdit" @change="onTypeChange">
            <el-option v-for="t in types" :key="t.type" :label="t.label" :value="t.type" />
          </el-select>
        </el-form-item>
        <el-form-item v-for="f in typeFields" :key="f.key" :label="f.label">
          <el-input
            v-model="form.config[f.key]"
            :type="f.secret ? 'password' : 'text'"
            :placeholder="f.placeholder || ''"
            :show-password="!!f.secret"
          />
        </el-form-item>
        <el-form-item label="排序">
          <el-input v-model.number="form.sort" type="number" placeholder="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="doSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.storages-page {
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
.kpi-green {
  background: linear-gradient(135deg, #22c55e, #14b8a6);
}
.kpi-gray {
  background: linear-gradient(135deg, #64748b, #94a3b8);
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
}

/* ---------- 加载占位 ---------- */
.table-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px 0;
  color: var(--text-secondary);
  font-size: 14px;
}

/* ---------- 表格 ---------- */
.storage-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.storage-badge {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: #fff;
}
.storage-name {
  font-weight: 500;
  color: var(--text);
}
.cfg {
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-all;
}
</style>
