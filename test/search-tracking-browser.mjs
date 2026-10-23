import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { basePath, site } from '../site.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const endpoint = 'https://agenthub-feedback.haoqingeric.workers.dev';
const live = process.argv.includes('--live');
const shots = path.join(root, 'output/playwright/search-tracking');
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const events = [], responses = [], errors = [];
  await context.route(/cloudflareinsights\.com|static\.cloudflareinsights\.com/, route => route.abort());
  if (!live) {
    await context.route(`${site}**`, async route => {
      let file = new URL(route.request().url()).pathname.slice(basePath.length);
      if (file.endsWith('/')) file += 'index.html';
      const body = await readFile(path.join(root, 'dist', file));
      const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream';
      await route.fulfill({ contentType, body });
    });
    await context.route(`${endpoint}/search-events`, route => route.fulfill({ status: 204, headers: { 'access-control-allow-origin': new URL(site).origin } }));
  }
  // Prevent unrelated votes, discussion counts and beacons during this narrow verification.
  await context.route(`${endpoint}/votes**`, route => route.fulfill({ status: 200, body: '{"up":0,"down":0,"vote":null}', contentType: 'application/json', headers: { 'access-control-allow-origin': new URL(site).origin } }));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.url() !== `${endpoint}/search-events`) return;
    assert.equal(request.headers().referer, undefined);
    assert.equal(request.headers().cookie, undefined);
    const body = JSON.parse(request.postData());
    assert.equal(body.test, true);
    events.push(body);
  });
  page.on('response', response => { if (response.url() === `${endpoint}/search-events`) responses.push(response.status()); });
  await page.goto(`${site}search/?analytics_test=1`);
  await page.locator('#site-search').fill('harness');
  const submitted = page.waitForResponse(`${endpoint}/search-events`);
  await page.locator('#site-search').press('Enter');
  assert.equal((await submitted).status(), 204);
  assert.equal(events.length, 1);
  const first = events[0];
  assert.ok(first.search.results > 0);
  assert.equal(first.search.query, 'harness');
  await page.screenshot({ path: path.join(shots, live ? 'production-search.png' : 'search.png') });
  // Pagination does not change the search ID or denominator.
  if (await page.locator('#results-more').isVisible()) await page.locator('#results-more').click();
  // The old document may disappear before Playwright sees a keepalive response.
  // Observe dispatch here; production acceptance also reads the event back from D1.
  const clicked = page.waitForRequest(`${endpoint}/search-events`);
  const target = await page.locator('#results a').first().getAttribute('data-target');
  await page.locator('#results a').first().click();
  await clicked;
  await page.waitForURL(new URL(target, site).href);
  assert.equal(events.at(-1).search.id, first.search.id);
  assert.equal(events.at(-1).click.target, target);
  assert.equal(events.at(-1).click.rank, 1);
  await page.goto(`${site}search/?analytics_test=1`);
  await page.locator('#site-search').fill('龘靐齉爩');
  const zero = page.waitForResponse(`${endpoint}/search-events`);
  await page.locator('#site-search').press('Enter');
  assert.equal((await zero).status(), 204);
  assert.equal(events.at(-1).search.results, 0);
  assert.match(await page.locator('#search-status').textContent(), /没找到/);
  if (!live) {
    // Fake time makes debounce/IME checks deterministic without sleeping.
    await page.clock.install();
    const before = events.length;
    await page.locator('#site-search').fill('Claude');
    await page.clock.runFor(500);
    await page.locator('#site-search').fill('Claude Code');
    await page.clock.runFor(1000);
    assert.equal(events.length, before, 'unfinished typing does not report');
    const settled = page.waitForResponse(`${endpoint}/search-events`);
    await page.clock.runFor(400);
    await settled;
    assert.equal(events.length, before + 1);
    await page.locator('#site-search').dispatchEvent('compositionstart');
    await page.locator('#site-search').fill('拼音输入中');
    await page.clock.runFor(3000);
    assert.equal(events.length, before + 1, 'IME composition does not report');
    const composed = page.waitForResponse(`${endpoint}/search-events`);
    await page.locator('#site-search').dispatchEvent('compositionend');
    await page.clock.runFor(1500);
    await composed;
    // Filters change both the denominator and event identity; the displayed result count is recorded.
    await page.locator('#site-search').fill('harness');
    const again = page.waitForResponse(`${endpoint}/search-events`);
    await page.locator('#site-search').press('Enter');
    await again;
    const beforeFilter = events.at(-1).search.id;
    const filtered = page.waitForResponse(`${endpoint}/search-events`);
    await page.locator('[data-kind="l"]').click();
    await page.clock.runFor(1300);
    await filtered;
    assert.notEqual(events.at(-1).search.id, beforeFilter);
    assert.equal(events.at(-1).search.kind, 'l');
    assert.equal(events.at(-1).search.results, Number((await page.locator('#search-status').textContent()).match(/找到 (\d+) 条/)?.[1] || 0));
    // Collection failure leaves search usable and reports again on an explicit action, using the same ID.
    await context.route(`${endpoint}/search-events`, route => route.fulfill({ status: 503, headers: { 'access-control-allow-origin': new URL(site).origin } }));
    const failed = page.waitForResponse(`${endpoint}/search-events`);
    await page.locator('#site-search').fill('Claude');
    await page.locator('#site-search').press('Enter');
    assert.equal((await failed).status(), 503);
    assert.ok(await page.locator('#results .result').count() > 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(shots, 'phone.png') });
  }
  assert.deepEqual(errors, []);
  assert.ok(responses.every(code => code === 204 || (!live && code === 503)));
  console.log(JSON.stringify({ live, searches: events.filter(event => !event.click).map(event => event.search), clicks: events.filter(event => event.click).map(event => event.click), responses, screenshots: shots }, null, 2));
  await context.close();
} finally { await browser.close(); }
