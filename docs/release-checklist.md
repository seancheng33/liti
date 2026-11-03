# 发版检查清单

照着从上往下做，每一步都有可验证的结果。跳步的代价在最后两节写着。

## 0. 先确认该不该发

- [ ] 计划内的功能都进主干，没进的要明确推到下个版本
- [ ] 没有已知的 P0/P1 缺陷开着
- [ ] 数据库迁移都写完了，且**幂等**（跑第二遍不报错）
- [ ] 破坏性变更已经和用的人说过（改了「第几题」的指代、改了未出分时的字段值，都算）

## 1. 仓库状态

```bash
git status -sb          # 必须是干净的
git log --oneline -5
```

- [ ] 工作区没有未提交改动
- [ ] 本地领先远端的提交都是要发的

## 2. 版本号

```bash
grep -n '"version"' package.json server/package.json web/package.json electron/package.json
```

- [ ] 四个文件版本号一致
- [ ] 和这次要打的 tag 对得上

## 3. 类型与测试

```bash
pnpm --filter @liti/server build      # tsc，零错误
pnpm --filter @liti/web typecheck     # 零错误
pnpm test                             # 单元 + 集成，全绿
```

- [ ] 两处 `tsc` 都是零错误（有 `error TS` 就别往下走）
- [ ] 测试通过数对得上，**特别注意 "skipped" 数量**

> 这里有个坑：测试文件不参与 `tsc`（`tsconfig.json` 只 include `src`）。如果集成测试整组 skipped，多半是 `testConfig()` 少了新字段、`beforeAll` 抛错。看到 skipped 突然变多，先查这个。

## 4. 双库验收

起两套实例（SQLite 和 MySQL），各跑一遍。

```bash
# 接口：v2 起各版本
for v in 3 4 5 6 7 8 9 10 11 12 13 14; do
  printf "v%s | " "$v"
  LITI_BASE=http://<host>:8080 node liti-features-v$v.mjs 2>&1 | grep 通过 | tail -1
done

# 界面：无头 Edge 截图
LITI_BASE=http://<host>:8080 node liti-shot-v14.mjs
```

- [ ] SQLite 实例全绿
- [ ] MySQL 实例全绿
- [ ] v2 的 xlsx 用例要在容器内跑（依赖 `exceljs`）

> 连着跑两遍 v14 会挂 8 项 429，不是回归，是兑换端限流在正常工作。`docker restart` 清掉进程内的计数桶再跑。

## 5. 文档

- [ ] `CHANGELOG.md` 加了这一版
- [ ] `docs/acceptance.md` 的统计数字更新了
- [ ] README 的功能列表和路线图没落后
- [ ] 新增的端点写进 `docs/api.md`
- [ ] 新增的环境变量写进 `docs/deployment.md`

## 6. 打标签

```bash
git tag -a v1.0.0 -m "v1.0.0 — 本次发布要点"
git push github main && git push github v1.0.0
git push origin main && git push origin v1.0.0
```

- [ ] 两个远端都推了（GitHub 主库 + Gitea 镜像）
- [ ] tag 内容不是空的，写清这一版解决什么

> GitHub 直连偶尔超时，重试即可。Gitea 报认证失败先清缓存凭据：
> `printf "protocol=http\nhost=192.168.1.88\n" | git credential reject`

## 7. 构建与部署

```bash
git archive --format=tar.gz -o /tmp/liti-vX.Y.Z.tgz HEAD
scp /tmp/liti-vX.Y.Z.tgz root@<host>:/root/
ssh root@<host> 'mkdir -p /root/liti-src && tar -xzf /root/liti-vX.Y.Z.tgz -C /root/liti-src && cd /root/liti-src && docker build -t liti:X.Y.Z .'
```

- [ ] `BUILD_EXIT=0`
- [ ] 构建日志里 `grep -c 'error TS'` 是 0

换容器（保留数据卷）：

```bash
docker tag liti:X.Y.Z liti:latest
docker rm -f liti
docker run -d --name liti --restart unless-stopped -p 8080:8080 -v liti-data:/app/data liti:X.Y.Z
```

- [ ] 日志能看到迁移执行成功（或已是最新）
- [ ] `/api/health` 返回 200

## 8. 发布后冒烟

- [ ] 三个角色各登录一次
- [ ] 首页能打开，统计数字正常
- [ ] 新建一道题、组一张卷、开考、答题、交卷、看成绩，走通一条
- [ ] 用**新镜像**再跑一遍关键版本的验收脚本（别只看构建通过）

## 9. 回滚

镜像保留上一个版本，出问题五分钟能退回去。

```bash
docker rm -f liti
docker run -d --name liti --restart unless-stopped -p 8080:8080 -v liti-data:/app/data liti:<上一版>
```

- [ ] 上一版镜像还在本机（`docker images liti`）
- [ ] 这次如果动了表结构，**回滚前先备份**。新迁移建的表留着不影响旧版本，删了列就回不去了

## 10. 收尾

- [ ] 在 `docs/releases/` 放一份这次的发布说明
- [ ] 把这次踩的坑写进对应文档（验收到 acceptance、运维到 deployment、代码约定到 CONTRIBUTING）
- [ ] 更新项目备忘里的进度快照
