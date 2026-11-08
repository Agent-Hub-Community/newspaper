// Parent paths of the routes (daily/, daily/<date>/, rank/, weekly/<start>/, weekly/<start>/<end>/) have no page of
// their own. People shorten URLs to reach them, so each one forwards to the page it stands for instead of a 404.
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { robots } from './seo.mjs';
import { site } from './site.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const readable = page => [page.stories, page.trends, page.papers].some(items => items?.some(entry => typeof entry.text === 'string' && entry.text.trim()));

// The page a daily issue opens on, as the reader does it (site/app.js selectPage): the overview when more than one
// section has something to read, otherwise that one section. An issue with nothing to read still opens its overview.
export function dailyLanding(issue) {
  const pages = issue.pages.filter(readable);
  return pages.length === 1 ? pages[0].id : 'overview';
}

// Each route is a directory under the publication root; each target is relative to that directory.
export function redirectRoutes(data) {
  const routes = [];
  const latest = data.digests.filter(issue => issue.pages.some(readable)).at(-1);
  if (latest) routes.push({ route: 'daily/', target: `${latest.date}/${dailyLanding(latest)}/`, label: `${latest.date} 日报` });
  for (const issue of data.digests) routes.push({ route: `daily/${issue.date}/`, target: `${dailyLanding(issue)}/`, label: `${issue.date} 日报` });
  routes.push({ route: 'rank/', target: 'week/', label: '活跃榜 · 周榜' });
  for (const issue of data.weeklies) {
    const start = issue.start || issue.from, end = issue.end || issue.through;
    routes.push({ route: `weekly/${start}/${end}/`, target: 'overview/', label: `${start} 至 ${end} 周报` });
    routes.push({ route: `weekly/${start}/`, target: `${end}/overview/`, label: `${start} 至 ${end} 周报` });
  }
  return routes;
}

export function redirectPage({ route, target, label }) {
  const absolute = new URL(target, new URL(route, site)).href;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="${robots('forward')}"><link rel="canonical" href="${esc(absolute)}"><title>${esc(label)} · Agent Hub</title>` +
    // Keep a #topic anchor when forwarding; the refresh is the fallback without scripts.
    `<script>location.replace(new URL(${JSON.stringify(target)}, location.href).href + location.search + location.hash)</script>` +
    `<meta http-equiv="refresh" content="0; url=${esc(target)}">` +
    `<style>body{margin:0;display:grid;place-items:center;min-height:100svh;background:#f7f9fc;color:#596a81;font:15px/1.8 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}a{color:#315c99}` +
    `@media (prefers-color-scheme:dark){body{background:#0c1320;color:#99aac2}a{color:#9bc7ef}}</style></head>` +
    `<body><p>正在打开 <a href="${esc(target)}">${esc(label)}</a></p></body></html>\n`;
}

// Writes the forwarding pages without replacing any page the build already wrote.
export async function writeRedirectPages(out, data) {
  const written = [];
  for (const entry of redirectRoutes(data)) {
    const file = path.join(out, entry.route, 'index.html');
    if (await stat(file).then(() => true, () => false)) continue;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, redirectPage(entry));
    written.push(entry.route);
  }
  return written;
}
