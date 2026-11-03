# 砺题 Liti 演示站

一套可以直接挂在公网上给人试用的实例。和正式版是同一个镜像，差别只有三个环境变量：开了 `DEMO_MODE`、启动时灌演示数据、每小时自动还原。

访客打开就能用，登录页有三个「一键体验」按钮，不用输密码。

> **数据存在 SQLite 里**，单个文件落在 Docker 命名卷，不用另装数据库。
> 从空机器到域名可访问的完整步骤见 **[DEPLOY.md](DEPLOY.md)**（约 20 分钟，含 HTTPS、排错、安全红线）。
> 本文只讲「跑起来」和「日常怎么用」。

## 需要什么

- 一台能跑 Docker 的机器（1 核 2G 够用，镜像约 400MB）
- 一个域名（想用 HTTPS 的话）

## 三步跑起来

```bash
cd deploy/demo
cp .env.example .env
# 编辑 .env，把 SESSION_SECRET 填上：openssl rand -hex 32
docker compose up -d
```

第一次会构建镜像，三五分钟。起来之后：

```bash
curl -s http://127.0.0.1:8089/api/health     # {"ok":true,...}
```

想从自己电脑直接看：把 `.env` 里的 `DEMO_BIND` 改成 `0.0.0.0`，`TRUST_PROXY` 改成 `0`，然后 `docker compose up -d`，浏览器开 `http://服务器IP:8089`。

> 为什么直接对外要把 `TRUST_PROXY` 关掉？开着它，服务端会相信请求头里的 `X-Forwarded-For`。没有反代挡在前面时，那是访客自己能随便写的值——伪造一个 IP 就换一个限流桶，登录限流等于没有。

## 接到公网

演示站建议挂在 nginx 后面，用域名 + HTTPS 访问。不然浏览器会提示「不安全」，发给人看显得不专业。

```bash
# 1. 反代
sudo cp nginx.conf.example /etc/nginx/conf.d/liti-demo.conf
sudo vim /etc/nginx/conf.d/liti-demo.conf      # 把 demo.example.com 换成你的域名
sudo nginx -t && sudo systemctl reload nginx

# 2. 证书（nginx 已经在跑、域名已解析到本机）
sudo certbot --nginx -d demo.example.com
```

`.env` 里保持默认的 `DEMO_BIND=127.0.0.1` 和 `TRUST_PROXY=1`，这样 8089 端口只有 nginx 能碰，审计日志里记的也是访客真实 IP。

## 演示数据

启动时由 `server/dist/demo/cli.js` 灌进去，内容是：

| 东西 | 数量 | 说明 |
|---|---|---|
| 账号 | 27 | 1 管理员 + 2 教师 + 24 学生，三个班 |
| 题库 | 40 题 | 硬件、操作系统、网络、办公四个分类，单选多选都有 |
| 试卷 | 4 张 | 一张考完已出分的期中卷、一张正在进行的随堂练、一张明天的期末模拟、一张归档的旧卷 |
| 答卷 | 24 份 | 19 份已交卷（成绩有高有低，5 人缺考），5 份正在作答（3 在线 / 1 掉线 / 1 暂停） |

这样设计是为了让每个功能页都有东西可看：成绩册里有人有分有人缺考，逐题分析有 P/D 值曲线，监考页能看到在线和掉线，错题库里有真实错题。

**还原机制**：进程内定时器，每小时整点后重置一次。重置会清掉所有会话，正在看的人会被踢回登录页——重新点「一键体验」就回来了。想立刻还原：

```bash
docker restart liti-demo
```

想关掉重启自动灌数据，把 `docker-compose.yml` 里那行 `command` 注释掉。

## 账号

一键体验之外，也能用账号密码登：

| 角色 | 账号 | 密码 |
|---|---|---|
| 管理员 | `admin` | `admin123` |
| 教师 | `teacher` / `teacher2` | `teacher123` |
| 学生 | `stu01` ~ `stu24` | `student123` |

## 常见问题

**打开是白屏 / 502**
容器还在灌数据。首次启动要跑迁移 + 建 25 份答卷，大约 20 秒。`docker compose logs -f` 看到 `listening` 就好了。

**登录页没有「一键体验」按钮**
说明 `DEMO_MODE` 没生效。`docker compose exec liti-demo env | grep DEMO_MODE` 看一眼，应该是 `1`。

**改完 .env 没反应**
`docker compose up -d` 会重建容器；只 `restart` 不会重新读 `.env`。

**每小时被踢下线一次**
这是设计如此，数据在还原。觉得太频繁可以改 `server/src/server.ts` 里的 `DEMO_RESET_INTERVAL_MS`，重新构建镜像。

**想给演示站加自己学校的题库**
改 `server/src/demo/data.ts` 里的 `DEMO_QUESTIONS`，重新构建。数据是写死在代码里的，不走后台录入——那样每次还原都会被冲掉。

## 三件要注意的事

1. **别往演示站里传真实数据。** 每小时清空，传了也白传，而且访客都能看见。
2. **`DEMO_MODE=1` 千万别带到正式环境。** 它会注册免密码登录接口，等于把后台敞开。正式部署用仓库根的 Dockerfile 默认启动方式，不要复制这份 compose。
3. **磁盘。** 图片上传会写进 volume，还原时一起清；日志限制在 30MB 以内。长期跑不用管，但机器本身别只剩几百兆。
