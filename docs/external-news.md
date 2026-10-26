# 外部资讯

“外部资讯”是与各群版面并列的一个版面，收录当天 AI 与科技行业的重要新闻，每条保留原始出处。本文说明外部资讯稿件交给本仓库时的格式、审核记录、导入和网页呈现。

采集候选、回读原文、选题和写稿的方法属于写稿流程，见 [bot-workflow](https://github.com/Agent-Hub-Community/bot-workflow)。外部资讯不读取群聊数据。

## 交给本仓库的文件

一期外部资讯在批次目录（例如 `scratch/external-2026-10-22-run1/`）里交给本仓库三份文件：

| 文件 | 内容 |
|---|---|
| `selection.json` | 审核后的候选和证据：每个事件的原文、热度快照和选题理由 |
| 稿件，例如 `commented-reviewed.json` | 读者稿：报头、导语、各条正文、链接、重点和 AI 锐评 |
| 审核记录，例如 `commented-review.json` | 编辑批准这份稿件和这份证据的记录 |

这些文件都留在被 Git 忽略的 `scratch/` 下。只有导入后的读者字段进入 `data/external-editions/`。

### selection.json

```json
{
  "edition": "2026-10-22",
  "timezone": "Asia/Shanghai",
  "windowStart": "2026-10-21T16:00:00.000Z",
  "cutoff": "2026-10-22T16:00:00.000Z",
  "candidates": [
    {
      "id": "copilot-update",
      "kind": "news",
      "title": "Copilot 更新",
      "timing": "已核验的日期说明",
      "selectionReason": "选题理由",
      "attention": [{ "platform": "X", "url": "https://...", "fetchedAt": "ISO 时间", "observation": "热度快照" }],
      "sources": [{ "publisher": "原发布方", "url": "https://...", "fetchedAt": "ISO 时间", "text": "实际读取的原文或摘录" }]
    }
  ],
  "rejected": [],
  "coverageNotes": []
}
```

[`lib/external-workflow.mjs`](../lib/external-workflow.mjs) 的 `validateSelection` 检查：

- 时间窗从内容日期的北京时间零点开始，不超过次日零点。
- 每个候选有选题理由、至少一条热度快照和至少一条已读原文。所有链接都是 `https:`。
- 论文候选（`kind: "paper"`）带 `paperRanks`，两个榜单的名次都在前五。

### 稿件

```json
{
  "date": "2026-10-22",
  "title": "当期报头",
  "intro": "导语",
  "stories": [
    {
      "title": "标题",
      "timing": "北京时间 10 月 22 日 03:09 发布",
      "text": "正文",
      "links": [{ "kind": "官方发布", "label": "原文名称", "url": "https://..." }],
      "emphasis": ["原文片段"],
      "aiComment": "AI 锐评",
      "candidateIds": ["copilot-update"]
    }
  ],
  "trends": [{ "title": "动向观察标题", "text": "正文" }]
}
```

`validateExternalDraft` 检查：

- `date` 等于 `selection.json` 的 `edition`。
- 至少一条新闻，不为凑数补条目。“动向观察”最多 3 条。
- 每条用 `candidateIds` 指向候选，一个候选只能用一次。
- 每条有 1 到 3 个链接，每个链接应来自所指候选的原文或热度快照。
- 每条有 `emphasis` 数组，规则见 [读者内容规则](editorial.md#重点)。
- 导入时，每条都要有 `aiComment`。

链接正确不代表事实审核通过。事实归属、时间时区、指标的比较基线等仍由编辑人工检查。

## 审核记录

编辑逐条审核稿件并决定采用后，运行：

```sh
E=scratch/external-2026-10-22-run1
node scripts/review-external.mjs "$E/commented-reviewed.json" "$E/selection.json" "$E/commented-review.json" "<审核者>" --approve
```

审核记录保存 `status: "approved"`、审核者、审核时间，以及完整的稿件和 `selection.json`。导入时逐字比较，所以稿件、锐评或证据改过以后，应重新审核。审核记录直接保存原文，便于对照。

## 导入

```sh
node scripts/import-external-report.mjs "$E/commented-reviewed.json" "$E/selection.json" "$E/commented-review.json"
```

导入脚本重新运行上面的全部检查，然后只把读者字段（`date`、`title`、`intro`、`stories` 的 `title`、`timing`、`text`、`links`、`emphasis`、`aiComment`，以及 `trends`）写进 `data/external-editions/<date>.json`。
候选 ID、证据、热度快照和审核记录不进入网页数据。格式见 [数据格式](data-format.md#外部资讯)。

导入以后与同日群稿一起预览、构建和发布，见 [发布流程](publishing.md)。还没入库的外部资讯稿也可以直接合进预览：

```sh
npm run build -- --draft scratch/day-2026-10-22-run1/issues.json --draft-external "$E/commented-reviewed.json" "$E/selection.json"
node test/external-page.mjs
```

`test/external-page.mjs` 固定检查 2026-09-25 的外部资讯版和同日群版。检查新刊期时，请同步更新验收日期或另行检查。

## 网页呈现

构建时，[`lib/external-editions.mjs`](../lib/external-editions.mjs) 把外部资讯合并成当天的最后一个版面：

| 网页 | 来源字段 |
|---|---|
| 版面名“外部资讯”，栏目“研究 · 产品 · 工程” | 固定 |
| 报头、副题 | `title`、`intro` |
| 每条的分类标签 | `timing` |
| 资料卡片 | `links`。`kind` 是“论文”“代码”时显示对应图标，是“原帖”“讨论”时显示为讨论，其余（如“官方发布”“报道”）显示为文章 |
| 动向观察 | `trends`，页内锚点 `#trends-heading` |

- 外部资讯版不显示群活跃榜，也没有原始讨论入口。
- 某天没有外部资讯时，版面显示“本日外部资讯尚未收录”。
- 动向观察不算话题：期刊目录只用 `trend_count` 计数，全站搜索单独列出。
