# NebulaDrive 星云网盘 v0.2.0 更新说明

本次为一次大版本更新：新增 3 套创意主题 + UI 大改版 + 安全加固 + 2FA / 会话管理 / 分享协作 / 快捷访问 / 转存等全新功能。

---

## 🎨 全新创意主题（3 套，构成 9 主题系统）

新增 3 套 2026 趋势创意主题，与现有 6 套（light-glass / dark-glass / top-nav / dashboard / bento / command）构成 **9 主题系统**：

- **🌌 星尘 Stardust**：液态玻璃 + 空间 3D 纵深。悬浮玻璃岛侧栏、星光发光、三级空间层次，深空底色 + 漂浮光斑动画。
- **🌅 晨曦 Dawn**：自然有机 + 尊重注意力。暖白纸面、大留白、去玻璃化，柔和晨光色调，衬线标题字体。
- **🌊 流光 Flow**：AI 原生 + 动态渐变。流光核心贯穿全局、Bento 内容区、AI 助手 / AI 洞察常驻面板（视觉核心，AI 能力规划中）。

## 🖥️ UI 大改版

- **9 套主题布局 / 视觉全面升级**，各主题风格清晰可辨（侧栏 / 顶部导航 / Bento / 仪表盘 / 流光多布局）。
- **终端用户主题切换入口**：header 新增主题选择器（9 主题下拉），此前新主题对普通用户完全不可达。
- **Files 工具栏高频 / 低频分离**：高频操作（存储 / 面包屑 / 搜索 / 视图 / 新建文件夹 / 上传）常驻，低频操作（排序 / 标签筛选 / 刷新 / 多选）收入「更多」下拉。
- **常驻搜索框**：工具栏直接搜索，高级筛选（类型 / 大小 / 时间）保留在全局搜索对话框。
- **卡片操作常显**：文件卡片操作图标 `opacity 0.55` 常驻可见（原 hover-only，发现性差）。
- **快捷访问真实入口**：文件 / 文件夹右键「添加到快捷访问 / 从快捷访问移除」+ 卡片下拉。

## 🔐 安全加固（4 项阻断级 + 多项建议级）

- **路径穿越漏洞修复**（`files.routes.ts` 5 处）：新增 `safeStoragePath` 守卫，批量下载 / 压缩 / 解压 / meta / archive-list 全部拦截任意文件读 / 写。
- **IDOR 越权修复**：subscriptions / transfers 的 GET 加 `user_id` 过滤（原任何用户可见所有人数据）。
- **`%` 文件名 500 修复**：quick-access 路由双重 `decodeURIComponent` 导致 `URIError`。
- **`/storages` 普通用户 403 修复**：权限过严（`storages:view`）导致普通用户整个存储页打不开，改为登录即可（admin 看全部，其他用户看已启用）。
- **quick-access 路由 404 修复**：路由未注册 + 前端菜单不同步。
- **遗留主题主按钮透明修复**：aurora / ink / sunset 补 `--accent-2` 变量。

## 🚀 新增功能

### 双因素认证（2FA / TOTP）
- 启用 / 验证 / 禁用 2FA（QR 码扫码，otpauth + qrcode）。
- 恢复码（10 个一次性，用后自动移除）。
- 登录时 TOTP / 恢复码双通道验证。

### 会话管理
- 查看所有登录会话（设备名 / IP / 创建时间 / 最后活跃 / 是否当前）。
- 撤销指定会话（使该设备 token 失效）。
- 一键撤销其他所有会话（保留当前）。

### 分享协作
- 内部共享（创建者 / 接收者双视角）。
- 权限分级：`view` / `download` / `manage`。
- 接收者管理（添加 / 移除 / 改权限）。
- 活动记录（查看 / 下载行为留痕）。
- 过期时间。

### 转存分享
- 转存 dialog（替代 `window.prompt`）。
- 链接校验（http / https）。
- 目标目录选择 + 结果 / 错误提示 + loading 态。

## 🐛 Bug 修复

- **Flow AI 面板诚实占位**：去掉假「索引中」加载态，改为「即将上线」badge + 「AI 能力尚在规划中」（不再假装在处理文件数据）。
- **Recent 徽章主题变量**：原白色硬编码 `rgba(255,255,255,0.5)`，深色主题刺眼，改为 `var(--glass-bg)` 等主题变量。
- **卡片 hover scale 降低**：`scale(1.03)` → `scale(1.01) translateY(-2px)`，减少 hover 抖动 / 视觉溢出。
- **Dawn 字体栈补全**：补 Windows 衬线字体（Noto Serif SC / Source Han Serif SC / SimSun / NSimSun）。
- **转存时间差 8 小时**：SQLite UTC 时间戳直接当本地显示，补 `'Z'` + `toLocaleString('zh-CN')`。
- **quick-access GET 字段修正**：改 camelCase + 补 size + 孤儿行清理。

---

## 📦 升级说明

- 全量升级包：`nebula-drive-v0.2.0.zip`（含 `server/` 后端构建 + `web/` 前端构建 + `root-package.json` + `server-package.json`）。
- 升级方式：解压覆盖 `server/` 与 `web/` 目录，重启服务即可。
- 数据库：本次新增 `user_2fa`、`sessions`、`share_*` 等表，服务启动时自动建表（schema 已含），无需手动迁移。
