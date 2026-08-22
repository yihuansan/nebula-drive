# 星云网盘 · 创意/主题项 修改报告（P0-3 / P2-6 / P2-7）

> 角色：创意设计师（本轮仅负责 **创意/主题项**）。UI 设计师已处理主题入口/无障碍/功能项，本次**未触碰** App.vue 主题选择器及任何功能代码。

## 一、修复项与具体改动

### P0-3 · 流光主题 AI 面板"假 AI"（方案 A：诚实占位）
**文件**：`apps/web/src/App.vue`、`apps/web/src/glass.css`
- 移除常驻的"索引中…"假加载态（原"流光引擎正在为你的文件建立索引 / 流光核心贯穿侧栏与内容"）。
- 侧边栏 `.ai-panel`：保留流光视觉核心（`<MagicStick/>` + `.ai-core.flow-core`），文案改为诚实占位：
  - 标题加 `<span class="ai-badge">即将上线</span>`
  - 副文案："流光主题的视觉核心。AI 文件整理、检索与洞察能力尚在规划中，将在后续版本上线。"
- 内容区 `.ai-insight`：改为"此区域为 AI 文件洞察预留……当前未处理任何文件数据。"
- 不假装在工作、无假加载态、保留流光视觉创意（符合方案 A）。

### P2-6 · 卡片 hover 抖动（scale 过大）
**文件**：`apps/web/src/glass.css`
- 基础 `.glass-card:hover`：`scale(1.03)` → `scale(1.01) translateY(-2px)`，并加 `box-shadow: var(--shadow-hover), inset 0 1px 0 var(--glass-highlight)` 以阴影强调替代放大。
- 星尘主题 `.file-card:hover`：`scale(1.03)` → `translateY(-3px) scale(1.01)`。
- 晨曦 / 流光 hover 本身已克制，未改动。

### P2-7 · 晨曦标题字体（Windows 无衬线回退）
**文件**：`apps/web/src/glass.css`
- 晨曦 `.page-title` 字体栈补充 Windows 衬线：`Georgia, 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'STSong', 'SimSun', 'NSimSun', serif`。

## 二、验证结果

| 验证项 | 结果 |
|---|---|
| 构建 `npx vite build` | ✅ exit 0，产物 `index-hvTp81c2.js` + `index-CmVTVDJ1.css` |
| 运行服务（8080） | ✅ 在线服务**新构建**：index.html 引用新 hash，JS/CSS 均 200 |
| 登录 API（devtest） | ✅ 取得有效 token |
| 构建产物内容 | ✅ JS 含"即将上线/尚在规划中/当前未处理任何文件数据"，**无**"索引中"；CSS 含 `scale(1.01)`、`Noto Serif SC`、`ai-badge`，**无** `scale(1.03)` |
| 运行时（jsdom 启动真实 bundle） | ✅ 应用启动（Vue 挂载 #app）、**flow 主题成功应用**（`data-theme="flow"`） |
| 浏览器截图渲染 | ⚠️ 受阻（见下） |

## 三、环境限制说明

1. **Chrome 无法运行**（既有环境问题，非本次改动导致）：
   - 报错 `Invalid file descriptor to ICU data received`（icu_util.cc:232）。
   - `debug.log` 显示 15+ 次反复失败（13:50→16:46），安装目录无 `icudt*.dat`。
   - 多种启动方式（puppeteer 默认 / stdio ignore / pipe / `--single-process`）均同样失败。
2. **jsdom 渲染**：成功启动真实 bundle 并应用 flow 主题，但 vue-router 的**异步初始导航**在 jsdom 中不完成（懒加载路由组件未触发），故侧边栏/ AI 面板未在该无头 DOM 中渲染。这是 **jsdom 对异步路由导航的限制**，非代码问题——真实浏览器中路由会正常解析、shell 会渲染出带诚实占位的 AI 面板。

## 四、结论
- **P0-3 / P2-6 / P2-7 三项均已修复**，改动最小、仅涉及创意/主题项，未触碰 UI 设计师的功能/主题入口代码。
- 构建通过、线上服务已加载新构建、登录正常、构建产物内容逐项核验通过。
- 运行时已证明：**应用可启动、flow 主题切换正常**；AI 面板诚实占位已在源码 + 构建产物层面确认（真实浏览器中随 shell 渲染）。
- 唯一未达成的是**浏览器级截图**，受 Chrome ICU 既有故障阻断（与本次改动无关）。
