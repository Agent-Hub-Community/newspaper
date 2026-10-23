import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = new URL('../dist/index.html', import.meta.url).href;
const output = new URL('../output/playwright/date-navigation/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [320, 390, 700, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const skin of ['default', 'mid-autumn']) {
      for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme });
        await page.goto(`${url}?skin=${skin}#digest/2026-09-25/group-1`);
        await page.locator('#digest-panel').waitFor();
        assert.match(page.url(), /2026-09-25\/group-2$/);
        assert.equal(await page.locator('[data-page="0"]').isDisabled(), true);
        assert.match(await page.locator('[data-page="0"]').getAttribute('title'), /暂无稿件/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const overlap = await page.evaluate(() => {
          const a = document.querySelector('.wordmark').getBoundingClientRect();
          const b = document.querySelector('.edition-controls').getBoundingClientRect();
          return Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
            Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
        });
        assert.equal(overlap, false);
        if (width > 700) {
          const alignment = await page.evaluate(() => {
            const rect = selector => document.querySelector(selector).getBoundingClientRect();
            const row = rect('.masthead-main'), title = rect('.wordmark'), controls = rect('.edition-controls');
            return {
              centered: Math.abs((title.left + controls.right) / 2 - (row.left + row.right) / 2),
              vertical: Math.abs((title.top + title.bottom) / 2 - (controls.top + controls.bottom) / 2),
            };
          });
          assert.ok(alignment.centered < 1 && alignment.vertical < 1, JSON.stringify(alignment));
        }
        // The date in the masthead opens the one archive: the list, with the previous and next issue on top.
        await page.locator('#date-picker').click();
        assert.equal(await page.locator('#archive-heading').textContent(), '往期目录');
        assert.equal(await page.locator('#archive-pagination').isVisible(), true);
        const expected = await page.evaluate(() => AGENT_HUB_DATA.digests.filter(item => item.pages.some(window.digestPageHasContent)).map(item => item.date).reverse());
        assert.deepEqual(await page.locator('#archive-list .issue-row').evaluateAll(rows => rows.map(row => row.dataset.id)), expected);
        assert.equal(await page.locator('#archive-list .issue-row[aria-current="page"]').getAttribute('data-id'), '2026-09-25');
        const rect = await page.locator('#archive-dialog').boundingBox();
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width + 1 && rect.y + rect.height <= 901, JSON.stringify(rect));
        await page.screenshot({ path: new URL(`${width}-${skin}-${colorScheme}.png`, output).pathname });
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#date-picker').evaluate(el => el === document.activeElement), true);
        const step = async label => {
          await page.locator('#date-picker').click();
          await page.locator('#archive-pagination button', { hasText: label }).click();
        };
        await step('上一期');
        assert.match(page.url(), /2026-09-24\/group-2$/);
        await page.getByRole('tab', { name: '一群', exact: true }).click();
        assert.match(page.url(), /2026-09-24\/group-1$/);
        // Moving between issues falls back to another group only when the selected one has no copy.
        await step('下一期');
        assert.match(page.url(), /2026-09-25\/group-2$/);
        assert.ok(await page.locator('.brief').count() > 0);
        assert.equal(await page.locator('.digest-empty').count(), 0);
        await page.screenshot({ path: new URL(`reading-${width}-${skin}-${colorScheme}.png`, output).pathname });
        await page.goBack();
        assert.match(page.url(), /2026-09-24\/group-1$/);
        await page.goForward();
        assert.match(page.url(), /2026-09-25\/group-2$/);
        await page.getByRole('tab', { name: '二群', exact: true }).focus();
        await page.keyboard.press('ArrowLeft');
        assert.match(page.url(), /2026-09-25\/external$/);
        await page.keyboard.press('Home');
        assert.match(page.url(), /2026-09-25\/group-2$/);
        // The first row is the latest issue; the reader stays in their group when it has copy.
        await page.locator('#date-picker').click();
        await page.locator('#archive-list .issue-row').first().click();
        assert.match(page.url(), new RegExp(`${expected[0]}/group-\\d$`));
        assert.equal(await page.locator('.digest-empty').count(), 0);
        // Picking 2026-09-25 while reading 一群 lands on 二群, the only group with copy that day.
        await page.goto(`${url}?skin=${skin}#digest/2026-09-24/group-1`);
        await page.locator('#date-picker').click();
        await page.locator('#archive-list [data-id="2026-09-25"]').click();
        assert.match(page.url(), /2026-09-25\/group-2$/);
        if (width > 700) {
          await page.goto(`${url}?skin=${skin}#digest/2026-09-24/group-1`);
          await page.locator('#archive-toggle').click();
          await page.locator('#archive-list [data-id="2026-09-25"]').click();
          assert.match(page.url(), /2026-09-25\/group-2$/);
        }
      }
    }
  }
  const pager = async () => page.locator('#archive-pagination button').evaluateAll(buttons => buttons.map(b => b.disabled));
  // Controlled gaps: only one readable day, including a paper-only page.
  await page.goto(`${url}?skin=default#digest/2026-09-25/group-1`);
  await page.evaluate(() => {
    // Mark every issue loaded so the fixture pages, not the index flags or issue scripts, decide what is readable.
    for (const issue of AGENT_HUB_DATA.digests) {
      issue.loaded = true;
      issue.pages.forEach(p => { p.stories = []; delete p.papers; delete p.trends; delete p.hasContent; });
      if (issue.date === '2026-08-31') issue.pages[0].papers = [{ title: 'Fixture paper', text: 'Readable abstract', url: 'https://example.com', id: 'fixture' }];
      if (issue.date === '2026-09-24') issue.pages[0].stories = [{ title: 'Whitespace fixture', text: '  ' }];
    }
  });
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
  await page.locator('#date-picker').click();
  assert.deepEqual(await page.locator('#archive-list .issue-row').evaluateAll(rows => rows.map(row => row.dataset.id)), ['2026-08-31']);
  await page.locator('#archive-list [data-id="2026-08-31"]').click();
  assert.match(page.url(), /2026-08-31\/group-1$/);
  assert.equal(await page.locator('.paper-list article').count(), 1);
  await page.locator('[data-page="0"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.match(page.url(), /2026-08-31\/group-1$/);
  await page.locator('#date-picker').click();
  // A single readable issue has nothing to step to.
  assert.equal(await page.locator('#archive-pagination').innerText(), '');
  await page.keyboard.press('Escape');
  // A trends-only external page is readable; intermediate empty days are skipped.
  await page.evaluate(() => {
    AGENT_HUB_DATA.digests.find(issue => issue.date === '2026-09-24').pages.find(p => p.id === 'external').trends = [{ title: 'Trend', text: 'Actual trend body' }];
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.locator('#date-picker').click();
  assert.deepEqual(await pager(), [true, false]);
  await page.locator('#archive-pagination button', { hasText: '下一期' }).click();
  assert.match(page.url(), /2026-09-24\/external$/);
  assert.equal(await page.locator('.external-trends article').count(), 1);
  assert.equal(await page.locator('.digest-empty').count(), 0);
  assert.equal(await page.locator('[role="tab"]:not(:disabled)').count(), 1);
  // With no content anywhere, the archive is empty and the empty state stays usable.
  await page.evaluate(() => {
    for (const issue of AGENT_HUB_DATA.digests) {
      for (const p of issue.pages) { p.stories = []; p.papers = []; p.trends = []; }
    }
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  assert.equal(await page.locator('.digest-empty').isVisible(), true);
  assert.equal(await page.locator('[role="tab"]:not(:disabled)').count(), 0);
  await page.locator('#date-picker').click();
  assert.equal(await page.locator('#archive-list .issue-row').count(), 0);
  assert.match(await page.locator('#archive-list').innerText(), /暂无可选日期/);
  await page.keyboard.press('Escape');
  // From the external page, a row opens that day's external page, by keyboard too.
  await page.goto(`${url}?external-check#digest/2026-09-25/external`);
  const externalDay = await page.evaluate(() => AGENT_HUB_DATA.digests.find(issue => issue.date !== '2026-09-25' &&
    window.digestPageHasContent(issue.pages.find(p => p.id === 'external'))).date);
  await page.locator('#date-picker').click();
  await page.locator(`#archive-list [data-id="${externalDay}"]`).focus();
  await page.keyboard.press('Enter');
  assert.match(page.url(), new RegExp(`${externalDay}/external$`));
  assert.deepEqual(errors, []);
  console.log('Date navigation passed: 20 viewport/theme combinations, one archive list with previous/next, missing-copy recovery, history, empty archives, papers, external news, keyboard focus and responsive geometry.');
} finally {
  await browser.close();
}
