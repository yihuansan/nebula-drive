<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api';
import { ElMessage } from 'element-plus';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';

const loading = ref(false);
const subscriptions = ref<any[]>([]);
const transferHistory = ref<any[]>([]);
const activeTab = ref('subscriptions');

// 转存分享对话框
const transferDialog = ref(false);
const transferUrl = ref('');
const transferDest = ref('/');
const transferBusy = ref(false);
const transferResult = ref<any | null>(null);
const transferError = ref('');

onMounted(async () => {
  await load();
});

async function load() {
  loading.value = true;
  try {
    const [subs, transfers] = await Promise.all([
      api('/subscriptions'),
      api('/transfers'),
    ]);
    subscriptions.value = subs.subscriptions;
    transferHistory.value = transfers.transfers;
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function openTransfer() {
  transferUrl.value = '';
  transferDest.value = '/';
  transferResult.value = null;
  transferError.value = '';
  transferDialog.value = true;
}

function validateUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function doTransfer() {
  const url = transferUrl.value.trim();
  if (!url) {
    transferError.value = '请输入分享链接';
    return;
  }
  if (!validateUrl(url)) {
    transferError.value = '分享链接格式不正确，请输入有效的 URL（需以 http:// 或 https:// 开头）';
    return;
  }
  transferBusy.value = true;
  transferError.value = '';
  try {
    const r = await api('/transfers', {
      method: 'POST',
      body: JSON.stringify({ shareUrl: url, destPath: transferDest.value }),
    });
    transferResult.value = r;
    ElMessage.success(r.message || `转存成功：${r.transferred ?? 0} 个文件`);
    await load();
  } catch (e: any) {
    transferError.value = e.message || '转存失败';
  } finally {
    transferBusy.value = false;
  }
}

function closeTransfer() {
  transferDialog.value = false;
}

// SQLite datetime('now') 为 UTC（"YYYY-MM-DD HH:MM:SS" 格式），需按 UTC 解析
function fmtTime(ts: string) {
  return new Date(ts.replace(' ', 'T') + 'Z').toLocaleString('zh-CN');
}
</script>

<template>
  <div class="subs-page">
    <PageHeader
      icon="Download"
      title="转存和订阅"
      subtitle="订阅他人分享，新内容自动同步；把分享文件一键转存到自己的网盘"
    >
      <template #actions>
        <el-button type="primary" @click="openTransfer">
          <el-icon><Download /></el-icon>&nbsp;转存分享
        </el-button>
      </template>
    </PageHeader>

    <el-tabs v-model="activeTab">
      <el-tab-pane label="我的订阅" name="subscriptions">
        <div class="subs-list page-enter-stagger" v-loading="loading">
          <div v-for="(sub, i) in subscriptions" :key="sub.id" class="sub-item glass-card hover-lift" :style="{ '--i': i }">
            <el-icon :size="28" color="#409eff"><Share /></el-icon>
            <div class="sub-info">
              <div class="sub-title">{{ sub.title }}</div>
              <div class="sub-meta">
                <span>分享者：{{ sub.sharer }}</span>
                <span>· 创建于 {{ fmtTime(sub.createdAt) }}</span>
              </div>
            </div>
            <span v-if="sub.autoRefresh" class="status-badge ok"><i class="dot pulse" />自动刷新</span>
          </div>
          <EmptyState
            v-if="!loading && !subscriptions.length"
            title="暂无订阅"
            description="还没有订阅任何分享，转存分享后即可在此查看更新"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="转存记录" name="transfers">
        <div class="transfer-list page-enter-stagger" v-loading="loading">
          <div v-for="(t, i) in transferHistory" :key="t.id" class="transfer-item glass-card hover-lift" :style="{ '--i': i }">
            <el-icon :size="28" color="#16a34a"><Download /></el-icon>
            <div class="transfer-info">
              <div class="transfer-title">{{ t.title }}</div>
              <div class="transfer-meta">
                <span>转存了 {{ t.fileCount }} 个文件</span>
                <span>· {{ fmtTime(t.createdAt) }}</span>
              </div>
            </div>
          </div>
          <EmptyState
            v-if="!loading && !transferHistory.length"
            title="暂无转存记录"
            description="使用「转存分享」功能后，记录会显示在这里"
          />
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 转存分享对话框 -->
    <el-dialog v-model="transferDialog" title="转存分享" width="480px">
      <div class="form-tip">输入分享链接，将其中的文件转存到您的网盘</div>
      <div class="transfer-form">
        <div class="form-label">分享链接</div>
        <el-input v-model="transferUrl" placeholder="https://example.com/s/xxxx" @keyup.enter="doTransfer" />
        <div class="form-label" style="margin-top: 12px">目标目录</div>
        <el-input v-model="transferDest" placeholder="/" />
      </div>
      <div v-if="transferError" class="form-tip error" style="margin-top: 12px">{{ transferError }}</div>
      <div v-if="transferResult" class="form-tip success" style="margin-top: 12px">
        {{ transferResult.message || `转存成功：${transferResult.transferred ?? 0} 个文件` }}
      </div>
      <template #footer>
        <el-button @click="closeTransfer">关闭</el-button>
        <el-button type="primary" :loading="transferBusy" @click="doTransfer">
          开始转存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.subs-page { padding: 20px; }
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  margin-bottom: 20px;
}
.page-header h2 { margin: 0; font-size: 20px; }
.subs-list, .transfer-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sub-item, .transfer-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
}
.sub-info, .transfer-info { flex: 1; min-width: 0; }
.sub-title, .transfer-title {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub-meta, .transfer-meta { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--text-secondary);
}
.empty .el-icon { opacity: 0.5; }
.empty h3 { margin: 0; font-size: 16px; font-weight: 600; color: var(--text); }
.empty p { margin: 0; font-size: 13px; }
.transfer-form { margin-top: 12px; }
.form-label { font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; }
.form-tip { font-size: 13px; color: var(--text-secondary); }
.form-tip.success { color: #16a34a; }
.form-tip.error { color: #dc2626; }
</style>
