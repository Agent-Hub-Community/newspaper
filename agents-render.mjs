// Writes the "给 Agent 用" page and every machine-readable copy of the site (see agent-docs.mjs).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  AGENTS_PAGE, agentsUrl, dailyMarkdown, dailyMarkdownPath, indexMarkdown, llmsFullTxt, llmsTxt, siteSkill, skillUrl, weeklyMarkdown, weeklyMarkdownPath,
} from './agent-docs.mjs';
import { libraryUrl } from './library.mjs';
import { site } from './site.mjs';
import { esc, favicon, footer, sectionNav } from './library-render.mjs';
import { headTags, sitemap } from './seo.mjs';
import { weeklyRoute } from './weekly-editions.mjs';
import { readingLinks, readingNotice, libraryQueryGuide } from './agent-reading.mjs';

const readable = page => [page.stories, page.trends, page.papers].some(items => items?.some(entry => typeof entry.text === 'string' && entry.text.trim()));

function command(id, text) {
  return `<div class="command"><pre><code id="${id}">${esc(text)}</code></pre><button type="button" class="copy" data-copy="${id}">复制</button></div>`;
}

export function renderAgentsPage({ latest, libraryCount, prefix = '../', assets = {}, publicBuild = false, dailyHref, weeklyHref }) {
  const asset = file => `${prefix}${file}${assets[file] ? `?v=${assets[file]}` : ''}`;
  const scripts = ["'self'", ...(publicBuild ? ['https://static.cloudflareinsights.com/beacon.min.js'] : [])];
  const connections = publicBuild ? 'https://cloudflareinsights.com' : "'none'";
  const prompts = [
    ['prompt-recent', '最近聊了什么', `读取 ${site}index.md ，找到最新三期 AgentHub 日报并逐期读取，告诉我群里最近讨论的重点和分歧，每条附上日报网页链接。`],
    ['prompt-day', '某一天', `读取 ${site}${dailyMarkdownPath(latest)} ，分群总结这一天 AgentHub 群里的讨论，每群不超过三句。`],
    ['prompt-library', '找资料', `读取 ${libraryUrl}resources.json ，帮我找 AgentHub 群里分享过的 computer use 评测，列出标题、一句话简介和链接。`],
    ['prompt-skills', '装群里分享过的 skill', `读取 ${libraryUrl}resources.json ，列出 AgentHub 群里分享过、关键词含 agent skills 的条目和它们的仓库链接；等我选定后，再按那个仓库自己的说明帮我安装。`],
  ];
  const files = [
    ['llms.txt', 'llms.txt', '从这里开始：站点说明和所有入口'],
    ['index.md', 'index.md', '全部日报、周报和资料库的 Markdown 地址'],
    [dailyMarkdownPath(latest), `daily/${latest}/index.md`, '某一天的日报，换个日期就能读别的天'],
    ['library/resources.json', 'library/resources.json', `资料库全部 ${libraryCount} 项`],
    ['glossary/glossary.json', 'glossary/glossary.json', '群聊黑话词典'],
    ['llms-full.txt', 'llms-full.txt', '最近 7 期日报、最新一期周报和资料库，合成一个文件'],
    ['agents/SKILL.md', 'agents/SKILL.md', 'AgentHub skill'],
  ];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
    `<meta name="referrer" content="no-referrer"><meta name="agenthub-root" content="${esc(prefix)}">` +
    headTags({ section: 'agents', title: '给 Agent 用 · AgentHub', url: agentsUrl, llms: `${prefix}llms.txt`,
      description: '让 agent 读 AgentHub 的日报、周报和资料库，也可以装成 Claude Code 或 Codex 的 skill。' }) +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; script-src ${scripts.join(' ')}; style-src 'self'; img-src 'self' data:; connect-src ${connections}; object-src 'none'; base-uri 'none'">` +
    `<link rel="canonical" href="${esc(agentsUrl)}"><title>给 Agent 用 · AgentHub</title><link rel="icon" href="${favicon}"><script src="${esc(asset('appearance.js'))}"></script>` +
    `<link rel="stylesheet" href="${esc(asset('weekly.css'))}"><link rel="stylesheet" href="${esc(asset('library.css'))}"><link rel="stylesheet" href="${esc(asset('color-scheme.css'))}"></head>` +
    `<body data-page="agents"><a class="skip" href="#content">跳至正文</a><div class="shell">` +
    `<header class="masthead"><div class="masthead-main"><a class="wordmark" href="${esc(prefix)}" translate="no">AgentHub<span>给 Agent 用</span></a><p class="issue-date"><span class="period">${esc(latest.replaceAll('-', '.'))}</span><small>最新一期日报</small></p></div></header>` +
    sectionNav(prefix, 'agents', { dailyHref, weeklyHref }) +
    `<main id="content" class="agents-page"><header class="heading"><p class="kicker">机器可读</p><h1>让 agent 直接读日报、周报和资料库</h1>` +
    `<p class="intro">每期日报、周报和资料库都有 Markdown 或 JSON 版，内容和网页一样，agent 直接读就行。文件里没有聊天原话和头像，也看不出谁说了什么。</p></header>` +
    `<section class="agents" aria-labelledby="prompt-title"><h2 id="prompt-title">复制一句话</h2><p>发给能联网的 agent，比如 Claude、ChatGPT、Codex、Kimi：</p>` +
    prompts.map(([id, label, text]) => `<h3>${esc(label)}</h3>${command(id, text)}`).join('') + `</section>` +
    `<section class="agents" aria-labelledby="skill-title"><h2 id="skill-title">装成 Skill</h2>` +
    `<p>把这段发给 Claude Code、Codex 或其他能读写本机文件的 agent，它会自己装好。之后新开一个会话，直接问“群里这周在聊什么”“有人分享过 agentic RL 框架吗”，它会自己去读。</p>` +
    command('install-skill', `把 AgentHub 装成你的 skill：下载 ${skillUrl} ，原样保存为你的用户级 skills 目录下的 agenthub/SKILL.md（Claude Code 是 ~/.claude/skills/agenthub/SKILL.md，Codex 是 ~/.agents/skills/agenthub/SKILL.md）。目录不存在就新建，已有旧版就覆盖，不要改文件内容。装好后告诉我保存路径，并用一句话说明这个 skill 做什么。`) +
    `<p>skill 里只写了去哪儿读，内容每次现读，所以不用更新。想自己装，下载 <a class="inline-link" href="SKILL.md">SKILL.md</a> 放进 skills 目录下的 agenthub 文件夹。</p></section>` +
    `<section class="agents" aria-labelledby="files-title"><h2 id="files-title">文件</h2><ul class="agent-files">` +
    files.map(([href, label, text]) => `<li><a href="${esc(prefix + href)}">${esc(label)}</a><span>${esc(text)}</span></li>`).join('') +
    `</ul><p>周报在 weekly/起始日期/结束日期/index.md，具体地址见 index.md。每个网页的 head 里也有指向对应 Markdown 的 <code>rel="alternate"</code> 链接。</p></section></main>` +
    footer('给 Agent 用', '内容与网页一致，正文用角色代称群友。') + `</div>` +
    `<script src="${esc(asset('copy.js'))}"></script>${publicBuild ? `<script defer src="${esc(asset('analytics.js'))}"></script>` : ''}</body></html>`;
}

export async function writeAgentFiles(out, { data, library, glossary, publicBuild = false }) {
  const publish = text => publicBuild ? readingLinks(text) + readingNotice : text;
  const issues = data.digests.filter(issue => issue.pages.some(readable));
  for (const issue of issues) {
    await mkdir(path.join(out, 'daily', issue.date), { recursive: true });
    await writeFile(path.join(out, dailyMarkdownPath(issue.date)), publish(dailyMarkdown(issue)));
    for (const page of issue.pages.filter(readable)) {
      await mkdir(path.join(out, 'daily', issue.date, page.id), { recursive: true });
      await writeFile(path.join(out, dailyMarkdownPath(issue.date, page.id)), publish(dailyMarkdown(issue, page.id)));
    }
  }
  for (const issue of data.weeklies) {
    await mkdir(path.dirname(path.join(out, weeklyMarkdownPath(issue))), { recursive: true });
    await writeFile(path.join(out, weeklyMarkdownPath(issue)), publish(weeklyMarkdown(issue)));
  }
  // The query guide appears once per file: llms.txt places it before the file list, the index after it.
  await writeFile(path.join(out, 'index.md'), publish(indexMarkdown(data, library, glossary) + (publicBuild ? libraryQueryGuide : '')));
  await writeFile(path.join(out, 'llms.txt'), publish(llmsTxt(data, library, glossary, { publicBuild })));
  await writeFile(path.join(out, 'llms-full.txt'), publish(llmsFullTxt(data, library, glossary, 7, { publicBuild })));
  await mkdir(path.join(out, 'agents'), { recursive: true });
  await writeFile(path.join(out, 'agents/SKILL.md'), publish(siteSkill({ publicBuild })));
  if (AGENTS_PAGE) await writeAgentsPage(out, { data, library, issues, publicBuild });
  const map = sitemap([
    { section: 'home', url: site, lastmod: issues.at(-1).date },
    ...issues.flatMap(issue => issue.pages.filter(readable).map(page => ({ section: 'daily', url: `${site}daily/${issue.date}/${page.id}/`, lastmod: issue.date }))),
    ...data.weeklies.flatMap(issue => issue.pages.map(page => ({ section: 'weekly', url: `${site}${weeklyRoute(issue, page.id)}`, lastmod: issue.end }))),
    { section: 'library', url: libraryUrl, lastmod: library.through },
    { section: 'glossary', url: `${site}glossary/`, lastmod: glossary.through },
    ...(AGENTS_PAGE ? [{ section: 'agents', url: agentsUrl }] : []),
  ]);
  if (map) await writeFile(path.join(out, 'sitemap.xml'), map);
}

async function writeAgentsPage(out, { data, library, issues, publicBuild }) {
  const assets = {};
  for (const file of ['weekly.css', 'library.css', 'copy.js', 'appearance.js', 'color-scheme.css', ...(publicBuild ? ['analytics.js'] : [])]) {
    assets[file] = createHash('sha256').update(await readFile(path.join(out, file))).digest('hex').slice(0, 16);
  }
  const latestWeekly = data.weeklies.at(-1);
  const weeklyPage = latestWeekly?.pages.find(page => page.id === 'group-3')?.id || latestWeekly?.pages[0]?.id;
  await writeFile(path.join(out, 'agents/index.html'), renderAgentsPage({
    latest: issues.at(-1).date, libraryCount: library.items.length, assets, publicBuild,
    dailyHref: '../', weeklyHref: latestWeekly ? `../${weeklyRoute(latestWeekly, weeklyPage)}` : '../',
  }));
}
