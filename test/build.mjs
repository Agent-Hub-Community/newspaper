import { readFile, stat, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { validatePublicActivity } from '../lib/public-activity.mjs';
import { createHash } from 'node:crypto';
import { validateStoryDiscussion } from '../lib/story-discussion.mjs';
import { AGENTS_PAGE, dailyMarkdown } from '../lib/agent-docs.mjs';
import { searchIndex } from '../lib/search-render.mjs';
import { readingBase, readingLinks, readingNotice, readablePath } from '../lib/agent-reading.mjs';
import { basePath, site } from '../lib/site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), process.argv.includes('--preview') ? '../dist-preview' : '../dist');
const source = await readFile(path.join(root, 'data.js'), 'utf8');
const prefix = 'window.AGENT_HUB_DATA = ';
assert.ok(source.startsWith(prefix));
const data = JSON.parse(source.slice(prefix.length).trim().replace(/;$/, ''));
// data.js is an index; each issue's articles live in issues/<date>.js under a content hash.
const issuePrefix = 'window.AGENT_HUB_ISSUES = window.AGENT_HUB_ISSUES || {})';
const issues = {};
for (const index of data.digests) {
  const script = await readFile(path.join(root, 'issues', `${index.date}.js`), 'utf8');
  assert.equal(createHash('sha256').update(script).digest('hex').slice(0, 16), index.version, index.date);
  assert.ok(script.startsWith(`(${issuePrefix}[${JSON.stringify(index.date)}] = `), index.date);
  issues[index.date] = JSON.parse(script.slice(script.indexOf('] = ') + 4).trim().replace(/;$/, ''));
  assert.deepEqual(index.pages.map(page => page.id), issues[index.date].pages.map(page => page.id));
  // The index carries only navigation fields plus the public heading of pages that have articles.
  for (const [i, page] of index.pages.entries()) {
    assert.deepEqual(Object.keys(page).sort(), page.heading ? ['hasContent', 'heading', 'id', 'label'] : ['hasContent', 'id', 'label']);
    if (page.heading) assert.equal(page.heading, issues[index.date].pages[i].heading.trim());
    if (page.heading) assert.equal(page.hasContent, true);
  }
}
assert.ok(data.weeklies.every(issue => issue.pages.every(page => !('stories' in page))), 'weekly stories stay in the static weekly pages');
// /weekly/ always forwards to a page of the newest issue, so outside links never need updating.
const newestWeekly = data.weeklies.at(-1);
const weeklyForward = (await readFile(path.join(root, 'weekly/index.html'), 'utf8')).match(/http-equiv="refresh" content="0; url=([^"]+)"/)?.[1];
assert.ok(weeklyForward?.startsWith(`${newestWeekly.start || newestWeekly.from}/${newestWeekly.end || newestWeekly.through}/`), 'weekly index forwards to the newest issue');
assert.ok((await stat(path.join(root, 'weekly', weeklyForward, 'index.html'))).isFile());
const bundledSource = await readFile(path.join(root, 'export-images.js'), 'utf8');
const bundled = JSON.parse(bundledSource.slice('window.AGENT_HUB_EXPORT_IMAGES = '.length).trim().replace(/;$/, ''));
for (const [file, image] of Object.entries(bundled)) {
  assert.deepEqual(Buffer.from(image.split(',')[1], 'base64'), await readFile(path.join(root, file)));
}
assert.doesNotMatch(await readFile(path.join(root, 'index.html'), 'utf8'), /id="archive-range"/);
if (data.activity) {
  assert.doesNotMatch(JSON.stringify(data.activity), /"(?:count|counted|media|activeDays|policy|excluded|raw|participants)"/);
}
if (process.argv.includes('--public')) assert.equal(data.publicBuild, true, 'Deployment requires a public build');
assert.ok(data.digests.length > 0);
assert.equal('weeks' in data, false);
assert.equal('topics' in data, false);
const dates = data.digests.map(issue => issue.date).sort();
assert.deepEqual(data.coverage, { first: dates[0], last: dates.at(-1) });
assert.equal('days' in data, false);
assert.equal('sourceCounts' in data, false);
assert.doesNotMatch(await readFile(path.join(root, 'index.html'), 'utf8'), /data-mode="(?:day|week|topic)"|id="calendar-dialog"/);
const paths = await readdir(root, { recursive: true });
// Agent copies are the only published files this source-leak guard would otherwise catch.
const agentCopy = /^(?:index\.md|agents\/SKILL\.md|agents\/topics\/[a-z0-9:-]{1,200}\.(?:md|json)|library\/resources\.(?:json|md|schema\.json)|library\/opportunities\.(?:json|md)|glossary\/glossary\.(?:json|md)|daily\/\d{4}-\d{2}-\d{2}\/(?:(?:group-[1-5]|external)\/)?index\.md|weekly\/\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}\/index\.md)$/;
assert.ok(paths.every(p => agentCopy.test(p.split(path.sep).join('/')) || !/messages|audit|\.md$|sources/.test(p)));
assert.ok(paths.every(p => !p.startsWith('documents')));
const checkKeys = object => {
  if (!object || typeof object !== 'object') return;
  for (const [key, value] of Object.entries(object)) {
    if (key === 'discussion') { validateStoryDiscussion(value); continue; }
    assert.ok(!['messages', 'sourceCounts', 'author', 'time', 'textCount'].includes(key), key);
    checkKeys(value);
  }
};
checkKeys(data);
checkKeys(issues);
const catalog = JSON.parse(await readFile(path.join(root, 'search/catalog.json'), 'utf8'));
checkKeys(catalog);
assert.equal(new Set(catalog.entries.map(entry => entry.id)).size, catalog.entries.length);
for (const edition of catalog.editions) {
  assert.deepEqual(edition.sections.map(section => section.group), edition.groups);
  const outline = new URL(edition.outline_url);
  assert.equal(outline.searchParams.get('date'), edition.date);
  assert.equal(outline.searchParams.get('kind'), edition.kind);
  for (const section of edition.sections) {
    assert.ok(section.title.trim());
    assert.ok([...section.summary].length <= 160);
    if (section.read_url) {
      const readPath = section.read_url.slice(readingBase.length);
      assert.ok(readablePath(readPath));
      assert.ok((await readFile(path.join(root, readPath), 'utf8')).includes(section.url));
    }
  }
}
for (const entry of catalog.entries) {
  assert.ok(!('discussion' in entry), 'raw discussion is excluded from public topic copies');
  assert.ok(entry.read_url.startsWith(readingBase));
  const readPath = entry.read_url.slice(readingBase.length);
  assert.ok(readablePath(readPath), readPath);
  assert.ok((await readFile(path.join(root, readPath), 'utf8')).includes(entry.url));
  const detail = JSON.parse(await readFile(path.join(root, entry.read_path), 'utf8'));
  assert.deepEqual(detail, { schema_version: 1, ...entry });
}
if (data.publicBuild) {
  validatePublicActivity(data.activity, data.digests);
  assert.ok(paths.every(p => !p.includes('activity.local')));
  assert.deepEqual(paths.filter(p => p.startsWith('avatars/')).sort(), Object.values(data.activity.avatars).sort());
  assert.ok(Object.values(issues).every(issue => issue.pages.every(page => !page.figure?.src)));
}
const files = ['index.html', 'library/index.html', 'glossary/index.html', ...(AGENTS_PAGE ? ['agents/index.html'] : []), 'search/index.html', 'style.css', 'app.js', 'icons.js'];
// While the "给 Agent 用" page is paused, the build skips it and no page links to it.
if (!AGENTS_PAGE) {
  assert.ok(!paths.includes(path.join('agents', 'index.html')), 'agents/index.html is built while AGENTS_PAGE is off');
  for (const file of paths.filter(p => p.endsWith('.html'))) {
    assert.doesNotMatch(await readFile(path.join(root, file), 'utf8'), /agents-tab|href="[^"]*agents\/(?:index\.html)?"/, file);
  }
}
files.push(...Object.values(data.activity?.avatars || {}));
for (const file of files) {
  const absolute = path.resolve(root, file);
  assert.ok(absolute.startsWith(root + path.sep));
  assert.ok((await stat(absolute)).size > 0, file);
  if (file.endsWith('.html')) {
    const html = await readFile(absolute, 'utf8');
    const { document } = parseHTML(html);
    const scripts = [...document.querySelectorAll('script')].filter(s => s.src.split('?')[0].endsWith('analytics.js'));
    assert.equal(scripts.length, data.publicBuild ? 1 : 0, file);
    for (const element of document.querySelectorAll('script[src], link[rel="stylesheet"]')) {
      const asset = new URL(element.getAttribute(element.tagName === 'SCRIPT' ? 'src' : 'href'), `https://example.com/${file}`);
      const hash = createHash('sha256').update(await readFile(path.join(root, asset.pathname))).digest('hex').slice(0, 16);
      assert.equal(asset.searchParams.get('v'), hash);
    }
    const csp = document.querySelector('[http-equiv="Content-Security-Policy"]').content;
    if (data.publicBuild) {
      assert.match(csp, /script-src 'self' https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js/);
      assert.match(csp, /connect-src https:\/\/cloudflareinsights\.com/);
    } else {
      assert.doesNotMatch(html, /cloudflareinsights|analytics\.js/);
    }
  }
}
assert.equal(paths.includes('analytics.js'), data.publicBuild);
// Library: the page, its agent copies and the avatars it shows; the agent copies carry no avatars.
const library = JSON.parse(await readFile(path.join(root, 'library/resources.json'), 'utf8'));
const libraryPage = parseHTML(await readFile(path.join(root, 'library/index.html'), 'utf8')).document;
assert.equal(library.count, library.items.length);
assert.equal(libraryPage.querySelectorAll('.entry').length, library.items.length);
assert.doesNotMatch(JSON.stringify(library), /avatar|sender|wxid/);
assert.doesNotMatch(await readFile(path.join(root, 'library/resources.md'), 'utf8'), /library-avatars|wxid/);
for (const item of library.items) assert.ok(item.links.every(link => link.url.startsWith('https://')), item.id);
const shownAvatars = [...new Set([...libraryPage.querySelectorAll('.source img')].map(img => img.getAttribute('src').replace(/^\.\.\//, '')))].sort();
assert.deepEqual(paths.map(p => p.split(path.sep).join('/')).filter(p => /^library-avatars\/./.test(p)).sort(), shownAvatars);
assert.match(await readFile(path.join(root, 'llms.txt'), 'utf8'), /library\/resources\.json/);
// Subscription feeds: valid JSON Feed with the newest readable issue first, and pages that announce them.
const feed = JSON.parse(await readFile(path.join(root, 'feed.json'), 'utf8'));
assert.equal(feed.version, 'https://jsonfeed.org/version/1.1');
assert.ok(feed.items.length > 0 && feed.items.every(item => item.id && item.url && item.date_published));
assert.match(await readFile(path.join(root, 'feed.xml'), 'utf8'), /^<\?xml[^]*<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom"/);
assert.match(await readFile(path.join(root, 'index.html'), 'utf8'), /type="application\/feed\+json" href="\.\/feed\.json"/);
assert.match(await readFile(path.join(root, 'agents/SKILL.md'), 'utf8'), /^---\nname: agenthub\n/);
// Discussion fields must not affect machine-readable copies. A reviewed summary may quote
// the same phrase as a message, so substring matching cannot establish a leak.
const summaryIssues = data.digests.map(index => {
  const summary = structuredClone({ ...index, ...issues[index.date] });
  for (const page of summary.pages) for (const story of page.stories || []) delete story.discussion;
  return summary;
});
for (const [date, issue] of Object.entries(issues)) {
  const file = path.join(root, 'daily', date, 'index.md');
  const markdown = await readFile(file, 'utf8').catch(() => null);
  const readable = issue.pages.some(page => (page.stories || []).some(story => story.text?.trim()));
  assert.equal(Boolean(markdown), readable, `${date} Markdown copy`);
  if (readable) {
    const expected = dailyMarkdown(summaryIssues.find(item => item.date === date));
    assert.equal(markdown, data.publicBuild ? readingLinks(expected) + readingNotice : expected, `${date} Markdown includes discussion fields`);
  }
}
const searchData = await readFile(path.join(root, 'search/data.js'), 'utf8');
const searchPayload = JSON.parse(searchData.slice('window.AGENT_HUB_SEARCH = '.length).trim().replace(/;$/, ''));
assert.deepEqual(searchPayload.entries.filter(entry => entry.k === 'd'),
  searchIndex({ digests: summaryIssues, weeklies: [], library: { items: [] } }), 'Search index includes discussion fields');
// Every site link in a file written for agents, and every Markdown alternate of a page, reaches a built file.
const built = async (url, from) => {
  let target = new URL(url, from);
  if (target.href.startsWith(readingBase)) {
    const document = target.href.slice(readingBase.length).split(/[?#]/)[0];
    assert.ok(readablePath(document), `reader rejects ${document}`);
    target = new URL(document, site);
  }
  if (!target.href.startsWith(site)) return true;
  const rest = decodeURIComponent(target.pathname.slice(new URL(site).pathname.length));
  return stat(path.join(root, !rest || rest.endsWith('/') ? `${rest}index.html` : rest)).then(s => s.isFile(), () => false);
};
let checked = 0;
for (const file of paths.filter(p => /\.(?:md|txt|json)$/.test(p))) {
  const text = await readFile(path.join(root, file), 'utf8');
  // SKILL.md spells link patterns such as daily/YYYY-MM-DD/group-N/; those are templates, not links.
  for (let [url] of text.matchAll(/https:\/\/[^\s)"'<>\]`（），。；：、]*/g)) {
    if (!url.startsWith(site) && !url.startsWith(readingBase)) continue;
    url = url.replace(/[.,:;]+$/, '');
    if (/YYYY|group-N|-K\b|日期/.test(url)) continue;
    assert.ok(await built(url), `${file} links to ${url}, which the build does not write`);
    checked++;
  }
}
assert.ok(checked > 1000, `checked ${checked} site links in agent files`);
for (const file of ['llms.txt', 'index.md', 'agents/SKILL.md']) {
  const text = await readFile(path.join(root, file), 'utf8');
  assert.equal(text.includes(readingBase), Boolean(data.publicBuild), `${file} reader links follow public-build mode`);
  // curl and Python send raw Chinese as bytes the edge rejects with an empty 400, so examples stay encoded.
  for (const [url] of text.matchAll(/https:\/\/agenthub-feedback\.haoqingeric\.workers\.dev\/(?:content|library)\/\S*/g)) {
    assert.match(url, /^[\x21-\x7e]+$/, `${file} API example ${url} is not percent-encoded ASCII`);
  }
}
for (const page of paths.filter(p => p.endsWith('.html'))) {
  const href = parseHTML(await readFile(path.join(root, page), 'utf8')).document.querySelector('link[rel="alternate"][type="text/markdown"]')?.getAttribute('href');
  if (href) assert.ok(await built(href, new URL(page.split(path.sep).join('/'), site)), `${page} names a missing Markdown copy ${href}`);
}
// Rank pages carry their own section name in the masthead and footer before any script runs.
const rankPage = parseHTML(await readFile(path.join(root, 'rank/week/index.html'), 'utf8')).document;
assert.equal(rankPage.querySelector('.wordmark span').textContent, '活跃榜');
assert.equal(rankPage.querySelector('#footer-label').textContent, 'AGENT HUB / 活跃榜');
// Until a section is listed in seo.mjs, every page stays out of search indexes.
const { INDEXED } = await import('../lib/seo.mjs');
if (!INDEXED.size) {
  assert.ok(!paths.includes('sitemap.xml'));
  for (const page of paths.filter(p => p.endsWith('.html') && p !== '404.html')) {
    const robots = parseHTML(await readFile(path.join(root, page), 'utf8')).document.querySelector('meta[name="robots"]')?.getAttribute('content');
    assert.equal(robots, 'noindex,nofollow', page);
  }
}
assert.equal(Boolean(libraryPage.querySelector('meta[name="agenthub-feedback"]')), Boolean(data.feedbackEndpoint));
// Pages serves 404.html at whatever missing path was requested, so every link must resolve from any depth.
const notFound = parseHTML(await readFile(path.join(root, '404.html'), 'utf8')).document;
assert.equal(notFound.querySelectorAll('script').length, 0);
const missing = new URL(`${site}documents/2026-09-21-ai-safety-full.html`);
for (const element of notFound.querySelectorAll('[href], [src]')) {
  const value = element.getAttribute('href') ?? element.getAttribute('src');
  if (value.startsWith('data:')) continue;
  const target = new URL(value, missing);
  assert.equal(target.origin, missing.origin, value);
  assert.ok(target.pathname.startsWith(basePath), value);
  const built = path.join(root, target.pathname.slice(basePath.length) || 'index.html');
  assert.ok(await stat(built).then(s => s.isFile(), () => false), `404 link ${value} does not reach a built file`);
}
console.log(`Verified ${data.digests.length} daily editions and ${files.length} assets; discussion fields validated, private source metadata excluded.`);
