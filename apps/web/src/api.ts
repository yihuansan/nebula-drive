const BASE = '/api/v1';

export async function api<T = any>(path: string, init: RequestInit & { raw?: boolean } = {}): Promise<T> {
  const token = localStorage.getItem('nebula_token');
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // 仅当 body 为对象时序列化为 JSON 字符串
  if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData)) {
    init.body = JSON.stringify(init.body);
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  }
  // 仅当 body 为字符串且未显式指定 Content-Type 时补 JSON 头
  if (typeof init.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(BASE + path, { ...init, headers });
  // 401 处理：仅在非登录页且非公开端点时重定向
  if (res.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/register') && !path.includes('/settings')) {
    localStorage.removeItem('nebula_token');
    // 避免在 /login 页面重复重定向
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    throw new Error('未登录');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `请求失败 (${res.status})`) as Error & { data?: any };
    err.data = data;
    throw err;
  }
  return data.data as T;
}

/**
 * P2-4 修复：下载文件时使用 Authorization 头 + blob，避免 token 进入 query string
 * 浏览器历史/代理日志泄露
 */
export async function downloadFile(path: string, params: Record<string, string> = {}, filename?: string): Promise<void> {
  const q = new URLSearchParams(params);
  const token = localStorage.getItem('nebula_token') || '';
  const res = await fetch(`${BASE}${path}?${q.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `下载失败 (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || path.split('/').pop() || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function fmtSize(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export function fmtTime(t: string | number | null): string {
  if (!t) return '-';
  const d = typeof t === 'number' ? new Date(t) : new Date(String(t).replace(' ', 'T') + (String(t).includes('Z') ? '' : 'Z'));
  if (isNaN(d.getTime())) return String(t);
  return d.toLocaleString('zh-CN', { hour12: false });
}

/* ---------- 缩略图（带 Authorization 拉取 → blob URL，内存缓存） ---------- */
const thumbCache = new Map<string, string | null>();
const THUMB_CACHE_MAX = 300;

/** 获取图片缩略图的 blob URL；失败返回 null（调用方回退图标）。仅本地存储支持。 */
export async function thumbnailUrl(storageId: number, path: string, size = 320): Promise<string | null> {
  const key = `${storageId}:${path}:${size}`;
  if (thumbCache.has(key)) return thumbCache.get(key)!;
  const token = localStorage.getItem('nebula_token') || '';
  try {
    const res = await fetch(
      `${BASE}/files/thumbnail?storageId=${storageId}&path=${encodeURIComponent(path)}&size=${size}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error('thumb failed');
    const url = URL.createObjectURL(await res.blob());
    if (thumbCache.size >= THUMB_CACHE_MAX) {
      const first = thumbCache.keys().next().value;
      if (first !== undefined) {
        const old = thumbCache.get(first);
        if (old) URL.revokeObjectURL(old);
        thumbCache.delete(first);
      }
    }
    thumbCache.set(key, url);
    return url;
  } catch {
    thumbCache.set(key, null);
    return null;
  }
}

/* ---------- 批量缩略图助手（各列表页共用） ---------- */
const THUMB_IMG_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'jfif']);

/**
 * 批量加载缩略图：仅图片扩展名、每批 10 个并发，成功一张即回调一张（增量刷新）。
 * 返回 abort 函数：切换存储/卸载时调用，中止后续批次。
 */
export function loadThumbs(
  items: { storageId: number; path: string }[],
  onThumb: (path: string, url: string) => void,
  size = 320,
  limit = 120
): () => void {
  let aborted = false;
  const targets = items
    .filter((it) => THUMB_IMG_EXTS.has((it.path.split('.').pop() || '').toLowerCase()))
    .slice(0, limit);
  (async () => {
    for (let i = 0; i < targets.length; i += 10) {
      if (aborted) return;
      const batch = targets.slice(i, i + 10);
      const urls = await Promise.all(batch.map((it) => thumbnailUrl(it.storageId, it.path, size)));
      if (aborted) return;
      batch.forEach((it, j) => {
        const u = urls[j];
        if (u) onThumb(it.path, u);
      });
    }
  })();
  return () => {
    aborted = true;
  };
}
