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

  describe('分屏布局（二期焕新）', () => {
    it('存在分屏包裹与左侧品牌展示区', () => {
      expect(login).toContain('class="login-split"');
      expect(login).toContain('class="login-hero"');
    });

    it('定义 3 条功能亮点', () => {
      expect(login).toMatch(/heroFeatures\s*=\s*\[[\s\S]*?多存储统一管理[\s\S]*?一键分享协作[\s\S]*?双重认证防护/);
    });

    it('功能列表用 v-for 渲染', () => {
      expect(login).toMatch(/v-for="f in heroFeatures"/);
    });

    it('窄屏（≤900px）隐藏左栏回落单栏', () => {
      expect(login).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.login-hero \{[^}]*display:\s*none/);
    });

    it('宽屏隐藏卡片内重复品牌区', () => {
      expect(login).toMatch(/@media \(min-width: 900px\)[\s\S]*?\.login-card \.brand \{[^}]*display:\s*none/);
    });
  });
});

describe('产品化升级（三期）', () => {
  const repoRoot = resolve(__dirname, '../../..');
  function readRepo(rel: string): string {
    return readFileSync(resolve(repoRoot, rel), 'utf-8');
  }

  it('App.vue 挂载 TransferCenter 全局传输中心', () => {
    const app = readSrc('App.vue');
    expect(app).toContain("import TransferCenter from './components/TransferCenter.vue'");
    expect(app).toContain('<TransferCenter />');
  });

  it('router.ts 含 /tags 路由且侧边栏有标签入口', () => {
    const router = readSrc('router.ts');
    expect(router).toContain("path: '/tags'");
    expect(router).toContain('Tags.vue');
    const app = readSrc('App.vue');
    expect(app).toContain("path: '/tags'");
  });

  it('Files.vue 接入 FileDetailDrawer 详情抽屉（版本/评论）', () => {
    const files = readSrc('views/Files.vue');
    expect(files).toContain("import FileDetailDrawer from '../components/FileDetailDrawer.vue'");
    expect(files).toContain('<FileDetailDrawer');
  });

  it('Tags.vue / TransferCenter.vue / FileDetailDrawer.vue 存在', () => {
    expect(readSrc('views/Tags.vue')).toContain('files-by-tag');
    expect(readSrc('components/TransferCenter.vue')).toContain('useTransferStore');
    expect(readSrc('components/FileDetailDrawer.vue')).toContain('versions');
  });

  it('Shares.vue 接入二维码（qrcode）', () => {
    const shares = readSrc('views/Shares.vue');
    expect(shares).toContain("import QRCode from 'qrcode'");
    expect(shares).toContain('toDataURL');
  });

  it('recycle.routes.ts 含 /recycle/batch 批量端点', () => {
    const routes = readRepo('apps/server/src/routes/recycle.routes.ts');
    expect(routes).toContain("'/recycle/batch'");
    expect(routes).toContain("'restore'");
    expect(routes).toContain("'purge'");
  });

  it('log.routes.ts 含 export.csv 导出端点', () => {
    const routes = readRepo('apps/server/src/routes/log.routes.ts');
    expect(routes).toContain("'/logs/export.csv'");
    expect(routes).toContain('text/csv');
  });
});

describe('焕然一新升级（四期）', () => {
  it('App.vue 挂载 CommandPalette 全局命令面板', () => {
    const app = readSrc('App.vue');
    expect(app).toContain("import CommandPalette from './components/CommandPalette.vue'");
    expect(app).toContain('<CommandPalette />');
  });

  it('CommandPalette.vue：Ctrl/⌘+K 唤起 + 文件搜索 + 快捷动作', () => {
    const cp = readSrc('components/CommandPalette.vue');
    expect(cp).toContain("e.key === 'k'");
    expect(cp).toContain('/search?q=');
    expect(cp).toContain('nd:open-theme-picker');
  });

  it('Files.vue 私有 cmdk 已移除', () => {
    const files = readSrc('views/Files.vue');
    expect(files).not.toContain('cmdkOpen');
    expect(files).not.toContain('onCmdkKeydown');
  });

  it('Files.vue 批量浮动操作条（全选/反选/下载/移动/复制/收藏/删除）', () => {
    const files = readSrc('views/Files.vue');
    expect(files).toContain('class="selection-bar glass fade-up"');
    expect(files).toContain('function selectAll()');
    expect(files).toContain('function invertSelection()');
    expect(files).toContain('function doBatchStar()');
  });

  it('Files.vue 键盘快捷键 + 帮助对话框', () => {
    const files = readSrc('views/Files.vue');
    expect(files).toContain('function onFilesKeydown');
    expect(files).toContain('shortcutDialog');
    expect(files).toContain("case 'shortcuts'");
  });

  it('Files.vue 搜索对话框接入搜索历史', () => {
    const files = readSrc('views/Files.vue');
    expect(files).toContain('/search-history?limit=8');
    expect(files).toContain('useHistoryQuery');
    expect(files).toContain('clearSearchHistory');
  });

  it('五个页面接入 loadThumbs 缩略图', () => {
    for (const p of ['views/Favorites.vue', 'views/Recent.vue', 'views/QuickAccess.vue', 'views/Tags.vue', 'views/Recycle.vue']) {
      expect(readSrc(p)).toContain('loadThumbs');
    }
  });

  it('Media.vue 不再含裸缩略图请求，改走 loadThumbs', () => {
    const media = readSrc('views/Media.vue');
    expect(media).not.toContain('/files/thumbnail');
    expect(media).toContain('loadThumbs');
  });

  it('glass.css 末尾追加微交互工具类', () => {
    const css = readSrc('glass.css');
    expect(css).toContain('.press:active');
    expect(css).toContain('.fade-up {');
  });

  it('Recycle.vue 表格空态文案', () => {
    const recycle = readSrc('views/Recycle.vue');
    expect(recycle).toContain('回收站是空的');
  });
});
