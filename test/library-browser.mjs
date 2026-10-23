// Library page: filters, search, shareable state, hearts (device-only and against a mocked worker),
// navigation from the other sections, and phone layout. Run after `npm run build`.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { AGENTS_PAGE } from '../agent-docs.mjs';
import { basePath } from '../site.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const shots = path.join(root, 'output/playwright/library');
await mkdir(shots, { recursive: true });
const endpoint = 'https://feedback.test';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };
// The worker endpoint only exists in public builds; inject it here to exercise the online path.
let withEndpoint = false;
const server = http.createServer(async (request, response) => {
  let file = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  if (file.startsWith(basePath)) file = file.slice(basePath.length - 1);
  if (file.endsWith('/')) file += 'index.html';
  try {
    let body = await readFile(path.join(dist, file));
    if (withEndpoint && file === '/library/index.html') {
      body = body.toString()
        .replace('<meta http-equiv', `<meta name="agenthub-feedback" content="${endpoint}"><meta http-equiv`)
        .replace("connect-src 'none'", `connect-src ${endpoint}`);
    }
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
}).listen(0);
const site = `http://127.0.0.1:${server.address().port}${basePath}`;
const library = JSON.parse(await readFile(path.join(dist, 'library/resources.json'), 'utf8'));
const total = library.items.length;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });

async function open(url, options = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  return { context, page, errors };
}
const visible = page => page.locator('.entry:not([hidden])');
const query = page => new URL(page.url()).search;

try {
  for (const [label, viewport, hasTouch] of [['desktop', { width: 1440, height: 1000 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const { context, page, errors } = await open(`${site}library/`, { viewport, hasTouch });
    assert.equal(await visible(page).count(), total);
    assert.equal(await page.locator('#library-status').textContent(), `共 ${total} 项`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: no sideways scroll`);

    // Topic, then type: the list narrows, the URL records both, and each chip counts within the other filter.
    await page.locator('.chips [data-filter="topic"][data-value="computer-use"]').click();
    const topicCount = await visible(page).count();
    assert.ok(topicCount > 0 && topicCount < total);
    for (const topics of await visible(page).evaluateAll(nodes => nodes.map(node => node.dataset.topic))) assert.ok(topics.split('|').includes('computer-use'));
    assert.equal(query(page), '?topic=computer-use');
    await page.locator('.chips [data-filter="type"][data-value="benchmark"]').click();
    const both = await visible(page).count();
    assert.ok(both > 0 && both <= topicCount);
    assert.equal(await page.locator('.chips [data-filter="topic"][data-value="computer-use"] .chip-count').textContent(), String(both));
    assert.equal(await page.locator('#library-status').textContent(), `显示 ${both} / ${total} 项`);
    assert.equal(query(page), '?topic=computer-use&type=benchmark');

    // Choosing a value again lifts it; two values in one filter widen the list; the applied tags name each condition and remove it.
    await page.locator('.chips [data-filter="type"][data-value="benchmark"]').click();
    assert.equal(await page.locator('.chips [data-filter="type"][aria-pressed="true"]').count(), 0);
    assert.equal(await visible(page).count(), topicCount);
    await page.locator('.chips [data-filter="topic"][data-value="memory"]').click();
    const either = await visible(page).count();
    for (const topics of await visible(page).evaluateAll(nodes => nodes.map(node => node.dataset.topic.split('|')))) assert.ok(topics.includes('computer-use') || topics.includes('memory'));
    assert.ok(either > topicCount);
    assert.deepEqual(await page.locator('.applied [data-remove="topic"]').evaluateAll(nodes => nodes.map(node => node.dataset.value)), ['computer-use', 'memory']);
    assert.equal(query(page), '?topic=computer-use&topic=memory');
    await page.locator('.applied [data-remove="topic"][data-value="memory"]').click();
    assert.equal(await visible(page).count(), topicCount);
    await page.locator('.chips [data-filter="type"][data-value="benchmark"]').click();

    // The filtered address restores the same view.
    await page.reload();
    assert.equal(await visible(page).count(), both);
    assert.equal(await page.locator('.chips [data-filter="type"][data-value="benchmark"]').getAttribute('aria-pressed'), 'true');

    // Search narrows across title, summary and link address; no match shows the reset action.
    await page.locator('.chips [data-filter="topic"][data-value="computer-use"]').click();
    await page.locator('.chips [data-filter="type"][data-value="benchmark"]').click();
    assert.equal(await visible(page).count(), total);
    await page.locator('#library-search').fill('osworld');
    await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'osworld');
    assert.ok(await visible(page).count() >= 1);
    for (const text of await visible(page).allTextContents()) assert.match(text.toLowerCase(), /osworld/);
    // An alias finds items tagged with the canonical keyword even when the card never shows the alias.
    const { vocabulary } = JSON.parse(await page.locator('#library-search-data').textContent());
    const [alias, [canonical]] = Object.entries(vocabulary.expand).find(([key, list]) => list.length
      && library.items.some(item => item.keywords.includes(list[0])) && key !== list[0].toLowerCase());
    await page.locator('#library-search').fill(alias);
    await page.waitForFunction(value => new URL(location.href).searchParams.get('q') === value, alias);
    assert.ok(await visible(page).count() >= 1, `alias ${alias}`);
    assert.ok((await visible(page).evaluateAll(nodes => nodes.map(node => node.dataset.keyword.split('|')))).some(list => list.includes(canonical)));
    await page.locator('#library-search').fill('');

    // No result: each suggestion removes one condition and says how many items come back.
    await page.locator('.chips [data-filter="topic"][data-value="computer-use"]').click();
    await page.locator('#library-search').fill('zzqqxx');
    await page.locator('.library-empty').waitFor();
    assert.match(await page.locator('.relax').textContent(), /不限搜索词，有 \d+ 项/);
    await page.locator('.relax [data-remove="q"]').click();
    assert.equal(await page.locator('#library-search').inputValue(), '');
    assert.ok(await visible(page).count() > 0);
    await page.locator('#library-search').fill('zzqqxx');
    await page.locator('.library-empty').waitFor();
    await page.locator('#library-reset').click();
    assert.equal(await visible(page).count(), total);
    assert.equal(query(page), '');

    // Keywords: the most common show first, the rest expand; a keyword tag on a card filters to it.
    const keywordChip = page.locator('.chips [data-filter="keyword"]').first();
    const keyword = await keywordChip.getAttribute('data-value');
    await keywordChip.click();
    for (const values of await visible(page).evaluateAll(nodes => nodes.map(node => node.dataset.keyword))) assert.ok(values.split('|').includes(keyword));
    assert.equal(new URL(page.url()).searchParams.get('kw'), keyword);
    const hiddenKeyword = page.locator('.chips .is-extra').first();
    assert.equal(await hiddenKeyword.isVisible(), false);
    await page.locator('.chips-more').click();
    assert.equal(await hiddenKeyword.isVisible(), true);
    await keywordChip.click();
    // Rare keywords have no chip (KEYWORD_MIN); test a card tag whose keyword does.
    const chipKeywords = new Set(await page.locator('.chips [data-filter="keyword"]').evaluateAll(nodes => nodes.map(node => node.dataset.value)));
    const tags = page.locator('.entry:not([hidden]) .entry-tags a.tag-keyword');
    const tagIndex = (await tags.evaluateAll(nodes => nodes.map(node => node.dataset.value))).findIndex(value => chipKeywords.has(value));
    assert.ok(tagIndex >= 0, 'some visible card carries a keyword with a chip');
    const tag = tags.nth(tagIndex);
    const tagKeyword = await tag.getAttribute('data-value');
    await tag.click();
    const tagChip = page.locator(`.chips [data-filter="keyword"][data-value="${tagKeyword.replaceAll('"', '\\"')}"]`);
    assert.equal(await tagChip.getAttribute('aria-pressed'), 'true');
    await tagChip.click();

    // Link kinds and source groups live in the collapsed section, which opens when one of them is active.
    await page.locator('.more-filters > summary').click();
    await page.locator('.chips [data-filter="link"][data-value="code"]').click();
    for (const kinds of await visible(page).evaluateAll(nodes => nodes.map(node => node.dataset.link))) assert.ok(kinds.split('|').includes('code'));
    assert.equal(query(page), '?has=code');
    await page.reload();
    assert.equal(await page.locator('.more-filters').evaluate(node => node.open), true);
    await page.locator('.chips [data-filter="link"][data-value="code"]').click();
    const month = await page.locator('.chips [data-filter="when"]:not([data-value="7d"])').first().getAttribute('data-value');
    await page.locator(`.chips [data-filter="when"][data-value="${month}"]`).click();
    for (const first of await visible(page).evaluateAll(nodes => nodes.map(node => node.dataset.first))) assert.equal(first.slice(0, 7), month);
    await page.locator(`.chips [data-filter="when"][data-value="${month}"]`).click();

    // A topic tag on a card filters to that topic.
    const topicTag = page.locator('.entry .entry-tags a.tag-topic').first();
    const tagTopic = await topicTag.getAttribute('data-value');
    await topicTag.click();
    assert.equal(await page.locator(`.chips [data-filter="topic"][data-value="${tagTopic}"]`).getAttribute('aria-pressed'), 'true');

    // Hearts without an endpoint stay on this device and never show a count.
    const heart = page.locator('.entry .heart').first();
    await heart.click();
    assert.equal(await heart.getAttribute('aria-pressed'), 'true');
    assert.equal(await heart.locator('.heart-count').textContent(), '—');
    await page.reload();
    assert.equal(await page.locator('.entry .heart').first().getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.sort').isHidden(), true);
    // Agent entry points are for desktop readers only.
    assert.equal(await page.locator('#agents').isVisible(), !hasTouch);
    assert.equal(await page.locator('.tabs .agents-tab').isVisible(), AGENTS_PAGE && !hasTouch);
    if (hasTouch) {
      const box = await page.locator('.entry .heart').first().boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, 'heart touch target');
      const chip = await page.locator('.chips button').first().boundingBox();
      assert.ok(chip.height >= 40, 'chip touch target');
    }
    await page.screenshot({ path: path.join(shots, `${label}.png`) });
    assert.deepEqual(errors, []);
    await context.close();
  }

  // A shared card link opens the card even when the address also carries a filter that hides it.
  {
    const target = library.items.find(item => !item.topics.includes('safety'));
    const { context, page, errors } = await open(`${site}library/?topic=safety#${target.id}`);
    assert.equal(await page.locator(`#${target.id}`).isVisible(), true);
    assert.equal(await page.locator('.chips [data-filter="topic"][aria-pressed="true"]').count(), 0);
    // A mangled hash leaves the page working.
    await page.goto(`${site}library/#%E0%A4%A`);
    await page.locator('.chips [data-filter="type"][data-value="paper"]').click();
    assert.match(page.url(), /type=paper/);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // Online hearts: one collection read, PUT to vote, failures revert, and sorting by hearts.
  {
    withEndpoint = true;
    const ids = await (async () => {
      const { context, page } = await open(`${site}library/`);
      const values = await page.locator('.heart').evaluateAll(nodes => nodes.map(node => node.dataset.feedback));
      await context.close();
      return values;
    })();
    const [last, middle] = [ids.at(-1), ids[Math.floor(ids.length / 2)]];
    const counts = { [last]: { up: 5, down: 0, vote: null }, [middle]: { up: 2, down: 0, vote: 'up' } };
    const requests = [];
    let failNext = false;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route(`${endpoint}/votes**`, async route => {
      const request = route.request();
      requests.push({ method: request.method(), url: request.url(), body: request.postData() });
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type', 'access-control-allow-methods': 'GET, PUT, OPTIONS' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (request.method() === 'GET') return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ items: counts }) });
      if (failNext) { failNext = false; return route.fulfill({ status: 503, headers, contentType: 'application/json', body: '{"error":"Feedback unavailable"}' }); }
      const { story, vote } = JSON.parse(request.postData());
      const current = counts[story] || { up: 0, down: 0, vote: null };
      counts[story] = { up: current.up + (vote === 'up') - (current.vote === 'up'), down: 0, vote };
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(counts[story]) });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${site}library/`);
    await page.locator('.sort').waitFor();
    assert.equal(requests.filter(request => request.method === 'GET').length, 1, 'one read for the whole page');
    assert.match(requests[0].url, /collection=library/);
    const button = id => page.locator(`.heart[data-feedback="${id}"]`);
    assert.equal(await button(last).locator('.heart-count').textContent(), '5');
    assert.equal(await button(middle).getAttribute('aria-pressed'), 'true');
    assert.equal(await button(ids[0]).locator('.heart-count').textContent(), '—', 'unregistered items show no count');

    await button(last).click();
    await page.waitForFunction(id => document.querySelector(`.heart[data-feedback="${id}"]`).getAttribute('aria-pressed') === 'true', last);
    assert.equal(await button(last).locator('.heart-count').textContent(), '6');
    const put = JSON.parse(requests.find(request => request.method === 'PUT').body);
    assert.equal(put.story, last);
    assert.equal(put.vote, 'up');
    assert.match(put.voter, /^[a-f0-9-]{36}$/);

    failNext = true;
    await button(middle).click();
    await page.waitForFunction(id => !document.querySelector(`.heart[data-feedback="${id}"]`).disabled, middle);
    assert.equal(await button(middle).getAttribute('aria-pressed'), 'true', 'a failed write keeps the confirmed state');
    assert.equal(await button(middle).locator('.heart-count').textContent(), '2');

    await page.locator('.sort [data-sort="hearts"]').click();
    assert.equal(await page.locator('.entry .heart').first().getAttribute('data-feedback'), last);
    await page.locator('.sort [data-sort="recent"]').click();
    assert.equal(await page.locator('.entry .heart').first().getAttribute('data-feedback'), ids[0]);
    assert.deepEqual(errors, []);
    await context.close();
    withEndpoint = false;
  }

  // Every section links to the library and to the agents page; copy buttons place the exact text on the clipboard;
  // each page's Markdown alternate resolves.
  {
    const { context, page, errors } = await open(site, { viewport: { width: 1440, height: 1000 } });
    const status = async href => (await page.request.get(new URL(href, page.url()).href)).status();
    assert.equal(await status(await page.locator('link[rel="alternate"][type="text/markdown"]').getAttribute('href')), 200);
    await page.locator('.tabs [data-mode="library"]').click();
    await page.waitForURL(`${site}library/`);
    await page.locator('.tabs a', { hasText: '周报' }).click();
    await page.waitForURL(/\/weekly\//);
    assert.equal(await status(await page.locator('link[rel="alternate"][type="text/markdown"]').getAttribute('href')), 200);
    await page.locator('.tabs a', { hasText: '资料库' }).click();
    await page.waitForURL(`${site}library/`);
    assert.equal(await page.locator('.tabs [aria-current="page"]').textContent(), '资料库');
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(site).origin });
    await page.locator('.copy[data-copy="ask-agent"]').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await page.locator('#ask-agent').textContent());
    if (AGENTS_PAGE) {
      await page.locator('.tabs a', { hasText: '给 Agent 用' }).click();
      await page.waitForURL(`${site}agents/`);
      assert.equal(await page.locator('.tabs [aria-current="page"]').textContent(), '给 Agent 用');
      await page.locator('.copy[data-copy="install-skill"]').click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await page.locator('#install-skill').textContent());
      for (const href of await page.locator('.agent-files a').evaluateAll(links => links.map(link => link.href))) assert.equal(await status(href), 200, href);
      await page.screenshot({ path: path.join(shots, 'agents-desktop.png'), fullPage: true });
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  if (AGENTS_PAGE) {
    // The daily agent tab leaves a deep daily route for the agent page.
    const { context, page, errors } = await open(`${site}daily/${library.coverage.through}/group-2/`, { viewport: { width: 1440, height: 1000 } });
    await page.locator('.tabs .agents-tab').click();
    await page.waitForURL(`${site}agents/`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // The library search uses the same synonyms: no card says 画图, yet the figure tools come up.
    const { context, page, errors } = await open(`${site}library/?q=${encodeURIComponent('画图')}`, { viewport: { width: 1440, height: 1000 } });
    const titles = await visible(page).evaluateAll(nodes => nodes.map(node => node.querySelector('.entry-title').textContent));
    assert.ok(titles.some(title => /AstraDraw|figures4papers/i.test(title)), titles.join(' | '));
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Entering from the site root, the app moves to the latest daily path; the search link still opens site search.
    const { context, page, errors } = await open(site, { viewport: { width: 1440, height: 1000 } });
    await page.waitForURL(/\/daily\//);
    assert.equal(await page.locator('.search-entry').evaluate(link => link.href), `${site}search/`);
    await page.getByRole('tab', { name: '三群', exact: true }).click();
    assert.equal(await page.locator('.search-entry').evaluate(link => link.href), `${site}search/`);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // Site search: a glossary spelling also finds what it stands for; filters and the address agree.
  {
    const { context, page, errors } = await open(`${site}search/?q=${encodeURIComponent('A社')}`, { viewport: { width: 1440, height: 1000 } });
    const results = page.locator('#results .result');
    assert.ok(await results.count() > 0, 'A社 finds Anthropic');
    assert.match(await page.locator('#search-status').textContent(), /已同时搜索 A社（Anthropic/);
    assert.ok((await page.locator('#results mark').allTextContents()).some(text => /anthropic/i.test(text)));
    await page.locator('.chips [data-kind="l"]').click();
    for (const meta of await page.locator('#results .result-meta').allTextContents()) assert.match(meta, /^资料库/);
    assert.match(page.url(), /in=l/);
    await page.locator('.chips [data-kind="l"]').click();
    assert.equal(await page.locator('.chips [data-kind][aria-pressed="true"]').count(), 0);
    await page.locator('#site-search').fill('harness');
    await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'harness');
    if (await page.locator('#results-more').isVisible()) {
      const before = await results.count();
      await page.locator('#results-more').click();
      assert.ok(await results.count() > before);
    }
    const target = new URL(await results.first().locator('a').getAttribute('href'), page.url());
    await results.first().locator('a').click();
    await page.waitForURL(url => url.pathname === target.pathname);
    // A multi-word alias is one term and expands like a single word.
    const index = JSON.parse((await readFile(path.join(dist, 'search/data.js'), 'utf8')).replace(/^window\.AGENT_HUB_SEARCH = /, '').replace(/;\s*$/, ''));
    const phrase = Object.keys(index.expand).find(key => key.includes(' ') && index.expand[key].some(target =>
      index.entries.some(entry => `${entry.t}\n${entry.x}`.toLowerCase().includes(target.toLowerCase()))));
    await page.goto(`${site}search/?q=${encodeURIComponent(phrase)}`);
    assert.ok(await results.count() > 0, `${phrase} finds ${index.expand[phrase]}`);
    assert.match(await page.locator('#search-status').textContent(), new RegExp(`已同时搜索 ${phrase}（`));
    // A Chinese sentence needs no spaces: the topic ranks first, and the newest-first order is shareable.
    await page.goto(`${site}search/?q=${encodeURIComponent('多轮强化学习奖励稀疏')}`);
    assert.match(await results.first().locator('h2').textContent(), /DeltaTTG/);
    assert.ok(await page.locator('#results mark').count() > 0);
    await page.locator('.sort [data-sort="new"]').click();
    assert.match(page.url(), /sort=new/);
    assert.ok(await results.count() > 1);
    // A synonym group widens the search: 画图 also finds items written as 绘图 or 作图, and the status says so.
    await page.goto(`${site}search/?q=${encodeURIComponent('画图')}`);
    assert.match(await page.locator('#search-status').textContent(), /已同时搜索 画图（绘图、作图/);
    // Glossary abbreviations search both ways: the formal name also finds items that only use the slang.
    await page.goto(`${site}search/?q=${encodeURIComponent('基座模型')}`);
    assert.match(await page.locator('#search-status').textContent(), /已同时搜索 基座模型（[^）]*基模/);
    const slangOnly = index.entries.filter(entry => entry.x.includes('基模') && !/基座模型|base model/i.test(`${entry.t}\n${entry.x}`)).map(entry => entry.t);
    const titles = await results.locator('h2').allTextContents();
    assert.ok(slangOnly.length && slangOnly.some(title => titles.includes(title)), 'an item that only says 基模 comes up');
    // Words that name Object members and unknown time windows are ordinary input.
    await page.goto(`${site}search/?q=constructor+__proto__&t=abc`);
    assert.match(await page.locator('#search-status').textContent(), /没有找到|找到|站内没有出现过 constructor/);
    assert.equal(await page.locator('.chips [data-time][aria-pressed="true"]').count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Glossary: every category renders, and a term linked to a library keyword opens that filter.
    const { context, page, errors } = await open(`${site}glossary/`, { viewport: { width: 390, height: 844 }, hasTouch: true });
    const glossary = JSON.parse(await readFile(path.join(dist, 'glossary/glossary.json'), 'utf8'));
    assert.equal(await page.locator('.term').count(), glossary.terms.length);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'glossary fits a phone');
    const link = page.locator('.term .inline-link[href*="library/?kw="]').first();
    await link.click();
    await page.waitForURL(/library\/\?kw=/);
    assert.ok(await visible(page).count() > 0);
    // A term's search link opens site search for it, and no link leads to an empty result page.
    await page.goto(`${site}glossary/`);
    const searchLinks = await page.locator('.term .inline-link[href*="search/?q="]').evaluateAll(links => links.map(a => a.href));
    assert.ok(searchLinks.length > 0 && searchLinks.length <= glossary.terms.length);
    await page.locator(`[id="${encodeURIComponent('基模')}"] .inline-link[href*="search/?q="]`).click();
    await page.waitForURL(/search\/\?q=/);
    assert.ok(await page.locator('#results .result').count() > 0);
    for (const href of searchLinks.filter((_, i) => i % 20 === 0)) {
      await page.goto(href);
      assert.ok(await page.locator('#results .result').count() > 0, `${decodeURIComponent(href)} has results`);
    }
    await page.goto(`${site}search/?q=harness`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'search fits a phone');
    await page.screenshot({ path: path.join(shots, 'search-phone.png') });
    assert.deepEqual(errors, []);
    await context.close();
  }

  // Dark scheme keeps chips and cards legible; the screenshot is for review.
  {
    const { context, page, errors } = await open(`${site}library/?topic=training`, { viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.colorScheme), 'dark');
    await page.screenshot({ path: path.join(shots, 'desktop-dark.png') });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`Library browser checks passed for ${total} items; screenshots in output/playwright/library/.`);
} finally {
  await browser.close();
  server.close();
}
