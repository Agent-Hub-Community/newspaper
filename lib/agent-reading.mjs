import { site } from './site.mjs';

export const readingBase = 'https://agenthub-feedback.haoqingeric.workers.dev/read/';
// The published site; the Worker fetches the documents it serves from here.
export const contentBase = site;
export const librarySearchUrl = 'https://agenthub-feedback.haoqingeric.workers.dev/library/search';
export const contentAPIBase = 'https://agenthub-feedback.haoqingeric.workers.dev/content/';

// The query section of llms.txt, index.md and SKILL.md in public builds. Examples are percent-encoded:
// curl and Python send a raw Chinese query as bytes the edge rejects with an empty HTTP 400.
const example = encodeURIComponent('科研经验');
export const libraryQueryGuide = `
## 查询接口

无需登录或密钥。地址里的中文和空格需要 URL 编码，直接发裸中文字符会得到正文为空的 HTTP 400。
命令行用 \`curl -G --data-urlencode\`：

\`\`\`bash
curl -fsSG ${contentAPIBase}search --data-urlencode 'q=科研经验' -d limit=5
\`\`\`

| 要做什么 | 请求 |
|---|---|
| 搜讨论话题、动向观察、资料和机会 | GET ${contentAPIBase}search?q=${example}&limit=5 （q=科研经验） |
| 看最新一期日报目录 | GET ${contentAPIBase}edition （周报加 kind=weekly） |
| 看某天的日报目录 | GET ${contentAPIBase}edition?date=YYYY-MM-DD |
| 列已发布的刊期 | GET ${contentAPIBase}editions?kind=daily&limit=5 |
| 按类型、主题、关键词筛资料库 | GET ${librarySearchUrl}?type=benchmark&topic=computer-use&limit=5 |
| 查群里发过的招聘、活动、征稿 | GET ${contentAPIBase}search?kind=opportunity&limit=20 ，全量见 ${readingBase}library/opportunities.json |
| 读单条话题或资料 | 访问返回结果里的 read_url（Markdown）或 detail_url（JSON） |
| 订阅更新 | ${contentBase}feed.json（JSON Feed）或 ${contentBase}feed.xml（Atom） |

### 搜索结果与排序

- 每条结果带 \`title\`、\`date\`、\`group\`、\`excerpt\`、\`relevance\`（0.3 到 1）、\`url\`（网页地址，给用户引用时贴这个）、\`read_url\`（单条 Markdown）和 \`detail_url\`（完整 JSON）。
- 搜索同时跑 BM25 词面匹配和 Workers AI 语义匹配（RRF 融合），\`matched_by\` 标明是 \`words\`、\`meaning\` 还是 \`both\`。
- 群里的缩写、模型代号和同义写法会自动扩展，实际扩展出的词列在 \`query.expanded\`；站内从未出现过的普通英文词会自动剔除重试，列在 \`query.dropped_terms\`。
- 直接用中英文自然语言问句也能搜（“群里有没有人聊过”、\`what\`、\`does\` 等疑问虚词不占权重）。如果搜了站内从未写过的版本号（如 \`GPT-7\`），接口返回 0 条并在 \`known_versions\` 和 \`retry_url\` 里给出站内实际写过的版本。

### 常用参数

- \`/content/search\`：\`q\`（≤120 字）、\`kind\`（\`daily\` / \`weekly\` / \`library\` / \`opportunity\`）、\`group\`（\`group-1\` 到 \`group-5\`，或 \`external\`）、\`from\` 与 \`to\`（\`YYYY-MM-DD\`，含首尾；周报按区间相交匹配）、\`limit\`（1–20，默认 5）、\`offset\`。翻页直接请求返回的 \`next_url\`。
- \`/content/edition\`：\`kind\`（\`daily\` / \`weekly\`）、\`date\`（默认 \`latest\`；周报填周日结束日期）、\`group\`。返回各版面的标题、导语和每条话题的 \`title\` + \`read_url\`，适合先看目录再挑几条细读。如果某天缺刊，404 响应里的 \`nearest.before\` 和 \`nearest.after\` 会给出相邻刊期。
- \`/library/search\`：\`q\`、\`type\`（\`paper\` / \`benchmark\` / \`dataset\` / \`code\` / \`model\` / \`tool\` / \`article\` / \`video\`）、\`topic\`（如 \`coding-agents\`、\`computer-use\`、\`training\` 等，完整枚举见首页响应的 \`available\`）、\`keyword\`（支持别名）。每条资料的 \`discussions\` 列出引用过该链接的日报或周报话题；为空时可顺着 \`discussion_search_url\` 按名称搜讨论。
- 机会（\`kind=opportunity\`）：返回 \`opportunity_kind\`（\`hiring\` / \`event\` / \`cfp\`）、\`first_shared\`（发布日）、\`open\`（按请求当天北京时间计算的开放状态）和 \`closes\`（截止日）。回答时优先列 \`open: true\` 的条目，写清发布日、截止日和官方链接；没有公开链接的内推条目写“联系方式见群里原消息”。
`;

// Only published text exports can pass through the reader, never arbitrary URLs or HTML.
export function readablePath(path) {
  return /^(?:index\.md|llms(?:-full)?\.txt|feed\.json|agents\/SKILL\.md|library\/resources(?:\.schema)?\.json|library\/resources\.md|library\/opportunities\.(?:json|md)|glossary\/glossary\.(?:json|md))$/.test(path)
    || /^search\/(?:catalog|vectors)\.json$/.test(path)
    || /^agents\/topics\/[a-z0-9:-]{1,200}\.(?:json|md)$/.test(path)
    || /^daily\/\d{4}-\d{2}-\d{2}\/(?:group-\d{1,2}\/|external\/)?index\.md$/.test(path)
    || /^weekly\/\d{4}-\d{2}-\d{2}[\/_]\d{4}-\d{2}-\d{2}\/index\.md$/.test(path);
}

// Links to text exports under the site. The Worker bundles this module, and the Pages build runs on Node 22,
// so the site address is escaped by hand rather than with RegExp.escape.
const exportLink = new RegExp(contentBase.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
  + `[^\\s<>"'\`，；（）)\\]]+?\\.(?:md|json|txt)(?=$|[\\s<>"'\`，；（）)\\]#?])`, 'g');

// Keep citations to HTML pages unchanged. Templates in SKILL.md also use the reader.
export function readingLinks(text) {
  return text.replace(exportLink, url => readingBase + url.slice(contentBase.length));
}

export const readingNotice = '';
