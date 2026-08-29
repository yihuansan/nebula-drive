import { ref, readonly, computed } from 'vue';

/** 主题分组：2026 精选 / 玻璃质感 / 经典风格（主题选择器分组展示） */
export const THEME_GROUPS = {
  featured: '2026 精选',
  glass: '玻璃质感',
  classic: '经典风格',
} as const;
export type ThemeGroup = keyof typeof THEME_GROUPS;

/** 主题元数据（swatch：选择器底色圆点预览色） */
export const THEMES = {
  /* ---------- 2026 精选 ---------- */
  'light-glass': { label: '毛玻璃', icon: '☀️', isGlass: true, layout: 'sidebar', group: 'featured', swatch: '#6366f1' },
  'dark-glass': { label: '深色玻璃', icon: '🌙', isGlass: true, layout: 'sidebar', group: 'featured', swatch: '#818cf8' },
  'stardust': { label: '星尘', icon: '✨', isGlass: true, layout: 'sidebar', group: 'featured', swatch: '#4cc9ff' },
  'dawn': { label: '晨曦', icon: '🌅', isGlass: false, layout: 'sidebar', group: 'featured', swatch: '#e8823c' },
  'flow': { label: '流光', icon: '🌌', isGlass: true, layout: 'sidebar', group: 'featured', swatch: '#a78bfa' },
  /* ---------- 玻璃质感 ---------- */
  'silver': { label: '银灰', icon: '◈', isGlass: true, layout: 'sidebar', group: 'glass', swatch: '#4348e0' },
  'aurora': { label: '极光', icon: '🌠', isGlass: true, layout: 'sidebar', group: 'glass', swatch: '#7c6ef0' },
  'sunset': { label: '落日', icon: '🌇', isGlass: true, layout: 'sidebar', group: 'glass', swatch: '#ff6f91' },
  'forest': { label: '森林', icon: '🌲', isGlass: true, layout: 'sidebar', group: 'glass', swatch: '#8fbc5a' },
  'dashboard': { label: '仪表盘', icon: '📊', isGlass: true, layout: 'dashboard', group: 'glass', swatch: '#38bdf8' },
  /* ---------- 经典风格 ---------- */
  'minimal': { label: '极简经典', icon: '◻', isGlass: false, layout: 'sidebar', group: 'classic', swatch: '#2456d6' },
  'top-nav': { label: '顶部导航', icon: '▬', isGlass: false, layout: 'topnav', group: 'classic', swatch: '#4f46e5' },
  'bento': { label: '便当盒', icon: '▦', isGlass: false, layout: 'bento', group: 'classic', swatch: '#10b981' },
  'command': { label: '命令式', icon: '⌘', isGlass: false, layout: 'command', group: 'classic', swatch: '#ff6b35' },
  'cyberpunk': { label: '赛博霓虹', icon: '🌆', isGlass: false, layout: 'sidebar', group: 'classic', swatch: '#00ffc8' },
  'retro': { label: '复古怀旧', icon: '📻', isGlass: false, layout: 'sidebar', group: 'classic', swatch: '#8b6c4c' },
  'neumorphic': { label: '新拟态', icon: '◍', isGlass: false, layout: 'sidebar', group: 'classic', swatch: '#6c757d' },
  'swiss': { label: '瑞士现代', icon: '✚', isGlass: false, layout: 'sidebar', group: 'classic', swatch: '#ff0000' },
  'ink': { label: '水墨', icon: '🖌', isGlass: false, layout: 'sidebar', group: 'classic', swatch: '#8b4513' },
  'terminal': { label: '终端', icon: '>_', isGlass: false, layout: 'sidebar', group: 'classic', swatch: '#00ff41' },
} as const;

export type ThemeKey = keyof typeof THEMES;

const STORAGE_KEY = 'nebula_theme';

function initialTheme(): ThemeKey {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in THEMES) return saved as ThemeKey;
  } catch {
    /* 忽略 */
  }
  return 'light-glass';
}

// 模块级单例状态（跨组件共享）
const theme = ref<ThemeKey>(initialTheme());

// 应用主题到 <html data-theme>
function apply(t: ThemeKey) {
  document.documentElement.setAttribute('data-theme', t);
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    /* 忽略 */
  }
}

// 初始化时应用一次
apply(theme.value);

export function useTheme() {
  function setTheme(t: ThemeKey) {
    if (t in THEMES) {
      theme.value = t;
      apply(t);
    }
  }

  function cycleTheme() {
    const keys = Object.keys(THEMES) as ThemeKey[];
    const next = keys[(keys.indexOf(theme.value) + 1) % keys.length];
    setTheme(next);
  }

  return {
    theme: readonly(theme),
    themes: THEMES,
    setTheme,
    cycleTheme,
    isGlassTheme: computed(() => THEMES[theme.value].isGlass),
  };
}
