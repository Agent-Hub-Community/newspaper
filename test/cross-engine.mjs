import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { webkit } from 'playwright';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const output = fileURLToPath(new URL('../output/playwright/webkit/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root)) return response.writeHead(403).end();
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let browser;
const errors = [];
try {
  await mkdir(output, { recursive: true });
  browser = await webkit.launch();
  for (const [width, height] of [[320, 640], [390, 844], [844, 390], [820, 1180], [1180, 820], [1440, 1000]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.locator('#digest-panel').waitFor();
    for (const mode of ['digest', 'week', 'topic']) {
      const tab = page.locator(`[data-mode="${mode}"]`);
      if (await tab.isVisible()) await tab.tap();
      else if (mode !== 'digest') await page.locator(`.archive-teaser [data-jump="${mode}"]`).first().tap();
      await page.waitForFunction(mode => document.body.dataset.view === mode, mode);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}: ${mode} overflow`);
      await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
      await page.screenshot({ path: path.join(output, `${mode}-${width}x${height}.png`) });
      await page.locator('#date-picker').tap();
      assert.equal(await page.locator('#archive-dialog').isVisible(), true);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('#date-picker').getAttribute('aria-expanded') === 'false');
      // WebKit does not focus buttons on touch. Verify focus return for keyboard use.
      await page.locator('#date-picker').focus();
      await page.keyboard.press('Enter');
      await page.locator('#archive-dialog').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('#date-picker').getAttribute('aria-expanded') === 'false');
      assert.equal(await page.locator('#date-picker').evaluate(el => document.activeElement === el), true);
    }
    await page.locator('[data-mode="digest"]').tap();
    await page.getByRole('tab', { name: '二群' }).tap();
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#reading').dataset.page === 'group-2');
    await page.getByRole('tab', { name: '一群' }).tap();
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('#reading').dataset.page === 'group-2');
    await page.goForward();
    await page.waitForFunction(() => document.querySelector('#reading').dataset.page === 'group-1');
    // Same-origin CSSOM exercises enlarged text without weakening the site's CSP.
    await page.evaluate(() => {
      const sheet = [...document.styleSheets].find(sheet => sheet.href?.endsWith('/style.css'));
      sheet.insertRule('html { font-size: 24px; }', sheet.cssRules.length);
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}: enlarged text`);
    console.log(`WebKit passed ${width}x${height}: three modes, images, dialog, focus, touch, history, enlarged text.`);
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
