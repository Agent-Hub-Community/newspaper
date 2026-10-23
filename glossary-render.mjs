// Writes the glossary page and its agent copies (JSON and Markdown).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CATEGORIES, glossaryJson, glossaryMarkdown, glossaryUrl } from './glossary.mjs';
import { esc, favicon, footer, sectionNav } from './library-render.mjs';
import { headTags } from './seo.mjs';

const dot = date => String(date || '').replaceAll('-', '.');

// counts: site search results per term. A term with none gets no search link; the count itself is not shown,
// because expansions to descriptive Chinese names still bring in loose matches.
export function renderGlossaryPage(glossary, { prefix = '../', assets = {}, publicBuild = false, dailyHref, weeklyHref, counts = new Map() }) {
  const asset = file => `${prefix}${file}${assets[file] ? `?v=${assets[file]}` : ''}`;
  const scripts = ["'self'", ...(publicBuild ? ['https://static.cloudflareinsights.com/beacon.min.js'] : [])];
  const categories = CATEGORIES.filter(category => glossary.terms.some(entry => entry.category === category));
  const term = entry => `<div class="term" id="${esc(encodeURIComponent(entry.term))}"><dt>${esc(entry.term)}` +
    (entry.variants.length ? `<span class="term-variants">${entry.variants.map(esc).join(' · ')}</span>` : '') + `</dt>` +
    `<dd>${esc(entry.meaning)}${entry.refersTo ? `<span class="term-refers">指 ${esc(entry.refersTo)}</span>` : ''}` +
    (entry.keyword ? `<a class="inline-link" href="${esc(`${prefix}library/?kw=${encodeURIComponent(entry.keyword)}`)}">相关资料</a>` : '') +
    (counts.get(entry.term) ? `<a class="inline-link" href="${esc(`${prefix}search/?q=${encodeURIComponent(entry.term)}`)}">站内搜索</a>` : '') + `</dd></div>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
    `<meta name="referrer" content="no-referrer"><meta name="agenthub-root" content="${esc(prefix)}">` +
    headTags({ section: 'glossary', title: 'AgentHub 群聊黑话', url: glossaryUrl, markdown: 'glossary.md', llms: `${prefix}llms.txt`,
      description: `AgentHub 群里常用的 ${glossary.terms.length} 个缩写、代号、梗和行话分别是什么意思。` }) +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; script-src ${scripts.join(' ')}; style-src 'self'; img-src 'self' data:; connect-src ${publicBuild ? 'https://cloudflareinsights.com' : "'none'"}; object-src 'none'; base-uri 'none'">` +
    `<link rel="canonical" href="${esc(glossaryUrl)}"><link rel="alternate" type="application/json" href="glossary.json" title="AgentHub 群聊黑话 JSON">` +
    `<title>群聊黑话 · AgentHub</title><link rel="icon" href="${favicon}"><script src="${esc(asset('appearance.js'))}"></script>` +
    `<link rel="stylesheet" href="${esc(asset('weekly.css'))}"><link rel="stylesheet" href="${esc(asset('library.css'))}"><link rel="stylesheet" href="${esc(asset('color-scheme.css'))}"></head>` +
    `<body data-page="glossary"><a class="skip" href="#content">跳至正文</a><div class="shell">` +
    `<header class="masthead"><div class="masthead-main"><a class="wordmark" href="${esc(prefix)}library/" translate="no">AgentHub<span>黑话词典</span></a><p class="issue-date"><span class="period">${glossary.terms.length} 条</span><small>收录至 ${esc(dot(glossary.through))}</small></p></div></header>` +
    sectionNav(prefix, 'library', { dailyHref, weeklyHref }) +
    `<main id="content"><header class="heading"><div class="heading-top"><p class="kicker">群聊黑话</p><a class="rank-link" href="${esc(prefix)}library/">回到资料库</a></div>` +
    `<h1>群里常用的缩写、代号和梗</h1><p class="intro">日报和群聊里看不懂的说法，来这儿查。群友的外号不收。</p>` +
    `<nav class="term-index" aria-label="分类">${categories.map(category => `<a href="#${esc(category)}">${esc(category)}<span class="chip-count">${glossary.terms.filter(entry => entry.category === category).length}</span></a>`).join('')}</nav></header>` +
    categories.map(category => `<section class="term-section" id="${esc(category)}" aria-labelledby="${esc(category)}-title"><h2 id="${esc(category)}-title">${esc(category)}</h2>` +
      `<dl class="glossary">${glossary.terms.filter(entry => entry.category === category).map(term).join('')}</dl></section>`).join('') +
    `</main>${footer('黑话词典', '新说法会陆续补上。')}</div>` +
    `${publicBuild ? `<script defer src="${esc(asset('analytics.js'))}"></script>` : ''}</body></html>`;
}

export async function writeGlossaryFiles(out, { glossary, counts, weeklyHref, publicBuild = false }) {
  const directory = path.join(out, 'glossary');
  await mkdir(directory, { recursive: true });
  const assets = {};
  for (const file of ['weekly.css', 'library.css', 'appearance.js', 'color-scheme.css', ...(publicBuild ? ['analytics.js'] : [])]) {
    assets[file] = createHash('sha256').update(await readFile(path.join(out, file))).digest('hex').slice(0, 16);
  }
  await writeFile(path.join(directory, 'index.html'), renderGlossaryPage(glossary, { assets, publicBuild, dailyHref: '../', weeklyHref, counts }));
  await writeFile(path.join(directory, 'glossary.json'), `${JSON.stringify(glossaryJson(glossary), null, 2)}\n`);
  await writeFile(path.join(directory, 'glossary.md'), glossaryMarkdown(glossary));
}
