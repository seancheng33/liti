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
| `user` | id, username, display_name, password_hash?, role, provider(local/oidc), external_id, status, prefs(JSON), **student_no**, **class_name** |
| `session` | id, user_id, token_hash, expires_at, ip, ua |
| `category` | id, name, parent_id, sort |
| `question` | id, type(single/multiple), stem, images(JSON), explanation, category_id, tags(JSON), status(active/archived), content_hash, created_by, created_at, updated_at |
| `question_option` | id, question_id, content, images(JSON), is_correct, sort_order |
| `paper` | id, title, mode(random/fixed), question_count, duration_sec, pass_score, review_mode, shuffle_options, random_config(JSON), status, practice, practice_source(random/wrong), audience_mode(all/selected), **start_at**, **end_at**, **allow_student_pause**, **per_question_score**, **results_published**, **analysis_published**, **max_attempts**, created_by |
| `paper_item` | id, paper_id, question_id, order_no, score |
| `paper_audience` | id, paper_id, user_id, created_at —— 可见白名单（点名到人） |
| `paper_audience_group` | id, paper_id, group_id, created_at —— 可见白名单（挂整个分组） |
| `student_group` | id, name(唯一), remark, created_by, created_at, updated_at |
| `student_group_member` | id, group_id, user_id, created_at |
| `attempt` | id, paper_id, user_id, started_at, deadline_at, submitted_at, status, score, correct_count, submit_reason, **paused_at**, **paused_total_ms**, **last_seen_at** |
| `attempt_item` | id, attempt_id, question_id, order_no, option_order(JSON), selected(JSON), is_correct, score, **flagged**, answered_at |
| `attempt_violation` | id, attempt_id, type, occurred_at, meta, **revoked_at**, **revoked_by**, **revoke_note** |
| `wrong_question` | id, user_id, question_id, wrong_count, first_wrong_at, last_wrong_at, last_attempt_id, resolved_at, created_at, updated_at —— **每人一份，(user_id, question_id) 唯一** |
| `import_batch` | id, filename, total, success, failed, errors(JSON), created_by, created_at |
| `audit_log` | id, at(**bigint**), actor_id, actor_name(快照), actor_role(快照), action, target_type, target_id, target_label(快照), detail(JSON), ip |
| `password_reset` | id, user_id, token_hash(**sha256hex(重置码)**), expires_at, used_at, created_by, created_at —— 库里只有哈希，明文码只在签发响应出现一次 |

> v0.4 新增字段：`attempt.paused_at` / `paused_total_ms`、`attempt_item.flagged`、`paper.audience_mode` + `paper_audience`（迁移 `0008_exam_enhance`）。
> v0.5 新增：`student_group` / `student_group_member` / `wrong_question` / `paper_audience_group`、`paper.practice_source`（迁移 `0009_practice_wrong_group`）。
> v0.7 新增：`paper.start_at` / `end_at` / `allow_student_pause` / `per_question_score` / `results_published` / `analysis_published`（迁移 `0010_exam_window`）；同期加索引 `idx_attempt_status_deadline`、`idx_attempt_paper`，给 30s 一次的自动收卷扫描用。
> v0.8 新增：`paper.max_attempts`（默认 3）、`user.student_no`（**varchar(32)**，全校唯一）、`user.class_name`（**varchar(64)**）+ 索引 `idx_user_student_no` / `idx_user_class_name`（迁移 `0011_exam_scale`）。
> v0.11 新增：`attempt.last_seen_at`（**bigint**，心跳时间）、`attempt_violation.revoked_at`（**bigint**）/ `revoked_by` / `revoke_note` + 索引 `idx_violation_attempt`（迁移 `0012_proctor`、`0013_fix_proctor_timestamps`）。
> v0.12 新增：`audit_log` 表 + 索引 `idx_audit_at` / `idx_audit_action` / `idx_audit_actor` / `idx_audit_target`（迁移 `0014_audit`）。`at` 同样是 **bigint**。
> v0.13 新增：`paper.shuffle_questions`（integer，默认 0 = 不打乱题序；迁移 `0015_shuffle_questions`）。题序写进既有的 `attempt_item.order_no`，不新增表。
> v0.14 新增：`password_reset` 表 + 索引 `idx_reset_user` / `idx_reset_expires`（迁移 `0016_password_reset`）。字段全部 **bigint** 时间戳，沿用「时间一律 epoch 毫秒」约定。

**v0.8 迁移的两个坑**（`0011_exam_scale`）

1. **学号不能用 `text`**：MySQL 不允许对 TEXT/BLOB 列建不带前缀长度的索引，报 `BLOB/TEXT column 'student_no' used in key specification without a key length`。所以学号/班级都用 `varchar(n)`。
2. **迁移必须幂等**：MySQL 的 DDL 会隐式提交，不在迁移事务里。中途失败会留下半截表结构（列加了、索引没加），而 Kysely 又不记录这次成功，重启后整段重跑就会撞 `Duplicate column`，服务起不来。所以迁移里先用 `db.introspection.getTables()` 查列是否存在再 `addColumn`，索引建在 try/catch 里放过 `already exist` / `Duplicate key name`。**新增迁移一律照这个写法**。

**可移植性约定（SQLite / MySQL 双库关键）**

- 时间统一存 **epoch 毫秒整数**，列类型一律 **`bigint`**，不用数据库原生日期类型，避免方言差异。**用 `integer` 会在 MySQL 上炸**（INT 是 32 位有符号，装不下 13 位毫秒，报 `Out of range value`），而 SQLite 的 INTEGER 本来就是 64 位，所以本地全绿、只在 MySQL 上出问题 —— 见 6.12.5 的真实事故。
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

### 6.4.2 作答次数上限（v0.4 引入，v0.8 改为按卷配置）

- v0.4 是写死的常量 `MAX_ATTEMPTS_PER_PAPER = 3`，对统考来说是硬伤——正式考试必须「一场只给一次」。v0.8 改成 `paper.max_attempts`（1–99，默认 3，建卷时填），常量退化成「老调用方不传时的兜底默认值」。
- 超限报错把上限和已用次数都写出来：「这份试卷最多可作答 1 次，你已用完 1 次」。只说「已达上限」学生看不懂。
- 统计只数 `status in (submitted, expired)` 的答卷，进行中的不算。
- 开考时若已有 `in_progress` 答卷且未过期，**直接复用**（返回同一个 id），不新开也不占次数 ——
  否则学生刷新几次就把次数用完了。
- 练习卷（`practice=1`）不受限，`remaining_attempts` 下发 `null`，前端显示「不限次数」。**注意别把 `null` 当 0**：`remaining_attempts ?? limit` 会把 null 洗成上限，`null || 0` 会把按钮禁掉。判断顺序必须是先判 `=== null`。
- 学生列表附带 `attempt_count / remaining_attempts`（按各自 `max_attempts` 算），前端据此把「开始答题」换成「次数已用完」。

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

### 6.4.5 错题库（v0.5）

- 一张表 `wrong_question`，**(user_id, question_id) 唯一**。所有接口只操作「当前登录用户」自己的数据，
  没有 `userId` 入参 —— 从接口形状上就杜绝了读别人错题本的可能。
- 写入时机只有一处：`gradeAttempt()` 判完分之后逐题写。所以错题必然来自**已交卷**的答卷，
  不会把考生还没考的题的答案提前暴露出去。
  - 答错（含空着没答）→ `wrong_count + 1`、`last_wrong_at`、`resolved_at` 置空
  - 答对 → `resolved_at = now`（"已订正"，记录保留，不删行）
- 列表默认只查 `resolved_at is null`；`?status=resolved|all` 可以看历史。
  查询用 `inner join question`（不要求 `status='active'`）：题目在题库里被删了，错题本照样要能复习。
- 错题详情返回选项、正确答案与解析：这是学生自己做错过的题，属学习用途；
  且这些题一定出现在**已交卷**的答卷里，不构成泄题。
- 错题练习抽题时额外要求 `question.status='active'` —— 归档题抽进练习卷没有意义。

### 6.4.6 自助练习卷（v0.5）

- `POST /api/attempts/practice` 的 `source` 决定题从哪来：
  - `random`（默认）：按分类规则随机抽，题量平均分配到所选分类（前端拆 `rules`）
  - `wrong`：从本人错题库抽 `count` 道未订正的题；不够时返回 400 并说明「只有 N 道」
- 练习卷落在 `paper` 表里（`practice=1`，`practice_source` 记来源），`review_mode='immediate'`、
  `status='draft'`（不进试卷列表）、不受 3 次上限约束。
- 站点设置 `practice_enabled=false` 时**服务端直接 403**，不只是前端藏按钮。
- 错题练习的题量默认值取 `min(10, 待订正数)` —— 否则默认 10、库存 3 时会一点就报错。

### 6.4.7 学生分组与分组可见（v0.5）

- `student_group` + `student_group_member`；只有 `role='student'` 的账号能进组（服务端校验）。
- 试卷挂的是 **`paper_audience_group.group_id`（分组引用）而不是展开后的学生名单**。
  所以往组里加人之后，之前发布的卷子他立刻也能看到；移出组立刻看不到。
  这是「名单快照」方案做不到的，也是分组的价值所在。
- 判定逻辑：`audience_mode='all'` → 全可见；`selected` → **点名（`paper_audience`）∪ 所在分组**，
  两者取并集，可以只挂分组、只点名，或两者混用。
- 过滤点与学生名下一致（列表、开考、公开列表、公开预览），名单外一律 404。
- 删除分组时同时删 `paper_audience_group` 里的引用，避免试卷指向不存在的组。

### 6.5 Excel 导入

- 模板列（12 列）：题型(单选/多选)、题干、选项A–D（预留到 F）、正确答案（`A` 或 `ACD`）、解析、分类、标签。
- 流程：下载模板 → 上传 → **预校验**（必填、答案字母合法、单选唯一答案、多选 ≥2、空选项、题干重复）→ 错误行报告 → 确认后事务导入。
- 支持「跳过错误行导入」与「全量回滚」两种模式；导入留批次记录，可追溯。

### 6.5.1 题库导出（v0.5）

- `GET /api/questions/export?keyword=&categoryId=&type=&status=` 导出 xlsx，**列结构与导入模板完全一致（12 列）**。
  这是刻意的：导出 → 在 Excel 里改 → 再导入，是闭环的，不需要手工对字段。
- 正确答案列按「非空选项的出现顺序」换算成字母（A、B…），与导入侧 `parseQuestionRows` 的算法一致，
  否则一来一回答案就错位了。
- 导出的表格**不含配图**（模板本来没有图片列），第二张「导出信息」工作表里写明了这一点，
  免得有人把它当完整备份。
- 单次最多 5000 行，超了在说明表里提示用筛选条件分批导出。
- 只有 admin/teacher 能导出；筛选条件与题库列表共用同一套参数。

### 6.6 双数据库

- 仓储接口 + Kysely 双方言，同一套实体类型。
- 迁移脚本双库可跑；启动时按配置自检连接。
- 切换只改 `DB_DRIVER` 与连接串，不碰业务代码。

### 6.7 SSO 预留

- `AuthProvider` 接口（`beginLogin / handleCallback / mapUser`），内置 `local` 实现 + OIDC 骨架。
- `user` 表带 `provider` + `external_id`，唯一键 `(provider, external_id)`；会话签发与认证方式解耦。
- 接入标准 OIDC 只需配置 issuer / clientId / clientSecret / redirectUri，不改代码；支持关闭本地密码登录、强制 SSO。

### 6.8 正式考试场景（v0.7）

前面那套是练习平台和当堂小测的底子，直接搬去当统考系统会漏东西——不是功能不够，是**考点没管住**。v0.7 补的六件事：

#### 6.8.1 考试时间窗口

- `paper.start_at` / `paper.end_at` 都是可空的 epoch 毫秒，都空 = 老行为（随时可考）。
- 开考校验：未到 `start_at` 返回 400「考试还没开始（YYYY-MM-DD HH:mm 开考）」，已过 `end_at` 返回 400「考试已经结束」。
- **截止时间取小**：`deadline_at = min(now + duration_sec * 1000, end_at)`。设 60 分钟但离考场关闭只剩 20 分钟，实际只给 20 分钟，不会出现「允许答到考场关门之后」。
- 练习卷（`practice=1`）不受 `end_at` 截断。

#### 6.8.2 收卷：手动 + 自动

- 教师手动：`POST /api/papers/:id/close` 把该卷所有 `status='in_progress'` 的答卷立即判分，`submit_reason='forced'`，返回 `{ closed }`。
- 系统兜底：进程内 30 秒一次的 sweeper 扫 `status='in_progress' AND deadline_at <= now AND paused_at IS NULL`，按已存答案判分（`expired`），单轮上限 200 条。
  - 用 `setInterval().unref()` 而不是 Fastify 钩子：`listen()` 之后再 `addHook()` 会抛 `Fastify instance is already listening`，进程直接崩（踩过一次，容器无限重启就是这么来的）。
  - `paused_at IS NULL` 这个条件不能少，否则暂停中的答卷会被当成超时判掉。
- 上线首次扫描顺手清掉了 41 份历史僵尸答卷（以前服务端重启留下的 `in_progress`）。

#### 6.8.3 暂停权限

- `paper.allow_student_pause` 默认 1。设 0 后 `POST /api/attempts/:id/pause` 直接 400「本场考试不允许自行暂停，如有特殊情况请联系监考老师」。
- 前端按 `review.allowPause` 决定渲不渲染暂停按钮，但**服务端才是裁判**，改前端没用。
- 练习卷不受影响。

#### 6.8.4 成绩与解析分开发布

以前一个 `review_mode` 把「给不给分」和「给不给答案」揉在一起，考场纪律上不够用。v0.7 拆成三个开关：

| 字段 | 作用 | 默认 |
|---|---|---|
| `results_published` | 学生能不能看到分数 | 1 |
| `analysis_published` | 学生能不能看到对错与解析 | 1 |
| `review_mode='never'` | 这卷永远不给答案（**优先级最高**） | — |

- 未发布时 `getAttemptReview` 里 `score` / `totalScore` / `correctCount` 一律 `null`，每题的 `isCorrect` / `score` 也是 `null`；`listMyAttempts` 同样屏蔽（列表里别人的分数不能成漏点）。
- `review_mode='never'` 压过 `analysis_published=1`——设了永不给答案就一定不给。
- 学生调 `POST /:id/publish-results` 一律 403。
- **前端拿到 `null` 必须显示「未公布」，不能 `score ?? 0`**——那等于把没公布的卷子显示成 0 分，学生当场投诉。

#### 6.8.5 及格判定与每题分值

- 旧逻辑前端写死 `percent >= 60`，及格线跟着题数漂：10 题错 4 题（60 分）算过，5 题卷子 3 分（60%）也算过，但 5 题卷子考 3 分其实只对了一半多一点。v0.7 改**绝对分比较** `score >= passScore`，`passScore` 由服务端下发。
- `per_question_score` 落在每条 `paper_item.score`，总分 = 题量 × 每题分值。
- 写入时及格分一律收敛为 `min(passScore, totalScore)`，避免「满分 50、及格线 60」这种永远不及格的卷子。显式传了 `perQuestionScore` 的场景下，及格分超总分直接 400 拒掉。

#### 6.8.6 成绩册要能交差

`GET /api/attempts/export?paperId=` 导出的 xlsx 以**应考名单为主表左连接答卷**：

- 应考名单：`audience_mode='all'` 取全体学生，否则点名 ∪ 所属分组（分组是引用不是快照，组里加人立刻算进来）。
- **缺考的行照样在表里**，状态列写「未参加」，分数列留空。教务要的是「应考 40 实考 38」，不是「38 条记录」。
- 第二张「考试信息」表给应考 / 已交 / 缺考 / 及格人数与及格率。
- 不带 `paperId` 时仍是全站答卷流水（逐条列）。

#### 6.8.7 有成绩的卷子不能物理删除

- `DELETE /api/papers/:id` 先数答卷。有答卷返回 400「这份试卷已有 N 份答卷，不能删除（成绩需要可追溯）；请改用『归档』」。
- 归档 `POST /:id/archive` → `status='archived'`：学生列表里消失，成绩册照样能导出，答卷与判分记录全留。这是唯一能「下线」又不丢历史的方式。

### 6.9 学校/考点规模能力（v0.8）

v0.7 把「一场考试的纪律」管住了，但**一个年级 400 人怎么进系统**没解决——手工一个个建账号，教务是不会用的。v0.8 补的是「成建制」的那部分。

#### 6.9.1 学号与班级

- `user.student_no`：全校唯一，可空（教师/管理员不需要）。格式限 `[a-zA-Z0-9_-]`，≤32 字符——学号里塞空格、斜杠、中文会对不上任何一份学校花名册。
- `user.class_name`：自由文本 ≤64 字符。**不做班级表**：学校的班级命名法五花八门（「高一(3)班」/「2026届3班」/「1班」），建一张表就得先做一套班级管理页面，收益不抵成本。班级目前是「标签」，不是「实体」。
- 学号唯一性在**服务端**校验并返回 409「学号 X 已被其他账号占用」，不靠数据库唯一索引兜底报错（那样前端只能看到一句 `UNIQUE constraint failed`）。索引照建，是最后一道保险。
- 编辑语义：`studentNo` 传 `undefined` = 不动，传 `null` = 清空。这两者必须区分，否则「只改班级」会把学号抹掉。

#### 6.9.2 学生名单批量导入

`GET /api/users/template` 下发 xlsx（6 列：用户名/姓名/学号/班级/初始密码/分组），`POST /api/users/import` 接收。与题库导入的三点不同：

1. **逐行独立提交，不是整批事务**。1000 人的表里错一行就全批回滚，教务会疯。改为每行自己一个事务：成功的进来，失败的进 `errors[]`，重名/重学号的进 `warnings[]` 并跳过。返回 `{ total, created, skipped, failed, warnings, errors, defaultPassword, ids }`。
2. **argon2 哈希按明文缓存**。初始密码通常全校统一，1000 行各算一次 argon2 会超时。按密码字符串做 Map 缓存，实际只算一次（argon2 默认参数单次约 50–100ms，1000 次就是 100 秒）。
3. **`dryRun=1` 只预检不写库**。前端流程是「上传 → 预检 → 看报告 → 确认导入」，预检和正式导入走同一段代码，只是最后不落库，避免「预检说没问题、真导却炸了」。

分组按**名字**匹配现有分组，匹配不上只记 warning 不报错（不因为一个组名打错就让整批人进不来）。默认密码 `student123`，返回给管理员用于告知学生。

#### 6.9.3 成绩册按班级导出

`GET /api/attempts/export?paperId=&className=`。v0.7 的成绩册是「整场一张表」，一个年级 400 人全在一起，班主任没法用。现在：

- 列首改为**学号**（教务认学号不认用户名），列序：学号 / 姓名 / 班级 / 用户名 / 成绩 / 总分 / 是否及格 / 答对 / 题数 / 状态 / 开始时间 / 交卷时间 / 交卷原因。
- `className` 过滤作用在**应考名单**上（不是答卷上），所以「本班应考 40 人、实考 38 人」照样成立，缺考的人还在表里。
- 整场导出时按「班级 → 学号 → 用户名」排序，同班的人聚在一起，方便剪开分发。
- 「考试信息」表在按班导出时额外给三行：本次导出班级 / 该场应考总人数 / 本班应考人数。没有这三个数字，拿到表的人无法判断这份表全不全。

### 6.10 逐题分析（v0.9）

成绩册回答的是「谁考了多少」，教研要问的却是「哪道题出坏了」。v0.9 补的是后者：P 值、D 值、选项分布、分数段。

#### 6.10.1 四个口径必须先定死

同一批答卷能算出四组不一样的数字，全看口径。这里定的是教育测量的通行做法：

| 口径 | 取法 | 为什么 |
|---|---|---|
| 统计哪些答卷 | 只算 `submitted` / `expired` | 进行中的答卷没有分数，算进来会把平均分拉低 |
| 一人多份怎么办 | 每人取**最近一次**，与成绩册一致 | 两次都算会让样本凭空翻倍，P 与 D 都被稀释 |
| P 值的分母 | **实考人数**（未作答按答错计） | 只除「答了的人」的话，有人交白卷的卷子会显得题目比实际简单 |
| 分数段宽度 | 满分 10 等分，最后一档顶到满分 | 否则满分的人会被归进「27–29」这种装不下的区间 |

#### 6.10.2 P 值、D 值与判断

- **P 值** = 答对人数 ÷ 实考人数。0.3–0.85 算合适区间。
- **D 值** = 高分组正确率 − 低分组正确率，高低分组各取总分前/后 **27%**（教育测量学的经典比例）。
- **样本不足 8 人时 D 值一律给 `null`**，前端显示「—」。给个假数字比不给更糟 —— 5 个人的前后 27% 各只有 1 人，D 值只能是 0 或 ±1，毫无意义。
- 逐题判断按这个优先级取一个：`D<0` → **疑答案有误**（差学生反而答对更多，绝大多数是正确答案标反）→ `P≤0.1` 偏难 → `P≥0.95` 偏易 → `D<0.2` 区分度低 → 其余正常。
- `flags[]` 是并列的补充说明（全体未作答、未作答 N 人、无人答对、全部答对、D 值为负…），不和 `verdict` 抢主判断。

#### 6.10.3 选项分布

- 按**选项 ID** 计数。选项顺序每次开考都洗过，但存的 `selected` 是 ID，不受洗牌影响——所以按 ID 计数天然正确，不需要还原顺序。
- 展示时按 `question_option.sort_order` 排回原始 A/B/C/D。教研要分析的是「这个干扰项设得好不好」，看乱序后的位置没有意义。
- 未作答单独计一列（橙色条），否则「没人选」和「没人答」分不清。

#### 6.10.4 前端怎么呈现

- 六个统计卡（实考/应考、平均分、及格率、中位数、标准差、平均用时）+ 一张纯 CSS 直方图。**不引图表库**：柱子就是几个 `div`，为几张柱状图装一个 ECharts 不划算。
- 表格支持「只看需关注」，把 `verdict !== 'normal'` 的题筛出来 —— 40 道题的卷子里真正要复盘的可能就 5 道。
- 展开行给选项分布条 + 高/低分组正确率，教师不用来回切换页面。
- 页面底部常驻一段「这些数字怎么读」，把 P/D 的定义与经验区间写清楚。**不给定义只看数字，等于让人凭感觉猜。**

#### 6.10.5 练习卷不支持分析

练习卷每人抽的题都不一样，横向比较没有意义，接口直接 400「练习卷每人的题目都不一样，无法做逐题分析」，而不是返回一张空表让人以为没人做。

### 6.11 答案保存容错（v0.10）

考试现场的网络不会一直好。原来的实现是「点一次选项就 `fetch` 一次，失败弹一条红字」，有三个各自独立的问题：

1. **会脏数据**：快速连点会并发发出多个 PATCH，服务端按到达顺序处理，后发的可能先到 → 库里留下旧答案。请求完成顺序 ≠ 发出顺序，这是浏览器给的，不是网络慢才有的。
2. **会丢答案**：断网那几下的请求失败了，除了弹红字没有任何补救，学生以为存好了。
3. **会丢最后几题**：交卷不等答案落盘，最后改的题大概率没赶上。

#### 6.11.1 前端队列（`web/src/answerQueue.ts`）

- **按题合并 + 去抖 250ms**：连点三次只发一次请求。同一题**永远串行**，每次 `set` 递增一个 `seq`，响应回来时比对 `seq`——版本变了就说明期间又改过，保留新值再发一轮。
- **失败分级**：拿不到 HTTP 状态（断网 / 连接被拒）、5xx、429、408 才重试；400 / 403 / 404 是终态错误，重试也是同样结果，直接丢弃并回报给调用方（通常是「答卷已结束」这类）。
- **退避**：800ms → 1.6s → 3.2s → 6.4s，最多 4 次。之后标记 `stuck`：值**留着**，只是不再自动发。
- **stuck 不会躺到交卷**：排一个 15s 的兜底定时器再试一轮，同时监听 `window.online` 立刻重试一次。网络恢复后不需要学生做任何操作。
- **关页面尽力发**：`pagehide` 时用 `fetch({ keepalive: true })` 逐题补发——普通的 `fetch` 在 pagehide 之后会被浏览器取消，`sendBeacon` 又不能带 `Content-Type: application/json`，`keepalive` 是唯一能用的。
- **状态暴露给 UI**：`idle / saving / retrying / stuck / ok`，顶部状态条据此显示「保存中…」「网络不稳，N 题重试中」「N 题未同步」「答案已保存」。
- **不再弹错**：考试中弹红字只会让学生慌。失败由顶部状态条如实呈现，队列自己重试。

#### 6.11.2 交卷快照（兜底的那一次请求）

`POST /api/attempts/:id/submit` 接受可选的答案快照：

```json
{ "answers": [{ "questionId": 12, "selectedOptionIds": [101] }] }
```

- 前端只带**还没落盘**的题（落盘过的服务端已经有了），请求体通常很小甚至为空。
- 服务端顺序是：校验归属 → 暂停中先 resume → **查超时** → 落快照 → 判分。
  - 落快照必须在判分之前，判分读的就是 `attempt_item.selected`。
  - **必须在查超时之后**：否则「拖到最后一秒再把答案塞进来」就成立了。
- 卷外的 `questionId`、不属于该题的选项 id 一律静默过滤，交卷不能因为一条脏数据失败。
- 返回 `{ ok: true, applied: N }`，N 是实际写进去的条数。
- 不传 body 照常交卷——自动收卷、老客户端走的都是这条路。

#### 6.11.3 边界

- 浏览器**崩溃**（不是正常关闭）时 `pagehide` 不一定触发，本地队列在内存里随之消失。已经落盘的答案不受影响，但「未同步」的那几题会丢。帮助页的措辞按这个事实写，不说「崩溃也不丢」。
- 队列状态不持久化到 `localStorage`：交卷后应该清空，持久化反而会污染下一次考试；而崩溃恢复已经由服务端的 `in_progress` 答卷 + 已落盘答案覆盖。

---

### 6.12 实时监考与违规撤销（v0.11）

成绩册回答「考完之后」，逐题分析回答「题出得好不好」，监考回答的是**此刻考场里发生了什么**：谁在答、谁掉线、谁被记了违规。

#### 6.12.1 在线判定用轮询，不用 WebSocket

学生答题页每 20 秒 `POST /api/attempts/:id/heartbeat`，服务端只做两件事：刷新 `attempt.last_seen_at`，把当前状态回给前端。

为什么不挂 WebSocket：考场的网络常常是「能发 HTTP、长连接被掐」的代理环境，长连接一断就是整片显示掉线，而且断了之后要重连、要处理重连期间的补发。20 秒一次的 HTTP 心跳在断网恢复后自己就接上了，代价只有一个 `bigint` 字段。

判定阈值 `OFFLINE_AFTER_MS = 90_000`（容得下连丢 4 次心跳）。三种取值要分清：

| 值 | 含义 |
|---|---|
| `true` | 90 秒内有过心跳 |
| `false` | 超过 90 秒没心跳 —— 掉线 |
| `null` | **判不了**：还没开考、已交卷、正在暂停，或者这条答卷从没上报过心跳（升级前打开的页面） |

`null` 和 `false` 必须分开：前者是「不知道」，后者是「确定失联」。把 `null` 当掉线会让刚开考的考场一片飘红。

#### 6.12.2 暂停中不判在线

学生主动点「暂停」时，`online` 直接给 `null`，状态显示「已暂停」。人可能就坐在那儿，只是不想让计时跑 —— 这时标他掉线毫无意义。

#### 6.12.3 心跳顺带解决一个老问题

原来学生被强制收卷（违规满 3 次 / 教师统一收卷 / 到点超时）之后，页面毫无察觉，还在那儿答题，直到他点「交卷」才发现卷子早收了。

现在心跳会回 `status`，前端一发现不是 `in_progress` 就自己跳结果页。心跳也顺带做惰性超时判分 —— 学生的页面上唯一保证在跑的周期任务就是它，比等 sweeper 的 30 秒窗口更及时。

#### 6.12.4 违规可撤销

`attempt_violation` 原来只进不出，一条误报（按 F5、输入法候选窗、系统弹窗抢焦点）就永久占掉三次额度里的一个。

现在加了 `revoked_at / revoked_by / revoke_note` 三个字段，做**软撤销**：

- 行保留，只是标记成已撤销 —— 事后翻记录能看到「这里曾经记过一次，被谁在什么时候撤了，理由是什么」。
- `countActiveViolations()` 只数 `revoked_at IS NULL` 的，所以**撤销一条，学生就重新获得一次额度**。
- **撤销不会把已经强制交卷的答卷改回答题状态**。这个边界是故意的：收卷是既成事实，分数该不该补是教务的判断，不是一次点击能做的。页面上专门写了这条提示。
- 撤销错了可以 `restore` 加回来（把三个字段清空）。重复撤销 / 重复恢复都返回 400，不静默成功 —— 老师点了两次应该看到「已经由 XXX 撤销过」。

#### 6.12.5 MySQL 的 INTEGER 装不下毫秒时间戳（真实事故）

0012 最初把 `last_seen_at` 和 `revoked_at` 写成了 `integer`。SQLite 上一切正常（它的 INTEGER 本来就是 64 位），但 MySQL 的 INTEGER 是 **32 位有符号**，上限 2147483647，而 `Date.now()` 是 13 位（约 1.79e12）。

结果：MySQL 上**开考直接 500**，报 `Out of range value for column 'last_seen_at'`。

修法是 0013：MySQL 上 `ALTER TABLE ... MODIFY COLUMN ... BIGINT NULL`，SQLite 跳过（它不支持 MODIFY COLUMN，也没有这个问题）。0012 本身也改成了 `bigint`，全新库直接就是对的。

**记死这条：项目里所有存毫秒时间戳的列必须是 `bigint`**，与 `started_at` / `created_at` / `expires_at` 保持一致。这个问题有个讨厌的特点：SQLite 全绿，只有在 MySQL 上才炸。

#### 6.12.6 练习卷没有考场

`GET /api/papers/:id/proctor` 对 `practice=1` 直接 400「练习卷没有考场，无法监考」。练习卷是学生自己抽题自己练，不存在「一场考试」，硬给一张监考表只会让人误以为有人在考。

### 6.13 审计日志（v0.12）

学校采购时一定会问同一类问题：**这份卷子是谁在什么时候发布的？这个学生的密码是谁重置的？上周三那次强制收卷是谁点的？**

答题、违规、成绩这些数据本身都带时间戳，但**谁操作的**以前只活在会话里 —— 会话一过期就查无此人。审计日志补的就是这一层。

#### 6.13.1 显式埋点，不用全局 hook

最省事的做法是挂一个 `onResponse` 钩子，把所有非 GET 且返回 2xx 的请求都记下来。**没有这么做**，原因很直接：钩子只能拿到 `POST /api/papers/12/archive`，不知道被归档的卷子叫什么，也不知道这次操作改了什么。

审计的价值在于「人能读懂」，所以每个关键路由显式调一次：

```ts
await audit(db, request, {
  action: 'paper.archive',
  targetType: 'paper',
  targetId: id,
  targetLabel: await paperLabel(db, id),
});
```

代价是新增路由时容易漏记 —— 这是有意的取舍：**漏记可以补，记一堆读不懂的 URL 补不回来**。动作清单集中在 `server/src/audit/actions.ts`，加动作只改那一处，前端的中文标签通过 `GET /api/audit/meta` 拿，不维护第二份。

#### 6.13.2 名字存快照，不 join 现查

`actor_name` / `actor_role` / `target_label` 都是**写入那一刻抄下来的**，不与 `user` / `paper` 表 join。

理由是审计要回答的是「**当时**是谁、动的是**哪一份**」：

- 用户改名之后，join 出来是新名字，历史记录跟着一起变，等于篡改。
- 用户被删之后，join 出来是 `NULL`，最需要追责的一条线索正好消失。
- 试卷归档、题目软删之后，`target_label` 还能让你看懂当时动的是什么。

`actor_id` / `target_id` 仍然保留，只作筛选用的索引，不做展示。

#### 6.13.3 不记学生的答题流水

边界画在「管理动作」上：发布、归档、删数据、改设置、重置密码、撤销违规、导出 —— 以及登录。

**开考、存答案、交卷不进审计表**。这些动作在 `attempt` / `attempt_item` 里本来就有时间戳，翻答卷更直接；一学期几十万条答题记录会把真正要查的那几条彻底埋掉。

一个例外是**系统自动收卷**（`attempt.auto-close`）：无人操作但改了成绩，学生来问「我没交怎么会是超时」时，这条记录能说清是哪个时间点收的。

#### 6.13.4 写日志失败不能拖垮业务

`writeAudit()` 内部 `try/catch` 吞掉所有异常，只往控制台打一行：

```ts
catch (e) {
  console.error('[audit] 写入失败，已忽略：', action, e);
}
```

审计是**旁路**。一张表写不进去就让「发布试卷」跟着失败，等于用日志把主业务绑死。代价是极端情况下会丢记录 —— 考试期间宁可漏一条日志，也不能让学生交不了卷。

#### 6.13.5 LIKE 的方言坑：`%` 必须剔，`_` 必须留

关键字搜索用 `LIKE '%kw%'`。常见写法是把 `%` `_` 转义成 `\%` `\_`，但**两种库的默认 ESCAPE 不一样**：MySQL 默认把反斜杠当转义符，SQLite 的 LIKE 没有默认 ESCAPE。同一个 `\%` 在 MySQL 匹配字面百分号、在 SQLite 变成「反斜杠 + 任意串」。

所以改成先清洗再加通配符，只剔 `%` 和反斜杠：

- `%` 是「任意串」，留着会把筛选变成全表命中，必须剔。
- `_` 是「任意单字符」，**必须留** —— 学号、用户名里全是下划线（`2024_001`、`v12_123456`），剔掉这些搜索全部失效。这一条是实测出来的：第一版连 `_` 一起剔，`C9 关键字能命中对象名称` 当场挂掉。
- 反斜杠在 SQLite 里会被当普通字符，剔掉是为了两边行为一致。

#### 6.13.6 清理日志不能删掉「谁清过日志」

`POST /api/audit/purge` 的执行顺序是固定的：

1. 先数出要删多少条；
2. **写一条 `audit.purge`**（记谁、什么时候、删到哪个时间点、删了多少）；
3. 再执行 `DELETE ... WHERE at < before AND action != 'audit.purge'`。

那个 `action != 'audit.purge'` 是关键：**清理记录永远不能被后续清理删掉**。否则「有人清过日志」这件事会随着下一次清理一起消失，而这恰恰是审计里最该留痕的动作。

另外 `before` 不允许超过服务端当前时间（「不能清理未来的日志」）。前后端时钟差 2 秒都会踩到这条 —— 测试脚本里必须用 `GET /api/health` 返回的 `time` 当基准，别用本机的 `Date.now()`。

#### 6.13.7 只有管理员能看

教师也能看的话，等于把「谁给谁重置了密码」「谁改了自己的班级」这类横向信息全打开了。需求上教师没有这个必要权限，学校也不会愿意。

所以 `GET /api/audit*`、`/meta`、`/export`、`/purge` 全部 `requireRole(user, 'admin')`；前端入口、帮助章节也按 `role === 'admin'` 隐藏。

注意教师**直接输入地址**仍能进页面（前端路由没有守卫），但接口 403，页面是空的 —— 数据安全靠服务端，前端隐藏只是顺手。

### 6.14 题序乱序（v0.13）

「选项乱序」从 v0.3 就默认开着：同一道题的 ABCD 在每个学生屏幕上位置不同。但它挡不住最土的那种抄法 —— 两个人对着卷面报「第 3 题选 B」，只要**题目顺序**一样，照样能对上。v0.13 补的就是这一层。

#### 6.14.1 顺序在开考那一刻定，落库不改

`attempt_item` 本来就有 `order_no`（这份答卷里第几题）。改动只有两处：

```ts
// 开考时按卷配置决定要不要打乱
const items = paper.shuffle_questions === 1 ? fisherYates(paperItems) : paperItems;
// 写答卷时用「打乱后的位次」，而不是 paper_item.order_no
order_no: i + 1
```

**绝不能在读答卷时现打乱。** 如果每次 `GET /api/attempts/:id` 都重新洗一遍：

- 学生翻回上一题，题干变了；
- 答题卡的「第 3 题」在两次刷新之间指向不同的题；
- 断网重连、换设备各拿到一套顺序，答过的答案看着像是错位。

所以顺序是**一次性事实**，和 `option_order` 一样存在答卷里。

#### 6.14.2 默认关闭，和选项乱序相反

`shuffle_options` 默认 **1**，`shuffle_questions` 默认 **0**。这个不对称是有意的：

- 选项乱序**不改变任何指代** —— 「第 3 题选 B」里的「第 3 题」还是同一道题，师生照常沟通。
- 题序乱序**改变指代** —— 学生说「第 3 题不会」，老师打开卷面看到的是另一道题。

后者是真实的教学摩擦，得让老师知情后自己开，不能替他默认。前端表单同样默认不勾，tooltip 里直接写明这个代价。

#### 6.14.3 判分、统计、分析一律不看题序

- **判分**：`attempt_item` 按 `question_id` 定位，提交数组的顺序无关（v0.13 验收 D7 专门用倒序提交验了一遍）。
- **逐题分析**：`analysis.ts` 用 `paper_item.order_no` 排序，始终是**出题顺序**，不会因为学生卷面不同而错位。
- **监考视图**：`answeredCount` 数的是行数，与顺序无关。
- **教师预览**：永远按卷面顺序渲染 —— 老师看的是这份卷子，不是某个学生的卷。

#### 6.14.4 乱序不是访问控制

乱序只是「让抄袭变麻烦」，不是安全边界。答案与解析的下发仍然由 `review_mode` / `analysis_published` 决定（服务端遮罩），题目在暂停时仍然整体不下发。别把乱序当成防作弊的终点。

### 6.15 找回密码（v0.14）

学校场景里的现实问题：学生名单批量导入后全校初始密码是同一个（见已知边界 28），谁改过密码、谁忘了密码，只能找管理员进后台改。v0.14 给教师也开了个口子 —— 教师在自己的电脑上就能给学生签发重置码，学生拿码自助改密，管理员不用当「改密码窗口」。

#### 6.15.1 一次性重置码：库里有哈希没明文

流程是「签发 → 线下转交 → 兑换」三步，码本身是主角：

- **签发** `POST /api/users/:id/reset-code`（admin/teacher，教师仍受 `assertTeacherMayManage` 约束只能给学生签）：生成 8 位 base32 码，字母表 `ABCDEFGHJKMNPQRSTUVWXYZ23456789` —— **去掉 0/O/1/I/L**，这五个字形太容易混，学生抄在纸上根本分不清。
- **库里只存 `sha256hex(code)`**。明文只在签发响应里出现**一次**，接口不提供「再看我刚发的码」 —— 弹窗关了又没抄下来，就重发一个。数据库拖走也换不出能用的码。
- **有效期 30 分钟**（`RESET_CODE_TTL_MS`），`expires_at` 到点作废；兑换成功即写 `used_at`，**单次有效**。
- **同一账号只认最新一码**：签发新码时先把旧的未用码全部作废。学生手上留了两张纸也不怕，只有最后那张能用。

兑换走公开端点 `POST /api/auth/reset-password`，body 是 `{username, code, newPassword}`。服务端按 `user_id + token_hash + used_at IS NULL + expires_at > now` 查最新一条，命中才改密码。

#### 6.15.2 兑换端是公开的，所以限流和不透露都要做齐

兑换端点不需要登录（忘了密码的人恰恰登录不了），这扇门必须按公开接口对待：

- **失败统一话术**：「重置码无效或已失效」。用户名不存在、码错、码已用过、码过期，四种情况返回完全一样的 400 —— 不给「这个用户名存在」的探测口子。
- **限流复用 `FailBucket`**：按 `用户名|IP` 5 次/10 分钟 + 单 IP 20 次/10 分钟。8 位无歧义字符表约 33⁸ ≈ 1.4 万亿种组合，但限流防的不是暴力破解单个码，是防有人拿全校名单逐个试。
- **审计不记明文码**：失败记 `auth.reset-failed`，`detail.reason` 只有 `no-such-user` / `no-match` / `used` / `expired` —— 审计端管理员能看到失败分布，但拿不到任何可复用的码。成功记 `auth.reset-password`（critical），签发记 `user.reset-code`（sensitive），detail 只含 username 与过期时间。
- **改密即清会话**：与「本人改密码」同一套语义（v0.6），重置成功后该账号所有会话作废 —— 万一是别人捡了码改的，原设备立刻掉线。

#### 6.15.3 为什么不走邮件/短信链接

局域网部署的学校大多没有可达的 SMTP 和短信网关，「发链接」这条路在目标环境根本走不通。重置码是纸面可传递的：老师念一遍、学生抄下来、30 分钟内自己在登录页改掉。代价是码会经过人手 —— 所以把 TTL 压到 30 分钟、单次有效、签发留审计，三条兜住「纸条被第三个人捡到」的风险窗口。

---

## 7. API 设计（草案）

```
# 认证
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
POST   /api/auth/reset-password        # 忘记密码兑换：{username, code, newPassword}（公开，限流 5次/用户名·IP + 20次/IP，10 分钟）
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
GET          /api/questions/export           # xlsx，列结构与模板一致（导出→改→导入 闭环）

# 学生分组
GET/POST     /api/groups
PUT/DELETE   /api/groups/:id
GET          /api/groups/:id/members
PUT          /api/groups/:id/members         # { userIds } 覆盖式设置，只收学生

# 错题库（只操作当前登录用户自己的）
GET          /api/wrong-questions            # ?status=active|resolved|all&categoryId=&keyword=
GET          /api/wrong-questions/summary    # 待订正总数 + 按分类分布 + 最弱分类
GET          /api/wrong-questions/:questionId # 详情：选项、正确答案、解析、错误次数
DELETE       /api/wrong-questions/:questionId
POST         /api/wrong-questions/batch-remove

# 试卷
GET/POST     /api/papers                     # 列表：学生只拿到已发布 + 自己可见的
GET/PUT/DELETE /api/papers/:id
POST         /api/papers/:id/publish         # body 可带 { audienceMode, audienceUserIds }
GET          /api/papers/:id/audience        # 可见名单（学生 + 分组）
PUT          /api/papers/:id/audience        # { audienceMode, audienceUserIds, audienceGroupIds }
POST         /api/papers/random-preview      # 抽样题号预览（不落库）
POST         /api/papers/draft-preview       # 新建时按表单入参预览整卷（不落库）
GET          /api/papers/:id/preview         # 已存在试卷预览（草稿也可，需教师/管理员）
GET          /api/papers/:id/proctor         # 实时监考：应考名单 + 每人状态（教师/管理员，练习卷 400）
POST         /api/papers/:id/archive         # 归档：学生看不到，成绩与答卷全留
POST         /api/papers/:id/publish-results # { results?, analysis? } 分开发布成绩 / 解析
POST         /api/papers/:id/close           # 强制收卷：所有进行中的答卷立即判分

# 学生名册 / 用户管理（v0.8）
GET          /api/users/students             # 发布挑人 / 建组挑人；带学号班级
GET          /api/users/classes              # 班级去重列表（admin/teacher），给筛选与导出下拉用
GET          /api/users/template             # 学生名单导入模板 xlsx（admin/teacher）
POST         /api/users/import               # { dryRun:1 } 只预检；逐行独立提交，返回 warnings/errors
POST         /api/users/:id/reset-code       # 签发一次性重置码（admin/teacher，教师只能给学生；返回 {code, expiresAt}，明文只出现这一次）

# 答题
POST         /api/attempts                   # 开考（复用进行中答卷；超出该卷 max_attempts 报 400）
POST         /api/attempts/practice          # 自助练习：source=random|wrong（错题练习走 wrong）
PATCH        /api/attempts/:id/answers       # 自动保存
PATCH        /api/attempts/:id/flag          # 题目标记
POST         /api/attempts/:id/pause         # 暂停：停表 + 服务端屏蔽题面
POST         /api/attempts/:id/resume        # 继续：deadline 按暂停时长顺延
POST         /api/attempts/:id/violations    # 违规上报（暂停中忽略）
GET          /api/attempts/:id/violations    # 违规明细（含已撤销），教师/管理员
POST         /api/attempts/:id/violations/:vid/revoke    # 撤销误报（软撤销，body 可带 note）
POST         /api/attempts/:id/violations/:vid/restore   # 恢复一条被撤销的违规
POST         /api/attempts/:id/heartbeat     # 学生端每 20s 一次；回 status/serverNow/violations
POST         /api/attempts/:id/submit        # 交卷；body 可带 { answers: [{questionId, selectedOptionIds}] } 快照兜底
GET          /api/attempts/:id               # 答卷详情与解析（未发布时分数/对错一律 null）

# 审计日志（仅管理员；教师/学生 403）
GET   /api/audit                             # 列表：category/action/severity/actorId/targetType/targetId/keyword/from/to/page/pageSize
GET   /api/audit/meta                        # 动作字典（分类树 + 标签 + 分级）+ 操作人下拉 + 对象类型
GET   /api/audit/export                      # 导出 CSV（带 BOM），筛选参数与列表一致，本身也留痕
POST  /api/audit/purge                       # 清理 before 之前的记录；清理动作自身永不删除
GET          /api/attempts?mine=1            # 我的记录
GET          /api/attempts/export            # 全站答卷流水 xlsx；?paperId= 单场成绩册（含缺考）；?className= 按班导出
GET          /api/attempts/analysis          # 逐题分析：?paperId=&className=（P 值/D 值/选项分布/分数段）
GET          /api/attempts/analysis/export   # 逐题分析 xlsx（逐题 / 分数分布 / 考试信息 三张表）

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
/practice    练习中心      v0.5（随机练习 + 错题练习 + 最近错题）
/wrong       我的错题本    v0.5
/questions   题库
/categories  分类管理
/groups      学生分组      v0.5（admin/teacher）
/exam/:id    答题页
/attempts    我的记录
/review/:id  结果与逐题解析
/stats       统计
/users       用户管理     admin 全部；teacher 只看学生
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

### 8.7 v0.5 页面变化

| 页面 | 说明 |
|---|---|
| `PracticePage`（新增，`/practice`） | 练习中心。顶部三张统计卡（待订正错题 / 最需要补的分类 / 错题分类分布）；下面并排两张卡：随机练习（分类多选 + 题量 + 时长，多分类按题量平均分，实时提示「每个分类抽几题」）与错题练习（题量默认 `min(10, 待订正数)`，可限定某个分类的错题，带「全选错题」快捷按钮）；底部「最近错题」5 条，点进错题本。 |
| `WrongQuestionsPage`（新增，`/wrong`） | 我的错题本。状态 Tab（待订正 / 已订正 / 全部）+ 分类筛选 + 题干搜索；表格列出题干摘要、错误次数、分类、最近答错时间；勾选可批量移除；「查看」弹详情（选项标出正确答案 + 解析）；右上角「用错题练一遍」直接生成错题练习卷。 |
| `GroupsPage`（新增，`/groups`） | 学生分组（admin/teacher）。表格列出分组名、说明、人数、创建时间；「管成员」弹窗多选学生（全选/清空/已选计数）；删组有二次确认并提醒「只对这个组可见的卷子会没人能看到」。 |
| `PapersPage` | 发布弹窗改「指定学生 / 分组」：先选分组（显示每组人数），再点名个别学生，两者取并集；列表「可见范围」列显示「N 人 / M 组」。页头「随机练习」按钮改成跳「练习中心」。 |
| `UsersPage` | 教师进入时标题为「学生管理」、只列学生、隐藏角色单选（只能建学生）、编辑时不提交角色；列表新增「分组」列显示该学生所在分组。 |
| `QuestionsPage` | 新增「导出」按钮，href 带上当前筛选（关键词/分类/题型），所见即所得。 |
| `AppLayout` | 菜单新增「练习中心」「错题本」（所有角色）、「学生分组」（admin/teacher）；「用户管理」对教师显示为「学生管理」。 |
| `HelpPage` | 新增「练习中心与错题本」「学生分组与账号」两章；角色表与发布说明同步更新；FAQ 新增「错题是怎么进来的」「分组和指定学生的区别」「导出的表格能改完再导回去吗」。 |

### 8.8 v0.7 页面变化

| 页面 | 说明 |
|---|---|
| `PapersPage` | 新建弹窗加「每题分值」「考试组织（开考/结束时间 + 学生可自行暂停）」；「公布方式」四选一（交卷后公布 / 考完统一公布 / 答题中即时反馈 / 永不公布）拆成 `reviewMode` + `resultsPublished` + `analysisPublished` 三个字段提交；实时显示「N 题 × X 分 = 满分 Y 分，及格线 Z 分（P%）」。列表列改成「题量 · 总分」「考试时间（三态 Tag + 时间区间）」「可见」；操作列只留预览与开始答题，收卷 / 公布 / 导出成绩 / 归档 / 删除收进「更多」下拉（九个链接平铺会撑爆一行）。 |
| `ReviewPage` | 成绩未公布时显示「成绩尚未公布」，解析未公布时显示「答案与解析暂不公布」；选项配色分三态——绿=正确答案、红=你选错的、橙标记=你选的（**未公布时底色走中性灰，不能用主题色，本项目主题色本身就是绿，涂上去像答对**）；得分未公布显示「得分未公布」而不是 0。及格判定改 `score >= passScore`。 |
| `ExamPage` | `review.allowPause === false` 时不渲染暂停按钮，两处提示文案按权限分支。 |
| `MyAttemptsPage` | 分数为 `null` 显示「待公布」，答对数为 `null` 显示「—」。 |
| `HomePage` | 试卷卡片显示「满分 X · 及格 Y」；未到开考 / 已结束给出提示，开始按钮按时间窗口禁用。 |
| `PaperPreviewModal` | 显示「满分 X · 及格 Y」；`reviewMode` 文案支持 `never`（永不公布）。 |

### 8.9 v0.8 页面变化

| 页面 | 说明 |
|---|---|
| `UsersPage` | 列改为 ID / 用户名 / 姓名 / **学号** / **班级** / 角色 / 状态 / 分组 / 操作；**删掉「来源」「创建时间」两列**——两列价值最低，却把操作列挤成了竖排。SSO 来源改成用户名旁的小 Tag。顶部加筛选条（题干搜索 + 班级下拉 + 「共 N 人」），`useMemo` 前端过滤（用户数量在「一个年级几百人」量级，一次拉全量比每敲一个字打一次接口好）。页头加「导入学生名单」，新建/编辑弹窗加学号、班级字段。`scroll={{ x: 1090 }}` + 操作列 `fixed: 'right'`，防止窄屏横向溢出时按钮跟着滚走。 |
| `AuditPage`（新增，`/audit`） | 审计日志页，仅管理员。筛选 6 项（类别/动作/操作人/分级/时间范围/关键字）+ 分级染色 Tag + 展开看 JSON 详情 + CSV 导出 + 清理弹窗。详见 8.11。 |
| `UsersPage` 导入弹窗 | 三步式：① 下载模板（链接带 `download`，走 cookie 鉴权）② 上传 → 先跑 `dryRun=1` 预检 ③ 看结果报告（成功 / 跳过 / 失败三个 Tag + 错误表 + 警告表）→ 预检通过才出现「确认导入 N 人」。导入成功后回显默认密码与「已导入 N 人，请把初始密码告知学生」。整个过程不刷新页面也能重来。 |
| `PapersPage` | 新建弹窗「考试组织」卡加「**可作答次数**」（`InputNumber` 1–99），下方一行提示：「正式统考建议『可作答次数 = 1、学生可自行暂停 = 关、成绩与解析 = 考完统一公布』」。学生视角剩余次数按卷算：`remaining_attempts === null` 显示「不限次数」，`?? limit` 兜底老接口。操作列的禁用判断也先判 `null` 再比大小，否则练习卷会被当成 0 次而禁掉按钮。 |
| `PapersPage` 按班级导出 | 「更多」下拉新增「按班级导出成绩」→ 弹窗说明 + 班级下拉（数据来自 `GET /api/users/classes`）→ 跳转 `?paperId=&className=`。不给选择就导出整场，给了就只出这个班。 |

### 8.10 v0.9 页面变化

| 页面 | 说明 |
|---|---|
| `AnalysisPage`（新增，`/analysis/:paperId`） | 逐题分析页，admin/teacher 专属（学生进页面看到的是「你没有查看逐题分析的权限」，接口本身也是 403）。顶部按班级筛选 + 刷新 + 导出 + 返回；六张统计卡与一张纯 CSS 直方图；中间「交卷情况」「考场纪律」两张小卡；下面是逐题表格（题号/题干/正确率 P/区分度 D/作答未答/判断/提示），支持展开看选项分布、支持「只看需关注」与按判断类型筛选；底部一段 P/D 值口径说明。 |
| `PapersPage` | 「更多」下拉在成绩导出那一组前面加了「逐题分析」，直接跳 `/analysis/:id`。注意菜单 key 用了 `examAnalysis` 而不是 `analysis` —— `analysis` 已经被「公布答案与解析」占用了，复用会让两个动作互相踩。 |
| `ProctorPage`（新增，`/proctor/:paperId`） | 实时监考页，admin/teacher 专属（学生硬敲 URL 看到「你没有进入监考的权限」）。顶部自动刷新开关（10s 静默轮询，不切 loading 以免表格闪）+ 手动刷新 + 返回；六张统计卡（应考 / 在场·在线 / 掉线 / 已交卷 / 未开始 / 违规）；筛选条（Segmented 全部·在场·掉线·未开始·已结束 + 姓名/用户名/学号搜索 + 班级下拉）；表格列（学号/姓名/班级/状态/已答/剩余/违规/最后心跳/成绩/操作），操作列 `fixed: right`；违规明细弹窗里逐条「撤销 / 恢复」，顶部一个选填理由输入框。**成绩列未公布时显示「未公布」，绝不落到 0**。 |
| `ExamPage` | 新增心跳 effect（20s 一次，首拍延后 3s 避开页面加载抢带宽）：拿回的 `serverNow` 用来校准倒计时偏移，`violations` 用来同步被撤销后的次数，`status` 不是 `in_progress` 就直接跳结果页 —— 原来学生被强制收卷后页面毫无察觉，还在那儿答题。 |

### 8.11 v0.12 页面变化

| 页面 | 说明 |
|---|---|
| `AuditPage`（新增，`/audit`） | 审计日志页，**仅管理员**。顶部三个动作：刷新 / 导出 CSV（`<a href>` 直接指向接口，带上当前筛选）/ 清理旧日志（弹窗里 90·180·365 三档 + 不可恢复的警示）。筛选条 6 个控件：类别、动作、操作人、分级、时间范围、关键字；**选了类别会把动作下拉收窄到该类**，避免「类别=登录 + 动作=发布试卷」这种必然为空的组合。表格 6 列（时间/操作人/动作/对象/详情/IP），动作用 Tag 按分级上色（日常灰、敏感橙、高危红），详情列一句话摘要（`status: active → disabled`），点开行看完整 JSON。 |
| `AppLayout` | 管理员菜单加「审计日志」（`AuditOutlined`），放在「网站管理」之后；教师与学生看不到。 |
| `HelpPage` | 加「审计日志」章节，**目录锚点与正文卡片都按 `role === 'admin'` 渲染** —— 教师点进去看到一条指向 403 的目录项比没有更糟。 |
| 时间范围为什么只有预设 | 只有全部 / 今天 / 近 7 / 30 / 90 天，不做自定义区间。antd 的 RangePicker 需要 dayjs 对象，而 `dayjs` 不是 web 的直接依赖（pnpm 严格模式下 `import dayjs` 解析不到），为一个筛选去加依赖不值当。审计查询的真实用法是「最近一次考试前后」+ 关键字，预设够用。 |

### 8.12 v0.13 页面变化

| 页面 | 说明 |
|---|---|
| `PapersPage` 新建弹窗 | 「选项乱序」旁边加「题序乱序」开关，**默认关**；tooltip 写清代价：开了之后「第 3 题」在师生之间不是同一道题，讲评要按题目说。 |
| `PaperPreviewModal` | 顶部标签加「题序乱序」（金色），与「选项乱序」（青色）区分。**提示语改成按实际配置生成** —— 原来写死「选项顺序会重新打乱」，一份关了选项乱序的卷子照样这么说，等于跟老师撒谎。现在四种组合各一句话，两个都关时说「按现在的顺序呈现」。 |
| `HelpPage` | 「其他参数」里补题序乱序一条，重点写它的代价，而不只是好处。 |

### 8.13 v0.14 页面变化

| 页面 | 说明 |
|---|---|
| `LoginPage` | 登录卡底部加「忘记密码？」链接，弹 `ForgotPasswordModal`：用户名 + 重置码 + 新密码（确认一次）三项，Info Alert 写明「重置码由老师/管理员生成」。码输入**自动 trim + 转大写** —— 学生抄在纸上大小写分不清是常态，别让格式背锅。成功提示「密码已重置，请用新密码登录」。 |
| `UsersPage` | 操作列加「生成重置码」（对本地账号显示）：弹窗即调 `POST /api/users/:id/reset-code`，**打开弹窗就签发**，不做「先弹窗再点确认」的两段式 —— 少一步就少一个「弹窗开着码还没发」的误会。弹窗内大号等宽字体展示 8 位码 + 点击复制 + Warning Alert（「明文只显示这一次，请立即转交学生；30 分钟内有效」）。关闭弹窗后码无法再找回，只能重发（重发会作废旧码）。 |
| `HelpPage` | 目录加「忘记密码」章节（**所有人可见**，因为看这章的人恰恰没登录、也可能是学生），分「学生怎么改」与「老师怎么发」两条步骤清单，配 Warning：码 30 分钟有效、只能用一次、失败了让老师重发。 |

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
| M7 练习与组织（v0.5） | 练习中心（随机 + 错题）、独立错题库、错题练习卷、学生分组、分组可见范围、教师管理学生、题库导出 | 105 项验收脚本双库全绿 + 28 项界面验收 + 9 张截图复查 |
| M8 安全加固（v0.6） | 会话状态校验、试卷可见性收口、练习卷归属校验、登录双维度限流、改密清会话、安全响应头、字段长度上限 | 63 项安全用例双库全绿 |
| M9 正式考试场景（v0.7） | 考试时间窗口与统一收卷、禁学生自暂停、成绩与解析分开发布、每题分值与绝对分及格判定、含缺考的成绩册、有答卷改归档 | 60 项验收脚本双库全绿 + 18 项界面验收 + 4 张截图复查 |
| M10 成建制能力（v0.8） | 作答次数按卷配置、学号与班级字段、学生名单批量导入、成绩册按班级导出 | 66 项验收脚本双库全绿 + 27 项界面验收 + 5 张截图复查 |
| M11 逐题分析（v0.9） | P 值 / D 值 / 选项分布 / 分数段分布、逐题判断与教务提示、按班级分析、分析结果导出 xlsx | 67 项验收脚本双库全绿 + 25 项界面验收 + 7 张截图复查 |
| M12 答案保存容错（v0.10） | 按题合并与串行保存、失败分级与指数退避、stuck 自愈、pagehide keepalive、交卷答案快照兜底 | 34 项验收脚本双库全绿（含断网模拟）+ 18 项界面验收 + 4 张截图复查 |
| M13 实时监考（v0.11） | 学生端心跳与在线判定、监考视图（状态/已答/剩余/违规/最后心跳）、违规明细与软撤销/恢复、心跳驱动强制收卷跳转 | 73 项验收脚本双库全绿 + 28 项界面验收 + 8 张截图复查 |
| M14 审计日志（v0.12） | 38 个动作显式埋点（登录/账号/试卷/题库/分组/分类/设置/考试/审计）、操作人或对象名称快照、分类·分级·关键字·对象筛选、CSV 导出、「不删自己」的清理 | 77 项验收脚本双库全绿 + 22 项界面验收 + 9 张截图复查 |
| M15 题序乱序（v0.13） | 每人一份卷面顺序（开考定序、落库不改）、与选项乱序可叠加、判分与统计按 question_id 与卷面顺序两套口径、预览提示语按配置生成 | 47 项验收脚本双库全绿 + 19 项界面验收 + 5 张截图复查 |
| M16 运维与找回密码（v0.14） | 一次性重置码签发与兑换（库只存哈希、30 分钟、单次有效、旧码自动作废）、公开兑换端限流与统一失败话术、改密清会话、审计埋点 3 动作 | 20 项验收脚本双库全绿 + 12 项界面验收 + 截图复查 |

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
| 26 | 学生自己生成随机练习卷（v0.5） | `/practice` 页选分类与题量 → `POST /api/attempts/practice` → 直接开考；练习卷不进试卷列表、不受 3 次限制 |
| 27 | 每人独立的错题库（v0.5） | 判分时写 `wrong_question`，接口无 `userId` 入参；学生B 读不到也删不掉学生A 的错题 |
| 28 | 按错题库生成练习卷（v0.5） | `source=wrong` 从本人未订正错题抽题；不够时明确提示；答对即移出待订正 |
| 29 | 学生分组（v0.5） | `/api/groups` + `student_group_member`；发布弹窗可选分组，分组加人立即生效 |
| 30 | 教师可添加/管理学生（v0.5） | 教师只能看/建/改/删学生，不能提权、不能碰 admin/teacher、不能删自己 |
| 31 | 题库导出（v0.5） | `GET /api/questions/export`，12 列与导入模板一致；实测导出文件回导后全部命中「已有题目」 |

> 第 32 项起（v0.6 安全加固、v0.7 正式考试场景、v0.8 成建制能力）的需求对照统一维护在 [`acceptance.md`](./acceptance.md) 的「需求对照」表，本文不再重复，避免两处编号打架。
