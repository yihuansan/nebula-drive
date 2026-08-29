<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, fmtTime } from '../../api';

const pairs = ref<any[]>([]);
const storages = ref<any[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const [p, s] = await Promise.all([api('/sync/pairs'), api('/storages')]);
    pairs.value = p.pairs;
    storages.value = s.storages;
  } catch (e: any) {
    ElMessage.error(e.message || '加载同步对失败');
  } finally {
    loading.value = false;
  }
}

function storageName(id: number) {
  return storages.value.find((s) => s.id === id)?.name || `#${id}`;
}

/* ---------- 模式标签 ---------- */
const MODE_META: Record<string, { label: string; icon: string; color: string; tag: string }> = {
  'two-way': { label: '双向同步', icon: 'Sort', color: '#22c55e', tag: 'success' },
  push: { label: '仅上传', icon: 'Upload', color: '#f59e0b', tag: 'warning' },
  pull: { label: '仅下载', icon: 'Download', color: '#3b82f6', tag: 'info' },
};
function modeInfo(mode: string) {
  return MODE_META[mode] || { label: mode, icon: 'Sort', color: '#94a3b8', tag: 'info' };
}
const TAG_BADGE: Record<string, string> = { success: 'ok', warning: 'warn', info: 'info', danger: 'danger' };
function modeBadge(mode: string) {
  return TAG_BADGE[modeInfo(mode).tag] || 'info';
}

/* 同步任务状态（服务端未返回运行时字段时展示空闲） */
function syncState(row: any): { label: string; cls: string; pulse: boolean } {
  if (row.error || row.last_error) return { label: '错误', cls: 'danger', pulse: false };
  if (row.running || row.syncing) return { label: '运行中', cls: 'warn', pulse: true };
  return { label: '空闲', cls: 'ok', pulse: false };
}

const stats = computed(() => {
  const total = pairs.value.length;
  const twoWay = pairs.value.filter((p) => p.mode === 'two-way').length;
  return { total, twoWay, oneWay: total - twoWay };
});

/* ---------- 新建同步对 ---------- */
const dialog = ref(false);
const form = ref({ storageId: 0, remotePath: '/', mode: 'two-way', localPath: '' });

async function openCreate() {
  if (!storages.value.length) await load();
  form.value = { storageId: storages.value[0]?.id || 0, remotePath: '/', mode: 'two-way', localPath: '' };
  dialog.value = true;
}

async function doCreate() {
  if (!form.value.storageId) return ElMessage.warning('请选择存储');
  try {
    await api('/sync/pairs', {
      method: 'POST',
      body: JSON.stringify({
        storageId: form.value.storageId,
        remotePath: form.value.remotePath || '/',
        mode: form.value.mode,
        localPath: form.value.localPath || undefined,
      }),
    });
    ElMessage.success('同步对已创建，可复制 Token 配置同步客户端');
    dialog.value = false;
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '创建失败');
  }
}

async function doDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除该同步对吗？（Token 将立即失效）`, '删除确认', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api(`/sync/pairs/${row.id}`, { method: 'DELETE' });
    ElMessage.success('已删除');
    load();
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败');
  }
}

function copyText(text: string, label: string) {
  navigator.clipboard?.writeText(text).then(
    () => ElMessage.success(`${label}已复制`),
    () => ElMessage.warning(`请手动复制：${text}`)
  );
}

function copyToken(row: any) {
  copyText(row.token, 'Token');
}

function endpointHint(row: any) {
  return `${location.origin}/api/v1/sync/manifest?token=${row.token}`;
}

function copyEndpoint(row: any) {
  copyText(endpointHint(row), '清单端点');
}

onMounted(load);
</script>

<template>
  <div class="sync-page">
    <!-- KPI 卡片 -->
    <div class="kpi-grid">
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-blue"><el-icon :size="24"><Sort /></el-icon></div>
        <div>
          <div class="kpi-num">{{ stats.total }}</div>
          <div class="kpi-label">同步对总数</div>
        </div>
      </div>
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-green"><el-icon :size="24"><Sort /></el-icon></div>
        <div>
          <div class="kpi-num">{{ stats.twoWay }}</div>
          <div class="kpi-label">双向同步</div>
        </div>
      </div>
      <div class="kpi glass-card">
        <div class="kpi-icon kpi-amber"><el-icon :size="24"><Upload /></el-icon></div>
        <div>
          <div class="kpi-num">{{ stats.oneWay }}</div>
          <div class="kpi-label">单向同步</div>
        </div>
      </div>
    </div>

    <!-- 同步对卡片 -->
    <div class="panel glass-card">
      <div class="panel-head">
        <el-icon class="panel-icon"><Sort /></el-icon>
        <span class="panel-title">同步对管理</span>
        <span class="panel-sub">远端目录 + 独立 Token，配置到桌面端 / 同步引擎即可同步</span>
        <div class="head-right">
          <el-button type="primary" size="small" @click="openCreate">
            <el-icon><Plus /></el-icon>&nbsp;新建同步对
          </el-button>
        </div>
      </div>

      <div v-loading="loading" class="sync-grid page-enter-stagger">
        <div v-if="!pairs.length && !loading" class="empty">
          <el-icon :size="48" class="empty-icon"><Sort /></el-icon>
          <p>暂无同步对</p>
          <p class="empty-sub">创建同步对后，将 Token 配置到同步客户端即可开始同步</p>
        </div>

        <div v-for="row in pairs" :key="row.id" class="sync-card hover-lift">
          <div class="sync-head">
            <div class="sync-badge" :style="{ background: modeInfo(row.mode).color }">
              <el-icon><component :is="modeInfo(row.mode).icon" /></el-icon>
            </div>
            <div class="sync-info">
              <div class="sync-name">{{ storageName(row.storage_id) }}</div>
              <div class="sync-path">{{ row.remote_path }}</div>
            </div>
            <span class="status-badge" :class="syncState(row).cls">
              <i class="dot" :class="{ pulse: syncState(row).pulse }" />
              {{ syncState(row).label }}
            </span>
            <span class="status-badge" :class="modeBadge(row.mode)">{{ modeInfo(row.mode).label }}</span>
            <el-button link type="danger" size="small" @click="doDelete(row)">删除</el-button>
          </div>

          <div class="sync-body">
            <div class="sync-field">
              <span class="sf-label">本地目录</span>
              <span class="sf-value">{{ row.local_path || '由客户端决定' }}</span>
            </div>
            <div class="sync-field">
              <span class="sf-label">Token</span>
              <code class="sf-token">{{ row.token.slice(0, 16) }}…</code>
              <el-button link type="primary" size="small" @click="copyToken(row)">复制</el-button>
            </div>
            <div class="sync-field">
              <span class="sf-label">清单端点</span>
              <code class="sf-token sf-endpoint">{{ endpointHint(row) }}</code>
              <el-button link type="primary" size="small" @click="copyEndpoint(row)">复制</el-button>
            </div>
            <div class="sync-field">
              <span class="sf-label">创建时间</span>
              <span class="sf-value">{{ fmtTime(row.created_at) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 接入说明 -->
      <div v-if="pairs.length" class="hint">
        <p class="hint-title"><el-icon><Tools /></el-icon>&nbsp;同步客户端接入方式（CLI / 桌面端 / App 通用）</p>
        <ol>
          <li>GET&nbsp;<code>/api/v1/sync/manifest?token=*** Token&gt;</code> → 远端文件清单</li>
          <li>POST&nbsp;<code>/api/v1/sync/manifest/report?token=*** Token&gt;</code> → 上报本地清单</li>
          <li>POST&nbsp;<code>/api/v1/sync/pull?token=*** Token&gt;&amp;path=&lt;relPath&gt;</code> → 下载文件</li>
          <li>POST&nbsp;<code>/api/v1/sync/push?token=*** Token&gt;&amp;path=&lt;relPath&gt;</code> → 上传文件（原始字节体）</li>
          <li>POST&nbsp;<code>/api/v1/sync/delete?token=*** Token&gt;&amp;path=&lt;relPath&gt;</code> → 删除远端文件</li>
        </ol>
      </div>
    </div>

    <!-- 新建同步对 -->
    <el-dialog v-model="dialog" title="新建同步对" width="520px">
      <el-form label-width="100px">
        <el-form-item label="存储">
          <el-select v-model="form.storageId" style="width: 100%">
            <el-option v-for="s in storages" :key="s.id" :label="`${s.name} (${s.type})`" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="远端目录">
          <el-input v-model="form.remotePath" placeholder="以 / 开头，如 /sync/docs" />
        </el-form-item>
        <el-form-item label="同步模式">
          <el-radio-group v-model="form.mode">
            <el-radio value="two-way">双向同步</el-radio>
            <el-radio value="push">仅上传</el-radio>
            <el-radio value="pull">仅下载</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="本地目录">
          <el-input v-model="form.localPath" placeholder="可选，仅作为客户端默认值展示" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="doCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.sync-page {
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
.kpi-amber {
  background: linear-gradient(135deg, #f59e0b, #f97316);
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

/* ---------- 同步卡片 ---------- */
.sync-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 14px;
}
.sync-card {
  border-radius: 16px;
  padding: 16px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}
.sync-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.sync-badge {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: #fff;
}
.sync-info {
  flex: 1;
  min-width: 0;
}
.sync-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
}
.sync-path {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sync-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sync-field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.sf-label {
  width: 60px;
  flex-shrink: 0;
  color: var(--text-secondary);
}
.sf-value {
  flex: 1;
  color: var(--text);
  word-break: break-all;
}
.sf-token {
  flex: 1;
  font-size: 11px;
  background: var(--glass-bg-hover);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--text);
  word-break: break-all;
}
.sf-endpoint {
  max-width: 200px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------- 空状态 ---------- */
.empty {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 60px;
  color: var(--text-secondary);
}
.empty-icon {
  color: var(--accent);
  opacity: 0.6;
}
.empty-sub {
  font-size: 12px;
}

/* ---------- 接入说明 ---------- */
.hint {
  margin-top: 16px;
  padding: 14px 18px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.9;
}
.hint-title {
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
}
.hint code {
  background: var(--glass-bg-hover);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text);
}
</style>
