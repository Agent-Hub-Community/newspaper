import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const output = fileURLToPath(new URL('../output/playwright/skins/', import.meta.url));
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = path.resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
  if (!file.startsWith(root)) return response.writeHead(403).end();
  try {
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg' }[path.extname(file)];
    // Read before writing headers so a missing file can still answer 404 instead of crashing the server.
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': type || 'application/octet-stream' }).end(body);
  } catch { console.warn(`404 ${pathname}`); response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const skin = 'mid-autumn';
  for (const width of [320, 390, 700, 701, 820, 1199, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${url}?skin=${skin}#digest/2026-09-24/group-1`);
    await page.locator('#digest-panel').waitFor();
    for (const mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction(mode => document.documentElement.dataset.colorScheme === mode, mode);
      await page.locator('.skin-art').evaluate(image => image.decode());
      await page.locator('.skin-flora').evaluate(image => image.decode());
      const result = await page.evaluate(() => {
        const masthead = document.querySelector('.masthead');
        const art = document.querySelector('.skin-art').getBoundingClientRect();
        const texts = [...document.querySelectorAll('.masthead-brand .wordmark, .masthead-brand #date-picker, .skin-note > span')];
        const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
        const luminance = value => rgb(value).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
          .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        const background = luminance(getComputedStyle(document.querySelector('.masthead-brand')).backgroundColor);
        const contrast = texts.filter(el => el.getBoundingClientRect().height).map(el => {
          const foreground = luminance(getComputedStyle(el).color);
          const ownBackground = getComputedStyle(el).backgroundColor;
          const bg = ownBackground === 'rgba(0, 0, 0, 0)' ? background : luminance(ownBackground);
          return (Math.max(foreground, bg) + .05) / (Math.min(foreground, bg) + .05);
        });
        const flora = document.querySelector('.skin-flora').getBoundingClientRect();
        const overlaps = texts.filter(el => {
          const r = el.getBoundingClientRect();
          return r.width && r.height && [art, flora].some(image => Math.min(r.right, image.right) - Math.max(r.left, image.left) > 1 &&
            Math.min(r.bottom, image.bottom) - Math.max(r.top, image.top) > 1);
        }).map(el => el.className);
        const readingBackground = luminance(getComputedStyle(document.body).backgroundColor);
        const readingContrast = [...document.querySelectorAll('.brief p, .brief-category, .brief-resources a, .paper-footer, .brief-comment-label')].map(el => {
          const foreground = luminance(getComputedStyle(el).color);
          return (Math.max(foreground, readingBackground) + .05) / (Math.min(foreground, readingBackground) + .05);
        });
        const shell = document.querySelector('.paper-shell');
        const gutter = getComputedStyle(shell, '::before');
        return {
          skin: masthead.dataset.skin,
          bodySkin: document.body.dataset.skin,
          noteLeft: document.querySelector('.skin-label').getBoundingClientRect().left,
          brandContentLeft: document.querySelector('.masthead-brand').getBoundingClientRect().left +
            parseFloat(getComputedStyle(document.querySelector('.masthead-brand')).paddingLeft),
          overflow: document.documentElement.scrollWidth > innerWidth,
          height: masthead.getBoundingClientRect().height,
          overlaps,
          contrast,
          readingContrast,
          gutterVisible: gutter.content !== 'none',
          ink: getComputedStyle(document.querySelector('.wordmark')).color,
          paper: getComputedStyle(document.querySelector('.masthead-brand')).backgroundColor,
          brandBounds: {
            left: document.querySelector('.masthead-brand').getBoundingClientRect().left,
            right: document.querySelector('.masthead-brand').getBoundingClientRect().right,
            topBorder: getComputedStyle(document.querySelector('.masthead-brand')).borderTopWidth,
          },
          firstParagraph: document.querySelector('.brief p').getBoundingClientRect().top,
        };
      });
      assert.equal(result.skin, skin);
      assert.equal(result.bodySkin, skin);
      if (skin === 'mid-autumn' && width > 700) {
        assert.ok(Math.abs(result.noteLeft - result.brandContentLeft) < 1, `${mode}: festival note aligns with left masthead edge`);
      }
      assert.equal(result.overflow, false, `${width} ${mode}`);
      assert.deepEqual(result.overlaps, [], `${width} ${mode}`);
      assert.ok(result.contrast.every(ratio => ratio >= 4.5), `${width} ${mode}: text contrast ${result.contrast}`);
      assert.ok(result.readingContrast.every(ratio => ratio >= 4.5), `${width} ${mode}: reading contrast ${result.readingContrast}`);
      assert.equal(result.gutterVisible, false, `${skin}: no decorative outer frame`);
      assert.deepEqual(result.brandBounds, { left: 0, right: width, topBorder: '0px' }, 'masthead is an unframed full-width band');
      if (width <= 700) {
        assert.ok(result.height <= 225, `${width}: header height ${result.height}`);
        if (width >= 390) assert.ok(result.firstParagraph < 540, `${width}: first paragraph below the added 60px date navigation ${result.firstParagraph}`);
      }
      assert.notEqual(result.ink, result.paper);
      await page.screenshot({ path: path.join(output, `${skin}-${mode}-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${url}?skin=mid-autumn#digest/2026-09-24/group-1`);
  await page.emulateMedia({ colorScheme: 'dark' });
  const appearance = page.locator('.appearance-toggle:visible');
  assert.equal(await appearance.getAttribute('data-mode'), 'system');
  await appearance.click();
  assert.equal(await page.locator('html').getAttribute('data-color-scheme'), 'light');
  await page.reload();
  assert.equal(await appearance.getAttribute('data-mode'), 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await appearance.click();
  assert.equal(await page.locator('html').getAttribute('data-color-scheme'), 'dark');
  await appearance.focus();
  await page.keyboard.press('Enter');
  assert.equal(await appearance.getAttribute('data-mode'), 'system');
  assert.equal(await page.locator('html').getAttribute('data-color-scheme'), 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.colorScheme === 'dark');
  assert.equal(await page.locator('html').getAttribute('data-color-scheme'), 'dark');
  await page.getByRole('tab', { name: '二群' }).click();
  assert.equal(await appearance.getAttribute('data-mode'), 'system');
  assert.equal(await page.locator('.masthead').getAttribute('data-skin'), 'mid-autumn');
  await page.locator('#date-picker').click();
  await page.locator('#archive-list button:not(:disabled)').first().click();
  assert.equal(await page.locator('.masthead').getAttribute('data-skin'), 'mid-autumn', 'campaign does not depend on archive date');
  // Removing the skin must restore global colors without reflowing articles.
  const readingStyle = () => page.locator('.brief p').first().evaluate(el => {
    const style = getComputedStyle(el), r = el.getBoundingClientRect();
    return { color: style.color, paper: getComputedStyle(document.body).backgroundColor,
      width: r.width, height: r.height, font: style.font, lineHeight: style.lineHeight };
  });
  await page.goto(`${url}?skin=mid-autumn#digest/2026-09-24/group-1`);
  const themed = await readingStyle();
  await page.goto(`${url}?skin=default#digest/2026-09-24/group-1`);
  const plain = await readingStyle();
  assert.notEqual(themed.color, plain.color);
  assert.notEqual(themed.paper, plain.paper);
  assert.deepEqual([themed.width, themed.height, themed.font, themed.lineHeight], [plain.width, plain.height, plain.font, plain.lineHeight]);
  assert.equal(await page.locator('.skin-note').isVisible(), false);
  assert.equal(await page.locator('.skin-flora').isVisible(), false);
  assert.equal(await page.locator('body').getAttribute('data-skin'), 'default');
  assert.equal(await page.locator('.masthead').getAttribute('data-skin'), 'default');
  // An open page must enter and leave a campaign without a reload.
  await page.clock.install({ time: new Date('2026-09-24T15:59:59Z') });
  await page.goto(url);
  assert.equal(await page.locator('.masthead').getAttribute('data-skin'), 'default');
  await page.clock.runFor(1100);
  assert.equal(await page.locator('.masthead').getAttribute('data-skin'), 'mid-autumn');
  assert.equal(await page.locator('body').getAttribute('data-skin'), 'mid-autumn');
  await page.clock.setSystemTime(new Date('2026-09-27T16:00:00Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  assert.equal(await page.locator('.masthead').getAttribute('data-skin'), 'default');
  assert.equal(await page.locator('body').getAttribute('data-skin'), 'default');
  assert.deepEqual(errors, []);
  console.log('Skins passed: paired appearances, 8 widths, navigation, preview, campaign boundaries and live expiry.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
