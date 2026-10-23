import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root)) return response.writeHead(403).end();
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = process.env.BROWSER === 'webkit' ? await webkit.launch() : await chromium.launch({
  headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});

// Everything the image needs is measured on the live page before capture.
const layout = page => page.evaluate(() => {
  const shell = document.querySelector('.paper-shell').getBoundingClientRect();
  const avatar = document.querySelector('.daily-leaders img')?.getBoundingClientRect();
  const moon = document.querySelector('.skin-art:not([hidden])')?.getBoundingClientRect();
  const flora = document.querySelector('.skin-flora:not([hidden])')?.getBoundingClientRect();
  return {
    width: shell.width, height: shell.height, scrollY,
    feedback: document.querySelectorAll('.story-feedback').length,
    avatar: avatar && { x: avatar.x - shell.x + avatar.width / 2, y: avatar.y - shell.y + avatar.height / 2 },
    moon: moon && { x: moon.x - shell.x + moon.width / 2, y: moon.y - shell.y + moon.height / 2 },
    flora: flora && { x: flora.x - shell.x + flora.width * .65, y: flora.y - shell.y + flora.height * .65, width: flora.width * .25, height: flora.height * .25 },
  };
});
// Samples the rendered preview, so the check covers what readers actually save.
const inspect = (page, point) => page.evaluate(async point => {
  const img = document.querySelector('#share-image');
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const context = canvas.getContext('2d');
  context.drawImage(img, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const [br, bg, bb] = pixels;
  let ink = 0;
  for (let i = 0; i < pixels.length; i += 4 * 97) {
    if (Math.abs(pixels[i] - br) + Math.abs(pixels[i + 1] - bg) + Math.abs(pixels[i + 2] - bb) > 60) ink++;
  }
  const scale = canvas.width / point.width;
  let avatar = null;
  if (point.avatar) {
    const [r, g, b, a] = context.getImageData(Math.round(point.avatar.x * scale), Math.round(point.avatar.y * scale), 1, 1).data;
    avatar = a && Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb) > 12;
  }
  let moon = null;
  if (point.moon) {
    const [r, g, b] = context.getImageData(Math.round(point.moon.x * scale), Math.round(point.moon.y * scale), 1, 1).data;
    moon = Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb) > 30;
  }
  let flora = false;
  if (point.flora) {
    const f = point.flora;
    const crop = context.getImageData(Math.round(f.x * scale), Math.round(f.y * scale), Math.round(f.width * scale), Math.round(f.height * scale)).data;
    const colors = new Set();
    for (let i = 0; i < crop.length; i += 4) colors.add(`${crop[i]},${crop[i + 1]},${crop[i + 2]}`);
    flora = colors.size > 3;
  }
  return { width: canvas.width, height: canvas.height, ink, avatar, moon, flora, background: [br, bg, bb] };
}, point);

async function run(label, options, expectDownload, base = url) {
  const context = await browser.newContext({ ...options, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || /Content Security Policy/.test(message.text())) errors.push(message.text());
  });
  await page.goto(`${base}?skin=mid-autumn#digest/2026-09-24/group-1`);
  await page.locator('#digest-panel').waitFor();
  await page.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode().catch(() => {}))));
  const button = page.locator('.save-image:visible');
  // Scroll so the button sits near the top, and the check sees a nonzero scroll offset.
  await button.evaluate(el => window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 8, behavior: 'instant' }));
  const before = await layout(page);
  assert.ok(before.scrollY > 0, `${label}: page scrolled`);
  assert.equal(await button.isVisible(), true, `${label}: button visible`);
  const box = await button.boundingBox();
  assert.ok(box.width >= 43.9 && box.height >= 43.9, `${label}: touch target`);
  const downloads = [];
  page.on('download', download => downloads.push(download));
  if (options.hasTouch) await button.tap();
  else await button.click();
  assert.equal(await page.locator('#share-dialog').isVisible(), true);
  await page.locator('#share-image:not([hidden])').waitFor({ timeout: 30000 });
  const status = await page.locator('#share-status').innerText();
  assert.match(status, expectDownload ? /开始下载/ : /长按图片/, `${label}: status`);
  const after = await layout(page);
  assert.deepEqual(after, before, `${label}: the live page does not move or change`);
  assert.equal(await page.locator('.capture-stage').count(), 0, `${label}: off-screen copy removed`);
  const image = await inspect(page, before);
  const output = fileURLToPath(new URL('../output/playwright/share-image/', import.meta.url));
  await mkdir(output, { recursive: true });
  const dialogLayout = await page.evaluate(() => {
    const dialog = document.querySelector('#share-dialog');
    const preview = dialog.querySelector('.share-preview');
    const box = dialog.getBoundingClientRect();
    const image = document.querySelector('#share-image').getBoundingClientRect();
    const controls = [...dialog.querySelectorAll('button, a')].filter(el => !el.hidden);
    return {
      fits: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      width: box.width,
      overflow: dialog.scrollHeight > dialog.clientHeight + 1 || dialog.scrollWidth > dialog.clientWidth + 1,
      imageAccessible: image.height <= preview.clientHeight + 1 || preview.scrollHeight > preview.clientHeight,
      previewHeight: preview.clientHeight,
      imageFits: image.width <= preview.clientWidth + 1,
      controlsFit: controls.every(el => {
        const r = el.getBoundingClientRect();
        return r.width >= 44 && r.height >= 44 && r.top >= box.top && r.bottom <= box.bottom;
      }),
    };
  });
  assert.equal(dialogLayout.fits, true, `${label}: dialog fits viewport`);
  assert.equal(dialogLayout.overflow, false, `${label}: only preview scrolls`);
  assert.equal(dialogLayout.imageAccessible, true, `${label}: image fits or scrolls`);
  assert.equal(dialogLayout.imageFits, true, `${label}: image fits preview`);
  assert.equal(dialogLayout.controlsFit, true, `${label}: actions stay reachable`);
  assert.ok(dialogLayout.previewHeight > options.viewport.height * .45, `${label}: preview has room`);
  if (options.viewport.width <= 700) assert.equal(dialogLayout.width, options.viewport.width, `${label}: full-width mobile sheet`);
  const closeBefore = await page.locator('#share-dialog [data-close]').boundingBox();
  await page.locator('.share-preview').evaluate(el => { el.scrollTop = el.scrollHeight; });
  assert.deepEqual(await page.locator('#share-dialog [data-close]').boundingBox(), closeBefore, `${label}: close stays fixed`);
  const scale = image.width / before.width;
  assert.ok(scale >= 1.5 && scale <= 2.01, `${label}: scale ${scale}`);
  assert.ok(image.ink > 500, `${label}: image has content`);
  if (before.avatar) assert.equal(image.avatar, true, `${label}: avatars are drawn`);
  assert.equal(image.moon, true, `${label}: skin image is drawn`);
  assert.equal(image.flora, true, `${label}: mooncake detail is drawn`);
  if (options.colorScheme === 'dark') assert.ok(Math.max(...image.background) < 80, `${label}: dark capture background`);
  const shown = await page.evaluate(async () => {
    // Rebuild the same off-screen copy the image uses, to check what it leaves out.
    const shell = document.querySelector('.paper-shell');
    const stage = Object.assign(document.createElement('div'), { className: 'capture-stage' });
    stage.style.width = `${shell.getBoundingClientRect().width}px`;
    stage.append(shell.cloneNode(true));
    stage.querySelector('#back-top').replaceWith(Object.assign(document.createElement('span'), {
      className: 'capture-link', textContent: `${location.host}${location.pathname}${location.hash}`,
    }));
    document.body.append(stage);
    const hidden = ['.save-image', '.story-feedback', '.tabs', '#archive-toggle', '.appearance-toggle']
      .filter(selector => [...stage.querySelectorAll(selector)].some(el => el.getBoundingClientRect().height));
    const height = stage.firstChild.getBoundingClientRect().height;
    stage.remove();
    return { hidden, height };
  });
  assert.deepEqual(shown.hidden, [], `${label}: controls stay out of the image`);
  assert.ok(Math.abs(image.height / scale - shown.height) < 2, `${label}: whole page height ${image.height / scale} vs ${shown.height}`);
  if (expectDownload) {
    assert.equal(downloads.length, 1, `${label}: one download`);
    assert.match(downloads[0].suggestedFilename(), /^AgentHub日报-\d{4}-\d{2}-\d{2}-一群\.png$/);
    const bytes = await readFile(await downloads[0].path());
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${label}: PNG file`);
    assert.equal(bytes.readUInt32BE(16), image.width);
  } else {
    assert.equal(downloads.length, 0, `${label}: phones save by long-press`);
    assert.equal(await page.locator('#share-download').isVisible(), true);
  }
  await page.locator('#share-dialog [data-close]').click();
  assert.equal(await page.locator('#share-dialog').isVisible(), false);
  // The close event fires asynchronously; the preview is released in its handler.
  await page.waitForFunction(() => !document.querySelector('#share-image').hasAttribute('src'));
  // A second page renders on its own, without leftovers from the first.
  await page.getByRole('tab', { name: '二群' }).click();
  await page.locator('.save-image:visible').click();
  await page.locator('#share-image:not([hidden])').waitFor({ timeout: 30000 });
  assert.match(await page.locator('#share-image').getAttribute('alt'), /二群/);
  assert.equal(await page.locator('.share-preview').evaluate(el => el.scrollTop), 0, `${label}: new preview starts at top`);
  assert.deepEqual(errors, [], `${label}: no errors or CSP violations`);
  // Playwright's WebKit screenshot injects an inline stylesheet; check app CSP errors before that instrumentation.
  await page.screenshot({ path: path.join(output, `${process.env.BROWSER || 'chromium'}-${label.replaceAll(' ', '-')}.png`) });
  await page.keyboard.press('Escape');
  await context.close();
  console.log(`${label}: ${image.width}x${image.height}, avatars=${image.avatar}`);
}

async function recoveryAndNativeShare() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    await page.goto(`${url}?skin=default#digest/2026-09-25/group-2`);
    await page.locator('#digest-panel').waitFor();
    // The page loads the capture library on first save; load it now so the test can wrap it.
    await page.addScriptTag({ url: new URL('screenshot.js', url).href });
    await page.evaluate(() => {
      const render = modernScreenshot.domToBlob;
      let first = true;
      modernScreenshot.domToBlob = (...args) => {
        if (first) { first = false; return Promise.reject(new Error('Test render failure')); }
        return render(...args);
      };
      window.sharedFiles = [];
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: ({ files }) => files[0].type === 'image/png' });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async ({ files }) => {
        window.sharedFiles.push({ name: files[0].name, type: files[0].type, size: files[0].size });
        if (window.shareError) throw new DOMException('Test share failure', window.shareError);
      } });
    });
    await page.locator('.save-image:visible').tap();
    await page.locator('#share-retry:not([hidden])').waitFor();
    assert.equal(await page.locator('#share-image').isVisible(), false);
    await page.locator('#share-retry').tap();
    await page.locator('#share-image:not([hidden])').waitFor();
    await page.locator('#share-native').tap();
    const files = await page.evaluate(() => sharedFiles);
    assert.equal(files.length, 1);
    assert.equal(files[0].name, 'AgentHub日报-2026-09-25-二群.png');
    assert.equal(files[0].type, 'image/png');
    assert.ok(files[0].size > 1000);
    await page.evaluate(() => { window.shareError = 'AbortError'; });
    await page.locator('#share-native').tap();
    assert.match(await page.locator('#share-status').innerText(), /^长按/);
    await page.evaluate(() => { window.shareError = 'NotAllowedError'; });
    await page.locator('#share-native').tap();
    await page.waitForFunction(() => document.querySelector('#share-status').textContent.startsWith('分享失败'));
    assert.equal(await page.locator('#share-native').isEnabled(), true);
    assert.equal(await page.locator('#share-download').isVisible(), true);
    await page.locator('#share-dialog [data-close]').tap();
    await page.waitForFunction(() => !document.querySelector('#share-image').hasAttribute('src'));
    await page.evaluate(() => Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false }));
    await page.locator('.save-image:visible').tap();
    await page.locator('#share-image:not([hidden])').waitFor();
    assert.equal(await page.locator('#share-native').isVisible(), false);
    // Closing before a pending render finishes must not bring the dialog or image back.
    await page.locator('#share-dialog [data-close]').tap();
    await page.waitForFunction(() => !document.querySelector('#share-image').hasAttribute('src'));
    await page.evaluate(() => {
      modernScreenshot.domToBlob = () => new Promise(resolve => { window.finishRender = resolve; });
    });
    await page.locator('.save-image:visible').tap();
    await page.waitForFunction(() => typeof window.finishRender === 'function');
    await page.locator('#share-dialog [data-close]').tap();
    await page.evaluate(() => window.finishRender(new Blob(['test'], { type: 'image/png' })));
    assert.equal(await page.locator('#share-dialog').isVisible(), false);
    assert.equal(await page.locator('#share-image').getAttribute('src'), null);
    console.log('Share recovery and native API contract passed (native sheet mocked).');
  } finally { await context.close(); }
}

try {
  await run('local file dark 1440', { viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' }, true, pathToFileURL(path.join(root, 'index.html')).href);
  await run('local file light 390', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, false, pathToFileURL(path.join(root, 'index.html')).href);
  await run('desktop 1440', { viewport: { width: 1440, height: 1000 } }, true);
  await run('tablet 820', { viewport: { width: 820, height: 1180 } }, true);
  await run('phone 390', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }, false);
  await run('phone 320', { viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, false);
  await run('desktop dark 1440', { viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' }, true);
  await run('phone dark 390', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' }, false);
  await run('phone landscape', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }, false);
  await recoveryAndNativeShare();
  console.log('Share image passed: download, long-press preview, avatars, hidden controls, untouched page.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
