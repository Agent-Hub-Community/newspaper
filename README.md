# AgentHub 日报

[![Publish](https://github.com/Agent-Hub-Community/newspaper/actions/workflows/deploy.yml/badge.svg)](https://github.com/Agent-Hub-Community/newspaper/actions/workflows/deploy.yml)

Agent Hub 是聊 LLM Agent 研究与工程的中文社群。这个仓库把各群每天的讨论整理成日报、每周整理成周报，顺带附上当天的 AI 行业资讯、社区资料库和群聊黑话词典。

- 线上阅读：<https://agent-hub-community.github.io/newspaper/>
- 社群主页：<https://agent-hub-community.github.io/>

In English: AgentHub Daily is the community newspaper of Agent Hub, a Chinese-language group of researchers and engineers working on LLM agents. It publishes daily group digests, outside AI news, weekly reviews, a curated resource library, and a glossary of community slang. Raw chat logs never enter this repository; this repo holds the static site, reviewed reader data, build scripts, and a Cloudflare Worker for votes and public search APIs.

## 站里有什么

| 栏目 | 内容 | 入口 |
|---|---|---|
| 日报 | 每个群一版当日讨论选编（一群到五群，以及当日有实质讨论的 AI Safety、Robot、AI4S 专项群），外加一版外部资讯与一页全版总览 `overview`。每条带重点下划线、AI 锐评、相关资料卡片和匿名原始讨论节选 | 首页默认打开最新一期；总览如 [`daily/2026-10-25/overview/`](https://agent-hub-community.github.io/newspaper/daily/2026-10-25/overview/)，单版如 [`daily/2026-10-25/group-2/`](https://agent-hub-community.github.io/newspaper/daily/2026-10-25/group-2/) |
| 周报 | 按北京时间自然周回顾综合群（一群到五群）、垂类专项群（AI Safety、Robot、AI4S）与行业动向，配全刊总览 `overview` 与各群独立周榜 | [`weekly/`](https://agent-hub-community.github.io/newspaper/weekly/)、[`weekly/2026-10-19/2026-10-25/overview/`](https://agent-hub-community.github.io/newspaper/weekly/2026-10-19/2026-10-25/overview/) |
| 资料库 | 群里分享过、过了几个月还有参考价值的论文、代码、评测基准、数据集、模型与工具；页底的“机会”区收招聘、活动和征稿 | [`library/`](https://agent-hub-community.github.io/newspaper/library/) |
| 群聊黑话 | 群里常冒出来的缩写、模型外号、梗和行话对照表 | [`glossary/`](https://agent-hub-community.github.io/newspaper/glossary/) |
| 活跃榜 | 各群日榜与全社区周榜、月榜、总榜，只展示前三名名次和头像 | [`rank/week/`](https://agent-hub-community.github.io/newspaper/rank/week/) |
| 全站搜索 | 在浏览器本地搜日报、周报、资料库和机会（查询词不上传服务器） | [`search/`](https://agent-hub-community.github.io/newspaper/search/) |
| 给 Agent 读 | `llms.txt`、每期 Markdown、全站 Skill（[`Agent-Hub-Community/skills`](https://github.com/Agent-Hub-Community/skills)）、Atom / JSON 订阅源与公开检索 API | [`llms.txt`](https://agent-hub-community.github.io/newspaper/llms.txt)、[`agents/SKILL.md`](https://agent-hub-community.github.io/newspaper/agents/SKILL.md)、[`feed.xml`](https://agent-hub-community.github.io/newspaper/feed.xml) |

公开检索 API 的参数和返回格式写在 `llms.txt`、`agents/SKILL.md` 和 [`feedback/README.md`](feedback/README.md) 里。

## 一期日报是怎么做出来的

前面的微信消息导出、图片解码、调模型写初稿和主编审稿，都在旁边的流程仓库 [bot-workflow](https://github.com/Agent-Hub-Community/bot-workflow) 里跑；审完定稿后，才交给本仓库构建网页并发布。

```text
bot-workflow（采集与写稿仓库）
  采集       按北京时间整日导出各群消息，发言人换成化名
    ↓
  读图       解出群聊图片，调视觉模型写客观描述
    ↓
  写稿       模型按群写初稿，再补 AI 锐评、报头和重点下划线
    ↓
  审稿定稿   对照原话改错、审隐私、挂资料卡与讨论节选，校验写出终稿
    ↓
  外部资讯   抓取热榜与博客候选，点开原文核实后成稿
    ↓
  活跃榜     算各群与社区前三名，逐张肉眼审新头像
    ↓
newspaper（本仓库）
  本地预览   合成静态预览站，在手机和桌面宽度下检查排版
    ↓
  入库发布   写入 data/，更新语义向量与 D1 目录，推送 main 部署到 GitHub Pages
```

具体的入库与部署步骤见[入库与发布](docs/publishing.md)，内容与审稿要求见[读者内容规则](docs/editorial.md)。

## 在本地跑起来

需要 Node.js 22 以上和 npm。

```sh
git clone https://github.com/Agent-Hub-Community/newspaper.git
cd newspaper
npm ci
npm run build
```

构建产物在 `dist/`。因为线上站点挂在 `/newspaper/` 路径下，本地起服务时也垫一层同名目录：

```sh
mkdir -p output/preview
ln -sfn ../../dist output/preview/newspaper
python3 -m http.server 8000 --bind 127.0.0.1 --directory output/preview
```

浏览器打开 <http://127.0.0.1:8000/newspaper/> 即可（`output/` 已被 Git 忽略）。

- 默认 `npm run build` 不带活跃榜；想在本地看活跃榜，跑 `npm run build -- --public`。
- 本地构建不会往线上发任何浏览统计，点赞点踩也只记在浏览器本地。

跑测试：

```sh
npm test                 # 单元测试（不联网、不用浏览器）
npm run test:browser     # 浏览器测试（需要本机装有 Chrome）
```

## 目录一览

| 路径 | 放什么 |
|---|---|
| `site/` | 浏览器端静态文件：`index.html`、`404.html`、前端 JS/CSS 和节日皮肤 |
| `lib/` | Node 模块：读数据、跑校验、生成静态页与 Agent 导出文件（站点地址定义在 `lib/site.mjs`） |
| `data/` | 已审完公开的读者数据：日报、周报、外部资讯、资料库、机会、黑话、榜单快照和头像 |
| `build.mjs` | 静态站构建入口（读 `data/` 和 `site/`，写出 `dist/`） |
| `scripts/` | 维护脚本：批次预览、正式入库、D1 目录登记、语义向量更新、统计报表 |
| `feedback/` | Cloudflare Worker + D1：点赞点踩、浏览与搜索统计、公开检索 API |
| `test/` | 单元测试与 Playwright 浏览器测试 |
| `bench/` | 检索接口的小型评测基准 |
| `docs/` | 技术与维护文档，总目录见 [`docs/README.md`](docs/README.md) |

## 隐私与内容边界

- 正文里不写群友真名、微信昵称、微信号、学校或所在公司，统一用“群友”“分享者”代称。
- 原始讨论节选只带当条话题内部的匿名编号（“群友 1”“群友 2”）、时间和原话，不同话题之间不打通身份，原始消息正文保持原样不改写。
- 原始聊天记录、群号、成员映射表和模型初稿都不进本仓库。
- 活跃榜只公布前三名名次和审核过的头像，不公布发言条数和计分细则。
- 给 Agent 读的 Markdown / JSON 和检索接口不带原始讨论原话、头像和榜单。

如果某页有你的发言或头像、想撤下来，直接按 [`CONTENT-NOTICE.md`](CONTENT-NOTICE.md) 的说明提 issue 即可。

## 参与贡献与许可证

修界面、改搜索、补测试或改文档，欢迎直接提 pull request；报页面 bug、内容勘误或申请撤下个人内容，请提 issue。动手前请先看一眼 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

仓库里的源代码采用 [MIT 许可证](LICENSE)。`data/` 下的读者内容（日报、周报、外部资讯、资料库、黑话、榜单与头像）及由它们生成的页面不随 MIT 授权，引用与使用规则见 [`CONTENT-NOTICE.md`](CONTENT-NOTICE.md)。
