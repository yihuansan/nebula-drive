# NebulaDrive 文件管理页布局规格（T1）

> **一套 DOM 骨架 + 主题变量驱动外观**。3 断点 × 全 9 主题（7 布局主题 + light/dark-glass 玻璃基线）。
> 原则：DOM 结构全主题一致，主题只改 CSS 变量；不新增后端 API、不改业务逻辑。
> 参照：Google Drive（两行工具栏）/ Nextcloud·OneDrive（侧栏 + 存储条）/ Dropbox（hover 快捷操作）。

## 1. 断点（3 档，mobile-first）

| 断点 | 范围 | 选择器 | 关键行为 |
|------|------|--------|----------|
| 移动 | <768px | 基础样式（无 media） | 侧栏→离屏抽屉；搜索→全屏覆盖层；操作→"⋯"菜单；网格 2 列 |
| 平板 | 768–1199px | `@media (min-width:768px)` | 侧栏常驻；bento 3 列；工具栏两行 |
| 桌面 | ≥1200px | `@media (min-width:1200px)` | 侧栏常驻 240px；bento 4 列；网格 auto-fill |

> 现有 `@media (max-width:1199px)/(767px)` 统一改为 min-width 正向断点，消除折行不可预测（P1/P8）。

## 2. CSS 变量表（6 变量 / 主题）

| 主题 | --card-gap | --card-pad | --card-radius | --sidebar-width | --toolbar-h1 | --toolbar-h2 |
|------|-----------|-----------|---------------|-----------------|--------------|--------------|
| light-glass（默认） | 14px | 18px 14px | 18px | 240px | 40px | 48px |
| dark-glass | 14px | 18px 14px | 18px | 240px | 40px | 48px |
| top-nav | 12px | 14px 12px | 8px | 0px | 40px | 44px |
| dashboard | 16px | 16px 20px | 12px | 240px | 40px | 48px |
| bento | 16px | 20px | 16px | 240px | 40px | 48px |
| command | 8px | 10px 16px | 6px | 240px | 36px | 40px |
| stardust | 18px | 22px 16px | 22px | 240px | 40px | 48px |
| dawn | 22px | 26px 18px | 16px | 240px | 44px | 52px |
| flow | 14px | 18px 14px | 18px | 240px | 40px | 48px |

> `--card-gap/--card-pad/--card-radius` 取自 glass.css 现有 `!important` 覆盖值（stardust 18/22 16/22、dawn 22/26 18/16、flow 14/—/18），改为变量后删除 `!important`（P4）。
> `--sidebar-width`：统一 240px（现 236px→240px）；top-nav 无侧栏 = 0px（顶部栏 56px）。
> `--toolbar-h1/h2`：行 1 面包屑高 / 行 2 控件高；command 更紧凑、dawn 更疏朗。

## 3. 两行工具栏（Google Drive 模式）

```
┌──────────────────────────────────────────────────────┐
│ 行1 面包屑：…/父级/当前（flex:1，溢出省略）            │  h = --toolbar-h1
├──────────────────────────────────────────────────────┤
│ 行2 控件：[存储][搜索 220~360px]  [视图][排序][上传][新建]│  h = --toolbar-h2（右对齐）
└──────────────────────────────────────────────────────┘
```

- **行 1**（`.toolbar-row1`）：`display:flex; align-items:center; height:var(--toolbar-h1)`；`el-breadcrumb` `flex:1; min-width:0`，深层截断为"…/父级/当前"（保留末 2 级 + 省略号），不撑爆（P2）。
- **行 2**（`.toolbar-row2`）：`display:flex; align-items:center; gap:12px; height:var(--toolbar-h2)`；左侧 `.storage-select`（宽 160px）+ `.toolbar-search` `width:clamp(220px,24vw,360px)`；右侧 `.toolbar-actions` `margin-left:auto`（视图切换 + 排序 + 上传 + 新建）。
- **窄屏（<768px）**：搜索优先保宽（`flex:0 0 auto`），操作按钮收进"⋯"更多菜单（ElPopover），仅留 `[搜索][⋯]`。

## 4. 侧栏（Nextcloud/OneDrive 模式）

- **宽度**：`width:var(--sidebar-width)`（桌面/平板常驻）；折叠 78px 保留。
- **导航项**（`.menu`）：我的文件 / 最近 / 共享 / 回收站（路由存在则直链，否则 disabled 占位）+ 现有菜单。
- **底部存储进度条**（`.aside-storage`）：复用 `usageTotal/quota`；`height:6px` 进度条 + "已用 X / 配额 Y"；全主题可见（现仅 dashboard，P3）。
- **移动端（<768px）**：离屏抽屉 —— `.aside` `position:fixed; left:0; transform:translateX(-100%)`，☰（header 左）打开 → `translateX(0)`；Esc / 点遮罩外关闭；打开时 `body{overflow:hidden}` 锁滚动。

## 5. 网格

- **桌面/平板**：`.file-grid{ display:grid; grid-template-columns:repeat(auto-fill, minmax(clamp(150px,18vw,220px),1fr)); gap:var(--card-gap) }`（P4）。
- **卡片**：`.file-card{ border-radius:var(--card-radius); padding:var(--card-pad) }`（替代 glass.css `!important`）。
- **移动端（<768px）**：`grid-template-columns:repeat(2,1fr)`，`gap:8px`；卡片内边距降为 `12px 10px`。

## 6. Bento（仅 bento 主题内容区）

| 断点 | 列数 | featured | medium |
|------|------|----------|--------|
| ≥1200px | 4 列 | span 2×2（min-h 340px） | span 2 |
| 768–1199px | 3 列 | span 2×2 | span 2 |
| <767px | 2 列 | 通栏 span 2 | 通栏 span 2 |

> 现 ≤767px 直接 2 列，补 768–1199px → 3 列中间断点（P5）。

## 7. 移动端（<768px）汇总

| 区域 | 桌面/平板 | 移动 |
|------|----------|------|
| 侧栏 | 常驻 240px | 离屏抽屉（☰ 开，Esc/点外关，锁 body 滚动） |
| 搜索 | 行 2 内 220~360px | 全屏覆盖层（顶栏 + 输入 + 结果列表） |
| 操作 | 行 2 按钮 | "⋯" 更多菜单（ElPopover：上传/新建/多选/排序） |
| 网格 | auto-fill | 2 列 |
| 列表视图 | 表头排序 | 卡片行（名称 + 大小 + 时间） |

## 8. 特殊主题

- **command**：最小工具栏（存储切换 + 排序 + 视图切换，行 2 精简），⌘K 面板不变（P6）；文件区默认列表行（gap 2px）。
- **top-nav**：唯一布局变体 —— 顶部栏 56px（无侧栏，`--sidebar-width:0`）；内容区同 §3/§5 规格；`.files-glass{border-radius:0;margin:0;padding:16px}` 统一（P9）。
- **dashboard**：统计区保留大 4 卡（`repeat(4,1fr)`，≤1199→2，≤767→1），与紧凑统计条共用 `usageTotal/quota` 数据源（P3）。

## 9. 组件拆分（T2~T5 基线）

`FilesToolbar.vue`（两行工具栏 + 面包屑溢出）/ `FilesSidebar.vue`（导航 + 存储条 + 抽屉）/ `StatsStrip.vue`（紧凑条 + dashboard 大卡）/ `FileGrid.vue` / `FileList.vue`；script 逻辑留 Files.vue，props/emits 通信。

## 10. 验收锚点（QA）

- 桌面：两行工具栏无折行；侧栏 240px + 存储条 = usageTotal/quota；网格 auto-fill 无水平滚动。
- 移动：抽屉 / 全屏搜索 / ⋯ 菜单可达全部操作；网格 2 列；`scrollWidth ≤ innerWidth` 无水平滚动。
- 全主题：DOM 一致，差异仅变量；glass.css 无 `!important`（gap/pad/radius）；对比度 ≥4.5:1；移动端可点元素 ≥44px。
