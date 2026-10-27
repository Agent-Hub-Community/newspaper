# 文档导航

这里放的是 `newspaper` 仓库的技术与维护文档。项目简介和本地运行方法见根目录 [`README.md`](../README.md)，提 issue 和 PR 的方式见 [`CONTRIBUTING.md`](../CONTRIBUTING.md)。

## 按你要做的事找文档

| 你想做什么 | 看哪篇 |
|---|---|
| 弄清静态站怎么构建、页面怎么切路由、按需加载怎么跑 | [架构说明](architecture.md) |
| 改页面样式、讨论抽屉、卡片或长图导出 | [界面规则](ui.md)、[测试说明](testing.md) |
| 改站内搜索、黑话别名扩展或 Worker 查询接口 | [搜索与词表](search.md)、[`feedback/README.md`](../feedback/README.md) |
| 看懂或校验 `data/` 底下各个 JSON 的字段 | [数据格式](data-format.md)、[读者内容规则](editorial.md) |
| 把审好的日报／周报入库并推上线（维护者） | [入库与发布](publishing.md)、[外部资讯导入](external-news.md) |
| 审资料库、招聘／活动机会、群聊黑话的每周增量 | [资料库审核](review/library.md)、[机会审核](review/opportunities.md)、[黑话审核](review/glossary.md) |

## 文档列表

| 文件 | 讲什么 |
|---|---|
| [`architecture.md`](architecture.md) | 构建流程、`data.js` 索引与每期按需加载、静态深链目录、群定义、给 Agent 读的导出文件、SEO 开关、反馈 Worker |
| [`data-format.md`](data-format.md) | `data/` 下日报、讨论节选、外部资讯、周报、活跃榜快照、资料库、机会、黑话、同义词和语义向量的 JSON 结构 |
| [`editorial.md`](editorial.md) | 网站端对读者内容的要求：缺稿处理、重点下划线、AI 锐评、原始讨论节选、隐私与头像规则 |
| [`ui.md`](ui.md) | 刊头、单双列断点、讨论浮窗、链接卡片、活跃榜、保存长图、节日皮肤与明暗模式 |
| [`search.md`](search.md) | BM25 词面检索、黑话与同义词扩展规则、词表维护、Workers AI 语义检索 |
| [`publishing.md`](publishing.md) | 从 `scratch/` 批次目录到本地预览、正式入库、D1 登记、语义向量更新、GitHub Pages 部署与线上核对 |
| [`external-news.md`](external-news.md) | 外部资讯候选、稿件与审核记录的 schema、导入命令与页面展示映射 |
| [`testing.md`](testing.md) | 单元测试、`test/build.mjs` 产物检查、Playwright 浏览器测试与已知过时的旧断言 |
| [`review/library.md`](review/library.md) | 资料库候选链接的收录标准、去重合并与字段写法 |
| [`review/opportunities.md`](review/opportunities.md) | 招聘、活动与征稿候选的收录标准与隐私要求 |
| [`review/glossary.md`](review/glossary.md) | 群聊缩写、代号、梗与行话词条的提炼和合并规则 |

散在其他目录里的说明：

- [`feedback/README.md`](../feedback/README.md)：Cloudflare Worker 与 D1 数据库的接口、统计口径和部署步骤
- [`site/skins/README.md`](../site/skins/README.md)：中秋、国庆等节日像素皮肤的插件格式与排期配置
- [`CONTENT-NOTICE.md`](../CONTENT-NOTICE.md)：读者内容的版权说明与个人内容撤下方式

群聊采集、图片解码、调模型写稿和审稿定稿都在旁边的 [bot-workflow](https://github.com/Agent-Hub-Community/bot-workflow) 仓库里，本仓库从审完的批次目录开始接手。
