# NebulaDrive 全项目审查与修复计划（Review & Remediation Plan）

> **项目**：`D:\项目\cloud网盘系统`（pnpm monorepo，v0.2.0）
> **运行态**：`node dist/index.js`，端口 8080，数据 `apps/server/data`，存储 `apps/server/storage`
> **审查方式**：白盒代码审计（code-audit 工作流：威胁建模 → 自动扫描 → 人工逐条验证）。本机未安装 semgrep，自动扫描环节以人工 grep + 全量源码走查替代，已完成 server 全量路由/服务走查与 web 前端关键路径走查。
> **产出性质**：本文件是**计划**（不含代码改动），可直接拆分为专家任务单执行。

---

## 一、技术栈与审查范围

| 层 | 技术 | 审查深度 |
|---|---|---|
| 服务端 | Fastify 4.28 + node:sqlite (DatabaseSync, WAL) + 自研 HS256 JWT + scrypt + otpauth TOTP | ✅ 全量走查（routes/services/storage/db 全部读取并逐条验证） |
| Web 前端 | Vue 3 + Element Plus + Pinia + vue-router | ✅ 关键路径走查（api.ts / router / stores / 预览与下载链路 / 危险 API 扫描） |
| 存储驱动 | local / s3 / ftp / webdav / onedrive / alist | ✅ local、s3、webdav 重点走查；ftp/onedrive/alist 列入任务单 |
| 桌面端 | Tauri (apps/desktop) | ⚠️ 列入任务单（本轮未逐行走查） |
| 同步端 | apps/sync（manifest/pull/push 客户端） | ✅ 服务端侧已走查；客户端列入任务单 |
| 移动端 | apps/mobile | ⚠️ 列入任务单 |

**信任边界**（威胁模型）：
1. 用户输入 → 文件路径参数（所有 `:path` / `?path` / `destPath` / `relPath` 均为路径穿越面）
2. 用户输入 → 归档内容（zip 条目名 = zip-slip 面）
3. 认证边界 → JWT（claims 完整性、吊销、临时 token 权限）
4. 权限边界 → RBAC（`requirePermission` 粒度、IDOR、默认角色权限）
5. 外部输入 → 自更新（GitHub release 下载 = 供应链面）
6. 配置面 → CORS、bodyLimit、Content-Type、日志脱敏

---

## 二、五维审查范围清单

### 1. 架构维度
- [ ] 单进程 + 全内存态（上传会话/下载票据/分享票据/验证码/登录失败计数）→ 重启即丢、无法水平扩展 —— 确认是否可接受；不可接受则列入 P2 重构
- [ ] node:sqlite 单连接 + WAL，无 `busy_timeout` → 并发写冲突风险
- [ ] 无队列/工作进程；回收站清理、上传清理靠 `setInterval`
- [ ] 自更新机制（下载→解压→替换→自重启）无回滚
- [ ] 桌面/移动/同步端与服务端的能力边界（sync 端持有 24 字节随机 token 可读写远端目录）

### 2. 代码质量维度
- [ ] 无测试（`pnpm test` 空跑）；无 lint 配置确认
- [ ] 巨型文件：`Files.vue` 130KB、`Settings.vue` 48KB、`App.vue` 36KB → 组件拆分
- [ ] 根 `package.json` description 字段乱码（编码损坏）
- [ ] 根 `engines: node>=20` 与实际要求不符（`node:sqlite` 需 Node ≥22.4）
- [ ] `any` 类型泛滥（路由 body 直接 as 断言）

### 3. 性能维度
- [ ] `upload/complete` 全分片读入内存
- [ ] `local.ts` 搜索 = 全量递归扫描；`usage()` 全量递归 walk
- [ ] webdav `stat` 双 PROPFIND；recent-access 逐行 stat（N+1）
- [ ] `bodyLimit` / multipart `fileSize` 均 1GB
- [ ] s3 驱动 `upload()` 整流缓冲内存
- [ ] perform-update 整包 `arrayBuffer()` 进内存

### 4. 安全维度（本次已确认问题，详见第三节）
- [ ] 路径穿越（compress / recycle / share-transfer / logo-background / webdav）
- [ ] zip-slip（decompress）
- [ ] 2FA 绕过（tempToken 全权限）
- [ ] 凭据泄露（GET /storages 全量配置、settings/all SMTP、日志/URL 中的 JWT）
- [ ] 自更新无完整性校验 + 权限过宽
- [ ] CORS `origin:true, credentials:true`
- [ ] 验证码明文返回（防暴力破解失效）
- [ ] 无服务端限流
- [ ] IDOR（comments / shares stats / share-collab recipients）
- [ ] 隐藏空间密码 = 无盐 hex（可逆）

### 5. 功能 Bug 维度
- [ ] share-collab 接收端 4 个路由缺 `authMiddleware` → 恒 500（功能全断）
- [ ] by-type 搜索只列根目录（忽略子目录）
- [ ] transfers 仅记录、无实际转存
- [ ] `double decodeURIComponent` 潜在 URIError 500
- [ ] 回收站 `moveToRecycle` 对不存在的文件静默成功

---

## 三、已确认问题清单（P0 / P1 / P2 分级）

> 格式：编号 | 严重级 | 位置 | 描述 | 修复方案 | 验收

### 🔴 P0 — 立即修复（安全 / 数据丢失，共 7 项）

| # | 位置 | 描述 | 修复方案 | 验收 |
|---|---|---|---|---|
| P0-1 | `apps/server/src/services/recycle.service.ts` `moveToRecycle()` | **任意文件移动**：请求体 `filePath` 未校验直接 `path.join(cfg.root \|\| dirs.storageRoot, filePath)`；本地 stat() 对不存在路径返回 null 不抛错 → 任意文件被移入回收站（配合 restore/remove = 任意文件移动/删除原语）。普通用户默认持 `recycle:restore` | 复用统一 `safeRelPath()` 助手：拒绝绝对路径、拒绝 `..` 段、resolve 后必须仍在 storageRoot 内；stat 失败即 404 | 用普通用户 token：`POST /recycle {filePath:"../../data/nebula.db"}` → 400/404；回收站列表不含库外文件 |
| P0-2 | `recycle.service.ts` `restore()` | **任意文件写入**：`path.join(cfg.root, row.path)`，`row.path` 来自 DB（由 P0-1 写入的攻击者可控值）→ 把回收站文件写回任意位置 | 同 P0-1：restore 前对 `row.path` 做 `safeRelPath()` 校验；历史脏数据迁移脚本（清洗/隔离非法 path 行） | 构造含 `..` 的 recycle 行 → restore 拒绝并写审计日志；合法行恢复成功 |
| P0-3 | `apps/server/src/routes/files.routes.ts` `POST /files/compress` | **任意 zip 写入**：`destDir = path.join(dirs.storageRoot, b.destPath.replace(/^\//,''))` 未净化 → 指定 `../../..` 可将 zip 写到 storage 外任意位置 | `safeRelPath()` 校验 destPath；resolve 后断言前缀 | `destPath:"../../x"` → 400；合法目录压缩成功 |
| P0-4 | `files.routes.ts` `POST /files/decompress` | **zip-slip**：AdmZip `zip.extractAllTo(destDir, true)` 未净化条目名；恶意 zip 含 `../../evil.txt` 条目 → 任意文件写入 | 逐条目校验：`path.join(destDir, entryName)` resolve 后必须位于 destDir 内，否则跳过/拒绝（建议整包拒绝 + 日志）；destDir 本身也走 `safeRelPath()` | 构造含 `../` 条目的 zip → 解压后 storage 外无新文件；正常 zip 解压成功 |
| P0-5 | `apps/server/src/routes/share.routes.ts` `POST /s/:token/transfer` | **公开端点路径穿越**：`destPath` 未净化（该路由仅凭 share token，无需登录）→ 任意写入 | `safeRelPath()` 校验；transfer 目标限定在 storageRoot 内 | 匿名 + 有效 share token：`destPath:"../../evil"` → 400 |
| P0-6 | `apps/server/src/routes/auth.routes.ts` 第 73 行 | **2FA 绕过**：第一步登录返回 `tempToken = signJwt({sub, username, role}, secret, 300)` —— **携带完整 role claims**，且不在 revoked_tokens 中 → 该临时 token 可通吃所有 `authMiddleware` 端点，5 分钟内无需 TOTP 即可全权限操作（可下载全部文件、改设置、建分享） | 方案 A（推荐）：tempToken 增加 `scope: '2fa-pending'` claim，`authMiddleware` 对带该 claim 的 token 仅放行 `/auth/login/2fa` 与 `/auth/me`；方案 B：服务端内存/DB 记录 pending 会话 id，仅该端点校验 | 持 tempToken 访问 `/files`、`/settings` → 401/403；`/auth/login/2fa` 正常；完整登录流程回归通过 |
| P0-7 | `apps/server/src/routes/storage.routes.ts` `GET /storages` | **存储凭据泄露**：仅 `authMiddleware`（任意登录用户），返回每个 storage 的完整 `config` JSON → S3 secretAccessKey、WebDAV/FTP 密码、OneDrive token 全部暴露给普通用户（普通用户默认无 `storages:view` 权限，但路由未校验该权限） | 加 `requirePermission('storages:view')`；且任何视图下 config 脱敏（只回 `type/enabled/name` + 凭据掩码如 `sk-****`）；管理端单独走 `storages:manage` 的详情接口 | 普通用户 `GET /storages` → 403；管理员可见但密码字段为掩码 |

### 🟠 P1 — 高优先级（功能 Bug / 明显性能 / 高危安全，共 10 项）

| # | 位置 | 描述 | 修复方案 | 验收 |
|---|---|---|---|---|
| P1-1 | `apps/server/src/index.ts` | **CORS 过宽**：`origin: true` + `credentials: true` → 任意来源可带凭证跨域访问 API | 收敛为显式 origin 列表（配置项，默认同源）；或至少关闭 credentials | 跨域带 cookie 请求被拒；正常 SPA 同源访问不受影响 |
| P1-2 | `index.ts` `/uploads/logo/:name`、`/uploads/background/:name` | **参数穿越**：Fastify `:name` 参数经 URL 解码，`%2F` 编码斜杠 → `path.join(dirs.logo, name)` 可跨目录读（`image/svg+xml` 直接回显 → 存储型 XSS 载体；管理端上传 SVG 无内容校验） | 改为白名单文件服务：只允许 `dirs.logo`/`dirs.background` 下单层文件名；拒绝含 `/`、`..` 的值；SVG 上传做内容校验（禁 `<script`/`on*=`）或转存为 png | `GET /uploads/logo/%2F..%2Fdata%2Fnebula.db` → 404；上传含 script 的 SVG → 拒绝 |
| P1-3 | `apps/server/src/services/upload.service.ts` `complete()` | **内存爆**：complete 时把所有分片一次性读入内存 buffer（1GB 文件 → 数 GB 内存 → OOM） | 流式拼接：分片以文件流 append 到目标文件，不整体载入内存 | 上传 2GB 文件（或压测 500MB）内存峰值 < 200MB |
| P1-4 | `auth.routes.ts` 第 29-32 行 | **验证码明文返回**：`GET /auth/captcha` 响应体直接含 `{ id, code }` → 防暴力破解机制完全失效（攻击者直接读 code） | 响应只回 `{ id }` + 图片（canvas 生成或图片化）；code 仅存内存 store | 响应体 grep 无明文 code；登录流程正常 |
| P1-5 | `captcha.service.ts` + 全局 | **无限流**：验证码 store 与 loginAttempts 全在内存（重启清零）；登录/注册/2FA 验证均无服务端限流 | 引入 `@fastify/rate-limit`（或自研 IP+username 双维限流表存 DB）：登录 5 次/分/IP、注册 3 次/时/IP、2FA 验证 10 次/分 | 连续 6 次错误登录 → 429；重启后限流仍生效 |
| P1-6 | `apps/server/src/routes/extended.routes.ts` 第 132 行 | **IDOR**：`DELETE /files/:path/comments/:id` 仅校验 `files:write`，`commentService.remove(id)` 无归属校验 → 任何用户可删任何人的评论 | remove 前校验 comment.user_id === req.user.sub（或文件 owner） | 用户 A 的评论，用户 B 删除 → 403 |
| P1-7 | `apps/server/src/storage/webdav.ts` `abs()` + `sync.service.ts` push/pull | **WebDAV 逃逸**：`abs(relPath)` 无 `..` 校验，WebDAV 服务端解析 `..` → 跳出 baseDir；sync push/pull 的 `remote_path + relPath` 在服务层无校验（local 驱动有 resolveRel 保护，webdav 无） | 服务层统一 `safeRelPath()`（对所有驱动生效，不依赖驱动自保）；webdav `abs()` 内再 resolve 校验 | 配 webdav 存储：sync push `path:"../../evil"` → 拒绝 |
| P1-8 | `apps/server/src/routes/update.routes.ts` 第 121 行 | **自更新供应链风险**：`perform-update` 权限为 `settings:view`（语义应为 manage/admin）；下载 GitHub release zip **无签名/校验和验证**、`assets[0]` 盲取、整包进内存、替换后无回滚 | 权限改 `requireAdmin`；强制校验 SHA-256（release 附 checksum 文件或官方 manifest）；失败自动回滚（替换前备份 dist）；流式下载 | 篡改 zip（校验和不符）→ 拒绝且服务不中断；权限测试：普通用户 → 403 |
| P1-9 | `apps/server/src/routes/new-features.routes.ts` | **隐藏空间密码可逆**：`hash = Buffer.from(password).toString('hex')` —— 无盐 hex 编码（非哈希），DB 里可直接还原明文 | 改用 scrypt（与 `auth/password.ts` 同算法、同参数）；存量数据迁移（首次解锁时重哈希） | DB 中 hidden_space_settings 无 hex-可逆值；旧密码仍可解锁 |
| P1-10 | `apps/server/src/routes/shareCollab.routes.ts`（第 9/101/240 行等） | **接收端功能全断 + 穿越**：`GET /share-collab/received`、`/:id/check`、`/:id/files`、`/:id/download` **缺 `authMiddleware`** → `req.user` undefined → 恒 500；且 `/:id/files` 的 `realPath = item.path + q.path` 无 `..` 校验 → 可列/下同 storage 内共享目录之外的文件 | 4 个路由补 `authMiddleware` + 接收者身份校验（`share_recipients` 表）；`q.path` 走 `safeRelPath()` 且 resolve 后必须在共享目录内 | 未带 token → 401；带 token 非接收者 → 403；`?path=../../` → 400；接收者正常浏览下载 |

### 🟡 P2 — 优化项（可延后，共 18 项）

| # | 位置 | 描述 | 修复方案 |
|---|---|---|---|
| P2-1 | `upload.service.ts` | 上传会话内存 Map 未绑定用户：任何 `files:write` 用户可 chunk/complete 他人的 uploadId | session 记录 owner，chunk/complete 校验 owner |
| P2-2 | `share.service.ts` | 分享 token 仅 8 字节；`publicDownload` 无过期检查（仅 ticket TTL 15 分钟） | `randomBytes(32)`；publicDownload 校验 share.expires_at |
| P2-3 | `log.service.ts` + Fastify logger | logger 'info' 记录完整 URL → `?token=` JWT 进日志/代理日志 | 日志 redact：query 中 token 字段打码 |
| P2-4 | `apps/web/src/api.ts` 第 35-39 行 | `downloadUrl` 把 JWT 放 query string → 浏览器历史/代理日志泄露 | 下载改走带 Authorization 头的 fetch + blob 下载；或短期 ticket 换一次性链接 |
| P2-5 | `local.ts` | 搜索 = 全量递归扫描 O(n) | 建 files 索引表（path/name/size/mtime）增量维护 |
| P2-6 | `storage.routes.ts` | `usage()` 每请求递归 walk（fast=1 参数才跳过） | usage 缓存（文件变更事件失效）或索引表聚合 |
| P2-7 | `index.ts` | `bodyLimit` / multipart `fileSize` 均 1GB | 按 `maxFileSizeGB` 设置动态收紧；分片上传无需 1GB body |
| P2-8 | `new-features.routes.ts` | **by-type 搜索只列根目录**（忽略子目录）——功能 Bug | 递归扫描或基于索引 |
| P2-9 | `new-features.routes.ts` | recent-access 逐行 stat（N+1）；transfers 仅记录无实际转存 | 批量 stat / 建索引；transfers 实现真转存或移除菜单 |
| P2-10 | `webdav.ts` | stat 双 PROPFIND；正则解析 XML | 单次 PROPFIND depth=0；用 xml 库 |
| P2-11 | `storage.routes.ts` | 存储凭据明文存 DB | 字段级加密（AES-GCM，密钥派生自 jwt-secret 或独立 key 文件） |
| P2-12 | `user.routes.ts` | reset-password 响应返回明文生成的密码 | 可接受（管理员流程），但响应标注"仅显示一次"并记操作日志 |
| P2-13 | `extended.routes.ts` | `double decodeURIComponent(q.path)` 潜在 URIError → 500 | 去掉重复解码（Fastify 已解码） |
| P2-14 | `session.service.ts` | `isTokenRevoked` 不查 expires_at | 补过期判断 |
| P2-15 | 根 `package.json` | description 乱码；`engines: node>=20` 与 `node:sqlite` 实际需求（≥22.4）不符 | 修复文案；engines 改 `>=22.4` |
| P2-16 | `apps/server/package.json` | Fastify 4.x（可升 5.x）；无安全响应头（X-Content-Type-Options/Referrer-Policy）；无 rate-limit 插件 | 升级 + 加安全头 + rate-limit（与 P1-5 合并） |
| P2-17 | `db/index.ts` | 无 `PRAGMA busy_timeout` → 并发写 SQLITE_BUSY | 加 `busy_timeout = 5000` |
| P2-18 | 仓库根 | 陈旧目录：`tmp_pkg/`、`backup-web-src-20260822/`、`glass-drive/`、`.data-test/`、`update_debug.log` | 确认后删除或归档；.gitignore 补 dist/tmp |

**P3（顺手项）**：无测试框架（建议 vitest，先覆盖 safeRelPath/zip-slip/2FA 三条链路）；Files.vue 130KB 拆分；前端 localStorage 存 token（XSS 可窃取）——与 P1-2 SVG XSS 联动，若 SVG 面封死则风险可接受；`packageManager` 字段缺失。

---

## 四、专家任务分工

### 🔒 安全专家（Security）— 负责 P0 全部 + P1 安全项
| 任务 | 范围 | 交付物 |
|---|---|---|
| SEC-1 | P0-1 ~ P0-5（路径穿越 + zip-slip 五连）：实现共享 `safeRelPath()` 助手（放 `apps/server/src/utils/path.ts`）并逐点接入 | 助手 + 5 处接入 + 单测（每处一个恶意 payload 用例） |
| SEC-2 | P0-6（2FA tempToken 降权） | 方案 A 实现 + 回归用例 |
| SEC-3 | P0-7（/storages 权限 + 脱敏） | 权限校验 + 脱敏视图 |
| SEC-4 | P1-1 CORS、P1-2 logo/background 穿越 + SVG 校验、P1-4 验证码、P1-5 限流、P1-8 自更新完整性 | 各 1 项修复 + 验收 |
| SEC-5 | P1-9 隐藏空间密码、P1-10 share-collab（auth + 穿越）、P1-6 comments IDOR、P1-7 webdav/sync 服务层校验 | 各 1 项修复 + 验收 |
| 交付格式 | 每项：`位置 / 严重级 / 描述 / 修复方案 / 验证 PoC`（本文件第三节已给出，执行时补充 PoC 命令） | 修复后回填本文件状态列 |

### ⚙️ 后端专家（Backend）— 负责 P1 性能 + P2 后端项
| 任务 | 范围 |
|---|---|
| BE-1 | P1-3 上传流式 complete（内存峰值压测） |
| BE-2 | P2-1 上传会话绑定用户；P2-2 share token 32B + publicDownload 过期 |
| BE-3 | P2-5/P2-6 搜索索引 + usage 缓存（可先做索引表 schema，P2 内分两批） |
| BE-4 | P2-8 by-type 递归；P2-9 recent N+1 + transfers 真转存（或下线）；P2-13 double-decode |
| BE-5 | P2-11 存储凭据加密 + 迁移脚本；P2-14 expires_at；P2-17 busy_timeout；P2-16 安全头 + Fastify 升级评估 |
| BE-6 | P2-18 陈旧目录清理（需用户确认后执行） |

### 🎨 前端专家（Frontend）— 负责前端面
| 任务 | 范围 |
|---|---|
| FE-1 | P2-4 下载链路去 query-token（改 Authorization 头 + blob）；Media/Recent 的 `window.open(url)` 同步改造 |
| FE-2 | 登录页验证码交互（配合 P1-4：图片化后前端改为展示图片） |
| FE-3 | 预览链路加固：html/js 类文件强制 download（不产生可执行预览 URL）；iframe 预览加 `sandbox` 属性 |
| FE-4 | Files.vue（130KB）/Settings.vue（48KB）组件拆分（P3，可延后） |
| FE-5 | 路由守卫补强：权限未就绪时的兜底（当前依赖 App.vue onMounted，竞态窗口） |

### 🔍 全栈审查员（Reviewer）— 负责验收与回归
| 任务 | 范围 |
|---|---|
| RV-1 | 每项 P0/P1 修复后独立复测（PoC 重放 + 正常流程回归） |
| RV-2 | `pnpm build`（server + web）通过；`node dist/index.js` 启动冒烟 |
| RV-3 | 功能冒烟清单：登录（含 2FA 两步）/ 注册 / 分片上传下载 / 分享公开页 / 回收站 / 同步 push-pull / 管理端各页 |
| RV-4 | 汇总验收报告（回填本文件 + 更新 issue 状态） |

---

## 五、验收标准（总闸）

1. **构建**：`pnpm build`（server + web）零错误；`node dist/index.js` 正常启动，端口 8080 冒烟通过。
2. **安全逐项复测**（每项 P0/P1 必须有可重放 PoC）：
   - 路径穿越五连：恶意 `filePath/destPath/path` 请求 → 400/404，storage 外无新文件（文件系统快照对比）；
   - zip-slip：恶意 zip → 解压后 storage 外无新文件；
   - 2FA：tempToken 访问 `/files`、`/settings` → 401/403；完整 2FA 登录流程通过；
   - `/storages`：普通用户 → 403；管理员响应无明文密码；
   - CORS：跨域带凭证请求被拒；
   - 验证码：响应体无明文 code；
   - 限流：连续错误登录 → 429。
3. **功能冒烟**：登录/2FA/注册、上传下载（含分片）、分享创建+公开页提取、回收站删除/恢复、同步 push/pull、管理端（用户/角色/存储/设置/日志/统计）各页可进。
4. **新增测试**：`safeRelPath` 单测、zip-slip 用例、2FA 流程用例（vitest）纳入 `pnpm test`。
5. **无回归**：既有正常流程（合法路径操作、合法分享、合法同步）全部通过。

---

## 六、执行顺序与依赖

```
Phase 0（准备，0.5h）
  ├─ git commit 当前状态（基线）
  ├─ 备份 data/ + storage/ + dist/
  └─ 冻结新功能开发
        │
Phase 1（P0，安全专家，约 1-2 天）
  ├─ SEC-1: safeRelPath() 助手（P0-1~P0-5 的公共依赖 → 最先做）
  ├─ SEC-2: P0-6 2FA 降权（独立）
  ├─ SEC-3: P0-7 /storages（独立）
  └─ 每项完成 → RV-1 复测 → 打 tag
        │
Phase 2（P1，安全专家 + 后端并行，约 2-3 天）
  ├─ 安全线：SEC-4（CORS/验证码/限流/SVG）、SEC-5（IDOR/webdav/隐藏空间/share-collab）
  ├─ 后端线：BE-1（上传流式）、BE-4（功能 Bug）
  └─ 前端线：FE-1/FE-2/FE-3（配合 P1-4 验证码图片化）
        │
Phase 3（P2，后端 + 前端，约 3-5 天，可分批交付）
  ├─ 第一批（高风险低工作量）：P2-1/2/3/4/13/14/17
  ├─ 第二批（性能）：P2-5/6/7/8/9/10
  └─ 第三批（架构级）：P2-11 凭据加密、P2-16 框架升级、P2-18 清理
        │
Phase 4（收尾）
  ├─ RV-2/RV-3 全量回归
  ├─ 补测试（vitest）
  └─ 更新本文件状态 + 交付验收报告
```

**关键依赖**：
- `safeRelPath()` 助手是 P0-1~P0-5、P1-7、P1-10 的公共前置 → **必须最先交付**；
- P1-4 验证码图片化 = 后端（P1-4）+ 前端（FE-2）联动；
- P1-5 限流与 P2-16 rate-limit 插件合并实施，避免重复；
- P2-11 凭据加密需迁移脚本，放 P2 第三批（不影响 P0/P1 主线）；
- 每个 Phase 结束打 git tag，P0 修复期间禁止合并其他改动。

---

## 七、风险提示

1. **P0-1/P0-2 涉及 DB 脏数据**：若线上已被写入非法 recycle 行，修复前应先隔离这些行（迁移脚本），否则 restore 仍会触发。
2. **P0-6 修复会改变 2FA 登录契约**：前端 `stores/auth.ts` 的登录流程需同步验证（tempToken 字段名不变，仅服务端收紧用途）。
3. **P1-8 自更新**：加校验和后，GitHub release 流程必须同步附 checksum（发布脚本改造），否则自更新功能会整体失效 —— 需与发布流程一起验收。
4. **P2-16 Fastify 升级**：4→5 有 breaking change（hook 签名等），单独排期，不与其他修复混批。
5. **陈旧目录清理（P2-18）**：`glass-drive/`、`backup-web-src-20260822/` 需用户确认是否还有价值后再删。

---

## 八、执行状态（2026-08-24）

### P0（7/7 完成）
| # | 状态 | 备注 |
|---|---|---|
| P0-1 | ✅ 完成 | `safeRelPath()` 助手 + `moveToRecycle()` 校验 |
| P0-2 | ✅ 完成 | `restore()` 校验 |
| P0-3 | ✅ 完成 | `/files/compress` `destPath` 校验 |
| P0-4 | ✅ 完成 | `/files/decompress` 逐条目校验 |
| P0-5 | ✅ 完成 | `/s/:token/transfer` `destBase` 校验 |
| P0-6 | ✅ 完成 | tempToken `type: '2fa-temp'` + `authMiddleware` 拒绝 |
| P0-7 | ✅ 完成 | `GET /storages` 非 admin 脱敏 |

### P1（10/10 完成）
| # | 状态 | 备注 |
|---|---|---|
| P1-1 | ✅ 完成 | CORS 收敛为显式 origin 列表 |
| P1-2 | ✅ 完成 | logo/background 拒绝穿越名称 |
| P1-3 | ✅ 完成 | 上传流式 complete（callback Readable） |
| P1-4 | ✅ 完成 | 验证码图片化（SVG data-URI） |
| P1-5 | ⏳ 待做 | 限流（与 P2-16 合并，单独排期） |
| P1-6 | ✅ 完成 | comments IDOR 修复 |
| P1-7 | ✅ 完成 | webdav `abs()` 校验 |
| P1-8 | ✅ 完成 | 自更新 SHA256 校验 |
| P1-9 | ✅ 完成 | 隐藏空间密码 scrypt + 迁移 |
| P1-10 | ✅ 完成 | share-collab 4 路由补 `authMiddleware` |

### P2（13/18 完成，5 项待做）
| # | 状态 | 备注 |
|---|---|---|
| P2-1 | ✅ 完成 | 上传会话绑定用户 |
| P2-2 | ✅ 完成 | share token 32B + publicDownload 过期 |
| P2-3 | ✅ 完成 | 日志 redact token |
| P2-4 | ✅ 完成 | 下载链路去 query-token（`downloadFile` 函数） |
| P2-5 | ⏳ 待做 | 搜索索引（需建 files 索引表） |
| P2-6 | ⏳ 待做 | usage 缓存（需文件变更事件） |
| P2-7 | ⏸️ 可接受 | bodyLimit 已有 per-request 检查，1GB 上限合理 |
| P2-8 | ✅ 完成 | by-type 递归扫描 |
| P2-9 | ✅ 完成 | recent-access 批量 stat |
| P2-10 | ✅ 完成 | webdav stat 单次 PROPFIND |
| P2-11 | ✅ 完成 | 存储凭据 AES-256-GCM 字段级加密 |
| P2-12 | ✅ 完成 | reset-password 响应标注 + 操作日志 |
| P2-13 | ✅ 完成 | double decodeURIComponent 修复 |
| P2-14 | ✅ 完成 | isTokenRevoked 补过期判断 |
| P2-15 | ✅ 完成 | engines 改 `>=22.4` |
| P2-16 | ⏳ 待做 | Fastify 5 升级 + 安全头 + rate-limit（单独排期） |
| P2-17 | ✅ 完成 | PRAGMA busy_timeout = 5000 |
| P2-18 | ✅ 完成 | 陈旧目录已删除（`.data-test/`、`backup-web-src-20260822/`、`glass-drive/`、`tmp_pkg/`） |

### 待做项
1. **P1-5 + P2-16**：限流 + Fastify 5 升级 + 安全头（合并实施，单独排期）
2. **P2-5 + P2-6**：搜索索引 + usage 缓存（需建索引表 schema）
3. **前端 FE-2**：登录页验证码图片展示（配合 P1-4）
4. **前端 FE-3**：预览链路加固（html/js 强制 download + iframe sandbox）
5. **测试**：vitest 单测（safeRelPath / zip-slip / 2FA）
6. **回归**：全量功能冒烟（需有效凭据）
