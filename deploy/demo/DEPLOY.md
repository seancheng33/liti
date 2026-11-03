# 砺题演示站 · 部署手册

给「想挂一个公网 demo 让人点」的场景写的。照这份从头做，一台空机器到能访问的域名，大概 20 分钟（不含等镜像构建）。

---

## 1. 你要部署的是什么

一句概括：**跟正式版同一个镜像，靠三个环境变量变成演示站。**

| | 正式部署 | 演示站 |
|---|---|---|
| 镜像 | 同一个 `liti:latest` | 同一个 |
| 数据库 | SQLite（可换 MySQL） | **SQLite，固定** |
| 登录 | 账号密码 | 账号密码 + 免密「一键体验」 |
| 数据 | 自己录，永久保留 | 启动灌一套演示数据，**每小时还原** |
| 站内提示 | 无 | 全站顶部一条「演示环境」横幅 |

演示模式打开的三样东西：

- `/api/demo/login` 免密登录接口（只放行 admin / teacher / stu01 三个账号）
- 登录页三个「一键体验」按钮
- 顶部横幅

关掉 `DEMO_MODE`，这些路由**在注册阶段就不存在**，直接 404，不是靠 handler 里判断。

### 数据库用的是哪个

**SQLite。** 单文件，默认 `/app/data/app.db`（容器内），落在 Docker 命名卷里。

- 不需要装 MySQL，不需要连外部数据库
- 整个站的数据就一个文件，出问题删卷重来，反正是生成的
- 想换成 MySQL 也可以（`DB_DRIVER=mysql` + `MYSQL_URL`），但演示站没必要，每次还原都要连库反而更容易出问题

---

## 2. 关于 `.env.example` 找不到

`deploy/demo/` 下四个文件：

```
.env.example          ← 就是它，点开头
README.md
docker-compose.yml
nginx.conf.example
```

**`.env.example` 是以点开头的文件，很多地方默认不显示它：**

| 你在哪看 | 怎么看到 |
|---|---|
| 命令行 `ls` | 用 `ls -a` |
| Windows 资源管理器 | 正常能看见（它不是隐藏属性） |
| VSCode / IDEA 侧边栏 | 默认能看见 |
| WinSCP / FileZilla | 服务器端「显示隐藏文件」勾上 |
| GitHub 网页 | 能看见 |
| 某些网盘/同步工具 | 会过滤点文件，别用它传 |

确认它在不在，一条命令：

```bash
ls -la deploy/demo/
```

---

## 3. 前置条件

- Docker 20.10+，compose v2（`docker compose version` 能跑）
- 1 核 2G 内存起步，磁盘留 2G
- 一个端口（默认宿主 8089 → 容器 8080）
- 想用域名访问的话：域名已解析到这台机器，80/443 放行

镜像约 400MB。首次构建要编译 `argon2` 和 `better-sqlite3` 两个原生模块，2 核机器大约 5–10 分钟，慢是正常的。

---

## 4. 先选部署方式

| | 方式一：服务器上构建 | 方式二：本地构建后传镜像 |
|---|---|---|
| 适合 | 服务器能访问外网、能拉 npm 包 | 服务器网络差，或只允许给它一个部署包 |
| 需要传什么 | 整个仓库 | `docker-compose.yml` + `.env` + 一个 tar 镜像 |
| 构建耗时 | 服务器上等 5–10 分钟 | 本地等一次，之后秒传 |

> **只把 `deploy/demo/` 目录拷到服务器是跑不起来的。** compose 里写的是 `build: context: ../..`，它要回到仓库根目录找 `Dockerfile`。只拷这一个目录，`docker compose up` 会报 `Dockerfile not found`。

---

## 5. 方式一：在服务器上构建

### 5.1 拿到代码并进目录

```bash
git clone https://github.com/seancheng33/liti.git
cd liti/deploy/demo
```

没有 git 的话，把整个仓库打包传上来也一样，只要保证 `deploy/demo/` 和根目录的 `Dockerfile` 相对位置没变。

### 5.2 建配置文件

```bash
cp .env.example .env
```

### 5.3 填 `SESSION_SECRET`

这是唯一必填项，空着容器起不来（compose 里做了必填校验，会直接报错并告诉你怎么生成）。

```bash
openssl rand -hex 32
```

把输出粘到 `.env` 的 `SESSION_SECRET=` 后面。没有 openssl 就用：

```bash
head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
```

改完长这样（64 位十六进制）：

```ini
SESSION_SECRET=3f8a1c9e5b7d2064af13cc8e9d4b7a05e2f6c1d8903b4a7e5c2d8f1b6a9e3c40
```

### 5.4 启动

```bash
docker compose up -d
```

第一次会构建镜像。跟进度：

```bash
docker compose logs -f
```

看到这几行就算好了：

```
[demo] 演示数据已重置：27 个账号、40 道题、4 张试卷、24 份答卷，耗时 xxx ms
[demo] 演示模式已开启，每 60 分钟还原一次数据
Server listening at http://0.0.0.0:8080
```

### 5.5 验证

```bash
curl -s http://127.0.0.1:8089/api/health
# {"ok":true,"time":1793676641559}

curl -s http://127.0.0.1:8089/api/demo/info
# {"demo":true,"siteName":"砺题 Liti · 演示","accounts":[...]}
```

第二条有返回，说明演示模式生效了。

---

## 6. 方式二：本地构建后传镜像

适合服务器不能拉 npm 包的情况。

### 6.1 本地构建

在**仓库根目录**（不是 deploy/demo）执行：

```bash
docker build -t liti-demo:latest .
```

### 6.2 导出并传过去

```bash
docker save liti-demo:latest | gzip > liti-demo.tar.gz
scp liti-demo.tar.gz root@你的服务器:/root/
```

### 6.3 服务器上导入

```bash
gunzip -c /root/liti-demo.tar.gz | docker load
docker images | grep liti-demo
```

### 6.4 只放两个文件

服务器上建个目录，放 `docker-compose.yml` 和 `.env`：

```bash
mkdir -p /opt/liti-demo && cd /opt/liti-demo
# 从本地传这两个文件上来
```

然后把 `docker-compose.yml` 里 `build:` 那三行删掉（或者注释掉），只留 `image: liti-demo:latest`：

```yaml
  liti-demo:
    # build:
    #   context: ../..
    #   dockerfile: Dockerfile
    image: liti-demo:latest
```

否则 compose 还是会尝试去构建。

`.env` 的内容跟方式一一样，`SESSION_SECRET` 别忘了填。

### 6.5 启动

```bash
docker compose up -d
docker compose logs -f
```

---

## 7. 配置项逐个说

`.env` 里就五项，全都有默认值，只有 `SESSION_SECRET` 必填。

| 变量 | 默认 | 说明 |
|---|---|---|
| `SESSION_SECRET` | 空 | **必填**。会话签名密钥，至少 16 字符。演示站被人猜到也无所谓，但不能为空 |
| `DEMO_PORT` | `8089` | 宿主端口。被占用就改这个，比如 `18089` |
| `DEMO_BIND` | `127.0.0.1` | 监听地址。挂 nginx 用默认值；想直接 IP 访问改成 `0.0.0.0` |
| `TRUST_PROXY` | `1` | 是否信任 `X-Forwarded-For`。挂 nginx 填 `1`，直接对外必须填 `0` |
| `BASE_PATH` | `/liti/` | 部署子路径。挂别人家目录下填 `/liti/`，独占域名或直接开端口填 `/` |

### `TRUST_PROXY` 为什么不能乱开

开着它，服务端就相信请求头里的 `X-Forwarded-For`。没有反代挡在前面时，这个值是访客自己能随便写的——换一个伪造 IP 就换一个限流桶，登录限流等于没有。

所以：

- 有 nginx/Caddy 在前面 → `1`（审计日志记真实 IP，限流按真实 IP 分桶）
- 直接 `IP:端口` 裸奔 → `0`

---

## 8. 域名 + HTTPS

### 8.1 先确认容器只监听本机

`.env` 保持默认：

```ini
DEMO_BIND=127.0.0.1
TRUST_PROXY=1
```

这样 8089 只有本机的 nginx 能碰，外面扫不到。

### 8.2 首次部署：先只配 80

`nginx.conf.example` 里带了 443 段，但它指向 certbot 还没签出来的证书。**证书不存在时 `nginx -t` 会直接失败**，所以第一次要分两步。

先放一个只有 80 的版本：

```bash
sudo mkdir -p /var/www/html
sudo tee /etc/nginx/conf.d/liti-demo.conf > /dev/null <<'EOF'
server {
    listen 80;
    server_name demo.example.com;   # 换成你的域名

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://127.0.0.1:8089;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
EOF

sudo nginx -t && sudo systemctl reload nginx
```

### 8.3 签证书

```bash
sudo certbot certonly --webroot -w /var/www/html -d demo.example.com
```

### 8.4 换成完整配置

证书签好之后，用仓库里那份替换掉：

```bash
sudo cp deploy/demo/nginx.conf.example /etc/nginx/conf.d/liti-demo.conf
sudo sed -i 's/demo.example.com/你的域名/g' /etc/nginx/conf.d/liti-demo.conf
sudo nginx -t && sudo systemctl reload nginx
```

### 8.5 放行防火墙

```bash
# firewalld
sudo firewall-cmd --add-service=http --add-service=https --permanent && sudo firewall-cmd --reload

# ufw
sudo ufw allow 80,443/tcp
```

**别放行 8089。** 它只该被 nginx 从本机访问。

### 8.6 验证

```bash
curl -sI https://你的域名/ | head -3
curl -s https://你的域名/api/health
```

浏览器打开能看到登录页和三个「一键体验」按钮，就成了。

### 8.7 换个玩法：挂到已有站点的子目录下

不想为演示站单独申请域名？可以挂在现有站点下，访问 `https://example.com/liti/`。

这种部署方式和前面几步有三处不同，**顺序别搞反**：

**第一，容器要按子路径重新构建。** 前端资源地址是构建时固化进 `index.html` 的，`.env` 里设了 `BASE_PATH` 之后必须重建：

```ini
# .env
BASE_PATH=/liti/
DEMO_BIND=127.0.0.1     # 或者跨机部署时的 0.0.0.0
TRUST_PROXY=1
```

```bash
docker compose up -d --build     # 只 up -d 不会重新打包前端
```

**第二，nginx 配置放在现有站点的 server 块里**，用 `^~` 修饰符、`proxy_pass` 末尾不带斜杠：

```nginx
location ^~ /liti/ {
    proxy_pass http://127.0.0.1:8089;   # 跨机就换成 http://对方内网IP:8080
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 20m;
    proxy_read_timeout 120s;
}
location = /liti { return 301 /liti/; }
```

完整注释版在 `nginx-subpath.conf.example`。

**第三，不需要另外签证书。** 证书是按域名签的，整个域名都覆盖，子目录天然就是 HTTPS。

两个细节容易翻车：

- **`^~` 不能省。** nginx 的匹配顺序是「最长前缀匹配优先，但正则 location 会插队」。主站要是有 `location ~ \.js$` 这类规则，`/liti/assets/xxx.js` 会被它抢走，照样白屏。
- **`proxy_pass` 末尾的斜杠不能加。** 加了 nginx 会先剥掉 `/liti`，而后端以为自己挂在 `/liti/` 下，两边对不上，接口全线 404。

改完验证第三条最关键：

```bash
curl -I https://example.com/liti/            # 200
curl -s https://example.com/liti/api/health  # {"ok":true,...}
```

打开页面看看 F12 的 Network，`index-*.js` 的状态码要是 200。是 404 就说明前端没重新构建，或者 `BASE_PATH` 和 nginx 对不上。

---

## 9. 演示数据长什么样

启动时由 `server/dist/demo/cli.js` 灌进去，内容是固定生成的（随机数用了固定种子，每次还原结果一致）。

| 东西 | 数量 | 说明 |
|---|---|---|
| 账号 | 27 | 1 管理员 + 2 教师 + 24 学生，分三个班 |
| 题库 | 40 题 | 硬件、操作系统、网络、办公四类，单选多选都有，带解析 |
| 试卷 | 4 张 | 已归档的摸底卷、已出分的期中卷、正在进行的随堂练、明天的期末模拟 |
| 答卷 | 24 份 | 19 份已交卷（分数有高有低，5 人缺考），5 份正在作答 |
| 审计日志 | 12 条 | 覆盖建号、导入、发布、归档、撤销违规、登录等动作 |

5 份正在作答的答卷覆盖了监考页的所有状态：3 个在线、1 个掉线、1 个已暂停，其中一份还带违规记录。

### 账号密码

一键体验之外也能用账号登：

| 角色 | 账号 | 密码 |
|---|---|---|
| 管理员 | `admin` | `admin123` |
| 教师 | `teacher` / `teacher2` | `teacher123` |
| 学生 | `stu01` ~ `stu24` | `student123` |

### 三个还原机制

| 触发 | 行为 |
|---|---|
| 每小时整点后 | 进程内定时器自动重置（`server.ts` 里 `DEMO_RESET_INTERVAL_MS`，默认 3600000） |
| 容器重启 | compose 的 `command` 先跑 `cli.js` 再起服务，等于重启就还原 |
| 手动 | `docker restart liti-demo` |

**重置会清掉所有会话**，正在看的人被踢回登录页，重新点「一键体验」就回来了。题目配图也会一起删——不然访客每传一张图就永久占一份磁盘，挂几个月能把小机器塞满。

### 想改还原频率

改 `server/src/server.ts` 里的 `DEMO_RESET_INTERVAL_MS`（当前 `60 * 60 * 1000`），重新构建镜像。改完记得 `docker compose up -d --build`。

### 想换自己学校的题库

改 `server/src/demo/data.ts` 里的 `DEMO_QUESTIONS`，重新构建。数据写死在代码里，不走后台录入——那样每次还原都被冲掉。

---

## 10. 日常运维

```bash
# 看日志（日志已限制单文件 10MB、保留 3 个）
docker compose logs -f --tail=100

# 看状态和健康检查
docker compose ps

# 进去摸一下
docker compose exec liti-demo sh

# 确认演示模式开着
docker compose exec liti-demo env | grep -E "DEMO_MODE|TRUST_PROXY"

# 手动还原数据
docker restart liti-demo

# 停掉（保留数据卷）
docker compose down

# 停掉并删数据卷（下次启动重新灌）
docker compose down -v
```

### 升级

```bash
git pull
cd deploy/demo
docker compose up -d --build
```

方式二（传镜像的）就重新 build / save / load / `docker compose up -d`。

### 备份

**演示站不需要备份。** 数据是代码生成的，删了重来就是。真要留一份排查用：

```bash
docker run --rm -v demo_demo-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/demo-data-$(date +%F).tar.gz -C /data .
```

卷名不一定是 `demo_demo-data`，用 `docker volume ls` 确认一下。

---

## 11. 排错

外部访问不通、`TRUST_PROXY` 配错这类要一步步定位的，单独写在了 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。下面是能一眼看出原因的：

| 现象 | 原因 | 处理 |
|---|---|---|
| `up` 直接报 `SESSION_SECRET` 相关错误 | `.env` 没填或太短 | `openssl rand -hex 32` 生成一个填上 |
| `Dockerfile not found` | 只拷了 `deploy/demo/`，没带仓库根 | 传整个仓库，或改用方式二 |
| 容器起来又退出 | 配置错误。真实原因只在**第一次**日志里 | `docker compose logs --tail=50 liti-demo` |
| 502 / 打开白屏 | 还在灌数据，首次约 20 秒 | `docker compose logs -f` 等 `listening` |
| 登录页没有「一键体验」 | `DEMO_MODE` 没生效 | `docker compose exec liti-demo env \| grep DEMO_MODE`，应为 `1` |
| 改完 `.env` 没反应 | `restart` 不会重读 `.env` | `docker compose up -d` 重建容器 |
| 每小时被踢下线一次 | 设计如此，数据在还原 | 觉得烦就改 `DEMO_RESET_INTERVAL_MS` 重新构建 |
| 宿主 8089 被占用，起不来 | 端口冲突 | 改 `.env` 的 `DEMO_PORT`，nginx 里 `proxy_pass` 跟着改 |
| `nginx -t` 报 `unknown directive "http2"` | nginx 版本低于 1.25.1 | 删掉 `http2 on;`，把 `listen 443 ssl;` 改成 `listen 443 ssl http2;` |
| 审计日志里 IP 全是 127.0.0.1 | 没开 `TRUST_PROXY`，或 nginx 没传 `X-Forwarded-For` | 挂反代时 `TRUST_PROXY=1`，并检查 nginx 那三行 `proxy_set_header` |
| 一直 502，nginx 报 `connect() failed` | nginx 跑在容器里，`127.0.0.1` 指的不是宿主机 | `proxy_pass` 改用宿主机内网 IP，或让 nginx 走 `host` 网络 |
| HTTPS 打不开，`nginx -t` 报证书不存在 | 先上了 443 配置后签证书 | 按第 8 节的两步走：先 80，签完再换完整配置 |

---

## 12. 三条红线

1. **`DEMO_MODE=1` 绝不能带到正式环境。** 它注册的免密登录接口等于把后台门敞开。正式部署用仓库根的 `Dockerfile` 默认启动方式，别抄这份 compose。

2. **演示站别放真实数据。** 每小时清一次，传了也白传，而且所有访客都能看见。学生真名、真实成绩不要往这儿放。

3. **8089 别对公网开。** 它没有 HTTPS，也绕过了 nginx 的限流和访问日志。只让 nginx 从本机访问。

---

## 附：一页速查

```bash
# 部署
git clone https://github.com/seancheng33/liti.git
cd liti/deploy/demo
cp .env.example .env
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
docker compose up -d

# 验证
curl -s http://127.0.0.1:8089/api/health
curl -s http://127.0.0.1:8089/api/demo/info

# 还原
docker restart liti-demo

# 升级
git pull && docker compose up -d --build

# 收摊
docker compose down -v
```
