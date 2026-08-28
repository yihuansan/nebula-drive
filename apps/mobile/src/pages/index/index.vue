<template>
  <view class="page">
    <!-- 顶部：存储选择 + 路径 -->
    <view class="topbar">
      <picker @change="onStorageChange" :value="storageIndex">
        <view class="storage-btn">{{ storageName }} ▾</view>
      </picker>
      <view class="path" v-if="currentPath !== '/'" @click="goUp">
        返回上一级 ↑
      </view>
    </view>

    <!-- 面包屑路径 -->
    <view class="breadcrumb">
      <text class="crumb" @click="goTo('/')">/</text>
      <text
        v-for="(seg, i) in pathSegs"
        :key="i"
        class="crumb"
        @click="goToSeg(i)"
        >/{{ seg }}</text
      >
    </view>

    <!-- 文件列表 -->
    <view class="list">
      <view v-if="loading" class="muted center">加载中…</view>
      <view v-else-if="entries.length === 0" class="muted center">空目录</view>
      <view
        v-for="e in entries"
        :key="e.path"
        class="file-row"
        @click="onTap(e)"
        @longpress="onLongPress(e)"
      >
        <view class="icon">{{ e.isDir ? '📁' : iconFor(e.name) }}</view>
        <view class="file-info">
          <view class="file-name">{{ e.name }}</view>
          <view class="muted">
            {{ e.isDir ? '目录' : fmtSize(e.size) }} · {{ fmtTime(e.mtime) }}
          </view>
        </view>
        <view class="file-action" @click.stop="onAction(e)">⋯</view>
      </view>
    </view>

    <!-- 新建目录按钮 -->
    <view class="fab" @click="onMkdir">＋ 新建目录</view>

    <!-- 底部导航 -->
    <view class="tabbar">
      <view class="tab active">文件</view>
      <view class="tab" @click="goShare">分享</view>
      <view class="tab" @click="goSettings">我的</view>
    </view>

    <view class="error" v-if="err">{{ err }}</view>
  </view>
</template>

<script lang="ts">
import {
  isLoggedIn,
  listStorages,
  listFiles,
  mkdir,
  renameFile,
  deleteFile,
  createShare,
  downloadUrl,
} from '@/api';

export default {
  data() {
    return {
      storages: [] as any[],
      storageIndex: 0,
      currentPath: '/',
      entries: [] as any[],
      loading: false,
      err: '',
    };
  },
  computed: {
    storageName() {
      const s = this.storages[this.storageIndex];
      return s ? s.name : '存储';
    },
    pathSegs() {
      return this.currentPath.split('/').filter((s) => s !== '');
    },
  },
  onShow() {
    if (!isLoggedIn()) {
      uni.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.init();
  },
  methods: {
    async init() {
      try {
        const res = await listStorages();
        this.storages = res.storages || res || [];
        // 恢复上次选择的存储
        const saved = Number(uni.getStorageSync('nebula_storage'));
        if (this.storages.some((s) => s.id === saved)) {
          this.storageIndex = this.storages.findIndex((s) => s.id === saved);
        }
        await this.refresh();
      } catch (e: any) {
        this.err = e.message;
      }
    },
    async refresh() {
      this.loading = true;
      this.err = '';
      try {
        const s = this.storages[this.storageIndex];
        const res = await listFiles(s.id, this.currentPath);
        this.entries = res.entries || [];
      } catch (e: any) {
        this.err = e.message;
      } finally {
        this.loading = false;
      }
    },
    onStorageChange(e: any) {
      this.storageIndex = Number(e.detail.value);
      uni.setStorageSync('nebula_storage', this.storages[this.storageIndex].id);
      this.currentPath = '/';
      this.refresh();
    },
    goUp() {
      const segs = this.currentPath.split('/').filter((s) => s !== '');
      segs.pop();
      this.currentPath = '/' + segs.join('/') + (segs.length ? '/' : '');
      this.refresh();
    },
    goTo(path: string) {
      this.currentPath = path;
      this.refresh();
    },
    goToSeg(i: number) {
      const segs = this.pathSegs.slice(0, i + 1);
      this.currentPath = '/' + segs.join('/') + '/';
      this.refresh();
    },
    onTap(e: any) {
      if (e.isDir) {
        this.currentPath = e.path.endsWith('/') ? e.path : e.path + '/';
        this.refresh();
      } else {
        this.onAction(e);
      }
    },
    onAction(e: any) {
      const items = e.isDir ? ['进入', '重命名', '删除'] : ['下载', '分享', '重命名', '删除'];
      uni.showActionSheet({
        itemList: items,
        success: (res) => {
          const idx = res.tapIndex;
          if (e.isDir) {
            if (idx === 0) this.onTap(e);
            else if (idx === 1) this.onRename(e);
            else if (idx === 2) this.onDelete(e);
          } else {
            if (idx === 0) this.onDownload(e);
            else if (idx === 1) this.onShare(e);
            else if (idx === 2) this.onRename(e);
            else if (idx === 3) this.onDelete(e);
          }
        },
      });
    },
    onLongPress(e: any) {
      this.onAction(e);
    },
    onDownload(e: any) {
      const s = this.storages?.[this.storageIndex];
      if (!s) {
        uni.showToast({ title: '请先初始化存储', icon: 'none' });
        return;
      }
      const url = downloadUrl(s.id, e.path);
      uni.showLoading({ title: '准备下载' });
      uni.downloadFile({
        url,
        header: { Authorization: 'Bearer ' + uni.getStorageSync('nebula_token') },
        success: (r) => {
          uni.hideLoading();
          uni.saveFile({
            filePath: r.tempFilePath,
            success: () => uni.showToast({ title: '已保存', icon: 'success' }),
            fail: () => uni.showToast({ title: '保存失败', icon: 'none' }),
          });
        },
        fail: (err) => {
          uni.hideLoading();
          uni.showToast({ title: err.errMsg || '下载失败', icon: 'none' });
        },
      });
    },
    onShare(e: any) {
      const s = this.storages?.[this.storageIndex];
      if (!s) {
        uni.showToast({ title: '请先初始化存储', icon: 'none' });
        return;
      }
      uni.showModal({
        title: '创建分享',
        content: `为 ${e.name} 创建分享链接？`,
        success: (res) => {
          if (!res.confirm) return;
          createShare({ storageId: s.id, path: e.path, name: e.name })
            .then((r) => {
              uni.setClipboard({
                data: r.url,
                success: () => uni.showToast({ title: '分享链接已复制', icon: 'success' }),
              });
            })
            .catch((err) => uni.showToast({ title: err.message, icon: 'none' }));
        },
      });
    },
    onRename(e: any) {
      const s = this.storages?.[this.storageIndex];
      if (!s) {
        uni.showToast({ title: '请先初始化存储', icon: 'none' });
        return;
      }
      uni.showModal({
        title: '重命名',
        placeholder: '新名称',
        content: e.name,
        editable: true,
        success: (res) => {
          if (!res.confirm || !res.content) return;
          const parent = e.path.replace(/\/[^/]+$/, '');
          const newPath = (parent ? parent : '/') + '/' + res.content;
          renameFile(s.id, e.path, newPath)
            .then(() => this.refresh())
            .catch((err) => uni.showToast({ title: err.message, icon: 'none' }));
        },
      });
    },
    onDelete(e: any) {
      const s = this.storages?.[this.storageIndex];
      if (!s) {
        uni.showToast({ title: '请先初始化存储', icon: 'none' });
        return;
      }
      uni.showModal({
        title: '确认删除',
        content: `删除 ${e.name}？`,
        success: (res) => {
          if (!res.confirm) return;
          deleteFile(s.id, e.path)
            .then(() => this.refresh())
            .catch((err) => uni.showToast({ title: err.message, icon: 'none' }));
        },
      });
    },
    onMkdir() {
      const s = this.storages?.[this.storageIndex];
      if (!s) {
        uni.showToast({ title: '请先初始化存储', icon: 'none' });
        return;
      }
      uni.showModal({
        title: '新建目录',
        placeholder: '目录名',
        content: '',
        editable: true,
        success: (res) => {
          if (!res.confirm || !res.content) return;
          const base = this.currentPath.endsWith('/') ? this.currentPath : this.currentPath + '/';
          mkdir(s.id, base + res.content)
            .then(() => this.refresh())
            .catch((err) => uni.showToast({ title: err.message, icon: 'none' }));
        },
      });
    },
    goShare() {
      uni.navigateTo({ url: '/pages/share/share' });
    },
    goSettings() {
      uni.navigateTo({ url: '/pages/settings/settings' });
    },
    iconFor(name: string) {
      const ext = name.split('.').pop()?.toLowerCase() || '';
      const map: Record<string, string> = {
        mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬',
        mp3: '🎵', wav: '🎵', flac: '🎵',
        jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️',
        pdf: '📕', doc: '📄', docx: '📄', xls: '📊', xlsx: '📊', ppt: '📽️',
        zip: '🗜️', rar: '🗜️', '7z': '🗜️',
      };
      return map[ext] || '📄';
    },
    fmtSize(n: number) {
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
      return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    },
    fmtTime(t: number) {
      if (!t) return '';
      return new Date(t).toLocaleDateString();
    },
  },
};
</script>

<style scoped>
.page {
  padding-bottom: 60px;
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
}
.storage-btn {
  background: #3b82f6;
  color: #fff;
  padding: 6px 12px;
  border-radius: 16px;
  font-size: 13px;
}
.path {
  color: #3b82f6;
  font-size: 13px;
}
.breadcrumb {
  padding: 0 12px 8px;
  font-size: 12px;
  color: #606266;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.crumb {
  margin-right: 4px;
}
.file-row {
  display: flex;
  align-items: center;
  background: #fff;
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 8px;
}
.icon {
  font-size: 28px;
  margin-right: 12px;
}
.file-info {
  flex: 1;
  overflow: hidden;
}
.file-name {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.file-action {
  color: #909399;
  font-size: 20px;
  padding: 0 8px;
}
.fab {
  position: fixed;
  right: 16px;
  bottom: 70px;
  background: #3b82f6;
  color: #fff;
  padding: 10px 16px;
  border-radius: 20px;
  font-size: 13px;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
  z-index: 10;
}
.tabbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  background: #fff;
  border-top: 1px solid #eee;
  height: 50px;
  z-index: 10;
}
.tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
  font-size: 13px;
}
.tab.active {
  color: #3b82f6;
}
.center {
  text-align: center;
  padding: 30px;
}
</style>
