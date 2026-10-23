# 架构

本文说明仓库的各部分怎样配合：构建脚本读取 `data/` 下的读者数据，生成纯静态网站，GitHub Pages 托管网站，Cloudflare Worker 负责赞踩、统计和查询接口。

```text
data/ (读者数据) ──┐
site/ (浏览器端) ──┼──► build.mjs ──► dist/ ──► GitHub Actions ──► GitHub Pages
lib/  (Node 模块) ─┘        │                                          │
                            └─ search/catalog.json 等 ──► feedback/ Worker ◄── 读者浏览器、agent
```

图：构建和运行时的数据流。网站本身是静态文件，Worker 从已发布的网站读取查询数据。

## 目录

| 目录 | 内容 |
|---|---|
| `site/` | 浏览器端文件：`index.html`、`404.html`、前端 `.js`、`.css` 和 `skins/`。构建时原样复制到 `dist/` |
| `lib/` | Node 模块：读数据、校验、渲染静态页面和给 agent 用的文件。站点地址在 `lib/site.mjs` |
| `data/` | 审核后的读者数据，见 [数据格式](data-format.md) |
| `build.mjs` | 构建入口 |
| `scripts/` | 命令行脚本：入库、预览、登记和统计，见 [发布流程](publishing.md) |
| `feedback/` | 反馈 Worker（Cloudflare Workers + D1），见 [feedback/README.md](../feedback/README.md) |
| `test/` | 单元测试和浏览器测试，见 [测试](testing.md) |
| `bench/` | 查询接口的小型基准，见 [bench/agent-api/README.md](../bench/agent-api/README.md) |

`scratch/`、`dist/`、`dist-preview/` 和 `output/` 被 Git 忽略。`scratch/` 放维护者的私有批次数据，不提交。

## 构建

`npm run build` 运行 `build.mjs`。构建步骤：

1. 读取 `data/editions/`、`data/external-editions/` 和 `data/weekly-editions/`，校验并合并成刊期列表。
2. 读取资料库、机会、黑话和同义词表，校验关键词和别名。
3. 按构建模式读取榜单快照（见下表）。
4. 写出 `data.js` 索引和每期的 `issues/<date>.js`。
5. 复制 `site/` 下的浏览器端文件，给每个资源加上内容哈希 `?v=`。
6. 写出深链目录、周报、资料库、黑话、搜索页、给 agent 用的文件、订阅源和查询目录。

构建模式：

| 命令 | 输出目录 | 用途 |
|---|---|---|
| `npm run build` | `dist/` | 普通构建。读取全部读者数据，不含活跃榜 |
| `npm run build -- --public` | `dist/` | 公开构建。另外读取 `data/public-activity/` 的榜单快照，生成统计加载器，并把给 agent 用的文件指向查询接口。部署只用这个模式 |
| `npm run build -- --draft <issues.json>` | `dist-preview/` | 把还没入库的批次合进预览。不能与 `--public` 或 `--local-activity` 同用 |
| `--draft-activity <snapshot.json>` | `dist-preview/` | 与 `--draft` 同用，预览批次的榜单快照 |
| `--draft-external <稿件> <selection.json>` | `dist-preview/` | 与 `--draft` 同用，合入已审的外部资讯草稿 |
| `npm run build -- --local-activity` | `dist-preview/` | 读取 `scratch/activity/` 里的本地完整榜单。只在维护者本机有数据 |

公开构建读取环境变量 `FEEDBACK_API_URL`：反馈 Worker 的 HTTPS 源地址，不带路径。没有设置时，赞踩只保存在本机，计数显示“—”。

## 构建产物

| 路径 | 内容 |
|---|---|
| `index.html`、`data.js`、`issues/<date>.js` | 日报首页、索引和每期正文 |
| `daily/<date>/<版面>/index.html` | 日报深链页，版面是 `group-N` 或 `external` |
| `rank/week/`、`rank/month/`、`rank/all/` | 活跃榜 |
| `weekly/index.html`、`weekly/<起始>/<结束>/<版面>/` | 周报入口和各版静态页 |
| `library/`、`glossary/`、`search/` | 资料库（含机会）、黑话、全站搜索 |
| `llms.txt`、`index.md`、`agents/` 等 | 给 agent 用的文件，见下文 |
| `feed.json`、`feed.xml` | 订阅源 |
| `404.html`、`robots.txt` | 缺失路径页和爬虫规则 |
| `icons.js`、`screenshot.js`、`export-images.js`、`skins.css` | 构建生成的图标包、截图库、长图用图片和皮肤样式 |

### data.js 索引和按需加载的正文

`dist/data.js` 只是索引：每期的日期、各版 id、名称、是否有稿、报头和正文版本号，以及活跃榜和皮肤配置。
每期正文写在 `dist/issues/<date>.js`，文件名不变，版本号是内容哈希的前 16 位。

- 深链页预载本期正文。切换日期时，[`site/app.js`](../site/app.js) 按需加载并显示加载状态，失败时提供“重新加载”。
- 周报正文只在各自的静态页里，不进 `data.js`。
- 这样 `data.js` 的大小不随刊期线性增长。
- Node 端用 [`lib/built-data.mjs`](../lib/built-data.mjs) 的 `readBuiltData(dist)` 还原完整数据。[`scripts/feedback-catalog.mjs`](../scripts/feedback-catalog.mjs) 和发布核验都走这条路径。

### 静态深链目录

构建为每期输出 `daily/<date>/group-N/index.html` 和 `daily/<date>/external/index.html`，为榜单输出 `rank/week/`、`rank/month/` 和 `rank/all/`。GitHub Pages 可以直接打开或刷新这些地址。

- 缺稿版面仍生成壳页面，由运行时的版面选择逻辑回退。
- 旧的 hash 导航继续兼容，`#topic-N` 用于页内定位，查询参数保留。
- [`lib/route-pages.mjs`](../lib/route-pages.mjs) 的 `writeRoutePages(out, data)` 在根页资源加上哈希以后运行。它复用这些哈希，并给深链页的脚本和样式路径加上回到资源根的相对前缀。
- 日报深链页只预载本期的 `issues/<date>.js`，榜单页不预载正文。
- `agenthub-root` meta 在根页为 `./`，日报页为 `../../../`，榜单页为 `../../`。页面不使用 `base` 元素。
- 每页的 canonical 指向 `lib/site.mjs` 中 `site` 下对应的目录。

### 404 页

`basePath` 下不存在的路径由 `404.html` 处理。GitHub Pages 原样返回这个文件，状态码是 404。
这个页面可能出现在任意深度的路径上，所以样式内联、不加载脚本，链接写成以 `basePath` 开头的绝对路径。

### 图标

`icons.js` 由 [`lib/icons.mjs`](../lib/icons.mjs) 在构建时生成，只包含源码里出现的 Lucide 图标（约 5 KB，完整的包约 600 KB）。
新增图标时，把名字写成字面量（`data-lucide="name"` 或查找表里的字符串），构建会自动收录。写错名字会让构建失败。

## 页面关系

```text
AgentHub 日报 /newspaper/
├── 日报      daily/<date>/<group-N | external>/   ← 首页打开最新一期
│   ├── 原始讨论面板   #discussion-N（同一页内）
│   └── 往期目录       刊头日期或“往期目录”
├── 周报      weekly/ → weekly/<起始>/<结束>/<版面>/
├── 活跃榜    rank/<week | month | all>/[<group-N>/]
├── 资料库    library/        机会在页面底部 #opportunities
├── 黑话      glossary/
├── 搜索      search/
└── 给 agent 用的文件   llms.txt、index.md、agents/SKILL.md、feed.xml ...
```

图：网站的页面层级。日报、周报、活跃榜、资料库、黑话共用同一套刊头和栏目导航。

## 群列表

[`lib/groups.mjs`](../lib/groups.mjs) 是群列表的唯一来源。每个群有 `id`、读者名称 `label`、`from`（采集起始日期）、`page`（是否有读者版面）和可选的 `pageFrom`（读者版面起始日期）。
打包、榜单和页面都读这份列表，脚本里不要另写一份。

- `collectedGroups(date)` 返回当天要采集的群，`pageGroups(date)` 返回当天有读者版面的群。
- `page: false` 的群照常采集和生成草稿，成员也计入社区榜，但不进 `issues.json`，没有读者版面。
- 新群在 `pageFrom` 之前只计入社区榜。历史刊期不补造新群的稿件或路径。

## 站点地址

站点地址集中在 [`lib/site.mjs`](../lib/site.mjs)：`origin`、`basePath`，以及两者拼成的 `site`。Node 端模块、构建和 Worker 都从这里取地址。

浏览器端文件不经过构建步骤加载，所以保留地址的字面副本：

- `site/app.js` 的 canonical 基址；
- `site/analytics.js`、`site/search-tracking.js` 和 `site/views.js` 的域名和路径；
- `site/404.html` 的链接。

[`test/site.test.mjs`](../test/site.test.mjs) 检查这些副本与 `lib/site.mjs` 一致。改域名或路径时，同时改这些文件和 Worker 的 `ALLOWED_ORIGIN`（[`feedback/wrangler.jsonc`](../feedback/wrangler.jsonc)）。

## 给 agent 用的文件

[`lib/agent-docs.mjs`](../lib/agent-docs.mjs) 生成文本，[`lib/agents-render.mjs`](../lib/agents-render.mjs) 写文件。构建输出：

| 文件 | 内容 |
|---|---|
| `llms.txt` | 站点说明、查询接口（公开构建）和全部入口。大文件列在 `## Optional` 下 |
| `llms-full.txt` | 资料库、最新一期周报和最近 7 期日报的全文 |
| `index.md` | 全部日报、周报和资料库的 Markdown 地址 |
| `daily/<date>/index.md` | 当天各群和外部资讯的摘要、AI 锐评和资料链接 |
| `weekly/<起始>/<结束>/index.md` | 周报全文 |
| `agents/SKILL.md` | 全站 skill。回答规则在前，公开构建附查询接口说明 |
| `agents/topics/` | 每个话题和资料的单独读取文件，供查询接口返回 |
| `library/resources.json`、`library/resources.md` | 资料库 |
| `library/opportunities.json`、`library/opportunities.md` | 机会，带发布日期、截止日期和是否开放 |
| `glossary/glossary.json`、`glossary/glossary.md` | 群聊黑话 |
| `search/catalog.json`、`search/vectors.*` | 查询接口的目录和语义向量 |
| `feed.json`、`feed.xml` | 订阅源（JSON Feed 1.1 和 Atom），最近 30 期日报和周报 |

这些文件与网页内容一致，但不含原始讨论原话、头像和榜单。[`test/build.mjs`](../test/build.mjs) 检查日报 Markdown 里没有讨论原话。

- 每个网页的 head 有指向对应 Markdown 的 `rel="alternate"`，也声明两个订阅源。
- 接口示例一律写成百分号编码的 ASCII，或用 `curl -G --data-urlencode`。curl 和 Python 直接发中文时，Cloudflare 边缘会返回正文为空的 HTTP 400。`test/build.mjs` 检查这一点。
- 公开构建把 `llms.txt`、`index.md` 和 Skill 里的读取链接指向 Worker 的 `/read/` 入口，用于按小时统计读取次数。直接读取 GitHub Pages 上的原地址也可以，但不计数。

“给 Agent 用”页面（`agents/index.html`）目前暂停上线。开关是 `lib/agent-docs.mjs` 的 `AGENTS_PAGE`，现在为 `false`：构建不写这个页面，任何页面和文件都不链接它；其余文件照常生成。改成 `true` 即恢复，入口是栏目导航最后一项。

查询接口（`/content/search`、`/content/edition`、`/content/item`、`/library/search` 等）的参数、排序、错误码和统计字段见 [feedback/README.md](../feedback/README.md)。

## 搜索引擎收录

每页都有描述、Open Graph 和 JSON-LD：首页是 `WebSite`，日报和周报是 `Article`，资料库是 `Dataset`。

是否允许收录由 [`lib/seo.mjs`](../lib/seo.mjs) 的 `INDEXED` 决定。它目前为空，所以所有页面都是 `noindex,nofollow`，也不生成 `sitemap.xml`。`test/build.mjs` 在 `INDEXED` 为空时逐页检查。

把栏目加进 `INDEXED` 后，构建会生成只含这些栏目的 `sitemap.xml`，资料库页另加 `noimageindex`。改动 `INDEXED` 需要维护者授权，见 [CONTRIBUTING.md](../CONTRIBUTING.md)。
网站是 GitHub Pages 的项目站点，`basePath` 下的 `robots.txt` 和 `sitemap.xml` 不会被搜索引擎自动读取，需要在组织主页仓库根目录的 `robots.txt` 里引用 sitemap，或在搜索引擎后台提交。

## 反馈 Worker 与统计

[`feedback/`](../feedback/README.md) 是一个 Cloudflare Workers + D1 服务。它提供：

- 赞踩和资料库点心；
- 原始讨论打开数；
- 站内搜索记录和接口搜索记录；
- 第一方浏览量统计；
- `/read/` 读取统计；
- 公开的内容查询接口。

浏览器端的规则：

- 本地预览支持赞、踩、取消和本机保存，不上报，也不显示虚构的票数。
- 只有设置了 `FEEDBACK_API_URL` 的公开构建才请求 Worker。取不到计数时显示“—”。
- 站点有第一方浏览量统计，只在正式站点上报。各项统计存什么、不存什么，见 [feedback/README.md](../feedback/README.md)。
