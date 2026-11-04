# API 速查

给接手或对接的人用。字段级的校验规则以 `server/src/*/routes.ts` 里的 Zod schema 为准，这里只列「有什么、谁能调、大概什么形状」。

## 通用约定

| 项 | 说明 |
|---|---|
| 前缀 | 全部挂在 `/api` 下 |
| 认证 | Cookie `liti_session`，登录时 `Set-Cookie` 下发。浏览器带 `credentials: 'include'` 即可 |
| 请求体 | JSON。文件上传是 `multipart/form-data` |
| 成功响应 | 直接返回数据本体，没有 `{ code, data }` 这层包装 |
| 错误响应 | `{ "error": "错误说明", "details": [...] }`，`details` 只在有结构化信息时出现 |
| 分页 | `?page=1&pageSize=20`，响应带 `{ items, total, page, pageSize }` |
| 角色 | 下表用 `admin` / `teacher` / `student` 标注；「登录」表示任意角色，具体数据由服务端按归属过滤 |

错误码的用法在整个项目里是一致的，记这几条就够：

| 码 | 什么情况 |
|---|---|
| 400 | 参数不对、状态不允许（如考试卷禁止自行暂停） |
| 401 | 没登录、会话过期、账号被停用 |
| 403 | 登录了但越权（学生调教师接口、教师碰别的教师） |
| 404 | 资源不存在，**或者存在但你不该看见**（名单外试卷、未发布草稿统一 404，不泄露存在性） |
| 409 | 冲突（用户名重复、学号重复、题目疑似重复） |
| 429 | 限流（登录失败、重置码兑换） |

---

## 认证 `/api/auth`

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| POST | `/login` | 公开 | `{username, password}` → 下发 Cookie，返回用户信息 |
| POST | `/logout` | 登录 | 删会话，清 Cookie |
| GET | `/me` | 登录 | 当前用户；未登录 401 |
| PUT | `/profile` | 登录 | 改自己的显示名等 |
| POST | `/change-password` | 登录 | `{oldPassword, newPassword}`，成功后其他会话全部失效 |
| POST | `/reset-password` | 公开 | `{username, code, newPassword}` 兑换重置码；双维度限流，失败统一话术 |

```bash
curl -c c.txt -X POST http://127.0.0.1:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'

curl -b c.txt http://127.0.0.1:8080/api/auth/me
```

---

## 用户 `/api/users`

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/` | admin teacher | 用户列表，支持关键字与角色筛选 |
| GET | `/students` | admin teacher | 学生简表，用于分组、加名单 |
| GET | `/classes` | admin teacher | 出现过的班级名去重列表 |
| GET | `/template` | admin teacher | 学生导入模板 xlsx |
| POST | `/import` | admin teacher | 批量导入；`{dryRun:1}` 只预检不写库 |
| POST | `/` | admin teacher | 建账号。教师只能建 `student` |
| PUT | `/:id` | admin teacher | 改账号。教师只能改自己的学生 |
| POST | `/:id/reset-code` | admin teacher | 签发找回密码用的重置码，**明文只在这里出现一次** |
| POST | `/:id/reset-password` | admin teacher | 直接设新密码（`{password}`），不用走重置码。改完该账号所有会话立即失效 |
| DELETE | `/:id` | admin teacher | 删账号。教师只能删自己的学生 |

「教师只能管学生」这条在服务端由 `assertTeacherMayManage()` 收口，前端不用重复判断。

---

## 分类 `/api/categories`

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/` | 登录 | 全部分类（树或平铺，看实现） |
| POST | `/` | admin teacher | 新建 |
| PUT | `/:id` | admin teacher | 改名 |
| DELETE | `/:id` | admin teacher | 删除；有题目引用会拒绝 |

---

## 题库 `/api/questions`

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/` | admin teacher | 列表，支持分类、关键字、状态筛选 |
| GET | `/:id` | admin teacher | 详情。**归档题也返回 200**，历史卷复盘要用 |
| POST | `/` | admin teacher | 新建单题 |
| PUT | `/:id` | admin teacher | 编辑 |
| DELETE | `/:id` | admin teacher | 软删除（`status='archived'`），不物理删 |
| POST | `/batch` | admin teacher | 批量改分类 / 批量归档 |
| POST | `/check-duplicate` | admin teacher | 按 `content_hash` 查重，命中返回 409 与相似题 |
| GET | `/template` | admin teacher | 导入模板 xlsx（12 列，带题型下拉与输入提示） |
| POST | `/import` | admin teacher | Excel 导入。逐行独立提交，返回 warnings / errors；响应含 `createdCategories`（本次自动新建的分类名，dryRun 时是将会新建的名单）。分类列写不存在的名字会自动建，同一批同名只建一个 |
| GET | `/export` | admin teacher | 导出 xlsx，列与模板一致，**导出的文件能直接回导** |

题目类型：`single` 单选 / `multiple` 多选（`judge` 判断仅文档早期出现过，实际未实现）。`difficulty` 字段已废弃，传了也会被忽略。

---

## 试卷 `/api/papers`

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/` | 登录 | 列表。学生只看到已发布且在自己的可见范围内 |
| GET | `/:id` | 登录 | 详情 |
| POST | `/` | admin teacher | 建卷。`mode: fixed` 固定题目 / `random` 按规则抽 |
| POST | `/random-preview` | admin teacher | 抽题预览，不落库 |
| POST | `/draft-preview` | admin teacher | 草稿预览，不落库，试卷数不变 |
| GET | `/:id/preview` | admin teacher | 已存试卷的预览 |
| GET | `/:id/audience` | admin teacher | 可见范围（学生 / 分组） |
| PUT | `/:id/audience` | admin teacher | 设置可见范围 |
| POST | `/:id/publish` | admin teacher | 发布 |
| POST | `/:id/publish-results` | admin teacher | 发布成绩 / 解析（两个开关独立） |
| POST | `/:id/close` | admin teacher | 统一收卷：把在考的答卷全部强制交掉 |
| POST | `/:id/archive` | admin teacher | 归档 |
| GET | `/:id/proctor` | admin teacher | 监考看板：应考名单 + 状态 / 已答 / 剩余 / 违规 / 最后心跳 |
| DELETE | `/:id` | admin teacher | 删除。**有答卷的卷不让删**，返回 400 引导去归档 |

建卷时几个关键字段：

```jsonc
{
  "title": "期中测验",
  "mode": "random",              // 或 "fixed"
  "durationSec": 2700,
  "perQuestionScore": 5,         // 不填按总分平均
  "passScore": 60,
  "maxAttempts": 1,              // 1–99；练习卷填 99 表示不限
  "shuffleQuestions": false,     // true = 每人一份题序，默认 false
  "startAt": 1762000000000,      // 时间窗口，毫秒；不传 = 不限
  "endAt": 1762003600000,
  "allowStudentPause": false,
  "reviewMode": "after_submit",  // after_submit 交卷后 / immediate 逐题即时 / never 永不
  "questionIds": [1, 2, 3]
}
```

---

## 答卷 `/api/attempts`

这是学生答题用的主链路。下面标「登录」的端点都不限角色，但**一律校验归属**：只能动自己的答卷，动别人的返回 403。

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| POST | `/` | 登录 | 开考。`{paperId}`，返回答卷与题目（答案与解析不下发） |
| POST | `/practice` | 登录 | 开练习卷。`source: random` 随机 / `wrong` 按错题 |
| GET | `/` | 登录 | 我的答卷列表（教师看自己管的学生的） |
| GET | `/:id` | 登录 | 答卷详情；未公布成绩时分数与对错是 `null` |
| PATCH | `/:id/answers` | 登录 | 保存答案。按题合并，可批量 |
| PATCH | `/:id/flag` | 登录 | 标记 / 取消标记某题 |
| POST | `/:id/heartbeat` | 登录 | 心跳，20 秒一次。返回状态，被强制收卷后前端据此跳转 |
| POST | `/:id/pause` | 登录 | 暂停（仅练习卷或开了 `allowStudentPause` 的卷） |
| POST | `/:id/resume` | 登录 | 继续，deadline 顺延 |
| POST | `/:id/submit` | 登录 | 交卷。可带 `answers` 快照做最后兜底 |
| POST | `/:id/violations` | 登录 | 上报一次切屏违规，累计到上限自动交卷 |
| GET | `/:id/violations` | admin teacher | 违规记录 |
| POST | `/:id/violations/:vid/revoke` | admin teacher | 撤销误报，额度退回 |
| POST | `/:id/violations/:vid/restore` | admin teacher | 恢复被撤销的记录 |
| GET | `/export` | admin teacher | 成绩册 xlsx。`?paperId=&className=` 可切口径，缺考保留 |
| GET | `/analysis` | admin teacher | 逐题分析：P 值 / D 值 / 选项分布 / 分数段 |
| GET | `/analysis/export` | admin teacher | 分析导出，三张表 |

```jsonc
// PATCH /api/attempts/12/answers   一次一题
{ "questionId": 88, "selectedOptionIds": [3] }

// PATCH /api/attempts/12/flag      标记/取消标记
{ "questionId": 88, "flagged": true }
```

交卷时可以带一份答案快照兜底（`POST /:id/submit`），形状是数组：

```jsonc
{ "answers": [ { "questionId": 88, "selectedOptionIds": [3] } ] }
```

不带也能交。服务端会在「超时检查之后、判分之前」写入，返回 `{ ok: true, applied: n }` 告诉你补上了几条。

未公布成绩时，`score` 与每题的 `isCorrect` 一律是 `null` 而不是 0。前端判断"有没有出分"要用 `=== null`，不能用真假值。

---

## 错题 `/api/wrong-questions`

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/` | 登录 | 我的错题列表 |
| GET | `/summary` | 登录 | 按分类的错题数概览 |
| GET | `/:questionId` | 登录 | 单题详情 |
| DELETE | `/:questionId` | 登录 | 移出错题本 |
| POST | `/batch-remove` | 登录 | 批量移出 |

接口不接收 `userId` 参数，一律取当前登录用户。想查别人的错题没有入口。

---

## 分组 `/api/groups`

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/` | admin teacher | 分组列表 |
| POST | `/` | admin teacher | 新建 |
| PUT | `/:id` | admin teacher | 改名 |
| DELETE | `/:id` | admin teacher | 删除；引用了它的试卷可见范围会同步失效 |
| GET | `/:id/members` | admin teacher | 组内学生 |
| PUT | `/:id/members` | admin teacher | 整体替换成员，加人立即影响可见性 |

---

## 统计 `/api/stats`

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/overview` | admin teacher | 题量、卷数、答卷数、平均分等总览 |

---

## 设置 `/api/settings`

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/public` | 公开 | 站点名、公告等可公开项 |
| GET | `/` | admin | 全部设置 |
| PUT | `/` | admin | 保存设置 |

---

## 审计 `/api/audit`

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/meta` | admin | 动作字典（42 个动作的中文名与分类），前端筛选下拉用它 |
| GET | `/` | admin | 日志列表。支持 `category` / `action` / `severity` / `actorId` / `targetType`+`targetId` / `keyword` / `from`+`to` / 分页 |
| GET | `/export` | admin | 导出 CSV（带 BOM，Excel 直接打开不乱码）；导出动作本身也留痕 |
| POST | `/purge` | admin | 按时间清理。软清理，`audit.purge` 记录不会被清掉 |

日志里的 `actor_name` / `target_label` 都是写入时的快照，不 join 现查。所以账号改名、试卷删了，历史记录照样读得懂。

---

## 上传 `/api/uploads`

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| POST | `/` | admin teacher | `multipart/form-data`，字段名 `file`。限图片、限 12MB，返回可访问的 URL |

上传后的文件由 `/uploads/*` 静态托管，路径来自 `UPLOAD_DIR`。

---

## 公开 `/api/public`

未登录也能调的三个端点，首页用。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/overview` | 站点名、公告、题量/卷数这类对外数字 |
| GET | `/papers` | 公开可见的试卷列表（只给标题、题量、时长这类元信息） |
| GET | `/papers/:id` | 单卷公开信息。草稿一律 404 |

这三个端点**不含任何答案、解析、成绩**。公开接口的边界是硬性的，加字段前先想清楚。

---

## 健康检查

```
GET /api/health   →  { "ok": true, "time": 1762000000000 }
GET /health       →  同上（根路径那份给容器和反代用）
```

只报活着，不带版本号。看版本直接读镜像 tag 或 `server/package.json`。Docker 的 healthcheck 用的就是它。
