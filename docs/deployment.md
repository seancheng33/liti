# 部署文档

> 砺题 Liti 部署指南
> 更新：2026-10-31

本文档说明如何把砺题 Liti 部署到局域网环境，供多人访问使用。

> 想用 Docker 部署？直接看 **[docker-build.md](./docker-build.md)** —— 从拉代码、构建镜像到 SQLite / MySQL
> 两种模式运行、升级备份的完整手册都在那边。本文的第 11 节只是速查。

## 1. 环境要求

- **Node.js** ≥ 20（推荐 22 或更高）
- **pnpm** ≥ 9（推荐 10/11）
- 操作系统：Windows / Linux / macOS 均可（本文以 Windows 为例）
- 可选：MySQL 8.x（默认用 SQLite，零配置，无需额外安装）

## 2. 获取代码

```bash
git clone https://github.com/seancheng33/liti.git
cd liti
```

> 仓库同时在内网 Gitea（`http://192.168.1.88:3000/sean/liti.git`）有一份镜像，内网环境拉不动 GitHub 时用那一个，内容一致。

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

> 📖 完整版（拉代码 → 构建 → 两种数据库模式 → 升级 → 备份 → 排错）见 **[docker-build.md](./docker-build.md)**。
> 下面只是最常用的几条命令。

### 11.1 构建镜像

```bash
docker build -t liti:latest .
```

> 构建走国内镜像加速（npm 依赖用 npmmirror，node-gyp 的 headers 用 npmmirror 的 node 镜像）。
> 已跳过 electron 二进制下载（桌面壳只跑在本地，不进镜像）。
> 构建过程会跑后端 `tsc` 与前端 `tsc --noEmit`，**类型不过就构建失败**。

### 11.2 运行（SQLite 模式）

```bash
docker run -d --name liti -p 8080:8080 \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -v liti-data:/app/data \
  --restart unless-stopped \
  liti:latest
```

> `SESSION_SECRET` **至少 16 个字符**，不足会直接启动失败（日志打印 `配置错误`）。上面用
> `openssl rand -hex 32` 现生成；手敲也请凑够 32 位，别写中文短句。

`/app/data` 同时存 SQLite 文件与题目配图（`/app/data/uploads`），一个卷就够。

首次运行需初始化账号（容器内执行 seed，幂等）：

```bash
docker exec liti node server/dist/seed.js
```

### 11.3 运行（MySQL 模式）

```bash
# 1. 建一个容器网络，让应用能按容器名找到 MySQL
docker network create liti-net

# 2. 起 MySQL
docker run -d --name liti-mysql --network liti-net \
  -e MYSQL_ROOT_PASSWORD=root123 -e MYSQL_DATABASE=liti \
  -v liti-mysql-data:/var/lib/mysql \
  mysql:8

# 3. 起应用（主机名用容器名 liti-mysql，不要写 127.0.0.1）
docker run -d --name liti --network liti-net -p 8080:8080 \
  -e DB_DRIVER=mysql \
  -e MYSQL_URL="mysql://root:root123@liti-mysql:3306/liti" \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -v liti-uploads:/app/data \
  liti:latest
```

> **MySQL 模式下也要挂 `/app/data`**：数据库在 MySQL 里，但题目配图仍然落在容器的
> `/app/data/uploads`，不挂卷重建容器就全丢。
>
> **密码含 `#` `@` `/` `:` 时必须 URL 编码**：`#` 是 URL 的 fragment 分隔符，`mysql://root:St#123@host/db`
> 会被截成 `mysql://root:St`，启动直接抛 `TypeError: Invalid URL`。写成 `St%23123` 即可。
>
> 已验证：迁移 + CRUD + 组卷/答题/判分 + Excel 导出 + 统计在真实 MySQL 8 上全量通过（utf8mb4 中文存储正常）。

### 11.4 常用命令

```bash
docker logs -f liti                          # 查看日志
docker exec liti node server/dist/seed.js    # 建初始账号（幂等，已存在会跳过）
curl 127.0.0.1:8080/api/health               # 健康检查
```

---

## 12. 常见问题

- **其它设备访问不了**：检查防火墙放行 8080；确认 `HOST=0.0.0.0`。
- **改了代码不生效**：重新执行 `pnpm build` 并重启 `pnpm start`。
- **数据库文件在哪**：`data/app.db`（可用 `SQLITE_PATH` 修改）。**备份别直接拷文件** —— SQLite 开着 WAL 模式，运行中拷 `app.db` 会漏掉 `-wal` 里的最新写入，用 13 节的热备命令。
- **忘记密码**：管理员可在用户管理页给学生签发重置码（v0.14）；管理员自己的密码丢了才用「删库重 seed」这条下下策（会清空所有数据，先备份）。

## 13. 备份与恢复（已在测试机演练过，2026-11-02）

### 13.1 SQLite（默认）

**热备**（不停服，`.backup()` API 在线拷贝，自动合并 WAL）——容器部署时在容器内执行：

```bash
# 容器内：生成备份（liti 镜像自带 better-sqlite3）
docker exec liti node -e "
const D=require('/app/server/node_modules/better-sqlite3');
const db=new D('/app/data/app.db');
db.backup('/app/data/backup.db').then(()=>{console.log('done');db.close()});"
# 拷出到宿主机
docker cp liti:/app/data/backup.db /root/backups/liti-sqlite-$(date +%Y%m%d).db
docker exec liti rm -f /app/data/backup.db
```

**校验**（备份完必须做）：

```bash
docker cp /root/backups/liti-sqlite-*.db liti:/app/data/_v.db
docker exec liti node -e "
const D=require('/app/server/node_modules/better-sqlite3');
const db=new D('/app/data/_v.db',{readonly:true});
console.log(db.pragma('integrity_check',{simple:true}));
for (const t of ['user','question','paper','attempt']) console.log(t, db.prepare('select count(*) n from '+t).get().n);
db.close();"
docker exec liti rm -f /app/data/_v.db
```

**恢复**（真停机换文件）：

```bash
docker stop liti
cd /var/lib/docker/volumes/liti-data/_data   # docker volume inspect liti-data 可查实际路径
mv app.db app.db.broken && rm -f app.db-shm app.db-wal   # 旧 WAL/SHM 必须一起清掉，否则新库会跟旧 WAL 撞车
cp /root/backups/liti-sqlite-XXXX.db app.db
docker start liti && curl -s http://127.0.0.1:8080/api/health
```

### 13.2 MySQL

**备份**（`--single-transaction` 对 InnoDB 一致性快照，不停服）：

```bash
docker exec liti-mysql mysqldump -uroot -p密码 --single-transaction --triggers --routines \
  --databases liti > /root/backups/liti-mysql-$(date +%Y%m%d).sql
```

**恢复**（导入回 `liti` 库；导入前先确认 dump 完整——文件尾应有 `Dump completed`）：

```bash
docker exec -i liti-mysql sh -c 'mysql -uroot -p密码' < /root/backups/liti-mysql-XXXX.sql
```

dump 里带 `CREATE DATABASE liti` / `USE liti`，所以**不用先建库**；要导进别的库名，把这两行里的 `liti` 改掉再导。恢复后 `CHECK TABLE` 抽查关键表。

### 13.3 演练记录（2026-11-02，测试机 192.168.1.61）

- SQLite：热备 → `integrity_check: ok` → 停容器换文件 → 启动后 health 200、admin 登录 200、六表行数与备份时完全一致。
- MySQL：dump 547KB → 导入临时库 `liti_restore` → user/question/attempt/password_reset 四表行数与源库逐一相等 → `CHECK TABLE` OK → 清理临时库。

## 14. 性能基线（2026-11-02，测试机 2 核 / 2GB，并发 8）

用 `liti-bench.mjs`（纯 Node HTTP，LITI_BASE 指向目标实例）压了六个场景，两库各一轮，错误率 0（MySQL exam-flow 仅 1 次瞬时失败）：

| 场景 | SQLite rps | p95 | MySQL rps | p95 | 说明 |
|---|---|---|---|---|---|
| login（正确密码） | 11.9 | 713ms | 11.2 | 824ms | **argon2 故意慢**，登录就该是这个量级 |
| 试卷列表（学生） | 324 | 35ms | 308 | 35ms | |
| 公开统计（未登录） | 185 | 52ms | 185 | 50ms | |
| 题库列表（教师） | 113 | 41ms | 120 | 40ms | |
| 答题自动保存 | 977 | 10ms | 551 | 19ms | MySQL 写盘慢一倍，符合预期 |
| 完整考试流（开考→3 存→交卷） | 43.4 流/s | 142ms | 23.1 流/s | 239ms | 整流时延 |

**读数结论**：2 核小机器上，整场考试的瓶颈根本不在接口 —— 一场 200 人同时开考的「开考洪峰」约 200 × (89ms 开考 + 3×8ms 保存) ≈ 几秒内消化完；真正该限的是登录并发（argon2），一批学生同时点登录会排队，属正常现象。压测脚本会往库里留 `【bench】`/`【bench2】` 前缀的学生、题目与答卷，可在用户管理删除学生、题目走软删除。
