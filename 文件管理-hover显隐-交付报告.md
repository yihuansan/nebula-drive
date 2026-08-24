# 文件管理「操作按钮 hover 才显示」— 交付报告

## 一、任务
把 NebulaDrive **文件管理**（`apps/web/src/views/Files.vue`）里的功能图标 / 操作按钮，从**始终可见**改为**默认隐藏、鼠标悬停时才淡入显示**，移开则淡出。

> 目标确认：改的是**网盘项目**（`D:\项目\cloud网盘系统`）的文件管理，**不是** DSH Desktop。

## 二、改动（仅 1 个文件：`apps/web/src/views/Files.vue`）

| 项 | 位置 | 改动 |
|---|---|---|
| **网格视图 grid** | CSS `.fc-actions`（3168 行） | `opacity: 0.55` → **`opacity: 0`**（默认隐藏）；保留 `.file-card:hover / .selected → opacity:1`（悬停/选中淡入）+ `transition: opacity 0.2s` |
| **列表视图 list** | 模板 1892 行 + CSS 3186 行 | 给"操作"列加统一包裹 `<div class="row-actions-wrap">`（收藏 + 文件夹分支 + 文件分支全包进去）；CSS 默认 `opacity:0`，`.file-table :deep(.el-table__row:hover) → opacity:1` |
| **触屏降级** | CSS 3194 行 | `@media (hover: none)`：触屏设备上 `.fc-actions` 与 `.row-actions-wrap` **保持常显**（否则手机/平板丢失全部文件操作入口） |

**未改动（按 PM 勘察确认）**：
- **照片视图 photo**：本就没有操作按钮（纯图片画廊，hover 显示文件名 overlay 已是隐藏→显示），**零改动**。
- **bento 布局**：无 `.fc-actions` 覆盖，自动继承新规则（hover 淡入）。
- **command 布局**：`.files-command .fc-actions { display:none }` 优先级高于 opacity，不受影响（⌘K 命令面板仍是唯一入口）。
- **搜索区块第二个表格**（width=90 "打开"列）：选择器限定在 `.file-table` 内，**未误伤**。

## 三、验证结果

| 验证 | 结果 |
|---|---|
| **源码核对**（我逐行 read 确认） | ✅ `.fc-actions{opacity:0}`、`.file-card:hover/.selected→1`、`.row-actions-wrap{opacity:0}`、`.file-table:deep(.el-table__row:hover)→1`、`@media(hover:none)→1` 全部就位；`row-actions-wrap` 包裹 div 正确包住收藏+两分支，`v-if/v-else` 关系未破坏 |
| **前端构建** `pnpm build:web` | ✅ **零错误**（vite 5.4.21，1666 模块，3.21s）；stderr 仅两条与本改动无关的既有告警（Windows 网络探测 + 第三方 `@vueuse/core` PURE 注释） |
| **编译产物 CSS**（前端专家核对 dist） | ✅ `Files-*.css` 中 `.file-table[data-v-…] .el-table__row:hover .row-actions-wrap{opacity:1}` 与 `@media(hover:none){.fc-actions,.row-actions-wrap{opacity:1}}` 均正确生成 —— `:deep()` 按预期把 scope id 挂在 `.file-table` 上、行与包裹层不 scoped，选择器可命中 |
| **浏览器 hover 实测** | ⚠️ **本机 Chrome headless 无法启动**（`icu_util.cc: Invalid file descriptor to ICU data`，系统级 Chrome 安装问题，与本改动无关）。已用 CDP 脚本 + DSH 截图工具两种方式尝试，均因该 Chrome 故障失败 |

## 四、为什么可以交付（风险极低）
1. **纯 CSS opacity 改动**，未用 `display:none` / `visibility` → 卡片高度/行高/列宽占位全部不变，**无布局跳动**。
2. **`:hover` 是标准 CSS 伪类**，Element Plus 表格行 DOM 为 `.el-table__row`（EP 标准结构），命中可靠。
3. **构建 + 编译产物双重确认** CSS 选择器正确（含 scoped `:deep` 穿透）。
4. 唯一未做的是"浏览器里真实 hover 一下"——因本机 Chrome 故障无法自动执行；**你本机 Chrome 正常，跑起来即可见效果**。

## 五、你如何验收（30 秒）
```bash
cd D:\项目\cloud网盘系统
pnpm dev:web
```
打开文件管理页：
- **网格视图**：鼠标移到文件卡片上 → 操作按钮（预览/下载/删除/…）淡入；移开 → 淡出。选中卡片时按钮保持可见。
- **列表视图**：鼠标移到某一行 → 右侧"操作"列淡入；移开 → 淡出。
- **手机/平板**：按钮常显（`hover:none` 降级）。
- 右键菜单、多选、⌘K 命令面板、各按钮点击均正常。

## 六、改动文件
- `apps/web/src/views/Files.vue`（模板 + scoped CSS）
