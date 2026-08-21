<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { api, fmtSize, fmtTime } from '../api';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();
const profile = ref<any>(null);
const profileLoading = ref(false);
const profileForm = ref({ avatar: '', email: '', bio: '', phone: '' });
const loginHistory = ref<any[]>([]);
const searchHistory = ref<any[]>([]);
const storageUsage = ref<any[]>([]);
const saving = ref(false);
const avatarUploading = ref(false);
const avatarPreviewVisible = ref(false);

function previewAvatar() {
  if (profileForm.value.avatar) {
    avatarPreviewVisible.value = true;
  } else {
    ElMessage.info('暂无头像');
  }
}

/* ---------- 修改账号和密码 ---------- */
const accountForm = ref({ username: '', oldPassword: '', newPassword: '', confirmPassword: '' });
const accountSaving = ref(false);

async function saveAccount() {
  const { username, oldPassword, newPassword, confirmPassword } = accountForm.value;
  if (!username) return ElMessage.warning('请输入新用户名');
  if (username.length < 3 || username.length > 32) return ElMessage.warning('用户名长度 3-32 位');
  if (newPassword && newPassword !== confirmPassword) return ElMessage.warning('两次密码不一致');
  if (newPassword && newPassword.length < 8) return ElMessage.warning('新密码至少 8 位');
  accountSaving.value = true;
  try {
    await api('/profile/account', {
      method: 'PUT',
      body: JSON.stringify({
        username: username || undefined,
        oldPassword: oldPassword || undefined,
        newPassword: newPassword || undefined,
      }),
    });
    ElMessage.success('账号已更新');
    accountForm.value = { username: '', oldPassword: '', newPassword: '', confirmPassword: '' };
    // 刷新用户信息
    await auth.me();
  } catch (e: any) {
    ElMessage.error(e.message || '更新失败');
  } finally {
    accountSaving.value = false;
  }
}

async function loadProfile() {
  try {
    const r = await api('/profile');
    profile.value = r.profile;
    profileForm.value = {
      avatar: r.profile.avatar || '',
      email: r.profile.email || '',
      bio: r.profile.bio || '',
      phone: r.profile.phone || '',
    };
  } catch (e: any) {
    ElMessage.error(e.message || '加载资料失败');
  }
}

async function saveProfile() {
  saving.value = true;
  try {
    await api('/profile', { method: 'PUT', body: JSON.stringify(profileForm.value) });
    ElMessage.success('资料已更新');
    await loadProfile();
  } catch (e: any) {
    ElMessage.error(e.message || '更新失败');
  } finally {
    saving.value = false;
  }
}

/** 头像文件上传 */
async function uploadAvatar(file: File) {
  if (!file.type.startsWith('image/')) {
    ElMessage.error('请选择图片文件');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.error('头像不能超过 5MB');
    return;
  }
  avatarUploading.value = true;
  try {
    const formData = new FormData();
    formData.append('file', file);
    const token = localStorage.getItem('nebula_token') || '';
    const res = await fetch('/api/v1/avatar', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '上传失败');
    profileForm.value.avatar = data.data.avatar;
    await saveProfile();
    ElMessage.success('头像已更新');
  } catch (e: any) {
    ElMessage.error(e.message || '上传失败');
  } finally {
    avatarUploading.value = false;
  }
}

function handleAvatarChange(file: any) {
  if (file.raw) uploadAvatar(file.raw);
}

async function loadLoginHistory() {
  try {
    const r = await api('/logs?type=login&size=20&mine=true');
    loginHistory.value = r.rows || [];
  } catch { /* 忽略 */ }
}

async function loadSearchHistory() {
  try {
    const r = await api('/search-history');
    searchHistory.value = r.history || [];
  } catch { /* 忽略 */ }
}

async function clearSearchHistory() {
  try {
    await api('/search-history', { method: 'DELETE' });
    searchHistory.value = [];
    ElMessage.success('搜索历史已清除');
  } catch (e: any) {
    ElMessage.error(e.message || '清除失败');
  }
}

async function loadStorageUsage() {
  try {
    const r = await api('/storages');
    storageUsage.value = r.storages || [];
  } catch { /* 忽略 */ }
}

function usageColor(pct: number) {
  if (pct > 80) return '#ef4444';
  if (pct > 50) return '#f59e0b';
  return '#16a34a';
}

onMounted(async () => {
  profileLoading.value = true;
  await Promise.all([loadProfile(), loadLoginHistory(), loadSearchHistory(), loadStorageUsage()]);
  profileLoading.value = false;
});
</script>

<template>
  <div class="profile-page">
    <div class="profile-layout">
      <!-- 左侧：个人资料 -->
      <div class="profile-card glass">
        <h2 class="section-title">个人资料</h2>
        <div v-loading="profileLoading" class="profile-body">
          <div class="avatar-section">
            <el-avatar :size="80" :src="profileForm.avatar || undefined" class="avatar-clickable" @click="previewAvatar">
              <el-icon><User /></el-icon>
            </el-avatar>
            <div class="avatar-info">
              <div class="avatar-name">{{ auth.user?.username || '加载中...' }}</div>
              <div class="avatar-role">{{ auth.user?.role === 'admin' ? '管理员' : '普通用户' }}</div>
            </div>
          </div>
          <el-form label-width="80px" style="margin-top: 20px">
            <el-form-item label="头像">
              <el-upload
                :show-file-list="false"
                :http-request="() => {}"
                :on-change="handleAvatarChange"
                accept="image/*"
              >
                <el-button size="small" :loading="avatarUploading">
                  <el-icon><Upload /></el-icon>&nbsp;上传头像
                </el-button>
              </el-upload>
            </el-form-item>
            <el-form-item label="邮箱">
              <el-input v-model="profileForm.email" placeholder="邮箱地址" />
            </el-form-item>
            <el-form-item label="手机">
              <el-input v-model="profileForm.phone" placeholder="手机号码" />
            </el-form-item>
            <el-form-item label="简介">
              <el-input v-model="profileForm.bio" type="textarea" :rows="3" placeholder="个人简介" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="saveProfile">保存资料</el-button>
            </el-form-item>
          </el-form>

          <!-- 修改账号和密码 -->
          <h2 class="section-title" style="margin-top: 28px">修改账号</h2>
          <el-form label-width="80px">
            <el-form-item label="用户名">
              <el-input v-model="accountForm.username" placeholder="新用户名（留空则不修改）" />
            </el-form-item>
            <el-form-item label="原密码">
              <el-input v-model="accountForm.oldPassword" type="password" placeholder="原密码（修改密码时必填）" show-password />
            </el-form-item>
            <el-form-item label="新密码">
              <el-input v-model="accountForm.newPassword" type="password" placeholder="新密码（至少 8 位）" show-password />
            </el-form-item>
            <el-form-item label="确认密码">
              <el-input v-model="accountForm.confirmPassword" type="password" placeholder="再次输入新密码" show-password />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="accountSaving" @click="saveAccount">保存修改</el-button>
            </el-form-item>
          </el-form>
        </div>
      </div>

      <!-- 右侧：登录历史 + 存储用量 + 搜索历史 -->
      <div class="profile-right">
        <!-- 登录历史 -->
        <div class="profile-card glass">
          <h2 class="section-title">登录历史</h2>
          <el-table :data="loginHistory" max-height="200" size="small">
            <el-table-column label="时间" width="160">
              <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="IP" width="120" prop="ip" />
            <el-table-column label="设备" min-width="150" prop="ua" show-overflow-tooltip />
            <el-table-column label="状态" width="60">
              <template #default="{ row }">
                <el-tag :type="row.success ? 'success' : 'danger'" size="small">
                  {{ row.success ? '成功' : '失败' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
          <div v-if="!loginHistory.length" class="empty-tip">暂无登录记录</div>
        </div>

        <!-- 存储用量 -->
        <div class="profile-card glass">
          <h2 class="section-title">存储用量</h2>
          <div v-for="s in storageUsage" :key="s.id" class="storage-item">
            <div class="storage-name">{{ s.name }} <el-tag size="small" type="info">{{ s.files }} 个文件</el-tag></div>
            <el-progress
              :percentage="s.quota ? Math.min(100, Math.round((s.used / s.quota) * 100)) : 100"
              :color="s.quota ? usageColor(Math.round((s.used / s.quota) * 100)) : '#409eff'"
              :stroke-width="10"
            />
            <div class="storage-detail">
              <span>{{ s.used ? fmtSize(s.used) : '0 B' }}</span>
              <span v-if="s.quota">/ {{ fmtSize(s.quota) }}</span>
            </div>
          </div>
        </div>

        <!-- 搜索历史 -->
        <div class="profile-card glass">
          <h2 class="section-title">
            搜索历史
            <el-button v-if="searchHistory.length" link type="danger" size="small" @click="clearSearchHistory">清除</el-button>
          </h2>
          <div v-for="h in searchHistory" :key="h.id" class="search-history-item">
            <el-icon><Search /></el-icon>
            <span class="search-history-query">{{ h.query }}</span>
            <span class="search-history-time">{{ fmtTime(h.created_at) }}</span>
          </div>
          <div v-if="!searchHistory.length" class="empty-tip">暂无搜索记录</div>
        </div>
      </div>
    </div>
  </div>

  <!-- 头像预览对话框 -->
  <el-dialog v-model="avatarPreviewVisible" title="头像预览" width="640px">
    <div style="text-align: center; padding: 20px;">
      <img :src="profileForm.avatar" alt="头像" style="max-width: 100%; max-height: 600px; border-radius: 16px;" />
    </div>
  </el-dialog>
</template>

<style scoped>
.profile-page {
  display: flex;
  justify-content: center;
  padding: 20px;
}
.profile-layout {
  display: grid;
  grid-template-columns: 380px 1fr;
  gap: 20px;
  max-width: 1200px;
  width: 100%;
}
.profile-card {
  border-radius: 20px;
  padding: 20px;
}
.profile-right {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.avatar-section {
  display: flex;
  align-items: center;
  gap: 16px;
}
.avatar-clickable {
  cursor: pointer;
  transition: all 0.2s;
}
.avatar-clickable:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
.avatar-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
}
.avatar-role {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}
.storage-item {
  margin-bottom: 16px;
}
.storage-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 6px;
}
.storage-detail {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}
.search-history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--accent-soft);
  margin-bottom: 8px;
  font-size: 13px;
}
.search-history-query {
  flex: 1;
  color: var(--text);
}
.search-history-time {
  font-size: 12px;
  color: var(--text-secondary);
}
.empty-tip {
  text-align: center;
  padding: 20px 0;
  color: var(--text-secondary);
  font-size: 13px;
}
</style>
