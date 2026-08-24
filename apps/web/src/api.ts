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
