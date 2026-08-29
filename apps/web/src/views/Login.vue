<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth';
import { api } from '../api';

const router = useRouter();
const auth = useAuthStore();
const username = ref('');
const password = ref('');
const loading = ref(false);

/* ---------- 验证码相关 ---------- */
const captchaRequired = ref(false);
const captchaId = ref('');
const captchaImage = ref('');
const captchaInput = ref('');
const captchaError = ref('');

async function loadCaptcha() {
  try {
    const r = await api('/auth/captcha');
    captchaId.value = r.id;
    captchaImage.value = r.image || '';
  } catch {
    /* 忽略 */
  }
}

/* ---------- 注册相关 ---------- */
const showRegister = ref(false);
const regUsername = ref('');
const regPassword = ref('');
const regDisplayName = ref('');
const regEmail = ref('');
const regLoading = ref(false);

async function doRegister() {
  if (!regUsername.value || !regPassword.value) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  if (regPassword.value.length < 8) {
    ElMessage.warning('密码至少 8 位');
    return;
  }
  regLoading.value = true;
  try {
    const r = await api('/auth/register', {
      method: 'POST',
      body: {
        username: regUsername.value.trim(),
        password: regPassword.value,
        displayName: regDisplayName.value.trim() || undefined,
        email: regEmail.value.trim() || undefined,
      },
    });
    // 若发送了欢迎邮件，给出提示
    if (r.emailSent) {
      ElMessage.success('注册成功，欢迎邮件已发送至 ' + regEmail.value.trim());
    } else {
      ElMessage.success('注册成功，正在登录...');
    }
    // 自动登录
    auth.token = r.token;
    auth.user = r.user;
    router.push('/dashboard');
  } catch (e: any) {
    ElMessage.error(e.message || '注册失败');
  } finally {
    regLoading.value = false;
  }
}

/* ---------- 公开设置（品牌展示） ---------- */
const brand = ref({
  appName: 'NebulaDrive 星云网盘',
  logo: '',
  aboutText: '',
  notice: '',
  copyright: '',
  contactEmail: '',
  registerEnabled: true,
});

async function loadBrand() {
  try {
    const s = await api('/settings');
    brand.value.appName = s.appName || 'NebulaDrive 星云网盘';
    brand.value.logo = s.logo || '';
    brand.value.aboutText = s.aboutText || '';
    brand.value.notice = s.notice || '';
    brand.value.copyright = s.copyright || '';
    brand.value.contactEmail = s.contactEmail || '';
    brand.value.registerEnabled = s.registerEnabled !== false;
  } catch (e) {
    console.error('加载品牌设置失败:', e);
    /* 使用默认品牌 */
  }
}
onMounted(loadBrand);

/* ---------- 左侧品牌展示区数据 ---------- */
const heroFeatures = [
  { icon: 'Box', text: '多存储统一管理', desc: '本地 / 网络存储聚合，一处浏览与管理' },
  { icon: 'Share', text: '一键分享协作', desc: '生成分享链接，支持密码保护与有效期控制' },
  { icon: 'Lock', text: '双重认证防护', desc: 'TOTP 动态码与恢复码，守护账号安全' },
];

/* ---------- 2FA 相关 ---------- */
const twoFaRequired = ref(false);
const twoFaTempToken = ref('');
const twoFaCode = ref('');
const twoFaError = ref('');

async function doLogin() {
  if (!username.value || !password.value) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  if (captchaRequired.value && !captchaInput.value) {
    ElMessage.warning('请输入验证码');
    return;
  }
  loading.value = true;
  captchaError.value = '';
  try {
    const r = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: username.value.trim(),
        password: password.value,
        captchaId: captchaRequired.value ? captchaId.value : undefined,
        captchaCode: captchaRequired.value ? captchaInput.value : undefined,
      }),
    });

    // 检查是否需要 2FA
    if (r.requiresTwoFactor) {
      twoFaRequired.value = true;
      twoFaTempToken.value = r.tempToken;
      showRegister.value = false;
      return;
    }

    auth.token = r.token;
    auth.user = r.user;
    localStorage.setItem('nebula_token', r.token);
    ElMessage.success('登录成功');
    router.push('/dashboard');
  } catch (e: any) {
    // 检查是否需要验证码
    const data = e.data || {};
    if (data.requireCaptcha) {
      captchaRequired.value = true;
      await loadCaptcha();
      captchaError.value = e.message || '需要验证码';
    } else {
      captchaError.value = e.message || '登录失败';
    }
  } finally {
    loading.value = false;
  }
}

async function doTwoFaLogin() {
  if (!twoFaCode.value) {
    ElMessage.warning('请输入 6 位验证码');
    return;
  }
  loading.value = true;
  twoFaError.value = '';
  try {
    const r = await api('/auth/login/2fa', {
      method: 'POST',
      body: JSON.stringify({
        tempToken: twoFaTempToken.value,
        code: twoFaCode.value,
      }),
    });
    auth.token = r.token;
    auth.user = r.user;
    localStorage.setItem('nebula_token', r.token);
    ElMessage.success('登录成功');
    router.push('/dashboard');
  } catch (e: any) {
    twoFaError.value = e.message || '2FA 验证失败';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-split">
      <!-- 左侧：品牌展示区（窄屏隐藏，回落为单栏卡片） -->
      <div class="login-hero">
        <div class="hero-logo">
          <img
            v-if="brand.logo"
            :src="brand.logo"
            alt="logo"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <el-icon v-else :size="34"><Cloudy /></el-icon>
        </div>
        <h1 class="hero-title">{{ brand.appName }}</h1>
        <p class="hero-sub">{{ brand.aboutText || '多存储统一管理平台' }}</p>
        <div class="hero-features">
          <div v-for="f in heroFeatures" :key="f.text" class="hero-feature">
            <span class="hf-icon"><el-icon :size="18"><component :is="f.icon" /></el-icon></span>
            <div>
              <div class="hf-title">{{ f.text }}</div>
              <div class="hf-desc">{{ f.desc }}</div>
            </div>
          </div>
        </div>
        <div v-if="brand.copyright" class="hero-copyright">{{ brand.copyright }}</div>
      </div>
      <div class="login-card">
      <div class="brand">
        <img v-if="brand.logo" :src="brand.logo" class="brand-logo" alt="logo" @error="($event.target as HTMLImageElement).style.display = 'none'" />
        <el-icon v-else :size="42" color="var(--accent)"><Cloudy /></el-icon>
        <div class="brand-name">{{ brand.appName }}</div>
        <div class="brand-sub">{{ brand.aboutText || '多存储统一管理平台' }}</div>
      </div>
      <!-- 2FA 验证步骤 -->
      <el-form v-if="twoFaRequired && !showRegister" label-position="top" @submit.prevent="doTwoFaLogin">
        <div class="twoFa-hint">
          <el-icon color="var(--accent)" :size="20"><Lock /></el-icon>
          <span>请输入 2FA 验证码</span>
        </div>
        <el-form-item label="验证码">
          <el-input
            v-model="twoFaCode"
            placeholder="6 位验证码或恢复码"
            maxlength="10"
            @keyup.enter="doTwoFaLogin"
          />
        </el-form-item>
        <div v-if="twoFaError" class="captcha-error">{{ twoFaError }}</div>
        <el-button type="primary" class="login-btn" :loading="loading" @click="doTwoFaLogin">
          验证并登录
        </el-button>
        <div class="register-link">
          <a href="javascript:;" @click="twoFaRequired = false; twoFaCode = ''; twoFaError = ''">返回</a>
        </div>
      </el-form>

      <!-- 登录表单 -->
      <el-form v-if="!twoFaRequired && !showRegister" label-position="top" @submit.prevent="doLogin">
        <el-form-item label="用户名">
          <el-input v-model="username" placeholder="请输入用户名" prefix-icon="User" clearable />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="password"
            type="password"
            placeholder="请输入密码"
            prefix-icon="Lock"
            show-password
            @keyup.enter="doLogin"
          />
        </el-form-item>
        <!-- 验证码 -->
        <el-form-item v-if="captchaRequired" label="验证码">
          <div class="captcha-row">
            <el-input
              v-model="captchaInput"
              placeholder="请输入验证码"
              @keyup.enter="doLogin"
            />
            <div class="captcha-img" @click="loadCaptcha" title="点击刷新">
              <img v-if="captchaImage" :src="captchaImage" alt="验证码" class="captcha-img-el" />
              <span v-else class="captcha-placeholder">加载中…</span>
            </div>
          </div>
        </el-form-item>
        <div v-if="captchaError" class="captcha-error">{{ captchaError }}</div>
        <el-button type="primary" class="login-btn" :loading="loading" @click="doLogin">
          登 录
        </el-button>
        <div v-if="brand.registerEnabled" class="register-link">
          <span>还没有账号？</span>
          <a href="javascript:;" @click="showRegister = true">立即注册</a>
        </div>
      </el-form>

      <!-- 注册表单 -->
      <el-form v-if="showRegister && !twoFaRequired" label-position="top" @submit.prevent="doRegister">
        <el-form-item label="用户名">
          <el-input v-model="regUsername" placeholder="3-32 位用户名" prefix-icon="User" clearable />
        </el-form-item>
        <el-form-item label="显示名称（可选）">
          <el-input v-model="regDisplayName" placeholder="显示在个人资料中" clearable />
        </el-form-item>
        <el-form-item label="邮箱（可选）">
          <el-input v-model="regEmail" placeholder="用于接收注册欢迎邮件" clearable />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="regPassword"
            type="password"
            placeholder="至少 8 位密码"
            prefix-icon="Lock"
            show-password
            @keyup.enter="doRegister"
          />
        </el-form-item>
        <el-button type="primary" class="login-btn" :loading="regLoading" @click="doRegister">
          注 册
        </el-button>
        <div class="register-link">
          <span>已有账号？</span>
          <a href="javascript:;" @click="showRegister = false">返回登录</a>
        </div>
      </el-form>
      <div v-if="brand.notice" class="notice">
        <el-icon><Document /></el-icon>
        <span>{{ brand.notice }}</span>
      </div>
      <div class="tip">默认管理员账号：admin / admin123</div>
      <div v-if="brand.copyright" class="copyright">{{ brand.copyright }}</div>
      <div v-if="brand.contactEmail" class="contact">{{ brand.contactEmail }}</div>
    </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  position: relative;
  overflow: hidden;
}
.login-page::before,
.login-page::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  filter: blur(120px);
  opacity: 0.4;
  animation: login-orb 16s ease-in-out infinite;
}
.login-page::before {
  top: -120px;
  right: -80px;
  width: 420px;
  height: 420px;
  background: var(--accent);
}
.login-page::after {
  bottom: -120px;
  left: -80px;
  width: 420px;
  height: 420px;
  background: color-mix(in srgb, var(--accent) 50%, #ffffff);
  opacity: 0.3;
  animation-delay: -8s;
}
@keyframes login-orb {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(28px, -22px) scale(1.08); }
}
.login-card {
  width: 380px;
  max-width: calc(100vw - 32px);
  background: var(--glass-bg);
  backdrop-filter: blur(var(--blur)) saturate(170%);
  -webkit-backdrop-filter: blur(var(--blur)) saturate(170%);
  border: 1px solid var(--glass-border);
  border-radius: 24px;
  padding: 40px 34px;
  box-shadow: var(--shadow), inset 0 1px 0 var(--glass-highlight);
  position: relative;
  z-index: 1;
  animation: login-in 0.5s var(--ease-smooth);
}
@keyframes login-in {
  from { opacity: 0; transform: translateY(16px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
.login-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 24px;
  right: 24px;
  height: 3px;
  border-radius: 0 0 6px 6px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  opacity: 0.7;
}

/* ---------- 分屏布局：左品牌展示 + 右登录卡片 ---------- */
.login-split {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 64px;
  width: 100%;
  max-width: 1040px;
  padding: 0 40px;
}
.login-hero {
  flex: 1;
  min-width: 0;
  animation: login-in 0.6s var(--ease-smooth) both;
}
.hero-logo {
  width: 72px;
  height: 72px;
  border-radius: 22px;
  display: grid;
  place-items: center;
  color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-2, var(--accent)));
  box-shadow: 0 16px 40px var(--accent-soft), inset 0 1px 0 rgba(255, 255, 255, 0.35);
  margin-bottom: 22px;
}
.hero-logo img {
  width: 44px;
  height: 44px;
  object-fit: contain;
  border-radius: 10px;
}
.hero-title {
  margin: 0;
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 0.01em;
  color: var(--text);
  background: linear-gradient(120deg, var(--text) 30%, var(--accent));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hero-sub {
  margin: 10px 0 30px;
  font-size: 14px;
  color: var(--text-secondary);
}
.hero-features {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.hero-feature {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 13px 16px;
  border-radius: 16px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(var(--blur)) saturate(160%);
  -webkit-backdrop-filter: blur(var(--blur)) saturate(160%);
  transition: transform 0.25s var(--ease-smooth), border-color 0.25s var(--ease-smooth);
}
.hero-feature:hover {
  transform: translateX(4px);
  border-color: color-mix(in srgb, var(--accent) 34%, transparent);
}
.hf-icon {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--glass-border);
}
.hf-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.hf-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-secondary);
}
.hero-copyright {
  margin-top: 28px;
  font-size: 11.5px;
  color: var(--text-secondary);
  opacity: 0.8;
}
/* 宽屏：左侧已展示品牌，卡片内品牌区隐藏避免重复 */
@media (min-width: 900px) {
  .login-card .brand {
    display: none;
  }
}
/* 窄屏：隐藏左栏，回落单栏 */
@media (max-width: 900px) {
  .login-hero {
    display: none;
  }
  .login-split {
    padding: 0 16px;
  }
}
.brand {
  text-align: center;
  margin-bottom: 24px;
}
.brand-logo {
  width: 64px;
  height: 64px;
  object-fit: contain;
  margin: 0 auto;
  border-radius: 16px;
}
.brand-name {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  margin-top: 8px;
}
.brand-sub {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 6px;
}
.login-btn {
  width: 100%;
  font-weight: 600;
  letter-spacing: 0.08em;
  box-shadow: 0 10px 26px var(--accent-soft);
}
.login-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 32px var(--accent-soft);
}
.captcha-row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.captcha-row .el-input {
  flex: 1;
}
.captcha-img {
  width: 100px;
  height: 36px;
  border-radius: 8px;
  background: var(--accent-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
}
.captcha-img-el {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  border-radius: 8px;
}
.captcha-placeholder {
  font-size: 12px;
  color: var(--text-secondary);
}
.captcha-error {
  margin-top: 8px;
  font-size: 12px;
  color: #ef4444;
}
.register-link {
  margin-top: 14px;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary);
}
.register-link a {
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
}
.register-link a:hover {
  text-decoration: underline;
}
.notice {
  margin-top: 16px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
  background: var(--accent-soft);
  border-radius: 12px;
  padding: 10px 12px;
}
.notice .el-icon {
  margin-top: 3px;
  color: var(--accent);
  flex-shrink: 0;
}
.tip {
  margin-top: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
}
.copyright {
  margin-top: 10px;
  text-align: center;
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.8;
}
.contact {
  margin-top: 4px;
  text-align: center;
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.7;
}

/* 2FA 样式 */
.twoFa-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}

/* 窄屏（手机）自适应 */
@media (max-width: 440px) {
  .login-card {
    width: 100%;
    max-width: 100%;
    border-radius: 20px;
    padding: 28px 20px;
  }
  .login-page {
    padding: 16px 0;
  }
  .captcha-row {
    flex-wrap: wrap;
  }
  .captcha-img {
    width: 100%;
    height: 44px;
  }
}
</style>
