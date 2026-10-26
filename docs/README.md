# 文档目录

本目录是 AgentHub 日报仓库的技术文档。项目介绍和快速开始见仓库首页的 [README](../README.md)，贡献方式见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 按读者找文档

| 你想做什么 | 先读 |
|---|---|
| 了解网站怎样构建、各页面怎样组织 | [架构](architecture.md) |
| 改界面 | [界面规则](ui.md)、[测试](testing.md) |
| 改搜索、词表或查询接口 | [搜索与词表](search.md)、[反馈 Worker](../feedback/README.md) |
| 读写 `data/` 下的文件 | [数据格式](data-format.md)、[读者内容规则](editorial.md) |
| 发布新刊期（维护者） | [入库与发布](publishing.md) |
| 审核资料库、机会、黑话的候选 | [资料库](review/library.md)、[机会](review/opportunities.md)、[黑话](review/glossary.md) |
| 导入外部资讯 | [外部资讯](external-news.md) |

## 全部文档

| 文档 | 内容 |
|---|---|
| [architecture.md](architecture.md) | 目录、构建模式、构建产物、`data.js` 索引与按需加载、深链目录和 404、页面关系、群列表、站点地址、给 agent 用的文件、搜索引擎收录、反馈 Worker |
| [data-format.md](data-format.md) | `data/` 下各文件的字段和约束：刊期、讨论节选、外部资讯、周报、榜单快照、资料库、机会、黑话、同义词、语义向量 |
| [editorial.md](editorial.md) | 读者内容规则：缺稿、重点、AI 锐评、原始讨论节选、隐私和头像 |
| [ui.md](ui.md) | 界面规则：刊头、版面、讨论面板、网址卡片、活跃榜、长图、皮肤和明暗 |
| [search.md](search.md) | 全站搜索的排序、词表来源和维护规则、语义检索 |
| [publishing.md](publishing.md) | 审核后的批次怎样预览、入库、登记、部署和核验 |
| [external-news.md](external-news.md) | 外部资讯稿件的格式、审核记录、导入和网页呈现 |
| [testing.md](testing.md) | 单元测试、构建产物检查、浏览器测试和已知失效的旧断言 |
| [review/library.md](review/library.md) | 资料库候选的审核规范 |
| [review/opportunities.md](review/opportunities.md) | 机会（招聘、活动、征稿）的审核规范 |
| [review/glossary.md](review/glossary.md) | 群聊黑话的审核规范 |

其他目录里的文档：

| 文档 | 内容 |
|---|---|
| [feedback/README.md](../feedback/README.md) | 反馈 Worker：部署、赞踩、统计、公开查询接口的参数和返回字段 |
| [site/skins/README.md](../site/skins/README.md) | 节日皮肤的插件约定和活动排期 |
| [bench/agent-api/README.md](../bench/agent-api/README.md) | 查询接口的小型基准 |
| [bench/edition-outline/README.md](../bench/edition-outline/README.md) | 单期目录阅读基准 |
| [CONTENT-NOTICE.md](../CONTENT-NOTICE.md) | 读者内容的使用条件和删除请求 |

## 不在本仓库的内容

群聊采集、读图、活跃榜计算、模型写稿和审稿方法在 [bot-workflow](https://github.com/Agent-Hub-Community/bot-workflow)。本仓库从“审核后的批次目录”开始接手，见 [入库与发布](publishing.md)。
