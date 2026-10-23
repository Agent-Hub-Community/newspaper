# 数据格式

`data/` 下是审核后公开的读者数据。构建只读取这里的文件；原始聊天、身份映射、完整统计和模型原稿都不在仓库里。
每种文件都有校验代码，构建和测试在字段不合规时报错。本文写的是当前的规则，字段和取值以表中的校验代码为准。

| 路径 | 内容 | 校验代码 |
|---|---|---|
| `data/editions/<date>.json` | 群聊日报，一天一个文件 | [`scripts/publish-reviewed-batch.mjs`](../scripts/publish-reviewed-batch.mjs)、[`lib/draft-editions.mjs`](../lib/draft-editions.mjs)、[`lib/story-discussion.mjs`](../lib/story-discussion.mjs) |
| `data/external-editions/<date>.json` | 外部资讯，一天一个文件 | [`lib/external-editions.mjs`](../lib/external-editions.mjs) |
| `data/weekly-editions/<起始>_<结束>.json` | 周报 | [`lib/weekly-editions.mjs`](../lib/weekly-editions.mjs) |
| `data/weekly-assets/<周报 id>/avatars/` | 周榜头像 | 同上 |
| `data/public-activity/snapshot.json`、`avatars/` | 活跃榜快照和头像 | [`lib/public-activity.mjs`](../lib/public-activity.mjs) |
| `data/library.json`、`data/library-avatars/` | 资料库和分享人头像 | [`lib/library.mjs`](../lib/library.mjs) |
| `data/library-keywords.json` | 资料库关键词的别名 | 同上 |
| `data/opportunities.json` | 招聘、活动和征稿 | [`lib/opportunities.mjs`](../lib/opportunities.mjs) |
| `data/glossary.json` | 群聊黑话 | [`lib/glossary.mjs`](../lib/glossary.mjs) |
| `data/search-synonyms.json` | 普通同义词组 | [`lib/synonyms.mjs`](../lib/synonyms.mjs) |
| `data/semantic-vectors.json` | 查询接口用的文档向量 | [`lib/semantic.mjs`](../lib/semantic.mjs) |

通用约定：

- 日期是北京时间的 `YYYY-MM-DD`，应是真实的日历日。
- 链接只用 `https:`，不带账号密码。日报资料链接不带查询参数。
- 群 id 是 `group-N`，与 [`lib/groups.mjs`](../lib/groups.mjs) 一致。外部资讯版的 id 是 `external`。
- 文本字段是纯文本。网页不解析其中的 HTML 或 Markdown。

## 日报刊期

`data/editions/<date>.json` 保存一天的各群版面。外部资讯在构建时从 `data/external-editions/` 合并进来，不写在这个文件里。

```json
{
  "id": "2026-10-22",
  "date": "2026-10-22",
  "label": "2026-10-22 日报",
  "pages": [
    {
      "id": "group-1",
      "label": "一群",
      "section": "今日讨论",
      "heading": "报头",
      "theme": "副题",
      "note": "2026-10-22 · 当日本地记录",
      "stories": [
        {
          "category": "模型发布",
          "title": "标题",
          "text": "正文，自然段之间空一行",
          "emphasis": ["正文里的原文片段"],
          "aiComment": "AI 锐评",
          "resources": [{ "kind": "article", "label": "资料名称", "url": "https://..." }],
          "discussion": [{ "speaker": 1, "time": "00:58", "text": "原话" }]
        }
      ]
    }
  ]
}
```

刊期和版面：

- `id` 与 `date` 相同。`pages` 按 `lib/groups.mjs` 的顺序排列群版面，只包含当天 `pageGroups(date)` 里的群。
- 版面只允许 `id`、`label`、`section`、`heading`、`theme`、`note`、`stories` 字段。
- `stories` 为空数组表示该版缺稿。页面如实显示缺稿。

话题（`stories` 的元素）：

| 字段 | 要求 |
|---|---|
| `category` | 题材标签，如“模型发布” |
| `title`、`text` | 必填。`text` 用空行分自然段 |
| `emphasis` | 正文里的原文片段，规则见 [编辑标准](editorial.md#重点) |
| `aiComment` | 新入库的刊期必填，6 到 90 个字符，单行 |
| `resources` | 可选。每项只有 `kind`、`label`、`url`。`kind` 常用 `paper`、`code`、`article`、`demo`、`discussion` |
| `discussion` | 可选，原始讨论节选，见下文 |

话题的赞踩 ID 由日期、群、标题和正文算出（[`lib/feedback-id.mjs`](../lib/feedback-id.mjs) 的 `feedbackId`）。改标题或正文会得到新 ID，旧版本的票数不再显示。只改格式或顺序不影响 ID。

### 原始讨论节选

`discussion` 是消息数组，每条消息只允许这些字段：

| 字段 | 要求 |
|---|---|
| `speaker` | 正整数，匿名编号。只在一个话题内对应同一位发言者 |
| `time` | 日报写 `HH:MM`（北京时间），周报写 `MM.DD HH:MM` |
| `text` | 非空的原话。图片写 `[图片]`，不能是以 `[图片（` 开头的模型描述 |
| `quote` | 可选，`{ "speaker": 编号或 null, "text": "引文" }` |
| `continues` | 只用于周报，可选 |

节选里不能出现姓名、微信 ID、消息 ID 或身份映射。

## 外部资讯

`data/external-editions/<date>.json` 保存一天的外部资讯版。导入脚本只写下面的读者字段，候选、证据和审核记录留在 `scratch/`。

```json
{
  "date": "2026-10-22",
  "title": "当期报头",
  "intro": "副题",
  "stories": [
    {
      "title": "标题",
      "timing": "北京时间 10 月 22 日 03:09 发布",
      "text": "正文",
      "links": [{ "kind": "官方发布", "label": "原文名称", "url": "https://..." }],
      "emphasis": ["原文片段"],
      "aiComment": "AI 锐评"
    }
  ],
  "trends": [{ "title": "动向观察标题", "text": "正文" }]
}
```

- 每条 `links` 有 1 到 3 个 `https:` 链接，`label` 必填。`kind` 是中文的链接类型，如“官方发布”“报道”“原帖”“论文”“代码”；较早的刊期没有 `kind`，类型写在 `label` 里。
- `timing` 写事件时间，网页把它显示在分类标签的位置。
- `trends` 是当期的“动向观察”，不算话题，不进期刊目录。

## 周报

`data/weekly-editions/<起始>_<结束>.json` 保存一期周报。文件名的两个日期就是 `id`。

- 顶层字段：`id`、起止日期 `from` 和 `through`（也接受 `start` 和 `end`）、`label`、`title`、`pages`，可选 `rank`。
- 版面字段：`id`、`label`、`title`（报头）、`intro`（副题）、`stories`。
- 话题字段：`title`、`text`、`review`（周报的 AI 锐评）、`emphasis`、`dates`（讨论发生的日期）、`kind`、`timeline`、`resources`、`discussion`。
- `timeline` 的每项是 `{ "date", "text" }`，日期应在本周之内。
- `discussion` 的时间写 `MM.DD HH:MM`，日期应在本周之内。
- `rank.groups[].leaders[]` 只有 `rank` 和 `avatar`。头像路径是 `weekly-assets/<周报 id>/avatars/<文件名>`，相对于 `data/`。

## 活跃榜快照

`data/public-activity/snapshot.json` 是审核后的公开榜单。构建只在公开构建和预览时读取它。

```json
{
  "generatedAt": "2026-10-22T16:00:00.000Z",
  "windows": { "week": { "from": "2026-10-19", "through": "2026-10-22" }, "month": { ... }, "all": { "from": null, "through": "..." } },
  "ranks": { "week": { "leaders": [{ "key": "member-002", "rank": 1 }] }, "month": { ... }, "all": { ... } },
  "groups": [
    { "id": "group-1", "first": "...", "last": "...", "available": true,
      "ranks": { "week": { ... }, "month": { ... }, "all": { ... } },
      "daily": { "2026-10-22": { "leaders": [ ... ] } } }
  ],
  "avatars": { "member-002": "avatars/member-002.jpg" }
}
```

- 每个榜单最多 3 人，每人只有 `key` 和 `rank`（1 到 3）。
- `key` 是 `member-NNN`，每次导出时重新编号，不对应任何私有标识。
- `daily` 只能包含已发布刊期里有该群版面的日期。
- 头像文件是 `avatars/<key>.jpg` 或 `.png`。没有审核通过的头像时不写这个键，页面显示默认头像。
- 快照不含分数、消息数、计分规则、姓名或微信 ID。

## 资料库

`data/library.json`：

```json
{
  "version": 1,
  "through": "2026-10-18",
  "items": [
    {
      "id": "exeworldbench",
      "title": "资料的正式名称",
      "summary": "中文简介",
      "type": "benchmark",
      "topics": ["evaluation", "coding-agents"],
      "keywords": ["world model", "simulation", "code generation"],
      "links": [{ "kind": "paper", "url": "https://arxiv.org/abs/..." }],
      "aliases": [],
      "shares": [{ "date": "2026-10-18", "group": "group-2", "avatar": null }]
    }
  ]
}
```

| 字段 | 要求 |
|---|---|
| `id` | 小写字母、数字和连字符，最长 64 个字符。上线后不能再改，因为点心计数按它算 |
| `title` | 最长 100 个字符 |
| `summary` | 最长 160 个字符。审核规范要求 1 到 2 句、不超过 80 个汉字 |
| `type` | `paper`、`benchmark`、`dataset`、`code`、`model`、`tool`、`article`、`video` 之一 |
| `topics` | 1 到 3 个主题 id，按相关度排序。取值见 `lib/library.mjs` 的 `TOPICS` |
| `keywords` | 3 到 12 个，每个最长 30 个字符，不含 `|`，应是规范写法，不能是别名 |
| `links` | 至少 1 个。`kind` 取 `lib/library.mjs` 的 `LINK_KINDS`。第一个是主链接 |
| `aliases` | 可选。同一工作的其他地址，只用于去重，不显示 |
| `shares` | 至少 1 个。每项只有 `date`、`group`、`avatar`。`avatar` 是 `null` 或 `data/library-avatars/` 里的文件名（16 位十六进制哈希 + `.jpg` 或 `.png`） |

两条资料的链接或别名指向同一资源时，构建报错。字段含义和审核规则见 [资料库审核规范](review/library.md)。

`data/library-keywords.json` 把规范关键词映射到别名数组，例如 `{ "Qwen": ["通义千问", "千问"] }`。别名不能重复，也不能是另一个规范关键词。

## 机会

`data/opportunities.json` 的结构与资料库相同（`version`、`through`、`items`）。每条：

| 字段 | 要求 |
|---|---|
| `id` | 同资料库，上线后不再改 |
| `kind` | `hiring`、`event` 或 `cfp` |
| `title`、`org`、`summary` | 最长 80、40、160 个字符 |
| `roles` | 只用于 `hiring`，从 `full-time`、`intern`、`postdoc`、`ra`、`phd` 里选 |
| `location` | 可选，最长 30 个字符 |
| `deadline`、`event_date` | 可选，原文写明的日期 |
| `topics` | 0 到 6 个方向词，每个最长 20 个字符 |
| `links` | 可以为空。格式同资料库 |
| `shares` | 至少 1 个，每项只有 `date` 和 `group`，不记发帖人 |

`title`、`org`、`summary`、`location` 不能含邮箱、手机号、微信号、“加微”“二维码”“私聊我”一类说法，校验会拒绝。

构建时算出 `first`、`last`、`closes` 和 `open`：有截止日期或活动日期时按它关闭，否则最后一次分享满 60 天后关闭。审核规则见 [机会审核规范](review/opportunities.md)。

## 黑话

`data/glossary.json` 有 `version: 1` 和 `terms` 数组。每个词条：

| 字段 | 要求 |
|---|---|
| `term` | 最常见的写法，最长 30 个字符 |
| `variants` | 其他写法。所有写法在全词典里忽略大小写后不能重复 |
| `meaning` | 中文释义，最长 80 个字符 |
| `category` | `缩写`、`代号`、`梗`、`行话`、`网络用语` 之一 |
| `refersTo` | 可选，指代的正式名称，最长 60 个字符 |
| `keyword` | 可选，应是资料库已有的关键词 |

`category` 决定搜索时写法单向还是双向扩展，见 [搜索与词表](search.md)。审核规则见 [黑话审核规范](review/glossary.md)。

## 同义词

`data/search-synonyms.json` 有 `version: 1` 和 `groups`。每组是 2 到 8 个可互换的写法，一个写法只能出现在一组里，也不能与黑话词条的写法重复。维护规则见 [搜索与词表](search.md#维护词表)。

## 语义向量

`data/semantic-vectors.json` 由 [`scripts/embed-catalog.mjs`](../scripts/embed-catalog.mjs) 生成，不手工编辑。

```json
{ "schema_version": 1, "model": "@cf/qwen/qwen3-embedding-0.6b", "dimensions": 1024,
  "vectors": { "<条目 id>": { "hash": "<嵌入文本的哈希>", "scale": 0.00087, "int8": "<base64>" } } }
```

- 键是查询目录的条目 id，如 `daily:<date>:<群>:<标题哈希>`、`library:<id>`。
- `hash` 是嵌入文本（标题、关键词、正文、AI 锐评）的哈希。文本变了，旧向量就不再使用，条目只能被词面检索找到，直到重新运行脚本。
- 每个向量按 int8 存储，带自己的缩放系数。
