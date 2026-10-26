import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { writeRoutePages } from '../lib/route-pages.mjs';
import { site } from '../lib/site.mjs';

const template = `<!doctype html><html><head>
<meta name="robots" content="noindex,nofollow">
<meta name="agenthub-root" content="./">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'none'">
<title>Agent Hub</title>
<link rel="canonical" href="https://old.example/">
<link rel="stylesheet" href="style.css?v=abc123">
<script src="./appearance.js?v=def456"></script>
<script defer src="data.js?v=789abc"></script>
<script defer src="routes.js?v=123def"></script>
<script defer src="https://example.com/external.js"></script>
</head><body><main id="reading"></main><a href="#reading">Read</a>
<a class="wordmark notranslate" href="./">AgentHub</a></body></html>`;

async function fixture(t) {
  const out = await mkdtemp(path.join(tmpdir(), 'agenthub-route-pages-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  await writeFile(path.join(out, 'index.html'), template);
  return out;
}

const issue = (date, heading = '群内分享') => ({
  date, pages: [{ id: 'group-1', heading, stories: [] }],
});

test('writes real directory indexes including missing sections and all ranking windows', async t => {
  const out = await fixture(t);
  const data = { digests: [issue('2026-09-27'), issue('2026-09-26')] };
  await writeRoutePages(out, data);
  const expected = ['index.html'];
  for (const { date } of data.digests) {
    for (const group of ['overview', 'group-1', 'group-2', 'group-3', 'group-4', 'external']) {
      expected.push(`daily/${date}/${group}/index.html`);
    }
  }
  for (const window of ['week', 'month', 'all']) {
    expected.push(`rank/${window}/index.html`);
    for (const group of ['group-1', 'group-2', 'group-3', 'group-4', 'group-5']) expected.push(`rank/${window}/${group}/index.html`);
  }
  const files = await readdir(out, { recursive: true });
  assert.deepEqual(files.filter(file => file.endsWith('.html')).sort(), expected.sort());
  for (const file of expected) {
    const { document } = parseHTML(await readFile(path.join(out, file), 'utf8'));
    const route = file === 'index.html' ? '' : file.slice(0, -'index.html'.length);
    const prefix = route.startsWith('daily/') || /^rank\/(?:week|month|all)\/group-/.test(route)
      ? '../../../' : route ? '../../' : './';
    assert.equal(document.querySelector('meta[name="agenthub-root"]').content, prefix);
    assert.equal(document.querySelector('link[rel="canonical"]').href, `${site}${route}`);
    assert.equal(document.querySelector('meta[name="robots"]').content, 'noindex,nofollow');
    assert.equal(document.querySelector('[http-equiv="Content-Security-Policy"]').content,
      "default-src 'self'; base-uri 'none'");
    assert.equal(document.querySelector('base'), null);
    assert.equal(document.querySelector('[http-equiv="refresh"]'), null);
    assert.ok(document.querySelector('#reading'));
    assert.equal(document.querySelector('a').getAttribute('href'), '#reading');
    const pageUrl = `${site}${route}`;
    const wordmark = document.querySelector('a.wordmark').getAttribute('href');
    assert.equal(wordmark, prefix);
    assert.equal(new URL(wordmark, pageUrl).href, site);
    for (const [name, hash] of [['style.css', 'abc123'], ['appearance.js', 'def456'], ['data.js', '789abc'], ['routes.js', '123def']]) {
      const element = document.querySelector(name.endsWith('.css') ? 'link[rel="stylesheet"]' : `script[src*="${name}"]`);
      const value = element.getAttribute(name.endsWith('.css') ? 'href' : 'src');
      if (route) assert.equal(value, `${prefix}${name}?v=${hash}`);
      assert.equal(new URL(value, pageUrl).href, `${site}${name}?v=${hash}`);
    }
    assert.equal(document.querySelector('script[src^="https:"]').src, 'https://example.com/external.js');
  }
  const absent = parseHTML(await readFile(path.join(out, 'daily/2026-09-27/group-2/index.html'), 'utf8')).document;
  assert.equal(absent.title, '二群 · 2026-09-27 · AgentHub');
  const fourth = parseHTML(await readFile(path.join(out, 'daily/2026-09-27/group-4/index.html'), 'utf8')).document;
  assert.equal(fourth.title, '四群 · 2026-09-27 · AgentHub');
  const rank = parseHTML(await readFile(path.join(out, 'rank/week/index.html'), 'utf8')).document;
  assert.equal(rank.title, '活跃榜 · 周榜 · AgentHub');
  const rankGroup = parseHTML(await readFile(path.join(out, 'rank/week/group-2/index.html'), 'utf8')).document;
  assert.equal(rankGroup.title, '活跃榜 · 周榜 · 二群 · AgentHub');
});

test('fifth-group routes start with its reader date without inventing historical pages', async t => {
  const out = await fixture(t);
  const next = issue('2026-10-20');
  next.pages.push({ id: 'group-5', heading: '五群今日讨论', stories: [{ title: '主题', text: '正文。' }] });
  await writeRoutePages(out, { digests: [issue('2026-10-19'), next, issue('2026-10-21')] });
  const files = await readdir(out, { recursive: true });
  assert.ok(!files.includes('daily/2026-10-19/group-5/index.html'));
  for (const date of ['2026-10-20', '2026-10-21']) assert.ok(files.includes(`daily/${date}/group-5/index.html`));
  const fifth = parseHTML(await readFile(path.join(out, 'daily/2026-10-20/group-5/index.html'), 'utf8')).document;
  assert.equal(fifth.title, '五群今日讨论 · 2026-10-20 · AgentHub');
  assert.equal(fifth.querySelector('link[rel="canonical"]').href, `${site}daily/2026-10-20/group-5/`);
  assert.equal(fifth.querySelector('link[rel="alternate"][type="text/markdown"]').href, 'index.md');
  const absent = parseHTML(await readFile(path.join(out, 'daily/2026-10-21/group-5/index.html'), 'utf8')).document;
  assert.equal(absent.title, '五群 · 2026-10-21 · AgentHub');
});

test('escapes page titles and rereads the latest root hashes when called after a data merge', async t => {
  const out = await fixture(t);
  const heading = 'A & B <研究> "</title><script id="injected">bad()</script>';
  await writeRoutePages(out, { digests: [issue('2026-09-27', heading)] });
  const target = path.join(out, 'daily/2026-09-27/group-1/index.html');
  const first = parseHTML(await readFile(target, 'utf8')).document;
  assert.equal(first.title, `${heading} · 2026-09-27 · AgentHub`);
  assert.equal(first.querySelector('#injected'), null);
  const rootFile = path.join(out, 'index.html');
  await writeFile(rootFile, (await readFile(rootFile, 'utf8')).replace('data.js?v=789abc', 'data.js?v=fresh123'));
  await writeRoutePages(out, { digests: [issue('2026-09-27', heading), issue('2026-09-28')] });
  const second = parseHTML(await readFile(target, 'utf8')).document;
  assert.equal(second.querySelector('script[src*="data.js"]').src, '../../../data.js?v=fresh123');
  assert.equal(second.querySelectorAll('meta[name="agenthub-root"]').length, 1);
  assert.equal(second.querySelectorAll('link[rel="canonical"]').length, 1);
  const root = parseHTML(await readFile(rootFile, 'utf8')).document;
  assert.equal(root.querySelector('meta[name="agenthub-root"]').content, './');
  assert.equal(root.querySelector('script[src*="data.js"]').src, 'data.js?v=fresh123');
  assert.ok(await readFile(path.join(out, 'daily/2026-09-28/external/index.html'), 'utf8'));
});

test('accepts a file URL output directory with encoded path characters', async t => {
  const parent = await fixture(t);
  const out = path.join(parent, 'preview space #中文');
  await mkdir(out);
  await writeFile(path.join(out, 'index.html'), template);
  const url = pathToFileURL(out + path.sep);
  await writeRoutePages(url, { digests: [issue('2026-09-27')] });
  const daily = parseHTML(await readFile(new URL('daily/2026-09-27/group-1/index.html', url), 'utf8')).document;
  assert.equal(daily.querySelector('a.wordmark').getAttribute('href'), '../../../');
  const rank = parseHTML(await readFile(new URL('rank/month/index.html', url), 'utf8')).document;
  assert.equal(rank.querySelector('a.wordmark').getAttribute('href'), '../../');
});

test('rejects unsafe or duplicate dates before writing any route', async t => {
  const out = await fixture(t);
  for (const digests of [[issue('../escape')], [issue('2026-09-27'), issue('2026-09-27')]]) {
    await assert.rejects(writeRoutePages(out, { digests }), /Invalid or duplicate route date/);
  }
  assert.deepEqual(await readdir(out), ['index.html']);
  assert.equal(await readFile(path.join(out, 'index.html'), 'utf8'), template);
});
