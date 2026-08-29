<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, fmtTime } from '../api';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';

const tab = ref<'created' | 'received'>('created');
const createdItems = ref<any[]>([]);
const receivedItems = ref<any[]>([]);
const loading = ref(false);

// 接收者管理
const recipientDialog = ref(false);
const currentShare = ref<any>(null);
const recipients = ref<any[]>([]);
const allUsers = ref<any[]>([]);
const newUserId = ref(0);
const newPermission = ref<'view' | 'download' | 'manage'>('view');

// 活动记录
const activityDialog = ref(false);
const activities = ref<any[]>([]);

async function loadCreated() {
  loading.value = true;
  try {
    const r = await api('/share-collab');
    createdItems.value = r.items;
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadReceived() {
  loading.value = true;
  try {
    const r = await api('/share-collab/received');
    receivedItems.value = r.items;
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function onTabChange() {
  if (tab.value === 'created') loadCreated();
  else loadReceived();
}

async function openRecipientDialog(item: any) {
  currentShare.value = item;
  recipientDialog.value = true;
  try {
    const r = await api(`/share-collab/${item.id}/recipients`);
    recipients.value = r.recipients;
    const ur = await api('/share-collab/users');
    allUsers.value = ur.users;
  } catch (e: any) {
    ElMessage.error(e.message || '加载接收者失败');
  }
}

async function addRecipient() {
  if (!newUserId.value) {
    ElMessage.warning('请选择用户');
    return;
  }
  try {
    await api(`/share-collab/${currentShare.value.id}/recipients`, {
      method: 'POST',
      body: JSON.stringify({ userId: newUserId.value, permission: newPermission.value }),
    });
    ElMessage.success('已添加');
    const r = await api(`/share-collab/${currentShare.value.id}/recipients`);
    recipients.value = r.recipients;
    newUserId.value = 0;
  } catch (e: any) {
    ElMessage.error(e.message || '添加失败');
  }
}

async function removeRecipient(userId: number) {
  try {
    await api(`/share-collab/${currentShare.value.id}/recipients/${userId}`, { method: 'DELETE' });
    ElMessage.success('已移除');
    const r = await api(`/share-collab/${currentShare.value.id}/recipients`);
    recipients.value = r.recipients;
  } catch (e: any) {
    ElMessage.error(e.message || '移除失败');
  }
}

async function updatePermission(userId: number, permission: string) {
  try {
    await api(`/share-collab/${currentShare.value.id}/recipients/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ permission }),
    });
    ElMessage.success('权限已更新');
    const r = await api(`/share-collab/${currentShare.value.id}/recipients`);
    recipients.value = r.recipients;
  } catch (e: any) {
    ElMessage.error(e.message || '更新失败');
  }
}

async function openActivityDialog(item: any) {
  currentShare.value = item;
  activityDialog.value = true;
  try {
    const r = await api(`/share-collab/${item.id}/activity`);
    activities.value = r.activity;
  } catch (e: any) {
    ElMessage.error(e.message || '加载活动记录失败');
  }
}

async function deleteShare(item: any) {
  try {
    await ElMessageBox.confirm(`确定删除共享「${item.name}」？`, '确认删除', { type: 'warning' });
    await api(`/share-collab/${item.id}`, { method: 'DELETE' });
    ElMessage.success('已删除');
    loadCreated();
  } catch { /* cancelled */ }
}

const permLabel = (p: string) => {
  switch (p) {
    case 'view': return '仅查看';
    case 'download': return '查看+下载';
    case 'manage': return '可管理';
    default: return p;
  }
};
const permBadge = (p: string) => (p === 'manage' ? 'danger' : p === 'download' ? 'warn' : 'info');

onMounted(() => {
  loadCreated();
});
</script>

<template>
  <div class="share-collab-page">
    <PageHeader
      icon="User"
      title="共享管理"
      subtitle="与指定用户共享文件，按人分配权限并追踪活动"
    />

    <el-tabs v-model="tab" @tab-change="onTabChange">
      <!-- 我创建的共享 -->
      <el-tab-pane label="我共享的" name="created">
        <EmptyState
          v-if="createdItems.length === 0"
          title="暂无共享"
          description="在文件管理中右键文件/文件夹，选择「共享给用户」创建共享"
        />
        <el-table v-else :data="createdItems" v-loading="loading" style="width: 100%">
          <el-table-column prop="name" label="名称" min-width="160" />
          <el-table-column prop="path" label="路径" min-width="200" />
          <el-table-column label="接收者" width="100">
            <template #default="{ row }">
              <el-badge :value="row.recipients?.length || 0" type="primary" />
            </template>
          </el-table-column>
          <el-table-column prop="expires_at" label="有效期" width="120">
            <template #default="{ row }">
              {{ row.expires_at ? fmtTime(row.expires_at) : '永久' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200">
            <template #default="{ row }">
              <el-button link size="small" @click="openRecipientDialog(row)">管理接收者</el-button>
              <el-button link size="small" @click="openActivityDialog(row)">活动记录</el-button>
              <el-button link size="small" type="danger" @click="deleteShare(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 共享给我的 -->
      <el-tab-pane label="共享给我的" name="received">
        <EmptyState
          v-if="receivedItems.length === 0"
          title="暂无共享给我的内容"
          description="别人通过「共享给用户」分享给你的内容会出现在这里"
        />
        <el-table v-else :data="receivedItems" v-loading="loading" style="width: 100%">
          <el-table-column prop="name" label="名称" min-width="160" />
          <el-table-column prop="path" label="路径" min-width="200" />
          <el-table-column label="权限" width="120">
            <template #default="{ row }">
              <span class="status-badge" :class="permBadge(row.permission)">
                {{ permLabel(row.permission) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="expires_at" label="有效期" width="120">
            <template #default="{ row }">
              {{ row.expires_at ? fmtTime(row.expires_at) : '永久' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button link size="small" @click="openActivityDialog(row)">活动记录</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 接收者管理对话框 -->
    <el-dialog v-model="recipientDialog" title="管理接收者" width="600px">
      <div v-if="currentShare" class="share-info">
        <p><strong>共享名称：</strong>{{ currentShare.name }}</p>
        <p><strong>路径：</strong>{{ currentShare.path }}</p>
      </div>

      <h4>当前接收者</h4>
      <el-table :data="recipients" size="small" style="width: 100%">
        <el-table-column prop="username" label="用户名" width="120" />
        <el-table-column prop="display_name" label="显示名" width="120" />
        <el-table-column label="权限" width="140">
          <template #default="{ row }">
            <el-select v-model="row.permission" size="small" @change="updatePermission(row.user_id, $event)">
              <el-option label="仅查看" value="view" />
              <el-option label="查看+下载" value="download" />
              <el-option label="可管理" value="manage" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80">
          <template #default="{ row }">
            <el-button link size="small" type="danger" @click="removeRecipient(row.user_id)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <h4 style="margin-top: 20px">添加接收者</h4>
      <div class="add-recipient">
        <el-select v-model="newUserId" filterable placeholder="选择用户" style="width: 200px">
          <el-option v-for="u in allUsers" :key="u.id" :label="u.display_name || u.username" :value="u.id" />
        </el-select>
        <el-select v-model="newPermission" style="width: 140px">
          <el-option label="仅查看" value="view" />
          <el-option label="查看+下载" value="download" />
          <el-option label="可管理" value="manage" />
        </el-select>
        <el-button type="primary" @click="addRecipient">添加</el-button>
      </div>
    </el-dialog>

    <!-- 活动记录对话框 -->
    <el-dialog v-model="activityDialog" title="活动记录" width="500px">
      <el-table :data="activities" size="small" style="width: 100%">
        <el-table-column prop="username" label="用户" width="100" />
        <el-table-column label="操作" width="80">
          <template #default="{ row }">
            <el-tag :type="row.action === 'download' ? 'warning' : 'info'" size="small">
              {{ row.action === 'download' ? '下载' : row.action === 'view' ? '查看' : '转存' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="path" label="路径" min-width="150" />
        <el-table-column prop="created_at" label="时间" width="160" />
      </el-table>
    </el-dialog>
  </div>
</template>

<style scoped>
.share-collab-page {
  padding: 20px;
}
.page-header {
  padding: 16px 20px;
  margin-bottom: 20px;
  border-radius: 18px;
}
.page-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
}
.empty-state {
  text-align: center;
  padding: 60px 0;
  color: var(--text-secondary, #888);
}
.empty-state p {
  margin: 8px 0;
}
.empty-state .tip {
  font-size: 13px;
  color: var(--text-secondary);
}
.share-info {
  margin-bottom: 16px;
  padding: 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
}
.add-recipient {
  display: flex;
  gap: 12px;
  align-items: center;
}
</style>
