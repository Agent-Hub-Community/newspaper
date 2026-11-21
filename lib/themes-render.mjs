import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { brandHome, brandWordmark, communityLink } from './brand.mjs';
import { esc, favicon, footer, sectionNav, mastheadSections } from './library-render.mjs';
import { headTags } from './seo.mjs';
import { site } from './site.mjs';

export const themesUrl = `${site}themes/`;

const KIND_LABELS = {
  holiday: '节日皮肤',
  milestone: '里程碑特刊',
  knowledge: '知识专题',
  community: '社区活动',
};

const shortDate = iso => String(iso || '').slice(0, 10).replaceAll('-', '.');

export function renderThemesPage({ themes, prefix = '../', assets = {}, publicBuild = false, feedbackEndpoint = '', dailyHref, weeklyHref }) {
  const asset = file => `${prefix}${file}${assets[file] ? `?v=${assets[file]}` : ''}`;
  const scripts = ["'self'", ...(publicBuild ? ['https://static.cloudflareinsights.com/beacon.min.js'] : [])];
  const views = publicBuild && Boolean(feedbackEndpoint);
  const connections = [...(publicBuild ? ['https://cloudflareinsights.com'] : []), ...(views ? [new URL(feedbackEndpoint).origin] : [])];

  const plugins = [...(themes?.plugins || [])].sort((a, b) => (b.version || 1) - (a.version || 1) || a.id.localeCompare(b.id));
  const campaigns = themes?.campaigns || [];
  const editions = themes?.editions || {};

  const cards = plugins.map(plugin => {
    const colors = plugin.previewColors || {
      bandBg: '#101b36', bandInk: '#f5f7fc', bandMuted: '#bfd0ec', bandAccent: '#f5cf7a', bandRule: '#42598a',
    };
    const pluginCampaigns = campaigns.filter(c => c.skin === plugin.id);
    const boundDates = Object.entries(editions).filter(([, id]) => id === plugin.id).map(([d]) => d);
    const scheduleParts = [
      ...pluginCampaigns.map(c => `档期 ${shortDate(c.startsAt)} – ${shortDate(c.endsAt)}`),
      ...(boundDates.length ? [`特刊期号 ${boundDates.map(d => d.replaceAll('-', '.')).join('、')}`] : []),
    ];
    const capabilities = [
      plugin.version === 2 ? 'v2 声明式主题' : 'v1 节日皮肤',
      ...(plugin.widget ? ['含交互微彩蛋'] : []),
      ...(plugin.knowledge?.relatedItems?.length ? [`关联 ${plugin.knowledge.relatedItems.length} 条各群讨论`] : []),
      ...(plugin.home ? ['联动官网首页'] : []),
    ];
    const artHtml = plugin.image
      ? `<img class="theme-card-art${plugin.artStyle === 'vector' ? ' is-vector' : ''}" src="${esc(prefix + plugin.image)}" alt="${esc(plugin.artAlt || plugin.name)}" loading="lazy" decoding="async">`
      : '';
    return `<article class="theme-archive-card" data-theme-card="${esc(plugin.id)}">` +
      `<div class="theme-card-banner" style="background:${esc(colors.bandBg)};color:${esc(colors.bandInk)};border-bottom:1px solid ${esc(colors.bandRule)}">` +
        `<div class="theme-card-banner-copy">` +
          `<span class="theme-card-eyebrow" style="color:${esc(colors.bandMuted)}">${esc(plugin.eyebrow)}</span>` +
          `<div class="theme-card-brand"><strong>Agent Hub</strong><span style="color:${esc(colors.bandAccent)}">${esc(plugin.label)}</span></div>` +
          `<p class="theme-card-msg" style="color:${esc(colors.bandMuted)}">${esc(plugin.message)}</p>` +
        `</div>` +
        `${artHtml}` +
      `</div>` +
      `<div class="theme-card-body">` +
        `<div class="theme-card-meta">` +
          `<span class="theme-card-kind">${esc(KIND_LABELS[plugin.kind] || '特别主题')}</span>` +
          `${capabilities.map(cap => `<span class="theme-card-cap">${esc(cap)}</span>`).join('')}` +
        `</div>` +
        `<h2>${esc(plugin.name)}</h2>` +
        `<p class="theme-card-summary">${esc(plugin.summary || plugin.message)}</p>` +
        `${scheduleParts.length ? `<p class="theme-card-schedule">${esc(scheduleParts.join(' · '))}</p>` : ''}` +
        `<div class="theme-card-actions">` +
          `<a class="theme-card-primary" href="${esc(prefix)}?theme=${esc(encodeURIComponent(plugin.id))}">在日报中体验 →</a>` +
          `<a class="theme-card-secondary" href="?theme=${esc(encodeURIComponent(plugin.id))}" data-theme-switch="${esc(plugin.id)}">本页试穿</a>` +
          `${plugin.socialCard ? `<a class="theme-card-secondary" href="${esc(prefix + plugin.socialCard)}" target="_blank" rel="noopener noreferrer">分享封面 ↗</a>` : ''}` +
        `</div>` +
      `</div>` +
    `</article>`;
  }).join('');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
    `<meta name="referrer" content="no-referrer"><meta name="agenthub-root" content="${esc(prefix)}">` +
    headTags({ section: 'themes', title: '主题档案馆 · Agent Hub', url: themesUrl, llms: `${prefix}llms.txt`,
      description: `Agent Hub 日报与社区历次节日皮肤、AI 里程碑特刊与知识主题档案馆（共 ${plugins.length} 套）。` }) +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; script-src ${scripts.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ${connections.join(' ') || "'none'"}; object-src 'none'; base-uri 'none'">` +
    `<link rel="canonical" href="${esc(themesUrl)}"><title>主题档案馆 · Agent Hub</title><link rel="icon" href="${favicon}"><script src="${esc(asset('appearance.js'))}"></script>` +
    (assets['library.bundle.css']
      ? `<link rel="stylesheet" href="${esc(asset('library.bundle.css'))}">`
      : `<link rel="stylesheet" href="${esc(asset('weekly.css'))}"><link rel="stylesheet" href="${esc(asset('library.css'))}"><link rel="stylesheet" href="${esc(asset('color-scheme.css'))}"><link rel="stylesheet" href="${esc(asset('community.css'))}"><link rel="stylesheet" href="${esc(asset('skins.css'))}">`) + `</head>` +
    `<body data-page="themes"><a class="skip" href="#content">跳至正文</a><div class="shell">` +
    `<header class="masthead"><div class="masthead-brand"><div class="masthead-top"><span></span></div><div class="masthead-main">${brandHome}<a class="wordmark" href="${esc(prefix)}themes/" translate="no">${brandWordmark}<span>主题馆</span></a><p class="issue-date"><span class="period">${plugins.length} 套</span><small>节日 · 里程碑 · 专题</small></p>${mastheadSections(prefix, '', { dailyHref, weeklyHref })}${communityLink}</div><img class="skin-art" alt="" hidden><img class="skin-flora" alt="" hidden><div class="skin-note" hidden><span class="skin-label"></span><span class="skin-message"></span></div></div></header>` +
    sectionNav(prefix, '', { dailyHref, weeklyHref }) +
    `<main id="content"><header class="heading"><div class="heading-top"><p class="kicker">Agent Hub Doodles &amp; Editions</p><span class="heading-links"><a class="rank-link" href="?theme=default" data-theme-switch="default">切回常规样式</a></span></div>` +
    `<h1>特别主题档案馆</h1><p class="intro">收录 Agent Hub 在重要节日、AI 与科学里程碑、以及社区专题期间发布过的全部主题插件。点击任意主题即可预览完整刊头、配色与交互彩蛋。</p></header>` +
    `<section class="theme-archive-grid" aria-label="全部主题">${cards}</section></main>` +
    `${footer('主题馆', '基于 Theme Pack v2 声明式主题插件体系构建。')}</div>` +
    (assets['skins.bundle.js']
      ? `<script defer src="${esc(asset('skins.bundle.js'))}"></script>`
      : `<script defer src="${esc(asset('themes.js'))}"></script><script defer src="${esc(asset('skins.js'))}"></script>`) +
    (views ? `<script defer src="${esc(asset('views.js'))}" data-endpoint="${esc(feedbackEndpoint)}"></script>` : '') +
    `${publicBuild ? `<script defer src="${esc(asset('analytics.js'))}"></script>` : ''}</body></html>`;
}

export async function writeThemesPage(out, { themes, weeklyHref, publicBuild = false, feedbackEndpoint = '' }) {
  const directory = path.join(out, 'themes');
  await mkdir(directory, { recursive: true });
  const assets = {};
  for (const file of ['weekly.css', 'library.css', 'appearance.js', 'color-scheme.css', 'community.css', ...(publicBuild ? ['analytics.js'] : []), ...(publicBuild && feedbackEndpoint ? ['views.js'] : [])]) {
    assets[file] = createHash('sha256').update(await readFile(path.join(out, file))).digest('hex').slice(0, 16);
  }
  for (const file of ['library.bundle.css', 'skins.bundle.js', 'skins.css', 'themes.js', 'skins.js']) {
    const bytes = await readFile(path.join(out, file)).catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error)));
    if (bytes) assets[file] = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  }
  await writeFile(path.join(directory, 'index.html'), renderThemesPage({
    themes, assets, publicBuild, feedbackEndpoint, dailyHref: '../', weeklyHref,
  }));
}
