# 参与开发

这份文档写给要改这个仓库的人。跑起来只需要三步，剩下的时间都花在「别踩坑」上。

## 环境

- Node.js >= 20（`.nvmrc` 没放，用 20 或 22 都行）
- pnpm 9（`corepack enable` 之后直接用 `pnpm`）
- 首次克隆：`pnpm install`

Windows 上如果 `pnpm` 不在 PATH 里，用 `corepack pnpm <命令>` 顶一下。

## 跑起来

```bash
pnpm install

# 终端 A：后端，默认 http://localhost:8080，SQLite
pnpm --filter @liti/server dev

# 终端 B：前端开发服务器，会代理 /api 到 8080
pnpm --filter @liti/web dev
```

第一次启动前要建库和造数据：

```bash
pnpm migrate   # 建表（幂等，重复跑没事）
pnpm seed      # 灌样例账号和题目
```

`seed` 出来的账号：`admin/admin123`、`teacher/teacher123`、`student/student123`。只用于本地，别带到生产。

想跑 MySQL 就把 `DB_DRIVER=mysql` 和 `MYSQL_URL` 设上，见 [deployment.md](docs/deployment.md) 第 8.2 节。

## 目录

```
server/src/
  app.ts            路由注册、鉴权钩子、静态托管
  config.ts         环境变量 → Config，一律走 os.environ
  db/               Kysely 实例、方言选择、类型定义
  migrations/       0016 个迁移，按序号排
  auth/             登录、会话、密码重置
  question/ paper/ attempt/   三个主业务
  audit/            审计动作字典 + 写入
  excel/            xlsx 解析与导出
web/src/
  pages/            22 个页面，路由在 App.tsx
  components/       跨页面复用件
  api/              fetch 封装
scripts/            运维脚本（备份、压测）
e2e/                Playwright + 纯 HTTP 安全用例
```

## 改代码前先看这几条

这些都是踩过的，写在前面能省返工。

**权限判定必须在服务端。** 前端隐藏菜单、按钮只是顺手，不作为安全措施。每个新端点先问三件事：谁能调、能不能碰别人的数据、名单外要 404 还是 403。默认答案：学生越权 403，看不见的资源 404。

**迁移必须幂等。** 先 introspect 看表/列/索引在不在，索引创建用 try/catch 吞掉 `Duplicate`。生产是 `docker start` 自动跑迁移，跑第二遍报错就起不来。

**时间戳列一律 `bigint`。** 用 `integer` 在 MySQL 上等不到 2038 就 `Out of range`，而且报错位置离真正原因很远。

**学号、班级这类要建索引的字段用 `varchar`。** MySQL 的 `TEXT` 不能直接建索引，SQLite 上却跑得好好的，切换库时才炸。

**给了 `Config` 新字段，记得同步 `server/test/helpers.ts` 的 `testConfig()`。** `tsconfig.json` 只 `include: ["src"]`，测试文件不参与类型检查，少字段编译器不会提醒你，表现为 `beforeAll` 抛错、整组用例静默跳过。

**新增 `.ts` 文件后如果测试报"找不到模块"，检查 import 后缀。** 服务端是 `NodeNext`，相对导入必须带 `.js`。

## 提交

格式跟 conventional commits，指定范围：

```
feat(paper): 支持按班级导出成绩册
fix(attempt): 暂停中不再判为掉线
docs: 补 API 速查表
ops: 备份脚本支持 MySQL
```

正文写清「为什么改」，不用解释代码本身在做什么——diff 里都有。破坏性变更在正文里用 `BREAKING CHANGE:` 起一行。

提交前跑：

```bash
pnpm test        # 单元 + 集成，72 项
pnpm --filter @liti/server build     # tsc，必须零错误
pnpm --filter @liti/web typecheck    # 同上
```

E2E 需要先起服务并装过 Playwright 浏览器：`pnpm test:e2e`。

界面改了的话，顺手截一张图放 PR 描述里，比文字快。

## 提交门槛

| 检查 | 要求 |
|---|---|
| `tsc`（server + web） | 零错误 |
| 单元 + 集成 | 全绿 |
| 新增端点 | 至少一条集成用例，覆盖权限边界 |
| 新增迁移 | 双库都要能跑（SQLite + MySQL） |
| 改了 UI 文案 | 同步 `web/src/pages/HelpPage.tsx` |

改完哪块就补跑对应的版本验收脚本（`scripts/` 之外的 `liti-features-v*.mjs`），别改 A 弄坏 B。

## 几个容易困惑的行为

- **删除题目是软删除**（`status='archived'`），详情接口照样返回 200，因为历史卷要能复盘。
- **未发布成绩时接口返回 `null`**，不是 0。前端千万别 `?? 0`，会把"没出分"显示成"0 分"。
- **学生自行暂停在考试卷上返回 400**，这是 `paper.allow_student_pause` 控制的。
- **登录失败限流是双维度的**：同一用户名 + IP 5 次、单 IP 30 次，窗口 10 分钟。连着跑验收脚本会撞上，重启进程清桶即可。
- **容器里临时跑的 node 脚本必须用 `.cjs` 后缀**，`server/package.json` 是 `type: module`。
