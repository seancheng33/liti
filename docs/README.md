# docs 目录

这个目录按「项目怎么从想法走到能上线」的顺序排。文件名就是内容，没有编号，因为大部分文档是长期演进的，编号只会让人纠结插在第几章。

| 文件 | 内容 | 什么时候看 |
|---|---|---|
| [requirements.md](requirements.md) | 目标、范围、**有意不做什么**、已知限制、需求变更史 | 决定要不要用、或者想加功能之前 |
| [architecture.md](architecture.md) | 架构、数据模型、15 个核心机制的取舍、里程碑 | 动手改代码之前 |
| [api.md](api.md) | 65 个端点速查：权限、请求形状、错误码 | 对接接口时 |
| [security.md](security.md) | 安全设计约定（限流、隔离、遮罩、审计埋点） | 改鉴权、改权限、加接口时 |
| [acceptance.md](acceptance.md) | 74 条需求对照、各版本验收记录、复现命令 | 发版、回归、确认某个行为是不是 bug |
| [deployment.md](deployment.md) | 安装、配置、Docker、备份恢复、性能基线、常见报错 | 部署和运维 |
| [docker-build.md](docker-build.md) | 自己打镜像的两套流程（SQLite / MySQL） | 要改镜像或离线部署时 |
| [release-checklist.md](release-checklist.md) | 发版十步，含回滚 | 每次发版 |
| [user-guide.md](user-guide.md) | 老师怎么从录题走到出成绩、学生怎么答题、管理员管什么 | 培训、给新用户 |
| [releases/](releases/) | 每个版本的对外说明 | 升级前看改了什么 |

仓库根目录还有三份，不属于 docs 但同样常用：

- [README.md](../README.md) — 项目概览、快速开始、文档地图
- [CHANGELOG.md](../CHANGELOG.md) — 每个版本改了什么、为什么改
- [CONTRIBUTING.md](../CONTRIBUTING.md) — 环境搭建、代码约定、提交规范
- [SECURITY.md](../SECURITY.md) — 漏洞怎么报、哪些"漏洞"其实是设计

## 有意没做的几份

写文档也讲性价比。下面这些常见文档这个项目没做，说一下原因，免得被当成遗漏：

| 没做 | 原因 |
|---|---|
| 独立的需求规格书（SRS） | `requirements.md` + `acceptance.md` 的需求对照表已经覆盖，拆成两份会出现口径不一致 |
| 项目计划 / 甘特图 | 一个人开发，里程碑表在 `architecture.md` 第 10 节，够了 |
| 独立的测试计划 | 测试策略在 `architecture.md` 第 9 节，实际用例与结果在 `acceptance.md`，分三处反而难查 |
| 详细设计说明书（每个模块的类图时序图） | 代码本身就是最准的详细设计。`architecture.md` 只写「为什么这么设计」，不抄代码 |
| 术语表 | 领域词就那几个（卷、场次、答卷、P 值、D 值），第一次出现的地方都解释了 |
| ADR（架构决策记录） | 决策的**理由**直接写在对应机制的小节里，不单独建目录。找某个决策的理由时就在那个功能旁边，比翻 ADR 编号快 |
| 用户操作视频 | 有 `user-guide.md` 和站内 `/help`，视频维护成本高、改版就过期 |
