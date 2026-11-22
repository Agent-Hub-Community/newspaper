import { brandHome, brandWordmark, communityLink, colophon, favicon, mastheadNav, publicationTabs } from './brand.mjs';
// Writes the static library page and its agent copies (JSON and Markdown).
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { libraryFeedbackId } from './feedback-id.mjs';
import { weeklyRoute } from './weekly-editions.mjs';
import { headTags } from './seo.mjs';
import { AGENTS_PAGE } from './agent-docs.mjs';
import { librarySearchUrl, readingBase } from './agent-reading.mjs';
import { libraryUrl, GROUPS, LINK_KINDS, TOPICS, TYPES, discussionUrl, libraryJson, libraryJsonSchema, libraryMarkdown } from './library.mjs';
import { site } from './site.mjs';
import { DEFAULT_OPEN_DAYS, HIRING_ROLES, OPPORTUNITY_KINDS, opportunitiesJson, opportunitiesMarkdown } from './opportunities.mjs';
import { groupLabels } from './groups.mjs';

export { favicon } from './brand.mjs';

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
// Repeated entry icons reference one SVG sprite to avoid duplicating inline paths across 435+ cards.
const sprite = `<svg hidden width="0" height="0" aria-hidden="true">` +
  `<symbol id="i-e" viewBox="0 0 24 24"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></symbol>` +
  `<symbol id="i-bm" viewBox="0 0 24 24"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></symbol>` +
  `<symbol id="i-chat" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></symbol>` +
  `<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></symbol>` +
  `<symbol id="i-dl" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></symbol>` +
  `<symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></symbol>` +
  // Platform & link-kind logos (filled marks use fill="currentColor" stroke="none"; line icons inherit stroke).
  `<symbol id="l-github" viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M12 2C6.48 2 2 6.58 2 12.26c0 4.53 2.87 8.38 6.84 9.74.5.09.68-.22.68-.49 0-.24-.01-.88-.01-1.72-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.08 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.36 9.36 0 0 1 12 6.84c.85 0 1.71.12 2.51.35 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.64 1.03 2.76 0 3.95-2.34 4.82-4.57 5.07.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.26C22 6.58 17.52 2 12 2z"/></symbol>` +
  `<symbol id="l-arxiv" viewBox="0 0 24 24"><path d="M5 4l14 16" stroke-width="2.4"/><path d="M19 4L5 20" stroke-width="2.4"/><path d="M7.5 11.5L12 7l4.5 4.5" stroke-width="1.6" opacity=".55"/></symbol>` +
  `<symbol id="l-hf" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.2" stroke-width="1.7"/><circle cx="9" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none"/><path d="M8.5 14.3c1 1.6 2.2 2.2 3.5 2.2s2.5-.6 3.5-2.2" stroke-width="1.7"/><path d="M4.2 15.5c1.1-.4 2.2.2 2.6 1.2M19.8 15.5c-1.1-.4-2.2.2-2.6 1.2" stroke-width="1.6"/></symbol>` +
  `<symbol id="l-wechat" viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M9.2 4C5.2 4 2 6.7 2 10.1c0 1.9 1 3.6 2.7 4.8l-.7 2.2 2.4-1.2c.9.2 1.8.4 2.8.4.4 0 .7 0 1.1-.1-.2-.6-.3-1.3-.3-2 0-3.2 2.9-5.8 6.6-5.8.3 0 .6 0 .9.1C16.8 5.9 13.3 4 9.2 4zm-2.4 5a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2zm4.8 0a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2z"/><path fill="currentColor" stroke="none" d="M16.5 9.8c-3.1 0-5.6 2.1-5.6 4.7s2.5 4.7 5.6 4.7c.7 0 1.4-.1 2.1-.3l1.9 1-.5-1.7c1.3-.9 2.1-2.2 2.1-3.7 0-2.6-2.5-4.7-5.6-4.7zm-1.8 4a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zm3.7 0a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z"/></symbol>` +
  `<symbol id="l-x" viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></symbol>` +
  `<symbol id="l-zhihu" viewBox="0 0 24 24"><rect x="2.5" y="2.5" width="19" height="19" rx="4.5" stroke-width="1.7"/><path d="M8.2 7.5h7.6L8.2 16.5h7.6" stroke-width="2"/></symbol>` +
  `<symbol id="l-video" viewBox="0 0 24 24"><rect x="2.5" y="4.5" width="19" height="15" rx="3.5" stroke-width="1.7"/><polygon points="10 9 16 12 10 15" fill="currentColor" stroke="none"/></symbol>` +
  `<symbol id="l-paper" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/></symbol>` +
  `<symbol id="l-code" viewBox="0 0 24 24"><path d="m8 6-6 6 6 6"/><path d="m16 6 6 6-6 6"/></symbol>` +
  `<symbol id="l-data" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/></symbol>` +
  `<symbol id="l-model" viewBox="0 0 24 24"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5"/><path d="M12 12v10"/></symbol>` +
  `<symbol id="l-board" viewBox="0 0 24 24"><path d="M6 9H4a2 2 0 0 1-2-2V5h4"/><path d="M18 9h2a2 2 0 0 0 2-2V5h-4"/><path d="M6 4h12v6a6 6 0 0 1-12 0z"/><path d="M12 16v4M8 20h8"/></symbol>` +
  `<symbol id="l-docs" viewBox="0 0 24 24"><path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z"/><path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/></symbol>` +
  `<symbol id="l-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/><path d="M12 2.5a14 14 0 0 1 0 19 14 14 0 0 1 0-19"/></symbol>` +
  `</svg>`;
const search = icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>');
const external = `<svg class="icon" width="12" height="12" aria-hidden="true"><use href="#i-e"/></svg>`;
function linkLogo(url, kind) {
  const h = host(url);
  if (h === 'github.com') return { id: 'l-github', brand: 'github' };
  if (h === 'arxiv.org' || h === 'alphaxiv.org') return { id: 'l-arxiv', brand: 'arxiv' };
  if (h === 'huggingface.co') return { id: 'l-hf', brand: 'hf' };
  if (h === 'mp.weixin.qq.com') return { id: 'l-wechat', brand: 'wechat' };
  if (h === 'x.com' || h === 'twitter.com') return { id: 'l-x', brand: 'x' };
  if (h === 'zhihu.com' || h === 'zhuanlan.zhihu.com') return { id: 'l-zhihu', brand: 'zhihu' };
  if (h === 'youtube.com' || h === 'youtu.be' || h === 'bilibili.com' || h === 'b23.tv') return { id: 'l-video', brand: 'video' };
  const byKind = { paper: 'l-paper', code: 'l-code', data: 'l-data', model: 'l-model', leaderboard: 'l-board', docs: 'l-docs', video: 'l-video' };
  return { id: byKind[kind] || 'l-globe', brand: 'kind' };
}
const linkIcon = (url, kind) => {
  const { id, brand } = linkLogo(url, kind);
  return `<svg class="icon link-logo" data-brand="${brand}" width="14" height="14" aria-hidden="true"><use href="#${id}"/></svg>`;
};
const REPO_URL = 'https://github.com/Agent-Hub-Community/newspaper';
const askAgent = `读取 ${libraryUrl}resources.json ，帮我找 Agent Hub 群里分享过的 agentic RL 训练框架，列出标题、一句话简介和链接。`;

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

const itemStats = item => {
  const groups = [...new Set(item.shares.map(share => share.group))];
  const groupCount = item.groupCount ?? groups.length;
  const shareCount = item.shareCount ?? item.shares.length;
  const discussionCount = item.discussionCount ?? item.discussions.length;
  const last = item.last || item.shares.at(-1)?.date || item.first;
  const heat = item.heat ?? (groupCount * 3 + shareCount * 2 + discussionCount * 4 + (item.links.length > 1 ? 1 : 0));
  return { groups, groupCount, shareCount, discussionCount, last, heat, hot: discussionCount > 0 || groupCount > 1 };
};

function entry(item, prefix) {
  const [primary] = item.links;
  const discussion = item.discussions[0];
  const { groups, groupCount, discussionCount, last, heat, hot } = itemStats(item);
  const kinds = [...new Set(item.links.map(link => link.kind))];
  return `<li class="entry" id="${esc(item.id)}" data-type="${esc(item.type)}" data-topic="${esc(item.topics.join('|'))}" data-keyword="${esc(item.keywords.join('|'))}" data-link="${esc(kinds.join('|'))}" data-group="${esc(groups.join('|'))}" data-when="${esc(when(item).join('|'))}" data-first="${esc(item.first)}" data-last="${esc(last)}" data-heat="${heat}" data-discussed="${discussionCount ? '1' : '0'}" data-hot="${hot ? '1' : '0'}">` +
    `<div class="entry-meta"><span class="entry-type" data-type="${esc(item.type)}">${esc(TYPES[item.type])}</span><time datetime="${esc(item.first)}">${esc(dot(item.first))}</time>` +
    (groupCount > 1 ? `<span class="entry-badge" title="在 ${groupCount} 个群被分享">${groupCount} 群</span>` : '') +
    (discussionCount > 0 ? `<span class="entry-badge is-discussed" title="关联 ${discussionCount} 篇群聊讨论">${discussionCount} 讨论</span>` : '') +
    `<button type="button" class="entry-save" data-save-id="${esc(item.id)}" aria-pressed="false" aria-label="收藏 ${esc(item.title)}" title="收藏到稍后阅读"><svg class="icon" width="15" height="15" aria-hidden="true"><use href="#i-bm"/></svg></button></div>` +
    `<h2 class="entry-title"><a href="${esc(primary.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a></h2>` +
    `<p class="entry-summary">${esc(item.summary)}</p>` +
    `<ul class="entry-links" aria-label="链接">${item.links.map(link => `<li><a href="${esc(link.url)}" title="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${linkIcon(link.url, link.kind)}<span class="link-kind">${esc(LINK_KINDS[link.kind])}</span> <span class="link-host">${esc(linkPlace(link.url, item.links.filter(other => host(other.url) === host(link.url)).length > 1))}</span>${external}</a></li>`).join('')}</ul>` +
    `<div class="entry-tags">${item.topics.map(topic => `<a class="tag-topic" href="?topic=${esc(encodeURIComponent(topic))}" data-filter="topic" data-value="${esc(topic)}">${esc(TOPICS[topic].label)}</a>`).join('')}` +
    `${item.keywords.map(keyword => `<a class="tag-keyword" href="?kw=${esc(encodeURIComponent(keyword))}" data-filter="keyword" data-value="${esc(keyword)}">${esc(keyword)}</a>`).join('')}</div>` +
    `<div class="entry-foot"><div class="entry-sources" aria-label="分享来源">${sources(item, prefix)}</div>` +
    `<div class="entry-foot-actions">` +
    (discussion ? `<a class="entry-discussion" href="${esc(prefix + discussionUrl(discussion).slice(site.length))}" title="这份资料在日报或周报里被讨论时的摘要">群聊摘要${discussionCount > 1 ? ` · ${discussionCount}` : ''}</a>` : '') +
    `<button type="button" class="entry-detail-btn" data-detail-id="${esc(item.id)}" aria-haspopup="dialog">详情${item.related?.length ? ` · 相关 ${item.related.length}` : ''}</button>` +
    `</div></div></li>`;
}

// Opportunities: open ones as cards, closed ones in a collapsed list. They go stale, so each card leads with the day it
// was posted; the close line states only a deadline or event day the post gave. Contact goes to the original message,
// never a person.
function opportunityCard(item, prefix) {
  const discussion = item.discussions?.[0];
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
    (item.links.length ? `<ul class="entry-links" aria-label="链接">${item.links.map(link => `<li><a href="${esc(link.url)}" title="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${linkIcon(link.url, link.kind)}<span class="link-kind">${esc(LINK_KINDS[link.kind])}</span> <span class="link-host">${esc(host(link.url))}</span></a></li>`).join('')}</ul>`
      : `<p class="opportunity-contact">联系方式见${esc(groups)} ${esc(dot(item.last))} 的原消息</p>`) +
    `<div class="opportunity-foot"><p class="opportunity-shared">分享于${esc(groups)}${item.last !== item.first ? `，${esc(dot(item.last))} 再次分享` : ''}</p>` +
    (discussion ? `<a class="entry-discussion" href="${esc(prefix + discussionUrl(discussion).slice(site.length))}" title="群里聊这条机会时，日报或周报里的摘要">群聊摘要</a>` : '') +
    `</div></li>`;
}

function opportunitiesSection(opportunities, prefix) {
  if (!opportunities?.items.length) return '';
  const open = opportunities.items.filter(item => item.open), closed = opportunities.items.filter(item => !item.open);
  const counts = Object.keys(OPPORTUNITY_KINDS).map(kind => [kind, open.filter(item => item.kind === kind).length]).filter(([, n]) => n);
  return `<section class="opportunities" id="opportunities" aria-labelledby="opportunities-title" hidden>` +
    `<div class="opportunities-head"><h2 id="opportunities-title">机会</h2><p>群里分享的招聘、活动和征稿，收录到 ${esc(dot(opportunities.through))}。` +
    `${open.length ? `开放中 ${open.length} 项（${counts.map(([kind, n]) => `${OPPORTUNITY_KINDS[kind]} ${n}`).join('、')}）` : '目前没有开放中的机会'}，按发布日期从新到旧排列。` +
    `未注明截止日的，满 ${DEFAULT_OPEN_DAYS} 天后移入已截止。</p></div>` +
    (open.length ? `<ol class="opportunity-list">${open.map(item => opportunityCard(item, prefix)).join('')}</ol>` : '') +
    (closed.length ? `<details class="opportunities-closed"><summary>已截止 ${closed.length} 项</summary><ol class="opportunity-list">${closed.map(item => opportunityCard(item, prefix)).join('')}</ol></details>` : '') +
    `</section>`;
}

// The brand-row copy of the publication tabs (see mastheadNav), for the static pages that use sectionNav.
export function mastheadSections(prefix, current, { dailyHref, weeklyHref }) {
  return mastheadNav(publicationTabs(prefix, current, { dailyHref, weeklyHref, agents: AGENTS_PAGE }));
}

// The publication tabs shared by the static library and agents pages.
export function sectionNav(prefix, current, { dailyHref, weeklyHref }) {
  return `<nav class="edition-nav has-masthead-nav" aria-label="栏目"><div class="tabs">${publicationTabs(prefix, current, { dailyHref, weeklyHref, agents: AGENTS_PAGE })}</div>` +
    `<div class="edition-tools"><a class="icon-button search-entry" href="${esc(prefix)}search/" aria-label="搜索日报、周报和资料库" title="搜索">${icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>')}</a>` +
    `<button type="button" class="icon-button appearance-toggle" aria-label="明暗切换"></button></div></nav>`;
}
export const footer = (label, note) => `<footer class="footer">${colophon}<span>Agent Hub / ${label}</span><span>${note}</span></footer>`;

const chip = (filter, value, label, count, { extra = false, title = '' } = {}) =>
  `<button type="button" data-filter="${filter}" data-value="${esc(value)}" aria-pressed="${!value}"${extra ? ' class="is-extra"' : ''}${title ? ` title="${esc(title)}"` : ''}>${esc(label)}<span class="chip-count">${count}</span></button>`;
// Research readers mostly ask for papers with code, data or weights; rarer link kinds are not filters.
const LINK_FILTERS = { code: '有代码', data: '有数据', model: '有模型', leaderboard: '有榜单' };
// The keyword row shows the most shared keywords first; the rest stay one tap away.
const KEYWORDS_SHOWN = 12;
// Keywords used by fewer items stay searchable and clickable on cards but get no chip.
const KEYWORD_MIN = 3;
function filterRow(filter, label, options, { hint = '', before = '' } = {}) {
  const id = `${filter}-label`;
  const chips = `<div class="chips" role="group" aria-labelledby="${id}">` +
    options.map(([value, text, count], index) => chip(filter, value, text, count, {
      extra: filter === 'keyword' && index >= KEYWORDS_SHOWN,
      title: filter === 'topic' ? (TOPICS[value]?.covers || '') : '',
    })).join('') +
    (hint ? `<button type="button" class="chips-more" aria-expanded="false" data-label="${esc(hint)}">${esc(hint)}</button>` : '') + `</div>`;
  const body = before ? `<div class="keyword-controls">${before}${chips}</div>` : chips;
  return `<div class="filter-row" data-row="${filter}"><span class="filter-label" id="${id}">${esc(label)}</span>${body}</div>`;
}

export function renderLibraryPage(library, { prefix = '../', assets = {}, publicBuild = false, feedbackEndpoint = '', dailyHref, weeklyHref, vocabulary = { expand: {}, groups: [] }, opportunities = null } = {}) {
  const prompt = publicBuild
    ? `使用 ${librarySearchUrl} 查询 Agent Hub 资料库，帮我找群里分享过的 agentic RL 训练框架。用 q 搜索，也可按 type、topic、keyword 筛选；返回结果有 next_offset 时可以继续翻页。列出标题、一句话简介和原始链接，只引用实际查到的资料。`
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
  const hotCount = library.items.filter(item => itemStats(item).hot).length;
  const paperCodeCount = library.items.filter(item => item.type === 'paper' && item.links.some(link => link.kind === 'code')).length;
  const benchCount = library.items.filter(item => item.type === 'benchmark' || item.links.some(link => link.kind === 'leaderboard')).length;
  const discussedCount = library.items.filter(item => item.discussions.length > 0).length;
  const keywordQuickSearch = `<div class="keyword-search-wrap">` +
    `<input type="search" id="keyword-filter-input" class="keyword-search" placeholder="快搜 ${keywords.length} 个关键词…" autocomplete="off" aria-label="快搜关键词">` +
    `<div class="keyword-matches" id="keyword-matches" hidden></div>` +
    `</div>`;
  const searchData = {
    vocabulary,
    types: TYPES,
    topics: TOPICS,
    linkKinds: LINK_KINDS,
    groups: GROUPS,
    keywords,
    repoUrl: REPO_URL,
    items: library.items.map(item => {
      const { groups, shareCount, last, heat } = itemStats(item);
      return {
        id: item.id,
        title: item.title,
        summary: item.summary,
        type: item.type,
        topics: item.topics,
        keywords: item.keywords,
        links: item.links,
        aliases: item.aliases || [],
        first: item.first,
        last,
        groups,
        shareCount,
        heat,
        discussions: item.discussions.map(story => ({
          kind: story.kind || 'daily',
          date: story.date,
          ...(story.from ? { from: story.from } : {}),
          group: story.group,
          title: story.title,
          href: prefix + discussionUrl(story).slice(site.length),
        })),
        related: item.related || [],
      };
    }),
  };
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
    `<meta name="referrer" content="no-referrer"><meta name="agenthub-root" content="${esc(prefix)}">` +
    headTags({ section: 'library', kind: 'dataset', title: 'Agent Hub 资料库', url: libraryUrl, markdown: 'resources.md', llms: `${prefix}llms.txt`,
      description: `Agent Hub 各群分享过的 ${total} 项 AI Agent 论文、代码、数据集和工具。`,
      first: library.first, through: library.through, keywords: keywords.slice(0, 20).map(([keyword]) => keyword) }) +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; script-src ${scripts.join(' ')}; style-src 'self'; img-src 'self' data:; connect-src ${connections.join(' ') || "'none'"}; object-src 'none'; base-uri 'none'">` +
    `<link rel="canonical" href="${esc(libraryUrl)}"><link rel="alternate" type="application/json" href="resources.json" title="Agent Hub 资料库 JSON">` +
    `<title>资料库 · Agent Hub</title><link rel="icon" href="${favicon}"><script src="${esc(asset('appearance.js'))}"></script>` +
    (assets['library.bundle.css']
      ? `<link rel="stylesheet" href="${esc(asset('library.bundle.css'))}">`
      : `<link rel="stylesheet" href="${esc(asset('weekly.css'))}"><link rel="stylesheet" href="${esc(asset('library.css'))}"><link rel="stylesheet" href="${esc(asset('color-scheme.css'))}"><link rel="stylesheet" href="${esc(asset('community.css'))}"><link rel="stylesheet" href="${esc(asset('skins.css'))}">`) + `</head>` +
    `<body data-page="library">${sprite}<a class="skip" href="#content">跳至正文</a><div class="shell">` +
    `<header class="masthead"><div class="masthead-brand"><div class="masthead-top"><span></span></div><div class="masthead-main">${brandHome}<a class="wordmark" href="./" translate="no">${brandWordmark}<span>资料库</span></a><p class="issue-date"><span class="period">${total} 项</span><small>收录至 ${esc(dot(library.through))}</small></p>${mastheadSections(prefix, 'library', { dailyHref, weeklyHref })}${communityLink}</div><img class="skin-art" alt="" hidden><img class="skin-flora" alt="" hidden><div class="skin-note" hidden><span class="skin-label"></span><span class="skin-message"></span></div></div></header>` +
    sectionNav(prefix, 'library', { dailyHref, weeklyHref }) +
    `<main id="content"><header class="heading"><div class="heading-top"><p class="kicker">群友分享</p><span class="heading-links">` +
    `<button type="button" class="heading-action" id="library-saved-toggle" aria-pressed="false" title="查看本地收藏夹">我的收藏<span class="saved-badge" id="library-saved-count" hidden>0</span></button>` +
    `<button type="button" class="heading-action is-primary" id="library-submit-open">+ 推荐资料</button>` +
    `<a class="rank-link" href="${esc(prefix)}glossary/">群聊黑话</a></span></div>` +
    `<h1>群里分享过的资料</h1><p class="intro">${esc(monthDay(library.first))}以来，各群里分享过的论文、代码和工具，一共 ${total} 项。` +
    (recent ? ` <a class="inline-link" href="?when=7d" data-filter-link data-filter="when" data-value="7d">近 ${RECENT_DAYS} 天新增 ${recent} 项</a>` : '') +
    (opportunities?.items.some(item => item.open) ? ` <a class="inline-link" href="#opportunities">招聘、活动和征稿</a>` : '') + `</p></header>` +
    `<section class="filters" aria-label="筛选资料">` +
    `<div class="search-shell"><label class="search">${search}<span class="visually-hidden">搜索资料</span><input type="search" id="library-search" placeholder="搜标题、简介、网址，或 type:paper has:code" autocomplete="off" enterkeyhint="search"><kbd class="search-kbd" aria-hidden="true">/</kbd><button type="button" class="search-clear" id="library-search-clear" aria-label="清空搜索" hidden>×</button></label>` +
    `<div class="search-suggest" id="library-suggest" role="listbox" aria-label="搜索建议" hidden></div></div>` +
    `<div class="search-explain" id="library-explain" aria-live="polite" hidden></div>` +
    `<div class="lenses" role="group" aria-label="快捷场景">` +
    `<button type="button" class="lens" data-lens="all" aria-pressed="true">全部<span class="chip-count">${total}</span></button>` +
    (recent > 0 ? `<button type="button" class="lens" data-lens="recent" aria-pressed="false">近 ${RECENT_DAYS} 天<span class="chip-count">${recent}</span></button>` : '') +
    (hotCount > 0 ? `<button type="button" class="lens" data-lens="hot" aria-pressed="false">群内热议<span class="chip-count">${hotCount}</span></button>` : '') +
    (paperCodeCount > 0 ? `<button type="button" class="lens" data-lens="paper-code" aria-pressed="false">论文+代码<span class="chip-count">${paperCodeCount}</span></button>` : '') +
    (benchCount > 0 ? `<button type="button" class="lens" data-lens="benchmarks" aria-pressed="false">评测榜单<span class="chip-count">${benchCount}</span></button>` : '') +
    `<button type="button" class="lens" data-lens="saved" aria-pressed="false">★ 我的收藏<span class="chip-count" id="lens-saved-count">0</span></button></div>` +
    filterRow('type', '类型', rows.type) + filterRow('topic', '主题', rows.topic) +
    filterRow('keyword', '关键词', rows.keyword, {
      hint: rows.keyword.length > KEYWORDS_SHOWN ? `更多 ${rows.keyword.length - KEYWORDS_SHOWN} 个` : '',
      before: keywordQuickSearch,
    }) +
    `<details class="more-filters"><summary>更多筛选（链接、群聊、讨论与时间）</summary>${filterRow('link', '链接', rows.link)}${discussedCount > 0 ? filterRow('discussed', '讨论', [['1', '有群聊摘要', discussedCount]]) : ''}${filterRow('group', '群', rows.group)}${filterRow('when', '时间', rows.when)}</details>` +
    `<div class="applied" aria-label="已选条件" hidden></div>` +
    `<div class="filter-status"><p id="library-status" role="status" aria-live="polite">共 ${total} 项</p>` +
    `<div class="toolbar-controls">` +
    `<div class="library-sort" role="group" aria-label="排序方式">` +
    `<button type="button" data-sort-by="recent" aria-pressed="true">最新</button>` +
    `<button type="button" data-sort-by="heat" aria-pressed="false">热议</button>` +
    `<button type="button" data-sort-by="active" aria-pressed="false">最近活跃</button>` +
    `<button type="button" data-sort-by="relevance" aria-pressed="false" hidden>相关度</button></div>` +
    `<div class="view-switch" role="group" aria-label="视图切换">` +
    `<button type="button" data-view-mode="cards" aria-pressed="true">卡片</button>` +
    `<button type="button" data-view-mode="list" aria-pressed="false">列表</button>` +
    `<button type="button" data-view-mode="atlas" aria-pressed="false">图谱</button></div>` +
    `<div class="export-menu">` +
    `<button type="button" class="export-toggle" id="library-export-toggle" aria-expanded="false" aria-haspopup="menu"><svg class="icon" width="14" height="14" aria-hidden="true"><use href="#i-dl"/></svg>导出</button>` +
    `<div class="export-popover" id="library-export-menu" role="menu" hidden>` +
    `<button type="button" role="menuitem" data-export="markdown">复制 Markdown 清单</button>` +
    `<button type="button" role="menuitem" data-export="bibtex">复制 BibTeX（arXiv）</button>` +
    `<button type="button" role="menuitem" data-export="download-md">下载 Markdown 文件</button>` +
    `<button type="button" role="menuitem" data-export="share-url">复制当前筛选链接</button>` +
    `</div></div></div></div></section>` +
    `<section class="topic-atlas" id="library-atlas" aria-label="按专题浏览" hidden></section>` +
    `<ol class="entries">${library.items.map(item => entry(item, prefix)).join('')}</ol>` +
    `<div class="library-empty" hidden><p>没找到符合条件的资料。</p><ul class="relax"></ul><button type="button" id="library-reset">清空筛选</button></div>` +
    opportunitiesSection(opportunities, prefix) +
    `<dialog class="library-dialog detail-dialog" id="library-detail" aria-labelledby="detail-title"></dialog>` +
    `<dialog class="library-dialog submit-dialog" id="library-submit" aria-labelledby="submit-title"></dialog>` +
    `<div class="library-toast" id="library-toast" role="status" aria-live="polite" hidden></div>` +
    `<script type="application/json" id="library-search-data">${JSON.stringify(searchData).replaceAll('<', '\\u003c')}</script>` +
    `<section class="agents" id="agents" aria-labelledby="agents-title"><h2 id="agents-title">给 Agent 用</h2>` +
    `<p>${publicBuild ? '让 agent 按关键词、资料类型和主题查询，只取需要的结果，无需登录。也可以下载完整数据。' : '资料库也有 JSON 和 Markdown 版，内容和本页一样，agent 可以直接读。'}</p>` +
    `<ul class="agent-files">${publicBuild ? `<li><a href="${esc(librarySearchUrl)}?topic=computer-use&amp;type=benchmark&amp;limit=5">资料库查询接口</a><span>示例：查询 Computer Use 评测，每页 5 项</span></li>` : ''}` +
    `<li><a href="${publicBuild ? readingBase + 'library/' : ''}resources.json">resources.json</a><span>完整数据，含链接、分享日期和相关日报</span></li>` +
    `<li><a href="${publicBuild ? readingBase + 'library/' : ''}resources.md">resources.md</a><span>按主题分组，适合整份交给 agent</span></li></ul>` +
    `<p>把这句话发给能联网的 agent：</p><div class="command"><pre><code id="ask-agent">${esc(prompt)}</code></pre><button type="button" class="copy" data-copy="ask-agent">复制</button></div>` +
    (publicBuild ? `<p><a class="inline-link" href="${readingBase}agents/SKILL.md">查看 Agent Hub Skill 与查询说明</a></p>` : '') +
    (AGENTS_PAGE ? `<p>想让 agent 以后自己会查，可以装 Agent Hub skill，见<a class="inline-link" href="${esc(prefix)}agents/">给 Agent 用</a>。</p>` : '') + `</section></main>` +
    footer('资料库', '群内分享的论文、代码与工具索引。') + `</div>` +
    (assets['library.bundle.js']
      ? `<script defer src="${esc(asset('library.bundle.js'))}"></script>`
      : `<script defer src="${esc(asset('themes.js'))}"></script><script defer src="${esc(asset('skins.js'))}"></script><script src="${esc(asset('bm25.js'))}"></script><script src="${esc(asset('query.js'))}"></script><script src="${esc(asset('library.js'))}"></script><script src="${esc(asset('copy.js'))}"></script>`) +
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
  for (const file of ['weekly.css', 'library.css', 'bm25.js', 'query.js', 'library.js', 'copy.js', 'appearance.js', 'color-scheme.css', 'community.css', ...(publicBuild ? ['analytics.js'] : []), ...(publicBuild && feedbackEndpoint ? ['views.js'] : [])]) {
    assets[file] = createHash('sha256').update(await readFile(path.join(out, file))).digest('hex').slice(0, 16);
  }
  for (const file of ['library.bundle.css', 'library.bundle.js', 'skins.css', 'themes.js', 'skins.js']) {
    const bytes = await readFile(path.join(out, file)).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (bytes) assets[file] = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
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
