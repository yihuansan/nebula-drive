# NebulaDrive 文件管理页布局大更新 — T6 验收报告

> 审查人：UI 完成度验收审查员（Finish-Gate）
> 依据：`apps/web/docs/layout-overhaul-plan.md` §5 验收清单（17 条 checkbox；移动端第 3 条含"网格 2 列"+"全站无水平滚动"两个子条款，按 18 项计）
> 方法：代码级审查 —— `Files.vue`（3799 行，模板 + scoped CSS 全量）、`glass.css`（1447 行全量）、`App.vue`（1247 行全量）；git diff 核对隔离性；关键布局尺寸按 CSS 规则逐像素核算。
> 范围限制：本验收为**代码级**结论，未做浏览器运行时验证（委托范围无浏览器/后端）。运行时项（对比度实测、scrollWidth 实测、功能回归点击）在 T7 修复后需补一轮 Playwright 验证。

---

## 1. 产品透镜（验收基准）

- **用户 + 任务**：NebulaDrive 云存储用户，跨存储浏览/管理文件（查看、排序、上传、共享）。
- **首读对象**：文件区（grid/list/photo）+ 行 2 工具栏控件；路径上下文（面包屑）与配额状态为第一层信息。
- **主操作**：视图切换 / 排序 / 上传 / 新建 —— 这些按钮在任何断点都必须可达。
- **密度决策**：玻璃拟态 + 每主题 `--card-*`/`--toolbar-h*` 变量驱动；桌面平衡密度，移动端收敛为 [搜索][⋯]。
- **既有约束**：不新增后端 API、不改业务逻辑、单 DOM 骨架（plan §1 原则）。

---

## 2. §5 十八项逐项结论

| # | 验收项 | 结论 | 证据（文件:行） |
|---|--------|------|-----------------|
| 1 | 桌面≥1200：两行工具栏（行1 面包屑深层"…/父/当前"不撑爆；行2 右对齐无意外折行） | ⚠️ | 行1/行2 结构 ✅（Files.vue:1516–1530, 2627–2639）；面包屑 CSS 裁剪保留末 2 级 ✅（2644–2660）；行2 `margin-left:auto` 右对齐 ✅（2669–2675）。**但**：(a) 无字面"…"省略号，深层路径只显示"父/当前"，用户无法感知前级被裁（见 F3）；(b) 1200–1225px 区间行2 右端被裁 0–26px（⋯ 按钮局部不可见）；(c) **768–1225px 整段行2 溢出**（见 F0 Blocker） |
| 2 | 侧栏 240px：我的文件/最近/共享/回收站可点击 + 底部存储条 = usageTotal/quota | ⚠️ | 导航 4 项齐全且为路由链接（App.vue:189–198，perm 门控）✅；存储条 = `/storages` used 之和 / quota，与 Files.vue 同源（App.vue:24–28, 309–312, 481–487）✅。**但** `.aside{width:236px}` 硬编码（App.vue:744–745）：规格要求 240px 且经 `--sidebar-width` 变量（spec §2），偏差 4px 且无变量（见 F4） |
| 3 | 统计条 1 行：配额/总量/文件数/本周趋势可见 | ✅ | 非 dashboard 全主题 `.stats-strip` 1 行（Files.vue:1475–1511）：配额（含进度槽 + ≥80% 变红 warn）/总量/文件数/本周（趋势 chip）；≥768px flex 单行（2393–2399）；dashboard 保留大 4 卡，同一 `statCards` 数据源（1455–1473, 86–146） |
| 4 | 网格：auto-fill 无水平滚动，gap/radius 各主题一致（无 !important） | ✅ | `.file-grid{repeat(auto-fill,minmax(clamp(150px,18vw,220px),1fr))}`（Files.vue:2916–2923）；gap/pad/radius 全部走 `--card-*` 变量，8 个主题（light-glass/top-nav/dashboard/bento/command/stardust/dawn/flow）各有一套值（glass.css:24–26, 96–98, 125–127, 171–173, 224–226, 693–695, 773–775, 828–830）；stardust/dawn/flow 旧 `!important` 覆盖已删（git diff 确认） |
| 5 | 列表：名称/大小/时间 表头点击排序 + 方向箭头 | ❌ | el-table 三列均无 `sortable`、无 `sort-change` 处理器、无方向箭头（Files.vue:1781 起，grep `sortable\|sort-change` 零命中）；`sortOrder` 恒为 `'asc'` 且无任何 UI 可切换（490 行）；`.sort-order-btn` CSS（2750–2764）为死代码。排序仅能靠工具栏 sort-select 换 sortKey（1555）。**Major（F1）** |
| 6 | 照片视图：仅图片，网格无混入文件卡 | ✅ | `photoEntries` 过滤 `!isDir` + `PHOTO_EXTS` 图片扩展名（Files.vue:1376–1384）；photo-grid 仅渲染图片卡（1861–1872） |
| 7 | Command 主题：最小工具栏（存储/排序/视图）+ ⌘K 面板不变 | ✅ | `.files-command` 隐藏 `.toolbar-search` 与 `.toolbar-actions` 内 el-button/el-dropdown（Files.vue:3403–3414），行2 精确剩 [存储][排序][视图切换]（视图切换是原生 `<button class="vt-btn">` 不受影响，1544–1552）；⌘K cmdk 面板完整（1431–1453, 149–244） |
| 8 | Bento：4列+featured 2×2；≤1199 3列；≤767 2列且 featured/medium 通栏 | ✅ | 基础 2 列 + featured `span 2`（min-h 340）+ medium `span 2`（Files.vue:3317–3399）；≥768 → 3 列 + featured `grid-row:span 2`（2×2）；≥1200 → 4 列。三断点齐全 |
| 9 | 移动<768：侧栏→抽屉（☰ 打开、Esc/点外关闭、body 滚动锁定） | ✅ | ☰（App.vue:566, 1212–1220）打开；`drawerOpen` + Esc keydown（44 行）+ `.drawer-mask` 点击关闭（406 行）；打开时 `body{overflow:hidden}`（48–49 行）；离屏 `translateX(-100%)` → `.drawer-open` 归位（1228–1242） |
| 10 | 搜索→全屏覆盖层 | ✅ | `.mobile-search-overlay` fixed inset:0 z-index:200（Files.vue:1634–1674）；关闭钮 44×44、搜索钮 h44、结果项 min-h 52 |
| 11 | "⋯"更多菜单可触达全部操作（上传/新建/多选/排序） | ✅ | 移动端行2 = [搜索][⋯]（Files.vue:1587–1629）；⋯ ElPopover 含 上传/新建文件夹/多选模式/排序（名称/大小/时间），多选态追加 批量删除/下载/压缩 —— 4 项必达操作全覆盖 |
| 12 | 网格 2 列无溢出 + 全站无水平滚动 | ⚠️ | <768px：auto-fill clamp 在 375px 下实际 2 列（2×150px < ~343px 内容宽），无溢出 ✅；移动端工具栏/覆盖层/抽屉均无固定宽溢出源 ✅。**但** 无显式移动端网格规则：spec §5 要求 `repeat(2,1fr)` + gap 8px + 卡片 padding 12px 10px，实现沿用桌面 gap 14px / pad 18px 14px（见 F5）；768–1225px 的水平滚动问题见 F0 |
| 13 | 全 7 主题：DOM 结构一致，差异仅 CSS 变量 | ✅ | 单一模板骨架，7 布局主题共用同一 DOM；差异 = `--card-*`/`--toolbar-h*`/color/blur/radius/font 变量 + 主题 display 规则（command 隐藏工具栏控件、bento 卡片 class、dashboard stats-bar）；top-nav 为 spec §8 明示的布局变体（无侧栏、顶栏 56px，App.vue:506–562, 652–660），非主题 DOM 分叉 |
| 14 | glass.css 中 grid gap/padding/radius 无 !important | ✅ | glass.css 全文件唯一 `!important` 为 `[data-theme='flow'] .aside.collapsed .ai-panel{display:none!important}`（glass.css:1116）——非 gap/pad/radius；stardust/dawn/flow 的 `.file-grid`/`.file-card` `!important` 覆盖已在本次 diff 删除 |
| 15 | 对比度 ≥4.5:1 + 移动端可点元素 ≥44px | ⚠️ | 44px：搜索钮 h44 / ⋯ 44×44 / mm-item min-h 44 / ms-close 44×44 / ms-go h44 / ms-item min-h 52 ✅；**☰ 按钮 40×40px < 44px**（App.vue:1212–1220，见 F6）。对比度：主文本全主题通过（dashboard #f8fafc/#0f172a ≈17:1、command #e6e8ec/#16181d ≈13:1、bento #1e293b/#fff ≈14:1）；**次级文本边缘**：bento `#64748b` 在页面底 `#f0f4f8` ≈4.35:1（卡面 #fff 上 ≈4.80:1 ✅）；玻璃基线 `rgba(34,40,58,.6)` 在半透明白玻璃上 ≈3.5–4.4:1（既有设计，见 F7） |
| 16 | 功能回归：上传/下载/重命名/移动/复制/共享/协作共享/标签/右键菜单/预览/解压 | ✅（代码级） | 11 项操作全部在代码中：pickFiles(1083) / download(837) / openRename+doRename(689/694) / openMove('move'\|'copy')+doMove(775/782) / openShare(1126) / openCollabShareDialog(32) / openTagDialog(289) / showContextMenu+ctx-menu(378, 2257) / openPreview(998) / doDecompress(1223–1244)；移动端 ⋯ 菜单保留批量删除/下载/压缩。**未做运行时点击验证**（委托范围限制），T7 后需 Playwright 回归 |
| 17 | 视图切换状态持久化（localStorage） | ❌ | `view = ref('grid')`（Files.vue:18）——无 localStorage 读取/写入；全文件 localStorage 仅 `nebula_token`。刷新/重新进入页面视图重置为 grid。**Major（F2）** |
| 18 | 三视图切换无闪烁 + 骨架屏正常 | ✅（代码级） | 三视图 v-if 切换 + `.file-fade-in` 0.35s 淡入（无白闪）；首次加载 8 张骨架卡 + shimmer（1676–1684, 2942–2976）；photo 视图 v-loading。v-if 重建 DOM 属正常重渲染，非闪烁 |

**统计：✅ 12 / ⚠️ 4（项 1、2、12、15）/ ❌ 2（项 5、17）**

---

## 3. 发现清单（按严重级）

### 🔴 Blocker（1）

**F0 — 平板断带 768–1225px：行2 工具栏右端控件簇被裁，需水平滚动才能到达**
（超出 §5 十八项的断点范围，但属 spec §1 一等断点 + plan P1 明确要消灭的故障类，且 1200px 验收线本身受影响）

- **观察**：`.toolbar-row2` 为单行 flex、固定高 48px、无 `flex-wrap`；`.storage-select`(160px, shrink:0) 与 `.toolbar-actions`(shrink:0) 不可收缩；搜索框 `clamp(220px,24vw,360px)` 仅能收缩到 ~194px。行2 自然宽度 ≈ 160 + 220~360 + ~534（视图切换 106 + 排序 110 + 新建 ~100 + 上传 ~95 + ⋯ ~75 + gap 48）+ 24 ≈ **932–1064px**。
- **侧栏布局内容内宽 = 视口 − 314px**（`.layout` padding 28 + gap 14 + `.aside` 236 + `.files-glass` padding 36）。
- **逐点核算**：

  | 视口 | 内容宽 | 行2 需求 | 搜索缩至最小后残余溢出 |
  |------|--------|----------|------------------------|
  | 768px | 454px | ~938px | **~458px**（视图切换/排序/新建/上传/⋯ 全部在屏外） |
  | 1024px（iPad 横屏） | 710px | ~964px | **~202px** |
  | 1199px | 885px | ~1006px | **~27px** |
  | 1200px（验收线） | 886px | ~1006px | **~26px**（⋯ 按钮右端被裁） |
  | 1226px | 912px | ~1012px | 0（搜索全缩） |
  | ≥1355px | ≥1041px | ≤1064px | 无（搜索不缩也放得下） |

  `.main{overflow:auto}`（App.vue:1089–1093）→ 溢出表现为**内容区水平滚动条**，右侧控件簇在首屏外。
- **同区间连带**：`.stats-strip` ≥768px 单行需 ≈730–770px（4 项 + 3 分隔 33px），768px 下溢出 ≈315px，至 ≈1090px 才放下；top-nav 布局（无侧栏，内容宽 = 视口 − 36）同受影响；command 主题行2 仅 ~400px，**不受影响**。
- **为何是 Blocker**：768–1199 是 spec §1 定义的一等断点（侧栏常驻 + 两行工具栏）；该区间内主操作（视图切换/排序/上传/新建）不可达 —— 正是 plan P1"≤1200px 折行不可预测"要消灭的故障，且 1200px 验收线本身裁掉 ⋯ 按钮。
- **修复方向（T7）**：为 768–1199px 增加一条媒体规则，复用移动端已验证的策略：行2 只留 [存储][搜索(可缩)][视图切换]，把 新建/上传/⋯ 收进 ⋯ 菜单（或搜索缩为图标态）；1200–1225px 区间随之消除。
- **验证**：768 / 1024 / 1199 / 1200 / 1226px 视口 × 侧栏布局（含 top-nav）：`.main` 内 `scrollWidth ≤ clientWidth`；⋯ 按钮 `getBoundingClientRect().right ≤ 视口右缘`；stats-strip 无裁切。

### 🟠 Major（2）

**F1 — 列表视图表头排序整体缺失（项 5 ❌）**
- **观察**：el-table 名称/大小/修改时间三列无 `sortable`、无方向箭头；`sortOrder` 恒为 `'asc'`（Files.vue:490），全文件无任何 UI 切换它；`.sort-order-btn` CSS（2750–2764）为死代码。Google Drive/Seafile/FileZilla 参照（plan §2）的"表头点击排序 + 箭头"未落地。
- **修复**：三列加 `:sortable`（或 `sortable="custom"`）+ `@sort-change` 同时更新 `sortKey` 与 `sortOrder` 并 `load()`；表头渲染升/降序箭头（el-table 自带 caret 或自定义）；删除 `.sort-order-btn` 死 CSS 或改为真实控件。
- **验证**：1440px 列表视图，点击"名称/大小/修改时间"表头：列表按该列重排 + 箭头出现；再次点击切换 asc/desc 两个方向均可达；与工具栏 sort-select 状态一致。

**F2 — 视图切换状态无持久化（项 17 ❌）**
- **观察**：`view = ref<'grid'|'list'|'photo'>('grid')`（Files.vue:18），无 localStorage 读写；刷新后重置为 grid。
- **修复**：初始化读 `localStorage`（建议 key `nebula_view`，校验值 ∈ {grid,list,photo}，非法回退 grid）；`view` 变更时写入（`watch` 或视图按钮点击处）。
- **验证**：切到 list → 刷新页面 → 仍为 list（1440px 与 375px 各一次）；写入非法值 → 回退 grid 不报错。

### 🟡 Minor（5）

**F3 — 面包屑深层截断无"…"省略号（项 1 子条款）**
- **观察**：CSS 裁剪（flex-end + overflow hidden + 项 shrink:0，Files.vue:2644–2660）保留末 2 级、不撑爆 ✅，但被裁的前级无任何指示；spec §3 要求保留"…/父级/当前"（含省略号）。用户无法得知前面还有层级。
- **修复**：`crumbs.length > 2` 时在 el-breadcrumb 前插入一个禁用的 "…" 项（点击可跳回根/父级），或在 `.crumbs` 内以 `::before` 渲染省略号。
- **验证**：≥4 级路径，1440px：行1 显示 "…/父/当前"，无溢出；浅路径（≤2 级）不出现多余省略号。

**F4 — 侧栏宽度 236px 硬编码（项 2 子条款）**
- **观察**：`.aside{width:236px}`（App.vue:744–745）；spec §2 要求 240px 且经 `--sidebar-width` 变量（top-nav 0px）。偏差 4px + 无变量，主题无法覆盖。
- **修复**：glass.css 各主题加 `--sidebar-width`（240px / top-nav 0px），`.aside{width:var(--sidebar-width,240px)}`。
- **验证**：1440px 各主题 `getComputedStyle(.aside).width` = 240px（top-nav 无侧栏）。

**F5 — 移动端网格无显式规则（项 12 子条款）**
- **观察**：<768px 沿用桌面 auto-fill clamp：375px 下实际 2 列 ✅ 无溢出 ✅，但 gap 仍 14px、卡片 padding 仍 18px 14px；spec §5 要求 `repeat(2,1fr)` + gap 8px + 卡片 12px 10px。
- **修复**：`@media (max-width:767px)` 内 `.file-grid{grid-template-columns:repeat(2,1fr);gap:8px}` + `.file-card{padding:12px 10px}`。
- **验证**：375px：2 列、gap 8px、无水平滚动；长文件名不撑破列。

**F6 — ☰ 按钮 40×40px < 44px 热区（项 15 子条款）**
- **观察**：`.menu-open-btn{width:40px;height:40px}`（App.vue:1212–1220）；验收要求移动端可点元素 ≥44px。
- **修复**：改 44×44（或 padding 补足热区）。
- **验证**：375px：`getBoundingClientRect` = 44×44。

**F7 — 次级文本对比度边缘（项 15 子条款）**
- **观察**：主文本全主题 ≥13:1 ✅；次级文本两处边缘：bento `#64748b` 在页面底 `#f0f4f8` ≈4.35:1（卡面 #fff 上 4.80:1 ✅）；玻璃基线 `rgba(34,40,58,.6)` 在半透明白玻璃（彩色渐变底）上 ≈3.5–4.4:1（既有设计，非本次引入）。
- **修复**：bento `--text-secondary` 加深至 `#5c6b82` 级（页面底上 ≥4.5:1）；玻璃基线次级文本改为不透明色或提高不透明度（如 `rgba(34,40,58,0.72)`）。
- **验证**：对两处取色实测对比度 ≥4.5:1（Playwright 截图 + 取色，或 WCAG 公式复核）。

### ⚪ Nit（3）

**F8 — dawn 主题无 `--toolbar-h1/h2` 覆盖**：spec §2 要求 dawn 44/52（更疏朗），实现用默认 40/48（Files.vue:2607–2609 无 `.files-dawn` 规则）。修复：加 `.files-dawn .files-glass{--toolbar-h1:44px;--toolbar-h2:52px}`。验证：dawn 主题 1440px 行高 = 44/52。
**F9 — 基础 `.stats-bar{repeat(3,1fr)}` 死代码**（Files.vue:2349）：实际 4 卡，dashboard 主题覆盖为 `repeat(4,1fr)`（3251–3265）。删除基础 3 列规则或改为 4。
**F10 — max-width/min-width 媒体混用**：spec §1 注记要求统一 min-width 正向断点；实现中 bento/stats 用 min-width ✅，但 dashboard stats-bar（3256/3261）与移动端块（3593）仍用 max-width。功能等价（767/768 边界一致），属清理项。

---

## 4. §5 范围外的计划偏差（不计入十八项，供 T7 决策）

1. **组件化未做**（spec §9 / plan §3.2.8 / T2 产出）：`FilesToolbar.vue`/`FilesSidebar.vue`/`StatsStrip.vue`/`FileGrid.vue`/`FileList.vue` 均不存在，Files.vue 仍为 3799 行单 SFC。功能无影响，但 T2 交付物缺失 —— 建议 PM 决定：T7 一并拆，或正式从计划中移除。
2. **移动端列表视图未转卡片行**（spec §7）：<768px 列表仍是 el-table（横向 3 列 + 操作列），spec 要求"卡片行（名称+大小+时间）"。表格在 375px 下可横向滚动（`.main` 内），未溢出全站但体验未达标。
3. **dashboard/bento/command 三主题视觉重设**在本次未提交 diff 内（dashboard 紫→slate/sky、bento 玻璃→实底白卡、command 去等宽字体），超出布局计划范围（应为前序主题协调工作）；隔离性无违规（见下），对比度结论已按新配色核算。

**隔离性检查 ✅**：git diff 确认仅 3 个文件变更（App.vue / glass.css / Files.vue）。6 个非玻璃主题（minimal/silver/aurora/ink/terminal/sunset）**零改动**；light/dark-glass 仅新增 `--card-*` 变量；stardust/dawn/flow 仅删 `!important` 覆盖 + 加变量。

---

## 5. 总体结论

## **有条件通过（HOLD）**

**12/18 ✅，4/18 ⚠️，2/18 ❌**；另有 1 个 Blocker（平板断带溢出，超出十八项范围但属一等断点主操作不可达）。

桌面 ≥1226px 与移动 <768px 两条战线整体成立：两行工具栏、统计条、网格变量化、bento 三断点、command 最小工具栏、抽屉/全屏搜索/⋯ 菜单、DOM 单骨架 + 变量驱动、glass.css 去 `!important` —— 这些实现到位且可验证。但平板断带（768–1225px）主操作不可达、列表排序与视图持久化两个明确验收项缺失，当前状态**不可发布**。

### PASS 条件（T7 必须完成并复验）

| 级 | 项 | 复验方法 |
|----|----|----------|
| Blocker | F0：768–1199px 行2 收敛（⋯ 菜单化/搜索缩态） | 768/1024/1199/1200px：`.main` 无水平滚动，⋯ 按钮右缘 ≤ 视口 |
| Major | F1：表头排序 + 箭头 | 1440px 列表视图三列点击排序，asc/desc 双向可达 |
| Major | F2：视图持久化 | 切 list → 刷新 → 仍 list（1440 + 375） |
| Minor | F3–F7 | 按各项"验证"栏 |

### 保持（已服务产品、勿回退）

- 两行工具栏 + 面包屑 CSS 裁剪（末 2 级可见、不撑爆）—— Google Drive 模式落地正确。
- 移动端 [搜索][⋯] 收敛 + 全屏搜索覆盖层 + ⋯ 全操作菜单 —— 策略验证有效，F0 修复应**复用**此模式而非另起炉灶。
- `--card-*`/`--toolbar-h*` 变量化 + glass.css 去 `!important` —— 单骨架目标达成，隔离性干净。
- command 主题最小工具栏（原生 button 视图切换幸存于 el-button 隐藏规则）—— 精确且克制。
- 骨架屏 + 淡入 + photo 视图纯图片 —— 状态设计完整。

### 运行时补验（T7 后，Playwright）

本验收为代码级结论；以下项需浏览器实测收尾：F0 的 scrollWidth 实测、F7 对比度取色实测、项 16 功能回归 11 项点击、项 12 全站 scrollWidth ≤ innerWidth（375px）。
