# AgentHub 日报

[![Publish](https://github.com/Agent-Hub-Community/newspaper/actions/workflows/deploy.yml/badge.svg)](https://github.com/Agent-Hub-Community/newspaper/actions/workflows/deploy.yml)

AgentHub 日报把 Agent Hub 社群各群每天的讨论整理成一份日报，并附当天的 AI 行业资讯。Agent Hub 是讨论 LLM Agent 研究与工程的中文社群。

- 网站：<https://agent-hub-community.github.io/newspaper/>
- 社群主页：<https://agent-hub-community.github.io/>

In English: AgentHub Daily is the newspaper of Agent Hub, a Chinese-language community of researchers and engineers who work on LLM agents.
Every day it publishes an edited digest of each group chat, together with a page of outside AI news; every week it publishes a weekly review.
Discussion excerpts are anonymous, and raw chat logs never enter this repository.
This repository holds the static website, the reviewed reader data, the publishing scripts, and a Cloudflare Worker for votes and a public query API.
The site and its content are in Chinese.

## 网站有什么

| 栏目 | 内容 | 入口 |
|---|---|---|
| 日报 | 每个群一版群聊选编，另有一版当天的外部资讯。每条有标题、带重点的正文、AI 锐评和资料链接，部分话题附匿名的原始讨论节选 | 首页打开最新一期；单版地址形如 [`daily/2026-10-22/group-1/`](https://agent-hub-community.github.io/newspaper/daily/2026-10-22/group-1/) |
| 周报 | 按北京时间自然周汇总各群讨论和外部资讯，同一主题跨天合并 | [`weekly/`](https://agent-hub-community.github.io/newspaper/weekly/) |
| 资料库 | 群里分享过、有长期参考价值的论文、代码、数据集、评测、模型和工具，可按主题、类型、关键词筛选。页面底部的“机会”区收录招聘、活动和征稿 | [`library/`](https://agent-hub-community.github.io/newspaper/library/) |
| 群聊黑话 | 群里常用的缩写、代号、梗和行话 | [`glossary/`](https://agent-hub-community.github.io/newspaper/glossary/) |
| 活跃榜 | 各群日榜和社区周榜、月榜、总榜，只显示前三名的名次和头像 | [`rank/week/`](https://agent-hub-community.github.io/newspaper/rank/week/) |
| 全站搜索 | 在浏览器里搜索日报、周报、外部资讯的动向观察、资料库和机会，查询不上传 | [`search/`](https://agent-hub-community.github.io/newspaper/search/) |
| 给 agent 用 | 站点说明 `llms.txt`、每期的 Markdown、全站 skill、订阅源和公开查询接口 | [`llms.txt`](https://agent-hub-community.github.io/newspaper/llms.txt)、[`agents/SKILL.md`](https://agent-hub-community.github.io/newspaper/agents/SKILL.md)、[`feed.xml`](https://agent-hub-community.github.io/newspaper/feed.xml) |

表中的入口地址都在 `https://agent-hub-community.github.io/newspaper/` 下。查询接口的用法写在 `llms.txt` 和 `agents/SKILL.md` 里，参数说明见 [feedback/README.md](feedback/README.md)。

## 一期日报怎样产生

采集、读图、写稿和审稿在流程仓库 [bot-workflow](https://github.com/Agent-Hub-Community/bot-workflow)（即将开放）完成。本仓库负责网站、读者数据和发布。

```text
bot-workflow（流程仓库，即将开放）
  采集       各群按北京时间整日读取消息，发言者换成化名
    ↓
  读图       看图模型为群聊图片写客观描述
    ↓
  写稿       模型按群写稿，再生成 AI 锐评、报头和重点
    ↓
  编辑审核   对照原始消息逐条改错、审核重点、附讨论节选
    ↓
  外部资讯   采集候选，回读原文，成稿后审核
    ↓
  活跃榜     计算前三名，逐张审核头像
    ↓  审核后的批次目录
newspaper（本仓库）
  预览       本地构建，在手机和桌面宽度下逐版检查
    ↓
  发布       入库到 data/，推送 main，GitHub Actions 部署到 GitHub Pages
```

图：一期日报从采集到上线的步骤。只有审核后的读者字段进入本仓库。

入库和发布的细节见 [入库与发布](docs/publishing.md)，读者内容要满足的规则见 [读者内容规则](docs/editorial.md)。

## 快速开始

需要 Node.js 22 和 npm。

```sh
git clone https://github.com/Agent-Hub-Community/newspaper.git
cd newspaper
npm ci
npm run build
```

构建结果在 `dist/`。线上网站位于 `/newspaper/` 路径下，本地预览也放在同一路径下：

```sh
mkdir -p output/preview
ln -sfn ../../dist output/preview/newspaper
python3 -m http.server 8000 --bind 127.0.0.1 --directory output/preview
```

然后在浏览器打开 <http://127.0.0.1:8000/newspaper/>。`output/` 已被 Git 忽略。

- 普通构建不含活跃榜。要在本地看活跃榜，改用 `npm run build -- --public`。
- 本地预览不上报任何统计。赞踩只保存在本机，计数显示“—”。

运行测试：

```sh
npm test                 # 单元测试，CI 也运行
npm run test:browser     # 浏览器测试，需要本机 Chrome；改界面时运行
```

浏览器测试的说明和已知失效的旧断言见 [测试](docs/testing.md)。

## 仓库结构

| 路径 | 内容 |
|---|---|
| `site/` | 浏览器端文件：`index.html`、`404.html`、前端脚本、样式和节日皮肤，构建时原样复制到 `dist/` |
| `lib/` | Node 模块：读取和校验数据、渲染静态页面和给 agent 用的文件。站点地址在 `lib/site.mjs` |
| `data/` | 审核后公开的读者数据：日报、周报、外部资讯、资料库、机会、黑话、榜单快照和头像 |
| `build.mjs` | 构建入口：读 `data/`，生成 `dist/` |
| `scripts/` | 命令行脚本：入库、预览、登记赞踩目录、统计报告等 |
| `prompts/` | 写稿用的模型 prompt，写稿流程见 bot-workflow |
| `feedback/` | Cloudflare Worker：赞踩、统计和公开查询接口 |
| `test/` | 单元测试和浏览器测试 |
| `bench/` | 查询接口的小型基准 |
| `docs/` | 技术文档，目录见 [docs/README.md](docs/README.md) |
| `.github/` | 部署 workflow：推送 `main` 后构建并发布到 GitHub Pages |

各部分怎样配合，见 [架构](docs/architecture.md)；数据文件的字段见 [数据格式](docs/data-format.md)。

## 数据与隐私

- 读者数据全部经过审核。正文不写群友的姓名、昵称和联系方式，用“群友”等代称。
- 原始讨论节选只有匿名编号、时间和原话。编号只在一个话题内对应同一位发言者，不跨话题关联身份。节选保留原话，所以发言者匿名不等于内容已经脱敏。
- 原始聊天记录、群 ID、成员身份映射、完整统计和模型原稿都不在本仓库。构建只读取 `data/` 下的读者字段。
- 活跃榜只公开前三名的名次和头像，不公开分数和计分规则。头像能认出本人，所以逐张审核后才发布。
- 给 agent 用的文件和查询接口不含原始讨论原话、头像和榜单。
- 站点有第一方浏览量统计，只在正式站点上报。它和赞踩、搜索等统计存什么、不存什么，见 [feedback/README.md](feedback/README.md)。

详细规则见 [读者内容规则](docs/editorial.md)。读者内容的使用条件和删除个人内容的方式见 [CONTENT-NOTICE.md](CONTENT-NOTICE.md)。

## 贡献与许可

欢迎提 issue 和 pull request。提交前请读 [CONTRIBUTING.md](CONTRIBUTING.md)：

- 页面错误、内容错误和删除个人内容的请求，请提 issue。issue 是公开的，只写页面地址和位置。
- 界面、搜索、查询接口、测试和文档的改进，可以直接提 pull request。
- 读者内容由维护者按审核流程更新。改动 `data/`、搜索引擎收录策略等需要维护者授权。

源代码使用 [MIT 许可](LICENSE)。读者内容（`data/` 下的刊期、资料库、黑话、榜单和头像等，以及由它们生成的网页和文件）不随 MIT 许可授权，使用条件见 [CONTENT-NOTICE.md](CONTENT-NOTICE.md)。
