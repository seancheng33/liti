# 验收报告

> 砺题 Liti 系统验收结果
> 更新：2026-10-30

## 测试总览

| 类型 | 数量 | 结果 |
|---|---|---|
| 单元测试 | 34 | ✅ 全部通过 |
| 集成测试 | 32 | ✅ 全部通过 |
| E2E 测试（Playwright） | 1 | ✅ 通过 |
| 全栈冒烟测试 | 1 | ✅ 通过 |

- 单元 + 集成共 **66 个用例**，`pnpm test` 全绿，`tsc --noEmit` 无类型错误。
- E2E 覆盖完整刷题链路：登录 → 建题 → 组卷 → 发布 → 答题 → 交卷 → 解析。

## 需求对照

| # | 需求 | 实现 | 验证 |
|---|---|---|---|
| 1 | 界面录入题目 | 题库页新建/编辑（单选/多选、选项、解析、分类、难度） | 集成 + E2E |
| 2 | Excel 批量导入 | 模板下载、预校验、错误行报告、事务导入/严格回滚 | 单元 + 集成 |
| 3 | 随机组卷 | 按分类/难度配额不放回抽样 | 集成 |
| 4 | 固定题目组卷 | 指定题目 ID 列表 | 集成 + E2E |
| 5 | 每卷 ≤100、题量自定义 | 1–100 双端校验 | 单元 + 集成 |
| 6 | 选项顺序随机 | 开考洗牌，判分按选项 ID | 集成 |
| 7 | 答题计时 | deadline 倒计时、超时自动判分 | 集成 |
| 8 | 不可切窗 | 遮罩 + 违规计数，累计 3 次自动交卷 | 集成 |
| 9 | 交卷后逐题解析 | 考试/练习双模式解析 | 集成 + E2E |
| 10 | SQLite + MySQL 预留 | Kysely 双方言 | SQLite 全量；MySQL 见下 |
| 11 | SSO 预留 | user.provider / external_id + 会话解耦 | 代码结构 |

## 数据库

- **SQLite**：✅ 全量测试通过（迁移、CRUD、事务、导入回滚）。
- **MySQL**：⚠️ 未做实机冒烟（本环境无 Docker/MySQL 实例）。已规避已知兼容性风险：
  - 迁移使用 Kysely schema builder（方言无关 DDL）；
  - 查询不使用 `RETURNING`（MySQL 不支持），改用 `insertId` 获取自增主键；
  - 时间统一存 epoch 毫秒（`bigint`），JSON 存 `text`。
  - 建议在具备 MySQL/Docker 的环境补跑一次迁移与 CRUD 冒烟后再用于生产。

## 已知边界

1. 防切屏为「检测 + 遮罩 + 惩罚」（浏览器能力边界），无法物理级阻止 Alt+Tab；Phase 2 Electron 壳已预留 `ExamGuard` 抽象。
2. 多选判分为「全对得分」（少选不得分）。
3. 学生自助随机练习组卷、成绩导出 Excel、统计报表为二期规划。

## 复现测试

```bash
pnpm install
pnpm test          # 单元 + 集成（66 个）
pnpm build         # 构建前端（产出 web/dist）
pnpm seed          # 建库并初始化账号（admin/admin123、teacher/teacher123、student/student123）
pnpm start         # 单进程启动（默认 http://localhost:8080）
pnpm test:e2e      # E2E（需服务已启动、已安装 Playwright 浏览器）
```
