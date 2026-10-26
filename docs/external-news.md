# 外部资讯版格式与导入

“外部资讯”是和各群日报并列的一个独立版面，每天选编 AI 与科技行业里值得看的新发布、论文和开源进展，每条附上原始出处链接。

前期的多渠道抓取、点开原文核实和调模型写稿在 [bot-workflow](https://github.com/Agent-Hub-Community/bot-workflow) 仓库里做；这篇文档讲审好的外部资讯稿怎么校验并导入本仓库。

## 交给本仓库的三份文件

每一期外部资讯在 `scratch/external-YYYY-MM-DD-runN/` 目录下准备好三份文件：

| 文件 | 里面是什么 |
|---|---|
| `selection.json` | 入选候选与证据：每件事的一手原文摘录、各平台热度快照、选题理由和淘汰记录 |
| 读者稿（如 `commented-reviewed.json`） | 当期报头、导语、各条新闻正文、外链、重点下划线和 AI 锐评 |
| 审核记录（如 `commented-review.json`） | 由 `scripts/review-external.mjs` 生成的批准回执，把读者稿和 `selection.json` 绑在一起 |

这三份原始文件留在被 Git 忽略的 `scratch/` 下；只有跑完导入脚本后抽出的纯读者字段，才会写进 `data/external-editions/<date>.json`。

### 1. `selection.json`

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
      "timing": "已核实的时间说明",
      "selectionReason": "为什么值得选",
      "attention": [{ "platform": "X", "url": "https://...", "fetchedAt": "ISO 时间", "observation": "热度快照" }],
      "sources": [{ "publisher": "原发布方", "url": "https://...", "fetchedAt": "ISO 时间", "text": "实际读到的原文或摘录" }]
    }
  ],
  "rejected": [],
  "coverageNotes": []
}
```

[`lib/external-workflow.mjs`](../lib/external-workflow.mjs) 的 `validateSelection` 会检查：

- 时间窗口从刊期当天的北京时间 `00:00` 开始，不超过次日 `00:00`。
- 每个候选都有选题理由、至少一条热度观察和至少一条实读过的一手原文（`sources`），所有链接均为 `https:`。
- 标为双榜推荐论文（`kind: "paper"`）的候选，必须带有在 HF 和 alphaXiv 都进了前五的 `paperRanks`。

### 2. 读者稿

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
      "emphasis": ["原文重点片段"],
      "aiComment": "AI 锐评",
      "candidateIds": ["copilot-update"]
    }
  ],
  "trends": [{ "title": "动向观察标题", "text": "正文" }]
}
```

`validateExternalDraft` 会检查：

- `date` 与 `selection.json` 的 `edition` 一致。
- 至少有 1 条新闻，“动向观察”（`trends`）最多 3 条。
- 每条新闻用 `candidateIds` 指向 `selection.json` 里的候选，同一个候选不能被两条新闻重复用。
- 每条带 1 到 3 个链接，且每个 URL 都必须在所指候选的 `sources` 或 `attention` 里逐字出现过。
- `emphasis` 满足下划线规则（见[读者内容规则](editorial.md#重点下划线emphasis)），导入时每条都带 `aiComment`。

## 签发审核回执并入库

主编通读稿件、核对完原文时间和数字后，跑下面两条命令签回执并入库：

```sh
E=scratch/external-2026-10-22-run1
node scripts/review-external.mjs "$E/commented-reviewed.json" "$E/selection.json" "$E/commented-review.json" "<审核人>" --approve
node scripts/import-external-report.mjs "$E/commented-reviewed.json" "$E/selection.json" "$E/commented-review.json"
```

- `review-external.mjs` 把当时的稿件全文和 `selection.json` 一并存进 `commented-review.json`。如果后面又改了一句正文、换了一条锐评或动了 `selection.json`，导入时比对不上就会报错，需要重签回执。
- `import-external-report.mjs` 复查通过后，去掉内部的 `candidateIds` 和证据，只把干净的读者字段写进 `data/external-editions/<date>.json`。

如果还在审稿阶段、想先跟同日群稿合在一起看本地预览，不用先入库，直接用 `--draft-external` 即可（见[入库与发布](publishing.md#1-本地预览)）。

## 页面上怎么展示

构建时 [`lib/external-editions.mjs`](../lib/external-editions.mjs) 会把当天的外部资讯拼成日报的最后一个版面：

- 版面页签固定叫“外部资讯”，眉题写“研究 · 产品 · 工程”，报头和副题取 `title` 和 `intro`。
- 每条新闻头顶的小标签显示 `timing`（发布或事件时间）。
- `links` 渲染成底部的资料卡片：`kind` 为“论文”“代码”时配对应图标，为“原帖”“讨论”时配讨论图标，其余（“官方发布”“报道”等）配文章图标。
- `trends` 渲染在版面底部的“动向观察”区块（锚点 `#trends-heading`）。
