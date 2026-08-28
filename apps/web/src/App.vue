<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';
import { api, fmtSize } from './api';
import { useTheme, THEMES, type ThemeKey } from './useTheme';
import { ElMessage, ElMessageBox } from 'element-plus';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { theme, setTheme, isGlassTheme } = useTheme();

// 布局类型（根据主题决定）
const layoutType = computed(() => {
  const t = THEMES[theme.value as ThemeKey];
  return t?.layout || 'sidebar';
});

const appName = ref('NebulaDrive 星云网盘');
const collapsed = ref(false);
const showThemePicker = ref(false);

/* ---------- 侧栏底部存储条（P7）：与 Files.vue 的 usageTotal/quota 同源 ---------- */
const usageTotal = ref(0);
const quota = computed(() => Number((auth.user as any)?.quota) || 0);
const storagePct = computed(() =>
  quota.value > 0 ? Math.min(100, Math.round((usageTotal.value / quota.value) * 100)) : null
);

/* ---------- 移动端抽屉（P8）：离屏抽屉，Esc / 点外部关闭，body 锁滚动 ---------- */
const drawerOpen = ref(false);
const drawerPrevCollapsed = ref(false);
function openDrawer() {
  drawerPrevCollapsed.value = collapsed.value;
  collapsed.value = false; // 抽屉内展示完整标签
  drawerOpen.value = true;
}
function closeDrawer() {
  drawerOpen.value = false;
  collapsed.value = drawerPrevCollapsed.value;
}
function onDrawerEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && drawerOpen.value) closeDrawer();
}
onMounted(() => {
  document.addEventListener('keydown', onDrawerEsc);
  watch(drawerOpen, (open) => {
    document.body.style.overflow = open ? 'hidden' : '';
  });
});
onUnmounted(() => {
  document.removeEventListener('keydown', onDrawerEsc);
});

// 主题选择器选项（来自 useTheme 的 THEMES 元数据）
const themeOptions = Object.entries(THEMES).map(([key, v]) => ({ key, ...v }));

// 点击主题选择器外部时关闭
function onDocClick(e: MouseEvent) {
  if (showThemePicker.value) {
    const el = (e.target as HTMLElement)?.closest?.('.theme-wrap');
    if (!el) showThemePicker.value = false;
  }
}
onMounted(() => {
  document.addEventListener('click', onDocClick);
});
onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
});

// 更新检查状态
const updateInfo = ref<{ currentVersion: string; latestVersion: string; isUpdateAvailable: boolean; releaseNotes: string; publishedAt: string } | null>(null);
const updateChecking = ref(false);
const showUpdateBanner = ref(false);

/** 检查更新 */
async function checkUpdate() {
  updateChecking.value = true;
  try {
    const r = await api('/system/check-update');
    updateInfo.value = r;
    if (r.isUpdateAvailable && !localStorage.getItem('nebula_update_dismissed_' + r.latestVersion)) {
      showUpdateBanner.value = true;
    }
  } catch (e: any) {
    // 静默失败，不影响正常使用
    console.warn('检查更新失败:', e.message);
  } finally {
    updateChecking.value = false;
  }
}

/** 忽略本次更新提示 */
function dismissUpdate() {
  if (updateInfo.value) {
    localStorage.setItem('nebula_update_dismissed_' + updateInfo.value.latestVersion, '1');
  }
  showUpdateBanner.value = false;
}

/** 查看更新详情 */
async function viewUpdateDetails() {
  try {
    const r = await api('/system/update-log');
    const latest = r.releases?.[0];
    if (latest) {
      // 将 Markdown 转换为简单 HTML
      const notes = (latest.notes || '无更新说明')
        .replace(/^### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^## (.+)$/gm, '<h3>$1</h3>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/^- /g, '• ')
        .replace(/\n/g, '<br>');
      
      ElMessageBox({
        title: `版本 v${latest.version}`,
        message: `<div class="release-notes">${notes}</div>`,
        dangerouslyUseHTMLString: true,
        confirmButtonText: '关闭',
        customClass: 'release-dialog',
      });
    }
  } catch (e: any) {
    ElMessage.error(e.message || '获取更新详情失败');
  }
}

/** 立即更新：下载新版本包并重启服务器 */
async function updateNow() {
  if (!updateInfo.value) return;
  ElMessageBox.confirm(
    `即将更新到 v${updateInfo.value.latestVersion}，系统将下载新版本包并自动重启。`,
    '确认更新',
    {
      confirmButtonText: '更新',
      cancelButtonText: '取消',
      type: 'info',
    }
  ).then(async () => {
    try {
      ElMessage.info('正在下载新版本包，请稍候...');
      const r = await api('/system/perform-update', { method: 'POST' });
      ElMessage.success(r.message || '更新成功，服务器即将重启');
      // P1-2：轮询 /health 通过后再刷新（而非固定 3s），消除撞停机窗口的"无法连接"
      const doReload = () => window.location.reload();
      const startPoll = Date.now();
      const poll = setInterval(() => {
        // 超过 30s 兜底刷新（避免无限轮询）
        if (Date.now() - startPoll > 30000) {
          clearInterval(poll);
          doReload();
          return;
        }
        fetch('/health', { method: 'GET' })
          .then((res) => {
            if (res.ok) {
              clearInterval(poll);
              setTimeout(doReload, 300); // 留 300ms 让新 server 完全就绪
            }
          })
          .catch(() => {
            // 服务器尚未起来，继续轮询
          });
      }, 2000);
    } catch (e: any) {
      ElMessage.error(e.message || '更新失败');
    }
  }).catch(() => {
    // 用户取消
  });
}

const bare = computed(() => !route.meta?.auth);
const isAdmin = computed(() => auth.user?.role === 'admin');

/** 权限判断：当前用户是否拥有某权限点 */
const perm = (key: string) => auth.hasPerm(key);

const pageTitle = computed(() => {
  const map: Record<string, string> = {
    '/': '我的文件',
    '/recent': '最近',
    '/favorites': '我的收藏',
    '/quick-access': '快捷访问',
    '/media': '媒体库',
    '/hidden': '隐藏空间',
    '/subscriptions': '转存和订阅',
    '/shares': '共享',
    '/recycle': '回收站',
    '/admin/users': '用户管理',
    '/admin/roles': '角色权限',
    '/admin/storages': '存储管理',
    '/admin/settings': '系统设置',
    '/admin/logs': '操作日志',
    '/admin/sync': '同步管理',
    '/admin/stats': '系统统计',
    '/profile': '我的资料',
  };
  return map[route.path] || 'NebulaDrive';
});

// 侧边栏菜单（perm = 所需权限点；无 perm 的项始终显示）
const mainMenuAll = [
  { path: '/', label: '我的文件', icon: 'Folder', perm: 'files:view' },
  { path: '/recent', label: '最近', icon: 'Clock', perm: 'files:view' },
  { path: '/favorites', label: '我的收藏', icon: 'StarFilled', perm: 'files:view' },
  { path: '/quick-access', label: '快捷访问', icon: 'Star', perm: 'files:view' },
  { path: '/media', label: '媒体库', icon: 'VideoCamera', perm: 'files:view' },
  { path: '/hidden', label: '隐藏空间', icon: 'Lock', perm: 'files:view' },
  { path: '/subscriptions', label: '转存和订阅', icon: 'Download', perm: 'files:share' },
  { path: '/shares', label: '共享', icon: 'Share', perm: 'files:share' },
  { path: '/share-collab', label: '共享管理', icon: 'User', perm: 'files:share' },
  { path: '/recycle', label: '回收站', icon: 'Delete', perm: 'recycle:view' },
  { path: '/profile', label: '我的资料', icon: 'User', perm: 'files:view' },
];
const adminMenuAll = [
  { path: '/admin/users', label: '用户管理', icon: 'User', perm: 'users:view' },
  { path: '/admin/roles', label: '角色权限', icon: 'Lock', perm: 'users:manage' },
  { path: '/admin/storages', label: '存储管理', icon: 'Box', perm: 'storages:view' },
  { path: '/admin/settings', label: '系统设置', icon: 'Tools', perm: 'settings:view' },
  { path: '/admin/logs', label: '操作日志', icon: 'Document', perm: 'logs:view' },
  { path: '/admin/sync', label: '同步管理', icon: 'Refresh', perm: 'sync:view' },
  { path: '/admin/stats', label: '系统统计', icon: 'DataLine', perm: 'stats:view' },
];
// 读取导航隐藏配置
function getHiddenNav(): Record<string, boolean> {
  try {
    const saved = localStorage.getItem('nebula_nav_hidden');
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return {};
}
const hiddenNav = ref<Record<string, boolean>>(getHiddenNav());

const mainMenu = computed(() => mainMenuAll.filter((m) => {
  if (hiddenNav.value[m.path]) return false;
  return !m.perm || perm(m.perm);
}));
const adminMenu = computed(() => adminMenuAll.filter((m) => {
  if (hiddenNav.value[m.path]) return false;
  return !m.perm || perm(m.perm);
}));

/* ---------- 导航菜单拖拽自定义 ---------- */
const isCustomizingNav = ref(false);
const navDragItem = ref<string | null>(null);
const navDragOver = ref<string | null>(null);
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

// 按自定义顺序排序菜单
const orderedMainMenu = computed(() => {
  const order = mainMenuOrder.value;
  return [...mainMenu.value].sort((a, b) => {
    const ia = order.indexOf(a.path);
    const ib = order.indexOf(b.path);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
});

/* 侧边栏导航分组（对标主流网盘：文件区 / 分享协作 / 空间工具），组内仍按自定义排序 */
const NAV_GROUPS: { label: string; paths: Set<string> }[] = [
  { label: '空间', paths: new Set(['/', '/recent', '/favorites', '/quick-access', '/media', '/hidden']) },
  { label: '分享协作', paths: new Set(['/subscriptions', '/shares', '/share-collab']) },
  { label: '更多', paths: new Set(['/recycle', '/profile']) },
];
const groupedMainMenu = computed(() =>
  NAV_GROUPS
    .map((g) => ({ ...g, items: orderedMainMenu.value.filter((m) => g.paths.has(m.path)) }))
    .filter((g) => g.items.length > 0)
);

const orderedAdminMenu = computed(() => {
  const order = adminMenuOrder.value;
  return [...adminMenu.value].sort((a, b) => {
    const ia = order.indexOf(a.path);
    const ib = order.indexOf(b.path);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
});

function onNavDragStart(path: string) {
  navDragItem.value = path;
}

function onNavDragOver(path: string) {
  navDragOver.value = path;
}

function onNavDrop(path: string) {
  if (!navDragItem.value || navDragItem.value === path) return;
  // 判断是主菜单还是管理菜单
  const isMain = mainMenuAll.some(m => m.path === navDragItem.value);
  const order = isMain ? mainMenuOrder.value : adminMenuOrder.value;
  const from = order.indexOf(navDragItem.value);
  const to = order.indexOf(path);
  if (from >= 0 && to >= 0) {
    order.splice(to, 0, order.splice(from, 1)[0]);
    saveNavOrder();
  }
  navDragItem.value = null;
  navDragOver.value = null;
}

function onNavDragEnd() {
  navDragItem.value = null;
  navDragOver.value = null;
}

function toggleCustomizeNav() {
  isCustomizingNav.value = !isCustomizingNav.value;
  if (!isCustomizingNav.value) saveNavOrder();
}

onMounted(async () => {
  if (auth.token) {
    await auth.me();
    // 侧栏底部存储条：所有存储 used 之和（与 Files.vue 同源）
    api('/storages')
      .then((res: any) => {
        const list = res?.storages || [];
        usageTotal.value = list.reduce((s: number, st: any) => s + (st.used || 0), 0);
      })
      .catch(() => { /* 用量加载失败不阻塞页面 */ });
  }
  try {
    const s = await api('/settings');
    if (s?.appName) appName.value = s.appName;
    // 应用主题：用户已选（localStorage nebula_theme）优先；未选过则应用管理员全局主题
    if (s?.theme) {
      const saved = localStorage.getItem('nebula_theme');
      if (saved) {
        // 用户已选过主题，确保 data-theme 与 localStorage 一致（防御性）
        document.documentElement.setAttribute('data-theme', saved);
      } else if (s.theme in THEMES) {
        // 用户未选过：应用管理员全局主题并写入 nebula_theme
        setTheme(s.theme as ThemeKey);
      } else {
        // legacy 主题：保持旧行为
        document.documentElement.setAttribute('data-theme', s.theme);
      }
    }
    applyBrandColor(s?.brandColor);
    applyBackground(s);
  } catch {
    /* 忽略 */
  }
  if (route.meta?.admin && auth.user?.role !== 'admin') {
    router.replace('/');
  }
  // 检查更新（延迟 2 秒，不阻塞页面加载）
  setTimeout(() => checkUpdate(), 2000);
});

function logout() {
  auth.logout();
  router.push('/login');
}

/** 应用品牌主色：覆盖 --accent / --accent-soft（空 = 跟随主题默认） */
function applyBrandColor(color?: string) {
  const root = document.documentElement;
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

/** 应用自定义背景：theme(跟随主题) / image / gradient / color */
function applyBackground(s?: any) {
  const root = document.documentElement;
  const style = root.style;
  // 清除旧的自定义背景
  style.removeProperty('--bg');
  style.removeProperty('--bg-size');
  style.removeProperty('--bg-overlay');
  const bgEl = document.querySelector('.app-bg') as HTMLElement | null;
  bgEl?.classList.remove('has-image');

  const type = s?.bgType || 'theme';
  if (type === 'theme') return; // 跟随主题默认

  // 遮罩：0-100 映射到 0-0.6 的透明度
  const overlay = Math.max(0, Math.min(100, Number(s?.bgOverlay) || 0)) / 100;
  style.setProperty('--bg-overlay', String(overlay * 0.6));

  if (type === 'image' && s?.bgImage) {
    style.setProperty('--bg', `url(${s.bgImage})`);
    style.setProperty('--bg-size', 'cover');
    bgEl?.classList.add('has-image');
  } else if (type === 'gradient' && s?.bgGradientFrom && s?.bgGradientTo) {
    const angle = Number(s?.bgGradientAngle) || 135;
    style.setProperty('--bg', `linear-gradient(${angle}deg, ${s.bgGradientFrom} 0%, ${s.bgGradientTo} 100%)`);
  } else if (type === 'color' && s?.bgColor) {
    style.setProperty('--bg', s.bgColor);
  }
}
</script>

<template>
  <router-view v-if="bare" />
  <div v-else class="shell">
    <!-- 背景渐变 + 遮罩层 -->
    <div class="app-bg" aria-hidden="true" />
    <div class="app-overlay" aria-hidden="true" />

    <div class="layout" :class="{ 'layout-topnav': layoutType === 'topnav' }">
      <!-- 移动端（P8）：抽屉遮罩，点击关闭 -->
      <div v-if="drawerOpen" class="drawer-mask" @click="closeDrawer" />
      <!-- 侧边栏（sidebar/dashboard/bento 布局） -->
      <aside v-if="layoutType !== 'topnav'" class="aside glass" :class="{ collapsed, 'drawer-open': drawerOpen }">
        <div class="logo">
          <div class="logo-badge">
            <el-icon :size="20"><Cloudy /></el-icon>
          </div>
          <div v-if="!collapsed" class="logo-text">
            <p class="logo-name">{{ appName }}</p>
            <p class="logo-sub">Glass Drive</p>
          </div>
          <button
            class="collapse-btn glass-btn"
            :title="collapsed ? '展开侧边栏' : '折叠侧边栏'"
            @click="collapsed = !collapsed"
          >
            <el-icon :class="{ flip: collapsed }"><ArrowLeft /></el-icon>
          </button>
        </div>

        <nav class="menu" :class="{ customizing: isCustomizingNav }">
          <!-- 主菜单分组渲染（空间 / 分享协作 / 更多），组内保留拖拽自定义排序 -->
          <template v-for="group in groupedMainMenu" :key="group.label">
            <div v-if="!collapsed" class="menu-group">{{ group.label }}</div>
            <div v-else class="menu-group-line" aria-hidden="true"></div>
            <button
              v-for="item in group.items"
              :key="item.path"
              class="menu-item"
              :class="{ active: route.path === item.path, dragging: navDragItem === item.path, 'drag-over': navDragOver === item.path && navDragItem !== item.path }"
              :title="collapsed ? item.label : undefined"
              :draggable="isCustomizingNav"
              @dragstart="onNavDragStart(item.path)"
              @dragover="onNavDragOver(item.path)"
              @drop="onNavDrop(item.path)"
              @dragend="onNavDragEnd"
              @click="isCustomizingNav ? null : router.push(item.path)"
            >
              <el-icon><component :is="item.icon" /></el-icon>
              <span v-if="!collapsed" class="menu-label">{{ item.label }}</span>
              <span v-if="isCustomizingNav && !collapsed" class="drag-handle"><el-icon><Rank /></el-icon></span>
            </button>
          </template>

          <template v-if="isAdmin">
            <div v-if="!collapsed" class="menu-group">系统管理</div>
            <button
              v-for="item in orderedAdminMenu"
              :key="item.path"
              class="menu-item"
              :class="{ active: route.path === item.path, dragging: navDragItem === item.path, 'drag-over': navDragOver === item.path && navDragItem !== item.path }"
              :title="collapsed ? item.label : undefined"
              :draggable="isCustomizingNav"
              @dragstart="onNavDragStart(item.path)"
              @dragover="onNavDragOver(item.path)"
              @drop="onNavDrop(item.path)"
              @dragend="onNavDragEnd"
              @click="isCustomizingNav ? null : router.push(item.path)"
            >
              <el-icon><component :is="item.icon" /></el-icon>
              <span v-if="!collapsed" class="menu-label">{{ item.label }}</span>
              <span v-if="isCustomizingNav && !collapsed" class="drag-handle"><el-icon><Rank /></el-icon></span>
            </button>
          </template>
        </nav>

        <!-- 流光主题：AI 助手占位（侧边栏常驻，仅 flow 显示，折叠时隐藏）。
             AI 能力尚未上线：诚实占位，不假装在工作、无假加载态，保留流光视觉创意。 -->
        <div class="ai-panel">
          <div class="ai-head">
            <el-icon><MagicStick /></el-icon>
            <span>AI 助手</span>
            <span class="ai-badge">即将上线</span>
          </div>
          <div class="ai-sub">流光主题的视觉核心。AI 文件整理、检索与洞察能力尚在规划中，将在后续版本上线。</div>
          <div class="ai-core flow-core"></div>
        </div>

        <div class="aside-footer">
          <!-- 底部存储进度条（P7）：usageTotal/quota 同源，所有主题可见 -->
          <div class="aside-storage">
            <div class="storage-label">
              <span>已用 {{ fmtSize(usageTotal) }}</span>
              <span>{{ quota ? '配额 ' + fmtSize(quota) : '不限' }}</span>
            </div>
            <div class="storage-track">
              <div class="storage-fill" :style="{ width: (storagePct ?? 0) + '%' }"></div>
            </div>
          </div>
          <div class="user-chip">
            <div class="avatar">
              <img v-if="auth.user?.avatar" :src="auth.user.avatar" alt="avatar" />
              <span v-else>{{ (auth.user?.displayName || auth.user?.username || 'U').charAt(0) }}</span>
            </div>
            <div v-if="!collapsed" class="user-info">
              <p class="user-name">{{ auth.user?.displayName || auth.user?.username || '未登录' }}</p>
              <p class="user-role">@{{ auth.user?.username || 'user' }}</p>
            </div>
          </div>
        </div>
      </aside>

      <!-- 主体：顶栏 + 内容 -->
      <div class="body">
        <!-- 顶部导航栏（topnav 布局） -->
        <div v-if="layoutType === 'topnav'" class="topnav glass">
          <div class="topnav-logo">
            <el-icon :size="24"><Cloudy /></el-icon>
            <span class="topnav-name">{{ appName }}</span>
          </div>
          <nav class="topnav-menu">
            <button
              v-for="item in mainMenu"
              :key="item.path"
              class="topnav-item"
              :class="{ active: route.path === item.path }"
              @click="router.push(item.path)"
            >
              <el-icon><component :is="item.icon" /></el-icon>
              <span>{{ item.label }}</span>
            </button>
            <template v-if="isAdmin">
              <div class="topnav-sep"></div>
              <button
                v-for="item in adminMenu"
                :key="item.path"
                class="topnav-item"
                :class="{ active: route.path === item.path }"
                @click="router.push(item.path)"
              >
                <el-icon><component :is="item.icon" /></el-icon>
                <span>{{ item.label }}</span>
              </button>
            </template>
          </nav>
          <div class="topnav-user">
            <div class="theme-wrap">
              <button class="theme-btn glass-btn" :title="'当前主题：' + THEMES[theme]?.label + '，点击切换'" @click="showThemePicker = !showThemePicker">
                <span class="theme-dot">{{ THEMES[theme]?.icon }}</span>
              </button>
              <div v-if="showThemePicker" class="theme-picker glass">
                <button
                  v-for="t in themeOptions"
                  :key="t.key"
                  class="theme-opt"
                  :class="{ active: theme === t.key }"
                  @click="setTheme(t.key); showThemePicker = false"
                >
                  <span class="theme-dot">{{ t.icon }}</span>
                  <span class="theme-label">{{ t.label }}</span>
                  <span v-if="theme === t.key" class="tick">✓</span>
                </button>
              </div>
            </div>
            <div class="avatar-sm">
              <img v-if="auth.user?.avatar" :src="auth.user.avatar" alt="avatar" />
              <span v-else>{{ (auth.user?.displayName || auth.user?.username || 'U').charAt(0) }}</span>
            </div>
            <span class="topnav-username">{{ auth.user?.displayName || auth.user?.username || '未登录' }}</span>
            <button class="topnav-logout" @click="logout">退出</button>
          </div>
        </div>
        <header class="header glass" v-if="layoutType !== 'topnav'">
          <div class="header-left">
            <!-- 移动端（P8）：☰ 打开离屏抽屉 -->
            <button class="menu-open-btn glass-btn" aria-label="打开导航菜单" @click="openDrawer">
              <el-icon><Menu /></el-icon>
            </button>
            <div class="page-title">{{ pageTitle }}</div>
          </div>
          <div class="header-right">
            <div class="theme-wrap">
              <button class="theme-btn glass-btn" :title="'当前主题：' + THEMES[theme]?.label + '，点击切换'" @click="showThemePicker = !showThemePicker">
                <span class="theme-dot">{{ THEMES[theme]?.icon }}</span>
              </button>
              <div v-if="showThemePicker" class="theme-picker glass">
                <button
                  v-for="t in themeOptions"
                  :key="t.key"
                  class="theme-opt"
                  :class="{ active: theme === t.key }"
                  @click="setTheme(t.key); showThemePicker = false"
                >
                  <span class="theme-dot">{{ t.icon }}</span>
                  <span class="theme-label">{{ t.label }}</span>
                  <span v-if="theme === t.key" class="tick">✓</span>
                </button>
              </div>
            </div>
            <span class="user-name">{{ auth.user?.displayName || auth.user?.username || '未登录' }}</span>
            <button class="logout-btn glass-btn" @click="logout">退出登录</button>
          </div>
        </header>

        <!-- 更新提示横幅 -->
        <div v-if="showUpdateBanner && updateInfo" class="update-banner">
          <el-icon :size="22" class="update-icon"><Bell /></el-icon>
          <div class="update-info">
            <div class="update-title">
              发现新版本
              <span class="update-badge">v{{ updateInfo.latestVersion }}</span>
            </div>
            <span class="update-sub">当前版本 v{{ updateInfo.currentVersion }} · 点击"立即更新"刷新加载</span>
          </div>
          <div class="update-actions">
            <el-button size="small" link @click="viewUpdateDetails">查看详情</el-button>
            <el-button size="small" type="primary" @click="updateNow">立即更新</el-button>
            <el-button size="small" link @click="dismissUpdate">忽略</el-button>
          </div>
        </div>

        <main class="main">
          <!-- 流光主题：AI 洞察大卡（Bento 顶部，仅 flow 显示）。
               AI 能力尚未上线：诚实占位，去掉"正在建立索引…"的永久假加载态，不欺骗用户。 -->
          <div class="ai-insight">
            <div class="ai-title">
              <el-icon><DataAnalysis /></el-icon>
              <span>AI 洞察</span>
              <span class="ai-badge">即将上线</span>
            </div>
            <div class="ai-desc">此区域为 AI 文件洞察预留（整理常用内容、媒体库、聚合关键信息等）。该能力尚在规划中，当前未处理任何文件数据。</div>
            <div class="ai-core flow-core"></div>
          </div>
          <!-- keep-alive 缓存已访问页面：切页不销毁组件，返回时数据/滚动位置保留，消除骨架屏闪烁；
               transition 提供轻柔的页面切换动效（样式见 glass.css .page-fade-*） -->
          <router-view v-slot="{ Component }">
            <keep-alive>
              <transition name="page-fade" mode="out-in">
                <component :is="Component" />
              </transition>
            </keep-alive>
          </router-view>
        </main>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shell {
  height: 100vh;
  overflow: hidden;
}
.layout {
  --sidebar-width: 240px;
  height: 100%;
  display: flex;
  gap: 14px;
  padding: 14px;
}
.layout.layout-topnav {
  flex-direction: column;
  gap: 0;
  padding: 0;
}
.layout-topnav .body {
  height: 100%;
}

/* ---------- 顶部导航栏 ---------- */
.topnav {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-radius: 0;
  flex-shrink: 0;
}
.topnav-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text);
}
.topnav-name {
  font-size: 16px;
  font-weight: 600;
}
.topnav-menu {
  display: flex;
  align-items: center;
  gap: 4px;
}
.topnav-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}
.topnav-item:hover {
  background: var(--glass-bg-hover);
  color: var(--text);
}
.topnav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.topnav-sep {
  width: 1px;
  height: 24px;
  background: var(--glass-border);
  margin: 0 8px;
}
.topnav-user {
  display: flex;
  align-items: center;
  gap: 10px;
}
.avatar-sm {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
}
.avatar-sm img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.topnav-username {
  font-size: 14px;
  color: var(--text);
}
.topnav-logout {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--glass-border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
}
.topnav-logout:hover {
  background: var(--glass-bg-hover);
  color: var(--text);
}

/* ---------- 侧边栏 ---------- */
.aside {
  width: var(--sidebar-width);
  display: flex;
  flex-direction: column;
  border-radius: 22px;
  overflow: hidden;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  z-index: 20;
  pointer-events: auto;
}
.aside.collapsed {
  width: 78px;
}
.logo {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
}
.aside.collapsed .logo {
  justify-content: center;
  padding: 0 8px;
}
.logo-badge {
  width: 38px;
  height: 38px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: var(--accent);
  color: #fff;
  box-shadow: var(--shadow), inset 0 1px 0 rgba(255, 255, 255, 0.35);
  flex-shrink: 0;
}
.logo-text {
  min-width: 0;
  flex: 1;
}
.logo-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
}
.logo-sub {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 0;
}
.collapse-btn {
  width: 30px;
  height: 30px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.collapse-btn:hover {
  color: var(--text);
}
.collapse-btn .flip {
  transform: rotate(180deg);
}

.menu {
  flex: 1;
  overflow-y: auto;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.aside.collapsed .menu {
  padding: 6px 8px;
}
.menu-group {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 12px 12px 4px;
}
/* 折叠态：分组用细分隔线代替文字标签 */
.menu-group-line {
  height: 1px;
  margin: 8px 10px;
  background: var(--text-secondary);
  opacity: 0.18;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  border: none;
  background: transparent;
  text-align: left;
  width: 100%;
}
.aside.collapsed .menu-item {
  justify-content: center;
  padding: 10px 8px;
}
.menu-item:hover {
  background: var(--glass-bg-hover);
  color: var(--text);
}
.menu-item.active {
  background: var(--accent-soft);
  color: var(--text);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}
.menu-item .el-icon {
  font-size: 18px;
  flex-shrink: 0;
}
.menu-item.active .el-icon {
  color: var(--accent);
}

/* 导航菜单拖拽 */
.menu.customizing {
  cursor: grab;
}
.menu.customizing .menu-item {
  cursor: grab;
  transition: all 0.2s;
}
.menu.customizing .menu-item:active {
  cursor: grabbing;
}
.menu-item.dragging {
  opacity: 0.5;
  transform: scale(0.95);
}
.menu-item.drag-over {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.drag-handle {
  margin-left: auto;
  color: var(--text-secondary);
  font-size: 14px;
}
.nav-customize-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--accent-soft);
  border-radius: 8px;
}
.nav-customize-done {
  padding: 4px 10px;
  border-radius: 6px;
  border: none;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  font-size: 12px;
}
.nav-customize-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 20px);
  margin: 0 10px 8px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px dashed var(--glass-border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}
.nav-customize-btn:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.aside-footer {
  padding: 12px 10px;
  border-top: 1px solid var(--glass-border);
}
.user-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 14px;
}
.aside.collapsed .user-chip {
  justify-content: center;
  padding: 8px 6px;
}
.avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #818cf8, #d946ef);
  color: #fff;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
  overflow: hidden;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.user-info {
  min-width: 0;
}
.user-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-role {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 0;
}

/* ---------- 主体 ---------- */
.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header {
  height: 60px;
  border-radius: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  flex-shrink: 0;
  /* header 因 backdrop-filter 自成堆叠上下文；抬升 z-index 让主题下拉
     不被 .main 里更靠后的玻璃卡片盖住 */
  position: relative;
  z-index: 10;
}
.page-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
}
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.theme-wrap {
  position: relative;
}
.theme-btn {
  width: 38px;
  height: 38px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  color: var(--text);
}
.theme-picker {
  position: absolute;
  top: 48px;
  right: 0;
  width: 180px;
  border-radius: 16px;
  padding: 8px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 4px;
  /* 浮层使用实心背景，避免半透明玻璃底透出下方内容影响可读性 */
  background: var(--glass-bg-solid, var(--glass-bg));
}
.theme-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  border: none;
  background: transparent;
  text-align: left;
  transition: all 0.15s;
}
.theme-opt:hover {
  background: var(--glass-bg-hover);
  color: var(--text);
}
.theme-opt.active {
  background: var(--accent-soft);
  color: var(--text);
}
.theme-dot {
  font-size: 15px;
  width: 20px;
  text-align: center;
}
.theme-label {
  font-size: 13px;
}
.tick {
  margin-left: auto;
  color: var(--accent);
  font-size: 13px;
}
.user-name {
  font-size: 14px;
  color: var(--text-secondary);
}
.logout-btn {
  padding: 8px 14px;
  border-radius: 14px;
  font-size: 13px;
  color: var(--text-secondary);
}
.logout-btn:hover {
  color: var(--text);
}

.main {
  flex: 1;
  overflow: auto;
  padding: 4px;
}

/* 更新提示横幅 - 与周围玻璃风格一致 */
.update-banner {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 20px;
  border-radius: 14px;
  margin-bottom: 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(var(--glass-blur, 12px));
}
.update-icon {
  color: var(--accent);
  flex-shrink: 0;
}
.update-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.update-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
}
.update-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
}
.update-sub {
  font-size: 12px;
  color: var(--text-secondary);
}
.update-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* ---------- 更新详情弹窗：跟随全部 9 个主题 ----------
   ElMessageBox 会 teleport 到 body，但主题变量定义在 <html data-theme> 上，
   可正常继承。背景复用 --bg（页面背景）：各主题的 --text 本就设计为
   置于 --bg 之上，对比度与主界面一致，彻底避免白底浅色字不可读。 */
:global(.release-dialog.el-message-box) {
  /* 宽度锁定 560px：切勿再加 max-width:calc(100vw-48px)——那会把盒子撑成近乎全宽，
     内容左对齐在全宽盒子里，看起来"偏在一侧"。ElMessageBox 默认用
     text-align:center + ::after 做双向居中，560px 窄盒自然居中。 */
  --el-message-box-width: 560px;
  max-height: calc(100vh - 48px);
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-hover);
  /* 双保险：fixed + 双向 50% 位移强制屏幕居中（不依赖 overlay 内部结构），限高防溢出。 */
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  margin: 0;
}
/* 标题栏文字跟随主题 */
:global(.release-dialog .el-message-box__title) {
  color: var(--text);
  font-weight: 600;
}
/* 正文容器：限高 + 滚动，长更新说明不再溢出 */
:global(.release-dialog .el-message-box__message) {
  color: var(--text);
  text-align: left;
  max-height: 65vh;
  overflow-y: auto;
  overscroll-behavior: contain;
}
:global(.release-notes) {
  line-height: 1.75;
  font-size: 14px;
  color: var(--text);
  word-break: break-word;
}
:global(.release-notes h3) {
  font-size: 18px;
  font-weight: 600;
  margin: 16px 0 8px;
  color: var(--text);
}
:global(.release-notes h4) {
  font-size: 15px;
  font-weight: 500;
  margin: 12px 0 6px;
  color: var(--text);
}
:global(.release-notes strong) {
  color: var(--accent);
}

/* ---------- 侧栏底部存储条（P7）：所有主题可见 ---------- */
.aside-storage {
  padding: 10px 10px 0;
}
.storage-label {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
}
.storage-track {
  height: 6px;
  border-radius: 3px;
  background: var(--glass-bg);
  overflow: hidden;
}
.storage-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
  transition: width 0.3s ease;
}
.aside.collapsed .aside-storage .storage-label {
  display: none;
}

/* ---------- 移动端（<768px，P8）：侧栏 → 离屏抽屉 ---------- */
.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.menu-open-btn {
  display: none;
}
.drawer-mask {
  display: none;
}
@media (max-width: 767px) {
  .menu-open-btn {
    display: grid;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    place-items: center;
    color: var(--text);
    flex-shrink: 0;
  }
  .drawer-mask {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 90;
    background: rgba(0, 0, 0, 0.35);
  }
  .aside,
  .aside.collapsed {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 280px;
    z-index: 100;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    border-radius: 0 22px 22px 0;
  }
  .aside.drawer-open {
    transform: translateX(0);
  }
  .collapse-btn {
    display: none;
  }
}
</style>
