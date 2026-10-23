import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const output = fileURLToPath(new URL('../output/playwright/external/', import.meta.url));
await mkdir(output, { recursive: true });
const report = JSON.parse(await readFile(new URL('../data/external-editions/2026-09-25.json', import.meta.url), 'utf8'));
const groupEdition = JSON.parse(await readFile(new URL('../data/editions/2026-09-25.json', import.meta.url), 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const file = path.resolve(root, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
    if (!file.startsWith(root)) return response.writeHead(403).end();
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(url + '#digest/2026-09-25/external');
    await page.locator('#reading[data-page="external"]').waitFor();
    assert.equal(await page.getByRole('tab').count(), 4);
    assert.equal(await page.locator('#digest-panel h1').innerText(), report.title);
    assert.equal(await page.locator('.daily-ranking').count(), 0);
    assert.equal(await page.locator('.brief').count(), report.stories.length);
    assert.equal(await page.locator('.brief-comment').count(), report.stories.length);
    assert.deepEqual(await page.locator('.brief-comment p').allTextContents(),
      report.stories.map(story => story.aiComment));
    assert.deepEqual(await page.locator('.brief-emphasis').allTextContents(),
      report.stories.flatMap(story => story.emphasis || []));
    assert.ok(await page.locator('.brief-emphasis').count() > 0);
    assert.ok(await page.locator('.brief-emphasis').evaluateAll(nodes =>
      nodes.every(node => Number(getComputedStyle(node).fontWeight) >= 700)));
    assert.deepEqual(await page.locator('.brief-body > p:first-of-type').allTextContents(),
      report.stories.map(story => story.text));
    assert.equal(await page.locator('.external-trends article').count(), report.trends.length);
    assert.deepEqual(await page.locator('.brief-resources a').evaluateAll(links => links.map(a => a.href)),
      report.stories.flatMap(story => story.links.map(link => link.url)));
    assert.deepEqual(await page.locator('.resource-address').allTextContents(),
      report.stories.flatMap(story => story.links.map(link => new URL(link.url).hostname.replace(/^www\./, ''))));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await page.getByRole('tab', { name: '外部资讯' }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => {
      const controls = [...document.querySelectorAll('.group-nav [role="tab"], .group-nav .save-image, .group-nav .appearance-toggle')];
      return controls.some((a, i) => controls.slice(i + 1).some(b => {
        const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
        return x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top;
      }));
    }), false, `navigation overlap at ${width}`);
    await page.screenshot({ path: path.join(output, `${width}.png`), fullPage: true });
    for (const group of groupEdition.pages) {
      await page.getByRole('tab', { name: group.label }).click();
      assert.equal(await page.locator('#digest-panel h1').innerText(), group.heading);
      assert.equal(await page.locator('.brief').count(), group.stories.length);
      assert.deepEqual(await page.locator('.brief-body > p:first-of-type').allTextContents(),
        group.stories.map(story => story.text));
      assert.deepEqual(await page.locator('.brief-comment p').allTextContents(),
        group.stories.map(story => story.aiComment));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: path.join(output, `${group.id}-${width}.png`), fullPage: true });
    }
    await page.getByRole('tab', { name: '外部资讯' }).click();
    await page.reload();
    await page.locator('#reading[data-page="external"]').waitFor();
    await page.locator('#date-picker').click();
    await page.locator('#archive-list [data-id="2026-09-24"]').click();
    assert.ok(page.url().endsWith('/2026-09-24/external'));
    assert.equal(await page.locator('.brief').count(), 0);
    await page.getByRole('tab', { name: '二群' }).click();
    assert.ok(await page.locator('.brief').count() > 0, 'Preserve earlier group editions');
    await page.goto(url + '#digest/2026-09-25/external');
    await page.getByRole('tab', { name: '外部资讯' }).focus();
    await page.keyboard.press('ArrowRight');
    assert.ok(page.url().endsWith('/group-1'));
    await page.keyboard.press('ArrowLeft');
    assert.ok(page.url().endsWith('/external'));
  }
  await page.getByRole('button', { name: '保存图片', exact: true }).click();
  await page.locator('#share-dialog[open]').waitFor();
  await page.waitForFunction(() => document.querySelector('#share-dialog img')?.naturalWidth > 0, null, { timeout: 60000 });
  assert.deepEqual(errors, []);
  console.log('External page passed: 320/390/820/1440, links, tabs, dates, history route, empty states, share image.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
