# 入库与发布

本文说明审核后的内容怎样进入 `data/`，以及网站怎样构建、登记、部署和核验。只有维护者执行入库和发布。

内容的采集、写稿和审稿在 [bot-workflow](https://github.com/Agent-Hub-Community/bot-workflow) 完成。bot-workflow 把审核后的结果写成 `scratch/` 下的批次目录，本仓库从这里接手。

```text
审核后的批次目录 ──► 本地预览 ──► 入库到 data/ ──► 公开构建和测试
 (scratch/，不提交)                                  │
                                                     ▼
线上核验 ◄── GitHub Pages ◄── GitHub Actions ◄── 推送 main ◄── 登记赞踩目录、更新语义向量
```

图：从审核后的批次到线上的步骤。

警告：入库、推送和部署会把内容公开。只发布已获得发布授权的批次，不要推送未审核的稿件。

## 审核后的批次目录

批次目录在被 Git 忽略的 `scratch/` 下，例如 `scratch/day-2026-10-22-run1/`。入库脚本只读取下面这些文件：

| 内容 | 文件 |
|---|---|
| 日报 | `issues.json`：审核后的读者稿，只含读者字段，格式见 [数据格式](data-format.md#日报刊期) |
| 活跃榜 | `activity/snapshot.json`：公开榜单快照；`activity/avatars/`：审核过的头像；`activity/avatar-review.json`：头像审核记录，`pending` 应为空 |
| 外部资讯 | 稿件、`selection.json` 和审核记录，见 [外部资讯](external-news.md) |
| 周报 | 审核后的读者目录：`reader.json` 和 `preview/avatars/` |
| 资料库、机会、黑话 | `scratch/library/`、`scratch/opportunities/`、`scratch/glossary/` 下的候选和审核结果，见下文 |

批次目录里还有原始输入、模型原稿和审核证据。这些文件不进入网页数据，也不提交。

## 预览

用 [`scripts/prepare-preview.mjs`](../scripts/prepare-preview.mjs) 预览一个审核中的日报批次：

```sh
B=scratch/day-2026-10-22-run1
E=scratch/external-2026-10-22-run1
node scripts/prepare-preview.mjs --date 2026-10-22 --batch "$B"
# 同时预览未入库的外部资讯：
node scripts/prepare-preview.mjs --date 2026-10-22 --batch "$B" \
  --external-draft "$E/commented-reviewed.json" --external-selection "$E/selection.json"
```

这个脚本：

1. 用 `--draft`、`--draft-activity`（以及 `--draft-external`）构建 `dist-preview/`；
2. 断言构建出的刊期与审核输入逐字段一致，榜单与快照一致；
3. 把预览复制到批次目录的 `preview/newspaper/`，与线上使用相同的路径前缀。

用静态服务打开预览：

```sh
python3 -m http.server 8780 --bind 127.0.0.1 --directory "$B/preview"
# 浏览器打开 http://127.0.0.1:8780/newspaper/daily/2026-10-22/group-1/
```

注意：不要手改 `dist-preview/data.js`。预览不对时，改审核输入后重新运行脚本。

预览时逐条检查正文、重点、AI 锐评、资料卡片和原始讨论面板，并在 320、390、768、1440px 等宽度下看实际截图。不要因为话题多就截断稿件。
`node test/daily-preview.mjs "$B/issues.json"` 检查预览里没有内部字段和私有标识。浏览器测试的完整列表见 [测试](testing.md)。

## 入库

### 日报和活跃榜

```sh
node scripts/publish-reviewed-batch.mjs "$B"
```

[`scripts/publish-reviewed-batch.mjs`](../scripts/publish-reviewed-batch.mjs) 写入前检查：

- `activity/avatar-review.json` 的 `pending` 已清空；
- 周榜、月榜、总榜都统计到本批最后一天，每个群版面都有当天日榜；
- 批次以外的每个已发布日期，日榜名次和头像文件内容与现有 `data/public-activity/` 一致；
- 刊期、版面和话题只含允许的读者字段，每条有 AI 锐评，重点和原始讨论通过校验，资料链接是不带查询参数的 `https:` 地址；
- 稿件里没有证据 ID、核查记录、微信 ID 和群 ID。

任何一项不满足，脚本就报错，不写任何文件。检查都通过后，脚本把每期写进 `data/editions/<date>.json`，把快照和头像写进 `data/public-activity/`，并删除快照以外的旧头像文件。

每次发布新日报，都要同时更新各群日榜和社区周榜、月榜、总榜，统一截止到最后一个内容日期的次日零点（北京时间）。只改旧文案或界面时，不重算榜单。

### 外部资讯

```sh
node scripts/import-external-report.mjs "$E/commented-reviewed.json" "$E/selection.json" "$E/commented-review.json"
```

脚本重新检查稿件、证据和审核记录，只把读者字段写进 `data/external-editions/<date>.json`。详见 [外部资讯](external-news.md)。

### 周报

```sh
node scripts/import-reviewed-weekly.mjs <审核后的周报目录>
```

[`scripts/import-reviewed-weekly.mjs`](../scripts/import-reviewed-weekly.mjs) 读取目录里的 `reader.json`，用 [`lib/weekly-editions.mjs`](../lib/weekly-editions.mjs) 校验，然后：

- 把周报写进 `data/weekly-editions/<起始>_<结束>.json`；
- 把周榜头像从 `preview/avatars/` 复制到 `data/weekly-assets/<周报 id>/avatars/`，并改写头像路径。

### 资料库、机会和黑话

资料库、机会和黑话随周报每周补齐一次。bot-workflow 从群聊里收集候选，审核 agent 和编辑按审核规范处理，本仓库的脚本把审核结果合进 `data/`。

资料库：

1. 候选在 `scratch/library/candidates.json`。候选含私有聊天上下文，只能放在 `scratch/` 下。
2. 按 [资料库审核规范](review/library.md) 审核，结果写到 `scratch/library/curated/*.json`。
3. 运行 `node scripts/check-library-review.mjs`，确认每个待审候选恰好处理一次。
4. 运行 `node scripts/assemble-library.mjs`。新头像放在 `scratch/library/avatars-pending/`。
5. 逐张查看新头像，把文件名写进 `scratch/library/avatar-review.json` 的 `approved` 或 `rejected`，再运行一次 `assemble-library.mjs`。
6. 编辑通读新条目，核对简介里的数字和说法，去掉标题里的人名和标题党写法。
7. 运行 `npm test`、`npm run build`、`node test/build.mjs` 和 `node test/library-browser.mjs`。

已有条目保留原 `id` 和措辞，脚本只重算分享记录。要改已发布条目的措辞，直接改 `data/library.json`。条目的 `id` 上线后不能再改。

机会：

1. 候选在 `scratch/opportunities/candidates.json`。
2. 按 [机会审核规范](review/opportunities.md) 审核，结果写到 `scratch/opportunities/reviewed.json`。打开公众号原文和官网，核对日期、地点和链接。
3. 运行 `node scripts/assemble-opportunities.mjs`。它检查每个候选恰好处理一次；同一链接再次分享时，只追加分享记录。
4. 运行 `npm test`、`npm run build` 和 `node test/library-browser.mjs`，在页面上看一遍机会区。

机会的“开放”状态按构建当天计算，所以没有新刊期时也要每周重新部署一次（见下文“部署”）。

黑话：

1. 聊天分块在 `scratch/glossary/`。
2. 按 [黑话审核规范](review/glossary.md) 审核。
3. 编辑合并结果，写进 `data/glossary.json`，运行 `npm test` 和 `npm run build`。

## 推送前

入库后、推送前，按顺序做下面几步。

1. 运行公开构建：

   ```sh
   FEEDBACK_API_URL=<反馈 Worker 的地址> npm run build -- --public
   ```

2. 登记赞踩目录。新条目没有登记时，接口返回 404，页面计数显示“—”：

   ```sh
   node scripts/feedback-catalog.mjs dist/data.js scratch/feedback-catalog.sql
   npx wrangler d1 execute agenthub-feedback --remote --config feedback/wrangler.jsonc --file scratch/feedback-catalog.sql
   ```

   登记语句是 `INSERT OR IGNORE`，重复运行不会改动已有条目。标题或正文改过的话题会得到新 ID，旧版本的票数留在 D1 的旧条目上，页面不再显示。不要登记未审核的草稿。

3. 更新语义向量：

   ```sh
   CLOUDFLARE_ACCOUNT_ID=<账号 ID> node scripts/embed-catalog.mjs
   ```

   脚本只为新增或文本改过的条目计算向量，写回 `data/semantic-vectors.json`。它需要 `CLOUDFLARE_ACCOUNT_ID`，以及 `CLOUDFLARE_API_TOKEN` 或本机的 Wrangler 登录（需要 Workers AI 权限）。运行后再做一次公开构建，让新向量进入 `dist/`。

4. 运行检查：

   ```sh
   npm test
   node test/build.mjs --public
   ```

5. 提交 `data/` 下的改动，推送到 `main`。

Wrangler 的授权和 Worker 本身的部署见 [feedback/README.md](../feedback/README.md)。账号 ID 和令牌不写进仓库。

### 只改代码或文档的提交

只改脚本、测试或文档的提交也会触发部署，但不应改变网页。推送前，在改动前后的提交上分别运行公开构建，用 `diff -r` 比较两份 `dist/`。

## 部署

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) 用 Node.js 22 运行：

| 触发 | 步骤 |
|---|---|
| 向 `main` 提 pull request | `npm ci`、`npm test`、`npm run build -- --public`、`node test/build.mjs --public`。不部署 |
| 推送到 `main` | 同上，然后上传 `dist/` 并部署到 GitHub Pages |
| 手动运行（`workflow_dispatch`） | 同推送。用于没有新提交时重新部署 |

- 仓库变量 `FEEDBACK_API_URL` 提供反馈 Worker 的地址。
- GitHub Actions 不读取聊天数据，不运行模型，也不实时更新榜单。
- 只部署 Worker 不会更新网站；只部署网站也不会更新 Worker。两者顺序见 [feedback/README.md](../feedback/README.md)。
- 要刷新按构建日期计算的内容（例如机会的“开放”状态），在 Actions 页面手动运行这个 workflow，分支选 `main`。

## 线上核验

部署完成后：

1. 比较本地 `dist/index.html` 和线上首页里各资源的 `?v=` 哈希。完全一致时，部署内容与本地相同。
2. 打开新刊期的各版深链（例如 `/newspaper/daily/2026-10-22/group-1/`），确认正文、榜单和原始讨论面板。
3. 需要时运行线上检查：

   | 命令 | 检查 |
   |---|---|
   | `node test/resources-browser.mjs --production` | 线上的资料链接 |
   | `AGENT_HUB_SITE_URL=<站点地址> node test/ranking-page.mjs` | 线上的活跃榜 |
   | `VERIFY_SITE=<站点地址> DISCUSSION_DATE=<日期> node test/discussion-browser.mjs` | 线上的原始讨论面板 |
   | `node test/feedback-live.mjs --live --production` | 线上的赞踩。会提交并撤回一张测试票，只在需要验证线上写入时运行 |

## 统计报告

维护者可以在本机读取 Worker 的统计，需要 Wrangler 登录：

- `node scripts/search-stats.mjs`：站内搜索和接口搜索的关键词、零结果和点击；
- `node scripts/agent-read-stats.mjs --json --days 7`：`/read/` 的读取次数；
- 浏览量统计的查询方法见 [feedback/README.md](../feedback/README.md)。

报告只写到本机被忽略的目录，不公开。各项统计存什么、不存什么，见 [feedback/README.md](../feedback/README.md)。
