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
const captchaCode = ref('');
const captchaInput = ref('');
const captchaError = ref('');

async function loadCaptcha() {
  try {
    const r = await api('/auth/captcha');
    captchaId.value = r.id;
    captchaCode.value = r.code;
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
    router.push('/');
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
    router.push('/');
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
    router.push('/');
  } catch (e: any) {
    twoFaError.value = e.message || '2FA 验证失败';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
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
              <span class="captcha-text">{{ captchaCode }}</span>
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
}
.login-card {
  width: 380px;
  background: var(--glass-bg);
  backdrop-filter: blur(var(--blur)) saturate(170%);
  -webkit-backdrop-filter: blur(var(--blur)) saturate(170%);
  border: 1px solid var(--glass-border);
  border-radius: 24px;
  padding: 40px 34px;
  box-shadow: var(--shadow), inset 0 1px 0 var(--glass-highlight);
  position: relative;
  z-index: 1;
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
.captcha-text {
  font-size: 18px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 4px;
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
</style>
