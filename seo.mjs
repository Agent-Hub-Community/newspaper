// Head metadata for link previews, search engines and generative search: description, Open Graph,
// JSON-LD and the robots directive. The community site stays out of search indexes until the owner
// lists a section here; a sitemap is only written for listed sections.
import { site } from './site.mjs';

export const INDEXED = new Set([]); // any of 'home', 'daily', 'weekly', 'library', 'glossary', 'agents'

const publisher = { '@type': 'Organization', name: 'AgentHub', url: site };
const attr = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clip = (text, limit = 150) => {
  const chars = [...String(text || '').replace(/\s+/g, ' ').trim()];
  return chars.length > limit ? `${chars.slice(0, limit - 1).join('')}…` : chars.join('');
};

// Member avatars appear on the library page, so its images stay out of image search even when indexed.
export const robots = section => INDEXED.has(section) ? `index,follow${section === 'library' ? ',noimageindex' : ''}` : 'noindex,nofollow';

export function jsonLd(kind, { title, description, url, date, through, first, keywords = [] }) {
  const base = { '@context': 'https://schema.org', inLanguage: 'zh-CN', url, description };
  if (kind === 'home') return { ...base, '@type': 'WebSite', name: 'AgentHub', publisher };
  if (kind === 'article') return { ...base, '@type': 'Article', headline: title, datePublished: date, isPartOf: { '@type': 'WebSite', name: 'AgentHub', url: site }, publisher };
  if (kind === 'dataset') return { ...base, '@type': 'Dataset', name: title, keywords, isAccessibleForFree: true, creator: publisher,
    dateModified: through, temporalCoverage: `${first}/${through}`,
    distribution: [
      { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${url}resources.json` },
      { '@type': 'DataDownload', encodingFormat: 'text/markdown', contentUrl: `${url}resources.md` },
    ] };
  return { ...base, '@type': 'WebPage', name: title, isPartOf: { '@type': 'WebSite', name: 'AgentHub', url: site } };
}

// Returns the tags as HTML; JSON-LD is a data block, so the pages' script-src CSP does not apply to it.
export function headTags({ section, title, description, url, markdown, llms, kind = 'page', ...rest }) {
  const data = JSON.stringify(jsonLd(kind, { title, description, url, ...rest })).replaceAll('<', '\\u003c');
  return `<meta name="description" content="${attr(description)}"><meta name="robots" content="${robots(section)}">` +
    `<meta property="og:site_name" content="AgentHub"><meta property="og:locale" content="zh_CN"><meta property="og:type" content="${kind === 'article' ? 'article' : 'website'}">` +
    `<meta property="og:title" content="${attr(title)}"><meta property="og:description" content="${attr(description)}"><meta property="og:url" content="${attr(url)}"><meta name="twitter:card" content="summary">` +
    (markdown ? `<link rel="alternate" type="text/markdown" href="${attr(markdown)}" title="Markdown">` : '') +
    // llms.txt v2 lets a page point agents at the site description.
    (llms ? `<link rel="describedby" type="text/plain" href="${attr(llms)}" title="llms.txt">` : '') +
    // Feed readers and agents discover the subscription feeds from any page; the feed files sit next to llms.txt.
    (llms ? `<link rel="alternate" type="application/feed+json" href="${attr(llms.replace(/llms\.txt$/, 'feed.json'))}" title="AgentHub">` +
      `<link rel="alternate" type="application/atom+xml" href="${attr(llms.replace(/llms\.txt$/, 'feed.xml'))}" title="AgentHub">` : '') +
    `<script type="application/ld+json">${data}</script>`;
}

export function sitemap(entries) {
  const listed = entries.filter(entry => INDEXED.has(entry.section));
  if (!listed.length) return null;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${listed.map(entry =>
    `  <url><loc>${attr(entry.url)}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
}
