import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
// Rankings need the approved snapshot, which only public (or draft) builds include.
const url = process.env.AGENT_HUB_SITE_URL || pathToFileURL(`${root}dist/index.html`).href;
await mkdir(`${root}output/playwright/ranking`, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const errors = [];
try {
  for (const width of [320, 390, 700, 820, 1199, 1440, 2560]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    await page.route('**/beacon.min.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    assert.ok(await page.evaluate(() => Boolean(window.AGENT_HUB_DATA.activity)), 'Build with `npm run build -- --public` first');
    const nav = page.locator('[data-mode="rank"]');
    // Every width shows the section tabs, phones included.
    await nav.click();
    await page.waitForFunction(() => document.body.dataset.view === 'rank');
    assert.equal(await nav.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#sidebar').isVisible(), false);
    assert.equal(await page.locator('#date-picker').isVisible(), false);
    for (const period of ['month', 'all', 'week']) {
      await page.locator(`[data-rank="${period}"]`).click();
      // The group the reader came from stays in the route and is marked on the board.
      assert.match(await page.evaluate(() => location.hash), new RegExp(`^#rank/${period}(?:/group-[1-4])?$`));
      assert.equal(await page.locator('[aria-labelledby="rank-community"] .activity-leaders li').count(), 3);
      assert.deepEqual(await page.locator('.rank-column h2').allTextContents(), ['全社区', '一群', '二群', '三群', '四群']);
      await page.locator('.activity-leaders img').evaluateAll(imgs => Promise.all(imgs.map(i => i.decode())));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.doesNotMatch(await page.locator('#reading').innerText(), /分数|计分|消息数|微信号/);
    }
    await page.reload();
    await page.locator('[data-rank="week"]').waitFor();
    await page.locator('[data-rank="month"]').click();
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('[data-rank="week"]')?.getAttribute('aria-pressed') === 'true');
    await page.screenshot({ path: `${root}output/playwright/ranking/${width}.png`, fullPage: true });
    await page.locator('[data-mode="digest"]').click();
    await page.locator('#digest-panel').waitFor();
    const expectedLeaders = await page.evaluate(() => {
      const date = document.body.dataset.edition.slice('digest/'.length);
      const group = AGENT_HUB_DATA.activity.groups.find(group => group.id === document.querySelector('#reading').dataset.page);
      return group?.daily[date]?.leaders.length || 0;
    });
    assert.equal(await page.locator('.daily-leaders li').count(), expectedLeaders);
    await page.goto(`${url}#digest/2026-09-24/group-1`);
    // Each issue loads on demand; count only once that issue has rendered.
    await page.waitForFunction(() => document.body.dataset.edition === 'digest/2026-09-24' && document.querySelector('.daily-ranking'));
    assert.equal(await page.locator('.daily-leaders li').count(), 3);
    // 一群 has no copy on 2026-09-25 and opens 二群 instead, so only groups with copy are checked.
    for (const [group, count] of [['group-2', 3], ['group-3', 3]]) {
      await page.goto(`${url}#digest/2026-09-25/${group}`);
      await page.waitForFunction(id => document.querySelector('#reading').dataset.page === id && document.body.dataset.edition === 'digest/2026-09-25' && document.querySelector('.daily-ranking'), group);
      assert.equal(await page.locator('.daily-leaders li').count(), count);
      assert.equal(await page.locator('.daily-rank-empty').count(), 0);
      await page.locator('.daily-leaders img').evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    }
    await page.screenshot({ path: `${root}output/playwright/ranking/daily-${width}.png`, fullPage: true });
    console.log(`Ranking navigation, periods, history, privacy and layout passed ${width}px`);
    await page.close();
  }
  const page = await browser.newPage();
  await page.addInitScript(() => window.addEventListener('DOMContentLoaded', () => {
    delete window.AGENT_HUB_DATA.activity;
    location.hash = '#rank/month';
  }));
  await page.goto(url);
  await page.locator('.rank-empty').waitFor();
  assert.equal(await page.locator('.activity-leaders li').count(), 0);
  await page.close();
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
