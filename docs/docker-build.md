# 自己拉代码做 Docker 镜像

> 砺题 Liti · 从源码构建到两种数据库模式的完整操作手册
> 更新：2026-10-31

这篇文档面向「拿到仓库地址、手上只有一台装了 Docker 的机器」的场景：拉代码 → 构建镜像 → 用 SQLite 或 MySQL 跑起来 → 以后怎么升级、怎么备份。

如果你只是想快速起一个试用环境，直接跳到 [3. 模式 A：SQLite](#3-模式-asqlite零配置推荐先用这个)。

---

## 1. 前置条件

| 项目 | 要求 | 检查命令 |
|---|---|---|
| Docker | 20.10 以上，能正常拉取镜像 | `docker version` |
| Docker Compose | v2（`docker compose`）或 v1（`docker-compose`），可选 | `docker compose version` |
| Git | 任意较新版本 | `git --version` |
| 磁盘 | 镜像约 500MB，数据卷另算 | `df -h` |

> 构建过程会从 npm 源装依赖、用 node-gyp 编译 `better-sqlite3` 和 `argon2` 两个原生模块，
> 所以**首次构建需要能访问 npm 源**（Dockerfile 里已配好 npmmirror 国内镜像）以及**至少 2GB 空闲内存**。

---

## 2. 拉代码并构建镜像

### 2.1 拉代码

```bash
git clone http://192.168.1.88:3000/sean/liti.git
cd liti
```

想固定到某个版本，切到对应 tag / commit：

```bash
git tag                 # 看有哪些版本
git checkout <tag>
```

### 2.2 构建

```bash
docker build -t liti:latest .
```

构建分两个阶段，Dockerfile 里已经处理好：

1. **builder 阶段**：装全量依赖 → 编译后端（`tsc`）→ 前端跑一遍类型检查（`tsc --noEmit`）→ `vite build`。
   **类型检查不过会直接构建失败**，所以「镜像构建成功」本身就意味着代码类型是干净的。
2. **runner 阶段**：只装生产依赖，把 `server/dist` 与 `web/dist` 拷进去，单进程同时提供 API 与前端静态资源。

首次构建大约 5–10 分钟（取决于网速）。之后改代码再构建，依赖层有缓存，通常 1–2 分钟。

构建成功后会看到：

```
=> => naming to docker.io/library/liti:latest
```

确认一下：

```bash
docker images liti
```

> **构建失败的常见原因**
> - `error TS2339 / TS2345`：类型错误，看日志里 `src/xxx.ts(line,col)` 定位，属于代码问题。
> - `node-gyp rebuild` 报错 / 卡住：原生模块编译失败，确认 `apk add python3 make g++` 那层没被跳过，以及机器内存够。
> - 拉 `node:20-alpine` 超时：给 Docker 配镜像加速，或先 `docker pull node:20-alpine` 再构建。

### 2.3 关于 Electron

`electron/` 目录只在本地开发桌面壳时用，镜像里**不包含**它（Dockerfile 里设置了 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`）。
服务器部署不需要 Electron。

---

## 3. 模式 A：SQLite（零配置，推荐先用这个）

适合：单机、几十人以内、不想额外维护数据库。

### 3.1 一条命令起服务

```bash
docker run -d --name liti \
  -p 8080:8080 \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -v liti-data:/app/data \
  --restart unless-stopped \
  liti:latest
```

参数说明：

| 参数 | 作用 |
|---|---|
| `-p 8080:8080` | 宿主机 8080 → 容器 8080 |
| `-e SESSION_SECRET` | 会话签名密钥，**至少 16 个字符**（不足会直接启动失败）。上面的 `$(openssl rand -hex 32)` 会生成 64 位随机串；本机没有 openssl 就随便敲 32 个字符，**别照抄中文占位符** |
| `-v liti-data:/app/data` | 数据卷。SQLite 文件（`/app/data/app.db`）和题目配图（`/app/data/uploads`）都在这里 |
| `--restart unless-stopped` | 开机/异常退出自动拉起 |

### 3.2 初始化账号

容器启动时会**自动跑数据库迁移**（建表），但不会建账号。首次部署执行一次 seed：

```bash
docker exec liti node server/dist/seed.js
```

会得到三个默认账号：

| 账号 | 密码 | 角色 |
|---|---|---|
| admin | admin123 | 管理员 |
| teacher | teacher123 | 教师 |
| student | student123 | 学生 |

> ⚠️ 上线前务必登录后台改掉这三个密码。
> seed 是幂等的：已存在的用户会跳过，重复执行不会覆盖你改过的密码。

### 3.3 验证

```bash
curl -s http://127.0.0.1:8080/api/health
curl -s http://127.0.0.1:8080/api/public/overview
```

浏览器打开 `http://<服务器IP>:8080`，能看到首页统计与已发布试卷就说明通了。

### 3.4 用 docker compose（可选）

`compose.yaml`：

```yaml
services:
  liti:
    image: liti:latest
    container_name: liti
    ports:
      - '8080:8080'
    environment:
      # 至少 16 个字符，不足会启动失败。用 `openssl rand -hex 32` 生成后粘进来。
      SESSION_SECRET: 'liti-demo-secret-0123456789abcdef'
      TZ: Asia/Shanghai
    volumes:
      - liti-data:/app/data
    restart: unless-stopped

volumes:
  liti-data:
```

```bash
docker compose up -d
docker compose exec liti node server/dist/seed.js
```

---

## 4. 模式 B：MySQL 8

适合：已经有 MySQL 实例、需要多实例共享数据、或者要做主从/集中备份。

### 4.1 先建库

如果用现成的 MySQL，先建库并确认字符集：

```sql
CREATE DATABASE liti DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'liti'@'%' IDENTIFIED BY '强密码';
GRANT ALL PRIVILEGES ON liti.* TO 'liti'@'%';
FLUSH PRIVILEGES;
```

用容器起一个的话就不用手工建库，`MYSQL_DATABASE` 会自动建。

### 4.2 建网络（容器互访用）

容器之间要靠网络名字互相找到，先建一个：

```bash
docker network create liti-net
```

### 4.3 起 MySQL

```bash
docker run -d --name liti-mysql \
  --network liti-net \
  -e MYSQL_ROOT_PASSWORD='root-强密码' \
  -e MYSQL_DATABASE=liti \
  -v liti-mysql-data:/var/lib/mysql \
  --restart unless-stopped \
  mysql:8
```

等它就绪（第一次初始化要十几秒）：

```bash
docker logs -f liti-mysql
# 看到 [System] [MY-010931] ... ready for connections 就好了，Ctrl+C 退出
```

### 4.4 起应用

```bash
docker run -d --name liti \
  --network liti-net \
  -p 8080:8080 \
  -e DB_DRIVER=mysql \
  -e MYSQL_URL='mysql://root:root-强密码@liti-mysql:3306/liti' \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -v liti-uploads:/app/data \
  --restart unless-stopped \
  liti:latest
```

几个关键点：

- **`MYSQL_URL` 里的主机名用容器名 `liti-mysql`**，不要写 `127.0.0.1` —— 容器里的 127.0.0.1 是它自己。
- **MySQL 模式下也要挂 `/app/data`**：数据库在 MySQL 里，但**题目配图仍然落在容器的 `/app/data/uploads`**。
  不挂卷的话，重建容器图片全丢（数据库里的 `/uploads/xxx.png` 会变成坏链）。
- 迁移由应用启动时自动执行，日志里能看到 `迁移 0001_init: Success` 这样的行。

### 4.5 初始化账号

```bash
docker exec liti node server/dist/seed.js
```

## 4.6 用 docker compose（可选）

`compose.yaml`：

```yaml
services:
  mysql:
    image: mysql:8
    container_name: liti-mysql
    environment:
      MYSQL_ROOT_PASSWORD: 'root-强密码'
      MYSQL_DATABASE: liti
    volumes:
      - liti-mysql-data:/var/lib/mysql
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost', '-p$$MYSQL_ROOT_PASSWORD']
      interval: 5s
      retries: 20

  liti:
    image: liti:latest
    container_name: liti
    depends_on:
      mysql:
        condition: service_healthy
    ports:
      - '8080:8080'
    environment:
      DB_DRIVER: mysql
      MYSQL_URL: 'mysql://root:root-强密码@mysql:3306/liti'
      SESSION_SECRET: 'liti-demo-secret-0123456789abcdef'
    volumes:
      - liti-uploads:/app/data
    restart: unless-stopped

volumes:
  liti-mysql-data:
  liti-uploads:
```

```bash
docker compose up -d
docker compose exec liti node server/dist/seed.js
```

> `depends_on: condition: service_healthy` 很重要：MySQL 容器「启动了」不等于「能连了」，
> 少了健康检查应用会抢跑，然后在第一次连库时报 `ECONNREFUSED` 退出。

---

## 5. 两种模式怎么选

| | SQLite（模式 A） | MySQL（模式 B） |
|---|---|---|
| 额外组件 | 无 | 需要一个 MySQL 8 实例 |
| 数据位置 | 卷 `liti-data` 里的 `app.db` | MySQL 库 + 卷里的 uploads |
| 备份 | 拷一个文件 | `mysqldump` + uploads |
| 并发写入 | 单写者，几十人够用 | 多连接，更多人/更多写 |
| 迁移数据 | 想从 A 换到 B：没有内置工具，需手工导表 | — |

> 两个模式跑的是**同一套迁移与业务代码**，功能完全一致（已在真实 MySQL 8 上跑过全量验收）。

---

## 6. 升级到新版本

```bash
cd liti
git pull                              # 或 git checkout <新tag>
docker build -t liti:latest .         # 重新构建
docker stop liti && docker rm liti    # 旧容器停掉
# 用原来的 docker run 参数重新起（数据在卷里，不受影响）
```

或者用 compose：

```bash
docker compose build
docker compose up -d
```

**升级不会丢数据**：数据库迁移会在新容器启动时自动执行，只做增量变更（加表/加字段）。
数据卷 `liti-data` / `liti-mysql-data` 没被删除，就一直都在。

> 升级前建议先备份（见下一节）。跨多个版本升级也没问题，迁移会按顺序补齐。

---

## 7. 备份与恢复

### 7.1 SQLite

```bash
# 备份（服务运行中也能拷，但停服最稳）
docker stop liti
docker run --rm -v liti-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/liti-backup-$(date +%F).tar.gz -C /data .
docker start liti
```

恢复：

```bash
docker stop liti
docker run --rm -v liti-data:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/liti-backup-2026-10-31.tar.gz -C /data'
docker start liti
```

### 7.2 MySQL

```bash
# 数据库
docker exec liti-mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction liti' \
  > liti-db-$(date +%F).sql

# 配图
docker run --rm -v liti-uploads:/data -v "$PWD":/backup alpine \
  tar czf /backup/liti-uploads-$(date +%F).tar.gz -C /data .
```

恢复：

```bash
docker exec -i liti-mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" liti' < liti-db-2026-10-31.sql
```

> **别只备份数据库**：题目配图不在库里，只拷 `.sql` 会导致所有图片题变空图。

---

## 8. 配置项一览

全部通过 `-e` 传入，或在 compose 里写 `environment`。

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | 容器内监听端口 | `8080` |
| `HOST` | 监听地址 | `0.0.0.0` |
| `DB_DRIVER` | `sqlite` 或 `mysql` | `sqlite` |
| `SQLITE_PATH` | SQLite 文件路径 | `/app/data/app.db` |
| `MYSQL_URL` | `mysql://用户:密码@主机:3306/库名` | — |
| `SESSION_SECRET` | 会话签名密钥，**≥16 字符** | 开发默认值（生产必须改） |
| `SESSION_TTL_MS` | 登录有效期 | 7 天 |
| `UPLOAD_DIR` | 配图落盘目录 | `/app/data/uploads` |
| `AUTH_PROVIDERS` | `local` / `local,oidc` | `local` |
| `NODE_ENV` | 镜像里已是 `production` | `production` |

---

## 9. 排错

| 现象 | 原因与处理 |
|---|---|
| 容器**不断重启**（几秒一次） | 配了 `--restart` / `restart: unless-stopped` 时，启动失败会被无限重拉，看起来像「一直重启」。真实原因只在第一次的日志里：`docker logs <容器> \| head -5`。排错时先去掉 `--restart` 前台跑一次，栈直接打在屏幕上 |
| 容器起来几秒就退出 | `docker logs liti` 看报错。最常见是 `SESSION_SECRET` 少于 16 位（日志会打印 `配置错误: ... SESSION_SECRET`）；其次是 `MYSQL_URL` 连不上、宿主端口被占（`EADDRINUSE`） |
| 页面 502 / 打不开 | `docker ps` 看容器是否 Up；`curl 127.0.0.1:8080/api/health` 从宿主机测 |
| 登录后立刻掉线 | 多个实例用了不同 `SESSION_SECRET`，或没挂卷导致重启后会话表丢失 |
| MySQL 报 `ECONNREFUSED` | 用了 `127.0.0.1` 而不是容器名；或 MySQL 还没初始化完就起应用 |
| 图片全部裂开 | `/app/data` 没挂卷，重建容器后 uploads 丢了；或从别的机器恢复时只导了库没导 uploads |
| 中文变成问号 | MySQL 库不是 `utf8mb4`（见 4.1） |
| 构建卡在 `pnpm install` | 网络问题；Dockerfile 已配 npmmirror，需要能通 `registry.npmmirror.com` |
| 时区差 8 小时 | 加 `-e TZ=Asia/Shanghai` |

日志：

```bash
docker logs -f --tail 200 liti
```

---

## 10. 不用 Docker 的部署方式

如果目标机器不方便装 Docker，也可以直接跑：

```bash
pnpm install
pnpm build
pnpm seed     # 建表 + 初始账号
pnpm start    # 单进程，默认 8080
```

配置方式相同（环境变量或 `server/.env`），详见 [deployment.md](./deployment.md)。
唯一区别是要自己准备 Node.js ≥ 20 与常驻手段（NSSM / pm2 / systemd）。
