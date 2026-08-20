<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../api';

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
});

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

/* 主题列表 */
const themeList = [
  { value: 'light-glass', label: '毛玻璃', desc: '侧边栏 + 玻璃拟态（默认）' },
  { value: 'dark-glass', label: '深色玻璃', desc: '侧边栏 + 暗色玻璃质感' },
  { value: 'top-nav', label: '顶部导航', desc: '顶部横向导航栏布局' },
  { value: 'dashboard', label: '仪表盘', desc: '渐变背景 + 仪表盘风格' },
  { value: 'bento', label: '便当盒', desc: '大圆角卡片 + 便当盒网格' },
  { value: 'command', label: '命令式', desc: '暗黑 + 等宽字体 + 命令风格' },
];

/* ---------- 导航栏自定义 ---------- */
const navTab = ref<'main' | 'admin'>('main');
const navDragItem = ref<string | null>(null);
const navDragOver = ref<string | null>(null);

const mainMenuAll = [
  { path: '/', label: '文件管理', icon: 'Folder' },
  { path: '/recent', label: '最近全部', icon: 'Clock' },
  { path: '/media', label: '视频文档', icon: 'VideoCamera' },
  { path: '/quick-access', label: '快捷访问', icon: 'Star' },
  { path: '/hidden', label: '隐藏空间', icon: 'Lock' },
  { path: '/subscriptions', label: '转存和订阅', icon: 'Download' },
  { path: '/shares', label: '我的分享', icon: 'Share' },
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

function onNavDragStart(path: string, e: MouseEvent) {
  navDragItem.value = path;
  e.preventDefault();
}

function onNavDragOver(path: string, e: MouseEvent) {
  navDragOver.value = path;
  e.preventDefault();
}

function onNavDrop(path: string, e: MouseEvent) {
  e.preventDefault();
  if (!navDragItem.value || navDragItem.value === path) return;
  const order = navTab.value === 'main' ? mainMenuOrder.value : adminMenuOrder.value;
  const from = order.indexOf(navDragItem.value);
  const to = order.indexOf(path);
  if (from >= 0 && to >= 0) {
    order.splice(to, 0, order.splice(from, 1)[0]);
    saveNavOrder();
    ElMessage.success('导航顺序已保存');
  }
  navDragItem.value = null;
  navDragOver.value = null;
}

function onNavDragEnd() {
  navDragItem.value = null;
  navDragOver.value = null;
}

// 鼠标事件拖拽（实时重排 + 动画）
const navMouseDrag = ref(false);
const navMouseDragPath = ref<string | null>(null);
const navDropTarget = ref<string | null>(null);

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

/* 应用主题 */
function applyTheme(theme: string) {
  document.documentElement.setAttribute('data-theme', theme);
}
const saving = ref(false);
const bgUploading = ref(false);
const logoUploading = ref(false);

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
    const s = await api('/settings');
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
  } catch {
    /* 使用默认值 */
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
    <div class="settings-grid">
      <!-- 基本信息 -->
      <section class="panel glass-card span2">
        <div class="panel-head">
          <div class="panel-icon pi-blue"><el-icon><Document /></el-icon></div>
          <div>
            <h3>基本信息</h3>
            <p>系统名称、Logo 与公告，显示在登录页与全站</p>
          </div>
        </div>
        <div class="fields">
          <div class="field">
            <label>系统名称</label>
            <el-input v-model="form.appName" placeholder="显示在登录页与侧边栏的名称" />
          </div>
          <div class="field">
            <label>系统 Logo</label>
            <div class="logo-row">
              <div class="logo-upload-box" @click="document.querySelector('.logo-file-input')?.click()">
                <img v-if="form.logo" :src="form.logo" class="logo-preview" alt="logo" @error="($event.target as HTMLImageElement).style.display = 'none'" />
                <span v-else class="logo-placeholder">点击上传</span>
              </div>
              <div class="logo-actions">
                <el-button :loading="logoUploading" size="small" @click="document.querySelector('.logo-file-input')?.click()">选择图片</el-button>
                <el-button v-if="form.logo" size="small" @click="form.logo = ''">移除</el-button>
                <input type="file" accept="image/*" class="logo-file-input" hidden @change="onLogoFile" />
              </div>
            </div>
          </div>
          <div class="field">
            <label>版权页脚</label>
            <el-input v-model="form.copyright" placeholder="如 © 2025 NebulaDrive" />
          </div>
          <div class="field">
            <label>联系邮箱</label>
            <el-input v-model="form.contactEmail" placeholder="如 support@example.com" />
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

      <!-- 注册与安全 -->
      <section class="panel glass-card">
        <div class="panel-head">
          <div class="panel-icon pi-green"><el-icon><Lock /></el-icon></div>
          <div>
            <h3>注册与安全</h3>
            <p>注册开关与账号安全策略</p>
          </div>
        </div>
        <div class="settings-rows">
          <div class="s-row">
            <span class="s-label">开放注册</span>
            <div class="s-control">
              <el-switch v-model="form.registerEnabled" />
            </div>
          </div>
          <div class="s-row">
            <span class="s-label">密码最小长度</span>
            <div class="s-control">
              <el-input-number
                v-model="form.minPasswordLen"
                :min="4"
                :max="32"
                :step="1"
                size="small"
                controls-position="right"
              />
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
            </div>
          </div>
          <div class="s-row">
            <span class="s-label">登录验证码</span>
            <div class="s-control">
              <el-input-number
                v-model="form.loginCaptchaThreshold"
                :min="0"
                :max="10"
                :step="1"
                size="small"
                controls-position="right"
              />
              <span class="s-hint">次 · 0 = 关闭</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 上传与存储 -->
      <section class="panel glass-card">
        <div class="panel-head">
          <div class="panel-icon pi-orange"><el-icon><Upload /></el-icon></div>
          <div>
            <h3>上传与存储</h3>
            <p>分片大小与文件大小限制</p>
          </div>
        </div>
        <div class="settings-rows">
          <div class="s-row">
            <span class="s-label">上传分片大小</span>
            <div class="s-control">
              <el-input-number
                v-model="form.uploadChunkSizeMB"
                :min="1"
                :max="100"
                :step="1"
                size="small"
                controls-position="right"
              />
              <span class="s-hint">MB</span>
            </div>
          </div>
          <div class="s-row">
            <span class="s-label">单文件大小上限</span>
            <div class="s-control">
              <el-input-number
                v-model="form.maxFileSizeGB"
                :min="0"
                :max="1024"
                :step="1"
                size="small"
                controls-position="right"
              />
              <span class="s-hint">GB · 0 = 不限制</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 注册与安全 -->
      <section class="panel glass-card">
        <div class="panel-head">
          <div class="panel-icon pi-green"><el-icon><Lock /></el-icon></div>
          <div>
            <h3>注册与安全</h3>
            <p>注册开关与账号安全策略</p>
          </div>
        </div>
        <div class="settings-rows">
          <div class="s-row">
            <span class="s-label">开放注册</span>
            <div class="s-control">
              <el-switch v-model="form.registerEnabled" />
            </div>
          </div>
          <div class="s-row">
            <span class="s-label">密码最小长度</span>
            <div class="s-control">
              <el-input-number
                v-model="form.minPasswordLen"
                :min="4"
                :max="32"
                :step="1"
                size="small"
                controls-position="right"
              />
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
            </div>
          </div>
          <div class="s-row">
            <span class="s-label">登录验证码</span>
            <div class="s-control">
              <el-input-number
                v-model="form.loginCaptchaThreshold"
                :min="0"
                :max="10"
                :step="1"
                size="small"
                controls-position="right"
              />
              <span class="s-hint">次 · 0 = 关闭</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 上传与存储 -->
      <section class="panel glass-card">
        <div class="panel-head">
          <div class="panel-icon pi-orange"><el-icon><Upload /></el-icon></div>
          <div>
            <h3>上传与存储</h3>
            <p>分片大小与文件大小限制</p>
          </div>
        </div>
        <div class="settings-rows">
          <div class="s-row">
            <span class="s-label">上传分片大小</span>
            <div class="s-control">
              <el-input-number
                v-model="form.uploadChunkSizeMB"
                :min="1"
                :max="100"
                :step="1"
                size="small"
                controls-position="right"
              />
              <span class="s-hint">MB</span>
            </div>
          </div>
          <div class="s-row">
            <span class="s-label">单文件大小上限</span>
            <div class="s-control">
              <el-input-number
                v-model="form.maxFileSizeGB"
                :min="0"
                :max="1024"
                :step="1"
                size="small"
                controls-position="right"
              />
              <span class="s-hint">GB · 0 = 不限制</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 分享管理 -->
      <section class="panel glass-card">
        <div class="panel-head">
          <div class="panel-icon pi-teal"><el-icon><Share /></el-icon></div>
          <div>
            <h3>分享管理</h3>
            <p>新建分享的默认有效期</p>
          </div>
        </div>
        <div class="settings-rows">
          <div class="s-row">
            <span class="s-label">默认分享有效期</span>
            <div class="s-control">
              <el-select v-model="form.shareDefaultExpireDays" size="small">
                <el-option :value="0" label="永久（默认）" />
                <el-option :value="1" label="1 天" />
                <el-option :value="7" label="7 天" />
                <el-option :value="30" label="30 天" />
                <el-option :value="90" label="90 天" />
              </el-select>
            </div>
          </div>
        </div>
      </section>

      <!-- 回收站 -->
      <section class="panel glass-card">
        <div class="panel-head">
          <div class="panel-icon pi-red"><el-icon><Delete /></el-icon></div>
          <div>
            <h3>回收站</h3>
            <p>自动清理超期文件，节省空间</p>
          </div>
        </div>
        <div class="settings-rows">
          <div class="s-row">
            <span class="s-label">自动清理保留期</span>
            <div class="s-control">
              <el-select v-model="form.recycleRetentionDays" size="small">
                <el-option :value="0" label="关闭（仅手动）" />
                <el-option :value="3" label="3 天" />
                <el-option :value="7" label="7 天" />
                <el-option :value="15" label="15 天" />
                <el-option :value="30" label="30 天" />
                <el-option :value="90" label="90 天" />
              </el-select>
            </div>
          </div>
        </div>
      </section>

      <!-- 主题色（独占整行） -->
      <section class="panel glass-card span2 brand-color-card">
        <div class="brand-color-layout">
          <div class="brand-color-info">
            <div class="panel-icon pi-purple"><el-icon><Brush /></el-icon></div>
            <div class="brand-color-text">
              <h3>主题色</h3>
              <p>品牌主色，应用于全站强调色</p>
            </div>
          </div>
          <div class="brand-color-picker">
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
            <button class="color-reset" v-if="form.brandColor" @click="form.brandColor = ''" title="恢复默认">
              <el-icon><Close /></el-icon>
            </button>
            <el-color-picker v-model="form.brandColor" class="custom-picker" title="自定义颜色" />
          </div>
        </div>
      </section>

      <!-- 主题风格（独占整行） -->
      <section class="panel glass-card span2">
        <div class="panel-head">
          <div class="panel-icon pi-green"><el-icon><Brush /></el-icon></div>
          <div>
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

      <!-- 导航栏自定义（独占整行） -->
      <section class="panel glass-card span2">
        <div class="panel-head">
          <div class="panel-icon pi-orange"><el-icon><Rank /></el-icon></div>
          <div>
            <h3>导航栏自定义</h3>
            <p>拖拽菜单项调整显示顺序，自动保存</p>
          </div>
        </div>
        <div class="nav-customize-container">
          <div class="nav-customize-tabs">
            <button
              class="nav-tab"
              :class="{ active: navTab === 'main' }"
              @click="navTab = 'main'"
            >主菜单</button>
            <button
              class="nav-tab"
              :class="{ active: navTab === 'admin' }"
              @click="navTab = 'admin'"
            >系统管理</button>
          </div>
          <div class="nav-customize-list">
            <div
              v-for="item in currentNavItems"
              :key="item.path"
              class="nav-customize-item"
              :class="{ 
                dragging: navMouseDragPath === item.path, 
                'drop-target': navDropTarget === item.path && navMouseDragPath !== item.path 
              }"
              @mousedown="onNavMouseDown(item.path, $event)"
              @mousemove="onNavMouseMove(item.path, $event)"
              @mouseup="onNavMouseUp(item.path)"
            >
              <el-icon class="nav-drag-icon"><Rank /></el-icon>
              <el-icon class="nav-menu-icon"><component :is="item.icon" /></el-icon>
              <span class="nav-menu-label">{{ item.label }}</span>
            </div>
          </div>
          <div class="nav-customize-hint">
            <el-icon><InfoFilled /></el-icon>
            <span>按住菜单项拖动到目标位置，松手后自动保存</span>
          </div>
        </div>
      </section>

      <!-- 在线更新 -->
      <section class="panel glass-card">
        <div class="panel-head">
          <div class="panel-icon pi-purple"><el-icon><Refresh /></el-icon></div>
          <div>
            <h3>在线更新</h3>
            <p>从 GitHub 检查最新版本</p>
          </div>
        </div>
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
          <div class="s-row">
            <span class="s-label"></span>
            <div class="s-control">
              <el-button size="small" :loading="updateChecking" @click="checkUpdate">
                <el-icon><Refresh /></el-icon>&nbsp;检查更新
              </el-button>
            </div>
          </div>
        </div>
      </section>

      <!-- 自定义背景 -->
      <section class="panel glass-card span2">
        <div class="panel-head">
          <div class="panel-icon pi-cyan"><el-icon><Picture /></el-icon></div>
          <div>
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
              <div class="s-control">
                <el-color-picker v-model="form.bgGradientFrom" />
              </div>
            </div>
            <div class="s-row">
              <span class="s-label">结束色</span>
              <div class="s-control">
                <el-color-picker v-model="form.bgGradientTo" />
              </div>
            </div>
            <div class="s-row">
              <span class="s-label">渐变角度</span>
              <div class="s-control">
                <el-slider v-model="form.bgGradientAngle" :min="0" :max="360" :step="5" class="bg-slider" />
              </div>
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
              <div class="s-control">
                <el-color-picker v-model="form.bgColor" />
              </div>
            </div>
          </template>

          <!-- 遮罩强度（所有自定义类型通用） -->
          <div class="s-row" v-if="form.bgType !== 'theme'">
            <span class="s-label">遮罩强度</span>
            <div class="s-control">
              <el-slider v-model="form.bgOverlay" :min="0" :max="100" :step="5" class="bg-slider" />
            </div>
          </div>
          <div class="s-row" v-if="form.bgType !== 'theme'">
            <span class="s-label"></span>
            <div class="s-control">
              <el-button link size="small" @click="resetBg">恢复默认</el-button>
            </div>
          </div>
        </div>
      </section>
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
  gap: 20px;
}
.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: stretch;
}
.span2 {
  grid-column: span 2;
}

/* ---------- 面板 ---------- */
.panel {
  border-radius: 18px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.panel:hover {
  transform: none; /* 大卡片不缩放，避免压到相邻面板 */
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.panel-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.panel-head p {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
}
.panel-icon {
  width: 40px;
  height: 40px;
  border-radius: 13px;
  display: grid;
  place-items: center;
  font-size: 19px;
  color: #fff;
  flex-shrink: 0;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
.pi-blue {
  background: linear-gradient(135deg, #5b8cff, #7c6ff0);
}
.pi-green {
  background: linear-gradient(135deg, #2ea24f, #6fcf9a);
}
.pi-orange {
  background: linear-gradient(135deg, #e8933a, #f0b35c);
}
.pi-teal {
  background: linear-gradient(135deg, #2aa8a8, #4fc9c9);
}
.pi-red {
  background: linear-gradient(135deg, #e5484d, #f08a8e);
}
.pi-purple {
  background: linear-gradient(135deg, #9a6fe8, #c59af5);
}
.pi-cyan {
  background: linear-gradient(135deg, #2aa8d8, #6fd0e8);
}

/* ---------- 基本信息：双列表单 ---------- */
.fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 18px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field.span2 {
  grid-column: span 2;
}
.field label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.logo-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.logo-upload-box {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  border: 1.5px dashed var(--glass-border);
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  flex-shrink: 0;
  transition: border-color 0.2s;
}
.logo-upload-box:hover {
  border-color: var(--accent);
}
.logo-placeholder {
  font-size: 12px;
  color: var(--text-dim);
}
.logo-preview {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.logo-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.logo-file-input {
  display: none;
}

/* ---------- 其他面板：行式 ---------- */
.rows {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.row-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.row-end {
  display: flex;
  align-items: center;
  gap: 8px;
}
.unit {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.num {
  width: 130px;
}
.sel {
  width: 170px;
}

/* ---------- 新行式布局（注册与安全等） ---------- */
.settings-rows {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.s-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  align-items: center;
  gap: 16px;
}
.s-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.s-control {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}
.s-control .el-input-number {
  width: 150px;
  flex-shrink: 0;
}
.s-control .el-select {
  width: 150px;
  flex-shrink: 0;
}
.s-control .el-switch {
  flex-shrink: 0;
}
.s-hint {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.s-control .row-value {
  font-size: 13px;
  color: var(--text);
}

/* ---------- 品牌色卡片 ---------- */
.brand-color-card {
  padding: 16px;
}
.brand-color-layout {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.brand-color-info {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 50%;
}
.brand-color-info .panel-icon {
  flex-shrink: 0;
}
.brand-color-text h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.brand-color-text p {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
}
.brand-color-picker {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-shrink: 0;
}
.preset-colors {
  display: flex;
  align-items: center;
  gap: 8px;
}
.color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15), inset 0 1px 2px rgba(255,255,255,0.2);
  backdrop-filter: blur(4px);
}
.color-swatch:hover {
  transform: scale(1.15);
  box-shadow: 0 4px 16px rgba(0,0,0,0.25), inset 0 1px 2px rgba(255,255,255,0.3);
}
.color-swatch.active {
  border-color: #fff;
  box-shadow: 0 0 0 3px var(--accent-soft), 0 4px 16px rgba(0,0,0,0.3);
  transform: scale(1.1);
}
.color-reset {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text-secondary);
  cursor: pointer;
  display: grid;
  place-items: center;
  font-size: 14px;
  transition: all 0.2s;
}
.color-reset:hover {
  color: var(--text);
  border-color: var(--accent);
}
.custom-picker {
  width: 28px;
  height: 28px;
}
.custom-picker .el-color-picker__color {
  border-radius: 50%;
}

/* ---------- 自定义背景 ---------- */
.bg-file-input {
  display: none;
}
.bg-preview-wrap {
  flex: 1;
  display: flex;
  justify-content: flex-end;
}
.bg-preview {
  width: 220px;
  height: 120px;
  border-radius: 12px;
  object-fit: cover;
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow);
  flex-shrink: 0;
}
.bg-preview-empty {
  width: 220px;
  height: 120px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--surface);
  border: 1px dashed var(--glass-border);
}
.bg-slider {
  flex: 1;
  max-width: 320px;
}

/* ---------- 保存栏 ---------- */
.save-bar {
  border-radius: 18px;
  padding: 14px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.save-bar:hover {
  transform: none;
}
.save-hint {
  font-size: 12px;
  color: var(--text-secondary);
}

@media (max-width: 900px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
  .span2 {
    grid-column: span 1;
  }
  .fields {
    grid-template-columns: 1fr;
  }
  .field.span2 {
    grid-column: span 1;
  }
}

/* 主题选择器 */
.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  padding: 16px 0;
}
.theme-card {
  cursor: pointer;
  border-radius: 14px;
  overflow: hidden;
  border: 2px solid var(--glass-border);
  transition: all 0.2s;
  background: var(--glass-bg);
}
.theme-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-hover);
}
.theme-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.theme-preview {
  height: 100px;
  display: flex;
  align-items: flex-end;
  padding: 10px;
  gap: 6px;
}
.theme-preview::before,
.theme-preview::after {
  content: '';
  width: 30px;
  height: 20px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.4);
}
.theme-preview::after {
  width: 20px;
  height: 30px;
}
[data-theme-preview='light-glass'] {
  background: linear-gradient(135deg, #9fc2ff, #cdb4ef, #f2b6d6);
}
[data-theme-preview='dark-glass'] {
  background: linear-gradient(135deg, #080c18, #151c34, #2b1d45);
}
[data-theme-preview='minimal'] {
  background: #f5f6f8;
}
[data-theme-preview='silver'] {
  background: linear-gradient(135deg, #e3e9f1, #b9c4d4, #7e8ea3);
}
[data-theme-preview='cyberpunk'] {
  background: #0a0a0f;
}
[data-theme-preview='cyberpunk']::before,
[data-theme-preview='cyberpunk']::after {
  background: rgba(0, 255, 200, 0.2);
  border-color: rgba(0, 255, 200, 0.4);
}
[data-theme-preview='retro'] {
  background: linear-gradient(135deg, #f5e6d3, #e8d4b8, #d4b896);
}
[data-theme-preview='retro']::before,
[data-theme-preview='retro']::after {
  background: rgba(139, 108, 76, 0.2);
  border-color: rgba(139, 108, 76, 0.3);
}
[data-theme-preview='forest'] {
  background: linear-gradient(135deg, #2d5a3f, #4a7c59, #6b9e78);
}
[data-theme-preview='forest']::before,
[data-theme-preview='forest']::after {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.3);
}
[data-theme-preview='neumorphic'] {
  background: #e0e5ec;
}
[data-theme-preview='neumorphic']::before,
[data-theme-preview='neumorphic']::after {
  background: #e0e5ec;
  border: none;
  box-shadow: 3px 3px 6px rgba(166, 178, 199, 0.5), -3px -3px 6px rgba(255, 255, 255, 0.8);
}
[data-theme-preview='swiss'] {
  background: #fff;
}
[data-theme-preview='swiss']::before,
[data-theme-preview='swiss']::after {
  background: #fff;
  border: 2px solid #000;
}
.theme-name {
  padding: 10px 12px 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.theme-desc {
  padding: 0 12px 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

/* ---------- 导航栏自定义 ---------- */
.nav-customize-container {
  padding: 16px;
}
.nav-customize-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.nav-tab {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--glass-border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}
.nav-tab:hover {
  background: var(--accent-soft);
}
.nav-tab.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.nav-customize-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
}
.nav-customize-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--surface);
  border: 1px solid var(--glass-border);
  cursor: grab;
  transition: all 0.2s;
}
.nav-customize-item:active {
  cursor: grabbing;
}
.nav-customize-item:hover {
  border-color: var(--accent);
  box-shadow: 0 2px 8px var(--shadow);
}
.nav-customize-item.dragging {
  opacity: 0.5;
  transform: scale(0.98);
}
.nav-customize-item.drag-over {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.nav-drag-icon {
  color: var(--text-secondary);
  font-size: 16px;
  cursor: grab;
}
.nav-menu-icon {
  color: var(--accent);
  font-size: 18px;
}
.nav-menu-label {
  flex: 1;
  font-size: 14px;
  color: var(--text);
}
.nav-customize-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--text-secondary);
  font-size: 13px;
}

/* 拖拽项动画 */
.nav-customize-item {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  user-select: none;
}
.nav-customize-item.dragging {
  opacity: 0.5;
  transform: scale(1.02);
  border-color: var(--accent);
  box-shadow: 0 4px 16px var(--shadow);
  z-index: 10;
}
.nav-customize-item.drop-target {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
  transform: translateY(-3px);
}
</style>
