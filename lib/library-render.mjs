// Writes the static library page and its agent copies (JSON and Markdown).
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { libraryFeedbackId } from './feedback-id.mjs';
import { weeklyRoute } from './weekly-editions.mjs';
import { headTags } from './seo.mjs';
import { AGENTS_PAGE } from './agent-docs.mjs';
import { librarySearchUrl, readingBase } from './agent-reading.mjs';
import {
  GROUPS, LINK_KINDS, TOPICS, TYPES, discussionUrl, libraryJson, libraryJsonSchema, libraryMarkdown, libraryUrl,
} from './library.mjs';
import { site } from './site.mjs';
import { DEFAULT_OPEN_DAYS, HIRING_ROLES, OPPORTUNITY_KINDS, opportunitiesJson, opportunitiesMarkdown } from './opportunities.mjs';
import { groupLabels } from './groups.mjs';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dot = date => date.replaceAll('-', '.');
const monthDay = date => `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日`;
const host = url => new URL(url).hostname.replace(/^www\./, '');
// Links of one entry can share a site: a repository and folders in it, or two Hugging Face datasets.
// Those show their path instead of the site, without GitHub's tree/<branch> part, keeping the first and
// last folder when it is long ("loopx/…/explore").
function linkPlace(url, shared) {
  if (!shared) return host(url);
  let parts = new URL(url).pathname.split('/').filter(Boolean).map(part => { try { return decodeURIComponent(part); } catch { return part; } });
  if (host(url) === 'github.com' && ['tree', 'blob'].includes(parts[2])) parts = [...parts.slice(0, 2), ...parts.slice(4)];
  const rest = parts.length <= 2 ? parts : parts.slice(1);
  return !parts.length ? host(url) : rest.length <= 2 ? rest.join('/') : `${rest[0]}/…/${rest.at(-1)}`;
}
// Lucide paths, inlined because static pages do not load the icon bundle.
export const icon = (paths, size = 18) => `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const heart = icon('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>', 16);
const search = icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>');
const external = icon('<path d="M7 7h10v10"/><path d="M7 17 17 7"/>', 12);
export const favicon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='4' fill='%23a6322b'/%3E%3Ctext x='20' y='29' text-anchor='middle' font-size='29' font-family='serif' fill='white'%3EH%3C/text%3E%3C/svg%3E";
const askAgent = `读取 ${libraryUrl}resources.json ，帮我找 AgentHub 群里分享过的 agentic RL 训练框架，列出标题、一句话简介和链接。`;

// One source line per group: the sharers' avatars, or the group alone when the sharer is unknown.
function sources(item, prefix) {
  const groups = new Map();
  for (const share of item.shares) {
    if (!groups.has(share.group)) groups.set(share.group, new Set());
    if (share.avatar) groups.get(share.group).add(share.avatar);
  }
  return [...groups].map(([group, avatars]) => `<span class="source">${[...avatars].map(file =>
    `<img src="${esc(`${prefix}library-avatars/${file}`)}" alt="" width="22" height="22" loading="lazy" decoding="async">`).join('')}` +
    `<span class="source-group">${esc(GROUPS[group])}</span></span>`).join('');
}

// Time values: "7d" for items first shared in the last week of the collection, plus the month of the first share.
const RECENT_DAYS = 7;
let through = '';
const when = item => [...(Date.parse(through) - Date.parse(item.first) < RECENT_DAYS * 86400000 ? ['7d'] : []), item.first.slice(0, 7)];

function entry(item, prefix) {
  const [primary] = item.links;
  const discussion = item.discussions[0];
  const groups = [...new Set(item.shares.map(share => share.group))];
  const kinds = [...new Set(item.links.map(link => link.kind))];
  return `<li class="entry" id="${esc(item.id)}" data-type="${esc(item.type)}" data-topic="${esc(item.topics.join('|'))}" data-keyword="${esc(item.keywords.join('|'))}" data-link="${esc(kinds.join('|'))}" data-group="${esc(groups.join('|'))}" data-when="${esc(when(item).join('|'))}" data-first="${esc(item.first)}">` +
    `<div class="entry-meta"><span class="entry-type">${esc(TYPES[item.type])}</span><time datetime="${esc(item.first)}">${esc(dot(item.first))}</time></div>` +
    `<h2 class="entry-title"><a href="${esc(primary.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a></h2>` +
    `<p class="entry-summary">${esc(item.summary)}</p>` +
    `<ul class="entry-links" aria-label="链接">${item.links.map(link => `<li><a href="${esc(link.url)}" title="${esc(link.url)}" target="_blank" rel="noopener noreferrer"><span class="link-kind">${esc(LINK_KINDS[link.kind])}</span> <span class="link-host">${esc(linkPlace(link.url, item.links.filter(other => host(other.url) === host(link.url)).length > 1))}</span>${external}</a></li>`).join('')}</ul>` +
    `<div class="entry-tags">${item.topics.map(topic => `<a class="tag-topic" href="?topic=${esc(encodeURIComponent(topic))}" data-filter="topic" data-value="${esc(topic)}">${esc(TOPICS[topic].label)}</a>`).join('')}` +
    `${item.keywords.map(keyword => `<a class="tag-keyword" href="?kw=${esc(encodeURIComponent(keyword))}" data-filter="keyword" data-value="${esc(keyword)}">${esc(keyword)}</a>`).join('')}</div>` +
    `<div class="entry-foot"><div class="entry-sources" aria-label="分享来源">${sources(item, prefix)}</div>` +
    (discussion ? `<a class="entry-discussion" href="${esc(prefix + discussionUrl(discussion).slice(site.length))}" title="这份资料在日报或周报里被讨论时的摘要">群聊摘要</a>` : '') +
    `<button type="button" class="heart" data-feedback="${libraryFeedbackId(item.id)}" aria-pressed="false" aria-label="喜欢：${esc(item.title)}">${heart}<span class="heart-count">—</span></button></div></li>`;
}

// Opportunities: open ones as cards, closed ones in a collapsed list. They go stale, so each card leads with the day it
// was posted; the close line states only a deadline or event day the post gave. Contact goes to the original message,
// never a person.
function opportunityCard(item) {
  const roles = item.roles.map(role => HIRING_ROLES[role]).join('、');
  const closes = item.kind === 'event' && item.event_date ? `活动日期 ${dot(item.event_date)}`
    : item.deadline ? `截止 ${dot(item.deadline)}` : '未写截止日期';
  const groups = [...new Set(item.shares.map(share => groupLabels[share.group] || share.group))].join('、');
  return `<li class="opportunity" id="${esc(item.id)}" data-kind="${esc(item.kind)}">` +
    `<div class="entry-meta"><span class="entry-type">${esc(OPPORTUNITY_KINDS[item.kind])}${roles ? ` · ${esc(roles)}` : ''}</span>` +
    `<time class="opportunity-posted" datetime="${esc(item.first)}">${esc(dot(item.first))} 发布</time></div>` +
    `<h3 class="opportunity-title">${item.links[0] ? `<a href="${esc(item.links[0].url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>` : esc(item.title)}</h3>` +
    `<p class="opportunity-org">${esc(item.org)}${item.location ? ` · ${esc(item.location)}` : ''}</p>` +
    `<p class="opportunity-when${item.inferred_close ? ' is-inferred' : ''}">${esc(closes)}</p>` +
    `<p class="entry-summary">${esc(item.summary)}</p>` +
    (item.links.length ? `<ul class="entry-links" aria-label="链接">${item.links.map(link => `<li><a href="${esc(link.url)}" title="${esc(link.url)}" target="_blank" rel="noopener noreferrer"><span class="link-kind">${esc(LINK_KINDS[link.kind])}</span> <span class="link-host">${esc(host(link.url))}</span></a></li>`).join('')}</ul>`
      : `<p class="opportunity-contact">联系方式见${esc(groups)} ${esc(dot(item.last))} 的原消息</p>`) +
    `<p class="opportunity-shared">分享于${esc(groups)}${item.last !== item.first ? `，${esc(dot(item.last))} 再次分享` : ''}</p></li>`;
}

function opportunitiesSection(opportunities) {
  if (!opportunities?.items.length) return '';
  const open = opportunities.items.filter(item => item.open), closed = opportunities.items.filter(item => !item.open);
  const counts = Object.keys(OPPORTUNITY_KINDS).map(kind => [kind, open.filter(item => item.kind === kind).length]).filter(([, n]) => n);
  return `<section class="opportunities" id="opportunities" aria-labelledby="opportunities-title" hidden>` +
    `<div class="opportunities-head"><h2 id="opportunities-title">机会</h2><p>群里分享的招聘、活动和征稿，收录到 ${esc(dot(opportunities.through))}。` +
    `${open.length ? `开放中 ${open.length} 项（${counts.map(([kind, n]) => `${OPPORTUNITY_KINDS[kind]} ${n}`).join('、')}）` : '目前没有开放中的机会'}，按发布日期从新到旧排列。` +
    `未注明截止日的，满 ${DEFAULT_OPEN_DAYS} 天后移入已截止。</p></div>` +
    (open.length ? `<ol class="opportunity-list">${open.map(opportunityCard).join('')}</ol>` : '') +
    (closed.length ? `<details class="opportunities-closed"><summary>已截止 ${closed.length} 项</summary><ol class="opportunity-list">${closed.map(opportunityCard).join('')}</ol></details>` : '') +
    `</section>`;
}

// The publication tabs shared by the static library and agents pages.
export function sectionNav(prefix, current, { dailyHref, weeklyHref }) {
  const tab = (id, href, label, extra = '') => `<a href="${esc(href)}"${extra}${id === current ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="edition-nav" aria-label="栏目"><div class="tabs">${tab('daily', dailyHref, '日报')}${tab('weekly', weeklyHref, '周报')}` +
    `${tab('library', `${prefix}library/`, '资料库')}${tab('rank', `${prefix}rank/week/`, '活跃榜')}${AGENTS_PAGE ? tab('agents', `${prefix}agents/`, '给 Agent 用', ' class="agents-tab"') : ''}</div>` +
    `<div class="edition-tools"><a class="icon-button search-entry" href="${esc(prefix)}search/" aria-label="搜索日报、周报和资料库" title="搜索">${icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>')}</a>` +
    `<button type="button" class="icon-button appearance-toggle" aria-label="明暗切换"></button></div></nav>`;
}
export const footer = (label, note) => `<footer class="footer"><span>AGENT HUB / ${label}</span><span>${note}</span></footer>`;

const chip = (filter, value, label, count, extra = false) =>
  `<button type="button" data-filter="${filter}" data-value="${esc(value)}" aria-pressed="${!value}"${extra ? ' class="is-extra"' : ''}>${esc(label)}<span class="chip-count">${count}</span></button>`;
// Research readers mostly ask for papers with code, data or weights; rarer link kinds are not filters.
const LINK_FILTERS = { code: '有代码', data: '有数据', model: '有模型', leaderboard: '有榜单' };
// The keyword row shows the most shared keywords first; the rest stay one tap away.
const KEYWORDS_SHOWN = 16;
// Keywords used by fewer items stay searchable and clickable on cards but get no chip.
const KEYWORD_MIN = 3;
function filterRow(filter, label, options, { hint = '' } = {}) {
  const id = `${filter}-label`;
  return `<div class="filter-row" data-row="${filter}"><span class="filter-label" id="${id}">${esc(label)}</span><div class="chips" role="group" aria-labelledby="${id}">` +
    options.map(([value, text, count], index) => chip(filter, value, text, count, filter === 'keyword' && index >= KEYWORDS_SHOWN)).join('') +
    (hint ? `<button type="button" class="chips-more" aria-expanded="false" data-label="${esc(hint)}">${esc(hint)}</button>` : '') + `</div></div>`;
}

export function renderLibraryPage(library, { prefix = '../', assets = {}, publicBuild = false, feedbackEndpoint = '', dailyHref, weeklyHref, vocabulary = { expand: {}, groups: [] }, opportunities = null } = {}) {
  const prompt = publicBuild
    ? `使用 ${librarySearchUrl} 查询 AgentHub 资料库，帮我找群里分享过的 agentic RL 训练框架。用 q 搜索，也可按 type、topic、keyword 筛选；返回结果有 next_offset 时可以继续翻页。列出标题、一句话简介和原始链接，只引用实际查到的资料。`
    : askAgent;
  const asset = file => `${prefix}${file}${assets[file] ? `?v=${assets[file]}` : ''}`;
  const scripts = ["'self'", ...(publicBuild ? ['https://static.cloudflareinsights.com/beacon.min.js'] : [])];
  const connections = [...(publicBuild ? ['https://cloudflareinsights.com'] : []), ...(feedbackEndpoint ? [new URL(feedbackEndpoint).origin] : [])];
  const total = library.items.length;
  through = library.through;
  const tally = values => { const counts = new Map(); for (const value of values) counts.set(value, (counts.get(value) || 0) + 1); return counts; };
  const topicCounts = tally(library.items.flatMap(item => item.topics));
  const typeCounts = tally(library.items.map(item => item.type));
  const linkCounts = tally(library.items.flatMap(item => [...new Set(item.links.map(link => link.kind))]));
  const groupCounts = tally(library.items.flatMap(item => [...new Set(item.shares.map(share => share.group))]));
  const whenCounts = tally(library.items.flatMap(when));
  const keywords = [...tally(library.items.flatMap(item => item.keywords))].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'));
  const rows = {
    topic: Object.entries(TOPICS).filter(([id]) => topicCounts.get(id)).map(([id, topic]) => [id, topic.label, topicCounts.get(id)]),
    type: [['', '全部资料', total], ...(opportunities?.items.length ? [['opportunity', '机会', opportunities.items.length]] : []),
      ...Object.entries(TYPES).filter(([id]) => typeCounts.get(id)).map(([id, label]) => [id, label, typeCounts.get(id)])],
    keyword: keywords.filter(([, count]) => count >= KEYWORD_MIN).map(([keyword, count]) => [keyword, keyword, count]),
    link: Object.entries(LINK_FILTERS).filter(([id]) => linkCounts.get(id)).map(([id, label]) => [id, label, linkCounts.get(id)]),
    group: Object.entries(GROUPS).filter(([id]) => groupCounts.get(id)).map(([id, label]) => [id, label, groupCounts.get(id)]),
    when: [...whenCounts].sort((a, b) => (a[0] === '7d' ? -1 : b[0] === '7d' ? 1 : b[0].localeCompare(a[0])))
      .map(([value, count]) => [value, value === '7d' ? `近 ${RECENT_DAYS} 天` : value.startsWith(library.through.slice(0, 4)) ? `${Number(value.slice(5))} 月` : `${value.slice(0, 4)} 年 ${Number(value.slice(5))} 月`, count]),
  };
  const recent = whenCounts.get('7d') || 0;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
    `<meta name="referrer" content="no-referrer"><meta name="agenthub-root" content="${esc(prefix)}">` +
    headTags({ section: 'library', kind: 'dataset', title: 'AgentHub 资料库', url: libraryUrl, markdown: 'resources.md', llms: `${prefix}llms.txt`,
      description: `AgentHub 各群分享过的 ${total} 项 AI Agent 论文、代码、数据集和工具。`,
      first: library.first, through: library.through, keywords: keywords.slice(0, 20).map(([keyword]) => keyword) }) +
    (feedbackEndpoint ? `<meta name="agenthub-feedback" content="${esc(feedbackEndpoint)}">` : '') +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; script-src ${scripts.join(' ')}; style-src 'self'; img-src 'self' data:; connect-src ${connections.join(' ') || "'none'"}; object-src 'none'; base-uri 'none'">` +
    `<link rel="canonical" href="${esc(libraryUrl)}"><link rel="alternate" type="application/json" href="resources.json" title="AgentHub 资料库 JSON">` +
    `<title>资料库 · AgentHub</title><link rel="icon" href="${favicon}"><script src="${esc(asset('appearance.js'))}"></script>` +
    `<link rel="stylesheet" href="${esc(asset('weekly.css'))}"><link rel="stylesheet" href="${esc(asset('library.css'))}"><link rel="stylesheet" href="${esc(asset('color-scheme.css'))}"></head>` +
    `<body data-page="library"><a class="skip" href="#content">跳至正文</a><div class="shell">` +
    `<header class="masthead"><div class="masthead-main"><a class="wordmark" href="./" translate="no">AgentHub<span>资料库</span></a><p class="issue-date"><span class="period">${library.items.length} 项</span><small>收录至 ${esc(dot(library.through))}</small></p></div></header>` +
    sectionNav(prefix, 'library', { dailyHref, weeklyHref }) +
    `<main id="content"><header class="heading"><div class="heading-top"><p class="kicker">群友分享</p><span class="heading-links"><a class="rank-link" href="${esc(prefix)}glossary/">群聊黑话</a></span></div>` +
    `<h1>群里分享过的资料</h1><p class="intro">${esc(monthDay(library.first))}以来，各群里分享过的论文、代码和工具，一共 ${library.items.length} 项。` +
    (recent ? ` <a class="inline-link" href="?when=7d" data-filter-link data-filter="when" data-value="7d">近 ${RECENT_DAYS} 天新增 ${recent} 项</a>` : '') +
    (opportunities?.items.some(item => item.open) ? ` <a class="inline-link" href="#opportunities">招聘、活动和征稿</a>` : '') + `</p></header>` +
    `<section class="filters" aria-label="筛选资料"><label class="search">${search}<span class="visually-hidden">搜索资料</span><input type="search" id="library-search" placeholder="搜标题、简介或网址" autocomplete="off" enterkeyhint="search"></label>` +
    filterRow('type', '类型', rows.type) + filterRow('topic', '主题', rows.topic) +
    filterRow('keyword', '关键词', rows.keyword, { hint: rows.keyword.length > KEYWORDS_SHOWN ? `更多 ${rows.keyword.length - KEYWORDS_SHOWN} 个` : '' }) +
    `<details class="more-filters"><summary>按链接、群和时间筛选</summary>${filterRow('link', '链接', rows.link)}${filterRow('group', '群', rows.group)}${filterRow('when', '时间', rows.when)}</details>` +
    `<div class="applied" aria-label="已选条件" hidden></div>` +
    `<div class="filter-status"><p id="library-status" role="status" aria-live="polite">共 ${library.items.length} 项</p><div class="sort" role="group" aria-label="排序" hidden><button type="button" data-sort="recent" aria-pressed="true">最新分享</button><button type="button" data-sort="hearts" aria-pressed="false">最多喜欢</button></div></div></section>` +
    `<ol class="entries">${library.items.map(item => entry(item, prefix)).join('')}</ol>` +
    `<div class="library-empty" hidden><p>没找到符合条件的资料。</p><ul class="relax"></ul><button type="button" id="library-reset">清空筛选</button></div>` +
    opportunitiesSection(opportunities) +
    `<script type="application/json" id="library-search-data">${JSON.stringify({ vocabulary,
      items: library.items.map(({ title, summary, keywords, links }) => ({ title, summary, keywords, links })) }).replaceAll('<', '\\u003c')}</script>` +
    `<section class="agents" id="agents" aria-labelledby="agents-title"><h2 id="agents-title">给 Agent 用</h2>` +
    `<p>${publicBuild ? '让 agent 按关键词、资料类型和主题查询，只取需要的结果，无需登录。也可以下载完整数据。' : '资料库也有 JSON 和 Markdown 版，内容和本页一样，agent 可以直接读。'}</p>` +
    `<ul class="agent-files">${publicBuild ? `<li><a href="${esc(librarySearchUrl)}?topic=computer-use&amp;type=benchmark&amp;limit=5">资料库查询接口</a><span>示例：查询 Computer Use 评测，每页 5 项</span></li>` : ''}` +
    `<li><a href="${publicBuild ? readingBase + 'library/' : ''}resources.json">resources.json</a><span>完整数据，含链接、分享日期和相关日报</span></li>` +
    `<li><a href="${publicBuild ? readingBase + 'library/' : ''}resources.md">resources.md</a><span>按主题分组，适合整份交给 agent</span></li></ul>` +
    `<p>把这句话发给能联网的 agent：</p><div class="command"><pre><code id="ask-agent">${esc(prompt)}</code></pre><button type="button" class="copy" data-copy="ask-agent">复制</button></div>` +
    (publicBuild ? `<p><a class="inline-link" href="${readingBase}agents/SKILL.md">查看 AgentHub Skill 与查询说明</a></p>` : '') +
    (AGENTS_PAGE ? `<p>想让 agent 以后自己会查，可以装 AgentHub skill，见<a class="inline-link" href="${esc(prefix)}agents/">给 Agent 用</a>。</p>` : '') + `</section></main>` +
    footer('资料库', '群内分享的论文、代码与工具索引。') + `</div>` +
    `<script src="${esc(asset('bm25.js'))}"></script><script src="${esc(asset('query.js'))}"></script><script src="${esc(asset('library.js'))}"></script><script src="${esc(asset('copy.js'))}"></script>` +
    (publicBuild && feedbackEndpoint ? `<script defer src="${esc(asset('views.js'))}" data-endpoint="${esc(feedbackEndpoint)}"></script>` : '') +
    `${publicBuild ? `<script defer src="${esc(asset('analytics.js'))}"></script>` : ''}</body></html>`;
}

export async function writeLibraryPages(out, { library, dataDir, digests = [], weeklies = [], publicBuild = false, feedbackEndpoint = '', vocabulary, opportunities = null }) {
  const directory = path.join(out, 'library');
  await mkdir(path.join(out, 'library-avatars'), { recursive: true });
  await mkdir(directory, { recursive: true });
  for (const file of new Set(library.items.flatMap(item => item.shares.map(share => share.avatar)).filter(Boolean))) {
    await copyFile(path.join(dataDir, 'library-avatars', file), path.join(out, 'library-avatars', file));
  }
  const assets = {};
  for (const file of ['weekly.css', 'library.css', 'bm25.js', 'query.js', 'library.js', 'copy.js', 'appearance.js', 'color-scheme.css', ...(publicBuild ? ['analytics.js'] : []), ...(publicBuild && feedbackEndpoint ? ['views.js'] : [])]) {
    assets[file] = createHash('sha256').update(await readFile(path.join(out, file))).digest('hex').slice(0, 16);
  }
  const latestWeekly = weeklies.at(-1);
  const weeklyPage = latestWeekly?.pages.find(page => page.id === 'group-3')?.id || latestWeekly?.pages[0]?.id;
  const prefix = '../';
  await writeFile(path.join(directory, 'index.html'), renderLibraryPage(library, {
    prefix, assets, publicBuild, feedbackEndpoint,
    dailyHref: prefix,
    weeklyHref: latestWeekly ? prefix + weeklyRoute(latestWeekly, weeklyPage) : prefix,
    vocabulary, opportunities,
  }));
  if (opportunities) {
    await writeFile(path.join(directory, 'opportunities.json'), `${JSON.stringify(opportunitiesJson(opportunities), null, 2)}\n`);
    await writeFile(path.join(directory, 'opportunities.md'), opportunitiesMarkdown(opportunities));
  }
  await writeFile(path.join(directory, 'resources.json'), `${JSON.stringify(libraryJson(library), null, 2)}\n`);
  await writeFile(path.join(directory, 'resources.schema.json'), `${JSON.stringify(libraryJsonSchema(), null, 2)}\n`);
  await writeFile(path.join(directory, 'resources.md'), libraryMarkdown(library));
}
