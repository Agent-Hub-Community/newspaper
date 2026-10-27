# 入库与发布

这篇文档讲审好的日报、周报、资料库、机会和黑话批次怎么在本地预览、正式写入 `data/`、更新 Cloudflare D1 与语义向量，并推送到 GitHub Pages 上线。

前面的微信采集、调模型写稿和审稿校验在 [bot-workflow](https://github.com/Agent-Hub-Community/bot-workflow) 仓库完成；本仓库从 `scratch/` 下已经审好的批次目录接手。

```text
审好的批次目录 ──► 本地预览 ──► 写入 data/ ──► 公开构建与测试
 (scratch/，忽略)                                   │
                                                    ▼
线上核对 ◄── GitHub Pages ◄── GitHub Actions ◄── 推送 main ◄── 登记 D1 赞踩目录、更新语义向量
```

警告：执行入库和 `git push` 会直接把内容发到公开网站上。只推送已经拿到当期发布同意的审核稿。

## 批次目录里读哪些文件

批次目录放在被 `.gitignore` 忽略的 `scratch/` 下（对于走完 `finalize-batch.mjs` 的日报批次，用的是里面的 `final/` 子目录）：

| 栏目 | 入库脚本读取的文件 |
|---|---|
| 群聊日报 | `issues.json`（只含公开读者字段，结构见[数据格式](data-format.md#1-群聊日报dataeditionsdatejson)） |
| 活跃榜 | `activity/snapshot.json`、`activity/avatars/`，以及 `pending` 已清空的 `activity/avatar-review.json` |
| 外部资讯 | 审好的稿件与 `selection.json`，见[外部资讯导入](external-news.md) |
| 周报 | 审好的周报目录：`reader.json` 与 `preview/avatars/` |
| 资料库、机会、黑话 | `scratch/library/`、`scratch/opportunities/`、`scratch/glossary/` 下的候选与审核结果 |

批次目录里的原始输入 `input.json` 和模型初稿 `draft.json` 只留本机对账，不进 `data/`。

## 1. 本地预览

入库前先跑 [`scripts/prepare-preview.mjs`](../scripts/prepare-preview.mjs) 生成与线上路径结构相同的静态预览站：

```sh
B=scratch/day-2026-10-25-run1
E=scratch/external-2026-10-25-run1

node scripts/prepare-preview.mjs --date 2026-10-25 --batch "$B" \
  --external-draft "$E/commented-reviewed.json" --external-selection "$E/selection.json"
```

脚本会用 `--draft`、`--draft-activity`、`--draft-external` 构建 `dist-preview/`，核对生成的页面数据与输入完全一致，再把静态文件拷进 `$B/preview/newspaper/`。接着以 `$B/preview` 为根目录起本地静态服务：

```sh
python3 -m http.server 8780 --bind 127.0.0.1 --directory "$B/preview"
# 浏览器打开 http://127.0.0.1:8780/newspaper/daily/2026-10-25/group-2/
```

预览时不要手改 `dist-preview/data.js`；发现问题回源头改完重新生成。在 320px、390px、768px 和 1440px 宽度下检查各版正文、重点下划线、AI 锐评、资料卡片、讨论弹窗和活跃榜，并跑一遍 `node test/daily-preview.mjs "$B/issues.json"` 确认没有漏进内部字段。

## 2. 写入 `data/`

### 日报与活跃榜

```sh
node scripts/publish-reviewed-batch.mjs "$B"
```

[`scripts/publish-reviewed-batch.mjs`](../scripts/publish-reviewed-batch.mjs) 落盘前会做一轮完整检查：

- `activity/avatar-review.json` 的 `pending` 数组已经清空；
- 周榜、月榜、总榜的截止日都对齐到本批最后一天，当天有版面的每个群都有日榜；
- `issues.json` 只含允许的读者字段，每条都有 AI 锐评、合法的重点下划线和无查询参数的 `https:` 资料链接，且不含证据 ID、微信号或群号。

全部通过后，脚本把刊期写进 `data/editions/<date>.json`，更新 `data/public-activity/`，并清理不再被引用的旧头像。

### 外部资讯与周报

```sh
# 外部资讯：
node scripts/import-external-report.mjs "$E/commented-reviewed.json" "$E/selection.json"

# 周报：
node scripts/import-reviewed-weekly.mjs <审好的周报 reader 目录>
```

### 资料库、机会与黑话（每周随周报更新）

1. 资料库：按[资料库审核规范](review/library.md)把审核结果写进 `scratch/library/curated/*.json`，跑 `node scripts/check-library-review.mjs` 确认无遗漏；跑 `node scripts/assemble-library.mjs`，逐张看完 `scratch/library/avatars-pending/` 里的新头像并填好 `avatar-review.json` 后，再跑一次 `assemble-library.mjs`。
2. 机会：按[机会审核规范](review/opportunities.md)写好 `scratch/opportunities/reviewed.json`，跑 `node scripts/assemble-opportunities.mjs`。
3. 黑话：按[黑话审核规范](review/glossary.md)合并新词条，写入 `data/glossary.json`。

## 3. 推送前的四步操作

入库完成后，按顺序跑完下面四步再提交推送：

1. 跑公开构建：

   ```sh
   FEEDBACK_API_URL=<反馈 Worker 地址> npm run build -- --public
   ```

2. 往 Cloudflare D1 登记新条目的赞踩与点心 ID（未登记的条目在线上会返回 404、显示“—”）：

   ```sh
   node scripts/feedback-catalog.mjs dist/data.js scratch/feedback-catalog.sql
   npx wrangler d1 execute agenthub-feedback --remote --config feedback/wrangler.jsonc --file scratch/feedback-catalog.sql
   ```

   SQL 里用的是 `INSERT OR IGNORE`，重跑不会冲掉已有票数。

3. 为新条目生成语义检索向量，并再跑一次公开构建让新向量打进 `dist/`：

   ```sh
   CLOUDFLARE_ACCOUNT_ID=<账号 ID> node scripts/embed-catalog.mjs
   FEEDBACK_API_URL=<反馈 Worker 地址> npm run build -- --public
   ```

4. 跑单元测试与公开构建检查：

   ```sh
   npm test
   node test/build.mjs --public
   ```

全部通过后，提交 `data/` 下的改动并推送到 `main`。

### 如果只改了脚本、测试或文档

只改代码或 Markdown 文档同样会触发线上部署，但按理不应改变构建出的网页。推送前可以在改动前后的 commit 上各跑一次 `FEEDBACK_API_URL=... npm run build -- --public`，用 `diff -qr` 确认两份 `dist/` 完全相同。

## 4. 自动部署与线上核对

推送到 `main`（或在 GitHub Actions 页面手动触发 `workflow_dispatch`）后，[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) 会在 Node.js 22 环境下跑 `npm ci`、`npm test`、公开构建和 `node test/build.mjs --public`，然后把 `dist/` 部署到 GitHub Pages。

部署跑完后：

1. 比对线上首页与本地 `dist/index.html` 里的 `?v=` 资源哈希，或跑 `bot-workflow/skill/scripts/verify-publication.mjs` 逐字节核对 `data.js` 与当期 `issues/<date>.js`。
2. 在浏览器里点开新刊期深链（如 `/newspaper/daily/2026-10-25/group-2/`），看一眼正文、讨论弹窗和活跃榜。
3. 需要时可跑线上巡检脚本：`node test/resources-browser.mjs --production`、`AGENT_HUB_SITE_URL=... node test/ranking-page.mjs`。

## 5. 查看浏览与搜索统计

维护者在本机登录 Wrangler 后，可以拉取 Worker D1 里的统计报表（只写到本地忽略目录，不公开）：

- `node scripts/traffic-report.mjs [--from YYYY-MM-DD --to YYYY-MM-DD]`：每日浏览量、访客数、微信端占比与热门页面；
- `node scripts/search-stats.mjs`：站内搜索与 API 搜索的高频词、零结果词与点击情况；
- `node scripts/agent-read-stats.mjs --json --days 7`：`/read/` 接口的小时级读取统计。
