import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(process.env.DIST_DIR || path.join(root, 'dist'));
const screenshots = process.env.SCREENSHOT_DIR || path.join(root, 'output/playwright/responsive');
await mkdir(screenshots, { recursive: true });
// Exercise the existing local build without rebuilding or modifying its files.
const css = await readFile(path.join(root, 'style.css'));
const sourceUI = new Map([['/style.css', css]]);
if (process.env.SOURCE_UI === '1') {
  for (const name of ['daily.css', 'digest.js']) {
    sourceUI.set(`/${name}`, await readFile(path.join(root, name)));
  }
}
const files = new Map(await Promise.all((await readdir(dist, { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile())
  .map(async entry => {
    const file = path.join(entry.parentPath, entry.name);
    return [file, await readFile(file)];
  })));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${dist}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    const content = sourceUI.get(pathname) || files.get(file);
    if (!content) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const errors = [];
const external = [];
const failed = [];
const sizes = [
  [320, 640], [375, 812], [390, 844], [430, 932],
  [600, 960], [768, 1024], [820, 1180], [834, 1194],
  [1024, 1366], [1180, 1640],
];
const viewports = [
  ...sizes.flatMap(([width, height]) => [{ width, height }, { width: height, height: width }]),
  ...[601, 700, 701, 900, 901, 950, 951, 1199, 1200, 1440, 1920, 2560].map(width => ({ width, height: 1000 })),
];
let checks = 0;
let page;

async function layout(label, touch = true) {
  const result = await page.evaluate(touch => {
    const visible = el => el.getBoundingClientRect().width && el.getBoundingClientRect().height;
    const name = el => el.id || `${el.tagName}.${el.className}`;
    const elements = [...document.querySelectorAll('.paper-shell *, dialog[open], dialog[open] *')];
    const overflow = elements.filter(el => visible(el) && (
      el.getBoundingClientRect().left < -1 ||
      el.getBoundingClientRect().right > innerWidth + 1 ||
      (el.clientWidth && el.scrollWidth > el.clientWidth + 1)
    )).map(name);
    const overlap = [];
    for (const selector of ['.masthead-main', '.edition-nav', '.edition-bar', '.edition-controls', '.group-nav', '.digest-heading-top', '.ranking-heading', '.rank-tabs', '.dialog-header']) {
      const parent = document.querySelector(selector);
      if (!parent || !visible(parent)) continue;
      const children = [...parent.children].filter(visible);
      for (let i = 0; i < children.length; i++) {
        for (let j = i + 1; j < children.length; j++) {
          const a = children[i].getBoundingClientRect(), b = children[j].getBoundingClientRect();
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
            overlap.push(`${selector}: ${name(children[i])} / ${name(children[j])}`);
          }
        }
      }
    }
    const targets = touch ? [...document.querySelectorAll(
      '.masthead button, .group-nav button, .rank-tabs button, .page-arrows button, #back-top, dialog[open] button',
    )].filter(visible).filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width < 43.9 || rect.height < 43.9;
    }).map(name) : [];
    return { overflow, overlap, targets, documentOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
  }, touch);
  assert.deepEqual(result, { overflow: [], overlap: [], targets: [], documentOverflow: false }, label);
  checks++;
}

async function screenshot(name, fullPage = false) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage });
}

async function storyLayout(label, count) {
  const result = await page.evaluate(() => {
    const grid = document.querySelector('.digest-stories');
    const box = el => {
      const { left, top, right, bottom, width } = el.getBoundingClientRect();
      return { left, top, right, bottom, width };
    };
    return {
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
      grid: grid && box(grid),
      empty: !!document.querySelector('.digest-empty'),
      stories: [...document.querySelectorAll('.brief')].map(el => {
        const style = getComputedStyle(el);
        const heading = el.querySelector('h2');
        return {
          ...box(el), headings: el.querySelectorAll('h2').length,
          headingFont: heading && getComputedStyle(heading).font,
          borders: [style.borderLeftWidth, style.borderRightWidth, style.borderBottomWidth],
          topBorder: style.borderTopWidth, shadow: style.boxShadow,
          content: [...el.querySelectorAll('.brief-category, h2, p')].map(box),
        };
      }),
    };
  });
  assert.equal(result.stories.length, count, label);
  assert.equal(result.empty, count === 0, `${label}: empty state`);
  if (!count) {
    assert.equal(result.grid, null, `${label}: no empty grid`);
    return;
  }
  const width = page.viewportSize().width;
  const columns = width <= 700 ? 1 : width < 1200 ? 2 : 3;
  assert.equal(result.columns, columns, `${label}: column count`);
  const columnWidth = result.stories[0].width;
  for (let i = 0; i < count; i++) {
    const story = result.stories[i];
    assert.equal(story.headings, 1, `${label}: story ${i + 1} uses h2`);
    assert.equal(story.headingFont, result.stories[0].headingFont, `${label}: same heading hierarchy`);
    assert.deepEqual(story.borders, ['0px', '0px', '0px'], `${label}: no frame or vertical rules`);
    assert.equal(story.topBorder, '1px', `${label}: horizontal separator`);
    assert.equal(story.shadow, 'none', `${label}: no card shadow`);
    assert.ok(Math.abs(story.width - columnWidth) < 1, `${label}: equal width`);
    assert.ok(story.bottom <= result.grid.bottom + 1, `${label}: contained in grid`);
    for (let j = 0; j < story.content.length; j++) {
      const content = story.content[j];
      assert.ok(content.left >= story.left - 1 && content.right <= story.right + 1 &&
        content.top >= story.top - 1 && content.bottom <= story.bottom + 1, `${label}: content fits story ${i + 1}`);
      if (j) assert.ok(content.top >= story.content[j - 1].bottom - 1, `${label}: text does not overlap`);
    }
    const column = i % columns;
    if (column) {
      assert.ok(Math.abs(story.top - result.stories[i - column].top) < 1, `${label}: shared row top`);
      assert.ok(story.left >= result.stories[i - 1].right, `${label}: left-to-right order`);
    } else {
      assert.ok(Math.abs(story.left - result.grid.left) < 1, `${label}: row starts at left`);
      if (i) assert.ok(story.top >= Math.max(...result.stories.slice(i - columns, i).map(item => item.bottom)),
        `${label}: new row clears every story in previous row`);
    }
  }
}

async function storyCountMatrix() {
  // Synthetic layout fixtures live only in the browser; archive data stays unchanged.
  const original = await page.evaluate(() => JSON.stringify(AGENT_HUB_DATA));
  for (const width of [320, 390, 700, 701, 820, 1199, 1200, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 1000 });
    for (let count = 0; count <= 9; count++) {
      await page.evaluate(count => {
        const issue = structuredClone(AGENT_HUB_DATA.digests.at(-1));
        const current = issue.pages[0];
        current.heading = '布局测试夹具';
        current.theme = '仅测试使用，不属于日报内容';
        current.note = '测试夹具';
        delete current.figure;
        delete current.papers;
        current.stories = Array.from({ length: count }, (_, i) => ({
          category: `测试分类 ${i + 1}`,
          title: i % 3 === 0 ? `测试观点 ${i + 1}：较长标题用于检查多行排版和同级标题` : `测试观点 ${i + 1}`,
          text: '这是仅用于布局验证的文字。'.repeat(2 + i % 4) +
            (i === 4 ? 'LongUnbrokenLayoutTestToken'.repeat(6) : ''),
          ...(i % 2 === 0 ? { takeaway: '测试摘记用于检查可选内容的自然高度。' } : {}),
        }));
        window.renderDigest(issue, () => {}, AGENT_HUB_DATA, current.id);
      }, count);
      const label = `${width}px / ${count} stories`;
      await storyLayout(label, count);
      await layout(label, false);
      assert.equal(await page.locator('.page-footer, #page-prev, #page-next').count(), 0);
      if ([390, 820, 1440].includes(width) && [0, 6, 9].includes(count)) {
        await screenshot(`fixture-${count}-stories-${width}`, true);
      }
    }
  }
  assert.equal(await page.evaluate(() => JSON.stringify(AGENT_HUB_DATA)), original, 'fixtures never mutate archive data');
  await page.reload();
  await page.locator('#digest-panel').waitFor();
}

try {
  const context = await browser.newContext({ hasTouch: true, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(url).origin) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (!response.ok()) failed.push(`${response.status()} ${response.url()}`); });
  await page.goto(url);
  await page.locator('#digest-panel').waitFor();
  const fixture = await page.evaluate(() => ({
    hasActivity: !!AGENT_HUB_DATA.activity,
    editions: AGENT_HUB_DATA.digests.map(issue => issue.id),
  }));
  console.log(`Snapshot: activity=${fixture.hasActivity}; ${files.size} files from ${dist}`);
  await storyCountMatrix();

  for (const viewport of viewports) {
    const label = `${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    await page.goto(`${url}#digest`);
    await page.locator('#digest-panel').waitFor();
    await page.locator('[role="tab"]:not(:disabled)').first().click();
    await layout(`${label}: digest`);
    if (viewport.width <= 700) {
      assert.ok(await page.locator('.masthead').evaluate(el => el.getBoundingClientRect().height <= 225), `${label}: compact masthead with date navigation`);
      assert.equal(await page.locator('#date-picker').isVisible(), true);
      assert.equal(await page.locator('#archive-toggle').isVisible(), false);
      assert.equal(await page.locator('.masthead-main #date-picker').isVisible(), true, `${label}: the date stays in the masthead`);
    }
    const current = await page.evaluate(() => {
      const issue = AGENT_HUB_DATA.digests.find(item => `digest/${item.id}` === document.body.dataset.edition);
      const edition = issue.pages.find(p => p.id === document.querySelector('#reading').dataset.page);
      return {
        stories: edition.stories?.length || 0,
        figure: !!edition.stories?.length && !!edition.figure,
        takeaway: edition.stories?.some(story => story.takeaway),
        daily: AGENT_HUB_DATA.activity?.groups.find(group => group.id === edition.id)?.daily[issue.date]?.leaders.slice(0, 3).length || 0,
        papers: issue.pages.find(item => item.papers)?.papers.length || 0,
        pages: issue.pages.length,
        firstPage: edition.id,
      };
    });
    await storyLayout(label, current.stories);
    const preserved = ['#footer-note', '#back-top'];
    if (current.stories) preserved.push('.brief-category');
    if (current.figure) preserved.push('.lead-figure');
    if (current.takeaway) preserved.push('.brief-takeaway');
    for (const selector of preserved) {
      assert.ok(await page.locator(selector).first().isVisible(), `${label}: preserve ${selector}`);
    }
    await page.locator('.lead-figure img, .daily-leaders img, .activity-leaders img').evaluateAll(
      images => Promise.all(images.map(image => image.decode())),
    );
    assert.equal(await page.locator('.daily-leaders li').count(), current.daily);
    assert.equal(await page.locator('#sidebar .activity-leaders li').count(), 0);
    const positions = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const reading = rect('#reading'), content = rect('.reading-layout'), daily = rect('.daily-ranking'), headline = rect('.digest-heading h1');
      return {
        ranks: Math.abs(daily.right - reading.right) < 1 && daily.bottom <= headline.top,
        fullWidth: Math.abs(content.width - reading.width) < 1,
      };
    });
    assert.deepEqual(positions, { ranks: true, fullWidth: true }, `${label}: ranking hierarchy`);
    await screenshot(`digest-${label}`, viewport.width <= 430);
    await page.locator('#date-picker').click();
    await page.locator('[data-jump="rank"]').click();
    await page.waitForFunction(() => document.body.dataset.view === 'rank');
    for (const period of ['month', 'all', 'week']) {
      await page.locator(`[data-rank="${period}"]`).click();
      assert.equal(await page.locator(`[data-rank="${period}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[aria-labelledby="rank-community"] .activity-leaders li').count(), fixture.hasActivity ? 3 : 0);
      await layout(`${label}: ${period} ranking`);
    }
    await page.locator('[data-mode="digest"]').click();
    for (let index = 1; index < current.pages; index++) {
      if (await page.locator(`[data-page="${index}"]`).isDisabled()) continue;
      await page.locator(`[data-page="${index}"]`).click();
      await layout(`${label}: digest page ${index + 1}`);
    }
    assert.equal(await page.locator('.paper-list article').count(), current.papers);
    await page.locator('[role="tab"]:not(:disabled)').first().focus();
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#reading').getAttribute('data-page'), current.firstPage);

    await page.locator('#date-picker').click();
    assert.ok(await page.locator('#archive-dialog').isVisible());
    assert.equal(await page.locator('[data-jump="week"], [data-jump="topic"]').count(), 0);
    await layout(`${label}: daily archive dialog`);
    await page.locator('#archive-list button:not(:disabled)').first().click();
    assert.equal(await page.locator('#archive-dialog').isVisible(), false);
    await layout(`${label}: oldest digest`);
    console.log(`Passed ${label}: digest, three ranks, group pages, archive dialog`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${url}#digest`);
  await page.locator('#digest-panel').waitFor();
  await page.locator('[role="tab"]:not(:disabled)').first().tap();
  await page.locator('[data-page="1"]').tap();
  assert.equal(await page.locator('#reading').getAttribute('data-page'), 'group-2');
  const swipe = async (dx, dy) => {
    await page.locator('#reading').dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 200, clientY: 450 }] });
    await page.locator('#reading').dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: 200 + dx, clientY: 450 + dy }] });
  };
  await swipe(-100, 10);
  assert.equal(await page.locator('#reading').getAttribute('data-page'), 'group-2', 'reading gestures must not change editions');
  await swipe(10, 100);
  assert.equal(await page.locator('#reading').getAttribute('data-page'), 'group-2', 'vertical scrolling must not flip pages');
  await swipe(100, 10);
  assert.equal(await page.locator('#reading').getAttribute('data-page'), 'group-2');
  // Historical content contains longer titles and links than the latest edition.
  for (const width of [320, 768, 1180]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const id of fixture.editions) {
      await page.goto(`${url}#digest/${id}`);
      await page.waitForFunction(id => document.body.dataset.edition === `digest/${id}`, id);
      await layout(`${width}: daily ${id}`);
    }
  }
  // Desktop mouse mode also checks the real edition, without fixture content.
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page = await desktop.newPage();
  await page.goto(url);
  await page.locator('#digest-panel').waitFor();
  await layout('desktop mouse', false);
  await storyLayout('desktop mouse', await page.locator('.brief').count());
  await screenshot('desktop-mouse-1440x1000');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(failed, []);
  console.log(`Passed ${checks} layout checks across ${viewports.length} touch viewports, desktop mouse, and ${fixture.editions.length} daily editions at three widths. Screenshots: ${screenshots}`);
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
