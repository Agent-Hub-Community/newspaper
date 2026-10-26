# 机会审核规范

每周随周报更新时，按这份规范处理 `scratch/opportunities/candidates.json` 里的招聘、活动与征稿候选。候选由 [bot-workflow](https://github.com/Agent-Hub-Community/bot-workflow) 从群聊收集，审核后的入库命令见[入库与发布](../publishing.md#资料库机会与黑话每周随周报更新)。

## 收什么、拒什么

群里发过的正式招聘、学术／社区活动和征稿都收：

| `kind` | 收录范围 | 例子 |
|---|---|---|
| `hiring` | 有明确机构和岗位的全职、实习、博后、RA / 访问学生、博士招生 | 商汤基座模型 Code 方向实习、Qwen 日常实习与秋招 |
| `event` | 有明确日期的讲座、圆桌、分享会、见面会、OpenDay、黑客松、比赛 | 融科校企 OpenDay、ClawHunt 黑客松、Terminal-Bench-Science 见面会 |
| `cfp` | 会议、Workshop、期刊专刊的征稿或任务征集 | AAAI 2027 Workshop 征稿 |

不收的放进 `excluded`：

| 代码 | 原因 |
|---|---|
| `promo` | 送算力额度、领券、拼团、付费课或商业推广 |
| `question` | 个人求职、问哪里有坑位、帮朋友打听 |
| `idea` | 随口提一句“以后可以办个活动”，没有时间、机构或报名方式 |
| `work` | 群友宣传自己的论文或开源项目，顺嘴提一句欢迎 star 或招人（归资料库，不归这里） |
| `duplicate` | 和另一条候选是同一件事（把它的 `key` 合并到那一条的 `keys` 里即可） |
| `unclear` | 看不出是哪家机构、招什么岗位或什么时候办 |

## 隐私红线

- 绝不写任何个人联系方式：个人邮箱、手机号、微信号、二维码、“加我微信”“私聊发简历”。构建校验器扫到这些字眼会直接报错拒绝。
- 不写发帖人的微信昵称或真名，也不写“群友 X 内推”，只写公开的机构名和岗位名。
- 如果原消息带了公开的官方招聘页、公众号推文、报名表或征稿主页，放进 `links`；如果只是群里发的一段纯文字内推、没有公开网页，`links` 留空数组 `[]`，网站会自动在卡片底部显示“联系方式见 X 群 Y 日的原消息”，让群友自己回群里翻。

## 字段要求

| 字段 | 写法 |
|---|---|
| `keys` | 这条机会对应的全部候选 `key`（同一条招聘在几个群转发时合成一条） |
| `id` | 可选，小写字母、数字和连字符（如 `sensetime-code-intern`），上线后固定不改 |
| `kind` | `hiring`、`event` 或 `cfp` |
| `title` | ≤80 字：招聘写岗位名（如“基座模型 Code 方向实习”），活动写活动名，征稿写会议／Workshop 名 |
| `org` | ≤40 字：公司、实验室、高校或主办方名称 |
| `summary` | 中文 1 到 2 句（≤80 个汉字）：写清研究／工程方向、核心要求或活动形式 |
| `roles` | 仅 `hiring` 填，从 `full-time`、`intern`、`postdoc`、`ra`、`phd` 里选 |
| `location` | 可选，城市名或“线上”（≤30 字） |
| `deadline`、`event_date` | 可选，原文写明的截止日或活动日（`YYYY-MM-DD`；不确定就不填，网站会按最后分享日加 60 天算有效期） |
| `topics` | 0 到 6 个简短方向词，如 `Code Agent`、`RL`、`AI4S` |
| `links` | `{ "key": "候选 key", "kind": "article" }` 或 `{ "url": "核实过的 https 地址", "kind": "docs" }` |

## 输出与组装

写到 `scratch/opportunities/reviewed.json`：

```json
{
  "items": [
    {
      "keys": ["text:商汤基座模型code方向实习生招聘本岗位聚焦商汤基座大模型面向真实软件"],
      "kind": "hiring",
      "title": "基座模型 Code 方向实习",
      "org": "商汤",
      "summary": "面向真实软件工程场景研究 Code Agent 与 Coding LLM，提升代码理解和工具使用能力。",
      "roles": ["intern"],
      "topics": ["Code Agent", "Coding LLM"],
      "links": []
    }
  ],
  "excluded": [{ "key": "https://right.codes/", "reason": "promo", "note": "API 中转推广" }]
}
```

每个候选 `key` 必须恰好出现一次（在 `items[].keys` 或 `excluded` 里），然后跑 `node scripts/assemble-opportunities.mjs` 合入 `data/opportunities.json`。
