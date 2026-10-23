export const readingBase = 'https://agenthub-feedback.haoqingeric.workers.dev/read/';
export const contentBase = 'https://hqhq1025.github.io/agent_hub/';
export const librarySearchUrl = 'https://agenthub-feedback.haoqingeric.workers.dev/library/search';

export const libraryQueryGuide = `
## 按需查询资料库

优先用公开查询接口查资料，无需登录或密钥，不必先下载整份 JSON：

- GET ${librarySearchUrl}?q=computer%20use&limit=5
- 只看某类资料：${librarySearchUrl}?type=benchmark&topic=computer-use&limit=5
- 查询 Skills：${librarySearchUrl}?keyword=agent%20skills&limit=5

参数 q 是搜索词（最多 120 字符）；type、topic、keyword 是可选筛选，多个条件同时满足。
limit 为 1 到 20，默认 10；offset 从 0 开始。返回 total、items、next_offset；
next_offset 非 null 时，用相同条件和新的 offset 继续查询。数据更新时翻页结果可能变化。
type、topic 的有效取值见响应中的 available。keyword 接受规范关键词或已收录的别名。
有 q 时按相关度排序，否则按资料库的最新分享顺序。
每条 items 包含简介、原始 links、网页 url 和相关 discussions；read_url 可继续读讨论摘要。
接口只查资料库收录的内容，零结果不能证明群里从未讨论过。需要读日报时仍按站点索引查。
接口按请求计数，不保存查询词；客户端类别不能证明 agent 身份。
`;

// Only published text exports can pass through the reader, never arbitrary URLs or HTML.
export function readablePath(path) {
  return /^(?:index\.md|llms(?:-full)?\.txt|agents\/SKILL\.md|library\/resources(?:\.schema)?\.json|library\/resources\.md|glossary\/glossary\.(?:json|md))$/.test(path)
    || /^daily\/\d{4}-\d{2}-\d{2}\/(?:group-[1-4]\/|external\/)?index\.md$/.test(path)
    || /^weekly\/\d{4}-\d{2}-\d{2}[\/_]\d{4}-\d{2}-\d{2}\/index\.md$/.test(path);
}

// Keep citations to HTML pages unchanged. Templates in SKILL.md also use the reader.
export function readingLinks(text) {
  return text.replace(/https:\/\/hqhq1025\.github\.io\/agent_hub\/[^\s<>"'`，；（）)\]]+?\.(?:md|json|txt)(?=$|[\s<>"'`，；（）)\]#?])/g,
    url => readingBase + url.slice(contentBase.length));
}

export const readingNotice = '\n读取统计：推荐的读取入口按小时汇总文件路径、请求方法、返回状态和客户端类别，保留 30 天。不保存 IP 或完整 User-Agent；请求次数不等于人数，也不能证明读完。直接访问 GitHub Pages 文件不计入这项统计。\n';
