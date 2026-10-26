# 架构说明

这篇文档讲网站是怎么拼出来的：`build.mjs` 读取 `data/` 下的公开 JSON 数据，配合 `site/` 里的前端静态文件生成纯静态网站，由 GitHub Pages 托管；旁边的 Cloudflare Worker（`feedback/`）提供点赞点踩、浏览与搜索统计，以及给 Agent 调的公开查询 API。

```text
data/ (公开 JSON) ──┐
site/ (前端资源)   ──┼──► build.mjs ──► dist/ ──► GitHub Actions ──► GitHub Pages
lib/  (构建模块)   ──┘        │                                          │
                              └─ search/catalog.json 等 ──► feedback/ Worker ◄── 浏览器与 Agent
```

## 目录分工

| 目录 | 放什么 |
|---|---|
| `site/` | 浏览器端文件：`index.html`、`404.html`、前端 `.js`、`.css` 和 `skins/` 节日皮肤。构建时拷进 `dist/` |
| `lib/` | Node 模块：读数据、跑 schema 校验、渲染静态路由页和 Agent 导出文件（站点域名与路径前缀定义在 `lib/site.mjs`） |
| `data/` | 审完公开的读者数据，字段说明见[数据格式](data-format.md) |
| `build.mjs` | 静态站构建入口 |
| `scripts/` | 维护脚本：本地预览、入库、D1 登记与统计报表，见[入库与发布](publishing.md) |
| `feedback/` | Cloudflare Worker + D1 服务，见 [`feedback/README.md`](../feedback/README.md) |
| `test/` | 单元测试与 Playwright 浏览器测试，见[测试说明](testing.md) |
| `bench/` | 查询 API 的小型评测基准 |

`scratch/`、`dist/`、`dist-preview/` 和 `output/` 都被 `.gitignore` 排除。维护者平时跑日报的私有批次目录放在 `scratch/` 下，不会提交进仓库。

## 构建流程与模式

跑 `npm run build` 即执行 `build.mjs`，按顺序做六件事：

1. 读 `data/editions/`（群聊日报）、`data/external-editions/`（外部资讯）和 `data/weekly-editions/`（周报），校验后合并。
2. 读资料库、机会、群聊黑话和搜索同义词表，校验关键词与别名有没有冲突。
3. 按命令行参数决定读不读活跃榜快照（见下表）。
4. 写出轻量索引 `dist/data.js` 和按天拆开的 `dist/issues/<date>.js`。
5. 把 `site/` 下的静态文件拷进 `dist/`，给每个 JS/CSS 引用挂上内容哈希 `?v=`。
6. 生成每一期的静态深链目录、周报页、资料库页、黑话页、搜索页、`llms.txt` 等 Agent 文件、Atom/JSON 订阅源以及检索目录。

常用的几种构建参数：

| 命令 | 输出目录 | 什么时候用 |
|---|---|---|
| `npm run build` | `dist/` | 日常本地构建，包含全部文章与资料，但不带活跃榜 |
| `npm run build -- --public` | `dist/` | 线上正式构建：带上 `data/public-activity/` 活跃榜、注入浏览统计脚本，并把 Agent 读取链接切到 Worker 的 `/read/`。GitHub Actions 部署只用这个模式 |
| `npm run build -- --draft <issues.json>` | `dist-preview/` | 审稿阶段预览还没入库的群稿批次（可接着加 `--draft-activity` 和 `--draft-external`） |
| `npm run build -- --local-activity` | `dist-preview/` | 在维护者本机预览 `scratch/activity/` 里的完整活跃榜 |

公开构建会读环境变量 `FEEDBACK_API_URL`（反馈 Worker 的 HTTPS 根地址）。本地构建不设这个变量时，点赞点踩只存在浏览器 `localStorage` 里，票数显示“—”。

## 构建出来的 `dist/` 里有什么

| 路径 | 内容 |
|---|---|
| `index.html`、`data.js`、`issues/<date>.js` | 首页、全站刊期索引、按天拆分的具体正文 |
| `daily/<date>/<group-N \| external>/index.html` | 每天各群与外部资讯的独立深链页面 |
| `rank/week/`、`rank/month/`、`rank/all/` | 社区周榜、月榜、总榜页面 |
| `weekly/index.html`、`weekly/<起>/<止>/<版面>/` | 周报跳转入口与各版静态页 |
| `library/`、`glossary/`、`search/` | 资料库（含页底机会区）、群聊黑话、全站搜索 |
| `llms.txt`、`index.md`、`agents/` 等 | 给 Agent 读取的纯文本、Markdown 和 JSON |
| `feed.json`、`feed.xml` | 最近 30 期日报与周报的 JSON Feed 和 Atom 订阅源 |
| `404.html`、`robots.txt` | 404 页面与爬虫规则 |
| `icons.js`、`screenshot.js`、`export-images.js`、`skins.css` | 打包好的按需 Lucide 图标、长图截图库、本地头像 base64 包与皮肤样式 |

### 为什么分成 `data.js` 和 `issues/<date>.js`

如果把所有往期正文全塞进一个 `data.js`，刊期越多首页打开越慢。所以现在 `dist/data.js` 只存目录索引（每天有哪些版面、报头是什么、有没有稿、内容版本号是多少），真正的文章、锐评和讨论节选按天放在 `dist/issues/<date>.js` 里。

- 打开某一天的深链页时，HTML 会直接预加载当天的 `issues/<date>.js`；在页面上切到别的日期时，[`site/app.js`](../site/app.js) 再按需拉取对应日期的脚本。
- 周报单期体量更大，直接内嵌在各自的 `weekly/<起>/<止>/<版面>/index.html` 里，不进 `data.js`。
- 在 Node 脚本里如果要一次读出 `dist/` 的完整数据，调 [`lib/built-data.mjs`](../lib/built-data.mjs) 的 `readBuiltData(dist)` 即可。

### 静态深链与 404

GitHub Pages 没有后端路由，为了让 `daily/2026-10-25/group-2/` 这种地址能直接点开和刷新，[`lib/route-pages.mjs`](../lib/route-pages.mjs) 会在构建时把每个日期、每个版面的目录和 `index.html` 都实打实写出来，并把里面的相对路径（`agenthub-root` meta）算好。当天没稿的群也会生成一个壳页面，点进去时前端会自动切到当天第一个有稿的版面。

访问不存在的路径时，GitHub Pages 会返回 `404.html`（状态码 404）。因为 404 可能发生在任意层级目录下，`404.html` 把样式全内联了，链接也全部写成带 `/newspaper/` 前缀的绝对路径。

## 页面层级关系

```text
AgentHub 日报 /newspaper/
├── 日报      daily/<date>/<group-N | external>/   ← 首页默认展示最新一期
│   ├── 原始讨论浮窗   #discussion-N
│   └── 往期目录弹层   点刊头日期或“往期目录”打开
├── 周报      weekly/ → weekly/<起>/<止>/<版面>/
├── 活跃榜    rank/<week | month | all>/[<group-N>/]
├── 资料库    library/（底部 #opportunities 是招聘与活动机会）
├── 群聊黑话  glossary/
├── 全站搜索  search/
└── Agent 入口 llms.txt、index.md、agents/SKILL.md、feed.xml ...
```

## 群列表与站点地址

- 群列表唯一来源是 [`lib/groups.mjs`](../lib/groups.mjs)：定义每个群的 `id`、名称 `label`、开始采集的日期 `from`、是否出读者版面 `page` 以及版面起始日 `pageFrom`。加新群只改这一个文件。
- 站点地址集中在 [`lib/site.mjs`](../lib/site.mjs)。因为 `site/` 下的浏览器脚本不走打包器编译，里面保留了几处域名和路径字面量，`test/site.test.mjs` 会在每次测试时核对它们和 `lib/site.mjs` 是否一致。

## 给 Agent 读的导出文件与查询接口

构建时 [`lib/agent-docs.mjs`](../lib/agent-docs.mjs) 和 [`lib/agents-render.mjs`](../lib/agents-render.mjs) 会生成一整套纯文本与 Markdown/JSON 文件（`llms.txt`、`llms-full.txt`、`index.md`、`daily/<date>/index.md`、`weekly/<起>/<止>/index.md`、`agents/SKILL.md`、`agents/topics/*.md`、`library/resources.json` 等）。

- 这些文件只含正文摘要、AI 锐评和公开链接，不带原始讨论原话、成员头像和活跃榜（`test/build.mjs` 会专门检查）。
- 公开构建会把 `llms.txt` 和 `agents/SKILL.md` 里的读取地址指到 Worker 的 `/read/...` 路由，用来按小时统计被读取的次数；直接访问 GitHub Pages 上的原始 `.md` / `.json` 地址也一样能读。
- 注意用 `curl` 或 Python 调 Worker 查询接口传中文参数时，要经过 URL 百分号编码（比如 `curl -G --data-urlencode`），直接发裸中文字符会被 Cloudflare 边缘节点拦成空响应的 HTTP 400。

## 搜索引擎收录开关

全站默认不让搜索引擎抓取：[`lib/seo.mjs`](../lib/seo.mjs) 里的 `INDEXED` 目前是空数组，所有页面都会带上 `noindex,nofollow`，也不生成 `sitemap.xml`。只有将来经维护者同意把某个栏目加进 `INDEXED`，构建时才会给对应栏目放开收录并输出 `sitemap.xml`。
