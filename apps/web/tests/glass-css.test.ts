import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const glassCssPath = resolve(__dirname, '../src/glass.css');
const css = readFileSync(glassCssPath, 'utf-8');

describe('glass.css 全局设计令牌', () => {
  describe('统一缓动曲线', () => {
    it('定义了 --ease-smooth 变量', () => {
      expect(css).toContain('--ease-smooth: cubic-bezier(0.4, 0, 0.2, 1)');
    });
  });

  describe('Element Plus 变量映射', () => {
    it('主色映射到主题 accent', () => {
      expect(css).toMatch(/--el-color-primary:\s*var\(--accent\)/);
    });

    it('light-3/5/7/8/9 使用 color-mix 派生', () => {
      expect(css).toMatch(/--el-color-primary-light-3:\s*color-mix\(in srgb,\s*var\(--accent\) 70%, #ffffff\)/);
      expect(css).toMatch(/--el-color-primary-light-5:\s*color-mix\(in srgb,\s*var\(--accent\) 50%, #ffffff\)/);
      expect(css).toMatch(/--el-color-primary-light-7:\s*color-mix\(in srgb,\s*var\(--accent\) 30%, #ffffff\)/);
      expect(css).toMatch(/--el-color-primary-light-9:\s*color-mix\(in srgb,\s*var\(--accent\) 12%, #ffffff\)/);
    });

    it('dark-2 使用 color-mix 派生', () => {
      expect(css).toMatch(/--el-color-primary-dark-2:\s*color-mix\(in srgb,\s*var\(--accent\) 80%, #000000\)/);
    });

    it('圆角基数设定为 10px', () => {
      expect(css).toMatch(/--el-border-radius-base:\s*10px/);
    });
  });

  describe('选区与聚焦反馈', () => {
    it('::selection 跟随主题 accent', () => {
      expect(css).toMatch(/::selection\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--accent\) 28%, transparent\)/);
    });

    it(':focus-visible 使用主题色描边', () => {
      expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid color-mix\(in srgb,\s*var\(--accent\) 55%, transparent\)/);
    });
  });

  describe('按钮微交互', () => {
    it('hover 上浮 1px', () => {
      expect(css).toMatch(/\.el-button:not\(\.is-disabled\):not\(\.is-loading\):hover\s*\{[^}]*transform:\s*translateY\(-1px\)/);
    });

    it('active 回弹并缩放 0.97', () => {
      expect(css).toMatch(/\.el-button:not\(\.is-disabled\):not\(\.is-loading\):active\s*\{[^}]*scale\(0\.97\)/);
    });

    it('primary 按钮带主题色柔光阴影', () => {
      expect(css).toMatch(/\.el-button--primary:not\(\.is-link\):not\(\.is-text\)\s*\{[^}]*box-shadow:\s*0 4px 14px var\(--accent-soft\)/);
    });

    it('primary 按钮 hover 阴影增强', () => {
      expect(css).toMatch(/\.el-button--primary:not\(\.is-link\):not\(\.is-text\):hover\s*\{[^}]*box-shadow:\s*0 8px 22px var\(--accent-soft\)/);
    });
  });

  describe('表格视觉层级', () => {
    it('表头字重 600', () => {
      expect(css).toMatch(/\.el-table__header th\.el-table__cell\s*\{[^}]*font-weight:\s*600/);
    });

    it('行 hover 背景过渡', () => {
      expect(css).toMatch(/\.el-table__body tr\s*\{[^}]*transition:\s*background-color/);
    });
  });

  describe('弹窗微交互', () => {
    it('关闭按钮 hover 旋转 90deg', () => {
      expect(css).toMatch(/\.el-dialog__headerbtn:hover\s+\.el-dialog__close\s*\{[^}]*transform:\s*rotate\(90deg\)/);
    });

    it('ElMessageBox 玻璃化（backdrop-filter blur）', () => {
      expect(css).toMatch(/\.el-message-box\s*\{[^}]*backdrop-filter:\s*blur\(28px\) saturate\(170%\)/);
    });
  });

  describe('页面切换过渡', () => {
    it('定义了 page-fade 进入动画', () => {
      expect(css).toMatch(/\.page-fade-enter-active/);
      expect(css).toMatch(/\.page-fade-enter-from\s*\{[^}]*opacity:\s*0[^}]*translateY\(10px\)/);
    });

    it('定义了 page-fade 离开动画', () => {
      expect(css).toMatch(/\.page-fade-leave-to\s*\{[^}]*opacity:\s*0[^}]*translateY\(-6px\)/);
    });
  });

  describe('空状态与分页', () => {
    it('空状态描述使用 secondary 色', () => {
      expect(css).toMatch(/\.el-empty__description p\s*\{[^}]*color:\s*var\(--text-secondary\)/);
    });

    it('分页页码圆角 8px', () => {
      expect(css).toMatch(/\.el-pager li\s*\{[^}]*border-radius:\s*8px/);
    });
  });
});
