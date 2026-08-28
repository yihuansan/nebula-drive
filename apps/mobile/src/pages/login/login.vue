<template>
  <view class="login-wrap">
    <view class="brand">
      <view class="logo">🌌</view>
      <view class="title">NebulaDrive</view>
      <view class="subtitle">星云网盘</view>
    </view>
    <view class="form">
      <input class="input" v-model="serverBase" placeholder="服务器地址，如 http://192.168.1.10:8080" />
      <input class="input" v-model="username" placeholder="用户名" />
      <input class="input" type="password" v-model="password" placeholder="密码" />
      <view class="btn-primary" @click="doLogin">登 录</view>
      <view class="error" v-if="err">{{ err }}</view>
    </view>
  </view>
</template>

<script lang="ts">
import { login } from '@/api';

export default {
  data() {
    return {
      serverBase: uni.getStorageSync('nebula_base') || 'http://127.0.0.1:8080',
      username: '',
      password: '',
      err: '',
    };
  },
  methods: {
    async doLogin() {
      this.err = '';
      if (!this.serverBase) return;
      uni.setStorageSync('nebula_base', this.serverBase.replace(/\/+$/, ''));
      try {
        const res = await login(this.username, this.password);
        uni.setStorageSync('nebula_token', res.token);
        uni.setStorageSync('nebula_user', res.user.username);
        uni.reLaunch({ url: '/pages/index/index' });
      } catch (e: any) {
        this.err = e.message || '登录失败';
      }
    },
  },
};
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 40px 24px;
  background: linear-gradient(160deg, #1e3a8a, #3b82f6);
}
.brand {
  text-align: center;
  margin-bottom: 40px;
  color: #fff;
}
.logo {
  font-size: 56px;
}
.title {
  font-size: 26px;
  font-weight: bold;
  margin-top: 8px;
}
.subtitle {
  font-size: 14px;
  opacity: 0.8;
}
.form {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
}
.hint {
  text-align: center;
  margin-top: 12px;
}
</style>
