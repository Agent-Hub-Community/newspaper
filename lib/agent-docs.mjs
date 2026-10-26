// Machine-readable copies of the site for agents: Markdown per issue, a site index, llms.txt and one skill.
// They carry the published summaries, AI comments and resource links; raw discussion excerpts, avatars and
// rankings stay on the web pages only.
import { LINK_KINDS, libraryMarkdown, libraryUrl, md, readableStories } from './library.mjs';
import { site } from './site.mjs';
import { groupLabels } from './groups.mjs';
import { glossaryMarkdown, glossaryUrl } from './glossary.mjs';
import { weeklyRoute } from './weekly-editions.mjs';
import { libraryQueryGuide, librarySearchUrl, contentAPIBase } from './agent-reading.mjs';
import { groupSpan } from './groups.mjs';

export const agentsUrl = `${site}agents/`;
// The "给 Agent 用" page and every link to it. Off while the page is paused (since 2026-10-15);
// the Markdown copies, llms.txt, llms-full.txt and SKILL.md are still built.
export const AGENTS_PAGE = false;
export const skillUrl = `${agentsUrl}SKILL.md`;
const PAGE_LABELS = { ...groupLabels, external: '外部资讯' };
const readable = page => [page.stories, page.trends, page.papers].some(items => items?.some(entry => typeof entry.text === 'string' && entry.text.trim()));
export const dailyMarkdownPath = (date, page) => `daily/${date}/${page ? `${page}/` : ''}index.md`;
export const weeklyMarkdownPath = issue => `${weeklyRoute(issue, 'x').replace(/x\/$/, '')}index.md`;
const paragraphs = text => String(text).trim().split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
const resourceLine = resources => resources?.length
  ? `资料：${resources.map(resource => `[${md(resource.label || LINK_KINDS[resource.kind] || '链接')}](${resource.url})`).join(' · ')}` : '';

function storyBlock(story, index, url) {
  const lines = [`### ${index + 1}. ${md(story.title)}`, ''];
  for (const part of paragraphs(story.text)) lines.push(md(part), '');
  const comment = story.aiComment || story.review;
  if (comment) lines.push(`AI 锐评：${md(comment)}`, '');
  const resources = resourceLine(story.resources);
  if (resources) lines.push(resources, '');
  lines.push(`网页：${url}`, '');
  return lines;
}

// The whole issue, or one page of it when pageId is given.
export function dailyMarkdown(issue, pageId) {
  const pages = issue.pages.filter(readable).filter(page => !pageId || page.id === pageId);
  const title = pageId ? `${PAGE_LABELS[pageId] || pageId} ` : '';
  const lines = [`# AgentHub 日报 ${issue.date} ${title}`.trimEnd(), '',
    `> AgentHub 是讨论 AI Agent 研究与开发的微信群。${pageId ? '本文件为单版导出。' : '本期按群分版。'}网页：${site}daily/${issue.date}/${pageId || pages[0]?.id}/`, ''];
  for (const page of pages) {
    lines.push(`## ${PAGE_LABELS[page.id] || page.label}：${md(page.heading)}`, '');
    if (page.theme) lines.push(md(page.theme), '');
    readableStories(page).forEach((story, index) => lines.push(...storyBlock(story, index, `${site}daily/${issue.date}/${page.id}/#topic-${index + 1}`)));
    for (const trend of page.trends || []) if (trend.text) lines.push(`- ${trend.title ? `${md(trend.title)}：` : ''}${md(trend.text)}`);
    if (page.trends?.length) lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function weeklyMarkdown(issue) {
  const lines = [`# AgentHub 周报 ${issue.start} 至 ${issue.end}`, '',
    `> 一周讨论与行业动态汇总。网页：${site}${weeklyRoute(issue, issue.pages[0].id)}`, ''];
  for (const page of issue.pages) {
    lines.push(`## ${PAGE_LABELS[page.id] || page.label}：${md(page.title)}`, '');
    if (page.intro) lines.push(md(page.intro), '');
    page.stories.forEach((story, index) => {
      lines.push(...storyBlock(story, index, `${site}${weeklyRoute(issue, page.id)}#topic-${index + 1}`));
      if (story.timeline?.length) lines.splice(lines.length - 2, 0, ...story.timeline.map(step => `- ${step.date}：${md(step.text)}`), '');
    });
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

const readableIssues = data => data.digests.filter(issue => issue.pages.some(readable));

export function indexMarkdown(data, library, glossary) {
  const issues = readableIssues(data).slice().reverse();
  return `# AgentHub

> AgentHub 是讨论 AI Agent 研究与开发的微信群（${groupSpan}）。本站发布每日群聊日报、每周周报、社区活跃榜和资料库。下面列出所有机器可读入口。

${AGENTS_PAGE ? `- 给 Agent 用的说明和 skill：${agentsUrl}\n` : ''}- 资料库（${library.items.length} 项）：${libraryUrl}resources.json 和 ${libraryUrl}resources.md
- 群聊黑话（${glossary.terms.length} 条）：${glossaryUrl}glossary.json 和 ${glossaryUrl}glossary.md
- 最新日报：${issues[0] ? `${site}${dailyMarkdownPath(issues[0].date)}` : '暂无'}

## 周报

${data.weeklies.slice().reverse().map(issue => `- ${issue.start} 至 ${issue.end}：${site}${weeklyMarkdownPath(issue)}`).join('\n')}

## 日报

每期一行是全期文件，下面每行是单个版面的文件和标题。

${issues.map(issue => [`- ${issue.date}：${site}${dailyMarkdownPath(issue.date)}`,
  ...issue.pages.filter(readable).map(page => `  - ${PAGE_LABELS[page.id] || page.label}：${md(page.heading)}　${site}${dailyMarkdownPath(issue.date, page.id)}`)].join('\n')).join('\n')}
`;
}

export function llmsTxt(data, library, glossary, { publicBuild = false } = {}) {
  const latest = readableIssues(data).at(-1);
  return `# AgentHub

> AgentHub 是讨论 AI Agent 研究与开发的微信群（${groupSpan}）。本站发布每日群聊日报、每周周报和资料库。下列 Markdown 和 JSON 与网页内容一致，包含各期讨论摘要、AI 锐评、来源链接、资料库与群聊黑话。
${publicBuild ? libraryQueryGuide : ''}
## 入口

${AGENTS_PAGE ? `- [给 Agent 用](${agentsUrl}): 复制即用的 prompt 和 skill 安装提示\n` : ''}- [AgentHub skill](${skillUrl}): 查询规则和接口说明，可装进 Claude Code（~/.claude/skills/agenthub/SKILL.md）或 Codex（~/.agents/skills/agenthub/SKILL.md）
${publicBuild ? `- [最新日报目录](${contentAPIBase}edition): 先看栏目与话题标题，再沿 read_url 读取正文
- [最新周报目录](${contentAPIBase}edition?kind=weekly): 按栏目浏览一周话题
` : ''}- [最新日报 ${latest?.date || ''}](${latest ? `${site}${dailyMarkdownPath(latest.date)}` : site}): ${groupSpan}和外部资讯
- 日报 Markdown：全期 ${site}daily/YYYY-MM-DD/index.md，单个版面 ${site}daily/YYYY-MM-DD/group-N/index.md（外部资讯为 external）；网页：${site}daily/YYYY-MM-DD/group-N/
- 周报 Markdown：${site}weekly/起始日期/结束日期/index.md

## 资料库与黑话

群里分享过的论文、代码、数据集、评测、模型、工具和文章，共 ${library.items.length} 项，收录 ${library.first} 至 ${library.through} 的分享。群聊黑话共 ${glossary.terms.length} 条，读日报遇到看不懂的缩写、代号和梗时查。

- [黑话 JSON](${glossaryUrl}glossary.json): 写法、别名、释义、类别和指代的正式名称
- [资料库 Markdown](${libraryUrl}resources.md): 按主题分组

## Optional

- [站点索引](${site}index.md): 全部日报、周报和资料库的 Markdown 地址
- [资料库 JSON](${libraryUrl}resources.json): 全部资料的完整字段，约 300 KB；查资料优先用查询接口
- [黑话 Markdown](${glossaryUrl}glossary.md): 按类别分组
- [合集](${site}llms-full.txt): 资料库、最新一期周报和最近 7 期日报的全文，约 500 KB
`;
}

export function llmsFullTxt(data, library, glossary, dailyCount = 7, { publicBuild = false } = {}) {
  const weekly = data.weeklies.at(-1);
  return [
    llmsTxt(data, library, glossary, { publicBuild }).trimEnd(), '', '---', '',
    glossaryMarkdown(glossary).trimEnd(), '', '---', '',
    libraryMarkdown(library).trimEnd(), '', '---', '',
    ...(weekly ? [weeklyMarkdown(weekly).trimEnd(), '', '---', ''] : []),
    ...readableIssues(data).slice(-dailyCount).reverse().flatMap(issue => [dailyMarkdown(issue).trimEnd(), '', '---', '']),
  ].join('\n').replace(/\n---\n\n$/, '\n');
}

export function siteSkill({ publicBuild = false } = {}) {
  return `---
name: agenthub
description: 查询 AgentHub（Agent Hub，讨论 LLM Agent 研究与工程的中文社群，含一群到五群及 AI Safety、Robot、AI4S 垂类专项群）已发布的群聊日报、周报、资料库、招聘／活动机会和群聊黑话词典。当用户问“AgentHub 群里最近在聊什么”“某天或这周群里讨论了什么”“群里有没有聊过或分享过 X”（如 computer use、agentic RL、coding agent、具身智能、AI 安全、AI4Science、评测基准、某篇论文或某个开源项目）、查群日报里的缩写与模型外号、看社区近期招聘／活动／征稿，或想了解 AgentHub 社群网站与日报工作流时使用。
---

# AgentHub 检索与阅读指南

AgentHub 把一群到五群每天的 LLM Agent 研究与工程讨论整理成日报，每周汇总一群到五群及三个垂类专项群（AI Safety、Robot、AI4S）的讨论生成周报，并维护资料库、机会（招聘／活动／征稿）和群聊黑话词典。所有公开接口和导出文件都是现成的 JSON 或 Markdown，无需登录，也不用抓 HTML。

- 线上日报与资料库：${site}
- 社群主页：https://agent-hub-community.github.io/
- 网站源码：https://github.com/Agent-Hub-Community/newspaper
- 采集与写稿工作流：https://github.com/Agent-Hub-Community/bot-workflow

## 怎么查最快

1. 浏览最新一期或某一天聊了什么：先调 ${contentAPIBase}edition （周报加 ?kind=weekly，指定日期加 ?date=YYYY-MM-DD）拿到各群报头和话题标题清单，再顺着感兴趣的 read_url 读单条或单版 Markdown。网页端也可直接打开当期总览页（${site}daily/YYYY-MM-DD/overview/ 或 ${site}weekly/起始日期/结束日期/overview/）一页速览全部版面。
2. 搜某个技术话题、模型或论文讨论：调 ${contentAPIBase}search （支持 BM25 + 语义混合检索，自动扩展群内缩写与外号）。
3. 按类型或方向找论文、开源仓库、benchmark：调 ${librarySearchUrl} 按 type、topic、keyword 筛选。最近几天刚分享的链接如果还没进每周更新的资料库，用 /content/search 搜日报即可补齐。
4. 遇到看不懂的缩写、谐音或代号（如 oai、A社、哈基米、RSI）：查 ${glossaryUrl}glossary.json

## 回答约定

1. 根据实际查到的内容作答；站内没搜到时直接说明未检索到。
2. 每条结论附上结果里的网页 url（日报话题形如 ${site}daily/YYYY-MM-DD/group-N/#topic-K，周报话题形如 ${site}weekly/起始日期/结束日期/group-N/#topic-K，资料形如 ${libraryUrl}#<id>），方便读者点回原页。
3. 区分群内讨论（日报为一群到五群，周报还含 \`group-6\` AI Safety、\`group-7\` Robot、\`group-8\` AI4S）和编辑整理的“外部资讯”版面。正文里的“群友”“分享者”是单条话题内的代称，不同话题之间不对应同一个人。
${publicBuild ? libraryQueryGuide : `
| 要查什么 | 读哪里 |
|---|---|
| 有哪些日报和周报 | ${site}index.md |
| 某天的讨论 | ${site}daily/YYYY-MM-DD/index.md；只看某个群用 ${site}daily/YYYY-MM-DD/group-N/index.md |
| 某周的讨论 | ${site}weekly/起始日期/结束日期/index.md（具体地址见 index.md） |
| 群里分享过的资料 | ${libraryUrl}resources.json（Markdown 版：${libraryUrl}resources.md） |
| 招聘、活动与征稿 | ${libraryUrl}opportunities.json（Markdown 版：${libraryUrl}opportunities.md） |
| 群聊黑话词典 | ${glossaryUrl}glossary.json（Markdown 版：${glossaryUrl}glossary.md） |
| 最近一周合集 | ${site}llms-full.txt |
`}
## 帮用户安装群里分享过的 skill

1. ${publicBuild ? `用 ${librarySearchUrl}?keyword=agent%20skills&type=code 列出` : '在资料库里筛出 `keywords` 含 `agent skills`、`type` 为 `code` 的'}条目，也可按需补查 \`research-tools\`、\`coding-agents\` 等主题，列出标题、一句话简介和仓库地址。
2. 安装前先让用户确认装哪一个。打开对应仓库检查是否有 \`SKILL.md\` 或安装说明；没有 \`SKILL.md\` 的是普通代码库，跟用户说清楚用法即可。
3. 需要运行仓库自带脚本前，先把脚本内容给用户过目。
`;
}
