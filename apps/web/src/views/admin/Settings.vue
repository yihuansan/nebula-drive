<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../api';
import { useTheme, THEMES, type ThemeKey } from '../../useTheme';

const { setTheme } = useTheme();

const form = ref({
  appName: 'NebulaDrive 星云网盘',
  logo: '',
  notice: '',
  copyright: '',
  aboutText: '',
  contactEmail: '',
  registerEnabled: true,
  minPasswordLen: 8,
  sessionTimeoutHours: 168,
  uploadChunkSizeMB: 5,
  maxFileSizeGB: 0,
  shareDefaultExpireDays: 0,
  recycleRetentionDays: 0,
  brandColor: '',
  theme: 'light-glass',
  bgType: 'theme',
  bgImage: '',
  bgGradientFrom: '#9fc2ff',
  bgGradientTo: '#cdb4ef',
  bgGradientAngle: 135,
  bgColor: '#1e2634',
  bgOverlay: 40,
  loginCaptchaThreshold: 3,
  smtpEnabled: false,
  smtpHost: '',
  smtpPort: 465,
  smtpSecure: true,
  smtpUser: '',
  smtpPassword: '',
  smtpFrom: '',
  smtpFromName: '',
});

// 选项卡
const activeTab = ref<'general' | 'security' | 'storage' | 'appearance' | 'nav' | 'email' | 'update'>('general');

// 预设品牌色
const presetColors = [
  '#6366f1', // 靛蓝
  '#8b5cf6', // 紫罗兰
  '#ec4899', // 粉红
  '#ef4444', // 红色
  '#f59e0b', // 琥珀
  '#10b981', // 翠绿
  '#06b6d4', // 青色
  '#3b82f6', // 蓝色
];

/* 主题列表：与 useTheme.THEMES 对齐（9 个主题，单一数据源） */
const themeList = [
  { value: 'light-glass', label: '毛玻璃', desc: '侧边栏 + 玻璃拟态（默认）' },
  { value: 'dark-glass', label: '深色玻璃', desc: '侧边栏 + 暗色玻璃质感' },
  { value: 'top-nav', label: '顶部导航', desc: '顶部横向导航栏布局' },
  { value: 'dashboard', label: '仪表盘', desc: '渐变背景 + 仪表盘风格' },
  { value: 'bento', label: '便当盒', desc: '大圆角卡片 + 便当盒网格' },
  { value: 'command', label: '命令式', desc: '暗黑 + 等宽字体 + 命令风格' },
  /* 2026 创意新主题 */
  { value: 'stardust', label: '星尘', desc: '液态玻璃 + 深空星野 + 空间景深' },
  { value: 'dawn', label: '晨曦', desc: '自然有机 + 暖色晨光 + 尊重注意力' },
  { value: 'flow', label: '流光', desc: 'AI 原生 + 动态渐变 + 智能中枢' },
];

/* ---------- 导航栏自定义 ---------- */
const navTab = ref<'main' | 'admin'>('main');
const navMouseDrag = ref(false);
const navMouseDragPath = ref<string | null>(null);
const navDropTarget = ref<string | null>(null);

const mainMenuAll = [
  { path: '/', label: '文件管理', icon: 'Folder' },
  { path: '/recent', label: '最近全部', icon: 'Clock' },
  { path: '/favorites', label: '我的收藏', icon: 'StarFilled' },
  { path: '/quick-access', label: '快捷访问', icon: 'Star' },
  { path: '/media', label: '媒体库', icon: 'VideoCamera' },
  { path: '/hidden', label: '隐藏空间', icon: 'Lock' },
  { path: '/subscriptions', label: '转存和订阅', icon: 'Download' },
  { path: '/shares', label: '我的分享', icon: 'Share' },
  { path: '/share-collab', label: '共享管理', icon: 'User' },
  { path: '/recycle', label: '回收站', icon: 'Delete' },
  { path: '/profile', label: '我的资料', icon: 'User' },
];

const adminMenuAll = [
  { path: '/admin/users', label: '用户管理', icon: 'User' },
  { path: '/admin/roles', label: '角色权限', icon: 'Lock' },
  { path: '/admin/storages', label: '存储管理', icon: 'Box' },
  { path: '/admin/settings', label: '系统设置', icon: 'Tools' },
  { path: '/admin/logs', label: '操作日志', icon: 'Document' },
  { path: '/admin/sync', label: '同步管理', icon: 'Refresh' },
  { path: '/admin/stats', label: '系统统计', icon: 'DataLine' },
];

const mainMenuOrder = ref<string[]>(loadNavOrder('main'));
const adminMenuOrder = ref<string[]>(loadNavOrder('admin'));

// 导航菜单隐藏配置
const hiddenNavItems = ref<Record<string, boolean>>(loadNavHidden());

function loadNavHidden(): Record<string, boolean> {
  try {
    const saved = localStorage.getItem('nebula_nav_hidden');
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return {};
}

function saveNavHidden() {
  try {
    localStorage.setItem('nebula_nav_hidden', JSON.stringify(hiddenNavItems.value));
  } catch { /* ignore */ }
}

function isNavHidden(path: string): boolean {
  return hiddenNavItems.value[path] === true;
}

function toggleNavHidden(path: string) {
  hiddenNavItems.value[path] = !isNavHidden(path);
  saveNavHidden();
}

function loadNavOrder(type: string): string[] {
  try {
    const saved = localStorage.getItem('nebula_nav_order_' + type);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return type === 'main'
    ? mainMenuAll.map(m => m.path)
    : adminMenuAll.map(m => m.path);
}

function saveNavOrder() {
  try {
    localStorage.setItem('nebula_nav_order_main', JSON.stringify(mainMenuOrder.value));
    localStorage.setItem('nebula_nav_order_admin', JSON.stringify(adminMenuOrder.value));
  } catch { /* ignore */ }
}

const currentNavItems = computed(() => {
  const allItems = navTab.value === 'main' ? mainMenuAll : adminMenuAll;
  const order = navTab.value === 'main' ? mainMenuOrder.value : adminMenuOrder.value;
  return [...allItems].sort((a, b) => {
    const ia = order.indexOf(a.path);
    const ib = order.indexOf(b.path);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
});

// 鼠标事件拖拽（实时重排 + 动画）
function onNavMouseDown(path: string, e: MouseEvent) {
  if (e.button !== 0) return;
  navMouseDrag.value = true;
  navMouseDragPath.value = path;
  e.preventDefault();
}

function onNavMouseMove(path: string, e: MouseEvent) {
  if (!navMouseDrag.value) return;
  // 实时重排：拖到哪个位置就实时交换
  if (navMouseDragPath.value && navMouseDragPath.value !== path) {
    const order = navTab.value === 'main' ? mainMenuOrder.value : adminMenuOrder.value;
    const from = order.indexOf(navMouseDragPath.value);
    const to = order.indexOf(path);
    if (from >= 0 && to >= 0) {
      order.splice(to, 0, order.splice(from, 1)[0]);
    }
  }
  navDropTarget.value = path;
}

function onNavMouseUp(path: string) {
  if (!navMouseDrag.value) return;
  saveNavOrder();
  if (navMouseDragPath.value && navMouseDragPath.value !== path) {
    ElMessage.success('导航顺序已保存');
  }
  navMouseDrag.value = false;
  navMouseDragPath.value = null;
  navDropTarget.value = null;
}

// 全局鼠标松开（防止拖出列表区域）
function onGlobalMouseUp() {
  if (navMouseDrag.value) {
    saveNavOrder();
    navMouseDrag.value = false;
    navMouseDragPath.value = null;
    navDropTarget.value = null;
  }
}

onMounted(() => {
  window.addEventListener('mouseup', onGlobalMouseUp);
});

onBeforeUnmount(() => {
  window.removeEventListener('mouseup', onGlobalMouseUp);
});

/* 应用主题：统一走 useTheme 单例，写入 nebula_theme（与个人用户同一数据源），刷新不丢 */
function applyTheme(theme: string) {
  if (theme in THEMES) {
    setTheme(theme as ThemeKey);
  } else {
    // legacy 主题（不在 THEMES 中）：保持旧行为，直接设置 data-theme
    document.documentElement.setAttribute('data-theme', theme);
  }
}
const saving = ref(false);
const bgUploading = ref(false);
const logoUploading = ref(false);
const logoFileInput = ref<HTMLInputElement | null>(null);

function triggerLogoUpload() {
  logoFileInput.value?.click();
}

// SMTP 测试邮件
const testEmailTo = ref('');
const testEmailSending = ref(false);

async function sendTestEmail() {
  if (!testEmailTo.value.trim()) {
    ElMessage.warning('请输入测试邮箱地址');
    return;
  }
  testEmailSending.value = true;
  try {
    await api('/settings/smtp/test', {
      method: 'POST',
      body: { to: testEmailTo.value.trim() },
    });
    ElMessage.success(`测试邮件已发送至 ${testEmailTo.value.trim()}`);
  } catch (e: any) {
    ElMessage.error(e.message || '测试邮件发送失败');
  } finally {
    testEmailSending.value = false;
  }
}

// 更新检查
const updateInfo = ref<{ currentVersion: string; latestVersion: string; isUpdateAvailable: boolean } | null>(null);
const updateChecking = ref(false);

async function checkUpdate() {
  updateChecking.value = true;
  try {
    const r = await api('/system/check-update');
    updateInfo.value = r;
    if (r.isUpdateAvailable) {
      ElMessage.success(`发现新版本 v${r.latestVersion}`);
    } else {
      ElMessage.info('已是最新版本');
    }
  } catch (e: any) {
    ElMessage.error(e.message || '检查更新失败');
  } finally {
    updateChecking.value = false;
  }
}

async function load() {
  try {
    // 自动检查更新
    checkUpdate();
    const s = await api('/settings/all');
    form.value.appName = s.appName || 'NebulaDrive 星云网盘';
    form.value.logo = s.logo || '';
    form.value.notice = s.notice || '';
    form.value.copyright = s.copyright || '';
    form.value.aboutText = s.aboutText || '';
    form.value.contactEmail = s.contactEmail || '';
    form.value.registerEnabled = s.registerEnabled !== false;
    form.value.minPasswordLen = Number(s.minPasswordLen) || 8;
    form.value.sessionTimeoutHours = Number(s.sessionTimeoutHours) || 168;
    form.value.uploadChunkSizeMB = Math.round(Number(s.uploadChunkSize) / 1024 / 1024) || 5;
    form.value.maxFileSizeGB = Number(s.maxFileSizeGB) || 0;
    form.value.shareDefaultExpireDays = Number(s.shareDefaultExpireDays) || 0;
    form.value.recycleRetentionDays = Number(s.recycleRetentionDays) || 0;
    form.value.brandColor = s.brandColor || '';
    form.value.theme = s.theme || 'light-glass';
    applyTheme(form.value.theme);
    form.value.bgType = s.bgType || 'theme';
    form.value.bgImage = s.bgImage || '';
    form.value.bgGradientFrom = s.bgGradientFrom || '#9fc2ff';
    form.value.bgGradientTo = s.bgGradientTo || '#cdb4ef';
    form.value.bgGradientAngle = Number(s.bgGradientAngle) || 135;
    form.value.bgColor = s.bgColor || '#1e2634';
    form.value.bgOverlay = Number(s.bgOverlay) || 40;
    form.value.loginCaptchaThreshold = Number(s.loginCaptchaThreshold) || 3;
    form.value.smtpEnabled = s.smtpEnabled === true;
    form.value.smtpHost = s.smtpHost || '';
    form.value.smtpPort = Number(s.smtpPort) || 465;
    form.value.smtpSecure = s.smtpSecure !== false;
    form.value.smtpUser = s.smtpUser || '';
    form.value.smtpPassword = s.smtpPassword || '';
    form.value.smtpFrom = s.smtpFrom || '';
    form.value.smtpFromName = s.smtpFromName || '';
  } catch (e: any) {
    ElMessage.error(e.message || '加载设置失败，正在使用默认值');
  }
}

async function doSave() {
  saving.value = true;
  try {
    await api('/settings', {
      method: 'PUT',
      body: JSON.stringify({
        appName: form.value.appName,
        logo: form.value.logo,
        notice: form.value.notice,
        copyright: form.value.copyright,
        aboutText: form.value.aboutText,
        contactEmail: form.value.contactEmail,
        registerEnabled: String(form.value.registerEnabled),
        minPasswordLen: String(form.value.minPasswordLen),
        sessionTimeoutHours: String(form.value.sessionTimeoutHours),
        uploadChunkSize: String(form.value.uploadChunkSizeMB * 1024 * 1024),
        maxFileSizeGB: String(form.value.maxFileSizeGB),
        shareDefaultExpireDays: String(form.value.shareDefaultExpireDays),
        recycleRetentionDays: String(form.value.recycleRetentionDays),
        brandColor: form.value.brandColor,
        theme: form.value.theme,
        bgType: form.value.bgType,
        bgImage: form.value.bgImage,
        bgGradientFrom: form.value.bgGradientFrom,
        bgGradientTo: form.value.bgGradientTo,
        bgGradientAngle: String(form.value.bgGradientAngle),
        bgColor: form.value.bgColor,
        bgOverlay: String(form.value.bgOverlay),
        loginCaptchaThreshold: String(form.value.loginCaptchaThreshold),
        smtpEnabled: String(form.value.smtpEnabled),
        smtpHost: form.value.smtpHost,
        smtpPort: String(form.value.smtpPort),
        smtpSecure: String(form.value.smtpSecure),
        smtpUser: form.value.smtpUser,
        smtpPassword: form.value.smtpPassword,
        smtpFrom: form.value.smtpFrom,
        smtpFromName: form.value.smtpFromName,
      }),
    });
    // 立即应用品牌色
    applyBrandColorNow();
    ElMessage.success('设置已保存');
  } catch (e: any) {
    ElMessage.error(e.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

/** 立即应用品牌色（无需刷新） */
function applyBrandColorNow() {
  const root = document.documentElement;
  const color = form.value.brandColor;
  if (!color || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-soft');
    return;
  }
  const hex = color.length === 4 ? '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3] : color;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  root.style.setProperty('--accent', color);
  root.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.18)`);
}

async function uploadBackground(file: File) {
  bgUploading.value = true;
  try {
    const fd = new FormData();
    fd.append('file', file);
    const token = localStorage.getItem('nebula_token') || '';
    const r = await fetch('/api/v1/settings/background', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: fd,
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    form.value.bgImage = j.data.url;
    form.value.bgType = 'image';
    ElMessage.success('背景图已上传，记得保存');
  } catch (e: any) {
    ElMessage.error(e.message || '背景上传失败');
  } finally {
    bgUploading.value = false;
  }
}

function onBgFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) uploadBackground(file);
  input.value = '';
}

async function uploadLogo(file: File) {
  logoUploading.value = true;
  try {
    const fd = new FormData();
    fd.append('file', file);
    const token = localStorage.getItem('nebula_token') || '';
    const r = await fetch('/api/v1/settings/logo', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: fd,
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    form.value.logo = j.data.url;
    ElMessage.success('Logo 已上传，记得保存');
  } catch (e: any) {
    ElMessage.error(e.message || 'Logo 上传失败');
  } finally {
    logoUploading.value = false;
  }
}

function onLogoFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) uploadLogo(file);
  input.value = '';
}

function resetBg() {
  form.value.bgType = 'theme';
  form.value.bgImage = '';
  form.value.bgGradientFrom = '#9fc2ff';
  form.value.bgGradientTo = '#cdb4ef';
  form.value.bgGradientAngle = 135;
  form.value.bgColor = '#1e2634';
  form.value.bgOverlay = 40;
}

onMounted(load);
</script>

<template>
  <div class="settings-page">
    <!-- 页头 -->
    <header class="settings-header">
      <h2>系统设置</h2>
      <p>管理外观、安全、存储与更新</p>
    </header>

    <!-- 选项卡 -->
    <nav class="settings-tabs">
      <button class="tab-btn" :class="{ active: activeTab === 'general' }" @click="activeTab = 'general'">
        <el-icon><Document /></el-icon><span>通用</span>
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'security' }" @click="activeTab = 'security'">
        <el-icon><Lock /></el-icon><span>安全</span>
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'storage' }" @click="activeTab = 'storage'">
        <el-icon><Box /></el-icon><span>存储</span>
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'appearance' }" @click="activeTab = 'appearance'">
        <el-icon><Brush /></el-icon><span>外观</span>
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'nav' }" @click="activeTab = 'nav'">
        <el-icon><Rank /></el-icon><span>导航</span>
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'email' }" @click="activeTab = 'email'">
        <el-icon><Message /></el-icon><span>邮件</span>
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'update' }" @click="activeTab = 'update'">
        <el-icon><Refresh /></el-icon><span>更新</span>
      </button>
    </nav>

    <!-- 内容区 -->
    <div class="settings-content">
      <!-- ========== 通用 ========== -->
      <div v-show="activeTab === 'general'" class="tab-panel">
        <section class="card">
          <div class="card-head">
            <div class="card-icon ci-blue"><el-icon><Document /></el-icon></div>
            <div class="card-titles">
              <h3>基本信息</h3>
              <p>系统名称、Logo 与公告，显示在登录页与全站</p>
            </div>
          </div>
          <div class="fields-grid">
            <div class="field">
              <label>系统名称</label>
              <el-input v-model="form.appName" placeholder="显示在登录页与侧边栏的名称" />
            </div>
            <div class="field">
              <label>版权页脚</label>
              <el-input v-model="form.copyright" placeholder="如 © 2025 NebulaDrive" />
            </div>
            <div class="field">
              <label>联系邮箱</label>
              <el-input v-model="form.contactEmail" placeholder="如 support@example.com" />
            </div>
            <div class="field">
              <label>系统 Logo</label>
              <div class="logo-row">
                <div class="logo-upload-box" @click="triggerLogoUpload">
                  <img v-if="form.logo" :src="form.logo" class="logo-preview" alt="logo" @error="($event.target as HTMLImageElement).style.display = 'none'" />
                  <span v-else class="logo-placeholder">点击上传</span>
                </div>
                <div class="logo-actions">
                  <el-button :loading="logoUploading" size="small" @click="triggerLogoUpload">选择图片</el-button>
                  <el-button v-if="form.logo" size="small" @click="form.logo = ''">移除</el-button>
                  <input ref="logoFileInput" type="file" accept="image/*" class="logo-file-input" @change="onLogoFile" />
                </div>
              </div>
            </div>
            <div class="field span2">
              <label>系统公告</label>
              <el-input v-model="form.notice" type="textarea" :rows="2" placeholder="显示在登录页下方的公告内容" />
            </div>
            <div class="field span2">
              <label>关于文本</label>
              <el-input v-model="form.aboutText" type="textarea" :rows="2" placeholder="登录页副标题下方的关于介绍" />
            </div>
          </div>
        </section>
      </div>

      <!-- ========== 安全 ========== -->
      <div v-show="activeTab === 'security'" class="tab-panel">
        <section class="card">
          <div class="card-head">
            <div class="card-icon ci-green"><el-icon><Lock /></el-icon></div>
            <div class="card-titles">
              <h3>注册与安全</h3>
              <p>注册开关与账号安全策略</p>
            </div>
          </div>
          <div class="settings-rows">
            <div class="s-row">
              <span class="s-label">开放注册</span>
              <div class="s-control">
                <el-switch v-model="form.registerEnabled" />
                <span class="s-hint">控制新用户能否自行注册</span>
              </div>
            </div>
            <div class="s-row">
              <span class="s-label">密码最小长度</span>
              <div class="s-control">
                <el-input-number v-model="form.minPasswordLen" :min="4" :max="32" :step="1" size="small" controls-position="right" />
                <span class="s-hint">位</span>
              </div>
            </div>
            <div class="s-row">
              <span class="s-label">会话有效期</span>
              <div class="s-control">
                <el-select v-model="form.sessionTimeoutHours" size="small">
                  <el-option :value="24" label="1 天" />
                  <el-option :value="72" label="3 天" />
                  <el-option :value="168" label="7 天" />
                  <el-option :value="336" label="14 天" />
                  <el-option :value="720" label="30 天" />
                  <el-option :value="4320" label="180 天" />
                </el-select>
                <span class="s-hint">登录后保持多久</span>
              </div>
            </div>
            <div class="s-row">
              <span class="s-label">登录验证码</span>
              <div class="s-control">
                <el-input-number v-model="form.loginCaptchaThreshold" :min="0" :max="10" :step="1" size="small" controls-position="right" />
                <span class="s-hint">次失败后 · 0 = 关闭</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- ========== 存储 ========== -->
      <div v-show="activeTab === 'storage'" class="tab-panel">
        <section class="card">
          <div class="card-head">
            <div class="card-icon ci-orange"><el-icon><Box /></el-icon></div>
            <div class="card-titles">
              <h3>上传与存储</h3>
              <p>分片大小、单文件上限</p>
            </div>
          </div>
          <div class="settings-rows">
            <div class="s-row">
              <span class="s-label">上传分片大小</span>
              <div class="s-control">
                <el-input-number v-model="form.uploadChunkSizeMB" :min="1" :max="100" :step="1" size="small" controls-position="right" />
                <span class="s-hint">MB</span>
              </div>
            </div>
            <div class="s-row">
              <span class="s-label">最大文件大小</span>
              <div class="s-control">
                <el-input-number v-model="form.maxFileSizeGB" :min="0" :max="1000" :step="1" size="small" controls-position="right" />
                <span class="s-hint">GB · 0 = 不限制</span>
              </div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <div class="card-icon ci-purple"><el-icon><Share /></el-icon></div>
            <div class="card-titles">
              <h3>分享与回收站</h3>
              <p>分享有效期与回收站保留策略</p>
            </div>
          </div>
          <div class="settings-rows">
            <div class="s-row">
              <span class="s-label">分享默认有效期</span>
              <div class="s-control">
                <el-select v-model="form.shareDefaultExpireDays" size="small">
                  <el-option :value="0" label="永久" />
                  <el-option :value="1" label="1 天" />
                  <el-option :value="7" label="7 天" />
                  <el-option :value="15" label="15 天" />
                  <el-option :value="30" label="30 天" />
                  <el-option :value="90" label="90 天" />
                </el-select>
              </div>
            </div>
            <div class="s-row">
              <span class="s-label">回收站保留天数</span>
              <div class="s-control">
                <el-input-number v-model="form.recycleRetentionDays" :min="0" :max="365" :step="1" size="small" controls-position="right" />
                <span class="s-hint">天 · 0 = 不自动清理</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- ========== 外观 ========== -->
      <div v-show="activeTab === 'appearance'" class="tab-panel">
        <section class="card">
          <div class="card-head">
            <div class="card-icon ci-purple"><el-icon><Brush /></el-icon></div>
            <div class="card-titles">
              <h3>主题色</h3>
              <p>品牌主色，应用于全站强调色</p>
            </div>
          </div>
          <div class="brand-color-row">
            <div class="preset-colors">
              <button
                v-for="c in presetColors"
                :key="c"
                class="color-swatch"
                :class="{ active: form.brandColor === c }"
                :style="{ background: c }"
                :title="c"
                @click="form.brandColor = c"
              />
            </div>
            <div class="brand-color-actions">
              <button class="color-reset" v-if="form.brandColor" @click="form.brandColor = ''" title="恢复默认">
                <el-icon><Close /></el-icon>
              </button>
              <el-color-picker v-model="form.brandColor" title="自定义颜色" />
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <div class="card-icon ci-green"><el-icon><Brush /></el-icon></div>
            <div class="card-titles">
              <h3>主题风格</h3>
              <p>选择全站视觉风格，保存后立即生效</p>
            </div>
          </div>
          <div class="theme-grid">
            <div
              v-for="t in themeList"
              :key="t.value"
              class="theme-card"
              :class="{ active: form.theme === t.value }"
              @click="form.theme = t.value; applyTheme(t.value)"
            >
              <div class="theme-preview" :data-theme-preview="t.value"></div>
              <div class="theme-name">{{ t.label }}</div>
              <div class="theme-desc">{{ t.desc }}</div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <div class="card-icon ci-cyan"><el-icon><Picture /></el-icon></div>
            <div class="card-titles">
              <h3>自定义背景</h3>
              <p>全站页面背景，支持图片 / 渐变 / 纯色，保存后对所有用户生效</p>
            </div>
          </div>
          <div class="settings-rows">
            <div class="s-row">
              <span class="s-label">背景类型</span>
              <div class="s-control">
                <el-select v-model="form.bgType" size="small">
                  <el-option value="theme" label="跟随主题（默认）" />
                  <el-option value="image" label="图片" />
                  <el-option value="gradient" label="渐变" />
                  <el-option value="color" label="纯色" />
                </el-select>
              </div>
            </div>

            <!-- 图片模式 -->
            <template v-if="form.bgType === 'image'">
              <div class="s-row">
                <span class="s-label">上传背景图</span>
                <div class="s-control">
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="bg-file-input" @change="onBgFile" />
                  <el-button :loading="bgUploading" size="small" @click="document.querySelector('.bg-file-input')?.click()">选择图片</el-button>
                </div>
              </div>
              <div class="s-row">
                <span class="s-label">图片地址</span>
                <div class="s-control">
                  <el-input v-model="form.bgImage" placeholder="http(s) 外链，或 /uploads/background/..." />
                </div>
              </div>
              <div class="s-row">
                <span class="s-label">实时预览</span>
                <div class="s-control">
                  <div class="bg-preview-wrap">
                    <img v-if="form.bgImage" :src="form.bgImage" class="bg-preview" />
                    <div v-else class="bg-preview-empty">选择或填写背景图后显示预览</div>
                  </div>
                </div>
              </div>
            </template>

            <!-- 渐变模式 -->
            <template v-if="form.bgType === 'gradient'">
              <div class="s-row">
                <span class="s-label">起始色</span>
                <div class="s-control"><el-color-picker v-model="form.bgGradientFrom" /></div>
              </div>
              <div class="s-row">
                <span class="s-label">结束色</span>
                <div class="s-control"><el-color-picker v-model="form.bgGradientTo" /></div>
              </div>
              <div class="s-row">
                <span class="s-label">渐变角度</span>
                <div class="s-control"><el-slider v-model="form.bgGradientAngle" :min="0" :max="360" :step="5" class="bg-slider" /></div>
              </div>
              <div class="s-row">
                <span class="s-label">实时预览</span>
                <div class="s-control">
                  <div class="bg-preview-wrap">
                    <div class="bg-preview" :style="{ background: `linear-gradient(${form.bgGradientAngle}deg, ${form.bgGradientFrom} 0%, ${form.bgGradientTo} 100%)` }" />
                  </div>
                </div>
              </div>
            </template>

            <!-- 纯色模式 -->
            <template v-if="form.bgType === 'color'">
              <div class="s-row">
                <span class="s-label">背景色</span>
                <div class="s-control"><el-color-picker v-model="form.bgColor" /></div>
              </div>
            </template>

            <!-- 遮罩强度（所有自定义类型通用） -->
            <div class="s-row" v-if="form.bgType !== 'theme'">
              <span class="s-label">遮罩强度</span>
              <div class="s-control"><el-slider v-model="form.bgOverlay" :min="0" :max="100" :step="5" class="bg-slider" /></div>
            </div>
            <div class="s-row" v-if="form.bgType !== 'theme'">
              <span class="s-label"></span>
              <div class="s-control"><el-button link size="small" @click="resetBg">恢复默认</el-button></div>
            </div>
          </div>
        </section>
      </div>

      <!-- ========== 导航 ========== -->
      <div v-show="activeTab === 'nav'" class="tab-panel">
        <section class="card">
          <div class="card-head">
            <div class="card-icon ci-orange"><el-icon><Rank /></el-icon></div>
            <div class="card-titles">
              <h3>导航栏自定义</h3>
              <p>拖拽菜单项调整显示顺序，自动保存</p>
            </div>
          </div>
          <div class="nav-customize-container">
            <div class="nav-customize-tabs">
              <button class="nav-tab" :class="{ active: navTab === 'main' }" @click="navTab = 'main'">主菜单</button>
              <button class="nav-tab" :class="{ active: navTab === 'admin' }" @click="navTab = 'admin'">系统管理</button>
            </div>
            <div class="nav-customize-list">
              <div
                v-for="item in currentNavItems"
                :key="item.path"
                class="nav-customize-item"
                :class="{
                  dragging: navMouseDragPath === item.path,
                  'drop-target': navDropTarget === item.path && navMouseDragPath !== item.path,
                  'nav-hidden': isNavHidden(item.path)
                }"
                @mousedown="onNavMouseDown(item.path, $event)"
                @mousemove="onNavMouseMove(item.path, $event)"
                @mouseup="onNavMouseUp(item.path)"
              >
                <el-icon class="nav-drag-icon"><Rank /></el-icon>
                <el-icon class="nav-menu-icon"><component :is="item.icon" /></el-icon>
                <span class="nav-menu-label">{{ item.label }}</span>
                <el-switch
                  :model-value="!isNavHidden(item.path)"
                  @change="toggleNavHidden(item.path)"
                  size="small"
                  class="nav-visibility-switch"
                  title="显示/隐藏此菜单项"
                />
              </div>
            </div>
            <div class="nav-customize-hint">
              <el-icon><InfoFilled /></el-icon>
              <span>按住菜单项拖动到目标位置，松手后自动保存</span>
            </div>
          </div>
        </section>
      </div>

      <!-- ========== 邮件 ========== -->
      <div v-show="activeTab === 'email'" class="tab-panel">
        <section class="card">
          <div class="card-head">
            <div class="card-icon ci-cyan"><el-icon><Message /></el-icon></div>
            <div class="card-titles">
              <h3>SMTP 邮件服务</h3>
              <p>用于发送注册欢迎邮件等通知。关闭时注册不发送邮件。</p>
            </div>
          </div>
          <div class="settings-rows">
            <div class="s-row">
              <span class="s-label">启用邮件服务</span>
              <div class="s-control">
                <el-switch v-model="form.smtpEnabled" />
                <span class="s-hint">开启后，用户注册将自动发送欢迎邮件</span>
              </div>
            </div>
            <div class="s-row">
              <span class="s-label">SMTP 服务器</span>
              <div class="s-control">
                <el-input v-model="form.smtpHost" placeholder="如 smtp.qq.com" style="width: 220px" />
              </div>
            </div>
            <div class="s-row">
              <span class="s-label">端口</span>
              <div class="s-control">
                <el-input-number v-model="form.smtpPort" :min="1" :max="65535" :step="1" size="small" controls-position="right" />
                <span class="s-hint">SSL 常用 465 · 非 SSL 常用 587</span>
              </div>
            </div>
            <div class="s-row">
              <span class="s-label">加密方式</span>
              <div class="s-control">
                <el-radio-group v-model="form.smtpSecure" size="small">
                  <el-radio-button :value="true">SSL (465)</el-radio-button>
                  <el-radio-button :value="false">STARTTLS (587)</el-radio-button>
                </el-radio-group>
              </div>
            </div>
            <div class="s-row">
              <span class="s-label">SMTP 账号</span>
              <div class="s-control">
                <el-input v-model="form.smtpUser" placeholder="通常与发件邮箱一致" style="width: 260px" />
              </div>
            </div>
            <div class="s-row">
              <span class="s-label">SMTP 密码 / 授权码</span>
              <div class="s-control">
                <el-input v-model="form.smtpPassword" type="password" show-password placeholder="QQ/163 邮箱为授权码，非邮箱密码" style="width: 260px" />
              </div>
            </div>
            <div class="s-row">
              <span class="s-label">发件邮箱</span>
              <div class="s-control">
                <el-input v-model="form.smtpFrom" placeholder="默认同 SMTP 账号" style="width: 260px" />
              </div>
            </div>
            <div class="s-row">
              <span class="s-label">发件人名称</span>
              <div class="s-control">
                <el-input v-model="form.smtpFromName" placeholder="如 NebulaDrive 团队（可选）" style="width: 260px" />
              </div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <div class="card-icon ci-green"><el-icon><Promotion /></el-icon></div>
            <div class="card-titles">
              <h3>发送测试邮件</h3>
              <p>填写一个邮箱地址，验证 SMTP 配置是否正确</p>
            </div>
          </div>
          <div class="test-email-row">
            <el-input
              v-model="testEmailTo"
              placeholder="输入要接收测试邮件的邮箱地址"
              style="width: 320px"
              clearable
            >
              <template #prepend>
                <el-icon><Message /></el-icon>
              </template>
            </el-input>
            <el-button type="primary" :loading="testEmailSending" @click="sendTestEmail">
              发送测试邮件
            </el-button>
          </div>
        </section>
      </div>

      <!-- ========== 更新 ========== -->
      <div v-show="activeTab === 'update'" class="tab-panel">
        <section class="card">
          <div class="card-head">
            <div class="card-icon ci-purple"><el-icon><Refresh /></el-icon></div>
            <div class="card-titles">
              <h3>在线更新</h3>
              <p>从 GitHub 检查最新版本</p>
            </div>
          </div>
          <div class="update-box">
            <div class="settings-rows">
              <div class="s-row">
                <span class="s-label">当前版本</span>
                <div class="s-control">
                  <span class="row-value">{{ updateInfo?.currentVersion || '加载中...' }}</span>
                </div>
              </div>
              <div class="s-row">
                <span class="s-label">最新版本</span>
                <div class="s-control">
                  <span class="row-value" :class="{ 'update-available': updateInfo?.isUpdateAvailable }">
                    {{ updateInfo?.latestVersion || '检查中...' }}
                    <el-tag v-if="updateInfo?.isUpdateAvailable" type="warning" size="small">有新版本</el-tag>
                  </span>
                </div>
              </div>
            </div>
            <el-button :loading="updateChecking" @click="checkUpdate">
              <el-icon><Refresh /></el-icon>&nbsp;检查更新
            </el-button>
          </div>
        </section>
      </div>
    </div>

    <!-- 保存栏 -->
    <div class="save-bar glass-card">
      <span class="save-hint">修改后点保存立即生效（会话有效期对下次登录生效）</span>
      <el-button type="primary" size="large" :loading="saving" @click="doSave">
        保存全部设置
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ---------- 页头 ---------- */
.settings-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.settings-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
}
.settings-header p {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

/* ---------- 选项卡 ---------- */
.settings-tabs {
  display: flex;
  gap: 8px;
  padding: 6px;
  border-radius: 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(12px);
  overflow-x: auto;
}
.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s ease;
}
.tab-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}
.tab-btn.active {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
}
.tab-btn .el-icon {
  font-size: 16px;
}

/* ---------- 内容区 ---------- */
.settings-content {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ---------- 卡片 ---------- */
.card {
  border-radius: 18px;
  padding: 20px 22px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}
.card-titles h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}
.card-titles p {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: var(--text-secondary);
}
.card-icon {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-size: 20px;
  color: #fff;
  flex-shrink: 0;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
.ci-blue { background: linear-gradient(135deg, #5b8cff, #7c6ff0); }
.ci-green { background: linear-gradient(135deg, #2ea24f, #6fcf9a); }
.ci-orange { background: linear-gradient(135deg, #e8933a, #f0b35c); }
.ci-purple { background: linear-gradient(135deg, #8b5cf6, #c084fc); }
.ci-cyan { background: linear-gradient(135deg, #06b6d4, #4dd8e8); }

/* ---------- 字段网格（通用） ---------- */
.fields-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.field.span2 {
  grid-column: span 2;
}
.field label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}

/* ---------- Logo ---------- */
.logo-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.logo-upload-box {
  width: 96px;
  height: 64px;
  border-radius: 12px;
  border: 1.5px dashed var(--glass-border);
  background: rgba(255, 255, 255, 0.04);
  display: grid;
  place-items: center;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.2s ease;
  flex-shrink: 0;
}
.logo-upload-box:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.logo-preview {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.logo-placeholder {
  font-size: 12px;
  color: var(--text-secondary);
}
.logo-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.logo-file-input {
  display: none;
}

/* ---------- 设置行 ---------- */
.settings-rows {
  display: flex;
  flex-direction: column;
}
.s-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid var(--glass-border);
}
.s-row:last-child {
  border-bottom: none;
}
.s-label {
  font-size: 14px;
  color: var(--text);
  font-weight: 500;
  flex-shrink: 0;
}
.s-control {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.s-hint {
  font-size: 12px;
  color: var(--text-secondary);
}
.row-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.update-available {
  color: #f59e0b;
}

/* ---------- 品牌色 ---------- */
.brand-color-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.preset-colors {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.color-swatch {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.3);
}
.color-swatch:hover {
  transform: scale(1.12);
}
.color-swatch.active {
  border-color: #fff;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.brand-color-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.color-reset {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-secondary);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all 0.2s ease;
}
.color-reset:hover {
  background: rgba(255, 255, 255, 0.16);
  color: var(--text);
}

/* ---------- 主题风格 ---------- */
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 14px;
}
.theme-card {
  border-radius: 14px;
  border: 1.5px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.04);
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.theme-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}
.theme-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.theme-preview {
  height: 72px;
  border-radius: 10px;
  margin-bottom: 10px;
  position: relative;
  overflow: hidden;
}
/* 2026 新主题预览色块（其余主题预览由 UI 设计师后续补齐） */
.theme-preview[data-theme-preview='stardust'] {
  background: linear-gradient(160deg, #05070f 0%, #121a3c 70%, #4cc9ff 160%);
}
.theme-preview[data-theme-preview='dawn'] {
  background: linear-gradient(180deg, #fdf9f4 0%, #f2e8dc 60%, #e8823c 200%);
}
.theme-preview[data-theme-preview='flow'] {
  background: linear-gradient(135deg, #0c0c14 0%, #a78bfa 90%, #22d3ee 180%);
}
.theme-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  text-align: center;
}
.theme-desc {
  font-size: 11.5px;
  color: var(--text-secondary);
  text-align: center;
  margin-top: 3px;
  line-height: 1.4;
}

/* ---------- 导航自定义 ---------- */
.nav-customize-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.nav-customize-tabs {
  display: flex;
  gap: 8px;
}
.nav-tab {
  padding: 8px 20px;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13.5px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.nav-tab.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.nav-customize-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 480px;
}
.nav-customize-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  border: 1.5px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.04);
  cursor: grab;
  user-select: none;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.nav-customize-item:active {
  cursor: grabbing;
}
.nav-customize-item.dragging {
  opacity: 0.5;
  transform: scale(1.02);
  border-color: var(--accent);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  z-index: 10;
}
.nav-customize-item.drop-target {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
  transform: translateY(-2px);
}
.nav-drag-icon {
  color: var(--text-secondary);
  font-size: 15px;
}
.nav-menu-icon {
  color: var(--accent);
  font-size: 17px;
}
.nav-menu-label {
  flex: 1;
  font-size: 14px;
  color: var(--text);
}
.nav-customize-item.nav-hidden {
  opacity: 0.5;
  background: rgba(0, 0, 0, 0.08);
}
.nav-customize-item.nav-hidden .nav-menu-icon,
.nav-customize-item.nav-hidden .nav-menu-label {
  text-decoration: line-through;
}
.nav-visibility-switch {
  flex-shrink: 0;
}
.nav-customize-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--text-secondary);
  font-size: 13px;
  max-width: 480px;
}

/* ---------- 背景预览 ---------- */
.bg-file-input {
  display: none;
}
.bg-preview-wrap {
  width: 100%;
  max-width: 320px;
}
.bg-preview {
  width: 100%;
  height: 120px;
  border-radius: 12px;
  object-fit: cover;
  border: 1px solid var(--glass-border);
  background: rgba(0, 0, 0, 0.1);
}
.bg-preview-empty {
  height: 120px;
  border-radius: 12px;
  border: 1.5px dashed var(--glass-border);
  display: grid;
  place-items: center;
  font-size: 13px;
  color: var(--text-secondary);
}
.bg-slider {
  width: 200px;
}

/* ---------- 更新 ---------- */
.update-box {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 480px;
}

/* ---------- 测试邮件 ---------- */
.test-email-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

/* ---------- 保存栏 ---------- */
.save-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 22px;
  border-radius: 16px;
  position: sticky;
  bottom: 12px;
}
.save-bar:hover {
  transform: none;
  box-shadow: var(--shadow);
}
.save-hint {
  font-size: 13px;
  color: var(--text-secondary);
}

/* ---------- 响应式 ---------- */
@media (max-width: 720px) {
  .fields-grid {
    grid-template-columns: 1fr;
  }
  .field.span2 {
    grid-column: span 1;
  }
  .save-bar {
    flex-direction: column;
    align-items: stretch;
  }
  .save-bar .el-button {
    width: 100%;
  }
  .nav-customize-list,
  .nav-customize-hint,
  .update-box,
  .bg-preview-wrap {
    max-width: 100%;
  }
}
</style>
