import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { basePath, origin, site } from '../lib/site.mjs';

// Explicit opt-in: this exercises and then cancels one vote on the deployed service.
if (!process.argv.includes('--live')) throw new Error('Pass --live to test the deployed feedback API');
const root = fileURLToPath(new URL('../', import.meta.url));
const production = process.argv.includes('--production');
const data = JSON.parse((await readFile(`${root}dist/data.js`, 'utf8'))
  .replace(/^window\.AGENT_HUB_DATA = /, '').replace(/;\s*$/, ''));
const endpoint = data.feedbackEndpoint;
if (!data.publicBuild || !endpoint) throw new Error('Build the public site with FEEDBACK_API_URL first');
const issue = data.digests.findLast(d => d.pages.some(p => p.stories?.length));
const group = issue.pages.find(p => p.stories?.length);
const story = group.stories[0].feedbackId;
const voter = crypto.randomUUID();
const headers = { Origin: origin, 'Content-Type': 'application/json' };
async function put(vote) {
  const response = await fetch(`${endpoint}/votes`, {
    method: 'PUT', headers, body: JSON.stringify({ story, voter, vote }), signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200);
  return response.json();
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const initial = await put(null);
  assert.deepEqual(await put('up'), { up: initial.up + 1, down: initial.down, vote: 'up' });
  assert.deepEqual(await put('up'), { up: initial.up + 1, down: initial.down, vote: 'up' });
  assert.deepEqual(await put('down'), { up: initial.up, down: initial.down + 1, vote: 'down' });
  assert.deepEqual(await put(null), { up: initial.up, down: initial.down, vote: null });
  await mkdir(`${root}output/playwright/feedback-live`, { recursive: true });
  for (const width of [390, 820, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(voter => localStorage.setItem('agenthub:feedback:v1:voter', voter), voter);
    // Use locally built assets with the real origin/CSP and the real deployed API.
    // This is integration verification, not proof that GitHub Pages has been updated.
    if (!production) await page.route(`${site}**`, async route => {
      const pathname = new URL(route.request().url()).pathname.replace(basePath, '') || 'index.html';
      assert.ok(!pathname.includes('..'));
      const type = pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' :
        pathname.endsWith('.html') ? 'text/html' : pathname.endsWith('.png') ? 'image/png' : 'image/jpeg';
      await route.fulfill({ body: await readFile(`${root}dist/${pathname}`), contentType: type });
    });
    await page.route('https://static.cloudflareinsights.com/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.goto(`${site}#digest/${issue.date}/${group.id}`);
    assert.deepEqual(await page.evaluate(() => window.AGENT_HUB_DATA.digests), data.digests);
    await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    const row = page.locator('.story-feedback').first();
    await page.waitForFunction(() => document.querySelector('.story-feedback')?.getAttribute('aria-busy') === 'false');
    assert.equal(await row.locator('[data-vote="up"] .vote-count').textContent(), String(initial.up));
    await row.locator('[data-vote="up"]').click();
    await page.waitForFunction(() => document.querySelector('.feedback-status').textContent === '已提交');
    assert.equal(await row.locator('[data-vote="up"] .vote-count').textContent(), String(initial.up + 1));
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.story-feedback')?.getAttribute('aria-busy') === 'false');
    assert.equal(await row.locator('[data-vote="up"]').getAttribute('aria-pressed'), 'true');
    await row.locator('[data-vote="up"]').click();
    await page.waitForFunction(() => document.querySelector('.feedback-status').textContent === '已取消');
    assert.equal(await row.locator('[data-vote="up"] .vote-count').textContent(), String(initial.up));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${root}output/playwright/feedback-live/${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`${production ? 'Published Pages' : 'Local assets'} + live Worker/D1: counts, duplicate PUT, switch, cancel, CORS/CSP, content, images and refresh verified at three widths.`);
} finally {
  await browser.close();
  await put(null);
  console.log('Test vote cancelled.');
}
