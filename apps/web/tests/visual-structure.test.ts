import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '../src');

function readSrc(rel: string): string {
  return readFileSync(resolve(srcDir, rel), 'utf-8');
}

describe('App.vue 页面切换过渡', () => {
  const app = readSrc('App.vue');

  it('router-view 包裹 keep-alive', () => {
    expect(app).toContain('<keep-alive>');
  });

  it('使用 page-fade 过渡且 mode 为 out-in', () => {
    expect(app).toMatch(/<transition\s+name="page-fade"\s+mode="out-in">/);
  });

  it('过渡包裹动态组件', () => {
    expect(app).toMatch(/<transition[^>]*>\s*<component\s+:is="Component"\s*\/>/);
  });
});

describe('Login.vue 视觉提升', () => {
  const login = readSrc('views/Login.vue');

  describe('登录卡入场动画', () => {
    it('.login-card 绑定 login-in 动画', () => {
      expect(login).toMatch(/\.login-card\s*\{[^}]*animation:\s*login-in\s+0\.5s\s+var\(--ease-smooth\)/);
    });

    it('定义了 @keyframes login-in', () => {
      expect(login).toMatch(/@keyframes login-in\s*\{[^}]*from\s*\{[^}]*opacity:\s*0[^}]*translateY\(16px\)\s+scale\(0\.98\)/);
      expect(login).toMatch(/@keyframes login-in[^}]*\}[^}]*to\s*\{[^}]*opacity:\s*1/);
    });
  });

  describe('背景光斑漂移', () => {
    it('::before/::after 绑定 login-orb 动画', () => {
      expect(login).toMatch(/\.login-page::before,\s*\.login-page::after\s*\{[^}]*animation:\s*login-orb\s+16s/);
    });

    it('::after 设置反向延迟', () => {
      expect(login).toMatch(/\.login-page::after\s*\{[^}]*animation-delay:\s*-8s/);
    });

    it('定义了 @keyframes login-orb（含平移与缩放）', () => {
      expect(login).toMatch(/@keyframes login-orb[\s\S]*?50%\s*\{[^}]*translate\(28px,\s*-22px\)\s+scale\(1\.08\)/);
    });
  });

  describe('卡片顶部 accent 细线', () => {
    it('.login-card::before 存在顶部渐变细线', () => {
      expect(login).toMatch(/\.login-card::before\s*\{[^}]*height:\s*3px/);
      expect(login).toMatch(/\.login-card::before\s*\{[^}]*background:\s*linear-gradient\(90deg,\s*transparent,\s*var\(--accent\),\s*transparent\)/);
      expect(login).toMatch(/\.login-card::before\s*\{[^}]*opacity:\s*0\.7/);
    });
  });

  describe('登录按钮柔光', () => {
    it('.login-btn 字重 600 且字距加宽', () => {
      expect(login).toMatch(/\.login-btn\s*\{[^}]*font-weight:\s*600/);
      expect(login).toMatch(/\.login-btn\s*\{[^}]*letter-spacing:\s*0\.08em/);
    });

    it('.login-btn 带主题色柔光阴影', () => {
      expect(login).toMatch(/\.login-btn\s*\{[^}]*box-shadow:\s*0 10px 26px var\(--accent-soft\)/);
    });

    it('.login-btn hover 上浮且阴影增强', () => {
      expect(login).toMatch(/\.login-btn:hover\s*\{[^}]*transform:\s*translateY\(-1px\)/);
      expect(login).toMatch(/\.login-btn:hover\s*\{[^}]*box-shadow:\s*0 14px 32px var\(--accent-soft\)/);
    });
  });
});
