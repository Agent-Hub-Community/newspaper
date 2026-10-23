import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Opened from file://, every build keeps votes on the device, so the regular build is enough.
const url = `${pathToFileURL(`${root}dist/index.html`)}#digest/2026-09-22/group-1`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
await mkdir(`${root}output/playwright/feedback`, { recursive: true });
try {
  for (const [width, hasTouch] of [[390, true], [820, true], [1440, false], [1440, true]]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    const row = page.locator('.story-feedback').first();
    const up = row.locator('[data-vote="up"]'), down = row.locator('[data-vote="down"]');
    await up.click();
    assert.equal(await up.getAttribute('aria-pressed'), 'true');
    await down.click();
    assert.equal(await up.getAttribute('aria-pressed'), 'false');
    assert.equal(await down.getAttribute('aria-pressed'), 'true');
    await page.reload();
    assert.equal(await down.getAttribute('aria-pressed'), 'true');
    await down.click();
    assert.equal(await down.getAttribute('aria-pressed'), 'false');
    await up.focus();
    await page.keyboard.press('Space');
    assert.equal(await up.getAttribute('aria-pressed'), 'true');
    assert.equal(await row.locator('.vote-count').first().textContent(), '—');
    assert.equal(await row.locator('.feedback-status').textContent(), '仅保存在此设备');
    assert.equal(await page.locator('.story-feedback').nth(1).locator('[data-vote="up"]').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const box = await up.boundingBox();
    assert.ok(box.width >= (hasTouch ? 44 : 36));
    assert.equal(box.height, hasTouch ? 44 : 32);
    for (const brief of await page.locator('.brief').all()) {
      // Votes close the article on the same row as the discussion trigger.
      const copyBox = await brief.locator('.brief-copy').boundingBox();
      const feedbackBox = await brief.locator('.brief-actions .story-feedback').boundingBox();
      assert.ok(Math.abs(copyBox.y + copyBox.height - (feedbackBox.y + feedbackBox.height)) <= 1, 'Feedback should end the article without a stretched gap');
    }
    await page.screenshot({ path: `${root}output/playwright/feedback/${width}${hasTouch ? '-touch' : ''}.png`, fullPage: true });
    await row.locator('.vote-count').evaluateAll(nodes => nodes.forEach(node => { node.textContent = '123456'; }));
    await row.locator('.feedback-status').evaluate(node => { node.textContent = '网络暂时不可用，本次选择尚未确认，请稍后重试。'; });
    const upBox = await up.boundingBox(), downBox = await down.boundingBox();
    assert.ok(upBox.x + upBox.width <= downBox.x);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await page.close();
  }
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('Blocked'); } });
  });
  const blocked = await context.newPage();
  await blocked.goto(url);
  await blocked.locator('.story-feedback').first().locator('[data-vote="up"]').click();
  assert.match(await blocked.locator('.feedback-status').first().textContent(), /无法保存/);
  await context.close();

  const remote = await browser.newPage();
  const source = await readFile(`${root}feedback.js`, 'utf8');
  await remote.route('https://feedback.example/**', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ vote: null, up: 3, down: 1 }),
  }));
  await remote.route('https://site.example/', route => route.fulfill({
    contentType: 'text/html', body: '<article class="brief"></article>',
  }));
  await remote.goto('https://site.example/');
  await remote.evaluate(() => {
    window.AGENT_HUB_DATA = { feedbackEndpoint: 'https://feedback.example/' };
  });
  await remote.addScriptTag({ content: source });
  await remote.evaluate(() => window.AgentHubFeedback.mount(document.body, [{ feedbackId: 'a'.repeat(32), title: '测试' }]));
  await remote.waitForFunction(() => document.querySelector('.story-feedback')?.getAttribute('aria-busy') === 'false');
  assert.equal(await remote.locator('[data-vote="up"] .vote-count').textContent(), '3');
  await remote.route('https://feedback.example/**', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ vote: 'up', up: 4, down: 1 }),
  }));
  await remote.locator('[data-vote="up"]').click();
  await remote.waitForFunction(() => document.querySelector('.feedback-status').textContent === '已提交');
  assert.equal(await remote.locator('[data-vote="up"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await remote.locator('[data-vote="up"] .vote-count').textContent(), '4');
  await remote.route('https://feedback.example/**', route => route.fulfill({ status: 503, body: '{}' }));
  await remote.locator('[data-vote="down"]').click();
  await remote.waitForFunction(() => document.querySelector('.feedback-status').textContent.includes('未确认'));
  assert.equal(await remote.locator('[data-vote="up"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await remote.locator('[data-vote="up"] .vote-count').textContent(), '4');
  console.log('Feedback: responsive controls, mutual exclusion, cancel, reload, keyboard, blocked storage and server failure passed.');
} finally {
  await browser.close();
}
