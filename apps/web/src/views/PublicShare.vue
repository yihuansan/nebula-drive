<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api, fmtSize, fmtTime } from '../api';

const route = useRoute();
const token = route.params.token as string;

const share = ref<any>(null);
const notFound = ref(false);
const password = ref('');
const ticket = ref('');
const extracting = ref(false);
const loading = ref(false);
const entries = ref<any[]>([]);
const curPath = ref('/');

const crumbs = ref<{ name: string; path: string }[]>([]);

function calcCrumbs() {
  const root = share.value?.path || '/';
  const out: { name: string; path: string }[] = [{ name: share.value?.name || '分享根目录', path: root }];
  if (curPath.value !== root) {
    const segs = curPath.value.split('/').filter(Boolean);
    let acc = root === '/' ? '' : root;
    for (const s of segs) {
      acc += '/' + s;
      out.push({ name: s, path: acc });
    }
  }
  crumbs.value = out;
}

async function loadShare() {
  try {
    const r = await api(`/s/${token}`);
    share.value = r.share;
    if (!r.share.hasPassword) await doExtract();
  } catch {
    notFound.value = true;
  }
}

async function doExtract() {
  extracting.value = true;
  try {
    const r = await api(`/s/${token}/extract`, {
      method: 'POST',
      body: JSON.stringify({ password: password.value }),
    });
    ticket.value = r.ticket;
    if (share.value?.isDir) {
      // 目录分享：从分享指向的目录开始浏览
      curPath.value = share.value.path;
      await loadFiles();
    }
    // 文件分享：直接显示文件卡片（无需列表）
  } catch (e: any) {
    ElMessage.error(e.message || '提取失败');
  } finally {
    extracting.value = false;
  }
}

async function loadFiles() {
  loading.value = true;
  try {
    const r = await api(`/s/${token}/files?ticket=${ticket.value}&path=${encodeURIComponent(curPath.value)}`);
    entries.value = r.entries;
    calcCrumbs();
  } catch (e: any) {
    ElMessage.error(e.message || '加载目录失败');
  } finally {
    loading.value = false;
  }
}

function openDir(e: any) {
  if (e.isDir) {
    curPath.value = e.path;
    loadFiles();
  }
}

/* 锚点跳转，浏览器原生流式下载（不经过 JS 缓冲，大文件也不会 Failed to fetch） */
function download(e: any) {
  const a = document.createElement('a');
  a.href = `/api/v1/s/${token}/download?ticket=${encodeURIComponent(ticket.value)}&path=${encodeURIComponent(e.path)}`;
  a.click();
}

/* ---------- 分享转存 ---------- */
const transferDialog = ref(false);
const transferPaths = ref<string[]>([]);
const transferDest = ref('/');
const transferBusy = ref(false);
const transferResult = ref<any>(null);

function isLoggedIn() {
  return !!localStorage.getItem('nebula_token');
}

function openTransfer() {
  if (!isLoggedIn()) {
    ElMessage.info('请先登录后再转存');
    return;
  }
  transferPaths.value = entries.value.filter((e) => !e.isDir).map((e) => e.path);
  if (share.value && !share.value.isDir) {
    transferPaths.value = [share.value.path];
  }
  transferDialog.value = true;
  transferResult.value = null;
}

async function doTransfer() {
  if (!transferPaths.value.length) return;
  transferBusy.value = true;
  try {
    const token2 = localStorage.getItem('nebula_token') || '';
    const res = await fetch(`/api/v1/s/${token}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token2}` },
      body: JSON.stringify({ ticket: ticket.value, paths: transferPaths.value, destPath: transferDest.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '转存失败');
    transferResult.value = data.data;
    ElMessage.success(`已转存 ${data.data.transferred.length} 个文件`);
  } catch (e: any) {
    ElMessage.error(e.message || '转存失败');
  } finally {
    transferBusy.value = false;
  }
}

onMounted(loadShare);
</script>

<template>
  <div class="share-page">
    <div class="share-card" v-loading="!share && !notFound">
      <!-- 失效 -->
      <div v-if="notFound" class="empty-hero">
        <div class="empty-icon">
          <el-icon :size="38"><WarningFilled /></el-icon>
        </div>
        <div class="empty-title">分享不存在或已失效</div>
        <div class="empty-sub">链接可能已被删除、过期，或对应的文件已被移除</div>
      </div>

      <template v-else-if="share">
        <!-- 头部：图标徽章 + 名称 + 信息胶囊 -->
        <div class="hero">
          <div class="hero-badge">
            <el-icon :size="34">
              <Lock v-if="share.hasPassword && !ticket" />
              <FolderOpened v-else-if="share.isDir" />
              <Document v-else />
            </el-icon>
          </div>
          <div class="hero-info">
            <div class="hero-name">{{ share.name }}</div>
            <div class="hero-chips">
              <span class="chip">
                <el-icon><Clock /></el-icon>
                {{ share.expiresAt ? '有效期至 ' + fmtTime(share.expiresAt) : '长期有效' }}
              </span>
              <span v-if="share.maxDownloads" class="chip">
                <el-icon><Odometer /></el-icon>
                最多 {{ share.maxDownloads }} 次
              </span>
              <span class="chip">
                <el-icon><Download /></el-icon>
                已下载 {{ share.downloadCount || 0 }} 次
              </span>
              <el-button v-if="isLoggedIn()" class="transfer-btn" size="small" @click="openTransfer">
                <el-icon><Box /></el-icon>&nbsp;转存到网盘
              </el-button>
            </div>
          </div>
        </div>

        <!-- 密码门 -->
        <div v-if="share.hasPassword && !ticket" class="pwd-panel">
          <div class="pwd-lock">
            <el-icon :size="26"><Lock /></el-icon>
          </div>
          <div class="pwd-title">该分享受提取码保护</div>
          <div class="pwd-sub">请输入提取码以查看内容</div>
          <div class="pwd-row">
            <el-input v-model="password" class="pwd-input" placeholder="请输入提取码" @keyup.enter="doExtract" />
            <el-button class="pwd-btn" :loading="extracting" @click="doExtract">解 锁</el-button>
          </div>
        </div>

        <template v-else>
          <!-- 目录分享：卡片式浏览 -->
          <template v-if="share.isDir">
            <div class="crumb-bar">
              <el-breadcrumb separator="/">
                <el-breadcrumb-item v-for="c in crumbs" :key="c.path">
                  <a class="crumb" @click="curPath = c.path; loadFiles()">{{ c.name }}</a>
                </el-breadcrumb-item>
              </el-breadcrumb>
              <el-button class="refresh-btn" :loading="loading" @click="loadFiles">
                <el-icon><Refresh /></el-icon>
              </el-button>
            </div>
            <div v-loading="loading" class="file-grid">
              <div
                v-for="row in entries"
                :key="row.path"
                class="file-card glass-card"
                @click="openDir(row)"
              >
                <div class="fc-icon">
                  <el-icon :size="40" :color="row.isDir ? 'var(--accent)' : '#94a3b8'">
                    <Folder v-if="row.isDir" />
                    <Document v-else />
                  </el-icon>
                </div>
                <div class="fc-name" :title="row.name">{{ row.name }}</div>
                <div class="fc-meta">{{ row.isDir ? '文件夹' : fmtSize(row.size) }}</div>
                <div class="fc-actions" @click.stop>
                  <el-tooltip v-if="!row.isDir" content="下载" placement="top" :show-after="300">
                    <el-button link @click="download(row)"><el-icon><Download /></el-icon></el-button>
                  </el-tooltip>
                </div>
              </div>
              <div v-if="!loading && !entries.length" class="grid-empty">
                <el-icon :size="36"><FolderOpened /></el-icon>
                <h3>此文件夹为空</h3>
                <p>该文件夹下暂无文件</p>
              </div>
            </div>
          </template>

          <!-- 文件分享：大卡片直接下载 -->
          <div v-else class="file-share-card">
            <div class="fs-badge">
              <el-icon :size="44"><Document /></el-icon>
            </div>
            <div class="fs-name">{{ share.name }}</div>
            <div class="fs-meta">{{ fmtSize(share.size || 0) }}</div>
            <el-button class="fs-download" @click="download({ name: share?.name, path: share?.path })">
              <el-icon><Download /></el-icon>&nbsp;下载文件
            </el-button>
          </div>
        </template>
      </template>
    </div>

    <!-- 转存对话框 -->
    <el-dialog v-model="transferDialog" title="转存到网盘" width="480px">
      <div class="form-tip">将分享中的文件保存到您的网盘</div>
      <div class="transfer-files">
        <div class="form-tip">目标目录：</div>
        <el-input v-model="transferDest" placeholder="/" style="margin-bottom: 12px" />
        <div class="form-tip">将转存 {{ transferPaths.length }} 个文件：</div>
        <div class="transfer-list">
          <div v-for="p in transferPaths" :key="p" class="transfer-item">{{ p }}</div>
        </div>
      </div>
      <div v-if="transferResult" class="transfer-result">
        <div v-if="transferResult.transferred.length" class="form-tip success">
          成功转存 {{ transferResult.transferred.length }} 个文件到 {{ transferResult.destPath }}
        </div>
        <div v-if="transferResult.errors.length" class="form-tip error">
          <div v-for="err in transferResult.errors" :key="err">{{ err }}</div>
        </div>
      </div>
      <template #footer>
        <el-button @click="transferDialog = false">关闭</el-button>
        <el-button type="primary" :loading="transferBusy" :disabled="!transferPaths.length" @click="doTransfer">
          开始转存
        </el-button>
      </template>
    </el-dialog>

    <div class="share-footer">Powered by 玻璃网盘</div>
  </div>
</template>

<style scoped>
.share-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  background: var(--bg);
  padding: 48px 16px 24px;
  position: relative;
}
.share-page::before,
.share-page::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  filter: blur(120px);
  opacity: 0.4;
}
.share-page::before {
  top: -120px;
  right: -80px;
  width: 420px;
  height: 420px;
  background: var(--accent);
}
.share-page::after {
  bottom: -120px;
  left: -80px;
  width: 420px;
  height: 420px;
  background: color-mix(in srgb, var(--accent) 50%, #ffffff);
  opacity: 0.3;
}
.share-card {
  width: 100%;
  max-width: 860px;
  background: var(--glass-bg);
  backdrop-filter: blur(var(--blur)) saturate(170%);
  -webkit-backdrop-filter: blur(var(--blur)) saturate(170%);
  border: 1px solid var(--glass-border);
  border-radius: 22px;
  padding: 28px;
  box-shadow: var(--shadow), inset 0 1px 0 var(--glass-highlight);
  color: var(--text);
  position: relative;
  z-index: 1;
  animation: rise 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ---------- 头部 ---------- */
.hero {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 22px;
}
.hero-badge {
  width: 76px;
  height: 76px;
  border-radius: 22px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  color: var(--accent);
  background: linear-gradient(
    135deg,
    var(--accent-soft),
    color-mix(in srgb, var(--accent) 30%, transparent)
  );
  border: 1px solid var(--glass-border);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}
.hero-name {
  font-size: 22px;
  font-weight: 700;
  word-break: break-all;
}
.hero-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--surface);
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  padding: 4px 11px;
}
.chip .el-icon {
  color: var(--accent);
}

/* ---------- 密码门 ---------- */
.pwd-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 44px 0 30px;
  gap: 8px;
}
.pwd-lock {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  margin-bottom: 6px;
  background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #ffffff));
  box-shadow: var(--shadow);
}
.pwd-title {
  font-size: 17px;
  font-weight: 600;
}
.pwd-sub {
  font-size: 13px;
  color: var(--text-secondary);
}
.pwd-row {
  display: flex;
  gap: 10px;
  margin-top: 18px;
  width: 100%;
  max-width: 420px;
}
.pwd-input {
  flex: 1;
}
.pwd-btn {
  background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #ffffff));
  border: none;
  color: #fff;
  font-weight: 600;
  padding: 0 26px;
}
.pwd-btn:hover {
  filter: brightness(1.08);
}

/* ---------- 面包屑工具条 ---------- */
.crumb-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  background: var(--surface);
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  padding: 10px 16px;
  margin-bottom: 16px;
}
.crumb {
  color: var(--accent);
  cursor: pointer;
  font-size: 14px;
}
.crumb:hover {
  text-decoration: underline;
}
.refresh-btn {
  flex-shrink: 0;
}

/* ---------- 文件网格 ---------- */
.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 14px;
}
.file-card {
  border-radius: 18px;
  padding: 18px 14px;
  cursor: pointer;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.fc-icon {
  height: 52px;
  display: grid;
  place-items: center;
}
.fc-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fc-meta {
  font-size: 12px;
  color: var(--text-secondary);
}
.fc-actions {
  display: flex;
  justify-content: center;
  margin-top: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}
.file-card:hover .fc-actions {
  opacity: 1;
}
.grid-empty {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--text-secondary);
}
.grid-empty .el-icon { opacity: 0.5; }
.grid-empty h3 { margin: 0; font-size: 16px; font-weight: 600; color: var(--text); }
.grid-empty p { margin: 0; font-size: 13px; }

/* ---------- 文件分享卡 ---------- */
.file-share-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 44px 0 36px;
  gap: 10px;
}
.fs-badge {
  width: 96px;
  height: 96px;
  border-radius: 28px;
  display: grid;
  place-items: center;
  color: var(--accent);
  background: linear-gradient(
    135deg,
    var(--accent-soft),
    color-mix(in srgb, var(--accent) 26%, transparent)
  );
  border: 1px solid var(--glass-border);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}
.fs-name {
  font-size: 19px;
  font-weight: 700;
  word-break: break-all;
  text-align: center;
}
.fs-meta {
  font-size: 13px;
  color: var(--text-secondary);
}
.fs-download {
  margin-top: 14px;
  height: 46px;
  padding: 0 36px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #ffffff));
  border: none;
  color: #fff;
}
.fs-download:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

/* ---------- 失效 ---------- */
.empty-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 64px 0;
  gap: 6px;
}
.empty-icon {
  width: 84px;
  height: 84px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #e0a13f;
  background: var(--surface);
  border: 1px solid var(--glass-border);
  margin-bottom: 10px;
}
.empty-title {
  font-size: 18px;
  font-weight: 600;
}
.empty-sub {
  font-size: 13px;
  color: var(--text-secondary);
}

/* ---------- 页脚 ---------- */
.share-footer {
  margin-top: 18px;
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0.7;
  position: relative;
  z-index: 1;
  align-self: center;
}

/* ---------- 转存 ---------- */
.transfer-btn {
  margin-left: 8px;
}
.transfer-files {
  padding: 8px 0;
}
.transfer-list {
  max-height: 200px;
  overflow: auto;
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  padding: 8px 12px;
  margin-bottom: 12px;
}
.transfer-item {
  font-size: 13px;
  color: var(--text);
  padding: 4px 0;
  border-bottom: 1px solid var(--glass-border);
}
.transfer-item:last-child {
  border-bottom: none;
}
.transfer-result {
  margin-top: 12px;
}
.form-tip.success {
  color: #16a34a;
}
.form-tip.error {
  color: #dc2626;
}
</style>
