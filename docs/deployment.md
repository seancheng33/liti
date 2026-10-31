# 部署文档

> 砺题 Liti 部署指南
> 更新：2026-10-31

本文档说明如何把砺题 Liti 部署到局域网环境，供多人访问使用。

## 1. 环境要求

- **Node.js** ≥ 20（推荐 22 或更高）
- **pnpm** ≥ 9（推荐 10/11）
- 操作系统：Windows / Linux / macOS 均可（本文以 Windows 为例）
- 可选：MySQL 8.x（默认用 SQLite，零配置，无需额外安装）

## 2. 获取代码

```bash
git clone http://10.147.17.250:3000/sean/liti.git
cd liti
```

## 3. 安装依赖

```bash
pnpm install
```

> 访问 npm 较慢时可改用国内镜像：
> `pnpm install --registry=https://registry.npmmirror.com`

## 4. 构建

```bash
pnpm build
```

该命令会依次：
- 编译后端（产出 `server/dist/`，TypeScript 编译产物）
- 构建前端（产出 `web/dist/`，Vite 打包产物）

## 5. 初始化数据库

```bash
pnpm seed
```

该命令会：
- 执行数据库迁移（自动建表）
- 创建默认账号：

| 账号 | 密码 | 角色 |
|---|---|---|
| admin | admin123 | 管理员 |
| teacher | teacher123 | 教师 |
| student | student123 | 学生 |

> ⚠️ 生产环境务必在首次启动后修改默认密码。

## 6. 启动

```bash
pnpm start
```

- 单进程运行，同时托管 REST API 与前端静态资源。
- 默认监听 `0.0.0.0:8080`。
- 局域网内其它设备访问 `http://<服务器IP>:8080`。

### 开机自启 / 常驻（Windows）

方式一，用 NSSM 注册为 Windows 服务：

```powershell
nssm install Liti "node" "server\dist\server.js"
nssm set Liti AppDirectory "D:\liti"
nssm set Liti AppEnvironmentExtra "PORT=8080"
nssm start Liti
```

方式二，用 pm2：

```bash
npm i -g pm2
pm2 start server/dist/server.js --name liti
pm2 save && pm2 startup
```

## 7. 防火墙

确保放行端口（默认 8080）：

```powershell
netsh advfirewall firewall add rule name="Liti" dir=in action=allow protocol=TCP localport=8080
```

## 8. 配置

配置通过环境变量或 `.env` 文件（模板见 `server/.env.example`）。

| 变量 | 说明 | 默认 |
|---|---|---|
| `HOST` | 监听地址 | `0.0.0.0` |
| `PORT` | 端口 | `8080` |
| `DB_DRIVER` | `sqlite` 或 `mysql` | `sqlite` |
| `SQLITE_PATH` | SQLite 文件路径 | `<项目>/data/app.db` |
| `MYSQL_URL` | MySQL 连接串（`DB_DRIVER=mysql` 时） | — |
| `SESSION_SECRET` | 会话密钥（生产务必改为强随机值） | 开发默认值 |
| `SESSION_TTL_MS` | 会话有效期（毫秒） | 7 天 |
| `AUTH_PROVIDERS` | `local` / `local,oidc` | `local` |
| `UPLOAD_DIR` | 图片上传落盘目录 | `<项目>/data/uploads` |

### 8.1 题目配图（上传接口与静态目录）

题目题干、选项都可以配图，走的是「前端转 base64 → 后端落盘 → 静态托管」这条链路：

- 上传接口：`POST /api/uploads`，请求体 `{ "data": "data:image/png;base64,..." }`，返回 `{ url, size }`
- 限制：单张 ≤ 4 MB，仅 `png` / `jpeg` / `webp` / `gif`
- 落盘路径：`$UPLOAD_DIR/questions/<yyyymm>-<uuid>.<ext>`
- 访问路径：`/uploads/questions/...`，由服务自身静态托管（`Cache-Control` 7 天）

> 备份时别只拷数据库：`data/app.db` 和 `data/uploads/` 要一起拷，否则图片题会变成空图。
> 用 Docker 部署时两者都在 `/app/data` 这个 volume 里，挂载一个卷即可。

### 8.2 切换 MySQL

```bash
# 1. 在 MySQL 中建库
# CREATE DATABASE liti DEFAULT CHARACTER SET utf8mb4;

# 2. 以 MySQL 模式启动（启动时自动建表）
DB_DRIVER=mysql MYSQL_URL="mysql://user:pass@127.0.0.1:3306/liti" pnpm start
```

> 已在真实 MySQL 8 上跑过迁移与全量功能冒烟（含组卷、答题、判分、Excel 导入导出、统计），中文 utf8mb4 存储正常。

### 8.3 接入 SSO（OIDC）

配置 `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI`，并将 `AUTH_PROVIDERS` 设为 `local,oidc`（或 `oidc` 强制 SSO）。

> SSO 为预留接入点，当前仅本地账号可登录。

## 9. 桌面壳（Electron）

用于「物理级防切屏」场景（考试期间全屏 + 置顶 + 失焦自动拉回）。

```bash
pnpm build            # 先构建后端与前端
pnpm electron:build   # 编译 Electron 主进程 / 预加载脚本
pnpm electron:start   # 启动桌面应用
```

> 需 `node` 在 PATH 中（或设置 `LITI_NODE` 指向 node 可执行文件）。

## 10. 测试与验收

```bash
pnpm test          # 单元 + 集成（74 个）
pnpm test:e2e      # E2E（需先启动服务）
```

详见 [acceptance.md](./acceptance.md)。

## 11. Docker 部署（推荐）

项目提供多阶段构建的 `Dockerfile`，构建产物内含后端 + 前端静态资源，单容器即可运行。

### 11.1 构建镜像

```bash
docker build -t liti:latest .
```

> 构建走国内镜像加速（npm 依赖用 npmmirror，node-gyp 的 headers 用 npmmirror 的 node 镜像）。
> 已跳过 electron 二进制下载（桌面壳只跑在本地，不进镜像）。

### 11.2 运行（SQLite 模式）

```bash
docker run -d --name liti -p 8080:8080 \
  -e SESSION_SECRET=请改成强随机串 \
  -v liti-data:/app/data \
  liti:latest
```

`/app/data` 同时存 SQLite 文件与题目配图（`/app/data/uploads`），一个卷就够。

首次运行需初始化账号（容器内执行 seed）：

```bash
docker exec liti node server/dist/seed.js
```

### 11.3 运行（MySQL 模式）

```bash
# 1. 起 MySQL
docker run -d --name liti-mysql -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=root123 -e MYSQL_DATABASE=liti \
  mysql:8

# 2. 起应用（MYSQL_URL 指向 MySQL 容器 IP，或用 docker network）
docker run -d --name liti -p 8080:8080 \
  -e DB_DRIVER=mysql \
  -e MYSQL_URL="mysql://root:root123@<mysql容器IP>:3306/liti" \
  -e SESSION_SECRET=请改成强随机串 \
  liti:latest
```

> 已验证：迁移 + CRUD + 组卷/答题/判分 + Excel 导出 + 统计在真实 MySQL 8 上全量通过（utf8mb4 中文存储正常）。

### 11.4 常用命令

```bash
docker logs -f liti        # 查看日志
docker exec liti node server/dist/seed.js   # 建初始账号
```

---

## 12. 常见问题

- **其它设备访问不了**：检查防火墙放行 8080；确认 `HOST=0.0.0.0`。
- **改了代码不生效**：重新执行 `pnpm build` 并重启 `pnpm start`。
- **数据库文件在哪**：`data/app.db`（可用 `SQLITE_PATH` 修改）。备份 = 停服后拷贝该文件。
- **忘记密码**：删除 `data/app.db` 后重新执行 `pnpm seed`（会清空所有数据，慎用）。
