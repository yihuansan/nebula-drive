<template>
  <view class="page">
    <view class="list">
      <view v-if="loading" class="muted center">加载中…</view>
      <view v-else-if="shares.length === 0" class="muted center">暂无分享</view>
      <view v-for="s in shares" :key="s.id" class="card">
        <view class="row">
          <view class="share-name">{{ s.name || s.path }}</view>
          <view class="tag" :class="{ disabled: !s.enabled }">
            {{ s.enabled ? '有效' : '禁用' }}
          </view>
        </view>
        <view class="muted">路径：{{ s.path }}</view>
        <view class="muted" v-if="s.expiresAt">到期：{{ s.expiresAt }}</view>
        <view class="muted" v-if="s.password">有提取密码</view>
        <view class="actions">
          <view class="mini-btn" @click="copyUrl(s)">复制链接</view>
          <view class="mini-btn danger" @click="onDelete(s)">删除</view>
        </view>
      </view>
    </view>
    <view class="error" v-if="err">{{ err }}</view>
  </view>
</template>

<script lang="ts">
import { listShares, removeShare } from '@/api';

export default {
  data() {
    return {
      shares: [] as any[],
      loading: false,
      err: '',
    };
  },
  onShow() {
    this.load();
  },
  methods: {
    async load() {
      this.loading = true;
      this.err = '';
      try {
        const res = await listShares();
        this.shares = res.shares || [];
      } catch (e: any) {
        this.err = e.message;
      } finally {
        this.loading = false;
      }
    },
    copyUrl(s: any) {
      const base = (uni.getStorageSync('nebula_base') || '').replace(/\/+$/, '');
      const url = `${base}/api/v1/s/${s.token}`;
      uni.setClipboard({
        data: url,
        success: () => uni.showToast({ title: '链接已复制', icon: 'success' }),
      });
    },
    onDelete(s: any) {
      uni.showModal({
        title: '删除分享',
        content: `删除分享 ${s.name || s.path}？`,
        success: (res) => {
          if (!res.confirm) return;
          removeShare(s.id)
            .then(() => {
              uni.showToast({ title: '已删除', icon: 'success' });
              this.load();
            })
            .catch((e) => uni.showToast({ title: e.message, icon: 'none' }));
        },
      });
    },
  },
};
</script>

<style scoped>
.list {
  padding: 12px;
}
.share-name {
  font-size: 15px;
  font-weight: 500;
}
.tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: #e1f0ff;
  color: #3b82f6;
}
.tag.disabled {
  background: #f0f0f0;
  color: #909399;
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
.mini-btn {
  flex: 1;
  text-align: center;
  padding: 8px;
  border-radius: 8px;
  background: #3b82f6;
  color: #fff;
  font-size: 13px;
}
.mini-btn.danger {
  background: #f56c6c;
}
.center {
  text-align: center;
  padding: 30px;
}
</style>
