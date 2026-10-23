import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { basePath, site } from '../lib/site.mjs';

// Test the vendor script under the production CSP without sending real telemetry.
// Supply a freshly downloaded official script through CF_BEACON_FILE. While analytics.js has no token yet,
// the test serves it with a placeholder token so the loader and the beacon still run.
assert.ok(process.env.CF_BEACON_FILE, 'Set CF_BEACON_FILE to the official beacon.min.js');
const beacon = await readFile(process.env.CF_BEACON_FILE, 'utf8');
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const base = site;
const data = await readFile(path.join(root, 'data.js'), 'utf8');
assert.match(data, /"publicBuild":true/);
assert.doesNotMatch(data, /"policy":|"counted":|"activeDays":|"activity\.local"/);
const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const page = await browser.newPage();
  const requests = [], violations = [], unexpected = [];
  page.on('console', msg => {
    if (/Content Security Policy|Refused to/.test(msg.text())) violations.push(msg.text());
  });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = request.url();
    if (url === 'https://static.cloudflareinsights.com/beacon.min.js') {
      return route.fulfill({ contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: beacon });
    }
    if (url.startsWith('https://cloudflareinsights.com/cdn-cgi/rum')) {
      requests.push({ method: request.method(), data: request.postData() });
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }
    if (url.startsWith(base)) {
      const relative = new URL(url).pathname.slice(basePath.length) || 'index.html';
      assert.ok(!relative.includes('..'));
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
      let body = await readFile(path.join(root, relative));
      if (relative === 'analytics.js') body = body.toString().replace("const token = '';", `const token = '${'0'.repeat(32)}';`);
      return route.fulfill({ body, contentType: types[path.extname(relative)] });
    }
    unexpected.push(url);
    return route.abort();
  });
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('[data-cf-beacon]'));
  const waitForBeacon = async count => {
    await assert.doesNotReject(async () => {
      for (let i = 0; i < 100; i++) {
        if (requests.filter(r => r.method === 'POST').length > count) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Official beacon did not emit a POST');
    });
  };
  await waitForBeacon(0);
  const initialCount = requests.length;
  await page.locator('#date-picker').click();
  await page.locator('#archive-pagination button', { hasText: '上一期' }).click();
  await page.locator('#digest-panel').waitFor();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-cf-beacon]'));
  await waitForBeacon(initialCount);
  await page.goto('about:blank');
  assert.deepEqual(violations, []);
  assert.deepEqual(unexpected, []);
  assert.ok(requests.some(r => r.data?.includes(basePath)));
  assert.ok(requests.every(r => !r.data?.includes('/documents/')));
  assert.ok(requests.every(r => !/wxid_|@chatroom|avatar|activity\.local/.test(r.data || '')));
  console.log(`Official Cloudflare script emitted ${requests.length} intercepted requests; daily page CSP valid; no telemetry sent.`);
} finally {
  await browser.close();
}
