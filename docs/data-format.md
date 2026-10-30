# 数据格式（`data/`）

`data/` 目录下放的是已经审完公开的读者数据。静态站构建只读这里的文件；微信原始聊天记录、群号、成员映射表和模型初稿都不进本仓库。

每种文件都有对应的校验模块，字段不合法时 `npm test` 和 `npm run build` 会直接报错。下面列出各文件的实际结构，细节以表格里的校验代码为准。

| 路径 | 存什么 | 校验代码 |
|---|---|---|
| `data/editions/<date>.json` | 群聊日报（一天一个文件） | [`scripts/publish-reviewed-batch.mjs`](../scripts/publish-reviewed-batch.mjs)、[`lib/draft-editions.mjs`](../lib/draft-editions.mjs)、[`lib/story-discussion.mjs`](../lib/story-discussion.mjs) |
| `data/external-editions/<date>.json` | 当日外部资讯（一天一个文件） | [`lib/external-editions.mjs`](../lib/external-editions.mjs) |
| `data/weekly-editions/<起>_<止>.json` | 自然周周报 | [`lib/weekly-editions.mjs`](../lib/weekly-editions.mjs) |
| `data/weekly-assets/<周报 id>/avatars/` | 周榜前三名头像 | 同上 |
| `data/public-activity/snapshot.json`、`avatars/` | 活跃榜快照与头像 | [`lib/public-activity.mjs`](../lib/public-activity.mjs) |
| `data/library.json`、`data/library-avatars/` | 资料库条目与分享者头像 | [`lib/library.mjs`](../lib/library.mjs) |
| `data/library-keywords.json` | 资料库规范关键词的别名表 | 同上 |
| `data/opportunities.json` | 招聘、活动与征稿机会 | [`lib/opportunities.mjs`](../lib/opportunities.mjs) |
| `data/glossary.json` | 群聊黑话词典 | [`lib/glossary.mjs`](../lib/glossary.mjs) |
| `data/search-synonyms.json` | 站内搜索的普通同义词组 | [`lib/synonyms.mjs`](../lib/synonyms.mjs) |
| `data/semantic-vectors.json` | 语义检索用的 int8 向量 | [`lib/semantic.mjs`](../lib/semantic.mjs) |

几条通用规矩：

- 日期统一用北京时间的 `YYYY-MM-DD`。
- 所有外链只允许 `https:` 且不带账号密码；群稿挂载的资料链接不允许带 `?` 查询参数。
- 群版面 id 是 `group-1` 到 `group-5`（见 [`lib/groups.mjs`](../lib/groups.mjs)），外部资讯版面 id 是 `external`。
- 标题、正文、锐评等文本字段一律是纯文本，前端渲染时会转义，不解析里面的 HTML 或 Markdown 语法。

## 1. 群聊日报（`data/editions/<date>.json`）

一个文件存当天所有群版面（同日外部资讯单放在 `data/external-editions/`，构建时自动拼成最后一版）：

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
      "heading": "报头主线",
      "theme": "副题补充",
      "note": "2026-10-22 · 当日本地记录",
      "stories": [
        {
          "category": "模型发布",
          "title": "条目标题",
          "text": "正文纯文本，自然段之间用空行隔开",
          "emphasis": ["正文里逐字出现的一句重点"],
          "aiComment": "一句 AI 锐评",
          "resources": [{ "kind": "article", "label": "资料名称", "url": "https://..." }],
          "discussion": [{ "speaker": 1, "time": "00:58", "text": "匿名原话" }]
        }
      ]
    }
  ]
}
```

- `pages` 按 `lib/groups.mjs` 的顺序排列当天 `pageGroups(date)` 里的群；当天没稿的群保留在数组里，`stories` 设成 `[]`。
- 单条故事（`stories[]`）的字段：
  - `category`：短分类标签；`title`、`text`：必填，正文用 `\n\n` 分段。
  - `emphasis`：要在正文里加下划线的原文片段数组，校验规则见[读者内容规则](editorial.md#重点下划线emphasis)。
  - `aiComment`：新入库刊期必填，单行 6 到 90 个字符。
  - `resources`：可选，每项含 `kind`（`paper` / `code` / `article` / `demo` / `discussion`）、`label`、`url`。
  - `discussion`：可选，匿名原始讨论节选（见下）。
- 每条故事的点赞 ID 由 `feedbackId(date, group, story)` 根据日期、群、标题和正文算出；改了标题或正文就会生成新 ID。

### 原始讨论节选（`discussion`）

`discussion` 数组里每条消息只允许这几个字段：

| 字段 | 说明 |
|---|---|
| `speaker` | 从 1 开始的正整数，代表“群友 1”“群友 2”（只在当前这一条故事内部有效） |
| `time` | 日报写 `HH:MM`，周报写 `MM.DD HH:MM`（均为北京时间） |
| `text` | 原话文本（保留原始消息正文与 `@昵称` 不改写）；图片固定写 `[图片]`，不能把 `[图片（缩略图）：……]` 这种模型图说放进来 |
| `quote` | 可选，`{ "speaker": 编号或 null, "text": "被引用的原话" }` |
| `continues` | 仅周报可选，标记跨话题延续 |

## 2. 外部资讯（`data/external-editions/<date>.json`）

```json
{
  "date": "2026-10-22",
  "title": "当期报头",
  "intro": "导语",
  "stories": [
    {
      "title": "新闻标题",
      "timing": "北京时间 10 月 22 日 03:09 发布",
      "text": "正文",
      "links": [{ "kind": "官方发布", "label": "原文名称", "url": "https://..." }],
      "emphasis": ["重点片段"],
      "aiComment": "AI 锐评"
    }
  ],
  "trends": [{ "title": "动向观察标题", "text": "正文" }]
}
```

- `links` 每条 1 到 3 个 `https:` 链接，`kind` 填中文类型（如“官方发布”“原帖”“报道”“讨论”“论文”“代码”）。
- `trends` 是页面底部的“动向观察”（0 到 3 条），不算具体新闻条目。

## 3. 周报（`data/weekly-editions/<起>_<止>.json`）

- 顶层字段：`id`（`YYYY-MM-DD_YYYY-MM-DD`）、`from`、`through`、`label`、`title`、`pages` 及可选的 `rank`。
- 每个群版面含 `id`、`label`、`title`、`intro` 和 `stories`；每条故事含 `title`、`text`、`review`（周报的 AI 锐评）、`emphasis`、`dates`、`kind`、`timeline`、`resources`、`discussion`。
- `rank.groups[].leaders[]` 只存名次 `rank` 和相对 `data/` 的头像路径 `weekly-assets/<周报 id>/avatars/<文件名>`。

## 4. 活跃榜快照（`data/public-activity/snapshot.json`）

只存周榜、月榜、总榜和已发布日期的各群日榜前三名（`key: "member-NNN"` 和 `rank: 1..3`），以及 `member-NNN` 到 `avatars/member-NNN.jpg` 的映射。每次导出都会重新给上榜成员编 `member-NNN`，里面没有微信号、群昵称或具体发言条数。

## 5. 资料库（`data/library.json`）与机会（`data/opportunities.json`）

资料库每条 `item` 的主要字段：

- `id`：小写字母、数字与连字符（上线后固定不变，点心计数绑在上面）。
- `title`（≤100 字）、`summary`（中文 1 到 2 句，≤160 字符）。
- `type`：`paper`、`benchmark`、`dataset`、`code`、`model`、`tool`、`article`、`video` 之一。
- `topics`：1 到 3 个主题分类（取值见 `lib/library.mjs` 的 `TOPICS`）。
- `keywords`：3 到 12 个规范关键词（别名映射放在 `data/library-keywords.json`）。
- `links`：主链接排第一；`aliases`：同一工作的其他网址（只用于去重）；`shares`：分享日期、群 id 和审过的头像文件名（或 `null`）。

`data/opportunities.json` 存放群里发过的招聘（`hiring`）、活动（`event`）和征稿（`cfp`），不记发帖人，且校验器会拒绝含邮箱、手机号、微信号或“加微／私聊”字样的文本。构建时根据 `deadline`、`event_date` 或最后分享日加 60 天自动算出当前是否还开放（`open`）。

## 6. 群聊黑话（`data/glossary.json`）、同义词与语义向量

- `data/glossary.json`：每条含主写法 `term`、其他写法 `variants`、中文释义 `meaning`、分类 `category`（`缩写` / `代号` / `梗` / `行话` / `网络用语`）、正式名称 `refersTo` 和可选的资料库关联词 `keyword`。
- `data/search-synonyms.json`：每组 2 到 8 个可互换的日常写法，不能与黑话词条重复。
- `data/semantic-vectors.json`：由 `scripts/embed-catalog.mjs` 调用 Cloudflare Workers AI（`@cf/qwen/qwen3-embedding-0.6b`）生成，按条目 id 和文本哈希缓存 1024 维 int8 量化向量，供 Worker 的混合检索使用。
