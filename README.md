# AgentHub 日报

AgentHub 日报是 Agent Hub 社群的日报网站。Agent Hub 是几个讨论 AI Agent 的微信群，成员主要是研究者和开发者。
网站把群里的讨论整理成静态页面，部署在 GitHub Pages：

https://agent-hub-community.github.io/newspaper/

网站有这些栏目：

| 栏目 | 内容 |
|---|---|
| 日报 | 每个群一版群聊选编。每条有标题、带重点的正文、AI 锐评、资料链接和赞踩；部分话题附匿名的原始讨论节选。 |
| 外部资讯 | 与群聊版面并列的一版，收录当天 AI 与科技行业的重要新闻，每条保留原始出处。 |
| 周报 | 按自然周汇总各群讨论和外部资讯。 |
| 资料库 | 群里分享过、有长期参考价值的论文、代码、数据集、评测、模型、工具和文章。页面底部的“机会”区收录招聘、活动和征稿。 |
| 群聊黑话 | 群里常用的缩写、代号、梗和行话。 |
| 活跃榜 | 各群日榜和社区周榜、月榜、总榜，只显示名次和头像。 |
| 全站搜索 | 在浏览器里搜索日报、周报、外部资讯的动向观察和资料库。 |
| 给 agent 用的文件和接口 | 每期的 Markdown、`llms.txt`、全站 skill、订阅源和公开查询接口。 |

## 仓库范围

本仓库包含网站代码、读者数据、模型写稿和入库发布脚本、反馈 Worker、测试和部署流程。

读者数据只包含审核后公开的内容：日报、周报、外部资讯、资料库、机会、黑话、榜单快照和审核过的头像。
原始聊天记录、群 ID、成员身份映射，以及读取聊天记录和附件的采集脚本都不在本仓库，由维护者在私有环境里运行。
写稿批次的原始输入、模型原稿和审稿记录放在被 Git 忽略的 `scratch/` 目录，不提交。

```text
维护者的私有环境                    本仓库
群聊记录 ──► 采集脚本 ──► scratch/<批次>/ ──► 模型写稿 ──► 编辑审稿 ──► 本地预览
                                                                    │
                                                  scripts/publish-reviewed-batch.mjs
                                                                    ▼
                         editions/、public-activity/ ──► GitHub Actions ──► GitHub Pages
```

图：一期日报从采集到上线的数据流。只有审核后的读者字段进入仓库。

## 目录结构

| 路径 | 内容 |
|---|---|
| `build.mjs` | 构建入口：读读者数据，生成 `dist/` |
| `site.mjs` | 站点地址：`origin`、`basePath` 和 `site` |
| `groups.mjs` | 群列表：id、读者名称、采集起始日期、是否有读者版面 |
| `index.html`、`app.js`、`digest.js`、`routes.js`、`style.css`、`daily.css` | 日报页面、版面导航和排版 |
| `discussion-panel.js`、`discussion-panel.css` | 原始讨论阅读面板，日报和周报共用 |
| `ranking.js`、`feedback.js`、`share-image.js` | 活跃榜、赞踩、保存本版长图 |
| `weekly-editions.mjs`、`weekly-render.mjs`、`weekly-reader.js`、`weekly.css` | 周报 |
| `library*.mjs`、`library.js`、`library.css`、`opportunities.mjs` | 资料库和机会 |
| `glossary.mjs`、`glossary-render.mjs` | 黑话词典 |
| `search-render.mjs`、`search.js`、`bm25.js`、`query.js`、`synonyms.mjs` | 全站搜索 |
| `agent-docs.mjs`、`agents-render.mjs`、`agent-reading.mjs`、`feed.mjs`、`copy.js` | 给 agent 用的文件和订阅源 |
| `seo.mjs` | 页面描述、Open Graph、JSON-LD 和收录开关 |
| `skins/`、`skins.js`、`appearance.js` | 节日皮肤和明暗模式，见 [`skins/README.md`](skins/README.md) |
| `content.mjs`、`llm.mjs` | 模型输入的清理规则；模型和端点设置 |
| `prompts/` | 写稿 prompt。`prompts/trials/` 是试验稿 |
| `scripts/` | 写稿、审稿、打包、入库和统计脚本 |
| `feedback/` | 反馈 Worker：赞踩、讨论打开数、搜索统计、读取统计和公开查询接口，见 [`feedback/README.md`](feedback/README.md) |
| `test/` | 单元测试和浏览器测试 |
| `bench/` | 查询接口的小型基准 |
| `editions/` | 已发布的群聊日报。线上内容以这里为准 |
| `external-editions/` | 已发布的外部资讯 |
| `weekly-editions/`、`weekly-assets/` | 已发布的周报和周榜头像 |
| `library.json`、`library-avatars/`、`library-keywords.json` | 资料库数据、分享人头像和关键词别名 |
| `opportunities.json`、`glossary.json`、`search-synonyms.json` | 机会、黑话和普通同义词表 |
| `public-activity/` | 审核后的活跃榜快照和头像 |
| `semantic-vectors.json` | 查询接口语义检索用的文档向量 |
| [`EXTERNAL_WORKFLOW.md`](EXTERNAL_WORKFLOW.md) | 外部资讯的采集、写稿和审稿流程 |
| [`LIBRARY_REVIEW.md`](LIBRARY_REVIEW.md)、[`OPPORTUNITY_REVIEW.md`](OPPORTUNITY_REVIEW.md)、[`GLOSSARY_REVIEW.md`](GLOSSARY_REVIEW.md) | 资料库、机会和黑话的审核规范 |
| [`PRODUCT.md`](PRODUCT.md) | 产品定位和设计原则 |

## 本地构建与预览

构建需要 Node.js 22 和 npm：

```sh
npm ci
npm run build
```

构建完成后直接打开 `dist/index.html`。预览不需要服务器、账号或网络连接。

| 命令 | 输出目录 | 说明 |
|---|---|---|
| `npm run build` | `dist/` | 普通构建。读取 `editions/`、`external-editions/`、`weekly-editions/` 和资料库等读者数据，不含活跃榜。 |
| `npm run build -- --public` | `dist/` | 公开构建。另外读取 `public-activity/` 的榜单快照，生成访问统计加载器，并把给 agent 用的文件指向查询接口。部署只能用这个模式。 |
| `npm run build -- --draft <issues.json>` | `dist-preview/` | 把还没入库的批次合进预览。不能与 `--public` 或 `--local-activity` 同用。 |
| `--draft-activity <snapshot.json>` | `dist-preview/` | 与 `--draft` 同用，预览批次的榜单快照。 |
| `--draft-external <稿件> <selection.json>` | `dist-preview/` | 与 `--draft` 同用，在构建时合入已审的外部资讯草稿。 |
| `npm run build -- --local-activity` | `dist-preview/` | 读取 `scratch/activity/` 里的本地完整榜单。只在维护者本机有数据。 |

公开构建读取环境变量 `FEEDBACK_API_URL`（反馈 Worker 的 HTTPS 源地址，不带路径）。
没有设置时，赞踩只保存在本机，计数显示“—”。

预览一个审核中的批次，用 `scripts/prepare-preview.mjs`：

```sh
node scripts/prepare-preview.mjs --date D --batch B [--external-draft E --external-selection S]
```

这个脚本带 `--draft-external` 调用 `build.mjs`，断言构建结果与审核输入一致，再把预览复制到批次目录的 `preview/` 下。
不要手改 `dist-preview/data.js`。

## 测试

```sh
npm test
npm run test:browser
```

- `npm test` 运行 `test/*.test.mjs` 单元测试。CI 也运行它。
- `npm run test:browser` 用本机 Chrome 和 devDependencies 里固定版本的 Playwright 运行浏览器测试。
  它先用普通构建运行页面、响应式、导航、资料、赞踩、资料库、404、皮肤和明暗测试，
  再用公开构建运行 `ranking-page` 和 `share-image-browser`。结束时 `dist/` 是公开构建。
- CI 不运行浏览器测试。改动界面时，请在本机运行。
- 测试默认使用 macOS 的 Chrome 路径。其他系统用 `CHROME_PATH` 指定，例如 `CHROME_PATH=/usr/bin/google-chrome npm run test:browser`。
- `AGENT_HUB_SITE_URL` 让 `browser` 和 `ranking-page` 检查已部署的页面。`node test/resources-browser.mjs --production` 检查线上的资料链接。
- `BROWSER=webkit node test/share-image-browser.mjs` 用 Safari 引擎检查长图。`node test/cross-engine.mjs` 在 WebKit 中检查六种尺寸，需要先安装 Playwright WebKit。

注意：截至 2026-10-15，`browser`、`responsive`、`resources-browser`、`external-page`、`ranking-page`、`color-scheme-browser` 和 `skins-browser`
里还有早于当前界面的断言（三列布局、hash 路由、三个群时的页签数、虚拟时钟下的皮肤切换等）。
这些测试失败时，先在改动前的提交上对照，不要据此回退界面。
`date-navigation`、`mobile-navigation`、`feedback-browser`、`four-groups-browser`、`share-image-browser` 已与当前界面对齐。

其他测试：

- `npm run test:date-navigation` 检查日期导航和响应式交互。
- `node test/responsive.mjs` 检查对齐、溢出、触控目标和滑动方向，截图写入被忽略的 `output/playwright/responsive/`。
- `node test/mobile-navigation.mjs` 检查深链、浏览历史、字号放大、日期底部弹层和焦点。
- `node test/not-found-browser.mjs` 按 GitHub Pages 的规则用 `404.html` 响应缺失路径，检查渲染、站外请求和返回按钮。
- `node test/build.mjs` 检查构建产物；加 `--public` 检查公开构建，加 `--preview` 检查 `dist-preview/`。
- `node test/discussion-browser.mjs` 检查讨论面板。先设置 `VERIFY_SITE` 和 `DISCUSSION_DATE`。默认检查二到四群，`DISCUSSION_GROUPS=group-5` 可单独检查五群。
- `daily-preview`、`five-day-preview`、`month-preview` 需要 `scratch/` 里的批次数据。
- `feedback-live` 会向线上提交并撤回一张测试票。只在需要验证线上写入时运行。

浏览器测试覆盖 32 组手机和平板横竖屏及断点尺寸、桌面宽屏、日报翻版、日期目录和旧路由回退。
模拟器和无头浏览器的结果不等于微信内置浏览器的真机验收。

## 数据边界

- 读者数据不含群 ID、消息 ID、微信 ID、联系方式、附件密钥和常见令牌。写稿规则要求正文不写群友的姓名和昵称，用“群友”等代称。
- 原始讨论节选（`discussion` 字段）只有匿名编号 `speaker`、`time`、`text` 和可选的 `quote`。
  编号只在一个话题内对应同一位发言者，不跨话题关联身份。节选保留原话：发言者匿名，不等于正文已脱敏。
- 原始聊天、身份映射和完整统计不进仓库。构建只读取审核后的读者字段，不提供完整聊天档案。
- 活跃榜只公开名次、头像和覆盖范围。分数和原始统计不进仓库，构建时也从浏览器数据里删掉计分明细。
- 头像仍能认出人，所以榜单和资料库的头像不算匿名化。头像逐张审核后才进入仓库，文件名是图片内容的哈希。
- 资料库公开标题、简介、关键词、链接、分享日期、群和审核过的分享人头像；头像只在网页上出现，JSON 和 Markdown 只有日期和群。
- 群聊图片只在维护者本机解密，交给模型写客观描述。描述只进私有输入和模型请求，不作为群友原话进入讨论面板。
- 写稿前，`content.mjs` 去掉模型输入里的媒体密钥、常见 URL 令牌和微信 ID，保留化名和引用上下文。模型不联网补充事实。
- 公开构建应使用 `--public`。不要部署不带这个参数生成的目录。

读者内容的使用条件见 [`CONTENT-NOTICE.md`](CONTENT-NOTICE.md)。

## 网站与界面

### 日报版面

每期包含 `pageGroups(date)` 返回的各群版面和同日外部资讯。每版有标题、正文、独立的 AI 锐评、资料入口。

- 群稿按讨论深度排序：实质追问、观点分歧、具体证据和推理靠前，轻分享靠后。不按题材或消息量排序。
- 条数和篇幅由材料决定，不设统一的字数或条数上限。核心讨论保留依据、条件和未决问题，短讯写短。
- 群稿统一等宽双列，700px 及以下单列，标题在正文上方，长讨论保留自然段。外部资讯和周报使用各自的布局。
- 采集失败或核验后没有合格条目时，保留已完成的内容并说明缺口。不复用旧日新闻，也不补造稿件。
- 外部资讯版的标题概括当期主要动态，日期单独显示。资料链接和动向观察随稿件保留，不显示群活跃榜。
- 切换日期时优先保留当前版面；当前版面缺稿时，选择当天第一个有稿的版面。整期无稿的日期置灰并跳过。
- 缺稿版面的按钮置灰，标“暂无稿件”，键盘切群跳过它。直接打开缺稿版面的链接时，页面换到当天有稿的版面并更新地址；整天无稿的历史链接保留原日期，如实显示空状态。

刊头和周报、资料库是同一套：左边“AgentHub | 日报”，右边日期和星期，手机上也在同一行。
`daily.css` 末尾的刊头规则照搬 `weekly.css` 各宽度的数值。
换期只有一个入口：点刊头日期，或点桌面的“往期目录”。往期列表按月分组，每期一行：日期和星期、当前群那一期的标题和当天有稿的群。
当天当前群无稿时，标题换成第一个有稿群的标题，并注明本群无稿。列表顶部是上一期和下一期。

### 群列表

`groups.mjs` 是群列表的唯一来源。每个群有 `id`、读者名称、`from`（采集起始日期）、`page`（是否有读者版面）和可选的 `pageFrom`（读者版面起始日期）。
打包、榜单和页面都读这份列表。不要在脚本里另写一份。

`page: false` 的群照常采集和生成草稿，成员也计入社区周榜、月榜和总榜，但不进 `issues.json`，也没有读者版面。
`prepare-week-d.mjs package` 按 `pageGroups(date)` 过滤。五群 2026-10-16 起计入社区榜，2026-10-20 起有读者版面；历史刊期不补造五群稿件或路径。
`daily.css` 的 `[data-page-count="6"]` 支持手机上的六版导航。每期整合后，请检查 320px 和 390px 宽度。

### 原始讨论面板

编辑核对原始消息后，才给话题附加 `discussion` 字段。有这个字段的话题，在正文下显示一行“原始讨论 N 条 · M 人”按钮；没有这个字段的刊期不显示入口。
外部资讯不显示这个入口。保存长图时仍导出摘要。周报使用同一个面板。

面板由 `discussion-panel.js` 实现：

- 宽度 900px 以上，面板是居中的跨页，最宽 1180px。左栏约占 37%（340–440px），是编辑导读：版面、话题序号、标题、带重点的正文、AI 锐评、资料链接，底部切换话题。
  右栏顶部写条数、人数和时间段，聊天记录居中、最宽 680px，末尾标出“以上是全部 N 条消息”。
- 宽度 701–899px，面板从右侧滑出，宽 640px。700px 及以下全屏。这两种宽度把导读折叠在聊天上方。
- 页面通过 `configure({ topic })` 传入导读内容。重点规则与正文相同。
- 正文位置不动。关闭按钮、Esc、遮罩和系统返回键都关闭面板，并把焦点还给按钮。
- 打开时地址追加 `#discussion-N`（`file://` 预览只记历史状态），可以直接分享和刷新。切换话题用 `replaceState`，所以返回一次就回到正文。各话题记住聊天的阅读位置。

聊天记录的显示规则：

- 同一人的连续消息共用发言头，每条是一个气泡，气泡底色是发言人颜色的浅色。匿名编号配固定颜色。手机正文用 16px 字号。
- 周报跨天时，在新一天开始处显示日期分隔线。发言头只显示时刻，完整日期写在每条消息的读屏标签里。
- 引用压成“↩ 群友 N：引文”，最多两行，去掉导出的“[引用]”前缀。能唯一匹配节选中较早的原消息时，点击定位并短暂高亮，离开视野后底部出现“回到引用处”。确定不了原消息时，点击展开完整引文。
- “[文件]”显示文件名和大小。“[表情]”“[媒体引用未解析]”等显示为浅色标签，自定义表情包不展示。
- “[旺柴]”“[捂脸]”等微信内置表情码显示为最接近的 Unicode 表情，由系统字体绘制，不用微信原图。悬停显示原代码，读屏读中文名。映射表以外的短代码保持浅色文字。

### 网址和资料卡片

- 微信导出的“[链接] 标题 / 来源 / 摘要 / URL”显示为卡片：来源、标题和摘要，整卡可点。
- 整条消息只有网址（加空白或标点）时，算一次链接分享，每个网址显示为同样的卡片。来源写站点名，子域名退到主域名（如 zhuanlan.zhihu.com 写“知乎”）；标题写 arXiv 编号、GitHub 仓库或网址路径；网站首页的来源写“网站”。没有引文的这类消息不套发言气泡。
- 网址夹在正文里时留在原位置，显示为域名加路径的短链接，过长时截断。完整地址在链接和悬停提示里，前后标点不变。
- 带账号密码，或带 token、key 等查询参数的网址保持纯文本。
- 引文是按钮，不能嵌链接。引文里的网址只显示域名和路径的文字，过长时截断。
- 导读、日报文章页和周报文章页的相关资料统一为卡片：类型图标、名称、域名和外链箭头。图标由 `AgentHubDiscussion.resourceKind()` 决定：github.com 显示代码，arxiv.org 显示论文，其余按 `kind` 归类（周报的 `kind` 是自由填写的，如 `repo`、`wechat`）。资料栏宽于 686px 时，卡片排成两列。

### 重点规则

每条正文的 `emphasis` 数组列出要加粗的原文片段。模型先选，编辑再逐条审核、补全或替换。最终标注属于编辑审核，不冒充模型原始输出。

- 每个承载独立判断、机制、分歧或限制的自然段，通常选 1 处。短文通常选 1 到 2 处。只做背景或过渡的段落可以不标，不能因为条目靠后就漏标。
- 片段应精确匹配正文、只出现一次、互不重叠，也不跨自然段。合计不超过正文的 30%。
- 不整段涂满，不只标名词。保留必要的限定，不把未核实的说法当作确定事实突出。扫读重点应能抓住主要进展，不能只看到使用限制。
- 生成器校验以上条件，失败就报错，不截短也不自动替换模型的选择。
- 渲染时只把精确匹配的片段转义后包成 `strong`，不解析模型给出的 HTML 或 Markdown。
- 日报和周报都用浅色底线加适度加粗，标记在换行处逐行延续，深色主题用较暗的底色。原始讨论保留原话，不加编辑重点。

### AI 锐评

每条的 `aiComment` 是独立的 AI 编辑观点，以“AI 锐评”显示在正文后、赞踩前。它不代表群友共识，也不是来源证据。
`prompts/daily-comment.md` 控制语气和事实边界。生成后先审阅，再按正文版本 ID 精确合并：缺条、重复，或正文改过后的旧评论都会报错。
空白日期不硬补评论。赞踩针对整条内容，新增评论不重置已有票数。

`prompts/trials/comments/` 保存六个候选方向。`scripts/generate-comments.mjs` 的第三个参数可以指定 prompt；省略时使用 `prompts/daily-comment.md`：

```sh
node scripts/generate-comments.mjs scratch/day-2026-09-25/issues.json scratch/comments-a.json prompts/trials/comments/a-conversation.md
```

候选允许短回复，校验下限是 6 个字。结构校验通过，不代表评论可靠或有趣，事实和文风仍要人工审阅。

### 活跃榜

“活跃榜”是独立栏目（`ranking.js`）。标题旁三个按钮切换周榜、月榜和总榜。
面板同时列出全社区（快照顶层的 `ranks`）和各群的前三名：桌面按群数等宽并排，1040px 以下每群一行。
某个群的记录晚于榜单起点时，群名下写“M 月 D 日起”，这就是覆盖说明；截止日期只在刊头显示。
从某群日报点进活跃榜时，网址带上该群（`rank/<周期>/<群>/`），只用来点回日报时回到该群，不做高亮。
手机上，从日报正文后的入口或日期目录进入活跃榜。日报页右上角另有本群日榜，只显示本群前三名的名次和头像，随群和日期切换。

- 榜单统计参与次数，不是内容质量分。周榜按北京时间自然周，月榜按自然月，总榜只代表本地留存期。
- 每次发布新日报，同时更新各群日榜和社区周榜、月榜、总榜，统一截止到内容日期次日零点（北京时间，不含该时刻）。只改旧文案或界面时，不重算榜单。
- 榜单快照由维护者在私有环境里计算，写入批次的 `activity/snapshot.json`。新头像列在 `activity/avatar-review.json` 的 `pending` 里，逐张审阅后清空。确认不了的头像从快照里删掉，页面显示默认头像，名次保留。
- 公开快照只含周榜、月榜、总榜各前三名和已发布日报对应的日榜。成员键重新编号，不含姓名或微信 ID。`scripts/export-public-activity.mjs` 从本地完整统计生成公开快照。
- 微信返回的“暂时无法查看”图片要排除，保留名次并显示默认头像。这种图片不能说明成员已退群。
- 快照是审核后发布的数据。GitHub Actions 不读取任何聊天数据，也不实时更新榜单。

### 保存本版图片

“保存图片”把当前这一版（刊头、日期、群、标题、全部观点和 AI 锐评）渲染成一张 PNG 长图。桌面上按钮在群切换行右侧，手机上在栏目行。
图片在浏览器本地生成，不上传。生成库是固定版本的 modern-screenshot，构建时复制为 `screenshot.js`，第一次保存时才加载；`share-image.js` 负责调用和预览弹窗。

- 页面先复制到屏幕外，再隐藏栏目切换、翻期、往期目录、赞踩和按钮本身，所以读者正在看的页面不重排。页脚的返回顶部按钮换成本版链接，图片被转发后仍能找到原页。
- 头像取自页面已加载的图片像素，不另外请求网络，所以 CSP 的 `connect-src` 不变。用 `file://` 打开时浏览器不允许读取图片像素，图里的头像会留空。
- 桌面浏览器生成后直接下载，文件名形如 `AgentHub日报-2026-09-23-一群.png`。手机用无外框的全屏预览，只有长图区域滚动，关闭和底部操作保持可见。
  支持文件分享的触屏浏览器另外显示“分享图片”，其他浏览器保留下载和长按图片保存。取消系统分享时保留预览；生成失败可以直接重试。
- 图片按 2 倍像素密度输出。总像素超过 1600 万或单边超过 16384px 时，自动降低倍率，避开 iOS Safari 的画布上限。
- 刊头品牌使用 `translate="no"` 和 `notranslate`，避免翻译扩展重复品牌；放大字体时允许自然换行。测试里的原生分享 API 是模拟的，系统分享面板和第三方翻译扩展要在真机上复核。

### 皮肤与明暗

页面默认跟随系统的浅色或深色模式。顶部明暗按钮依次切换跟随系统、浅色和深色，手动选择保存在本地。
节日皮肤是仓库内的插件。每个皮肤都要提供亮、暗两套样式，缺一套时构建失败；活动排期到期后自动恢复常规版。
约定和排期见 [`skins/README.md`](skins/README.md)。本地构建后，用 `dist/index.html?skin=mid-autumn` 预览中秋皮肤，用 `?skin=default` 对照常规版。

## 构建产物与加载

`dist/data.js` 只是索引：每期的日期、各版 id、名称、是否有稿和正文版本号，以及活跃榜和皮肤配置。
每期正文写在 `dist/issues/<date>.js`。深链页预载本期正文；切换日期时，`app.js` 按需加载并显示加载状态，失败时提供“重新加载”。
周报正文只在各自的静态页里，不进 `data.js`。
Node 端用 `built-data.mjs` 的 `readBuiltData(dist)` 还原完整数据，`scripts/feedback-catalog.mjs` 和发布核验都走这条路径。
2026-10-14 改成索引加分期正文后，公开构建的 `data.js` 从约 930 KB 降到约 42 KB，而且不再随刊期线性增长。

`icons.js` 由 `icons.mjs` 在构建时生成，只包含源码里出现的 Lucide 图标（约 5 KB，整包约 600 KB），替换规则与 Lucide 的 `createIcons` 一致。
新增图标时，把名字写成字面量（`data-lucide="name"` 或查找表里的字符串），构建会自动收录；写错名字会让构建失败。

### 静态深链目录

构建为每期输出 `daily/YYYY-MM-DD/group-N/index.html` 和 `daily/YYYY-MM-DD/external/index.html`，榜单输出 `rank/week/`、`rank/month/` 和 `rank/all/`。
GitHub Pages 可以直接打开或刷新这些目录地址。缺稿版面仍生成壳页面，由运行时的版面选择逻辑回退。
旧的 hash 导航继续兼容，`#topic-N` 用于页内定位，查询参数保留。

`route-pages.mjs` 导出 `async writeRoutePages(out, data)`，在根页资源 hash 完成后调用。`out` 可以是文件系统路径字符串，也可以是 `file:` URL。

- 生成器每次读取最新的根页，复用资源 hash，并给深链页的脚本和样式路径加上回到资源根的相对前缀。深层页面的 `.wordmark` 链接也指回资源根。
- 日报深链页只预载本期的 `issues/<date>.js`，榜单页不预载正文。
- `agenthub-root` meta 在根页为 `./`，日报页为 `../../../`，榜单页为 `../../`。页面不加 `base`，CSP 和 `noindex,nofollow` 不变。
- 各页的 canonical 指向 `site.mjs` 中 `site` 下对应的目录。日报页的 title 用版面 heading 和日期。

### 404 页

`basePath` 下不存在的路径由 `404.html` 处理。GitHub Pages 原样返回这个文件，状态码仍是 404。
它可能出现在任意深度的路径上，所以样式内联、不加载脚本，链接写成以 `basePath` 开头的绝对路径。

## 资料库

`/library/` 收录群里分享过、有长期参考价值的论文、代码、数据集、评测、模型、工具和文章。
同一项工作的论文、代码、主页和数据合成一条；几个群分享过也只记一条。

- 数据：`library.json` 是审核后的唯一来源，`library.mjs` 定义类型、主题、链接种类和校验规则。
  每条有 `id`、`title`、`summary`、`type`、`topics`（1 到 3 个）、`keywords`（3 到 12 个）、`links`、
  `aliases`（同一工作的其他地址，用来去重，不显示）和 `shares`（日期、群、头像文件）。
- 头像：每条标出分享人头像和群。头像只出现在网页上，文件名是图片内容的哈希，不含微信 ID。
  头像逐张审核后才进 `library-avatars/`。微信的“暂时无法查看”占位图和未成年人照片要排除，被排除的分享只显示群名。
- 构建输出 `library/index.html`、`library/resources.json` 和 `library/resources.md`，不进 `data.js`。页面在构建时生成全部卡片，筛选和搜索由 `library.js` 在浏览器里做。
- 筛选：主题、类型、关键词（先显示最常见的 16 个）、包含的链接（有代码、有数据等）、来源群和时间。
  一行里什么都不选就是不限。点一下选中，再点一下取消；同一行多选取并集，不同行取交集。
  地址参数是 `topic`、`type`、`kw`、`has`、`group`、`when`、`q`，可以直接分享；`#<id>` 定位到单条资料。
- 卡片：链接是带边框的按钮，写链接种类和网站，悬停显示完整网址。同一条里几个链接在同一网站时，改写各自的路径
  （GitHub 去掉 `tree/<分支>`，过长时保留首尾目录，如 `loopx/…/explore`），让读者分得清。
- 点心：复用赞踩 Worker。投票 ID 是 `feedback-id.mjs` 的 `libraryFeedbackId(id)`，只由 `id` 决定，所以改简介不会清零。
  条目的 `id` 上线后不能再改。页面用 `GET /votes?collection=library&voter=…` 一次读回全部计数，写入用 `PUT /votes`。
  `scripts/feedback-catalog.mjs` 把资料库条目以 `group_id = 'library'` 登记进 D1；没登记的条目显示“—”。

### 更新资料库

1. 维护者用私有采集脚本收集候选，写到 `scratch/library/candidates.json`。候选含私有聊天上下文，只能放在 `scratch/` 下。
2. 按 [`LIBRARY_REVIEW.md`](LIBRARY_REVIEW.md) 审核，结果写到 `scratch/library/curated/*.json`。几十条以内交给一个审核 agent；大批量回补时先预取元数据，分批交给多个 agent，再由主编合并重复、统一写法。
3. 运行 `node scripts/check-library-review.mjs`，确认每个待审候选恰好处理一次。
4. 运行 `node scripts/assemble-library.mjs`。新头像放在 `scratch/library/avatars-pending/`。逐张查看后，把文件名写进 `scratch/library/avatar-review.json` 的 `approved` 或 `rejected`，再运行一次。
   已有条目保留原 `id` 和措辞，只重算分享记录。要改已发布条目的措辞，直接改 `library.json`。
5. 主编通读新条目，核对简介里的数字和说法，去掉标题里的人名和标题党写法。
6. 运行 `npm test`、`npm run build`、`node test/build.mjs` 和 `node test/library-browser.mjs`。

### 机会

资料库页底部的“机会”区收录群里发过的招聘、活动和征稿。这些内容会过期，常常只是一段没有链接的文字，还可能带个人联系方式，
所以单独存在 `opportunities.json`，不进 `library.json`。

- 数据：`opportunities.mjs` 定义字段和校验。每条有 `id`、`kind`（`hiring`、`event`、`cfp`）、`title`、`org` 和 `summary`，招聘另有 `roles`；
  可选 `location`、`deadline`、`event_date`；还有 `topics`、`links` 和 `shares`（日期和群）。
- 隐私：标题、机构、简介和地点不能含邮箱、手机号、微信号，也不能有“加微”“二维码”“私聊我”一类说法，校验会拒绝。条目不写发帖人。
  没有链接的招聘，卡片写“联系方式见 X 群 Y 日的原消息”。
- 时效：卡片右上角写首次分享日期（“发布”），下面一行只写原文给出的截止日期或活动日期；原文没写就写“未写截止日期”。
  开放状态按截止日期或活动日期判断。两者都没写时，最后一次分享满 60 天后移到“已截止”。
  页面的开放状态按构建当天计算，所以没有新刊期时也要每周重建一次。`/content/search` 和 `/content/item` 的 `open` 按请求当天的北京日期重算。
- 构建输出 `library/opportunities.json` 和 `library/opportunities.md`。全站搜索和 `/content/search?kind=opportunity` 都能查到，条目 ID 前缀是 `opportunity:`。

更新步骤：

1. 维护者用私有采集脚本收集候选，写到 `scratch/opportunities/candidates.json`。候选含聊天原文，只能放在 `scratch/` 下。
2. 按 [`OPPORTUNITY_REVIEW.md`](OPPORTUNITY_REVIEW.md) 审核，结果写到 `scratch/opportunities/reviewed.json`。打开公众号原文和官网，核对日期、地点和链接。
3. 运行 `node scripts/assemble-opportunities.mjs`。它检查每个候选恰好处理一次；同一链接再次分享时，只追加分享记录。
4. 运行 `npm test`、`npm run build` 和 `node test/library-browser.mjs`，在页面上看一遍机会区。

## 群聊黑话

`/glossary/` 解释群里常用的缩写、代号、梗、行话和网络用语。`glossary.json` 是审核后的唯一来源，`glossary.mjs` 负责校验。
公司、模型和产品的别称一律收录，包括戏谑和贬义写法；指向具体个人的外号和人名不收。

- 词典也是全站搜索和资料库搜索的词表。分类决定写法是单向还是双向扩展，见“全站搜索”。
- 条目的 `keyword` 指向资料库的规范关键词时，它的写法还会并入该关键词的别名。
- 构建时按全站搜索的排序算出每个词条的结果数。有结果的词条带“站内搜索”链接。页面不显示结果数，因为部分扩展仍有宽松匹配。
- 构建输出 `glossary/index.html`、`glossary/glossary.json` 和 `glossary/glossary.md`。

更新步骤：

1. 维护者用私有采集脚本把一段时间的聊天正文导出到 `scratch/glossary/`。导出时去掉链接、媒体、引用块和 @ 提及，发言人只保留当天的化名。
2. 按 [`GLOSSARY_REVIEW.md`](GLOSSARY_REVIEW.md) 审核。可以让几个审核 agent 分块通读，再让一个长上下文模型通读全部聊天做对照；两种方式都会猜错释义，合并时要核对证据。
3. 主编合并结果，写进 `glossary.json`，然后运行 `npm test` 和 `npm run build`。

## 全站搜索

`/search/` 在浏览器里搜索日报和周报的话题（标题、正文、AI 锐评、资料标签）、外部资讯的动向观察和资料库条目，不含原始讨论的原话。
动向观察的结果链接到当期外部资讯版面的 `#trends-heading`。动向观察不算话题，期刊目录只用 `trend_count` 计数。
`search-render.mjs` 在构建时生成 `search/data.js`（约 650 KB），只有打开搜索页才下载。

排序用 BM25（`bm25.js`，全站搜索和资料库页共用）：

- 中文按相邻两字切词，英文和数字按词切。标题、关键词、正文的权重是 3:2:1。
- 查询不需要空格，也不要求原样出现。命中词按稀有度加权后，至少覆盖查询的四分之一，而且分数不低于第一名的 30%。所以只沾到“模型”这类常见词的内容不会混进来。
- 选了栏目、群或时间筛选时，“第一名”指筛选范围内的第一名。筛选只缩小范围，不会因为范围外有更强的结果而丢掉范围内的匹配。全站搜索页和两个查询接口用这条规则；资料库页的筛选按钮要单独计数，仍在全部资料上搜索后再筛选。
- 疑问词和语气词（怎么、如何、什么、的、吗等）、“群里有没有人聊过”这类问法、英文问句里的 what、does、the 等词都不参与匹配。词表写法里的 of 等词除外。

查询里出现词表中的写法时，搜索另生成一个换成其他写法的查询一起算分。中文写法在句中也能识别，英文写法要整词出现。
`synonyms.mjs` 在构建时合成词表，全站搜索和资料库页共用。词表有三个来源：

- 资料库关键词别名（`library-keywords.json`）和黑话词典的全部写法：单向换成规范关键词或正式名称，按原分计。搜“A社”也会搜 Anthropic。
- 黑话词典里的缩写、行话和网络用语：词条的各个写法和正式名称双向互通，按 0.85 计分。搜“基座模型”也能找到只写“基模”“底模”的内容。
  代号和梗只走单向，搜 Anthropic 不会去搜“人类学”。正式名称列了几个对象的词条（如“OpenAI、Anthropic”）也只走单向。
- `search-synonyms.json`：普通的可互换写法（如“画图／绘图／作图／制图／出图／配图／生图”），双向互通，按 0.85 计分。

词表的维护规则：

- 按 0.85 计分的命中排在原样写法之后。
- 黑话的写法只放在 `glossary.json`。同义词表里再出现同一写法时，构建报错。
- 同义词组含有某个词条的正式名称时（如“基准／Benchmark／评测集”含 benchmark），构建把它和该词条合成一组。合并后每组最多 8 个写法，因为一次查询最多搜 8 个变体。
- 补充同义词时，只收意思基本相同、可以互换的写法。不收上下位词或相关词，不收在群里有歧义的写法（如“代理”在群里多指网络代理）。新词组至少要有两种写法在站内出现过。

换写法的附加规则：

- 换进来的英文名称要命中其中最少见的词，才算匹配。搜“哈基米”（Google Gemini）只列提到 Gemini 的内容，不列所有 Google 新闻。中文名称不用这条规则，因为中文按两字切词，较少见的两字不一定是关键部分（“知识蒸馏”里较少见的是“知识”）。
- 换写法后，查询里没被换掉的词也要单独达到四分之一的覆盖。没有这条时，“Agent 记忆”换成“智能体 记忆”后，只提到智能体、不提记忆的内容也会混进来。
- 站内从未出现的英文词和数字也计入查询权重，所以“dpsk4.1”不会因为只剩“1”可以匹配而列出大量内容。站内没有的中文两字不计入，因为其中很多只是两个词相接（“学习奖励”里的“习奖”）。
- 站内没有的英文词让整条查询零结果时，如果其余词仍占查询权重的一半以上，就去掉这些词再搜一次，接口在 `dropped_terms` 里列出。带数字的词不去掉。
- “GPT-7”“DeepSeek V5”这类名称加版本号的写法，如果站内从没连在一起写过，即使名称和数字分别出现过，也返回零结果。

接口零结果时给出原因（`hint`），可行时给出重试地址（`retry_url`），见 [公开内容查询](feedback/README.md#public-content-query)。
已知局限：换进来的中文描述性名称仍会部分匹配。例如“海模”换成“海外大模型”后，只提到“海外”的内容也会出现。

索引在浏览器空闲时建好（841 条约 0.2 秒），每次查询在几十毫秒以内，查询不上传。默认按相关度排序，可以切换为最新；可以按栏目、版面和时间筛选，状态写在地址参数 `q`、`in`、`g`、`t`、`sort` 里。
入口在桌面和手机的导航栏图标、日报往期目录，以及资料库、黑话和“给 Agent 用”页面。

## 给 agent 用的文件

`agent-docs.mjs` 生成文本，`agents-render.mjs` 写文件。构建输出：

| 文件 | 内容 |
|---|---|
| `llms.txt` | 站点说明、查询接口（公开构建）和全部入口；大文件列在 `## Optional` |
| `llms-full.txt` | 资料库、最新一期周报和最近 7 期日报全文 |
| `index.md` | 全部日报、周报和资料库的 Markdown 地址 |
| `daily/YYYY-MM-DD/index.md` | 当天各群和外部资讯的摘要、AI 锐评和资料链接 |
| `weekly/起始/结束/index.md` | 周报全文 |
| `agents/SKILL.md` | 全站 skill：回答规则在前，公开构建附查询接口说明 |
| `agents/index.html` | “给 Agent 用”页面，复制即用的 prompt；只在 `AGENTS_PAGE` 开启时生成 |
| `library/opportunities.json`、`library/opportunities.md` | 机会，带发布日期、截止日期和是否开放 |
| `glossary/glossary.json`、`glossary/glossary.md` | 群聊黑话 |
| `feed.json`、`feed.xml` | 订阅源（JSON Feed 1.1 和 Atom），最近 30 期日报和周报，每期列出各版标题、网页和 Markdown 地址 |

这些文件与网页内容一致，但不含原始讨论原话、头像和榜单。`test/build.mjs` 检查日报 Markdown 里没有讨论原话。

- 每个网页的 head 有指向对应 Markdown 的 `rel="alternate"`，也用 `rel="alternate"` 声明两个订阅源。
- 查询说明 `libraryQueryGuide` 在每个文件里只出现一次：`llms.txt` 放在文件列表前，`index.md` 和 `SKILL.md` 放在末尾或规则之后。
- 文档里的接口示例一律写成百分号编码的 ASCII，或用 `curl -G --data-urlencode`。curl 和 Python 直接发中文时，Cloudflare 边缘会返回正文为空的 HTTP 400。`test/build.mjs` 检查三个文件里的接口示例都是 ASCII。
- Worker 的根路径 `/` 和 `/llms.txt` 返回一段纯文本说明和 `Link: rel="describedby"`，只拿到 Worker 域名的 agent 也能找到入口。

“给 Agent 用”页面自 2026-10-15 起暂停上线。开关是 `agent-docs.mjs` 的 `AGENTS_PAGE`，现在为 `false`：
构建不写 `agents/index.html`，栏目导航、资料库页、`llms.txt`、`index.md` 和 `sitemap.xml` 都不链接它；其余文件和 `agents/SKILL.md` 照常生成。
关闭时，`test/build.mjs` 逐页检查没有链接指向这个页面。改成 `true` 即恢复：入口是栏目导航最后一项，宽度 700px 及以下隐藏，保存长图时也去掉。
页面的“装成 Skill”给一段发给 agent 的安装提示（下载 `agents/SKILL.md`，存进它自己的 skills 目录），不给 shell 命令。
Claude Code 的用户级目录是 `~/.claude/skills/`，Codex 是 `~/.agents/skills/`（Codex 文档已不再列 `~/.codex/skills/`）。

### 查询接口

公开构建的 `llms.txt`、`index.md` 和 Skill 把文本读取链接指向 Worker 的 `/read/` 入口。这个入口返回 GitHub Pages 上的内容，并在服务端按小时统计请求，保留 30 天。
直接读取 GitHub Pages 上的原地址也可以，但不计数。旧版 Skill 需要重新下载才使用新入口。本地预览不改写链接，网页引用链接仍指向 GitHub Pages。
请求计数不代表人数或读完，客户端类别也不能证明 agent 身份。

- `/library/search` 按 `q`、`type`、`topic`、`keyword` 查询资料库并翻页，无需登录。它只查询已公开的资料库，返回简介、原始链接和相关讨论的读取地址。
  资料库页的“给 Agent 用”区域提供示例请求和可复制的提示词。服务端每五分钟刷新公开数据，接口请求计入读取统计。
- `/content/search` 搜索日报、周报、资料库和机会。它在词面检索之外还用 Workers AI 做语义检索（`query.semantic`、`matched_by`）。
  文档向量由 `scripts/embed-catalog.mjs` 生成并存入 `semantic-vectors.json`。每次发布新内容后、推送前运行一次。浏览器里的全站搜索仍只按词面，查询不上传。
- 两个搜索接口把每次首页查询的脱敏搜索词、筛选、结果数、站内没有的词和客户端类别写进 D1 表 `api_searches`，保留 30 天。

参数、排序、错误和统计字段见 [`feedback/README.md`](feedback/README.md)。

## 搜索引擎收录

每页都有描述、Open Graph 和 JSON-LD：首页是 `WebSite`，日报和周报是 `Article`，资料库是 `Dataset` 并列出 JSON 和 Markdown 下载地址。
是否允许收录由 `seo.mjs` 的 `INDEXED` 决定。它目前为空，所以所有页面都是 `noindex,nofollow`，也不生成 `sitemap.xml`；`test/build.mjs` 在 `INDEXED` 为空时逐页检查。

放开某个栏目时，把它加进 `INDEXED`，构建会生成只含这些栏目的 `sitemap.xml`。资料库页另加 `noimageindex`，头像不进图片搜索。
网站是 GitHub Pages 的项目站点，`basePath` 下的 `robots.txt` 和 `sitemap.xml` 不会被搜索引擎自动读取。
需要在组织主页仓库根目录的 `robots.txt` 里引用 sitemap，或在搜索引擎后台提交。

## 写稿与发布

日报按批次人工生成、审核后发布，仓库里没有定时任务。一个批次是 `scratch/` 下的一个目录，保存原始输入、模型原稿和审稿记录，不提交。

本节说明公开仓库里的步骤。采集和榜单统计需要读取聊天数据，由维护者在私有环境里运行；它们写入批次目录，后续步骤只读批次目录。

```sh
B=scratch/day-YYYY-MM-DD
# 私有步骤：采集各群当天记录和图片描述，写入 $B/<日期>/group-N.input.json
node scripts/prepare-week-d.mjs generate FROM THROUGH "$B" --emphasis
node scripts/prepare-week-d.mjs package FROM THROUGH "$B" --emphasis
node scripts/enrich-month-d.mjs "$B"
node scripts/apply-month-review.mjs "$B" "$B/review.json"
node scripts/month-report.mjs "$B"
node scripts/package-month-resources.mjs "$B" --fetch
# 私有步骤：计算榜单快照，写入 $B/activity/
npm run build -- --draft "$B/issues.json" --draft-activity "$B/activity/snapshot.json"
node test/daily-preview.mjs "$B/issues.json"
node scripts/publish-reviewed-batch.mjs "$B"
```

### 输入

`$B/<日期>/group-N.input.json` 是一个群一天的消息，按北京时间整日截取，分页已读尽。消息只有化名、时间、正文和引用上下文。

图片消息的 `content` 仍是 `[图片]`，模型写的客观描述放在 `image` 字段。描述只写图的类型和与讨论有关的文字、数字，不写人名、昵称、账号、二维码和联系方式。
群稿和周报的生成器发给模型前，才把它换成 `[图片（缩略图）：描述]`。原始讨论面板从 `content` 取原话，仍显示 `[图片]`；面板校验拒绝以 `[图片（` 开头的生成文字。
缩略图描述可能认错小字和数字。审稿时，不要把它当作已核实的事实。

### 1. 生成群稿

`prepare-week-d.mjs generate` 按群并行调用 `scripts/generate-daily-gemini.mjs`，用无工具的 Chat Completions 请求生成正文。

- 模型和端点统一在 `llm.mjs`，都从环境变量读取：`DAILY_LLM_BASE_URL` 是任意 OpenAI 兼容端点（必填），`DAILY_LLM_MODEL` 是该端点上的模型名（默认 `gemini-4-argon`），`DAILY_LLM_API_KEY` 是密钥（端点需要时设置，不写入文件）。
- 生成前，先用最小请求确认模型能正常响应。
- 群稿请求带 `reasoning_effort: high`。当前模型只有 `high` 会推理，`low`、`medium` 和不传参数都不推理。大群一次约 4–5 分钟，用 2–3 万输出 token。
- 网关的输出上限是 32768 token（推理计入），`llm.mjs` 的 `llmMaxOutputTokens` 固定为这个值。请求超过上限时，网关在上限处截断却仍报 `stop`；不超过上限时截断报 `length`，脚本按未完成处理。
- 初稿校验失败时，先带 `--repair-emphasis` 只修重点片段。问题不在重点时，脚本直接拒绝，不调用模型。仍然失败就整次重跑一遍，最终失败记入 `failures.json`。
- 原稿写成 `<群>.draft.json`。旁边的 `.run.json` 记录实际模型、调用方式、用量和耗时，不记录 prompt 或输入哈希。
- prompt 是 `prompts/daily-group.md`。带 `--emphasis` 时再拼上 `prompts/daily-emphasis.md`。批次目录里的 `prompt.md` 是实际发出的组合。
- `--resume` 复用已存在且通过当前输入校验的成功原稿。校验检查结构、证据 ID、资源链接和加粗要求，不检查 prompt 或输入是否改变。prompt 或输入改变时，用新的批次目录，或不带 `--resume`。

`prompts/daily-group.md` 在 2026-10-16 由原先依次拼接的 7 个文件合并改写而成。
其中 `prompts/trials/autonomous/common.md`、`d.md`、`d1.md` 仍供 `scripts/trial-autonomous-daily.mjs` 使用，`prompts/daily-reader-copy.md` 仍供早期的 `scripts/generate-daily.mjs` 使用。
`generate-daily.mjs`、`generate-daily-claude.mjs`、`package-group-daily.mjs` 和 `trial-autonomous-daily.mjs` 是早期试刊用的脚本，保留作对照。

`prepare-week-d.mjs package` 生成 `issues.json`、`manifest.json` 和一份合并原稿，按运行记录标注实际模型。
生成稿通过结构检查，不表示已完成事实核验。

### 2. 补全锐评、报头和重点

`enrich-month-d.mjs` 每 5 期一组，用 `llm.mjs` 的模型生成 AI 锐评、报头和重点短语后合并。重点短语替换生成时同步选的加粗。

- 编辑仍要逐条审核重点，见“重点规则”。
- 报头参考已审定的顺序，选能代表实质交流的主线，不必绑定第一条。有深入讨论的产品话题也可以做报头，不只凭知名度选简单分享。
- 单独检查锐评，不要把不同人的经历拼成同一个事件或因果关系。
- 某一项失败时，单独重跑对应的 `scripts/generate-*.mjs`，再用 `--assemble` 合并。

### 3. 应用审稿

`apply-month-review.mjs` 按标题应用人工审稿的删除或改写。可以传多个审稿文件。结果记在 `review-applied.json`，模型原稿不覆盖。

审稿文件是数组。每项有 `date`、`group`、`title`、`evidenceIds`，再加 `drop`，或 `proposedTitle`、`proposedText`、`proposedComment`。
不带 `title`、带 `heading` 或 `theme` 的项改该版报头。手机首屏要能看到第一段正文；报头和副题过长时，`mobile-navigation` 测试会失败。

审稿改正事实归属、时间、限定条件和隐私方面的错误。不要为了稳妥逐句加限定词，一处不确定只说一次。

### 4. 核对和资料

- `month-report.mjs` 核对每份输入都是整日、分页已读尽，写出整理说明，并给空版填报头。
- `package-month-resources.mjs` 只生成候选的 `resources.json` 和 `resources-audit.json`。`--fetch` 会实际访问链接。
- 把资料并入 `issues.json` 和最后的审稿标记，仓库里还没有通用脚本。请先核对当前字段和资料映射，再为本批写一次性脚本并验收。

### 5. 预览和入库

榜单快照和头像审核完成后，用 `--draft` 和 `--draft-activity` 构建预览，并逐条检查正文、重点和 AI 锐评。不要因为话题多就截断稿件。

`publish-reviewed-batch.mjs` 把批次写入 `editions/` 和 `public-activity/`，并删除快照以外的旧头像文件。它在写入前检查：

- `activity/avatar-review.json` 的 `pending` 已清空。
- 周榜、月榜、总榜都统计到本批最后一天，每个群版面都有当天日榜。
- 批次以外的每个已发布日期，日榜名次和头像文件哈希与现有 `public-activity/` 一致。

任何一项不满足，脚本就报错，不写任何文件。

### 6. 推送前

1. 按 [`feedback/README.md`](feedback/README.md) 登记赞踩目录。标题或正文改过的条目会得到新 ID，旧版本的票数留在 D1 的旧条目上，页面不再显示。
2. 运行公开构建，再运行 `node scripts/embed-catalog.mjs` 更新 `semantic-vectors.json`。这个脚本需要 `CLOUDFLARE_ACCOUNT_ID`，以及 `CLOUDFLARE_API_TOKEN` 或本机的 Wrangler 登录。
3. 运行 `npm test` 和 `node test/build.mjs --public`。

### 外部资讯

外部资讯的采集、选题、写稿、审稿和入库见 [`EXTERNAL_WORKFLOW.md`](EXTERNAL_WORKFLOW.md)。外部资讯不读群聊数据，它的采集脚本 `scripts/collect-external.mjs` 在本仓库。

把已复核并记录审批的外部稿导入，再与同日群稿一起预览：

```sh
E=scratch/external-YYYY-MM-DD   # 外部资讯批次目录
node scripts/import-external-report.mjs "$E/commented-reviewed.json" "$E/selection.json" "$E/commented-review.json"
npm run build -- --draft scratch/day-YYYY-MM-DD/issues.json
node test/external-page.mjs
```

导入只把读者字段写进 `external-editions/YYYY-MM-DD.json`。原始候选、模型响应和审核记录留在 `scratch/`，不进入网页数据。

### 周报

周报写在 `weekly-editions/<起始日>_<结束日>.json`，周榜头像在 `weekly-assets/<周报 id>/avatars/`。`weekly-editions.mjs` 校验字段，`weekly-render.mjs` 生成静态页。
写稿用 `scripts/generate-weekly-gemini.mjs`（prompt 是 `prompts/weekly-editor-gemini.md`），重点用 `scripts/generate-weekly-emphasis.mjs`。
讨论节选由 `weekly-select-discussion.mjs`、`weekly-discussion-evidence.mjs` 和 `weekly-attach-discussions.mjs` 生成：发言者按话题编号，消息 ID 和身份只留在私有审核文件里。
审核后的读者稿用 `scripts/import-reviewed-weekly.mjs` 导入。

## 反馈 Worker 与访问统计

`feedback/` 是一个 Cloudflare Workers + D1 服务。它提供赞踩、资料库点心、讨论打开数、搜索统计、`/read/` 读取统计和公开查询接口。
部署步骤、接口参数和数据保存规则见 [`feedback/README.md`](feedback/README.md)。

- 本地预览支持赞、踩、取消和本机保存，不上报，也不显示虚构的票数。
- 只有公开构建在设置了 `FEEDBACK_API_URL` 时才请求反馈接口。没有取得计数时显示“—”。
- 部署后，可以运行 `node test/feedback-live.mjs --live --production` 验证真实页面。这个检查会提交并撤回一张测试票。

公开构建另外接入 Cloudflare Web Analytics：

- 只有 `--public` 构建生成 `analytics.js`。普通构建和 `--local-activity` 构建不含统计脚本。
- 加载器再检查 HTTPS、正式域名和 `basePath` 前缀。`file://`、localhost、预览域名和同域名的其他项目不会请求 Cloudflare。`analytics.js` 里的 beacon token 为空时，加载器什么也不做。
- CSP 只额外允许官方 beacon 脚本和 `https://cloudflareinsights.com` 上报端点。
- 统计用官方自动 SPA 测量，不发送自定义事件，不调用私有上报 API。不把头像或榜单内容作为统计事件发送。
- 统计是浏览器聚合数据（访问量、浏览量、来源、国家、浏览器、设备类型和性能），不是逐人轨迹或服务器日志。广告拦截器可能阻止上报。GitHub Pages 不经过 Cloudflare 代理。

统计的浏览器测试用正式 URL 配合本地路由响应运行官方脚本，拦截所有上报：

```sh
npm run build -- --public
curl -fsSL https://static.cloudflareinsights.com/beacon.min.js -o /tmp/agenthub-cloudflare-beacon.js
CF_BEACON_FILE=/tmp/agenthub-cloudflare-beacon.js node test/analytics-browser.mjs
```

## 部署

`.github/workflows/deploy.yml` 用 Node.js 22 运行，有两种触发方式：

| 触发 | 步骤 |
|---|---|
| 向 `main` 提 pull request | `npm ci`、`npm test`、`npm run build -- --public`、`node test/build.mjs --public`。不部署。 |
| 推送到 `main` | 同上，然后上传 `dist/` 并部署到 GitHub Pages。 |

要在没有新提交时重新部署（例如刷新按构建日期计算的“开放”机会），在 Actions 页面手动运行这个 workflow，分支选 `main`。
仓库变量 `FEEDBACK_API_URL` 提供反馈 Worker 的地址。只部署 Worker 不会更新网站。

站点地址集中在 `site.mjs`：`origin`、`basePath`，以及两者拼成的 `site`。Node 端模块都从这里取地址。
浏览器端文件（`app.js` 的 canonical 基址、`analytics.js` 和 `search-tracking.js` 的域名与路径、`404.html` 的链接）保留字面副本，`test/site.test.mjs` 检查它们与 `site.mjs` 一致。
改域名或路径时，同时改这些文件和 Worker 的 `ALLOWED_ORIGIN`（`feedback/wrangler.jsonc`）。

只改脚本、测试或文档的提交也会触发部署，但不应改变网页。推送前，在改动前后的提交上分别运行：

```sh
FEEDBACK_API_URL=<反馈 Worker 地址> npm run build -- --public
```

再用 `diff -r` 比较两份 `dist/`。要核对线上版本，比较 `dist/index.html` 和线上首页里各资源的 `?v=` 哈希；完全一致时，部署内容相同。

## 贡献

欢迎通过 issue 和 pull request 参与：

- 发现页面错误，请提 issue。改进界面、搜索、查询接口和测试，可以直接提 pull request。
- 改动界面时，请运行 `npm test` 和 `npm run test:browser`，并附上桌面和手机宽度的截图。
- pull request 会自动运行单元测试和公开构建检查，不运行浏览器测试。
- 只改脚本、测试或文档时，请按“部署”一节确认公开构建不变。
- 新增依赖、改变数据格式或改变数据边界前，请先开 issue 讨论。
- 请不要在 issue 或 pull request 里贴出原始聊天记录、成员身份或任何个人联系方式。
- 发现读者内容有事实错误，或需要删除涉及你本人的内容，请在 GitHub 提 issue，写明页面地址和位置。

日报、周报、资料库等读者内容由维护者按上面的审核流程更新。

## 许可

源代码使用 [MIT 许可](LICENSE)。

读者内容不随 MIT 许可授权，包括 `editions/`、`weekly-editions/`、`external-editions/`、`library.json`、`glossary.json`、`opportunities.json`、
`public-activity/`、`library-avatars/` 和 `weekly-assets/` 等。使用条件见 [`CONTENT-NOTICE.md`](CONTENT-NOTICE.md)。
