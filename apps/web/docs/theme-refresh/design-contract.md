# NebulaDrive 三主题焕新 · 设计契约（聚焦版）

范围：`[data-theme='dashboard'|'bento'|'command']` + `.files-dashboard/.files-bento/.files-command`。
现状基线（glass.css L102-170 / Files.vue L2769-2837）：dashboard=模板紫渐变、bento=180px 均格+伪随机跨格、command=纯黑+伪 `::before` 搜索行（无真实 ⌘K）。本契约全部替换。

## 1. 每主题 CSS 变量（exact 值）

### 1.1 dashboard — 现代控制中心（去模板紫，WCAG AA）
| 变量 | 值 |
|---|---|
| `--bg` | `#0f172a`（纯色，删除紫渐变） |
| `--glass-bg` / `--glass-bg-hover` | `rgba(30,41,59,0.6)` / `rgba(51,65,85,0.75)` |
| `--glass-border` | `rgba(148,163,184,0.25)` |
| `--text` / `--text-secondary` | `#f8fafc` / `#94a3b8`（对 `#0f172a` 对比度 7.1:1 ✓AA） |
| `--accent` / `--accent-soft` | `#38bdf8` / `rgba(56,189,248,0.15)`（8.4:1 ✓） |
| `--surface` | `rgba(30,41,59,0.8)` |
| `--shadow` / `--shadow-hover` | `0 8px 24px rgba(2,6,23,0.5)` / `0 16px 40px rgba(2,6,23,0.6)` |
| 字体 | `'Inter', -apple-system, 'Segoe UI', sans-serif` |
| 圆角 | `12px`（`.glass/.glass-card/.glass-btn`） |
| 动效 | 入场 `240ms ease-out`，stagger `40ms`，hover `150ms` |

### 1.2 bento — 真正的便当盒（分层底 + 彩色 tile）
| 变量 | 值 |
|---|---|
| `--bg` | `#f0f4f8`（底层） |
| `--glass-bg` / `--glass-bg-hover` | `#ffffff` / `#ffffff`（卡片层，实底非玻璃） |
| `--glass-border` | `#e2e8f0` |
| `--text` / `--text-secondary` | `#1e293b` / `#64748b`（对白底 4.8:1 ✓AA） |
| `--accent` / `--accent-soft` | `#10b981` / `rgba(16,185,129,0.12)` |
| `--surface` | `#ffffff` |
| `--shadow` / `--shadow-hover` | `0 4px 12px rgba(15,23,42,0.06)` / `0 12px 28px rgba(15,23,42,0.12)` |
| 彩色 tile（≥3） | featured `#4f46e5`/文字`#ffffff`(6.3:1) · `#f59e0b`/`#451a03`(7.0:1) · `#10b981`/`#052e16`(5.9:1) |
| 字体 | `'Inter', -apple-system, 'Segoe UI', sans-serif` |
| 圆角 | `16px`（维持现状） |
| 动效 | 入场 `200ms ease-out`，hover `150ms` |

### 1.3 command — 真命令面板（非纯黑，等宽仅命令区）
| 变量 | 值 |
|---|---|
| `--bg` | `#16181d`（替换 `#000000`） |
| `--glass-bg` / `--glass-bg-hover` | `#1e2128` / `#262a33` |
| `--glass-border` | `#2e323c` |
| `--text` / `--text-secondary` | `#e6e8ec` / `#9aa1ad`（对 `#1e2128` 13.1:1 / 6.3:1 ✓） |
| `--accent` / `--accent-soft` | `#ff6b35` / `rgba(255,107,53,0.15)`（5.7:1 ✓） |
| `--surface` | `#1a1c22` |
| `--shadow` / `--shadow-hover` | `0 0 0 1px #2e323c` / `0 0 0 2px rgba(255,107,53,0.6)` |
| 字体 | body 保持 sans；**仅** `.fc-name`/`.cmdk-*` 用 `'JetBrains Mono','SF Mono','Fira Code',Consolas,monospace` 14px（删除 `body` 全局等宽规则） |
| 圆角 | `6px`（维持现状） |
| 动效 | 面板打开 `120ms ease-out`，行切换 `80ms`，列表淡入 `100ms` |

## 2. 组件覆盖（仅主题作用域，exact 值）

| 主题 | 组件 | 覆盖值 |
|---|---|---|
| dashboard | `[data-theme='dashboard'] .el-button--primary` | `background:#38bdf8; border-color:#38bdf8; color:#0f172a`（6.6:1 ✓） |
| dashboard | `.el-dialog` | `background:#1e293b; border:1px solid #334155; border-radius:12px; box-shadow:0 24px 64px rgba(2,6,23,0.6)` |
| dashboard | `.el-input__wrapper` | `background:#0f172a; box-shadow:0 0 0 1px #334155 inset`；focus `0 0 0 1px #38bdf8 inset` |
| bento | `[data-theme='bento'] .el-button--primary` | `background:#10b981; border-color:#10b981; color:#052e16`（5.9:1 ✓）；hover 仅 `transform:translateY(-1px)`+阴影 |
| bento | `.el-dialog` | `background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; box-shadow:0 24px 64px rgba(15,23,42,0.12)` |
| bento | `.el-input__wrapper` | `background:#ffffff; box-shadow:0 0 0 1px #e2e8f0 inset`；focus `0 0 0 1px #10b981 inset` |
| command | `[data-theme='command'] .el-button--primary` | `background:#ff6b35; border-color:#ff6b35; color:#14161b`（6.5:1 ✓） |
| command | `.el-dialog` | `background:#1e2128; border:1px solid #2e323c; border-radius:6px`（替换 `#1a1a1a`） |
| command | `.el-input__wrapper` | `background:#16181d; box-shadow:0 0 0 1px #2e323c inset`；focus `0 0 0 1px #ff6b35 inset` |

## 3. 布局（exact 尺寸）

### 3.1 dashboard 统计卡网格（≥4 张 + 趋势 + 入场动画）
- `.files-dashboard .stats-bar`：`display:grid; grid-template-columns:repeat(4,1fr); gap:16px;`；`≤1199px`→`repeat(2,1fr)`；`<768px`→`1fr`
- `.files-dashboard .stat-card`：`min-height:108px; border-radius:12px; padding:16px 20px`；数值 `28px/700`、标签 `13px`、趋势 `12px`
- 趋势 chip：涨 `#34d399` 底 `rgba(52,211,153,0.12)`；跌 `#f87171` 底 `rgba(248,113,113,0.12)`
- 入场：`@keyframes dash-in { from{opacity:0; transform:translateY(12px)} }`，`animation: dash-in 240ms ease-out both`，`animation-delay: calc(var(--i)*40ms)`（`--i` 0-3）
- 4 张卡：总容量 / 文件数 / 近 7 天上传 / 配额使用率（各含趋势 chip）

### 3.2 bento：1 featured + 中/小卡 + 彩色 tile
- `.files-bento .file-grid`：`grid-template-columns:repeat(4,1fr); gap:16px`（替换 `minmax(180px,1fr)` 与 nth-child 伪随机跨格）
- featured：`grid-column:span 2; grid-row:span 2; min-height:340px; background:#4f46e5; color:#ffffff`
- medium：`grid-column:span 2; min-height:168px`；small：`min-height:168px`
- 彩色 tile 类：`.tile-indigo{background:#4f46e5;color:#fff}` `.tile-amber{background:#f59e0b;color:#451a03}` `.tile-emerald{background:#10b981;color:#052e16}`（每屏 ≥2-3 张）
- 普通卡：`background:#ffffff; border:1px solid #e2e8f0; border-radius:16px`

### 3.3 command：真 ⌘K 命令面板
- 触发：全局 `keydown` `Meta+K`/`Control+K` 打开；删除 `.files-command::before` 伪搜索行
- `.cmdk-panel`：`position:fixed; top:20vh; left:50%; transform:translateX(-50%); width:640px; max-height:480px; background:#1e2128; border:1px solid #2e323c; border-radius:8px; box-shadow:0 24px 64px rgba(0,0,0,0.5)`
- `.cmdk-input`：`height:48px; font-size:16px; 等宽; background:transparent; border-bottom:1px solid #2e323c`
- `.cmdk-item`：`height:40px; font-size:14px; 等宽`；active 行 `background:#262a33`；选中环 `2px solid #ff6b35`
- 搜索：模糊（子串 > 子序列打分），结果上限 20 条；键盘 `↑/↓` 移动、`Enter` 执行、`Esc` 关闭
- 列表区维持 flex column `gap:2px`（现状不变），行高 `40px`

## 4. 隔离边界

- ✅ 可改：glass.css 中三个主题的变量块；Files.vue 中 `.files-dashboard/.files-bento/.files-command` 作用域选择器；主题作用域的 Element Plus 覆盖（`[data-theme='…'] .el-*`）；新增作用域类（`.cmdk-*`、`.tile-*`、scoped `.stat-card`）
- 🚫 禁改：通用 `.file-grid` / `.file-card` / `.stats-bar` 基础定义（无作用域前缀者）；全局 `.el-*` 覆盖（无 `[data-theme]` 前缀者）；其他主题（top-nav/cyberpunk 等）变量块；`useTheme.ts` 主题元数据

## 5. 验收清单

- [ ] dashboard 背景为 `#0f172a`，无紫渐变；正文/次要文字对比 ≥4.5:1
- [ ] dashboard ≥4 张统计卡，含趋势 chip，入场 240ms + 40ms stagger
- [ ] bento 网格 `repeat(4,1fr)`，含 1 张 2×2 featured（340px）与 ≥2 张彩色 tile
- [ ] bento 卡片实底白 + `1px #e2e8f0` 边框，非玻璃
- [ ] command 背景 `#16181d`（非纯黑）；等宽字体仅出现在 `.fc-name`/`.cmdk-*`
- [ ] `⌘K`/`Ctrl+K` 真实打开面板（640×480, top 20vh），模糊搜索 + `↑↓/Enter/Esc` 键盘导航
- [ ] 三主题 el-button/dialog/input 覆盖值与第 2 节表格一致
- [ ] 未改动通用 `.file-grid/.file-card/.stats-bar` 与全局 `.el-*`（diff 检查）

## 6. 改动地图（现状 → 新值）

| 位置 | 现状 | 契约动作 |
|---|---|---|
| glass.css L102-116（dashboard 变量块） | 紫渐变 `#667eea→#764ba2` + 白玻璃 | 按 §1.1 重写（slate 深底 + sky 强调） |
| glass.css L119-138（bento 变量块） | `rgba(255,255,255,0.9)` 玻璃卡 | 按 §1.2 重写（实底白卡 + tile 三色） |
| glass.css L141-155（command 变量块） | `#000000` 纯黑 | 按 §1.3 重写（`#16181d` 中性深底） |
| glass.css L156-158（command body 等宽） | `body` 全局 monospace | 删除；等宽仅 `.fc-name`/`.cmdk-*` |
| glass.css L164-172（command el-dialog/el-input） | `#1a1a1a` 黑底 | 按 §2 表格替换为 `#1e2128`/`#16181d` |
| Files.vue L2769-2785（bento 网格） | `minmax(180px,1fr)` + nth-child 伪随机跨格 | 按 §3.2 重写（4 列 + featured/medium 类） |
| Files.vue L2788-2837（command 列表） | 隐藏 toolbar + 伪 `::before` 搜索行 | 保留列表结构；删 `::before`，新增 `.cmdk-*` 面板（§3.3） |
| Files.vue L1245-1249（stats-bar 标记） | 已有 `.stats-bar/.stat-card` | 仅加 scoped 覆盖 + `--i` stagger（§3.1），不改通用定义 |
| 新增（Files.vue scoped style） | — | `.cmdk-panel/.cmdk-input/.cmdk-item`、`.tile-indigo/.tile-amber/.tile-emerald`、`dash-in` keyframes |

执行顺序：① glass.css 三变量块 → ② 主题作用域 el-* 覆盖 → ③ Files.vue 布局 scoped 段 → ④ ⌘K 交互（keydown + 模糊搜索）。
