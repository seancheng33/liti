# 验收报告

> 砺题 Liti 系统验收结果
> 更新：2026-10-30

## 测试总览

| 类型 | 数量 | 结果 |
|---|---|---|
| 单元测试 | 34 | ✅ 全部通过 |
| 集成测试 | 40 | ✅ 全部通过 |
| E2E 测试（Playwright） | 1 | ✅ 通过 |
| 全栈冒烟测试 | 1 | ✅ 通过 |

- 单元 + 集成共 **74 个用例**，`pnpm test` 全绿，`tsc --noEmit` 无类型错误。
- E2E 覆盖完整刷题链路：登录 → 建题 → 组卷 → 发布 → 答题 → 交卷 → 解析。

## 需求对照

| # | 需求 | 实现 | 验证 |
|---|---|---|---|
| 1 | 界面录入题目 | 题库页新建/编辑 | 集成 + E2E |
| 2 | Excel 批量导入 | 模板/预校验/事务导入/回滚 | 单元 + 集成 |
| 3 | 随机组卷 | 按分类/难度不放回抽样 | 集成 |
| 4 | 固定题目组卷 | 指定题目 ID | 集成 + E2E |
| 5 | 每卷 ≤100、题量自定义 | 1–100 双端校验 | 单元 + 集成 |
| 6 | 选项顺序随机 | 开考洗牌，判分按选项 ID | 集成 |
| 7 | 答题计时 | deadline 倒计时、超时判分 | 集成 |
| 8 | 不可切窗 | 遮罩 + 违规计数，3 次自动交卷 | 集成 |
| 9 | 交卷后逐题解析 | 考试/练习双模式 | 集成 + E2E |
| 10 | SQLite + MySQL 预留 | Kysely 双方言 | SQLite 全量；MySQL 见下 |
| 11 | SSO 预留 | provider / external_id | 代码结构 |
| 12 | 学生自助练习组卷 | practice 端点 + 练习入口 | 集成 |
| 13 | 成绩导出 Excel | attempts/export 端点 | 集成 |
| 14 | 统计报表 | stats/overview + 统计页 | 集成 |
| 15 | Electron 壳（物理级防切屏） | 主进程 + preload + ExamGuard | 编译通过（见下） |

## 数据库

- **SQLite**：✅ 全量测试通过（迁移、CRUD、事务、导入回滚）。
- **MySQL**：⚠️ 未做实机冒烟（本环境无 Docker/MySQL 实例）。已规避已知兼容性风险：迁移用 Kysely schema builder（方言无关 DDL）、查询不用 `RETURNING`（改 `insertId`）、时间存 `bigint`、JSON 存 `text`。建议在具备 MySQL/Docker 的环境补跑迁移与 CRUD 冒烟。

## Electron 壳

- 已实现：主进程（`electron/main.ts`）拉起后端并创建窗口；考试期间全屏 + 置顶 + 失焦自动拉回；`preload.ts` 经 IPC 暴露 `window.liti.examGuard`；前端 `ExamPage` 在 Electron 环境走主进程检测，浏览器退化为 `visibilitychange/blur`。
- 验证：`electron:build`（tsc）编译通过，electron 33.4.11 二进制已安装；**GUI 启动未在本沙箱环境验证通过**（受限环境下 Electron 主进程 `require('electron')` 未返回 API）。需在真实桌面环境执行 `pnpm electron:start` 验证物理级防切屏。

## 已知边界

1. 多选判分为「全对得分」（少选不得分）。
2. 浏览器环境的防切屏是「检测 + 遮罩 + 惩罚」，物理级拦截依赖 Electron 壳。
3. MySQL 实机冒烟需在具备 MySQL/Docker 的环境执行。

## 复现测试

```bash
pnpm install
pnpm test          # 单元 + 集成（74 个）
pnpm build         # 构建前端
pnpm seed          # 建库 + 初始账号
pnpm start         # 单进程启动（8080）
pnpm test:e2e      # E2E（需服务已启动）
```
