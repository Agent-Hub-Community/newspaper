import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { chromium } from 'playwright';
import { loadSkins } from '../skins/build.mjs';

// Source-only fixture: no build, dist access, screenshots or downloaded files.
const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const skins = await loadSkins();
const { document } = parseHTML(await read('index.html'));
for (const node of document.querySelectorAll('script, link, meta[http-equiv]')) node.remove();
document.body.dataset.view = 'digest';
document.querySelector('#date-label').textContent = '2026.09.30';
document.querySelector('#date-weekday').textContent = '星期三';
document.querySelector('#reading').innerHTML = `<section class="digest-stories">
  <article class="brief"><div class="brief-category">测试栏目</div>
    <h2>刊头皮肤测试</h2><p>这段文字仅用于检查正文的字号、行距与阅读配色，不属于实际日报。</p>
  </article></section>`;
const style = document.createElement('style');
style.textContent = (await Promise.all(['style.css', 'daily.css', 'color-scheme.css'].map(read))).join('\n') + skins.css;
document.head.append(style);
const fixture = document.toString();
const runtime = await read('skins.js');
const screenshotRuntime = await read('node_modules/modern-screenshot/dist/index.js');
const shareRuntime = await read('share-image.js');
const assets = new Map(await Promise.all(skins.assets.map(async asset => [asset.file, await readFile(asset.source)])));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const page = await browser.newPage({ hasTouch: true, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://skin.test/**', async route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (!file) return route.fulfill({ contentType: 'text/html', body: fixture });
    if (assets.has(file)) return route.fulfill({ contentType: 'image/png', body: assets.get(file) });
    return route.abort();
  });
  async function open(width, mode, skin) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`http://skin.test/?skin=${skin}`);
    await page.evaluate(({ mode, data }) => {
      document.documentElement.dataset.colorScheme = mode;
      window.AGENT_HUB_DATA = { skins: data };
    }, { mode, data: skins.data });
    await page.addScriptTag({ content: runtime });
    if (skin !== 'default') await page.locator('.skin-art').evaluate(image => image.decode());
  }
  const reading = () => page.locator('.brief p').evaluate(element => {
    const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
    return { font: style.font, color: style.color, background: getComputedStyle(document.body).backgroundColor,
      width: bounds.width, height: bounds.height, lineHeight: style.lineHeight };
  });
  for (const width of [320, 390, 700, 701, 820, 1199, 1440, 1920]) {
    for (const mode of ['light', 'dark']) {
      await open(width, mode, 'default');
      const plain = await reading();
      await open(width, mode, 'national-day');
      assert.deepEqual(await reading(), plain, `${width} ${mode}: unchanged reading styles`);
      // The date sits in the masthead at every width, so it takes the band's ink like the wordmark.
      const colors = await page.evaluate(() => [document.querySelector('#date-label'), document.querySelector('.wordmark')].map(el => getComputedStyle(el).color));
      assert.equal(colors[0], colors[1], `${width} ${mode}: the date uses the masthead's ink`);
      const result = await page.evaluate(() => {
        const brand = document.querySelector('.masthead-brand');
        const rect = brand.getBoundingClientRect();
        const art = document.querySelector('.skin-art').getBoundingClientRect();
        const texts = [...document.querySelectorAll('.masthead-brand .wordmark, .masthead-brand .wordmark span, .masthead-top span, .skin-note span, .masthead-brand #date-label, .masthead-brand #date-weekday')];
        const visible = texts.filter(element => element.getBoundingClientRect().height);
        const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
          .map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
          .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
        const background = luminance(getComputedStyle(brand).backgroundColor);
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          bounds: [rect.left, rect.right],
          overlaps: visible.filter(element => {
            const r = element.getBoundingClientRect();
            return Math.min(r.right, art.right) > Math.max(r.left, art.left) + 1 &&
              Math.min(r.bottom, art.bottom) > Math.max(r.top, art.top) + 1;
          }).map(element => element.className),
          contrast: visible.map(element => {
            const foreground = luminance(getComputedStyle(element).color);
            return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
          }),
          artInside: art.left >= rect.left && art.right <= rect.right && art.top >= rect.top && art.bottom <= rect.bottom,
          height: document.querySelector('.masthead').getBoundingClientRect().height,
        };
      });
      assert.equal(result.overflow, false, `${width} ${mode}: overflow`);
      assert.deepEqual(result.bounds, [0, width]);
      assert.deepEqual(result.overlaps, [], `${width} ${mode}: sprite overlap`);
      assert.ok(result.contrast.every(ratio => ratio >= 4.5), `${width} ${mode}: contrast ${result.contrast}`);
      assert.equal(result.artInside, true);
      if (width <= 700) assert.ok(result.height <= 245, `${width}: masthead height ${result.height}`);
    }
  }
  // Exercise the real share implementation on a touch context to avoid downloads.
  for (const width of [390, 1440]) {
    for (const mode of ['light', 'dark']) {
      await open(width, mode, 'national-day');
      await page.addScriptTag({ content: screenshotRuntime });
      await page.addScriptTag({ content: shareRuntime });
      await page.evaluate(() => window.AgentHubShare.save('皮肤测试', 'skin-test.png'));
      const image = page.locator('#share-image');
      assert.equal(await image.isVisible(), true, `${width} ${mode}: exported preview`);
      const output = await image.evaluate(async image => {
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        // Gold firework pixels are distinct from every CSS text/background color.
        let fireworkPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] === 233 && pixels[i + 1] === 188 && pixels[i + 2] === 99) fireworkPixels++;
        }
        return { width: canvas.width, height: canvas.height, fireworkPixels };
      });
      assert.ok(output.width >= width && output.height > 0);
      assert.ok(output.fireworkPixels > 10, `${width} ${mode}: sprite is present in exported pixels`);
      assert.equal(await page.locator('.capture-stage').count(), 0);
    }
  }
  assert.deepEqual(errors, []);
  console.log('National Day: 16 responsive/contrast cases and 4 real PNG exports passed; no build or output files.');
} finally {
  await browser.close();
}
