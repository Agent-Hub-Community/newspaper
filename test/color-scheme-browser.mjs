import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { chromium } from 'playwright';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
// Reuse generated data/assets without building or changing the shared dist directory.
const dist = path.resolve(process.env.AGENT_HUB_DIST_DIR || path.join(root, 'dist'));
await readFile(path.join(dist, 'data.js'));
const output = path.join(root, 'output/playwright/color-scheme');
const { document } = parseHTML(await readFile(path.join(root, 'index.html'), 'utf8'));
// Skin bundles/config are generated separately; this test owns the unskinned color layer.
for (const node of document.querySelectorAll('link[href^="skins.css"], script[src^="skins.js"]')) node.remove();
const daily = [...document.querySelectorAll('link[rel="stylesheet"]')]
  .find(link => new URL(link.href, 'http://localhost').pathname === '/daily.css');
assert.ok(daily, 'The current template loads daily.css');
for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
  if (new URL(link.href, 'http://localhost').pathname === '/color-scheme.css') link.remove();
}
const scheme = document.createElement('link');
scheme.rel = 'stylesheet';
scheme.href = 'color-scheme.css';
daily.after(scheme);
const html = document.toString();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const generated = new Map([
  ['/icons.js', path.join(root, 'node_modules/lucide/dist/umd/lucide.js')],
  ['/screenshot.js', path.join(root, 'node_modules/modern-screenshot/dist/index.js')],
]);
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let body;
    if (pathname === '/' || pathname === '/index.html') body = html;
    else if (generated.has(pathname)) body = await readFile(generated.get(pathname));
    else {
      const base = pathname === '/data.js' || /^\/(?:assets|avatars|issues)\//.test(pathname) ? dist : root;
      const file = path.resolve(base, `.${pathname}`);
      if (!file.startsWith(`${base}${path.sep}`)) return response.writeHead(403).end();
      body = await readFile(file);
    }
    response.writeHead(200, {
      'Content-Type': pathname === '/' ? 'text/html' : types[path.extname(pathname)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});

// Measure actual computed foreground against the composited ancestor backgrounds.
async function contrast(locator, minimum = 4.5, property = 'color') {
  const result = await locator.evaluate((element, property) => {
    const rgba = value => value.match(/[\d.]+/g).map(Number);
    const over = (front, back) => front.slice(0, 3).map((v, i) => v * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
    const layers = [];
    for (let node = element; node; node = node.parentElement) layers.unshift(rgba(getComputedStyle(node).backgroundColor));
    const background = layers.reduce((back, front) => over(front, back), [255, 255, 255]);
    const foreground = over(rgba(getComputedStyle(element)[property]), background);
    const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const a = luminance(foreground), b = luminance(background);
    return { ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), foreground, background };
  }, property);
  assert.ok(result.ratio >= minimum, `${await locator.toString()} ${property}: contrast ${result.ratio.toFixed(2)} < ${minimum}`);
  return result;
}

const colors = page => page.evaluate(() => Object.fromEntries(
  ['body', '.wordmark', '.brief p', '.digest-deck', '.save-image', '.daily-ranking', '.feedback-actions button', '#archive-dialog', '#share-dialog']
    .map(selector => {
      const style = getComputedStyle(document.querySelector(selector));
      return [selector, [style.color, style.backgroundColor, style.borderTopColor, style.colorScheme]];
    }),
));

async function darkText(page) {
  for (const selector of ['body', '.wordmark', '#date-picker', '.digest-heading h1', '.brief h2', '.brief p',
    '.brief-category', '.digest-deck', '.daily-ranking', '.save-image', '.feedback-status',
    '.group-nav [aria-selected="true"]', '.brief-resources a', '.brief-comment-label', '.paper-footer']) {
    const item = page.locator(selector).first();
    if (await item.count() && await item.isVisible()) await contrast(item);
  }
  const background = await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number));
  assert.ok(Math.max(...background) < 45 && Math.max(...background) - Math.min(...background) < 8, 'Neutral charcoal background');
  assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).colorScheme), 'dark');
}

await mkdir(output, { recursive: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  for (const width of [320, 390, 820, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce', acceptDownloads: true,
    });
    // No analytics or feedback writes leave this test. Votes use the app's local mode.
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
      ? route.continue() : route.fulfill({ status: 200, body: '' }));
    await context.addInitScript(() => {
      Object.defineProperty(window, 'AGENT_HUB_DATA', {
        configurable: true,
        set(value) {
          delete value.feedbackEndpoint;
          Object.defineProperty(window, 'AGENT_HUB_DATA', { value, writable: true, configurable: true });
        },
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`);
    });
    await page.goto(`${url}#digest/2026-09-24/group-1`);
    await page.locator('#digest-panel').waitFor().catch(error => {
      throw new Error(`${error.message}\nPage errors: ${errors.join('\n')}`);
    });
    // Select a real edition containing feedback, independent of the newest edition's coverage.
    const hash = await page.evaluate(() => {
      const issue = [...window.AGENT_HUB_DATA.digests].reverse().find(issue =>
        issue.pages.some(page => page.id.startsWith('group-') && page.stories?.some(story => story.feedbackId)));
      if (!issue) return null;
      const group = issue.pages.find(page => page.id.startsWith('group-') && page.stories?.some(story => story.feedbackId));
      return `#digest/${encodeURIComponent(issue.id)}/${group.id}`;
    });
    assert.ok(hash, 'Existing build must include an edition with feedback IDs');
    await page.evaluate(hash => { location.hash = hash; }, hash);
    await page.locator('.story-feedback').first().waitFor();
    await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode().catch(() => {}))));
    const light = await colors(page);
    // Disabling only the new sheet proves light output is identical to the existing styles.
    await page.evaluate(() => { document.querySelector('link[href="color-scheme.css"]').disabled = true; });
    assert.deepEqual(await colors(page), light, `${width}: light unchanged`);
    await page.evaluate(() => { document.querySelector('link[href="color-scheme.css"]').disabled = false; });
    await page.screenshot({ path: `${output}/${width}-light.png`, fullPage: true });
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    const row = page.locator('.story-feedback').first();
    const up = row.locator('[data-vote="up"]'), down = row.locator('[data-vote="down"]');
    await up.click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.colorScheme === 'dark');
    await darkText(page);
    assert.equal(await up.getAttribute('aria-pressed'), 'true', 'Vote preserved across media changes');
    const positive = await contrast(up);
    assert.ok(positive.foreground[1] > positive.foreground[0], 'Up vote is muted green');
    await down.click();
    assert.equal(await up.getAttribute('aria-pressed'), 'false');
    assert.equal(await down.getAttribute('aria-pressed'), 'true');
    const negative = await contrast(down);
    assert.ok(negative.foreground[0] > negative.foreground[1], 'Down vote is muted red');
    await down.click();
    assert.equal(await down.getAttribute('aria-pressed'), 'false');
    await up.hover();
    await contrast(up);
    assert.notEqual(await up.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(239, 240, 236)', 'Hover no longer light');
    await down.focus();
    await page.keyboard.press('Shift+Tab');
    await contrast(up, 3, 'outlineColor');
    assert.equal(await up.evaluate(el => el.matches(':focus-visible')), true);
    await page.keyboard.press('Space');
    assert.equal(await up.getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: `${output}/${width}-dark.png`, fullPage: true });

    await page.locator('#date-picker').click();
    const dialog = page.locator('#archive-dialog');
    await contrast(dialog);
    await contrast(dialog.locator('.issue-row').first());
    await dialog.locator('[data-close]').hover();
    await contrast(dialog.locator('[data-close]'));
    const darkDialog = await dialog.evaluate(el => getComputedStyle(el).backgroundColor);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.colorScheme === 'light');
    assert.equal(await dialog.isVisible(), true);
    assert.notEqual(await dialog.evaluate(el => getComputedStyle(el).backgroundColor), darkDialog);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.colorScheme === 'dark');
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).backgroundColor), darkDialog);
    await page.screenshot({ path: `${output}/${width}-archive.png` });
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false);

    await page.locator('.save-image:visible').click();
    await page.locator('#share-image:not([hidden])').waitFor({ timeout: 30000 });
    await contrast(page.locator('#share-dialog'));
    await contrast(page.locator('#share-status'));
    await contrast(page.locator('#share-download'));
    const preview = await page.locator('#share-image').evaluate(async image => {
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 4 * 97) {
        if (Math.abs(pixels[i] - pixels[0]) + Math.abs(pixels[i + 1] - pixels[1]) + Math.abs(pixels[i + 2] - pixels[2]) > 60) ink++;
      }
      return { width: canvas.width, height: canvas.height, corner: [...pixels.slice(0, 4)], ink };
    });
    assert.ok(preview.width >= width && preview.height > 500 && preview.ink > 100, 'Saved image contains the full edition');
    assert.ok(Math.max(...preview.corner.slice(0, 3)) < 45 && preview.corner[3] === 255, 'Saved image uses dark paper');
    assert.equal(await page.locator('.capture-stage').count(), 0);
    await page.screenshot({ path: `${output}/${width}-share.png` });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#share-image').hasAttribute('src'));

    const groups = page.locator('.group-nav [role="tab"]');
    if (await groups.count() > 1) {
      await groups.first().focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await groups.nth(1).getAttribute('aria-selected'), 'true');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await groups.first().getAttribute('aria-selected'), 'true');
    }
    await page.locator('#date-picker').click();
    await page.locator('#archive-modes [data-jump="rank"]').click();
    await page.locator('[data-rank="month"]').click();
    assert.equal(await page.locator('[data-rank="month"]').getAttribute('aria-pressed'), 'true');
    await contrast(page.locator('[data-rank="month"]'));
    await contrast(page.locator('.rank-page-heading'));
    for (const selector of ['.rank-number', '.rank-since', '.rank-empty', '.avatar-missing']) {
      const items = page.locator(selector);
      if (await items.count()) await contrast(items.first());
    }
    await page.screenshot({ path: `${output}/${width}-rank.png`, fullPage: true });
    const darkRank = await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.colorScheme === 'light');
    assert.notEqual(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), darkRank);
    assert.equal(await page.locator('[data-rank="month"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-mode="digest"]').click();
    await page.evaluate(hash => { location.hash = hash; }, hash);
    await page.locator('.story-feedback').first().waitFor();
    await page.mouse.move(0, 0);
    await page.locator('#reading').focus();
    // Reset feedback to the initial state before comparing colors.
    if (await up.getAttribute('aria-pressed') === 'true') await up.click();
    await page.mouse.move(0, 0);
    assert.deepEqual(await colors(page), light, `${width}: dark -> light restored`);
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin, 'No reload during theme or view changes');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, [], `${width}: no page errors`);
    await context.close();
    console.log(`${width}px: unchanged light, live dark/light, contrast, feedback, dialogs, image pixels, groups and rankings passed`);
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
