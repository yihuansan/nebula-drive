# NebulaDrive Desktop 修复报告

> Tauri v2 (2.11.5) + Vue3 桌面客户端：修复 2 个 Major BUG + 4 个安全项
> 仅改动 3 个文件：`apps/desktop/src-tauri/src/main.rs`、`apps/desktop/src-tauri/tauri.conf.json`、`apps/sync/src/cli.ts`
> 未改 App.vue / glass.css / server；未新增 Tauri capability；保留中文注释风格。

---

## 一、概览

| 编号 | 级别 | 问题 | 修复位置 | 验证 |
|------|------|------|----------|------|
| B1 | Major | node watch 子进程在应用退出时孤儿化 | main.rs | 代码 + 编译 |
| B2 | Major | run_cli 无超时，Server 挂起→UI 永久 loading | main.rs | **独立 Rust 实测 30.052s** |
| S1 | High | 登录密码出现在 argv | main.rs + cli.ts | **全链路实测** |
| S2 | High | 同步 token 出现在 argv | main.rs + cli.ts | **全链路实测** |
| S4 | High | tauri.conf.json `security.csp: null` | tauri.conf.json | 配置校验 |
| S6 | Medium | find_node 扫描 PATH（可被劫持） | main.rs | 代码 + 编译 |

---

## 二、逐项修复（diff）

### B1 (Major) — node watch 子进程孤儿化

**问题**：应用退出时 `AppState.watch` 里的 node 监听子进程未被 kill，成为孤儿在后台继续同步。

**修复**：`.build(...)` 后接 `.run(|app_handle, event| …)`，在 `RunEvent::Exit` 时调用 `kill_watch_on_exit`；锁 poisoned Mutex 用 `unwrap_or_else(|e| e.into_inner())` 兜底。

```rust
// main.rs — main()
.build(tauri::generate_context!)
.expect("error while building NebulaDrive desktop")
// B1: 应用退出（RunEvent::Exit）时 kill 掉 node 监听子进程，避免孤儿进程在后台继续同步
.run(|app_handle, event| {
    if let tauri::RunEvent::Exit = event {
        kill_watch_on_exit(app_handle);
    }
})

// main.rs — kill_watch_on_exit
fn kill_watch_on_exit(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let mut guard = state.watch.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *guard = None;
}
```

> 注：Tauri v2 的 `Builder` 没有 `on_exit` 方法；`.run(callback)` 是真实入口，`RunEvent::Exit` 为退出事件。

---

### B2 (Major) — run_cli 无超时

**问题**：`run_cli` 无超时，Server 无响应时 UI 永久 loading。

**修复**：`try_wait()` 轮询 + 30s deadline；到点未退出则 `kill` + `wait` 子进程并返回超时错误。

```rust
// main.rs — run_cli（节选）
let deadline = Instant::now() + Duration::from_secs(30);
let mut status = None;
loop {
    match child.try_wait() {
        Ok(Some(s)) => { status = Some(s); break; }          // 已退出并回收
        Ok(None) => {
            if Instant::now() >= deadline { break; }          // 超时
            std::thread::sleep(Duration::from_millis(50));
        }
        Err(e) => return Err(format!("等待同步引擎失败: {e}")),
    }
}
if status.is_none() {
    let _ = child.kill();
    let _ = child.wait();
    let _ = stdout_task.join();
    let _ = stderr_task.join();
    return Err("同步引擎执行超时（30s）：服务器可能无响应，请稍后重试".into());
}
```

> **偏差说明**：未用 `wait-timeout` crate（环境网络受限、无法拉取依赖），改用 std 的 `try_wait()` 轮询实现等价的 30s 超时，零额外依赖。

---

### S1 (High) — 登录密码出现在 argv

**问题**：密码作为命令行参数传递，Windows 进程列表（`tasklist`/WMI）可见。

**修复**：密码改走 `NEBULA_PASSWORD` 环境变量；cli.ts `login` 的 password 位置参数改为可选，优先读 env，argv 兜底。

```rust
// main.rs — login
let env = vec![("NEBULA_PASSWORD".to_string(), password)];
run_cli(&sd, &["login".into(), url, username], false, &env)?;   // 密码不再进 argv
```

```typescript
// cli.ts — login
.command('login <url> <username> [password]', '登录')
.action((url, username, password) => {
  const pw = process.env.NEBULA_PASSWORD || password;  // env 优先，argv 兜底
  ...
});
```

---

### S2 (High) — 同步 token 出现在 argv

**问题**：同步 token 作为 `--token` 参数传递，进程列表可见。

**修复**：token 改走 `NEBULA_TOKEN` 环境变量；cli.ts `add` 优先读 env，`--token` 兜底。

```rust
// main.rs — add_pair
let env = vec![("NEBULA_TOKEN".to_string(), token)];
run_cli(&sd, &args, false, &env)?;   // token 不再进 argv
```

```typescript
// cli.ts — add
.command('add <name> --token <token> --dir <dir> [--mode] [--url]', '添加同步任务')
.action((name, opts) => {
  const token = process.env.NEBULA_TOKEN || opts.token;  // env 优先，--token 兜底
  ...
});
```

---

### S4 (High) — CSP 为 null

**问题**：`tauri.conf.json` 的 `security.csp` 为 `null`，无内容安全策略。

**修复**：设置严格 CSP（桌面端仅经 Tauri IPC 与 server 通信，`connect-src` 为安全网）。

```json
// tauri.conf.json
"security": {
  "csp": {
    "default-src": ["'self'"],
    "connect-src": ["'self'", "http://127.0.0.1:8080"],
    "img-src": ["'self'", "data:"],
    "style-src": ["'self'", "'unsafe-inline'"]
  }
}
```

---

### S6 (Medium) — find_node 扫描 PATH（可被劫持）

**问题**：`find_node` 直接扫 PATH 找 node.exe，PATH 可被恶意条目劫持。

**修复**：解析顺序改为 `NEBULA_NODE`（显式，最可信）→ 官方默认路径 → PATH 扫描（带告警，仅兜底）。

```rust
// main.rs — find_node
fn find_node() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("NEBULA_NODE") {
        return Ok(PathBuf::from(p));
    }
    let known = PathBuf::from(r"C:\Program Files\nodejs\node.exe");
    if known.is_file() {
        return Ok(known);
    }
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(';') {
            let cand = Path::new(dir).join("node.exe");
            if cand.is_file() {
                eprintln!("[安全警告] 从 PATH 扫描命中 node.exe：{}（PATH 可被劫持，建议显式设置 NEBULA_NODE）", cand.display());
                return Ok(cand);
            }
        }
    }
    Err("未找到 node.exe：请安装 Node.js 或设置 NEBULA_NODE 环境变量".into())
}
```

---

## 三、自测结果（全链路）

测试用户 `synctest`/`synctest123`（临时创建，admin），storage id=1（本地存储）。

| # | 步骤 | 命令 / 条件 | 结果 |
|---|------|-------------|------|
| 1 | 登录 (S1) | `NEBULA_PASSWORD=synctest123` env，argv 无密码 | ✅ `已登录 http://127.0.0.1:8080（用户 synctest），令牌已保存` |
| 2 | 创建配对 | `create-pair --storage-id 1 --remote-path /sync-selftest --mode two-way --json` | ✅ pair id=5，token `c00dfdf4…` |
| 3 | 添加任务 (S2) | `NEBULA_TOKEN=<token>` env，argv 无 `--token` | ✅ `已添加同步任务 #1 selftest -> D:\…\tmp_selftest_local` |
| 4 | 同步 | `sync` | ✅ 推送 `hello.txt`（50 B）到远端，`apps/server/storage/sync-selftest/hello.txt` 内容一致 |
| 5 | 幂等 | 第二次 `sync` | ✅ `无变化 1`，status `ok`（无重推/冲突） |
| 6 | **B2 超时** | 独立 Rust 程序复刻 `try_wait` 逻辑，挂起 60s 子进程 | ✅ **30.052s 准时触发**，挂起子进程被 kill 并回收 |

**B2 独立实测**：`tmp_b2_timeout_test.rs` 完全复刻 `run_cli` 的 `try_wait` 轮询 + 30s deadline，spawn 一个睡 60s 的 node 子进程。结果：`B2_PASS 超时正确触发：耗时 30.052s（期望≈30s），挂起子进程已被 kill 并回收`。

---

## 四、构建验证

| 产物 | 状态 |
|------|------|
| `apps/desktop/src-tauri/target/debug/nebula-desktop.exe` | ✅ 重新编译（13,314,048 B） |
| `apps/sync/dist/cli.js` | ✅ 重新构建（24.60 KB） |

构建命令（vcvarsall + cargo --offline，网络受限）：
```
cmd.exe /c 'call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat" x64 >nul && cd /d "D:\项目\cloud网盘系统\apps\desktop\src-tauri" && cargo build --offline'
```

---

## 五、向后兼容

- 手动 CLI 仍可用 argv 兜底：`nebula-sync login <url> <user> <pass>`、`nebula-sync add <name> --token <t>`。
- `login` Tauri 命令签名不变（`url, username, password: String`），仅子进程调用把密码移到 env。
- `add_pair` 不再在 argv 发送 `--token`。
- 其余调用（create_pair / list_pairs / remove_pair / status / run_sync）env 传 `&[]`，行为不变。

---

## 六、清理

- 已删除临时文件：`tmp_setup_testuser.js`、`tmp_query_users.js`、`tmp_cli_test_state/`、`tmp_selftest_state/`、`tmp_selftest_local/`、`tmp_b2_timeout_test.*`、`tmp_hanging_server.js`、`tmp_db_cleanup.js`、`tmp_db_inspect.js`。
- 已删除 DB 自测产物：用户 `synctest`（id=12）、同步配对 id=5。
- 保留：真实用户 `wananlhd`/`testperm`/`devtest` 与既有配对 id=4（非本次产物）。

---

## 七、备注

1. **B2 偏差**：未用 `wait-timeout` crate（网络受限），改用 std `try_wait()` 轮询实现等价 30s 超时，零额外依赖。
2. **S4 说明**：桌面端仅经 Tauri IPC 与 server 通信（无直接 HTTP），`connect-src` 的 `http://127.0.0.1:8080` 为安全网，非必需通道。
3. **S6 告警**：PATH 扫描命中时向 stderr 打印中文安全告警，提示显式设置 `NEBULA_NODE`。
