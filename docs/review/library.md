# 资料库审核规范

每周随周报更新资料库时，审核 agent 和编辑按这份规范处理 `scratch/library/candidates.json` 里的候选链接。候选由 [bot-workflow](https://github.com/Agent-Hub-Community/bot-workflow) 从群聊里捞出，带着前后几句聊天上下文，只放在被 Git 忽略的 `scratch/` 下。

类型、主题和链接种类的合法枚举值定义在 [`lib/library.mjs`](../../lib/library.mjs)，审完后的组装入库步骤见[入库与发布](../publishing.md#资料库机会与黑话每周随周报更新)。

## 候选文件里有什么

每个候选带有：

- `key`：唯一标识，写审核结果时原样引用。
- `url`：规范化后的网址。
- `metadata`：脚本预抓的页面信息（arXiv 标题与摘要、GitHub 描述与 star 数、网页 title/description、X 帖子正文）。如果 `status !== 200` 或 `blocked: true`，说明脚本没抓下来。
- `published`：这个链接之前已经出现在哪几天的日报里。
- `shares`：群里发这条链接时的原话（`message`）、微信链接卡片（`card`）和前后几条消息（`context`）。注意这些聊天记录只是帮你判断这个链接是什么，写输出的 `title` 和 `summary` 时不准把群聊原话、群友昵称或群内吐槽抄进去。

## 收什么、拒什么

只要半年后一位做 Agent 的研究者或工程师搜到它还觉得有用，就收：

- 论文、技术报告、综述；
- 开源代码、框架、库、skill、CLI；
- 数据集、训练环境、benchmark、榜单；
- 模型权重、官方模型发布页、system card；
- 能直接用的在线工具、产品、服务；
- 有干货的技术博客、深度解读、访谈、课程视频。

群友在群里发自己团队做的论文或开源项目（“宣传一下我们的工作”），是资料库最欢迎的内容，正常收录。

不收的放进 `excluded`，填好原因代码：

| 代码 | 什么情况归这一类 |
|---|---|
| `news` | 纯时效性新闻、融资、人事变动、八卦，或者只是转述官方公告、没有独立内容的媒体稿（官方自己的模型发布页按 `model` 收，媒体转述排除） |
| `promo` | 领券、打折、商业广告；招聘、活动报名和征稿也在这里记 `promo` 排除，它们归旁边的[机会审核](opportunities.md) |
| `personal` | 个人主页、简历、社交账号主页 |
| `ephemeral` | 一次性玩具页、状态监控页、临时链接、没上下文的单张截图 |
| `broken` | 链接打不开，而且看聊天卡片也不知道是什么 |
| `local` | `localhost`、内网地址、裸 API 端点 |
| `offtopic` | 跟 AI、Agent、科研或软件工程无关 |
| `lowvalue` | 一句话水帖、表情包、吵架、纯情绪吐槽 |
| `private` | 要登录权限才看得到的私有文档或群文件 |

## 核实与去重规则

- 写每条的标题和简介前，先看 `metadata`；如果 `metadata` 没抓到或信息太少，自己打开原链接看一眼（arXiv 可调 `export.arxiv.org/api/query`，GitHub 可调 `gh api repos/OWNER/REPO`，X 可调 `api.fxtwitter.com`）。如果实在打不开，但微信卡片和聊天上下文已经把项目讲得很清楚，可以收录并标 `verified: "chat-only"`；连卡片都没有就标 `broken` 排除。
- 一项工作合成一条 `item`：同一篇工作顺带发的论文、GitHub 仓库、项目主页、数据集、权重和解读文章，全都塞进同一个 `item` 的 `keys` 和 `links` 里。反过来，如果一条消息一口气推了三篇不相干的论文，就拆成三条 `item`。
- 批次里的每个候选 `key` 都必须交账：要么出现在某条 `item.keys` 里，要么出现在 `excluded` 里，不能漏掉或重复。

## 各字段怎么写

- `title`（≤100 字符）：资料的正式名称，保持原文语言。论文写论文原标题；代码写仓库或项目名；文章写文章原标题（删掉标题里的 emoji 和“重磅／突发”之类字眼）。
- `summary`（中文 1 到 2 句，≤80 个汉字）：平实讲清楚它是什么、解决什么问题、包含什么规模的数据或得出了什么可核对的结果。直接用动词开头（如“提供……”“评测……”“在……上对比……”），别写“本文提出了”“重磅推出”“颠覆性”等宣传套话，也别露任何群友信息。中英文之间留空格。
- `type`（单选）：`paper`、`benchmark`、`dataset`、`code`、`model`、`tool`、`article`、`video` 之一。
- `topics`（1 到 3 个，按相关度排）：从 `coding-agents`、`computer-use`、`training`、`data-environments`、`evaluation`、`research-agents`、`memory`、`multi-agent`、`safety`、`models`、`multimodal-embodied`、`systems`、`research-tools`、`industry` 里选。
- `keywords`（3 到 12 个）：读者搜这条资料会用的具体词（模型家族、benchmark 名、框架名、具体方法或领域）。写法要和 `data/library-keywords.json` 里的规范词对齐，不重复 `topics` 和 `type`，也不用 `AI`、`LLM`、`Agent` 这种太泛的词。
- `links`：把最核心的链接（如论文或主仓库）放第一个，每项写 `{ "key": "候选 key", "kind": "paper|code|project|data|model|leaderboard|demo|docs|article|post|video" }`。如果原链接尾巴多带了中文括号编码之类的乱码，验证好正确地址后额外加上 `"url": "修正后的地址"`。
- `verified`：填 `"source"` 或 `"chat-only"`。

## 输出格式与自检

写到 `scratch/library/curated/batch-N.json`：

```json
{
  "items": [
    {
      "keys": ["arxiv:2609.33356", "github:arcadia-1/analog-design-bench", "https://analog-design-bench.tokenzhang.com"],
      "title": "Long-Horizon Analog Design Bench: Benchmarking Agents on Hours-Long Analog and Mixed-Signal Circuit Design Tasks",
      "summary": "让 coding agent 用开源仿真器从零设计晶体管级模拟电路，含 50 道由芯片设计师挑选的真实任务和独立 verifier。",
      "type": "benchmark",
      "topics": ["evaluation", "coding-agents"],
      "keywords": ["芯片设计", "模拟电路", "ngspice", "verifier", "long-horizon"],
      "links": [
        { "key": "arxiv:2609.33356", "kind": "paper" },
        { "key": "github:arcadia-1/analog-design-bench", "kind": "code" },
        { "key": "https://analog-design-bench.tokenzhang.com", "kind": "leaderboard" }
      ],
      "verified": "source"
    }
  ],
  "excluded": [
    { "key": "https://mp.weixin.qq.com/s/5ACHn_ISnUPHZ1oMtF2dTg", "reason": "promo", "note": "节日领券" }
  ]
}
```

写完跑 `node scripts/check-library-review.mjs curated/batch-N.json` 修到全绿；所有批次合完后再不带参数跑一次 `node scripts/check-library-review.mjs`。
