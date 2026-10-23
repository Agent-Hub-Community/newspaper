import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { digests } from '../lib/digest.mjs';
import { site } from '../lib/site.mjs';

const root = new URL('../', import.meta.url);
const production = process.argv.includes('--production');
const base = production ? site : new URL('dist/index.html', root).href;
// Derive the pages from the published editions so re-edited releases do not stale the test.
const pages = digests.flatMap(issue => issue.pages.flatMap(page => {
  const count = (page.stories || []).reduce((sum, story) => sum + (story.resources?.length || 0), 0);
  return count ? [[issue.date, page.id, count]] : [];
}));
assert.ok(pages.length, 'Expected published editions with story resources');
const output = new URL('output/playwright/resources-release/', root);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  for (const width of [390, 820, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://static.cloudflareinsights.com/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    for (const [date, group, count] of pages) {
      await page.goto(`${base}#digest/${date}/${group}`);
      await page.locator('.brief-resources a').first().waitFor();
      assert.equal(await page.locator('.brief-resources a').count(), count);
      assert.doesNotMatch(await page.locator('body').innerText(), /Gemini|这里提供的是|材料没有提供|不能据此判断/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      for (const link of await page.locator('.brief-resources a').all()) {
        assert.equal(await link.getAttribute('target'), '_blank');
        assert.match(await link.getAttribute('rel'), /noopener/);
        assert.ok((await link.boundingBox()).height >= (width <= 1199 ? 44 : 32));
      }
      assert.ok(await page.locator('.brief-comment').count() > 0);
      await page.screenshot({ path: fileURLToPath(new URL(`${date}-${group}-${width}.png`, output)), fullPage: true });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`Resources, reader copy, comments and responsive layout verified on ${pages.length} pages at 390/820/1440.`);
} finally {
  await browser.close();
}
