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

无需登录或密钥。地址里的中文和空格必须 URL 编码，直接写中文会得到正文为空的 HTTP 400。
命令行用 curl -G 加 --data-urlencode，由 curl 编码：

curl -fsSG ${contentAPIBase}search --data-urlencode 'q=科研经验' -d limit=5

| 要做什么 | 请求 |
|---|---|
| 找群里讨论过的话题和资料 | GET ${contentAPIBase}search?q=${example}&limit=5 （q=科研经验） |
| 浏览最新一期日报 | GET ${contentAPIBase}edition （周报加 kind=weekly） |
| 某天的日报目录 | GET ${contentAPIBase}edition?date=YYYY-MM-DD |
| 有哪些期 | GET ${contentAPIBase}editions?kind=daily&limit=5 |
| 按类型、主题筛资料 | GET ${librarySearchUrl}?type=benchmark&topic=computer-use&limit=5 |
| 群里的招聘、活动、征稿 | GET ${contentAPIBase}search?kind=opportunity&limit=20 ，全部见 ${readingBase}library/opportunities.json |
| 读一个话题 | 结果里的 read_url（Markdown） |
| 订阅新一期 | ${contentBase}feed.json（JSON Feed）或 ${contentBase}feed.xml（Atom） |

### 读搜索结果

每条结果有 title、date、group、excerpt、relevance（与本次最佳结果的相对分，0.3 到 1）、
url（网页地址，引用时用它）、read_url（话题正文 Markdown）和 detail_url（完整 JSON）。
query.expanded 列出同时搜索的别名和同义写法；query.dropped_terms 列出站内从未出现、搜索时去掉的英文词。
零结果时 hint 说明原因；名称加了站内没写过的版本号时，known_versions 列出写过的版本，retry_url 去掉版本号再搜。零结果只说明已发布摘要和资料里没有，不代表群里没聊过。
问句可以直接搜，中文和英文都行，“群里有没有人聊过”和 what、does 这类问法不参与匹配。搜索按词面和语义一起排序，每条结果的 matched_by 说明是按词（words）、按意思（meaning）还是两者都命中（both）；query.semantic 为 unavailable 时只按词面搜。
站内从未出现的写法（例如 RLAIF）搜不到；名称加站内没写过的版本号（例如 GPT-7）也返回零结果。

### 参数

search：q（最多 120 字）、kind（daily、weekly、library）、group（group-1、group-2 这样的群编号，或 external；以 edition 返回的 groups 为准）、
from 和 to（YYYY-MM-DD，含首尾；周报按区间相交）。筛选在排序前生效。资料的群和日期须命中同一次分享，matched_shared 列出这些分享。
edition：kind、date（默认 latest；周报用结束日）、group。缺刊或缺栏目返回 404，不会换成别的日期；按 recovery_url 或 editions 找实际日期。
返回的 groups[].topics[] 只有标题和 read_url；trend_count 是只在整组或整期正文里的“动向观察”段数。
library/search：q、type、topic、keyword（接受别名）；type 和 topic 的取值见响应里的 available。
资料的 discussions 只列出引用了该资料链接的话题；为空不代表没讨论过，再访问 discussion_search_url 按名称搜。
limit 为 1 到 20，默认 5；翻页访问 next_url。HTTP 400 的 param 指出要改的参数；409 表示内容已更新，访问 restart_url；429 表示请求过快，等 60 秒；503 按 Retry-After 重试。
响应里的 today 是北京时间的今天，“昨天”“上周”按它推算；coverage 给出日报、周报和资料库各自覆盖的起止日期，超出范围的日期查不到内容。
缺刊时 edition 的 404 给出 nearest.before 和 nearest.after 两个最近的期。
已知 id 用 GET ${contentAPIBase}item?id=<id> 读取；library/search 结果自带 detail_url。
话题正文是编辑摘要、AI 锐评和来源链接，不是聊天原话。外部资讯的“动向观察”也能搜到，结果带 trend: true。
资料库是另行整理的清单，最近几天的分享可能还没收录；查讨论用 search，不要只查资料库。
机会（kind=opportunity）的结果带 first_shared（发布日期）、open（是否仍开放）和 closes（截止日；没写截止日的按最后一次分享后 60 天算）。回答时只推荐 open 为 true 的，写明发布日期和截止日，并给出官方链接；没有链接的条目写“联系方式见群里原消息”，不要编造联系人。
搜索接口记录每次首页查询的搜索词（明显的邮箱、网址、长数字和令牌会隐藏）、筛选条件、结果数和客户端类别，保留 30 天，用来了解读者关注什么；不记录 IP 或身份。不要在搜索词里放私人信息。
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

export const readingNotice = '\n读取统计：推荐的读取入口按小时汇总文件路径、请求方法、返回状态和客户端类别，保留 30 天。不保存 IP 或完整 User-Agent；请求次数不等于人数，也不能证明读完。直接访问 GitHub Pages 文件不计入这项统计。\n';
