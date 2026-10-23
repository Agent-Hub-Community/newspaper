import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { basePath, site } from '../lib/site.mjs';

// Page view reports from the public build, served at the production URL with the Worker intercepted.
// Build first: FEEDBACK_API_URL=https://agenthub-feedback.haoqingeric.workers.dev npm run build -- --public
// BROWSER=webkit runs the same checks in WebKit, the engine of WeChat and Safari on iOS.
const root = fileURLToPath(new URL('../', import.meta.url));
const data = (await readFile(path.join(root, 'dist/data.js'), 'utf8')).match(/"feedbackEndpoint":"([^"]*)"/)?.[1];
assert.ok(data, 'dist/ must be a public build with FEEDBACK_API_URL');
const endpoint = new URL('/views', data).href;
const browser = process.env.BROWSER === 'webkit' ? await webkit.launch()
  : await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const reports = [], errors = [];
  await context.route(/cloudflareinsights\.com/, route => route.abort());
  // Unrelated feedback calls (votes, discussion opens) stay local.
  await context.route(`${new URL(data).origin}/**`, async route => {
    const request = route.request();
    if (request.url() === endpoint) {
      const headers = await request.allHeaders();
      reports.push({ ...JSON.parse(request.postData()), origin: headers.origin, contentType: headers['content-type'], referer: headers.referer, cookie: headers.cookie });
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': new URL(site).origin } });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"up":0,"down":0,"vote":null}', headers: { 'access-control-allow-origin': new URL(site).origin } });
  });
  // GitHub Pages: directories serve index.html; missing files get 404.html with status 404.
  await context.route(`${site}**`, async route => {
    let file = new URL(route.request().url()).pathname.slice(basePath.length);
    if (!file || file.endsWith('/')) file += 'index.html';
    const body = await readFile(path.join(root, 'dist', file)).catch(() => null);
    const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream';
    await route.fulfill(body ? { contentType, body } : { status: 404, contentType: 'text/html', body: await readFile(path.join(root, 'dist/404.html')) });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const settle = () => page.waitForTimeout(400);
  const paths = () => reports.map(report => report.path);

  // The home address counts once as the home page, although app.js then shows the latest daily section.
  await page.goto(site);
  await page.locator('.brief').first().waitFor();
  await settle();
  assert.deepEqual(paths(), [basePath]);
  const landed = new URL(page.url()).pathname;
  assert.match(landed, /\/daily\/\d{4}-\d{2}-\d{2}\/group-\d+\/$/);

  // Section and date changes push history entries; each new address counts once.
  const other = page.locator('[role="tab"]:not([aria-selected="true"]):not([disabled])').first();
  await other.click();
  await settle();
  const section = new URL(page.url()).pathname;
  assert.notEqual(section, landed);
  await page.locator('#date-picker').click();
  await page.locator('#archive-list .issue-row').nth(1).click();
  await settle();
  const older = new URL(page.url()).pathname;
  assert.notEqual(older, section);
  assert.deepEqual(paths(), [basePath, section, older]);

  // A discussion changes only the hash; back and forward revisit earlier addresses.
  await page.locator('.discussion-trigger').first().click();
  await settle();
  assert.match(page.url(), /#discussion-1$/);
  await page.goBack();
  await settle();
  assert.deepEqual(paths(), [basePath, section, older]);
  await page.goBack();
  await settle();
  assert.equal(new URL(page.url()).pathname, section);
  assert.deepEqual(paths(), [basePath, section, older, section]);

  // Static pages report on load; the 404 page never does.
  for (const route of ['library/', 'glossary/', 'search/', 'rank/week/']) {
    await page.goto(new URL(route, site).href);
    await settle();
  }
  const weekly = (await readFile(path.join(root, 'dist/weekly/index.html'), 'utf8')).match(/url=([^"]+)"/)[1];
  await page.goto(new URL(`weekly/${weekly}`, site).href);
  await settle();
  const before = reports.length;
  await page.goto(`${site}documents/missing.html`);
  await settle();
  assert.equal(reports.length, before, '404 does not report');
  assert.deepEqual(paths().slice(4), ['library/', 'glossary/', 'search/', 'rank/week/', `weekly/${weekly}`].map(route => basePath + route));

  // Every report names the site origin, carries no referrer or cookie, and shares the vote buttons' browser ID.
  const voter = await page.evaluate(() => localStorage.getItem('agenthub:feedback:v1:voter'));
  for (const report of reports) {
    assert.equal(report.origin, new URL(site).origin);
    assert.equal(report.contentType, 'text/plain;charset=UTF-8');
    assert.equal(report.referer, undefined);
    assert.equal(report.cookie, undefined);
    assert.equal(report.visitor, voter);
  }
  assert.deepEqual(errors, []);
  console.log(`${process.env.BROWSER || 'chromium'}: ${reports.length} page views reported as expected`);
} finally {
  await browser.close();
}
