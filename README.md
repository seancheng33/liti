# 砺题 Liti

> 千题磨一剑 · 面向局域网的学习刷题系统

砺题（Liti）是一款用于**学习与刷题**的在线答题系统，以选择题（单选 / 多选）为主。支持题库管理、Excel 批量导入导出、随机组卷与固定组卷、答题倒计时、防切屏、自动判分与逐题解析，以及**学生自助练习**与**人人独立的错题本**。

数据默认存储于 **SQLite**，预留 **MySQL** 接入；认证支持本地账号，预留 **SSO（OIDC）** 接入。

---

## ✨ 功能特性

- **首页免登录可看**：题库规模、已发布试卷、卷面预览都在首页；点「开始答题」跳到登录页，登录完自动回到那张卷子并开考。
- **题库管理**：单选 / 多选题目，含题干、选项、正确答案、解析、分类；题干与选项都能配图（也可只放图、不写字）；支持界面逐题录入 + Excel 批量导入（题型列是下拉菜单、表头带批注、附填写说明页），新增/导入时自动和已有题目查重；支持**批量改分类 / 批量删除**。
- **题库导出**：按当前筛选条件（分类 / 状态 / 关键词）导成 xlsx，**列结构与导入模板完全一致** —— 导出来改几笔就能原样回导，做成一份卷子改题的闭环。单次最多 5000 行，文件里另附一页「导出信息」写明筛选条件与截断情况。
- **删除不伤历史**：题目删除是「从题库移除」，已组进试卷的题目在历史试卷、已发布试卷和已交答卷里照常显示题面与解析。
- **灵活组卷**：两种方式随你选 —— 按分类随机抽题（可配多条规则，留空即全题库），或直接从题库里手动多选；每卷 1–100 题，题量可自定义。建卷前可「预览卷面」先看效果，发布后也能随时预览。
- **发布可控可见**：发布时可选「所有学生」或「指定范围」—— 范围既可以是**个别学生**，也可以是**学生分组**（两者取并集）；没被覆盖到的学生看不到这份卷子（连标题都看不到），发布后还能随时改名单。分组挂的是引用不是快照，往里加人立刻生效。
- **学生分组**：教师 / 管理员可以建分组、改名字、批量管成员（一份卷子发给一个班就靠它，不用每次点几十个名字）；成员只收学生账号，删组会连带清掉试卷上的分组授权，不留悬空引用。
- **答题防作弊**：选项 A/B/C/D 顺序每次随机；整卷倒计时；切窗口 / 切标签页 / 关页面都会被记录，回来弹窗提醒，累计 3 次自动交卷；答案自动保存；支持**暂停考试**（停表 + 服务端屏蔽题面）；可给题目**打标记**，答题卡上有小圆点提示。
- **作答次数上限**：每份试卷最多作答 3 次，中途退出会接着上次那张卷子，不会白白占次数；练习卷不限。
- **判分与解析**：交卷自动判分；支持「考试模式（交卷后统一显示）」与「练习模式（逐题即时反馈）」两种解析时机；交卷原因中文标注（正常 / 超时 / 违规）。
- **练习中心（学生自助）**：学生自己开练习卷，不用老师建 —— 按分类随机抽题（可多选分类、题量自由、多分类自动平均分配），或**拿自己的错题练一遍**；练习卷即时反馈、不限作答次数，不占考试次数。
- **独立错题本**：答错自动进本，答错一次累加一次次数；**做对一次就移出「待订正」**（记录保留，之后又错会重新拉进来）。错题库按人生成、按人隔离 —— 接口层面就不接受「查谁」这个参数，谁登录看谁的，读别人的错题详情直接 404。支持按状态 / 分类筛选、题干搜索、批量移除，详情里能看正确答案和解析。
- **教师能管学生**：管理员管所有人；教师可以查看、新建、改资料、重置密码、删除**学生**账号 —— 但不能造教师、不能改角色、不能碰管理员、不能删自己。越权判定在服务端，不是前端藏个按钮。
- **站内帮助**：`/help` 一份完整使用说明，未登录也能看。
- **双数据库**：默认 SQLite（零配置本地运行），通过配置切换 MySQL，数据访问层统一。
- **可扩展认证**：本地账号 + 角色权限（管理员 / 教师 / 学生）；预留 SSO（OIDC）接入点。

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
│  ├─ deployment.md          # 部署指南（Node / Docker 速查）
│  ├─ docker-build.md        # 自己拉代码做镜像（SQLite / MySQL 两种模式）
│  └─ acceptance.md          # 验收报告
├─ server/                   # 后端（Fastify + Kysely）
│  ├─ src/                   # 认证/题库/Excel/组卷/答题/判分/练习/错题本/分组
│  ├─ test/                  # 单元 + 集成测试
│  └─ .env.example
├─ web/                      # 前端（React + Vite + Ant Design）
│  └─ src/pages/             # 登录/题库/试卷/答题/解析/成绩/练习中心/错题本/分组
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
pnpm build          # 构建后端 + 前端
pnpm seed           # 建库 + 初始账号
pnpm start          # 单进程运行，托管 API + 静态资源
```

浏览器访问 `http://<局域网IP>:8080`。完整部署步骤（防火墙、开机自启、MySQL、Electron 等）见 [docs/deployment.md](docs/deployment.md)。

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
- [x] M5 首页统计、用户与站点设置、批量操作、软删除、作答次数上限、暂停、可见范围、题目标记
- [x] M6 学生自助练习、独立错题库、学生分组、分组可见、教师管理学生、题库导出

---

## 📄 License

（待定）
