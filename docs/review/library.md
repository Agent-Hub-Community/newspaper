# AgentHub 资料库审核规范

审核 agent 和编辑按这份规范处理候选链接（`scratch/library/candidates.json`）。候选由 [bot-workflow](https://github.com/Agent-Hub-Community/bot-workflow) 从群聊收集，含私有聊天上下文，只放在被 Git 忽略的 `scratch/` 下。
类型、主题和链接种类的取值以 [`lib/library.mjs`](../../lib/library.mjs) 为准，这里的表格是同一份定义的说明。审核之后怎样合进 `data/library.json`，见 [入库与发布](../publishing.md#资料库机会和黑话)。

## 背景

Agent Hub 是几个讨论 LLM Agent 研究与工程的微信群，成员是几百位研究者和开发者。
公开网站 https://agent-hub-community.github.io/newspaper/ 每天发布群聊日报。“资料库”栏目
把群里分享过、有长期参考价值的论文、代码、数据集、评测、工具和文章按类别整理，方便人和 agent 查找。

批次文件（大批量回补时用）里，每个 `cluster` 是一组在同一条消息里一起出现的链接（通常是同一项工作的论文、代码、主页、数据集）。
每个候选链接带有：

- `key`：候选唯一标识，输出时应原样引用。
- `url`：规范化后的地址。
- `metadata`：脚本预取的页面信息（arXiv 标题摘要、GitHub 描述和星数、网页标题描述、X 帖子正文）。`status` 不是 200 或 `blocked: true` 表示没取到。
- `published`：这个链接已经出现在哪几天日报的哪条话题里。
- `shares`：群里分享它的消息原文（`message`）、微信链接卡片（`card`）和前后几条消息（`context`）。这些是私有聊天记录，只用来理解资料，不能写进输出的标题和简介。

## 收录标准

收录对 Agent 研究者或开发者有长期参考价值的资料：

- 论文、技术报告、综述。
- 开源代码、框架、库、skill、CLI。
- 数据集、训练环境、benchmark、榜单。
- 模型权重和官方发布页、system card。
- 可直接使用的产品、工具、服务。
- 有技术含量的文章、博客、解读、访谈、视频、帖子。

不收录，并在 `excluded` 里给出原因代码：

| 代码 | 含义 |
|---|---|
| `news` | 时效性新闻、八卦、人事变动、融资、公司传闻；只是转述官方发布、没有额外信息的媒体稿 |
| `promo` | 优惠、营销、产品推广；招聘、活动报名、见面会和征稿也在这里排除，它们另按 [机会审核规范](opportunities.md) 收进“机会” |
| `personal` | 个人主页、自我介绍、简历、个人社交账号首页 |
| `ephemeral` | 一次性玩具演示页、状态页、临时页面、无上下文的截图链接 |
| `broken` | 打不开，且从聊天卡片和上下文也无法确认它是什么 |
| `local` | 本地地址、内网地址、API endpoint |
| `offtopic` | 与 AI、Agent、研究或开发无关 |
| `lowvalue` | 信息量很低：梗、吐槽、争吵、纯转发的一句话帖子 |
| `private` | 需要登录才能看的私有文档或群内文件 |

拿不准时，问自己：半年后一位 Agent 研究者搜到这一条，会不会觉得有用？会就收录。
官方模型发布页（openai.com、anthropic.com、blog.google 等）收录为 `model`；同一事件的媒体转述稿通常记 `news` 排除。
深度解读、访谈、有作者独立分析的文章可以收录。群友自己的工作（“宣传一下我们的工作”）是资料库的主体，正常收录。

## 隐私

- 输出里不写任何群友昵称、真名、微信号、单位（包括从昵称推断出的单位），不写“群友分享”“作者在群里说”。
- 简介只描述资料本身，信息来自资料页面；聊天内容只用来判断它是什么、值不值得收。
- 不写聊天里的评价、争论和八卦。

## 核实

- 每条收录的标题和简介都要以资料本身为准：优先用 `metadata`；`metadata` 缺失、失败或信息不足时，用 WebFetch 或 `curl -sL -m 20` 打开一次原链接（arXiv 可用 `https://export.arxiv.org/api/query?id_list=ID`，GitHub 可用 `gh api repos/OWNER/REPO`，X 帖子可用 `https://api.fxtwitter.com/status/ID`）。不要做网页搜索。
- 仍然打不开时：如果聊天里的链接卡片或消息原文清楚说明了它是什么（例如公众号卡片标题、作者发布说明），可以收录，`verified` 写 `chat-only`，简介只写卡片和原文能支持的内容；否则排除为 `broken`。
- 不编造数字、作者、机构、会议录用情况。数字只写来源页面写明的。
- 链接本身有误（例如末尾混进了中文括号编码 `%EF%BC%89`、截断）时，可以在该 link 里给出修正后的 `url`，但修正后的地址应实际打开验证过。

## 合并与拆分

- 一项工作一条 item：同一工作的论文、代码、主页、数据集、模型、帖子、公众号介绍合并到同一个 item 的 `keys` 和 `links` 里。
- 一个 cluster 里如果有几项不同的工作（例如一条消息介绍了三篇论文），拆成几条 item。
- 批次里每个候选 `key` 应恰好出现一次：要么在某条 item 的 `keys` 里，要么在 `excluded` 里。
- 同一工作的公众号介绍、X 宣传帖如果没有额外信息，可以放进 `keys` 但不放进 `links`（这样它不会单独显示）。

## 字段

### `title`

资料的正式名称，保持原文语言。论文用论文标题（有项目名时保留“项目名: 副标题”的原样）；
代码用项目名，必要时加一句短副标题；文章用文章原标题，去掉 emoji 和“刚刚”“突发”之类的修饰。不超过 100 字符。

### `summary`

中文，1 到 2 句，不超过 80 个汉字。说清它是什么、做什么、有什么可核对的关键信息（规模、覆盖范围、主要结果）。
用平实的动词和具体名词，不用“重磅”“首个”“颠覆”“大幅”之类的宣传词，除非原文就是名称的一部分。
不用“不是……而是……”句式，不写“本文”“该工作提出了”这类套话开头，直接写“用……做……”“提供……”“评测……”。
中英文之间加空格。专有名词和缩写保持原文（agent、RL、benchmark 等常见词可以直接用英文）。

### `type`（单选，资料的主体是什么）

| 值 | 说明 |
|---|---|
| `paper` | 研究论文、技术报告、综述（方法类研究；即使带代码，主体是研究就选它） |
| `benchmark` | 评测基准、榜单、评测平台（包括 benchmark 论文） |
| `dataset` | 数据集、训练环境、gym、轨迹数据（显示为“数据集”） |
| `code` | 开源框架、库、工具链、skill、awesome 列表（主体是软件或资源列表） |
| `model` | 模型权重、模型官方发布页、system card |
| `tool` | 可直接使用的在线产品、网站、服务、API（显示为“工具与产品”） |
| `article` | 博客、公众号文章、知乎、技术解读、访谈、X 帖子、论坛讨论帖（显示为“文章与帖子”） |
| `video` | 视频、课程、演讲录像 |

### `topics`（1 到 3 个，按相关度排序）

| 值 | 名称 | 覆盖 |
|---|---|---|
| `coding-agents` | 编程 Agent 与 Harness | Claude Code、Codex 等编程 agent，harness、scaffold、skills、MCP、工具调用、SWE 任务 |
| `computer-use` | Computer Use 与 GUI | 桌面、手机、浏览器、GUI agent，grounding，OS 环境 |
| `training` | 强化学习与训练 | agentic RL、post-training、训练框架、credit assignment、reward、数据配方 |
| `data-environments` | 数据与环境 | 数据合成、环境构建与规模化、sandbox、轨迹数据 |
| `evaluation` | 评测 | 各类 benchmark、榜单、评测方法、judge |
| `research-agents` | 科研 Agent 与自我改进 | deep research、AI scientist、AI 做数学和科学、递归自我改进（RSI）、自动化研究 |
| `memory` | 记忆与长程任务 | agent memory、上下文管理、长程任务 |
| `multi-agent` | 多智能体 | 多 agent 协作、agent 集群、群聊 agent |
| `safety` | 安全与对齐 | 安全、对齐、可监控性、提示注入、red teaming |
| `models` | 模型与技术报告 | 前沿和开源模型发布、模型技术报告、模型能力分析 |
| `multimodal-embodied` | 多模态、具身与世界模型 | VLM、统一多模态模型、机器人、具身、世界模型、空间智能 |
| `systems` | 系统与基础设施 | 推理、训练系统、GPU 与 kernel、MLSys、成本 |
| `research-tools` | 科研工具与写作 | 读论文、找论文、作图、写作、审稿、学术数据工具 |
| `industry` | 行业与观点 | 行业分析、趋势判断、访谈、长篇观点 |

没有完全合适的主题时选最接近的，并在 `notes` 里说明。

### `keywords`（3 到 12 个，按重要程度排序）

读者会用来找这条资料的具体词：模型或模型家族、benchmark、框架和工具、机构、方法和概念、应用领域。
写法和资料库已有的词表一致（见 `data/library-keywords.json` 和线上 `library/resources.json` 顶层的 `keywords`）；用了别名而不是规范词时，构建会报错并提示规范写法。英文专有名词保持官方大小写，
技术概念优先用社区常用的英文写法，中文领域名词用简短中文。不重复 `topics` 和 `type`，
不用 agent、LLM、AI 这类泛词，不写人名，不含 `|`。

### `links`

按对读者最有用的顺序排列，第一个是主链接（通常是论文或项目主页）。每个 link：

```json
{ "key": "候选 key", "kind": "paper|code|project|data|model|leaderboard|demo|docs|article|post|video" }
```

需要修正地址时加 `"url": "修正后并验证过的地址"`。

### `verified`

`source`（打开过资料本身或用了有效 metadata）或 `chat-only`（只能依据聊天卡片和原文）。

## 输出

写到 `scratch/library/curated/batch-N.json`（N 是你的批次号），格式：

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

写完后运行 `node scripts/check-library-review.mjs curated/batch-N.json`，修到输出 OK 为止。全部批次完成后不带参数再运行一次，确认每个待审候选都恰好处理了一次。
