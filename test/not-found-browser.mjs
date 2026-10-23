import assert from 'node:assert/strict';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { basePath, site } from '../lib/site.mjs';

// Serve dist/ the way GitHub Pages does: existing files as-is, any missing path gets 404.html with status 404.
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const base = site;
const screenshots = process.env.SCREENSHOT_DIR || fileURLToPath(new URL('../output/playwright/not-found/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
const isFile = file => stat(file).then(s => s.isFile(), () => false);
await mkdir(screenshots, { recursive: true });

const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  for (const [name, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 1000 }]]) {
    const page = await browser.newPage({ viewport });
    const problems = [], outside = [];
    page.on('pageerror', error => problems.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error' && !/status of 404/.test(msg.text())) problems.push(msg.text()); });
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (!url.startsWith(base)) {
        outside.push(url);
        return route.abort();
      }
      const relative = decodeURIComponent(new URL(url).pathname.slice(basePath.length));
      assert.ok(!relative.split('/').includes('..'));
      const file = path.join(root, relative.endsWith('/') || !relative ? `${relative}index.html` : relative);
      if (await isFile(file)) return route.fulfill({ body: await readFile(file), contentType: types[path.extname(file)] });
      return route.fulfill({ status: 404, body: await readFile(path.join(root, '404.html')), contentType: 'text/html' });
    });

    // A removed weekly-report page that visitors still opened, and a deeper path nobody published.
    for (const missing of ['documents/2026-09-21-ai-safety-full.html', 'a/b/c/']) {
      const response = await page.goto(base + missing);
      assert.equal(response.status(), 404, missing);
      assert.equal(await page.locator('h1').innerText(), '这一页不存在');
      // The inline styles only apply if the page's own CSP allows them.
      assert.equal(await page.locator('.home').evaluate(el => getComputedStyle(el).borderTopStyle), 'solid');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflow`);
      const box = await page.locator('.home').boundingBox();
      assert.ok(box.height >= 44, `${name} touch target`);
    }
    await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true });
    assert.deepEqual(outside, [], 'The 404 page must not load anything outside the site');
    assert.deepEqual(problems, []);

    await page.locator('.home').click();
    await page.waitForURL(url => url.pathname === basePath);
    await page.locator('#digest-panel').waitFor();
    assert.match(await page.evaluate(() => document.body.dataset.edition), /^digest\//);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`Verified the 404 page on mobile and desktop; screenshots in ${screenshots}`);
