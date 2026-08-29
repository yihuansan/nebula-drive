<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, fmtSize, fmtTime } from '../api';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import RingChart from '../components/RingChart.vue';

const router = useRouter();
const auth = useAuthStore();
const profile = ref<any>(null);
const profileLoading = ref(false);
const hasLoaded = ref(false);
const showSkeleton = ref(false);
let skeletonTimer: ReturnType<typeof setTimeout> | null = null;
const profileForm = ref({ avatar: '', email: '', bio: '', phone: '' });
const loginHistory = ref<any[]>([]);
const searchHistory = ref<any[]>([]);
const storageUsage = ref<any[]>([]);

/* ---------- 设备管理 ---------- */
const sessions = ref<any[]>([]);
const sessionsLoading = ref(false);
const revokeAllLoading = ref(false);
const revokeLoading = ref<number | null>(null);

async function loadSessions() {
  sessionsLoading.value = true;
  try {
    const r = await api('/sessions');
    sessions.value = r.sessions || [];
  } catch { /* 忽略 */ }
  finally {
    sessionsLoading.value = false;
  }
}

function confirmDeleteSession(id: number, deviceName: string, isCurrent: boolean) {
  const message = isCurrent
    ? '删除当前设备将退出登录，确定要继续吗？'
    : `确定要删除「${deviceName}」吗？该设备将立即退出登录。`;
  
  ElMessageBox.confirm(message, '删除设备', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(() => {
    revokeSession(id, isCurrent);
  }).catch(() => {});
}

async function revokeSession(id: number, isCurrent?: boolean) {
  revokeLoading.value = id;
  try {
    await api(`/sessions/${id}`, { method: 'DELETE' });
    if (isCurrent) {
      // 删除当前设备，退出登录
      auth.logout();
      router.push('/login');
    } else {
      ElMessage.success('已删除该设备，它将立即退出登录');
      await loadSessions();
    }
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败');
  } finally {
    revokeLoading.value = null;
  }
}

async function revokeAllOtherSessions() {
  const otherCount = sessions.value.filter(s => !s.isCurrent).length;
  if (otherCount === 0) return;
  
  ElMessageBox.confirm(`确定要删除所有其他 ${otherCount} 个设备吗？这些设备将立即退出登录。`, '删除所有其他设备', {
    confirmButtonText: '全部删除',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(() => {
    doRevokeAll();
  }).catch(() => {});
}

async function doRevokeAll() {
  revokeAllLoading.value = true;
  try {
    const r = await api('/sessions/revoke-others', { method: 'POST' });
    ElMessage.success(`已撤销 ${r.revoked} 个设备，它们需要重新登录`);
    await loadSessions();
  } catch (e: any) {
    ElMessage.error(e.message || '撤销失败');
  } finally {
    revokeAllLoading.value = false;
  }
}

/* ---------- 2FA 双因素认证 ---------- */
const twoFaStatus = ref<{ enabled: boolean; secret?: string }>({ enabled: false });
const twoFaSetupVisible = ref(false);
const twoFaSecret = ref('');
const twoFaQrUri = ref('');
const twoFaQrDataUrl = ref('');
const twoFaCode = ref('');
const twoFaVerifying = ref(false);
const twoFaRecoveryCodes = ref<string[]>([]);
const twoFaRecoveryVisible = ref(false);

async function loadTwoFaStatus() {
  try {
    const r = await api('/2fa/status');
    twoFaStatus.value = r;
  } catch { /* ignore */ }
}

async function startTwoFaSetup() {
  try {
    const r = await api('/2fa/enable', { method: 'POST' });
    twoFaSecret.value = r.secret;
    twoFaQrUri.value = r.qrUri;
    twoFaQrDataUrl.value = r.qrDataUrl;
    twoFaSetupVisible.value = true;
  } catch (e: any) {
    ElMessage.error(e.message || '启用失败');
  }
}

async function verifyTwoFa() {
  twoFaVerifying.value = true;
  try {
    const r = await api('/2fa/verify', { method: 'POST', body: JSON.stringify({ code: twoFaCode.value }) });
    twoFaRecoveryCodes.value = r.recoveryCodes;
    twoFaRecoveryVisible.value = true;
    twoFaSetupVisible.value = false;
    twoFaCode.value = '';
    twoFaStatus.value = { enabled: true };
    ElMessage.success('2FA 已启用');
  } catch (e: any) {
    ElMessage.error(e.message || '验证失败');
  } finally {
    twoFaVerifying.value = false;
  }
}

async function disableTwoFa() {
  try {
    await api('/2fa/disable', { method: 'POST', body: JSON.stringify({ code: twoFaCode.value }) });
    twoFaStatus.value = { enabled: false };
    twoFaCode.value = '';
    ElMessage.success('2FA 已禁用');
  } catch (e: any) {
    ElMessage.error(e.message || '禁用失败');
  }
}

function copyRecoveryCodes() {
  const text = twoFaRecoveryCodes.value.join('\n');
  navigator.clipboard.writeText(text);
  ElMessage.success('恢复码已复制到剪贴板');
}
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

/* ---------- 存储用量汇总（环形图） ---------- */
const usageTotalBytes = computed(() => storageUsage.value.reduce((a, s) => a + (s.used || 0), 0));
const quotaTotalBytes = computed(() => {
  const q = storageUsage.value.reduce((a, s) => a + (s.quota || 0), 0);
  return q || ((auth.user as any)?.quota || 0);
});
const usagePercent = computed(() =>
  quotaTotalBytes.value > 0
    ? Math.min(100, Math.round((usageTotalBytes.value / quotaTotalBytes.value) * 100))
    : null
);

/* 设备图标：按设备名关键词匹配 */
function deviceIcon(name: string) {
  const n = (name || '').toLowerCase();
  if (/iphone|android|mobile|手机/.test(n)) return 'Iphone';
  if (/ipad|tablet|平板/.test(n)) return 'Cellphone';
  return 'Monitor';
}

onMounted(async () => {
  profileLoading.value = true;
  // 延迟 150ms 后才显示骨架屏，快速加载时不闪烁
  skeletonTimer = setTimeout(() => {
    if (!hasLoaded.value) showSkeleton.value = true;
  }, 150);
  // 核心数据并行加载
  await Promise.all([loadProfile(), loadLoginHistory(), loadSearchHistory(), loadTwoFaStatus(), loadSessions()]);
  // 立即显示页面，存储用量在后台加载
  if (skeletonTimer) { clearTimeout(skeletonTimer); skeletonTimer = null; }
  profileLoading.value = false;
  hasLoaded.value = true;
  showSkeleton.value = false;
  // 存储用量后台加载，不阻塞页面显示
  loadStorageUsage();
});
</script>

<template>
  <div class="profile-page">
    <!-- 骨架屏：仅在加载超过 150ms 时显示 -->
    <template v-if="showSkeleton">
      <div class="profile-layout">
        <div class="profile-card glass skeleton-card">
          <div class="skeleton-title"></div>
          <div class="skeleton-avatar"></div>
          <div class="skeleton-form">
            <div class="skeleton-row" v-for="i in 4" :key="'pf-sk-' + i"></div>
          </div>
        </div>
        <div class="profile-right">
          <div class="profile-card glass skeleton-card" v-for="i in 3" :key="'pr-sk-' + i">
            <div class="skeleton-title"></div>
            <div class="skeleton-content">
              <div class="skeleton-row" v-for="j in 3" :key="'pr-sk-row-' + i + '-' + j"></div>
            </div>
          </div>
        </div>
      </div>
    </template>
    <!-- 真实内容：带淡入动画 -->
    <div v-else class="profile-layout fade-in">
      <!-- 左侧：个人资料 -->
      <div class="profile-card glass">
        <h2 class="section-title">个人资料</h2>
        <div class="profile-body">
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
          <div v-if="!loginHistory.length" class="empty-tip">
            <el-icon :size="28"><Clock /></el-icon>
            <span>暂无登录记录</span>
          </div>
        </div>

        <!-- 存储用量 -->
        <div class="profile-card glass">
          <h2 class="section-title">存储用量</h2>
          <div v-if="storageUsage.length" class="usage-summary">
            <RingChart
              :percent="usagePercent"
              :center-text="usagePercent == null ? '不限' : usagePercent + '%'"
              :center-sub="fmtSize(usageTotalBytes)"
              :size="116"
            />
            <div class="usage-total-info">
              <div class="usage-total-num">{{ fmtSize(usageTotalBytes) }}</div>
              <div class="usage-total-cap">
                {{ quotaTotalBytes ? '总配额 ' + fmtSize(quotaTotalBytes) : '无配额限制' }}
              </div>
              <div class="usage-total-cap">{{ storageUsage.length }} 个存储</div>
            </div>
          </div>
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
          <div v-if="!searchHistory.length" class="empty-tip">
            <el-icon :size="28"><Search /></el-icon>
            <span>暂无搜索记录</span>
          </div>
        </div>

        <!-- 2FA 双因素认证 -->
        <div class="profile-card glass">
          <h2 class="section-title">
            双因素认证 (2FA)
            <span v-if="twoFaStatus.enabled" class="status-badge ok"><i class="dot" />已启用</span>
            <span v-else class="status-badge neutral">未启用</span>
          </h2>
          <p class="twoFa-desc">使用 Google Authenticator 或 1Password 等 TOTP 应用保护账号安全</p>

          <template v-if="!twoFaStatus.enabled">
            <el-button type="primary" size="small" @click="startTwoFaSetup">启用 2FA</el-button>
          </template>
          <template v-else>
            <div class="twoFa-enabled-actions">
              <el-input v-model="twoFaCode" placeholder="输入 6 位验证码" maxlength="6" size="small" style="width: 160px" />
              <el-button type="danger" size="small" @click="disableTwoFa">禁用 2FA</el-button>
            </div>
          </template>
        </div>

        <!-- 设备管理 -->
        <div class="profile-card glass">
          <h2 class="section-title">
            登录设备
            <el-button link type="danger" size="small" v-if="sessions.length > 1" @click="revokeAllOtherSessions" :loading="revokeAllLoading">
              删除所有其他设备
            </el-button>
          </h2>
          <div v-if="sessionsLoading" class="empty-tip">加载中...</div>
          <div v-else-if="!sessions.length" class="empty-tip">
            <el-icon :size="28"><Monitor /></el-icon>
            <span>暂无设备记录</span>
          </div>
          <div v-else>
            <div v-for="s in sessions" :key="s.id" class="session-item">
              <div class="session-info">
                <span class="session-dev-icon">
                  <el-icon><component :is="deviceIcon(s.deviceName)" /></el-icon>
                </span>
                <span class="session-device">{{ s.deviceName }}</span>
                <el-tag v-if="s.isCurrent" type="success" size="small">当前设备</el-tag>
                <span class="session-ip">{{ s.ipAddress }}</span>
              </div>
              <div class="session-meta">
                <span class="session-time">最后活跃：{{ fmtTime(s.lastActive) }}</span>
                <el-button
                  link
                  type="danger"
                  size="small"
                  :loading="revokeLoading === s.id"
                  @click="confirmDeleteSession(s.id, s.deviceName, s.isCurrent)"
                >
                  删除
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 2FA 设置对话框 -->
      <el-dialog v-model="twoFaSetupVisible" title="启用双因素认证" width="480px">
        <div class="twoFa-setup">
          <p>请使用 Google Authenticator、1Password 或其他 TOTP 应用扫描以下二维码：</p>
          <div class="twoFa-qr">
            <img :src="twoFaQrDataUrl" alt="2FA QR Code" />
          </div>
          <p class="twoFa-manual">或手动输入密钥：<code>{{ twoFaSecret }}</code></p>
          <el-input v-model="twoFaCode" placeholder="输入 6 位验证码" maxlength="6" size="large" style="margin-top: 16px" />
          <el-button type="primary" :loading="twoFaVerifying" @click="verifyTwoFa" style="margin-top: 16px">验证并启用</el-button>
        </div>
      </el-dialog>

      <!-- 恢复码对话框 -->
      <el-dialog v-model="twoFaRecoveryVisible" title="恢复码" width="500px">
        <div class="twoFa-recovery">
          <el-alert type="warning" :closable="false" style="margin-bottom: 16px">
            <template #title>请妥善保存以下恢复码</template>
            <template #default>每个恢复码只能使用一次，用于在丢失 authenticator 应用时恢复访问</template>
          </el-alert>
          <div class="recovery-codes">
            <code v-for="(c, i) in twoFaRecoveryCodes" :key="i" class="recovery-code">{{ c }}</code>
          </div>
          <el-button type="primary" size="small" @click="copyRecoveryCodes" style="margin-top: 16px">复制全部恢复码</el-button>
        </div>
      </el-dialog>
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

/* ---------- 骨架屏 + 淡入动画 ---------- */
.skeleton-card {
  pointer-events: none;
  user-select: none;
}
.skeleton-title {
  width: 40%;
  height: 16px;
  border-radius: 4px;
  margin-bottom: 20px;
  background: linear-gradient(90deg, var(--glass-bg) 25%, rgba(255,255,255,0.15) 50%, var(--glass-bg) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
}
.skeleton-avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  margin-bottom: 20px;
  background: linear-gradient(90deg, var(--glass-bg) 25%, rgba(255,255,255,0.15) 50%, var(--glass-bg) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
}
.skeleton-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.skeleton-row {
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--glass-bg) 25%, rgba(255,255,255,0.12) 50%, var(--glass-bg) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
}
.skeleton-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.fade-in {
  animation: fade-in-up 0.35s ease-out both;
}
@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.profile-layout {
  display: grid;
  grid-template-columns: 380px 1fr;
  gap: 20px;
  max-width: 1200px;
  width: 100%;
}
@media (max-width: 900px) {
  .profile-layout {
    grid-template-columns: 1fr;
  }
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
.usage-summary {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 6px 0 18px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--glass-border);
}
.usage-total-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.usage-total-num {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
}
.usage-total-cap {
  font-size: 12px;
  color: var(--text-secondary);
}
.session-dev-icon {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--glass-border);
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
  padding: 24px 0;
  color: var(--text-secondary);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.empty-tip .el-icon {
  color: var(--text-secondary);
  opacity: 0.6;
}

/* 2FA 样式 */
.twoFa-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.twoFa-enabled-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.twoFa-setup {
  text-align: center;
}
.twoFa-qr {
  margin: 16px 0;
}
.twoFa-qr img {
  width: 200px;
  height: 200px;
  border-radius: 12px;
  border: 1px solid var(--glass-border);
}
.twoFa-manual {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 12px;
}
.twoFa-manual code {
  background: var(--surface);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 14px;
}
.twoFa-recovery {
  text-align: center;
}
.recovery-codes {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-top: 16px;
}
.recovery-code {
  background: var(--surface);
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 14px;
  font-family: monospace;
  color: var(--text);
}

/* 设备管理样式 */
.session-item {
  padding: 12px 0;
  border-bottom: 1px solid var(--glass-border);
}
.session-item:last-child {
  border-bottom: none;
}
.session-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.session-device {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
}
.session-ip {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: monospace;
}
.session-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.session-time {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
