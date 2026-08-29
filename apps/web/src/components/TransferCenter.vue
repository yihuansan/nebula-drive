<script setup lang="ts">
import { computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useTransferStore, type TransferTask } from '../stores/transfer';
import { api, fmtSize } from '../api';

const transfer = useTransferStore();

const activeTasks = computed(() => transfer.tasks.filter((t) => t.status === 'active'));
const finishedTasks = computed(() => transfer.tasks.filter((t) => t.status !== 'active'));

function statusText(t: TransferTask) {
  if (t.status === 'active') return t.kind === 'upload' ? `上传中 ${t.percent}%` : '下载中…';
  if (t.status === 'error') return t.error || '失败';
  return '已完成';
}

async function cancelTask(t: TransferTask) {
  try {
    await ElMessageBox.confirm(`确定取消「${t.name}」吗？已上传的分片将被清理。`, '取消任务', { type: 'warning' });
  } catch {
    return;
  }
  if (t.kind === 'upload' && t.uploadId) {
    try {
      await api(`/upload/${t.uploadId}`, { method: 'DELETE' });
    } catch { /* 会话可能已失效 */ }
  }
  transfer.remove(t.id);
  ElMessage.success('任务已取消');
}

function removeTask(t: TransferTask) {
  transfer.remove(t.id);
}

function clearFinished() {
  transfer.clearFinished();
}
</script>

<template>
  <div v-if="transfer.hasTasks" class="transfer-center">
    <!-- 展开面板 -->
    <div v-if="transfer.expanded" class="tc-panel">
      <div class="tc-panel-head">
        <span class="tc-panel-title">
          <el-icon><Promotion /></el-icon>
          传输中心
          <span v-if="activeTasks.length" class="tc-count">{{ activeTasks.length }} 进行中</span>
        </span>
        <span class="tc-panel-actions">
          <el-button v-if="finishedTasks.length" link size="small" @click="clearFinished">清空已完成</el-button>
          <el-button link size="small" @click="transfer.expanded = false">
            <el-icon><ArrowDown /></el-icon>
          </el-button>
        </span>
      </div>
      <div class="tc-list">
        <div v-for="t in [...activeTasks, ...finishedTasks]" :key="t.id" class="tc-item" :class="{ 'is-err': t.status === 'error' }">
          <span class="tc-kind" :class="t.kind">
            <el-icon><UploadFilled v-if="t.kind === 'upload'" /><Download v-else /></el-icon>
          </span>
          <div class="tc-body">
            <div class="tc-name" :title="t.name">{{ t.name }}</div>
            <div class="tc-meta">
              <span class="tc-size">{{ t.size ? fmtSize(t.size) : '-' }}</span>
              <span class="tc-status">{{ statusText(t) }}</span>
            </div>
            <el-progress
              v-if="t.status === 'active'"
              :percentage="t.percent"
              :stroke-width="6"
              :show-text="false"
              class="tc-progress"
            />
          </div>
          <span class="tc-ops">
            <el-button v-if="t.status === 'active'" link size="small" title="取消" @click="cancelTask(t)">
              <el-icon><Close /></el-icon>
            </el-button>
            <el-button v-else link size="small" title="移除记录" @click="removeTask(t)">
              <el-icon><Close /></el-icon>
            </el-button>
          </span>
        </div>
        <div v-if="!transfer.tasks.length" class="tc-empty">暂无传输任务</div>
      </div>
    </div>

    <!-- 悬浮胶囊 -->
    <div class="tc-capsule" :class="{ expanded: transfer.expanded }" @click="transfer.expanded = !transfer.expanded">
      <el-icon class="tc-capsule-icon"><Promotion /></el-icon>
      <span class="tc-capsule-text">
        {{ activeTasks.length ? `传输中 ${activeTasks.length}` : '传输中心' }}
      </span>
      <span v-if="activeTasks.length" class="tc-capsule-dot" />
      <el-icon class="tc-capsule-arrow"><ArrowUp v-if="!transfer.expanded" /><ArrowDown v-else /></el-icon>
    </div>
  </div>
</template>

<style scoped>
.transfer-center {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 2100;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}

.tc-capsule {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 999px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  box-shadow: var(--shadow);
  cursor: pointer;
  font-size: 13px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  position: relative;
}
.tc-capsule:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-hover);
}
.tc-capsule-icon {
  color: var(--accent);
  font-size: 16px;
}
.tc-capsule-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  animation: tc-pulse 1.4s ease-in-out infinite;
}
.tc-capsule-arrow {
  font-size: 12px;
  opacity: 0.65;
}
@keyframes tc-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.8); }
}
@media (prefers-reduced-motion: reduce) {
  .tc-capsule, .tc-capsule-dot { animation: none; transition: none; }
}

.tc-panel {
  width: 380px;
  max-height: 460px;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow: var(--shadow-hover);
  overflow: hidden;
}
.tc-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--glass-border);
}
.tc-panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
}
.tc-panel-title .el-icon {
  color: var(--accent);
}
.tc-count {
  font-size: 12px;
  font-weight: 400;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
}
.tc-panel-actions {
  display: flex;
  align-items: center;
}

.tc-list {
  overflow-y: auto;
  padding: 8px;
}
.tc-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  transition: background 0.15s ease;
}
.tc-item:hover {
  background: var(--glass-bg-hover);
}
.tc-kind {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 15px;
}
.tc-kind.download {
  background: color-mix(in srgb, #10b981 16%, transparent);
  color: #10b981;
}
.tc-body {
  flex: 1;
  min-width: 0;
}
.tc-name {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tc-meta {
  display: flex;
  gap: 8px;
  font-size: 11.5px;
  opacity: 0.72;
  margin-top: 2px;
}
.is-err .tc-status {
  color: #ef4444;
  opacity: 1;
}
.tc-progress {
  margin-top: 4px;
}
.tc-empty {
  padding: 24px 0;
  text-align: center;
  font-size: 13px;
  opacity: 0.6;
}

@media (max-width: 480px) {
  .transfer-center {
    right: 12px;
    bottom: 12px;
  }
  .tc-panel {
    width: calc(100vw - 24px);
  }
}
</style>
