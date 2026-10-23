# 外部资讯日报工作流

“外部资讯”是与各群版面并列的独立版面。历史刊期保留原有的群覆盖。按刊期日期归档，标题概括当天主要动态，
不写早报。群稿保留各自日期，不为凑版改日期、补造消息或复制旧日内容。

## 默认执行与完成条件

每次生成 AgentHub 日报，都默认执行本工作流，与各群群稿使用同一内容归属日期。
外部资讯是每日交付的必做部分，不需要另行提出，也不能因为没有现成审核稿就留空。
单独修改已有标题、导览文案或界面不触发重新采集；本次任务明确限定范围时除外。

1. 主动采集候选，核对原始来源和事件日期，合并重复事件。
2. 生成并审阅正文、版头、重点短语、资料链接和独立 AI 锐评。
3. 与各群群稿一起交付本地预览，并把外部资讯纳入合并新闻导览。
4. 来源失败时保留成功结果，尝试有界的替代来源；仍受阻则说明实际尝试和缺口。
   核验后没有合格条目可以留空，但未采集、未生成不等于没有可报道内容。

补做历史日期时可用有明确事件日期的原始材料核验，当前热度只能标作当前快照，
不能冒充历史榜位或历史热度。生成、审阅和本地预览不等于入库、公开发布或发送群消息，
这些步骤由维护者另行决定；发布后才使用“已更新”文案及经核对的当期链接。

## 1. 采集候选

外部版覆盖 AI 与科技行业的重要新闻，不限于研究论文和 Agent 工程。先补查重要模型与消费产品发布、
公司战略与合作、融资并购、芯片与算力、政策监管及重大行业事件，再补充研究和开发者工具。
按事件影响、实质变化和证据质量排序，不以研究榜单代替行业新闻覆盖，也不为凑齐类别收录小新闻。
最终只展示一个外部资讯板块，不按内部搜集阶段拆分栏目。条数由独立事件的价值决定，不设固定上限。
行业候选优先核对公司公告、官方产品博客、监管文件等原始来源；可靠媒体用于发现和交叉核验。
未找到合格新闻的类别在私有覆盖记录中注明，不在读者稿中虚构“今日无事件”。

默认同时查最新流和热榜，不能只核验 Top10 中少数原帖后结束：

- AIHOT `/api/v1/items?mode=all&window=7d&by=published&limit=100` 是最新流，
  按响应的 `page.nextCursor` 翻页至目标日开始之前；热榜只补充关注度。
  `publishedAt` 可能是转载时间，仍须回原始作品核验。设置有界页数，未达日期边界须记录缺口。
- X 同时做相关主题搜索与发布者定向搜索；返回可能夹带窗口外帖子，必须再按 `created_at` 过滤。
- HF 同时看 Daily Papers 与博客/社区文章。目标日为空时读最近一个有内容日期，并明确旧论文、新文章和当天传播的区别。
- HN 查 Top、New、Show HN，并读入选讨论的原文。`news.ycombinator.com`、HN 和 YC news 是同一平台，不重复计数。
- 用 Google Research、vLLM、Simon Willison、Latent Space 等补充原创文章；
  低频研究博客按更新或主题补读，不要求每日出稿。

论文双榜交集只是“榜单推荐”的口径，不是全部研究资讯的准入门槛。
作者当天发布的研究介绍、开源实现或新解读可按事件选入，必须保存原文、作者发布时间和论文首发日；
没有双榜证据时不能标作双榜推荐。近期但非当日的好文章另列延伸阅读，不伪装为当日首发。

在仓库根目录执行，日期是内容归属日期，不是生成当天。26日凌晨整理25日新闻仍传25日；
默认主窗口为该日北京时间零点至次日零点，未结束的当天截到采集开始时间：

```sh
B=scratch/external-2026-09-25-run2
node scripts/collect-external.mjs 2026-09-25 "$B"
```

每轮使用新目录。现有脚本只采集基础候选：AIHOT 当前 Top10、HF 内容归属日 Daily Papers、alphaXiv 当前显式榜、
opencli HN Top60 和 X 高互动搜索40条，保存抓取时间及失败状态。
该脚本尚不覆盖上述最新流、HF博客与HN New/Show，必须另行补采并留证后才算完成本节。
这是有界候选集，不是全网完整热榜。AIHOT 为48小时滚动榜，HF 为日期列表；
HN/alpha 当前快照不能用于重建历史榜单。补做历史日报必须使用当时保存的证据，不能拿今天榜位冒充。
某来源失败时命令非零退出但保留其他结果；修复后用新目录采集，或明确记录缺失并缩小报道范围。
没有信号不等于热度为零。opencli 需要本机 Chrome 可用，不在 GitHub Actions 无登录环境自动抓 X。
通用网页搜索使用可靠的搜索工具；已知原文可直接访问。

AIHOT 只用于发现事件及其监测热度，不复制其摘要、数据库或整榜编排。
遵循其缓存、限流与用途规则；持续公开再分发、商业使用等须另行核对授权。
自动脚本单次读取，不自动轮询、绕过限制或安装第三方 Skill。

## 2. 选题与回原文

逐项查看 AIHOT `/api/v1/stories/{publicId}` 时间线里的 original 链接，
补读官方发布、作者原帖和可靠媒体全文。按实际返回的 story URL 获取 publicId，不猜测。
对漏项用 opencli 按官方账号或事件关键词补抓，并保存原始结果。

- 热度看原始榜位、HN分数/评论、X赞/浏览和多来源讨论；不同平台不能加总。
- YC news 与 HN 是同一平台；同事件转载不是独立验证。同事件合并，子功能不重复占版。
- 双榜推荐用ID对齐 HF 与 alphaXiv 各自前五，注明快照口径。无交集不凑榜单；
  独立研究新闻按已核验的作者发布事件选取，不因榜单空缺省略整个研究类别。
- 只读到标题、热度不足、来源不可靠或明显过期的候选不刊，记录理由。
- 旧事件有新进展或持续讨论可以入选，明确原始发生时间，不把新报道当新发生。

把审核后的材料整理进 `selection.json`。一条候选的结构：

```json
{
  "id": "copilot-update",
  "kind": "news",
  "title": "Copilot 更新",
  "timing": "已核验的日期说明",
  "selectionReason": "本轮高关注且有具体产品进展",
  "attention": [{
    "platform": "X",
    "url": "https://x.com/i/status/实际原帖ID",
    "fetchedAt": "实际ISO采集时间",
    "observation": "实际点赞、浏览等快照，注明字段缺失"
  }],
  "sources": [{
    "publisher": "原发布方",
    "url": "https://原文地址",
    "fetchedAt": "实际ISO读取时间",
    "text": "实际读取的原文或忠实摘录，不能填写AIHOT摘要"
  }]
}
```

保留采集生成的 edition、timezone、windowStart、cutoff。论文还需
`"kind":"paper","paperRanks":{"hf":1,"alpha":3}`，数字必须来自真实快照。
`rejected` 保存落选理由，`coverageNotes` 保存来源缺失/口径差异。
采集时间与事件日期分别保存，次日补读的热度快照不能冒充前一日日终热度。
午夜后的后续材料可用于核验前一天事件，但不能作为前一天首次发布的证据。

## 3. Gemini 写稿与审稿

```sh
node scripts/generate-external.mjs "$B/selection.json" "$B/draft.json"
node scripts/generate-external.mjs "$B/selection.json" "$B/draft.json" "$B/review.md"
```

第二行仅在需要修订时执行。模型和端点使用 `llm.mjs` 的统一设置（环境变量
`DAILY_LLM_BASE_URL`、`DAILY_LLM_MODEL`、`DAILY_LLM_API_KEY`），使用 `prompts/external-editor.md`。
不开推理，一期约 1–2 分钟。不切回 Claude、不记录输入或 prompt 哈希。响应与用量留本地，失败不保留旧的成功稿冒充新结果。
argon 偶尔改写重点片段或超出 30% 预算：不合格的片段会被删掉（超预算时先删最长的），原始选择留在
`.response.json`，`.run.json` 的 `emphasisTrimmed` 列出受影响的条目，编辑要为这些条目重新补选重点。

程序检查日期、候选映射、事件去重、链接白名单和加粗片段。人工仍需检查：
事实归因、时间时区、计划/预览/可用状态、指标比较基线、法律范围、旧事件后续，
以及是否把单人观点写成行业共识。链接正确不代表事实审核通过。
正文、标题、观察及强调由 Gemini 生成，编辑意见通过 review.md 反馈修订。

正文确认后，单独生成每条新闻的 AI 锐评：

```sh
node scripts/generate-external-comments.mjs "$B/draft.json" "$B/commented-draft.json"
```

复用 `prompts/daily-comment.md` 和 `llm.mjs` 的模型，只添加 `aiComment`，
保留原稿标题、正文、强调、链接及候选映射。输出必须使用新路径，原稿不覆盖。
逐条检查调侃是否贴合材料、是否虚构事实或强化未经证实的指控。
正文修订后重新生成锐评并复核；响应与用量记录仍只留在本地。
锐评需修订时，可传第三个参数 `"$B/comment-review.md"`，将编辑意见交给 Gemini，
输出使用新的文件名。原版 prompt 不变；审核与导入命令相应使用最终修订稿路径。

## 4. 审核入库

完成逐条审核并获准采用后：

```sh
node scripts/review-external.mjs "$B/commented-draft.json" "$B/selection.json" "$B/commented-review.json" "审核者" --approve
node scripts/import-external-report.mjs "$B/commented-draft.json" "$B/selection.json" "$B/commented-review.json"
npm run build
npm test
```

审批与入库要求每条新闻都有锐评。审批记录绑定含锐评的完整稿件及候选证据，
不使用hash；改文、改锐评或换证据后必须重新审核。
导入只写 `external-editions/YYYY-MM-DD.json` 中的读者字段，内部ID和证据不会进入网页。
这就是并入该日期正式日报内容，三个群仍从 `editions/` 读取。
原始候选、互动数、响应、审批记录留在被忽略的 scratch，不能提交。

需要同时预览未入库群稿时：

```sh
npm run build -- --draft scratch/day-2026-09-25/issues.json
node test/external-page.mjs
```

当前浏览器验收固定检查2026-09-25外部版与同日二、三群回归，后续刊期需同步更新验收日期或另行检查。
检查桌面/手机正文、加粗、可见URL、日期切换、空版和保存图片，并查看截图。

## 5. 发布边界

入库和本地构建不等于线上发布。公开前使用 `npm run build -- --public`、
`node test/build.mjs --public`，并按 `feedback/README.md` 登记新条目赞踩目录。
现有 GitHub Pages workflow 负责构建部署，不运行模型或抓取账号数据。
提交、推送、合并和公开部署由维护者决定；本工作流不自动合并或发布。
已审核并认可的稿件直接入库，不为整理工作流而重新生成。
