# AgentHub 机会审核规范

审核 agent 和编辑按这份规范处理候选（`scratch/opportunities/candidates.json`）。候选由 [bot-workflow](https://github.com/Agent-Hub-Community/bot-workflow) 从群聊收集，含聊天原文，只放在被 Git 忽略的 `scratch/` 下。
字段和取值以 [`lib/opportunities.mjs`](../../lib/opportunities.mjs) 为准；审核之后的入库步骤见 [入库与发布](../publishing.md#资料库机会和黑话)。

## 收什么

招聘、活动、征稿都收；群里发过的招聘都收，不要求先经管理员同意。

| `kind` | 收录 | 例子 |
|---|---|---|
| `hiring` | 有具体机构和岗位的招聘：全职、实习、博后、RA 或访问、博士招生 | 商汤基座 code 方向实习、Qwen 日常实习和秋招 |
| `event` | 有日期的讲座、圆桌、分享会、见面会、开放日、黑客松、比赛、社区周会 | 融科校企 OpenDay、ClawHunt 黑客松、Terminal-Bench-Science 见面会 |
| `cfp` | 会议、workshop、期刊专刊的征稿或征集 | AAAI 2027 workshop 征稿 |

不收，在 `excluded` 里写原因：

| 代码 | 含义 |
|---|---|
| `promo` | 送额度、领券、羊毛、付费服务、产品推广（这些不是机会） |
| `question` | 求职、问有没有岗位、帮人打听 |
| `idea` | 只是设想或玩笑，没有具体时间、机构或岗位（“以后可以办个 workshop”） |
| `work` | 群友宣传自己的论文或项目，顺带提到招人或 star（归资料库，不归机会） |
| `duplicate` | 与另一条候选是同一个机会（合并进那一条的 `keys`） |
| `unclear` | 看不出机构、岗位或日期 |

## 隐私

- 不写任何个人联系方式：邮箱、手机号、微信号、二维码、“加我微信”“私聊我”。构建会拒绝含这些内容的条目。
- 不写发帖人的昵称、真名，也不写“群友 X 在招”。只写机构和岗位。
- 有官方链接（招聘页、公众号原文、报名页、征稿页）就放进 `links`；没有链接的招聘，页面会写“联系方式见 X 群 Y 日的原消息”，读者回群里找。
- 简介只写机构、岗位或活动本身的公开信息，不写聊天里的评价和玩笑。

## 字段

| 字段 | 要求 |
|---|---|
| `keys` | 这一条用到的候选 `key`，同一机会在多个群转发时都放进来 |
| `id` | 可选，页面锚点，发布后不再改：小写英文、数字和连字符，写成“机构-内容”（`sensetime-code-intern`）。不写时按机构和标题里的英文词生成 |
| `kind` | `hiring`、`event` 或 `cfp` |
| `title` | 不超过 80 字：招聘写“岗位名”（“基座模型 Code 方向实习”），活动写活动名，征稿写会议或 workshop 名 |
| `org` | 不超过 40 字：公司、实验室、学校或主办方 |
| `summary` | 中文，1 到 2 句，不超过 80 个汉字：方向、要求或形式里读者最需要的信息 |
| `roles` | 只用于 `hiring`，从 `full-time`、`intern`、`postdoc`、`ra`、`phd` 里选一个或多个 |
| `location` | 可选，城市或“线上”，不超过 30 字 |
| `deadline` | 可选，原文写明的截止日期 `YYYY-MM-DD` |
| `event_date` | 可选，活动举办日（多天活动写最后一天） |
| `topics` | 0 到 6 个方向词，例如 `Code Agent`、`AI4S`、`RL` |
| `links` | `{ "key": 候选 key, "kind": "article" }` 或 `{ "url": 验证过的 https 地址, "kind": "docs" }`，`kind` 取 `lib/library.mjs` 的 `LINK_KINDS` |

日期只写原文写明的。原文只写“10/15-16”这类日期时，按分享当年补全年份；不确定时不写，页面会按最后一次分享后 60 天算有效期。

## 输出

写到 `scratch/opportunities/reviewed.json`：

```json
{
  "items": [
    {
      "keys": ["text:商汤基座模型code方向实习生招聘本岗位聚焦商汤基座大模型面向真实软件"],
      "kind": "hiring", "title": "基座模型 Code 方向实习", "org": "商汤",
      "summary": "面向真实软件工程场景研究 Code Agent 与 Coding LLM，提升代码理解和工具使用能力。",
      "roles": ["intern"], "topics": ["Code Agent", "Coding LLM"], "links": []
    }
  ],
  "excluded": [{ "key": "https://right.codes/", "reason": "promo", "note": "API 中转服务" }]
}
```

每个候选 `key` 恰好出现一次：在某条 item 的 `keys` 里，或在 `excluded` 里。然后运行 `node scripts/assemble-opportunities.mjs`。
