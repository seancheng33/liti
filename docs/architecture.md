# 砺题（Liti）系统架构设计

> 版本：v0.1（设计阶段）
> 更新：2026-10-28
> 状态：本文档为已确认的设计与规划，代码尚未实现。

---

## 1. 概述

砺题（Liti）是一款面向**局域网**的学习刷题系统，以选择题（单选 / 多选）为主。核心能力：

- 题库管理：界面逐题录入 + Excel 批量导入（模板、预校验、错误行报告）；题干与选项支持配图。
- 组卷：按分类随机抽题，或从题库手动多选固定题目；每卷 1–100 题，题量自定义。
- 答题：选项顺序随机、整卷倒计时、切窗检测与惩罚、答案自动保存。
- 判分与解析：交卷自动判分；支持「考试模式」与「练习模式」两种解析时机。
- 存储：默认 SQLite，预留 MySQL；认证支持本地账号，预留 SSO（OIDC）。

---

## 2. 总体架构

```
┌──────────────────────────────────────────────┐
│              浏览器 (React SPA)               │
│    登录 / 题库 / 组卷 / 答题 / 解析 / 成绩      │
└──────────────────────┬───────────────────────┘
                       │ HTTP(S)  局域网 IP 访问
┌──────────────────────▼───────────────────────┐
│              Fastify 应用服务器               │
│  ├─ 认证与授权（Session + RBAC + OIDC 预留）  │
│  ├─ 业务：题库 / Excel 导入 / 组卷 / 答题      │
│  │       / 计时 / 判分 / 解析 / 成绩           │
│  └─ 静态资源托管（生产模式）                  │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│         Repository / 数据访问层（Kysely）      │
│     ├─ SQLite（默认，better-sqlite3）         │
│     └─ MySQL （配置切换，mysql2）             │
└──────────────────────────────────────────────┘
```

**关键决策**

1. **单进程部署**：Fastify 同时提供 REST API 与前端静态资源，局域网内通过 `http://<IP>:8080` 访问。
2. **数据访问层抽象**：统一使用 Kysely 查询构建器，`DB_DRIVER` 切换 SQLite / MySQL，业务代码不感知底层数据库。
3. **防切屏适配层**：`ExamGuard` 抽象防切屏能力，Web 端用 `visibilitychange / blur / fullscreenchange` 检测；后续 Electron 壳替换为 IPC 失焦事件，业务层不改。

---

## 3. 技术选型

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React 18 + TypeScript + Vite | SPA，生产构建后由后端托管 |
| UI | Ant Design 5 | 表单 / 表格 / 树等后台组件齐全 |
| 前端状态 | TanStack Query | 服务端状态缓存与自动重取 |
| 后端 | Node.js 22 + Fastify | 高性能、Schema 校验 |
| 校验 | Zod | 请求体 / 配置统一校验 |
| 数据访问 | Kysely | 类型安全，SQLite / MySQL 双方言 |
| SQLite | better-sqlite3 | 同步、WAL 模式、零配置 |
| MySQL | mysql2 | `DB_DRIVER=mysql` 时启用 |
| Excel | exceljs | 模板导出与批量导入解析 |
| 认证 | argon2 + Cookie Session | 密码哈希 + 会话；OIDC 预留 |
| 测试 | Vitest + Playwright | 单元 / 集成 / E2E |

---

## 4. 角色与权限

| 角色 | 题库 | 试卷 | 答题 | 用户 / 系统 |
|---|---|---|---|---|
| `admin` | 增删改查、导入 | 全部 | 可预览 | 用户管理、数据库 / SSO 配置 |
| `teacher` | 增删改查、导入 | 建卷 / 发布 / 看成绩 | 可预览 | — |
| `student` | 只读（练习时） | 使用已发布试卷 | 答题 / 看自己记录 | — |

默认：教师建题组卷，学生答题。学生「自助随机练习组卷」做成开关，默认开启。

---

## 5. 数据模型

| 表 | 关键字段 |
|---|---|
| `user` | id, username, display_name, password_hash?, role, provider(local/oidc), external_id, status, prefs(JSON) |
| `session` | id, user_id, token_hash, expires_at, ip, ua |
| `category` | id, name, parent_id, sort |
| `question` | id, type(single/multiple), stem, images(JSON), explanation, category_id, tags(JSON), status(active/archived), content_hash, created_by, created_at, updated_at |
| `question_option` | id, question_id, content, images(JSON), is_correct, sort_order |
| `paper` | id, title, mode(random/fixed), question_count, duration_sec, pass_score, review_mode, shuffle_options, random_config(JSON), status, practice, **audience_mode(all/selected)**, created_by |
| `paper_item` | id, paper_id, question_id, order_no, score |
| `paper_audience` | id, paper_id, user_id, created_at —— 可见白名单（`audience_mode=selected` 时生效） |
| `attempt` | id, paper_id, user_id, started_at, deadline_at, submitted_at, status, score, correct_count, submit_reason, **paused_at**, **paused_total_ms** |
| `attempt_item` | id, attempt_id, question_id, order_no, option_order(JSON), selected(JSON), is_correct, score, **flagged**, answered_at |
| `attempt_violation` | id, attempt_id, type, occurred_at, meta |
| `import_batch` | id, filename, total, success, failed, errors(JSON), created_by, created_at |

> 加粗字段是 v0.4 新增（迁移 `0008_exam_enhance`）。

**可移植性约定（SQLite / MySQL 双库关键）**

- 时间统一存 **epoch 毫秒整数**，不用数据库原生日期类型，避免方言差异。
- JSON 统一存 **TEXT**（MySQL 侧不用 `JSON` 类型），跨库行为一致。
- 迁移用 Kysely schema builder 按方言生成 DDL；禁用 `INSERT OR REPLACE`、`ON CONFLICT` 等方言语法。

---

## 6. 核心机制

### 6.1 组卷

- **随机卷**：按分类配额不放回抽样（可多条规则，分类留空则全题库），题量 1–100；题库不足时明确报缺口（如「该分类题目不足：需抽 9 题，但仅剩 1 题可抽」）。
- **固定卷**：手动选题或按 ID 列表导入。
- 组卷时把题目**快照**进 `paper_item`，试卷生成即固定，保证可复现、可追溯。

### 6.2 选项乱序

- 开考时为每道题生成 `option_order`（选项 ID 数组）并落库；A/B/C/D 只是展示层字母。
- 判分按选项 ID 集合比对，与字母无关；交卷回看用同一顺序渲染。

### 6.3 计时与交卷

- 服务端下发 `started_at` + `deadline_at`，**并把 `serverNow` 一起返回**；前端算 `offset = serverNow - 本机时间`，
  倒计时一律按服务端时钟推，考生电脑时间不准也不会算错。
- 答案逐题自动保存，断网 / 刷新可恢复。
- 到点：客户端自动交卷；服务端拒绝超时提交，并在访问答卷时把过期未交卷标记为 `expired` 并按已存答案判分。**服务端是唯一裁判**，改本地时间无效。

### 6.3.1 暂停 / 继续（v0.4）

- `POST /:id/pause` 只写 `paused_at`，**不动 `deadline_at`**；`POST /:id/resume` 时把
  `deadline_at += (now - paused_at)` 并累加 `paused_total_ms`。这样「剩余时间」在暂停前后连续，不用两套口径。
- 暂停期间：`getAttemptReview` 直接**不下发题干与选项**（`masked`），存答案 / 交卷 / 超时惰性判分全部拦掉。
  注意「暂停中不做惰性判分」是必须的，否则暂停久了会被当成超时。
- 暂停期间上报的切屏**不计违规**（学生就是要离开），前端也不再监听。
- 暂停中交卷会先自动 resume 再判分，避免学生卡在暂停态出不来。

### 6.4 防切屏（Web 版能力边界）

- 三路监听，缺一条就会漏记：
  - `visibilitychange` → `hidden`（切标签页 / 最小化 / 切程序，最可靠）
  - `window.blur`（点别的窗口但页面仍可见）—— 注意 `blur` 不冒泡，必须挂在 `window` 上，挂在 `document` 收不到
  - `pagehide`（关页面 / 前进后退）
- 一次切窗会连触发 `visibilitychange` + `blur`，所以上报做 **2s 去抖**，一次只记一次。
- 违规次数由**服务端**累加（防前端篡改），第 3 次自动交卷，`submit_reason=violation`。
- 回来时不清遮罩，弹窗提示「本次已记违规（第 N 次）」，需要点「继续答题」才关掉 —— 否则学生根本看不到惩罚。
- 计时不暂停；屏蔽右键 / 复制 / 粘贴 / 选中。
- **边界说明**：浏览器无法真正阻止 Alt+Tab / Win 键，只能「检测 + 遮罩 + 惩罚」。物理级拦截留待 Phase 2 的 Electron 壳（全屏 kiosk + alwaysOnTop + 失焦拉回），`ExamGuard` 接口已预留。

### 6.4.1 题目标记（v0.4）

`attempt_item.flagged` 一对一存，不在前端本地存 —— 否则换设备 / 刷新就丢。
只影响答题卡显示，不参与判分。

### 6.4.2 作答次数上限（v0.4）

- `MAX_ATTEMPTS_PER_PAPER = 3`，统计 `status in (submitted, expired)` 的答卷数。进行中的不算。
- 开考时若已有 `in_progress` 答卷且未过期，**直接复用**（返回同一个 id），不新开也不占次数 ——
  否则学生刷新几次就把 3 次用完了。
- 练习卷（`practice=1`）不受限。
- 学生列表附带 `attempt_count / remaining_attempts`，前端据此把「开始答题」换成「次数已用完」。

### 6.4.3 试卷可见范围（v0.4）

- `paper.audience_mode`：`all`（默认）/ `selected`；名单存 `paper_audience`。
- 过滤点有四处，缺一处就会漏：学生 `GET /api/papers`、`POST /api/attempts`、`GET /api/public/papers`、
  `GET /api/public/papers/:id`。**不在名单里一律按 404「试卷不存在」处理**，别让人试出标题。
- 可见名单只有 admin/teacher 能读写；学生名册接口 `/api/users/students` 只返回 id / 用户名 / 显示名。

### 6.4.4 题目删除 = 软删除（v0.4）

- `DELETE /api/questions/:id` 只把 `status` 置为 `archived`，**不物理删行**。
- 原因：`paper_item` / `attempt_item` 只存 `question_id`，物理删除后历史试卷与已交答卷的解析就拼不出题面了。
- 附带影响：题库列表默认只查 `active`；随机抽题与手选组卷只认 `active`；查重排除 `archived`（删掉后可以重建成同题）；
  统计与公开概览只算 `active`。
- 删除接口返回 `usedInPapers`，前端据此提示「这题还在 N 份试卷里，那些试卷照常能看能考」。

### 6.5 Excel 导入

- 模板列（12 列）：题型(单选/多选)、题干、选项A–D（预留到 F）、正确答案（`A` 或 `ACD`）、解析、分类、标签。
- 流程：下载模板 → 上传 → **预校验**（必填、答案字母合法、单选唯一答案、多选 ≥2、空选项、题干重复）→ 错误行报告 → 确认后事务导入。
- 支持「跳过错误行导入」与「全量回滚」两种模式；导入留批次记录，可追溯。

### 6.6 双数据库

- 仓储接口 + Kysely 双方言，同一套实体类型。
- 迁移脚本双库可跑；启动时按配置自检连接。
- 切换只改 `DB_DRIVER` 与连接串，不碰业务代码。

### 6.7 SSO 预留

- `AuthProvider` 接口（`beginLogin / handleCallback / mapUser`），内置 `local` 实现 + OIDC 骨架。
- `user` 表带 `provider` + `external_id`，唯一键 `(provider, external_id)`；会话签发与认证方式解耦。
- 接入标准 OIDC 只需配置 issuer / clientId / clientSecret / redirectUri，不改代码；支持关闭本地密码登录、强制 SSO。

---

## 7. API 设计（草案）

```
# 认证
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
GET    /api/auth/sso/:provider/start
GET    /api/auth/sso/:provider/callback

# 公开接口（无需登录，仅暴露数字与已发布试卷的题面）
GET  /api/public/overview                    # 站点名/公告 + 题库·试卷·答卷·人数统计
GET  /api/public/papers                      # 已发布试卷列表（精简字段）
GET  /api/public/papers/:id                  # 卷面预览（无答案、无解析，草稿一律 404）
GET  /api/settings/public                    # 站名与公告

# 题库
GET/POST     /api/questions
GET/PUT/DELETE /api/questions/:id            # DELETE = 软删除（status→archived）
POST         /api/questions/batch            # { ids, action: 'delete' | 'category', categoryId? }
POST         /api/questions/import           # dryRun=true 预校验
GET          /api/questions/template         # xlsx，题型列为下拉

# 试卷
GET/POST     /api/papers                     # 列表：学生只拿到已发布 + 自己可见的
GET/PUT/DELETE /api/papers/:id
POST         /api/papers/:id/publish         # body 可带 { audienceMode, audienceUserIds }
GET          /api/papers/:id/audience        # 可见名单
PUT          /api/papers/:id/audience        # 发布后改可见范围
POST         /api/papers/random-preview      # 抽样题号预览（不落库）
POST         /api/papers/draft-preview       # 新建时按表单入参预览整卷（不落库）
GET          /api/papers/:id/preview         # 已存在试卷预览（草稿也可，需教师/管理员）

# 学生名册（发布挑人；只给 id/用户名/显示名）
GET          /api/users/students

# 答题
POST         /api/attempts                   # 开考（复用进行中答卷；超出 3 次报 400）
PATCH        /api/attempts/:id/answers       # 自动保存
PATCH        /api/attempts/:id/flag          # 题目标记
POST         /api/attempts/:id/pause         # 暂停：停表 + 服务端屏蔽题面
POST         /api/attempts/:id/resume        # 继续：deadline 按暂停时长顺延
POST         /api/attempts/:id/violations    # 违规上报（暂停中忽略）
POST         /api/attempts/:id/submit        # 交卷
GET          /api/attempts/:id/review        # 结果与解析
GET          /api/attempts?mine=1            # 我的记录

# 系统
GET  /api/health
GET  /api/meta
```

**约定**：所有请求体经 Zod 校验；`401` 未登录、`403` 无权限；时间字段为 epoch 毫秒。

---

## 8. 前端页面

### 8.1 路由分层

```text
/            首页          公开（未登录看门面，登录后套站内布局）
/login       登录          公开
/help        帮助文档      公开
──────────── 以下挂在 RequireAuth + AppLayout 布局路由下 ────────────
/papers      试卷列表 / 组卷
/questions   题库
/exam/:id    答题页
/attempts    我的记录
/review/:id  结果与逐题解析
/stats       统计
/users       用户管理     admin
/settings    系统设置     admin
```

落地方式：React Router 6 的**无 path 布局路由**（`<Route element={<RequireAuth><AppLayout/></RequireAuth>}>`）包住所有需登录页面；`AppLayout` 用 `{children ?? <Outlet />}` 同时兼容两种挂法。`*` 回首页而不是白屏。

### 8.2 首页（v0.3 新增，未登录可看）

首页承担「陌生人第一眼」的职责，三级递进：

1. **看门面**：Hero（站名 + 一句话介绍 + 公告）+ 4 张统计卡（题目数 / 试卷数 / 答题人次 / 用户数），数据来自 `GET /api/public/overview`。
2. **看卷面**：已发布试卷卡片网格（`GET /api/public/papers`），点卡片任意位置弹出 `PaperPreviewModal` 预览题面 —— **不含答案与解析**，元信息只显示题量/时长/及格分。
3. **开始答题**：点「开始答题」时若未登录，直接 `navigate('/login?next=/papers?start=<paperId>')` —— 登录成功后由 `LoginPage` 读 `next` 自动回跳并立即开考（v0.4 由「滚动+聚焦」改为「跳转」，因为滚动提示在窄屏上和卡片重叠时容易被忽略）。带头部的「登录」按钮同样去 `/login`，不留在首页。

已登录用户访问 `/` 时直接渲染同一份内容但套 `AppLayout`，登录卡换成「继续练习 / 我的记录」入口。未登录外壳是 `PublicShell`（极简页头：logo 回首页、帮助入口、主题切换），与帮助页共用。

### 8.3 站内帮助（v0.3 新增，`/help`）

9 个锚点章节 + 左侧目录：快速开始（Steps）/ 角色与权限（表）/ 题库与配图 / Excel 批量导入（模板逐列说明表）/ 组卷与发布 / 答题与防作弊 / 交卷与解析（交卷原因用前端 `SUBMIT_REASON_LABEL` 渲染）/ 成绩与统计 / 常见问题（7 条 Collapse）。未登录也能看，方便把链接直接发给新用户。

### 8.4 试卷预览（v0.3 新增）

三处入口共用 `PaperPreviewModal`：

| 入口 | 接口 | 说明 |
|---|---|---|
| 首页试卷卡片 | `GET /api/public/papers/:id` | 仅已发布，草稿/非公开 404 |
| 试卷列表「预览」 | `GET /api/papers/:id/preview` | 教师/管理员，草稿也能看 |
| 新建试卷弹窗「预览卷面」 | `POST /api/papers/draft-preview` | 按当前表单入参临时抽卷，**不落库** |

预览统一走 `server/src/paper/preview.ts`：一次性两条 SQL 捞题目与选项（避免逐题回表），**故意剔除 `is_correct` 与 `explanation`** —— 预览链路永远不接触答案。

### 8.5 各角色页面

- **学生**：试卷列表（只列已发布且在自己可见范围内，附带「还可答 N 次」）/ 我的记录 / 答题页（题号导航、倒计时、自动保存、暂停、标记、违规遮罩）/ 结果与逐题解析。
- **教师**：题库列表（多选 + 批量改分类/删除）/ 题目编辑 / Excel 导入 / 组卷（随机配额 + 手动选题 + 发布时指定可见学生）/ 试卷管理 / 成绩查看。
- **管理员**：用户管理 / 系统设置（数据库、SSO、考试默认参数）。
- **提示信息**：所有表单字段带 `tooltip`，随机抽题、答题防作弊、密码规则等规则性内容用 `Alert` 常驻说明，列表空状态给下一步动作指引。

### 8.6 v0.4 页面变化

| 页面 | 变化 |
|---|---|
| `LoginPage` | 新增 `safeNext(raw)`：只接受 `/` 开头的站内相对路径，`//evil.com`、`http://…`、`javascript:` 一律落回 `/`（防开放重定向）。`next !== '/'` 时页面顶部提示「登录后将自动回到你刚才要去的页面」。原来的登录表单与其它交互完全保留。 |
| `HomePage` | Hero 主按钮改 `navigate('/login')`；试卷卡的「开始答题」未登录时带上 `next=/papers?start=<id>`。 |
| `QuestionsPage` | 加 `rowSelection`，勾选后从底部浮出 `.liti-batch-bar`（已选 N 项 / 目标分类 Select / 批量改分类 / 批量删除 / 取消）。单题删除按 `usedInPapers` 给两套文案：0 → 「确认删除？」，>0 → 「该题已被 N 份试卷引用，删除后题库中不再出现，但历史试卷仍可正常作答与查看」。 |
| `PapersPage` | 新建/编辑弹窗的「发布」改成 `publishOpen` 独立弹窗：Radio「所有学生 / 指定学生」+ 学生多选（带全选/清空/搜索）。列表新增「可见范围」列；学生视角新增「作答次数」列（`还可答 N 次` / `次数已用完`）。用 `useSearchParams` 读 `?start=`，进页面自动开考并清掉该参数。`Table scroll={{ x: 980 }}` 防窄屏横向溢出。 |
| `ExamPage` | 见 6.3.1 / 6.4 / 6.4.1。倒计时改为「服务端时钟 + 偏移量」；暂停时整页换成 `Result` 卡片；答题卡角标用 `.liti-sheet-flag`（白边黄点，绿底上也看得见）；违规遮罩改成带「我知道了，继续答题」按钮的 Modal，**返回标签页不会自动清掉**。 |
| `HelpPage` | 快速开始的「未登录」说法改成跳转；题库段补批量操作与软删除 Alert；组卷段补「指定学生可见」「最多 3 次」；答题段补标记/暂停说明；FAQ 新增「删掉的题会影响老试卷吗」「一份卷能考几次」。 |

---

## 9. 测试策略与门禁

| 层级 | 工具 | 代表用例 |
|---|---|---|
| 单元 | Vitest | 判分（单选/多选/未答）、乱序映射、抽样配额与边界(1/100/101)、倒计时与过期判定、Excel 行校验、密码/会话/RBAC |
| 集成 | Fastify inject + 临时 SQLite | 登录与 401/403、题库 CRUD、导入事务回滚、建卷→开考→存答案→违规累加→自动交卷→判分→解析、双用户并发独立乱序、超时拒答、即时解析模式 |
| 数据库 | 临时 SQLite + Docker MySQL | 两套方言跑同一批迁移与 CRUD；无 MySQL 时用 Docker 起 `mysql:8`，起不来则如实标记「未实测」，不冒充通过 |
| E2E | Playwright (Chromium) | 建题→导入→组卷→发布→答题→乱序验证→交卷→解析回看；模拟 `visibilitychange` 触发遮罩与第 3 次自动交卷；100 题整卷提交 |
| 验收 | 人工清单 | 需求逐条对照；真实 Alt+Tab 切窗需人工验证（自动化无法按系统级快捷键） |
| 版本验收脚本 | Node 脚本（`E:\workbuddy\网站优化\liti-features-v*.mjs`） | 纯 HTTP 打接口，对 Docker 部署实例逐条断言；每版一份，SQLite 与 MySQL 双跑 |

**门禁**：单元 + 集成 + E2E 全绿、当版验收脚本双库全绿、验收清单 100% 勾选、无已知 P0/P1 缺陷，才可提交。

**界面验收**：Docker 实例上用无头 Edge + CDP 截图（`liti-shot-v*.mjs`），逐张复查视觉问题。antd 的 label/按钮需 `Input.dispatchMouseEvent` 真实鼠标事件才响应；受控 input 赋值需用原生 setter 再派发 `input`/`change`。

---

## 10. 里程碑

| 阶段 | 内容 | 出口标准 |
|---|---|---|
| M1 地基 | 工程骨架、配置、迁移、用户/会话、登录与 RBAC、SQLite/MySQL 双方言 | 认证与双库测试通过 |
| M2 题库 | 题目 CRUD、分类、Excel 模板/预校验/导入/回滚 | 导入相关单测+集成+E2E 通过 |
| M3 考试核心 | 组卷、乱序、计时、自动保存、防切屏、判分、双模式解析 | 全链路集成+E2E 通过 |
| M4 收尾 | 成绩记录、部署文档、MySQL 实机冒烟、验收 | 全部门禁通过后提交 |
| M5 门面与导览（v0.3） | 公开接口、首页免登录门面、试卷预览三入口、Excel 题型下拉与批注、站内帮助文档、全站提示信息 | 49 项验收脚本双库全绿 + 界面截图复查 |
| M6 考试体验与控制（v0.4） | 登录跳转回跳、题库批量操作、题目软删除、3 次作答上限、暂停/继续、试卷可见范围、题目标记、切屏检测修复、镜像自建文档 | 84 项验收脚本双库全绿 + 20 项界面验收 + 8 张截图复查 |

---

## 附录 A：验收清单

| # | 需求 | 验收方式 |
|---|---|---|
| 1 | 界面录入题目 | E2E 建题并出现在列表 |
| 2 | Excel 批量导入 | 单测 + 集成 + E2E |
| 3 | 随机组卷 | 集成抽样断言 |
| 4 | 固定题目组卷 | E2E |
| 5 | 每卷 ≤100、题量自定义 | 边界测试 1/100/101 |
| 6 | 选项顺序随机 | 单测映射 + E2E 两次答题顺序不同 |
| 7 | 答题计时 | 单测 + 集成到点自动交卷 |
| 8 | 不可切窗 | E2E 违规遮罩 / 3 次交卷；真实切窗人工验证 |
| 9 | 交卷后逐题解析 | E2E |
| 10 | SQLite + MySQL 预留 | 仓储测试 + MySQL 冒烟 |
| 11 | SSO 预留 | 接口与单测（OIDC 骨架） |
| 12 | 首页展示统计 + 已发布试卷 + 登录输入（v0.3） | 未登录访问 `/` 可见三块；点卡片出卷面 |
| 13 | 未登录点「开始答题」提示登录（v0.3） | 弹确认框 → 聚焦登录框 |
| 14 | 公开预览不含答案（v0.3） | 断言响应无 `isCorrect` / `explanation`；草稿 404 |
| 15 | Excel 题型列下拉（v0.3） | 打开模板检查 A2:A1000 数据验证为 list |
| 16 | 新建试卷可预览（v0.3） | 「预览卷面」不落库，试卷总数不变 |
| 17 | 站内帮助文档（v0.3） | 未登录访问 `/help` 内容完整 |
| 18 | 保留原登录页，未登录点登录/开始答题跳登录页（v0.4） | 点 Hero「登录」进 `/login`；点试卷卡「开始答题」带 `next` 跳登录，登录后自动回跳并开考；`next` 白名单挡住站外地址 |
| 19 | 题目批量改分类 / 批量删除（v0.4） | 勾选多行浮出工具条；`POST /api/questions/batch` 逐条复核；空 ids 400、非教师 403 |
| 20 | 删除题目不影响历史试卷（v0.4） | 软删除后题库消失，但已发布试卷的预览/作答/解析仍能取到该题全文；删后同题干可重建 |
| 21 | 每份试卷最多答 3 次（v0.4） | 第 4 次 400；进行中答卷复用不占次数；`remaining_attempts` 递减 |
| 22 | 考试暂停：停表 + 屏蔽题面（v0.4） | 暂停中 `saveAnswer` 被拒、违规不计数、`review` 返回 `masked` 且无题面；恢复后 deadline 顺延 |
| 23 | 发布时指定可见 / 隐藏学生（v0.4） | `audience_mode=selected` + 名单；名单外 404（含公开列表与公开预览）；名单为空 400 |
| 24 | 答题标记并在答题卡体现（v0.4） | `PATCH /:id/flag` 落库，答题卡题号右上角黄点，刷新后仍在 |
| 25 | 修复切换窗口/标签页未记录（v0.4） | 三路监听 + 2s 去抖；CDP 实测切标签页记到违规，回来弹遮罩不自动消失 |
