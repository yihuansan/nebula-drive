# NebulaDrive Desktop 客户端部署测试 + BUG/安全审查计划

> 范围：`apps/desktop`（Tauri v2 + Vue3）。Server（`apps/server`，Fastify :8080）作为依赖环境。
> 本计划由 PM 代码走查产出；T3/T4 专家须先复现确认基线问题，再补充新发现。

## 1. 架构与现状（代码走查结论）

- **调用链**：Vue3/ElementPlus(webview) → Rust `invoke` 命令 → node 子进程 `apps/sync/dist/cli.js` → Server API（/api/v1/...，SQLite）
- **状态库**：`%APPDATA%\com.nebula.desktop\sync\nebula-sync.db`（node:sqlite；token/auth **明文**存储）
- **构建物**：`dist/`（前端已构建）、`src-tauri/target/debug/nebula-desktop.exe`（debug 已构建，可直接运行）
- **依赖**：npm（vue / element-plus / @tauri-apps/api / vite / typescript）+ Rust（tauri v2 tray-icon / serde）——数量少，无已知高危
- **权限**：capabilities 仅 `core:default`（最小化，合格）；**CSP 为 null**（需修，见 S4）

## 2. 部署方案（T1）

前置：Server 启动 `cd apps/server && pnpm start`（:8080，首次自动建库+种子 admin）；node 在 PATH。

| 方式 | 命令 | 说明 |
|---|---|---|
| debug exe | `.\apps\desktop\src-tauri\target\debug\nebula-desktop.exe` | 直接运行；自动定位 node.exe 与 `apps/sync/dist/cli.js` |
| dev | `cd apps/desktop && pnpm tauri dev` | vite :5199（strictPort）+ Tauri 热重载 |
| release | `cd apps/desktop && pnpm tauri build` | NSIS 安装包，验证 bundle 链路 |

验收：窗口打开无白屏/崩溃；登录→建对→同步全链路通（F1+F3+F4）。

## 3. 功能测试用例（T2）

| # | 用例 | 验收标准 |
|---|---|---|
| F1 | 登录（admin/正确密码，http://127.0.0.1:8080） | 提示"令牌已保存"，nebula-sync.db 出现 auth 记录 |
| F2 | 登录失败（错密码 / Server 未启动） | 友好报错，不崩溃，可重试 |
| F3 | 创建同步对（storage 1、/sync、two-way） | pair 出现在表格，本地目录生成（默认 %APPDATA%\...\NebulaDrive） |
| F4 | 手动同步一次 | 本地文件与远端一致，日志显示统计（拉取/推送/冲突） |
| F5 | 启动/停止监听（按钮 + 托盘菜单） | 日志流实时刷新；停止后 node 进程确实退出 |
| F6 | 删除任务 | 本地删除成功，列表/状态刷新一致 |
| F7 | 应用重启 | 任务列表/状态恢复；**无残留 node 进程**（关联 B1） |
| F8 | 异常路径：未登录建对、空字段、非法 storageId | 报错不崩溃，无脏状态 |

## 4. BUG / 安全基线（走查已发现，T3/T4 复现确认）

**BUG**
- B1(Major) 应用退出后 node 监听子进程不杀，成孤儿持续后台同步（main.rs `do_start_watch` 无退出清理）
- B2(Major) `run_cli` 无超时，Server 无响应时 UI 永久 loading（main.rs:73-98）
- B3(Minor) 创建同步对非事务：`create_pair` 成功但 `add_pair` 失败时服务端 pair 残留（App.vue `doCreatePair`）
- B4(Minor) Mutex 中毒后 start/stop 永久失效，须重启应用（main.rs `AppState`）
- B5(Minor) storageId 空/非数字时 `Number()` → NaN 直传 CLI（App.vue:192）

**安全**
- S1(High) 登录密码经 node 子进程 argv 明文传递，Windows 进程列表可见（main.rs:101-105）
- S2(High) 同步 token 同样经 argv 明文传递（main.rs `add_pair`:143-169）
- S3(High) token/auth 明文存 SQLite（nebula-sync.db），无加密、无权限收紧
- S4(High) `tauri.conf.json` `security.csp: null`，webview 无 CSP
- S5(Medium) 服务器 URL 无 https 校验，token 可经明文 http 传输（cli.js SyncClient）
- S6(Medium) `find_node` 扫描 PATH 首个 node.exe，可被恶意 PATH 劫持执行代码（main.rs:18-35）
- S7(Low) `default_local_dir` 的 name 可含 `..\` 越出 app_data 目录（main.rs:204-210）
- S8(Low) `list_pairs` 将 token 回传 webview JS 堆（cli.js state.ts:89-94）

## 5. 任务分解与分工

| 任务 | 专家 | 内容 | 依赖 | 交付 |
|---|---|---|---|---|
| T1 部署 | 部署工程师 | 按 §2 起 Server + Desktop(debug)，验证全链路可跑 | — | 部署记录 + 截图 |
| T2 功能测试 | 测试工程师 | 执行 §3 F1–F8，记录结果 | T1 | 测试报告（用例×结果×截图） |
| T3 BUG 排查 | Rust/Vue 工程师 | 复核 §4 B1–B5，补充代码审查新发现，给出复现步骤 | T2 | BUG 清单（复现+定位+严重度） |
| T4 安全审查 | 安全工程师 | 复核 §4 S1–S8：Tauri 权限/CSP、Rust 进程与凭据、前端安全、依赖审计（`pnpm audit` + `cargo audit`） | T2 | 安全报告（严重度+修复方案） |
| T5 修复 | Rust/Vue 工程师 | 修 B1/B2（Major）+ S1–S6（High/Medium）；S7/S8 记录为已知项；改后重编 debug exe 并自测 | T3+T4 | 修复提交 + 自测记录 |
| T6 验收 | 测试 + 安全 | 回归 F1–F8 + 复验已修项；出具放行结论 | T5 | 验收报告 |

规则：无 Blocker/Major 未修不放行；每任务按 30–60 min 粒度可拆分。

## 6. 验收标准（总）

1. Desktop 正常启动（debug exe 与 release 安装包均验证）
2. F1–F8 全部通过（登录/建对/同步/监听/删除/重启/异常路径）
3. 无 Blocker/Major BUG 遗留（B1、B2 必须修复）
4. 安全：S1/S2 凭据不再走 argv（改 stdin 或 env）、S4 启用严格 CSP、S3 至少收紧 db 文件权限并文档化（DPAPI 加密列为后续项）、S5/S6 修复；Tauri 权限保持最小化（不新增 capability）
5. 交付物：测试报告 + 安全报告 + 修复提交，全部合并到 master
