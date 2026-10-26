// Browser checks for the static weekly pages against a prepared build.
// Usage: VERIFY_SITE=http://127.0.0.1:8791/newspaper [WEEKLY_PATH=2026-10-05/2026-10-11] node test/weekly-browser.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const base = process.env.VERIFY_SITE?.replace(/\/$/, '');
assert.ok(base, 'Set VERIFY_SITE to the prepared site root, e.g. http://127.0.0.1:8791/newspaper');
const weekly = `${base}/weekly/${process.env.WEEKLY_PATH || '2026-10-05/2026-10-11'}`;
const marker = { light: 'rgb(237, 229, 182)', dark: 'rgb(102, 89, 35)' };

// Visible controls a reader can tap; each needs a 44px target.
const targets = page => page.evaluate(() => [...document.querySelectorAll(
  '.edition-nav a, .edition-nav button, .page-links a, .save-image, .rank-link, .directory summary, .resources a, .story-actions > *',
)].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').map(el => {
  const box = el.getBoundingClientRect();
  return { name: el.textContent.trim() || el.getAttribute('aria-label'), width: box.width, height: box.height, button: el.matches('button') };
}));

for (const engine of ['chromium', 'webkit']) {
  const browser = await (engine === 'chromium'
    ? chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
    : webkit.launch());
  try {
    for (const scheme of ['light', 'dark']) for (const width of [320, 360, 390, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: scheme, hasTouch: width < 1000, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      for (const section of ['group-3', 'external', 'rank']) {
        await page.goto(`${weekly}/${section}/`);
        const state = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - innerWidth,
          scheme: document.documentElement.dataset.colorScheme,
          capture: Boolean(window.modernScreenshot || document.querySelector('script[src*="screenshot.js"]')),
          masthead: document.querySelector('.masthead-main').getBoundingClientRect().height,
          prose: document.querySelector('.story .prose p')?.getBoundingClientRect().top,
          marker: document.querySelector('.prose strong') && getComputedStyle(document.querySelector('.prose strong')).backgroundImage,
        }));
        const where = `${engine} ${scheme} ${width} ${section}`;
        assert.ok(state.overflow <= 0, `${where}: horizontal overflow ${state.overflow}px`);
        assert.equal(state.scheme, scheme, where);
        assert.equal(state.capture, false, `${where}: capture library loaded before export`);
        if (state.marker) assert.ok(state.marker.includes(marker[scheme]), `${where}: emphasis marker ${state.marker}`);
        if (width <= 700) {
          // Wordmark and week fit one row; the first paragraph starts on the first screen.
          assert.ok(state.masthead <= 72, `${where}: masthead ${state.masthead}px`);
          if (state.prose !== undefined) assert.ok(state.prose < 844, `${where}: first paragraph at ${state.prose}px`);
          for (const target of await targets(page)) {
            assert.ok(target.height >= 44, `${where}: ${target.name} is ${target.height}px tall`);
            if (target.button) assert.ok(target.width >= 44, `${where}: ${target.name} is ${target.width}px wide`);
          }
        }
      }
      assert.deepEqual(errors, []);
      await context.close();
    }

    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, acceptDownloads: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${weekly}/group-1/`);
    // The appearance toggle cycles system → light → dark.
    await page.locator('.appearance-toggle').click();
    await page.locator('.appearance-toggle').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.colorScheme), 'dark');

    // The source discussion opens in the shared reader and the back gesture closes it.
    const trigger = page.locator('.discussion-trigger').first();
    await trigger.click();
    await page.locator('#discussion-dialog .discussion-text').first().waitFor({ state: 'visible' });
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => !document.querySelector('#discussion-dialog')?.open);

    // "回到目录" opens the single collapsed directory.
    assert.equal(await page.locator('details.directory').evaluate(d => d.open), false);
    await page.locator('.story .back-top').first().click();
    assert.equal(await page.locator('details.directory').evaluate(d => d.open), true);

    // Exports load the capture library on demand and still produce PNG files, light even in dark mode.
    const stories = await page.evaluate(() => window.WEEKLY_READER.pages.find(p => p.id === 'group-1').stories.length);
    const downloads = [];
    page.on('download', download => downloads.push(download));
    await page.locator('.save-image:visible').click();
    assert.equal(await page.evaluate(() => Boolean(window.modernScreenshot)), false);
    for (const [button, expected, label] of [['#export-guide', Math.ceil(stories / 8), '导览图'], ['#export-full', stories, '全文图']]) {
      const before = downloads.length;
      await page.locator(button).click();
      await page.locator(button).filter({ hasText: `已下载 ${expected} 张${label}` }).waitFor({ timeout: 60_000 });
      assert.equal(downloads.length - before, expected);
      for (const download of downloads.slice(before)) {
        assert.match(download.suggestedFilename(), /^AgentHub周报-.+\.png$/);
        const bytes = await readFile(await download.path());
        assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
        if (process.env.WEEKLY_EXPORT_DIR) await download.saveAs(`${process.env.WEEKLY_EXPORT_DIR}/${engine}-${download.suggestedFilename()}`);
      }
    }
    assert.equal(await page.evaluate(() => document.querySelectorAll('script[src*="screenshot.js"]').length), 1);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${engine}: weekly layout, reader and exports passed`);
  } finally {
    await browser.close();
  }
}
