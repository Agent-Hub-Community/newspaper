// The community site and its newspaper use the same hand-drawn wordmark.
import wordmark from '../site/brand/wordmark.json' with { type: 'json' };
import favicon from '../site/brand/favicon.json' with { type: 'json' };
import { basePath } from './site.mjs';

export { favicon };
export const brandWordmark = `<svg class="brand-wordmark" xmlns="http://www.w3.org/2000/svg" viewBox="${wordmark.viewBox}" fill="none" stroke="currentColor" stroke-width="${wordmark.strokeWidth}" stroke-linecap="butt" stroke-linejoin="round" role="img" aria-label="AgentHub">${wordmark.letters.map(letter => `<path d="${letter.d}"/>`).join('')}</svg>`;
export const communityLink = `<a class="community-home" href="/">社群主页<span aria-hidden="true">↗</span></a>`;
export const colophon = `<div class="publication-colophon"><a class="colophon-brand" href="/" aria-label="AgentHub 社群主页">${brandWordmark}</a><nav aria-label="社群与订阅"><a href="/">社群主页 ↗</a><a href="${basePath}feed.xml">RSS ↗</a><a href="https://github.com/Agent-Hub-Community">GitHub ↗</a></nav></div>`;
