// Site search: a build-time index of daily and weekly stories and library items, plus the page that searches it
// in the browser. Raw discussion excerpts are not indexed; the search vocabulary (synonyms.mjs) expands queries.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { site } from './site.mjs';
import { groupLabels } from './groups.mjs';
import { esc, favicon, footer, icon, sectionNav } from './library-render.mjs';
import { headTags } from './seo.mjs';
import { contentCatalog } from './agent-content.mjs';

export const searchUrl = `${site}search/`;
const PAGES = { ...groupLabels, external: '外部资讯' };
const searchIcon = icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>');

// Each entry: k (d daily, w weekly, l library), date, g (page id), t (title), x (searchable text), u (path from the site root).
export function searchIndex({ digests, weeklies, library, opportunities = null }) {
  return contentCatalog({ digests, weeklies, library, opportunities }).entries.map(entry => ({
    k: { daily: 'd', weekly: 'w', library: 'l', opportunity: 'o' }[entry.kind], date: entry.date,
    ...(entry.from ? { from: entry.from } : {}), ...(entry.group ? { g: entry.group } : {}), t: entry.title,
    x: entry.text, ai_comment: entry.ai_comment, kw: entry.keywords,
    ...(entry.links ? { links: entry.links } : {}), ...(entry.resources ? { resources: entry.resources } : {}),
    u: entry.url.slice(site.length) }));
}

// How many results the search page lists for each query, with the fields and weights search.js uses.
export async function searchCounts(entries, vocabulary, queries) {
  await import('../site/bm25.js');
  await import('../site/query.js');
  const index = globalThis.AgentHubQuery.createSearcher(entries, vocabulary);
  return new Map(queries.map(query => [query, index.search(query).size]));
}

const chip = (name, value, label, pressed) => `<button type="button" data-${name}="${esc(value)}" aria-pressed="${pressed}">${esc(label)}</button>`;

export function renderSearchPage({ prefix = '../', assets = {}, publicBuild = false, feedbackEndpoint = '', dailyHref, weeklyHref, examples, count }) {
  const asset = file => `${prefix}${file}${assets[file] ? `?v=${assets[file]}` : ''}`;
  const scripts = ["'self'", ...(publicBuild ? ['https://static.cloudflareinsights.com/beacon.min.js'] : [])];
  const tracking = publicBuild && Boolean(feedbackEndpoint);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
    `<meta name="referrer" content="no-referrer"><meta name="agenthub-root" content="${esc(prefix)}">` +
    (tracking ? `<meta name="agenthub-search-endpoint" content="${esc(feedbackEndpoint)}">` : '') +
    headTags({ section: 'search', title: '搜索 · AgentHub', url: searchUrl, llms: `${prefix}llms.txt`,
      description: '搜 AgentHub 的日报、周报和资料库，群里的缩写和代号也能搜。' }) +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; script-src ${scripts.join(' ')}; style-src 'self'; img-src 'self' data:; connect-src ${publicBuild ? ['https://cloudflareinsights.com', ...(tracking ? [esc(feedbackEndpoint)] : [])].join(' ') : "'none'"}; object-src 'none'; base-uri 'none'">` +
    `<link rel="canonical" href="${esc(searchUrl)}"><title>搜索 · AgentHub</title><link rel="icon" href="${favicon}"><script src="${esc(asset('appearance.js'))}"></script>` +
    `<link rel="stylesheet" href="${esc(asset('weekly.css'))}"><link rel="stylesheet" href="${esc(asset('library.css'))}"><link rel="stylesheet" href="${esc(asset('color-scheme.css'))}"></head>` +
    `<body data-page="search"><a class="skip" href="#content">跳至正文</a><div class="shell">` +
    `<header class="masthead"><div class="masthead-main"><a class="wordmark" href="${esc(prefix)}" translate="no">AgentHub<span>搜索</span></a><p class="issue-date"><span class="period">${count} 条</span><small>日报 · 周报 · 资料库</small></p></div></header>` +
    sectionNav(prefix, '', { dailyHref, weeklyHref }) +
    `<main id="content"><section class="filters search-filters" aria-label="搜索">` +
    `<label class="search">${searchIcon}<span class="visually-hidden">搜索</span><input type="search" id="site-search" placeholder="搜话题、模型或资料，比如 ${esc(examples.join('、'))}" autocomplete="off" enterkeyhint="search" autofocus></label>` +
    `<div class="filter-row"><span class="filter-label" id="kind-label">栏目</span><div class="chips" role="group" aria-labelledby="kind-label">${chip('kind', 'd', '日报', false)}${chip('kind', 'w', '周报', false)}${chip('kind', 'l', '资料库', false)}${chip('kind', 'o', '机会', false)}</div></div>` +
    `<div class="filter-row"><span class="filter-label" id="group-label">版面</span><div class="chips" role="group" aria-labelledby="group-label">${Object.entries(PAGES).map(([id, label]) => chip('group', id, label, false)).join('')}</div></div>` +
    `<div class="filter-row"><span class="filter-label" id="time-label">时间</span><div class="chips" role="group" aria-labelledby="time-label">${chip('time', '7', '近 7 天', false)}${chip('time', '30', '近 30 天', false)}</div></div>` +
    `<div class="filter-status"><p id="search-status" role="status" aria-live="polite">群里的叫法也能搜，比如 A社、oai、哈基米。</p><div class="sort" role="group" aria-label="排序"><button type="button" data-sort="relevance" aria-pressed="true">相关度</button><button type="button" data-sort="new" aria-pressed="false">最新</button></div></div></section>` +
    `<ol class="results" id="results"></ol><button type="button" class="results-more" id="results-more" hidden>显示更多</button></main>` +
    footer('搜索', tracking ? '为改进搜索，记录搜索词、筛选条件、结果数和点击，保留 30 天。不记录身份，请勿输入隐私信息。' : '搜索只在浏览器里进行，不上传。') + `</div>` +
    `<script src="${esc(asset('search/data.js'))}"></script><script src="${esc(asset('bm25.js'))}"></script><script src="${esc(asset('query.js'))}"></script>${tracking ? `<script src="${esc(asset('search-tracking.js'))}"></script>` : ''}<script src="${esc(asset('search.js'))}"></script>` +
    (tracking ? `<script defer src="${esc(asset('views.js'))}" data-endpoint="${esc(feedbackEndpoint)}"></script>` : '') +
    `${publicBuild ? `<script defer src="${esc(asset('analytics.js'))}"></script>` : ''}</body></html>`;
}

export async function writeSearchFiles(out, { entries, vocabulary, weeklyHref, publicBuild = false, feedbackEndpoint = '' }) {
  await mkdir(path.join(out, 'search'), { recursive: true });
  const data = { entries, expand: vocabulary.expand, synonyms: vocabulary.groups, groups: PAGES };
  await writeFile(path.join(out, 'search/data.js'), `window.AGENT_HUB_SEARCH = ${JSON.stringify(data).replaceAll('<', '\\u003c')};\n`);
  const assets = {};
  for (const file of ['weekly.css', 'library.css', 'bm25.js', 'query.js', 'search.js', 'search/data.js', 'appearance.js', 'color-scheme.css', ...(publicBuild ? ['analytics.js', 'search-tracking.js'] : []), ...(publicBuild && feedbackEndpoint ? ['views.js'] : [])]) {
    assets[file] = createHash('sha256').update(await readFile(path.join(out, file))).digest('hex').slice(0, 16);
  }
  const examples = ['RSI', 'computer use', 'A社'];
  await writeFile(path.join(out, 'search/index.html'), renderSearchPage({ assets, publicBuild, feedbackEndpoint, dailyHref: '../', weeklyHref, examples, count: entries.length }));
}
