import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const newspaperRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const homeRoot = path.resolve(newspaperRoot, '../../../agent-hub-community.github.io');
const output = fileURLToPath(new URL('../output/playwright/themes-v2/', import.meta.url));
await mkdir(output, { recursive: true });

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/favicon.ico') return response.writeHead(204).end();
  const isNewspaper = pathname === '/newspaper' || pathname.startsWith('/newspaper/');
  const base = isNewspaper ? newspaperRoot : homeRoot;
  const rel = isNewspaper ? pathname.replace(/^\/newspaper\/?/, '') : pathname.replace(/^\/+/, '');
  const candidate = path.resolve(base, rel.endsWith('/') || !rel ? `${rel}index.html` : rel);
  if (!candidate.startsWith(base)) return response.writeHead(403).end();
  try {
    const body = await readFile(candidate);
    response.writeHead(200, { 'Content-Type': MIME[path.extname(candidate)] || 'application/octet-stream' }).end(body);
  } catch {
    console.warn(`404 ${pathname}`);
    response.writeHead(404).end();
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});

try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(`${origin}/newspaper/daily/2026-10-07/group-1/?theme=riemann-proof`);
    await page.locator('#digest-panel').waitFor();
    for (const mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction(m => document.documentElement.dataset.colorScheme === m, mode);
      await page.locator('.skin-art').evaluate(img => img.decode());
      const audit = await page.evaluate(() => {
        const brand = document.querySelector('.masthead-brand');
        const art = document.querySelector('.skin-art').getBoundingClientRect();
        const texts = [...document.querySelectorAll('.masthead-brand .wordmark, .masthead-brand #date-label, .skin-note .skin-label, .skin-note .skin-message')];
        const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
        const lum = value => rgb(value).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
          .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const bandBg = lum(getComputedStyle(brand).backgroundColor);
        const visible = texts.filter(el => el.getBoundingClientRect().height > 0);
        const overlaps = visible.filter(el => {
          const r = el.getBoundingClientRect();
          return Math.min(r.right, art.right) - Math.max(r.left, art.left) > 1 &&
            Math.min(r.bottom, art.bottom) - Math.max(r.top, art.top) > 1;
        }).map(el => el.className);
        const contrasts = visible.map(el => {
          const fg = lum(getComputedStyle(el).color);
          return (Math.max(fg, bandBg) + 0.05) / (Math.min(fg, bandBg) + 0.05);
        });
        return {
          skin: document.body.dataset.skin,
          overflow: document.documentElement.scrollWidth > innerWidth,
          overlaps,
          minContrast: Math.min(...contrasts),
          bannerVisible: (() => {
            const el = document.getElementById('theme-knowledge-banner');
            return Boolean(el && !el.hidden);
          })(),
          storyBadges: document.querySelectorAll('.theme-story-badge').length,
        };
      });
      assert.equal(audit.skin, 'riemann-proof');
      assert.equal(audit.overflow, false, `${width} ${mode}: no horizontal overflow`);
      assert.deepEqual(audit.overlaps, [], `${width} ${mode}: no art/text overlap`);
      assert.ok(audit.minContrast >= 4.5, `${width} ${mode}: min contrast ${audit.minContrast}`);
      assert.equal(audit.bannerVisible, false, `${width} ${mode}: banner stays out of single-group reading page`);
      assert.ok(audit.storyBadges >= 1, `${width} ${mode}: Riemann story receives keyword badge`);
      if (width === 1440 || width === 390) {
        await page.screenshot({ path: path.join(output, `daily-riemann-${mode}-${width}.png`) });
      }
    }
  }

  // Test overview page: banner + cross-group links show here, story modal opens, and dismiss hides banner
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`${origin}/newspaper/daily/2026-10-07/overview/?theme=riemann-proof`);
  await page.locator('#theme-knowledge-banner:not([hidden])').waitFor();
  await page.screenshot({ path: path.join(output, 'daily-riemann-overview-1440.png') });
  await page.locator('.skin-story-trigger').click();
  await page.locator('#theme-story-dialog[open]').waitFor();
  await page.screenshot({ path: path.join(output, 'daily-riemann-story-dialog.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#theme-story-dialog[open]').count(), 0);
  await page.locator('.theme-banner-close').click();
  assert.equal(await page.locator('#theme-knowledge-banner').isVisible(), false);

  // Verify static pages (library, glossary, weekly) also render riemann-proof cleanly
  for (const route of ['/newspaper/library/?theme=riemann-proof', '/newspaper/glossary/?theme=riemann-proof', '/newspaper/weekly/?theme=riemann-proof']) {
    await page.goto(`${origin}${route}`);
    await page.waitForFunction(() => document.body.dataset.skin === 'riemann-proof');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `${route}: no overflow`);
  }
  await page.screenshot({ path: path.join(output, 'library-riemann-light-1440.png') });

  // Verify community homepage syncs with /newspaper/themes.json
  await page.goto(`${origin}/?theme=riemann-proof`);
  await page.waitForFunction(() => document.documentElement.dataset.themePack === 'riemann-proof');
  const homeCheck = await page.evaluate(() => ({
    pill: document.querySelector('.header-theme-pill')?.textContent?.trim(),
    ribbon: document.querySelector('.hub-theme-ribbon')?.textContent?.trim(),
    humanColor: getComputedStyle(document.documentElement).getPropertyValue('--color-hand-human').trim(),
    machineColor: getComputedStyle(document.documentElement).getPropertyValue('--color-hand-machine').trim(),
  }));
  assert.equal(homeCheck.pill, '黎曼猜想特刊');
  assert.match(homeCheck.ribbon, /黎曼猜想特刊/);
  assert.equal(homeCheck.humanColor, '#f5cf7a');
  assert.equal(homeCheck.machineColor, '#8bb8ff');
  await page.screenshot({ path: path.join(output, 'home-riemann-hero-1440.png') });

  assert.deepEqual(errors, [], `No browser errors: ${errors.join('; ')}`);
  console.log('Theme Pack v2 browser audit passed: daily (light/dark × 3 widths), story modal, static pages (library/glossary/weekly), and homepage sync.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
