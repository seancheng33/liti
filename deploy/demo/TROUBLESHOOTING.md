# 常见错误排查

部署或使用演示站时遇到的坑，按现象查。每条都写清楚**怎么确认**和**为什么**，照着敲命令基本能自己定位。

部署步骤本身看 [DEPLOY.md](DEPLOY.md)，这里只讲出问题之后怎么查。

---

## 一、127.0.0.1 能访问，换成 IP 就不通

最常见的求助。典型描述是：

> 在服务器上 `curl http://127.0.0.1:8089/api/health` 返回 `{"ok":true,...}`，
> 但 `curl http://10.147.17.242:8089/api/health` 直接连不上。

服务本身是好的，问题出在**它只在一个网卡上监听**。127.0.0.1 是回环地址，只有本机能走；别的机器（包括你自己机器上的另一个网卡地址）要访问，服务必须监听 `0.0.0.0`。

### 先做三步确认

```bash
# 1. 看容器发布的端口
docker compose ps
# PORTS 列是判断依据：
#   127.0.0.1:8089->8080/tcp   只绑本机 ← 问题就在这
#   0.0.0.0:8089->8080/tcp     绑了所有网卡，正常

# 2. 看宿主机上 8089 实际监听在哪
ss -lntp | grep 8089
# LISTEN 0 4096 127.0.0.1:8089    只绑本机
# LISTEN 0 4096 0.0.0.0:8089      正常

# 3. 看 .env 里到底写了什么
grep -E "DEMO_BIND|DEMO_PORT|TRUST_PROXY" .env
```

第 1 步显示 `127.0.0.1` 的话，从下面四条原因里挑。

### 原因 1：compose 里变量名被改坏了

最隐蔽的一种，变量名写错了不报错、不警告，只是默默用默认值。

正确的写法是这样：

```yaml
- "${DEMO_BIND:-127.0.0.1}:${DEMO_PORT:-8089}:8080"
#    ↑ 变量名        ↑ 没设时的默认值
```

有人想改成对外，会把中间那段换成 `0.0.0.0`，结果写成了：

```yaml
- "${0.0.0.0:-127.0.0.1}:${DEMO_PORT:-8089}:8080"
#    ↑ 这变成了变量名，不是值
```

`${VAR:-默认}` 里冒号左边是**变量名**。写成 `0.0.0.0` 就是让 compose 去找一个叫 `0.0.0.0` 的环境变量，永远找不到，于是永远取默认的 `127.0.0.1`。**这种情况下改 `.env` 一点用都没有**，因为变量名根本对不上。

确认：

```bash
grep -A2 "ports:" docker-compose.yml
# 或者让 compose 把最终结果算给你看
docker compose config | grep -E "host_ip|published"
```

改回 `${DEMO_BIND:-...}` 即可。

### 原因 2：`.env` 里 `DEMO_BIND` 还是 `127.0.0.1`

`.env.example` 默认给的就是 `127.0.0.1`，因为推荐做法是让 nginx 从本机反代。要直接对外访问，得自己改：

```bash
DEMO_BIND=0.0.0.0
TRUST_PROXY=0
```

第二条别漏，理由见[第二节](#二trust_proxy-配错等于没限流)。

两个容易踩的点：

- **`.env` 必须和 `docker-compose.yml` 在同一个目录**。compose 只认当前工作目录下的 `.env`，在别处执行 `docker compose` 就读不到。
- **文件名以点开头**，`ls` 看不见，用 `ls -la`，WinSCP / FileZilla 要开「显示隐藏文件」。

### 原因 3：改了 `.env` 没重建容器

```bash
docker compose restart      # 只重启进程，端口映射不变，白改
docker compose up -d        # 重新读 .env 并重建，端口映射才会变
```

只要动了 `.env`（尤其是 `DEMO_BIND`、`DEMO_PORT`），都必须 `up -d`。`restart` 不算数。

### 原因 4：防火墙或云安全组

前提是 `ss` 已经显示 `0.0.0.0:8089` 却还是不通，那才轮到防火墙。

```bash
firewall-cmd --list-ports                                  # CentOS / RHEL
ufw status verbose                                         # Ubuntu / Debian
iptables -L INPUT -n --line-numbers | head -20             # 通用的兜底看
```

放行：

```bash
firewall-cmd --add-port=8089/tcp --permanent && firewall-cmd --reload
ufw allow 8089/tcp
```

云服务器（阿里云、腾讯云之类）还要去控制台的安全组里放行 8089，这一步经常被忘掉，`firewall-cmd` 放行了也没用。

### 原因 5：容器里的应用绑到了 127.0.0.1

比较少见。端口映射是 `0.0.0.0:8089->8080`，但容器内的服务自己只监听 `127.0.0.1:8080`，外面的流量照样进不来。

```bash
docker compose exec liti-demo cat /proc/net/tcp
```

第二列是本地监听地址，十六进制。端口 8080 = `1F90`：

| 显示 | 含义 |
|---|---|
| `00000000:1F90` | `0.0.0.0:8080`，正常 |
| `0100007F:1F90` | `127.0.0.1:8080`，只监听容器内回环，外部进不来 |

砺题的服务按 `HOST` / `PORT` 环境变量监听，默认 `0.0.0.0`，正常不会出这个问题。如果改过 `HOST`，记得改回来。

### 改完怎么验证

```bash
docker compose up -d
docker compose ps                 # 应为 0.0.0.0:8089->8080/tcp
curl -s http://<内网IP>:8089/api/health
# {"ok":true,"time":...}
```

---

## 二、`TRUST_PROXY` 配错等于没限流

这个不会让页面报错，只会让安全措施悄悄失效，所以单独说。

`TRUST_PROXY` 管的是「信不信请求头里的 `X-Forwarded-For`」。

| 访问方式 | `DEMO_BIND` | `TRUST_PROXY` |
|---|---|---|
| nginx 反代（推荐，配 HTTPS） | `127.0.0.1` | `1` |
| 直接开端口（内网试用、临时演示） | `0.0.0.0` | `0` |

**直连时填 `1` 会出事**：这时候没有任何可信中间人帮你填这个头，客户端自己就能写。谁都可以发一个 `X-Forwarded-For: 1.2.3.4` 过来，服务端当真了，登录限流（8 次用户名|IP、30 次单 IP）就按伪造的 IP 分桶，等于每换一个假 IP 就重置一次机会，暴力猜密码可以无限试。

自己验证一下当前配置对不对：

```bash
curl -s -H "X-Forwarded-For: 1.2.3.4" http://<地址>:8089/api/health
# 然后去看审计日志里的 IP
```

- 日志里出现 `1.2.3.4` → 头被信任了。直连场景下这是**漏洞**，把 `TRUST_PROXY` 改成 `0`。
- 日志里是真实连接 IP → 正常。

反过来的坑也有：挂在 nginx 后面却填 `0`，那所有访客在日志和限流里都会显示成 `127.0.0.1`，一人触发限流全体被拦。

一句话记：**前面真有 nginx 才填 1，没有就填 0**。

---

## 三、容器起不来，或者起来就退出

```bash
docker compose logs --tail=50 liti-demo
```

**只看第一次启动的日志。** 如果 `restart: unless-stopped` 开着，容器会反复重启，日志被刷成一片，真正的原因只在最开始那几行。急的话先停掉自动重启：

```bash
docker compose run --rm --no-deps liti-demo
```

常见原因：

| 报错 | 原因 |
|---|---|
| `SESSION_SECRET` 相关 | `.env` 没填，或长度不够 16 |
| `Dockerfile not found` | 只传了 `deploy/demo/`，没带仓库根（compose 的 build context 是 `../..`） |
| 端口已占用 | 见第六节 |

---

## 四、打开是 502 或者白屏

首次启动要灌演示数据，大概 20 秒。这段窗口里请求进来就是 502 或者空白页。

```bash
docker compose logs -f liti-demo
# 等到出现 listening 就可以访问了
```

超过一分钟还这样，就不是等待问题了，看容器日志有没有报错。

### 挂子目录时白屏，但接口明明是通的

这个特别容易误判，因为 `curl` 看起来一切正常：

```bash
curl -I https://example.com/liti/            # 200 OK，返回的 HTML 也对
curl -s https://example.com/liti/api/health  # {"ok":true,...}
```

浏览器打开却是一片空白。按 F12 看 Network，会看到 `index-xxx.js` 是 **404**。

原因是 `index.html` 里资源地址写的是站根：

```html
<script src="/assets/index-xxx.js"></script>     <!-- 浏览器去 example.com/assets/ 找，那是主站 -->
<script src="/liti/assets/index-xxx.js"></script> <!-- 子路径部署该长这样 -->
```

三种成因，按顺序查：

**1. 容器没重新构建。** `BASE_PATH` 是构建时固化进 HTML 的，只改 `.env` 再 `up -d` 没用：

```bash
docker compose exec liti-demo env | grep BASE_PATH       # 运行时值
docker compose exec liti-demo grep -o 'src="[^"]*"' /app/web/dist/index.html  # 构建进去的值
```

第二条输出 `src="/liti/assets/..."` 才算对。还是 `/assets/...` 就是没重建：

```bash
docker compose up -d --build
```

**2. nginx 的 `proxy_pass` 末尾多了斜杠。** 写成 `proxy_pass http://127.0.0.1:8089/;` 时 nginx 会先剥掉 `/liti`，后端收到的路径里没有前缀，静态资源和接口全 404。正确的写法是不带斜杠：

```nginx
location ^~ /liti/ { proxy_pass http://127.0.0.1:8089; }
```

**3. nginx 的 location 没加 `^~`。** 主站里若有 `location ~ \.js$` 这类正则，会抢在 `/liti/` 前面匹配，把资源请求截走。加上 `^~` 提升优先级：

```nginx
location ^~ /liti/ { ... }
```

判断方法很简单——直接在服务器上绕过 nginx 问后端要一次：

```bash
curl -s http://127.0.0.1:8089/liti/ | grep -o 'src="[^"]*"'
```

后端给的地址带 `/liti/`，而浏览器里拿到的不带，那问题在 nginx（第 2、3 条）；两边都不带，就是容器没重建（第 1 条）。

---

## 五、登录页没有「一键体验」按钮

说明 `DEMO_MODE` 没生效。确认一下：

```bash
docker compose exec liti-demo env | grep DEMO_MODE
# 应该是 DEMO_MODE=1
```

不是 `1` 的话，检查 compose 里那行是不是被注释掉了。`DEMO_MODE` 关着的时候，`/api/demo/*` 这组接口**根本不会注册**，访问直接 404，不是权限问题。

---

## 六、8089 端口被占用

```bash
ss -lntp | grep 8089        # 看是谁占着
```

改 `.env` 里的 `DEMO_PORT` 换一个，然后 `docker compose up -d`。挂了 nginx 的话，`proxy_pass` 里的端口也跟着改。

---

## 七、nginx 相关的三个坑

**`nginx -t` 报 `unknown directive "http2"`**

`http2 on;` 这行要求 nginx ≥ 1.25.1。老版本删掉这行，把 `listen 443 ssl;` 改成 `listen 443 ssl http2;`。

**`nginx -t` 报证书文件不存在**

`nginx.conf.example` 里的 443 段引用了 certbot 还没签出来的证书。正确顺序是：先只配 80 → `certbot certonly --webroot` 签证书 → 再换成完整配置。别一上来就用完整模板。

**502，nginx 日志里是 `connect() failed (111: Connection refused)`**

两种情况：

- 容器没起，`docker compose ps` 看一眼。
- nginx 本身跑在容器里，`proxy_pass http://127.0.0.1:8089` 里的 `127.0.0.1` 指的是 **nginx 容器自己**，不是宿主机。改成宿主机内网 IP，或者让 nginx 用 `host` 网络模式。

---

## 八、每小时被踢下线一次

设计如此，不是 bug。演示数据每小时整体还原，会话跟着失效。想改频率见 DEPLOY.md 第 9 节。

---

## 附：一页速查

排查外部访问不通，按顺序敲：

```bash
cd deploy/demo

# 1. 端口映射对不对
docker compose ps
docker compose config | grep -E "host_ip|published"

# 2. 宿主监听地址
ss -lntp | grep 8089

# 3. .env 实际内容
grep -E "DEMO_BIND|DEMO_PORT|TRUST_PROXY" .env

# 4. 防火墙
firewall-cmd --list-ports ; ufw status verbose

# 5. 修完之后重建（restart 不算）
docker compose up -d
docker compose ps
curl -s http://<内网IP>:8089/api/health
```

配置对照，别配错：

```ini
# 走 nginx 反代（推荐）
DEMO_BIND=127.0.0.1
TRUST_PROXY=1

# 直接开端口给内网用
DEMO_BIND=0.0.0.0
TRUST_PROXY=0
```
