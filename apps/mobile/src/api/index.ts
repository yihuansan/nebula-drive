// NebulaDrive 移动端 API 封装
// 服务器响应约定：成功 { data: T }，失败 { error: string }（HTTP 非 2xx）

export function base(): string {
  return uni.getStorageSync('nebula_base') || 'http://127.0.0.1:8080';
}

export function token(): string {
  return uni.getStorageSync('nebula_token') || '';
}

export function isLoggedIn(): boolean {
  return !!token();
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: any;
  header?: Record<string, string>;
  noAuth?: boolean;
};

export function req(path: string, options: Options = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const header: Record<string, string> = { ...(options.header || {}) };
    if (!options.noAuth) {
      header['Authorization'] = 'Bearer ' + token();
    }
    uni.request({
      url: base() + '/api/v1' + path,
      method: options.method || 'GET',
      header,
      data: options.data,
      success: (res: any) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data && res.data.data !== undefined ? res.data.data : res.data);
        } else {
          if (res.statusCode === 401) {
            uni.removeStorageSync('nebula_token');
            uni.removeStorageSync('nebula_user');
            uni.reLaunch({ url: '/pages/login/login' });
          }
          const msg = (res.data && res.data.error) || 'HTTP ' + res.statusCode;
          reject(new Error(msg));
        }
      },
      fail: (err: any) => reject(new Error(err.errMsg || '网络请求失败')),
    });
  });
}

// ===== 认证 =====
export function login(username: string, password: string) {
  return req('/auth/login', {
    method: 'POST',
    data: { username, password },
    noAuth: true,
  });
}

export function me() {
  return req('/auth/me');
}

// ===== 存储 =====
export function listStorages() {
  return req('/storages');
}

// ===== 文件 =====
export function listFiles(storageId: number, path: string, sort = 'name', order = 'asc') {
  return req(`/files?storageId=${storageId}&path=${encodeURIComponent(path)}&sort=${sort}&order=${order}`);
}

export function mkdir(storageId: number, path: string) {
  return req('/files/mkdir', { method: 'POST', data: { storageId, path } });
}

export function renameFile(storageId: number, path: string, newPath: string) {
  return req('/files/rename', { method: 'POST', data: { storageId, path, newPath } });
}

export function moveFile(storageId: number, path: string, destPath: string) {
  return req('/files/move', { method: 'POST', data: { storageId, path, destPath } });
}

export function deleteFile(storageId: number, path: string) {
  return req('/files/delete', { method: 'POST', data: { storageId, path } });
}

export function searchFiles(q: string, storageId?: number) {
  const sid = storageId ? `&storageId=${storageId}` : '';
  return req(`/search?q=${encodeURIComponent(q)}${sid}`);
}

// ===== 分享 =====
export function listShares() {
  return req('/shares');
}

export function createShare(payload: {
  storageId: number;
  path: string;
  name?: string;
  password?: string;
  expiresAt?: string;
  maxDownloads?: number;
}) {
  return req('/shares', { method: 'POST', data: payload });
}

export function removeShare(id: number) {
  return req(`/shares/${id}`, { method: 'DELETE' });
}

// ===== 公开分享（无需登录）=====
export function publicInfo(token: string) {
  return req(`/s/${token}`, { noAuth: true });
}

export function publicExtract(token: string, password: string) {
  return req(`/s/${token}/extract`, {
    method: 'POST',
    data: { password },
    noAuth: true,
  });
}

export function publicList(token: string, path: string, ticket: string) {
  return req(`/s/${token}/files?path=${encodeURIComponent(path)}&ticket=${encodeURIComponent(ticket)}`, {
    noAuth: true,
  });
}

// ===== 下载 =====
// 返回完整下载地址（用于 uni.downloadFile / 浏览器下载）
export function downloadUrl(storageId: number, path: string): string {
  return `${base()}/api/v1/files/download?storageId=${storageId}&path=${encodeURIComponent(path)}`;
}

export function publicDownloadUrl(token: string, path: string, ticket: string): string {
  return `${base()}/api/v1/s/${token}/download?path=${encodeURIComponent(path)}&ticket=${encodeURIComponent(ticket)}`;
}
