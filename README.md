# 砺题 Liti

> 千题磨一剑 · 面向局域网的学习刷题系统

砺题（Liti）是一款用于**学习与刷题**的在线答题系统，以选择题（单选 / 多选）为主。支持题库管理、Excel 批量导入、随机组卷与固定组卷、答题倒计时、防切屏、自动判分与逐题解析。

数据默认存储于 **SQLite**，预留 **MySQL** 接入；认证支持本地账号，预留 **SSO（OIDC）** 接入。

---

## ✨ 功能特性

- **题库管理**：单选 / 多选题目，含题干、选项、正确答案、解析、分类与难度；支持界面逐题录入 + Excel 批量导入（模板下载、预校验、错误行报告）。
- **灵活组卷**：按分类 / 难度配额随机抽题，或手动指定固定题目；每卷 1–100 题，题量可自定义。
- **答题防作弊**：选项 A/B/C/D 顺序每次随机；整卷倒计时；切窗检测 → 遮罩 + 暂停作答，累计 3 次自动交卷。
- **判分与解析**：交卷自动判分；支持「考试模式（交卷后统一显示）」与「练习模式（逐题即时反馈）」两种解析时机。
- **双数据库**：默认 SQLite（零配置本地运行），通过配置切换 MySQL，数据访问层统一。
- **可扩展认证**：本地账号 + 角色权限；预留 SSO（OIDC）接入点。

---

## 🧰 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Vite + Ant Design 5 + React Router |
| 后端 | Node.js 22 + Fastify + Zod |
| 数据访问 | Kysely（SQLite / MySQL 双方言） |
| 存储 | SQLite（better-sqlite3，默认）/ MySQL（mysql2，可选） |
| Excel | exceljs |
| 认证 | argon2（密码哈希）+ Cookie Session + OIDC（预留） |
| 测试 | Vitest（单元 / 集成）+ Playwright（E2E） |

---

## 📁 目录结构

```
liti/
├─ docs/
│  ├─ architecture.md        # 系统架构设计文档
│  └─ acceptance.md          # 验收报告
├─ server/                   # 后端（Fastify + Kysely）
│  ├─ src/                   # 认证/题库/Excel/组卷/答题/判分
│  ├─ test/                  # 单元 + 集成测试
│  └─ .env.example
├─ web/                      # 前端（React + Vite + Ant Design）
│  └─ src/pages/             # 登录/题库/试卷/答题/解析/成绩
├─ e2e/                      # Playwright E2E 测试
├─ electron/                 # 桌面壳（Electron，物理级防切屏）
├─ data/                     # SQLite 数据库文件（运行时生成，不入库）
├─ playwright.config.ts
└─ README.md
```

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 20（推荐 22）
- pnpm ≥ 8

### 本地开发

```bash
# 1. 安装依赖
pnpm install

# 2. 启动后端（默认 http://localhost:8080，SQLite）
pnpm dev:server

# 3. 启动前端（Vite 开发服务器，代理到后端）
pnpm dev:web
```

### 生产部署（局域网）

```bash
pnpm build          # 构建前端并产出静态资源
pnpm start          # 单进程运行，托管 API + 静态资源
```

浏览器访问 `http://<局域网IP>:8080`。

---

## ⚙️ 配置

通过环境变量或 `.env` 文件配置（模板见 `server/.env.example`）：

| 变量 | 说明 | 默认 |
|---|---|---|
| `HOST` | 监听地址 | `0.0.0.0` |
| `PORT` | 端口 | `8080` |
| `DB_DRIVER` | `sqlite` 或 `mysql` | `sqlite` |
| `SQLITE_PATH` | SQLite 文件路径 | `data/app.db` |
| `MYSQL_URL` | MySQL 连接串（`DB_DRIVER=mysql` 时） | — |
| `SESSION_SECRET` | 会话密钥 | 随机 |
| `AUTH_PROVIDERS` | `local` / `local,oidc` | `local` |

### 切换 MySQL

```bash
DB_DRIVER=mysql MYSQL_URL="mysql://user:pass@127.0.0.1:3306/liti" pnpm start
```

### 接入 SSO（OIDC）

配置 `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI`，并将 `AUTH_PROVIDERS` 设为 `local,oidc`（或 `oidc` 强制 SSO）。详见 [docs/architecture.md](docs/architecture.md)。

### 桌面壳（Electron）

```bash
pnpm build                         # 构建前端
pnpm --filter @liti/server build   # 构建后端 dist（Electron 依赖它）
pnpm electron:build                # 编译 Electron 主进程 / 预加载脚本
pnpm electron:start                # 启动桌面应用（需 node 在 PATH，或设置 LITI_NODE）
```

Electron 壳在考试期间启用**物理级防切屏**：全屏 + 置顶 + 失焦自动拉回；违规仍由服务端累计，满 3 次自动交卷。浏览器环境则退化为「遮罩 + 检测 + 惩罚」。

---

## 🧪 测试

```bash
pnpm test:unit        # 单元测试（34 个）
pnpm test:integration # 集成测试（32 个）
pnpm test             # 单元 + 集成（共 66 个）
pnpm test:e2e         # E2E（需先 pnpm seed && pnpm start，并已安装 Playwright 浏览器）
```

> 提交门槛：单元 + 集成 + E2E 全绿。详见 [docs/acceptance.md](docs/acceptance.md) 验收报告。
>
> MySQL 实机冒烟需在具备 MySQL/Docker 的环境执行（本环境无 Docker，详见验收报告）。

---

## 🗺️ 路线图

- [x] 方案设计与架构文档
- [x] M1 工程骨架、认证与角色、双数据库
- [x] M2 题库管理 + Excel 导入
- [x] M3 组卷、答题、计时、防切屏、判分与解析
- [x] M4 前端、成绩记录、E2E、验收

---

## 📄 License

（待定）
