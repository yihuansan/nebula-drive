import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/Login.vue') },
    { path: '/s/:token', name: 'share', component: () => import('./views/PublicShare.vue') },
    { path: '/', name: 'files', component: () => import('./views/Files.vue'), meta: { auth: true, perm: 'files:view' } },
    { path: '/dashboard', name: 'dashboard', component: () => import('./views/Dashboard.vue'), meta: { auth: true, perm: 'files:view' } },
    { path: '/recent', name: 'recent', component: () => import('./views/Recent.vue'), meta: { auth: true, perm: 'files:view' } },
    { path: '/quick-access', name: 'quick-access', component: () => import('./views/QuickAccess.vue'), meta: { auth: true, perm: 'files:view' } },
    { path: '/favorites', name: 'favorites', component: () => import('./views/Favorites.vue'), meta: { auth: true, perm: 'files:view' } },
    { path: '/media', name: 'media', component: () => import('./views/Media.vue'), meta: { auth: true, perm: 'files:view' } },
    { path: '/hidden', name: 'hidden', component: () => import('./views/HiddenSpace.vue'), meta: { auth: true, perm: 'files:view' } },
    { path: '/tags', name: 'tags', component: () => import('./views/Tags.vue'), meta: { auth: true, perm: 'files:view' } },
    { path: '/subscriptions', name: 'subscriptions', component: () => import('./views/Subscriptions.vue'), meta: { auth: true, perm: 'files:share' } },
    { path: '/shares', name: 'shares', component: () => import('./views/Shares.vue'), meta: { auth: true, perm: 'files:share' } },
    { path: '/share-collab', name: 'share-collab', component: () => import('./views/ShareCollab.vue'), meta: { auth: true, perm: 'files:share' } },
    { path: '/recycle', name: 'recycle', component: () => import('./views/Recycle.vue'), meta: { auth: true, perm: 'recycle:view' } },
    { path: '/admin/users', name: 'admin-users', component: () => import('./views/admin/Users.vue'), meta: { auth: true, perm: 'users:view' } },
    { path: '/admin/roles', name: 'admin-roles', component: () => import('./views/admin/Roles.vue'), meta: { auth: true, perm: 'users:manage' } },
    { path: '/admin/storages', name: 'admin-storages', component: () => import('./views/admin/Storages.vue'), meta: { auth: true, perm: 'storages:view' } },
    { path: '/admin/settings', name: 'admin-settings', component: () => import('./views/admin/Settings.vue'), meta: { auth: true, perm: 'settings:view' } },
    { path: '/admin/logs', name: 'admin-logs', component: () => import('./views/admin/Logs.vue'), meta: { auth: true, perm: 'logs:view' } },
    { path: '/admin/sync', name: 'admin-sync', component: () => import('./views/admin/Sync.vue'), meta: { auth: true, perm: 'sync:view' } },
    { path: '/admin/stats', name: 'admin-stats', component: () => import('./views/admin/Stats.vue'), meta: { auth: true, perm: 'stats:view' } },
    { path: '/profile', name: 'profile', component: () => import('./views/Profile.vue'), meta: { auth: true, perm: 'files:view' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach((to) => {
  const token = localStorage.getItem('nebula_token');
  if (to.meta?.auth && !token) return '/login';
  if (to.path === '/login' && token) return '/';

  // 权限守卫：目标路由声明了 perm 时，校验当前用户权限
  // （auth store 的 permissions 在 App.vue onMounted 后已就绪；
  //   若尚未就绪则放行，由 App.vue 的兜底跳转处理）
  if (to.meta?.auth && token) {
    const auth = useAuthStore();
    if (auth.user && to.meta?.perm) {
      const perms = auth.user.permissions;
      if (perms && !perms.includes(to.meta.perm as string)) {
        return '/';
      }
    }
  }
});
