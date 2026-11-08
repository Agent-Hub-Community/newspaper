// The community site and its newspaper use the same hand-drawn wordmark, sections and site map.
import wordmark from '../site/brand/wordmark.json' with { type: 'json' };
import favicon from '../site/brand/favicon.json' with { type: 'json' };
import { basePath } from './site.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export { favicon };
export const brandWordmark = `<svg class="brand-wordmark" xmlns="http://www.w3.org/2000/svg" viewBox="${wordmark.viewBox}" fill="none" stroke="currentColor" stroke-width="${wordmark.strokeWidth}" stroke-linecap="butt" stroke-linejoin="round" role="img" aria-label="Agent Hub">${wordmark.letters.map(letter => `<path d="${letter.d}"/>`).join('')}</svg>`;
// The homepage's mark, ahead of the wordmark as in the homepage header; it leads back to the homepage. The image is
// the inlined favicon, so a publication page needs nothing from the homepage to draw it.
export const brandHome = `<a class="brand-home" href="/" aria-label="Agent Hub 社群主页"><img src="${favicon}" alt="" width="28" height="28"></a>`;
// The homepage header ends with the way in; so does every masthead. The homepage is on the same site, so these are
// ordinary links, not outbound ones.
export const communityLink = `<a class="community-home" href="/community.html#join">加入社群<span aria-hidden="true">›</span></a>`;

// The whole Agent Hub site, mirrored from the homepage (agent-hub-community.github.io/src/site-map.js) so every
// footer on both sites lists the same places. Paths are root-relative: the homepage and this newspaper share an origin.
export const SITE_MAP = [
  ['阅读', [['日报', basePath], ['周报', `${basePath}weekly/`], ['资料库', `${basePath}library/`], ['黑话', `${basePath}glossary/`],
    ['活跃榜', `${basePath}rank/week/`], ['搜索', `${basePath}search/`], ['机会', `${basePath}library/#opportunities`]]],
  ['社群', [['社群资料', '/community.html'], ['研究方向', '/community.html#topics'], ['讨论摘录', '/community.html#discussions'], ['加入社群', '/community.html#join']]],
  ['给 Agent 读', [['llms.txt', `${basePath}llms.txt`], ['Agent Skill', `${basePath}agents/SKILL.md`], ['RSS / Atom', `${basePath}feed.xml`], ['JSON Feed', `${basePath}feed.json`]]],
  ['开源', [['GitHub', 'https://github.com/Agent-Hub-Community'], ['日报仓库', 'https://github.com/Agent-Hub-Community/newspaper'],
    ['Skills 仓库', 'https://github.com/Agent-Hub-Community/skills']]],
];

export const colophon = `<div class="publication-colophon"><div class="colophon-lead"><a class="colophon-brand" href="/" aria-label="Agent Hub 社群主页">${brandWordmark}</a>` +
  `<p>让做 Agent 的人彼此找到。</p></div><nav class="colophon-map" aria-label="全站导航">` +
  SITE_MAP.map(([heading, links]) => `<div><h2>${heading}</h2><ul>${links.map(([label, href]) => `<li><a href="${esc(href)}">${label}</a></li>`).join('')}</ul></div>`).join('') +
  `</nav></div>`;

// The publication's sections, then the community page, in the order of the homepage header.
const SECTIONS = [['daily', '日报'], ['weekly', '周报'], ['library', '资料库'], ['glossary', '黑话'], ['rank', '活跃榜'], ['community', '社群']];

// The section tabs every static page shares. `prefix` leads from the page back to the publication root.
export function publicationTabs(prefix, current, { dailyHref, weeklyHref, agents = false }) {
  const href = { daily: dailyHref, weekly: weeklyHref, library: `${prefix}library/`, glossary: `${prefix}glossary/`, rank: `${prefix}rank/week/`, community: '/community.html', agents: `${prefix}agents/` };
  const tab = (id, label, extra = '') => `<a href="${esc(href[id])}"${extra}${id === current ? ' aria-current="page"' : ''}>${label}</a>`;
  const classes = { glossary: ' class="glossary-tab"', community: ' class="community-tab"' };
  return SECTIONS.map(([id, label]) => tab(id, label, classes[id] || '')).join('') +
    (agents ? tab('agents', '给 Agent 用', ' class="agents-tab"') : '');
}
