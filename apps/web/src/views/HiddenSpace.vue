<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api';
import { ElMessage } from 'element-plus';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';

const loading = ref(false);
const entries = ref<any[]>([]);
const storageId = ref<number | null>(null);
const storages = ref<any[]>([]);
const state = ref<'set-password' | 'unlock' | 'unlocked'>('unlock');
const password = ref('');
const confirmPassword = ref('');

onMounted(async () => {
  try {
    const r = await api('/storages');
    storages.value = r.storages;
    if (r.storages.length) storageId.value = r.storages[0].id;
    // 检查是否已设置密码
    const status = await api('/hidden-space/status');
    if (!status.hasPassword) {
      state.value = 'set-password';
    }
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败');
  }
});

async function setPassword() {
  if (password.value.length < 4) {
    ElMessage.warning('密码至少 4 位');
    return;
  }
  if (password.value !== confirmPassword.value) {
    ElMessage.warning('两次密码不一致');
    return;
  }
  try {
    await api('/hidden-space/set-password', {
      method: 'POST',
      body: JSON.stringify({ storageId: storageId.value, password: password.value }),
    });
    ElMessage.success('密码已设置');
    state.value = 'unlock';
    password.value = '';
    confirmPassword.value = '';
  } catch (e: any) {
    ElMessage.error(e.message || '设置失败');
  }
}

async function unlock() {
  try {
    const r = await api('/hidden-space/unlock', {
      method: 'POST',
      body: JSON.stringify({ storageId: storageId.value, password: password.value }),
    });
    if (r.unlocked) {
      state.value = 'unlocked';
      ElMessage.success('已解锁');
      await load();
    } else {
      ElMessage.error('密码错误');
    }
  } catch (e: any) {
    ElMessage.error(e.message || '解锁失败');
  }
}

async function load() {
  if (!storageId.value) return;
  loading.value = true;
  try {
    const r = await api(`/files?storageId=${storageId.value}&path=/hidden&sort=name&order=asc`);
    entries.value = r.entries || [];
  } catch (e: any) {
    // 如果目录不存在，显示空列表
    if (e.message?.includes('ENOENT') || e.message?.includes('not found')) {
      entries.value = [];
    } else {
      ElMessage.error(e.message || '加载隐藏空间失败');
    }
  } finally {
    loading.value = false;
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
  <div class="hidden-page">
    <PageHeader
      icon="Lock"
      title="隐藏空间"
      :subtitle="state === 'unlocked' ? '已解锁 · 仅你可见的私密区域' : '密码保护的私密区域，仅你可见'"
    >
      <template #actions>
        <el-select v-if="state === 'unlocked'" v-model="storageId" size="small" @change="load" style="width: 180px">
          <el-option v-for="s in storages" :key="s.id" :label="s.name" :value="s.id" />
        </el-select>
        <span v-if="state === 'unlocked'" class="status-badge ok"><i class="dot pulse" />已解锁</span>
      </template>
    </PageHeader>

    <!-- 设置密码 -->
    <div v-if="state === 'set-password'" class="setup-panel">
      <div class="setup-card glass">
        <div class="setup-icon">
          <el-icon :size="56" color="var(--accent)"><Lock /></el-icon>
        </div>
        <h2 class="setup-title">启用隐藏空间</h2>
        <p class="setup-desc">
          隐藏空间是一个加密的私密区域，用于存放敏感文件。<br />
          首次使用需要设置一个访问密码。
        </p>
        <div class="setup-form">
          <div class="form-row">
            <label>访问密码</label>
            <el-input
              v-model="password"
              type="password"
              placeholder="请输入密码（至少 4 位）"
              :show-password="true"
            />
          </div>
          <div class="form-row">
            <label>确认密码</label>
            <el-input
              v-model="confirmPassword"
              type="password"
              placeholder="请再次输入密码"
              :show-password="true"
            />
          </div>
          <div class="form-actions">
            <el-button type="primary" size="large" @click="setPassword">
              <el-icon><Check /></el-icon>&nbsp;确认设置
            </el-button>
          </div>
        </div>
        <div class="setup-tip">
          <el-icon color="#f59e0b"><Warning /></el-icon>
          <span>请牢记密码，遗忘后无法找回</span>
        </div>
      </div>
    </div>

    <!-- 解锁界面 -->
    <div v-else-if="state === 'unlock'" class="unlock-panel">
      <div class="unlock-card glass">
        <div class="unlock-icon">
          <el-icon :size="48" color="var(--accent)"><Lock /></el-icon>
        </div>
        <h2 class="unlock-title">解锁隐藏空间</h2>
        <p class="unlock-desc">请输入访问密码</p>
        <div class="unlock-input">
          <el-input
            v-model="password"
            type="password"
            placeholder="请输入密码"
            :show-password="true"
            size="large"
            @keyup.enter="unlock"
          >
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </div>
        <el-button type="primary" size="large" class="unlock-btn" @click="unlock">
          解锁
        </el-button>
      </div>
    </div>

    <!-- 文件列表 -->
    <div v-else class="hidden-grid page-enter-stagger" v-loading="loading">
      <div v-for="(row, i) in entries" :key="row.path" class="hidden-item glass-card hover-lift" :style="{ '--i': i }">
        <el-icon :size="36" :color="row.isDir ? '#409eff' : '#909399'">
          <Folder v-if="row.isDir" />
          <Document v-else />
        </el-icon>
        <div class="hidden-name">{{ row.name }}</div>
        <div class="hidden-meta">{{ row.isDir ? '文件夹' : fmtSize(row.size) }}</div>
      </div>
      <EmptyState
        v-if="!loading && !entries.length"
        title="隐藏空间为空"
        description="将文件移动到 /hidden 目录即可"
      />
    </div>
  </div>
</template>

<style scoped>
.hidden-page { padding: 20px; }
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  margin-bottom: 20px;
}
.page-header h2 { margin: 0; font-size: 20px; }

/* 设置密码面板 */
.setup-panel {
  display: flex;
  justify-content: center;
  padding: 40px 20px;
}
.setup-card {
  max-width: 480px;
  width: 100%;
  padding: 48px 40px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}
.setup-icon {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: var(--accent-soft, rgba(59, 130, 246, 0.1));
  display: grid;
  place-items: center;
}
.setup-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--text);
}
.setup-desc {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
  text-align: center;
}
.setup-form {
  width: 100%;
  margin-top: 12px;
}
.form-row {
  margin-bottom: 16px;
  text-align: left;
}
.form-row label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 6px;
}
.form-actions {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}
.form-actions .el-button {
  min-width: 180px;
}
.setup-tip {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 8px;
}

/* 解锁面板 */
.unlock-panel {
  display: flex;
  justify-content: center;
  padding: 60px 20px;
}
.unlock-card {
  max-width: 380px;
  width: 100%;
  padding: 48px 40px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.unlock-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--accent-soft, rgba(59, 130, 246, 0.1));
  display: grid;
  place-items: center;
}
.unlock-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text);
}
.unlock-desc {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
}
.unlock-input {
  width: 100%;
  margin-top: 8px;
}
.unlock-btn {
  width: 100%;
  margin-top: 12px;
}

/* 文件网格 */
.hidden-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 14px;
}
.hidden-item {
  border-radius: 18px;
  padding: 18px 14px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.hidden-name {
  font-size: 14px;
  font-weight: 500;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hidden-meta { font-size: 12px; color: var(--text-secondary); }
.empty {
  grid-column: 1 / -1;
  text-align: center;
  padding: 60px 20px;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.empty p { margin: 0; }
.empty .tip { font-size: 12px; }
</style>
