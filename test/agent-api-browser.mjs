// Run after a public build. All network traffic stays in this local fixture.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createLibrarySearch } from '../feedback/library-search.mjs';
import { contentBase, librarySearchUrl } from '../lib/agent-reading.mjs';
import { basePath } from '../lib/site.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  let relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  relative = relative.startsWith(basePath) ? relative.slice(basePath.length) : relative;
  if (relative.endsWith('/')) relative += 'index.html';
  const file = path.resolve(dist, relative);
  if (!file.startsWith(dist)) { res.writeHead(404).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  }
  catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } };
const handler = createLibrarySearch(async url => {
  assert.ok(url.startsWith(contentBase));
  return new Response(await readFile(path.join(dist, url.slice(contentBase.length))), { headers: { 'Content-Type': 'application/json' } });
});
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/')) return route.continue();
      if (url.includes('/votes')) return route.fulfill({ json: { items: {} } });
      return route.fulfill({ status: 200, body: '', contentType: 'text/javascript' });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}${basePath}library/`);
    for (const q of ['画图', '绘图', 'agent skills', 'A社', 'OSWorld 2.0', 'zzabsentzz']) {
      await page.locator('#library-search').fill(q);
      await page.waitForFunction(value => new URL(location.href).searchParams.get('q') === value, q);
      const visible = await page.locator('.entry:not([hidden])').evaluateAll(nodes => nodes.map(node => node.id));
      const response = await handler(new Request(librarySearchUrl + '?' + new URLSearchParams({ q, limit: '20', analytics_test: '1' })), env);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(visible.length, result.total, q + ': browser and API hit count');
      assert.deepEqual(visible.slice(0, 20), result.items.map(item => item.id), q + ': same ranking');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Verified six library queries against the public API on desktop and mobile; external traffic blocked.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
