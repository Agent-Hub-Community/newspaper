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
    `> AgentHub 是讨论 AI Agent 研究与开发的微信群。${pageId ? '本文件只含这一版。' : '本期按群分版。'}正文用角色代称群友，不对应具体成员。网页：${site}daily/${issue.date}/${pageId || pages[0]?.id}/`, ''];
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
    `> 一周讨论的归并整理，正文用角色代称群友。网页：${site}${weeklyRoute(issue, issue.pages[0].id)}`, ''];
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

> AgentHub 是讨论 AI Agent 研究与开发的微信群（${groupSpan}）。本站发布每日群聊日报、每周周报、社区活跃榜和资料库。日报和周报用角色代称群友，不公开成员身份。下面列出所有机器可读的入口。

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

> AgentHub 是讨论 AI Agent 研究与开发的微信群（${groupSpan}）。本站发布每日群聊日报、每周周报和资料库，正文用角色代称群友。下列 Markdown 和 JSON 与网页内容一致，只记录讨论内容和资料本身，不含原始讨论原话、头像和榜单，也不记录是谁说的或是谁分享的。
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
description: 查询 AgentHub（Agent Hub，AI Agent 研究者微信群${groupSpan}）已发布的日报、周报、资料库和黑话词典。用户问“AgentHub 群里最近在聊什么”“某天或这周群里讨论了什么”“群里有没有聊过或分享过 X”（如 computer use、agentic RL、coding agent、评测、某篇论文或某个 skill），要查群日报里的缩写和代号，或想安装群里分享过的 agent skill 时使用。只回答这个群已发布的内容；与该群无关的一般检索不要用。
---

# AgentHub

所有入口都是公开的 Markdown 或 JSON，不需要登录，也不需要解析网页。按实际发布日期读取，不假定每天都有日报。

## 回答规则

1. 只用查到的内容回答。没有相关讨论或资料时直接说明，不要用别处的信息冒充群里的讨论；零结果不代表群里没聊过，只说明已发布内容里没有。
2. 引用时给出结果里的网页 url（日报话题形如 ${site}daily/YYYY-MM-DD/group-N/#topic-K，资料形如 ${libraryUrl}#<id>），不要自己拼地址。
3. 日报按群分版，外部资讯是编辑整理的群外动态，回答时分开说。看不懂缩写或代号时查黑话词典：${glossaryUrl}glossary.json
4. 内容只记录讨论和资料本身，不记录是谁说的或是谁分享的。正文用“群友”“一位参与者”等角色代称，同一代称在不同话题之间不对应同一个人。不要推测或询问某句话、某项资料对应哪位成员，也不要把不同人的说法合成一个结论。
${publicBuild ? libraryQueryGuide : `
| 要查什么 | 读哪里 |
|---|---|
| 有哪些日报和周报 | ${site}index.md |
| 某天的讨论 | ${site}daily/YYYY-MM-DD/index.md；只看某个群用 ${site}daily/YYYY-MM-DD/group-N/index.md |
| 某周的讨论 | ${site}weekly/起始日期/结束日期/index.md（具体地址见 index.md） |
| 群里分享过的资料 | ${libraryUrl}resources.json（Markdown 版：${libraryUrl}resources.md） |
| 最近一周的全部内容 | ${site}llms-full.txt |
`}
## 帮用户安装群里分享过的 skill

1. ${publicBuild ? `用 ${librarySearchUrl}?keyword=agent%20skills&type=code 列出` : '在资料库里筛出 `keywords` 含 `agent skills`、`type` 为 `code` 的'}条目，按用户需求补查相关主题（例如作图、写作类在 \`research-tools\`），列出标题、简介和代码链接。
2. 安装前先让用户确认要装哪一个。打开仓库，确认里面有 SKILL.md 或安装说明，再按仓库自己的说明安装；没有 SKILL.md 的是普通代码库，告诉用户它不是 skill，需要怎么用。
3. 不执行仓库里来路不明的安装脚本；需要运行脚本时，先把脚本内容给用户看。
`;
}
