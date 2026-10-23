import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const sourceUI = new Map();
if (process.env.SOURCE_UI === '1') {
  for (const name of ['daily.css', 'digest.js']) {
    sourceUI.set(name, await readFile(new URL(`../site/${name}`, import.meta.url)));
  }
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
    if (!file.startsWith(root)) return response.writeHead(403).end();
    const body = sourceUI.get(path.relative(root, file)) || await readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = process.env.BROWSER === 'webkit' ? await webkit.launch() : await chromium.launch({
  headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.locator('#digest-panel').waitFor();
  const metrics = await page.evaluate(() => ({
    masthead: document.querySelector('.masthead').getBoundingClientRect().height,
    firstParagraph: document.querySelector('.brief p')?.getBoundingClientRect().top,
    viewport: innerHeight,
  }));
  assert.ok(metrics.masthead <= 225, JSON.stringify(metrics));
  if (metrics.firstParagraph !== undefined) assert.ok(metrics.firstParagraph < metrics.viewport, JSON.stringify(metrics));
  const sections = await page.evaluate(() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect();
    const stories = [...document.querySelectorAll('.brief')].map(el => el.getBoundingClientRect());
    return {
      ordered: stories.every((rect, i) => !i || rect.top >= stories[i - 1].bottom),
      evidenceAfterDiscussion: !document.querySelector('.lead-figure') || box('.lead-figure').top >= box('.digest-stories').bottom,
      noSidebar: !document.querySelector('#sidebar'),
    };
  });
  assert.deepEqual(sections, { ordered: true, evidenceAfterDiscussion: true, noSidebar: true });
  assert.equal(await page.locator('.page-footer, #page-prev, #page-next').count(), 0);
  await page.getByRole('tab', { name: '二群' }).tap();
  // Path routes end with a slash; the file:// preview keeps hash routes.
  assert.match(page.url(), /\/group-2\/?$/);
  assert.equal(await page.evaluate(() => scrollY), 0);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'group-1');
  // 一群's tab follows the latest issue's data instead of assuming it has no copy.
  const firstGroupEmpty = await page.evaluate(() => !window.digestPageHasContent(AGENT_HUB_DATA.digests.at(-1).pages.find(p => p.id === 'group-1')));
  assert.equal(await page.locator('[data-page="0"]').isDisabled(), firstGroupEmpty);
  await page.getByRole('tab', { name: '三群' }).tap();
  await page.getByRole('tab', { name: '二群' }).tap();
  assert.match(page.url(), /\/group-2\/?$/);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#reading').dataset.page === 'group-2');
  await page.getByRole('tab', { name: '三群' }).tap();
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('#reading').dataset.page === 'group-2');
  await page.goForward();
  await page.waitForFunction(() => document.querySelector('#reading').dataset.page === 'group-3');
  await page.getByRole('tab', { name: '二群' }).tap();
  // Safari does not focus buttons on tap; establish keyboard focus for restoration.
  await page.locator('#date-picker').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#date-picker').getAttribute('aria-expanded'), 'true');
  // The date opens the archive list: the current issue is marked and the previous/next pager is on top.
  assert.equal(await page.locator('#archive-list .issue-row[aria-current="page"]').count(), 1);
  assert.equal(await page.locator('#archive-pagination').isVisible(), true);
  assert.ok(await page.locator('#archive-dialog').evaluate(el => Math.abs(el.getBoundingClientRect().bottom - innerHeight) < 2));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#date-picker').getAttribute('aria-expanded') === 'false');
  assert.equal(await page.locator('#date-picker').getAttribute('aria-expanded'), 'false');
  assert.ok(await page.locator('#date-picker').evaluate(el => document.activeElement === el));
  const latest = await page.locator('#date-label').innerText();
  const assertEditionDate = async () => {
    const date = await page.locator('#date-label').getAttribute('datetime');
    assert.equal(await page.locator('#date-label').innerText(), date.replaceAll('-', '.'));
    const expected = new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
    assert.equal(await page.locator('#date-weekday').innerText(), expected);
    assert.ok((await page.locator('#date-picker').getAttribute('aria-label')).includes(expected));
  };
  await assertEditionDate();
  // Phones step between issues from the archive the masthead date opens.
  const step = async label => {
    await page.locator('#date-picker').tap();
    await page.locator('#archive-pagination button', { hasText: label }).tap();
  };
  await step('上一期');
  assert.equal(await page.locator('#archive-dialog').isVisible(), false);
  assert.notEqual(await page.locator('#date-label').innerText(), latest);
  await assertEditionDate();
  // Stepping forward keeps 一群 when the newer day has its copy and falls back to the first group with copy otherwise.
  if (await page.locator('[data-page="0"]').isEnabled()) await page.getByRole('tab', { name: '一群', exact: true }).tap();
  const before = await page.locator('#reading').getAttribute('data-page');
  const expectedPage = await page.evaluate(id => {
    const pages = AGENT_HUB_DATA.digests.at(-1).pages;
    return window.digestPageHasContent(pages.find(p => p.id === id)) ? id : pages.find(window.digestPageHasContent).id;
  }, before);
  await step('下一期');
  assert.equal(await page.locator('#date-label').innerText(), latest);
  assert.equal(await page.locator('#reading').getAttribute('data-page'), expectedPage);
  await assertEditionDate();
  // One date button survives breakpoint changes and retains its action.
  for (const width of [820, 390, 554, 1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    // The date stays in the masthead at every width; nothing moves it between rows.
    assert.equal(await page.evaluate(() => document.querySelector('.edition-controls').parentElement.matches('.masthead-main')), true);
    assert.equal(await page.locator('#date-picker').count(), 1);
    assert.equal(await page.locator('#date-picker').isVisible(), true);
    assert.equal(await page.locator('#date-label').isVisible(), true);
    assert.equal(await page.locator('#date-weekday').isVisible(), true);
    assert.equal(await page.evaluate(() => {
      const date = document.querySelector('#date-picker').getBoundingClientRect();
      const logo = document.querySelector('.wordmark').getBoundingClientRect();
      return date.left < logo.right && date.right > logo.left && date.top < logo.bottom && date.bottom > logo.top;
    }), false, 'date and wordmark do not overlap');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    // Phones keep the group row for groups only; its save button sits in the section row instead.
    const toolbar = await page.locator('.group-nav').evaluate(nav => {
      const tabs = [...nav.querySelectorAll('[role="tab"]')].map(el => el.getBoundingClientRect());
      const compact = innerWidth <= 700;
      const save = (compact ? document.querySelector('.edition-nav .edition-save') : nav.querySelector('.group-tools')).getBoundingClientRect();
      const visible = el => el.getClientRects().length > 0;
      return {
        equalGroups: tabs.slice(0, 3).every(rect => Math.abs(rect.width - tabs[0].width) < 1),
        roomForExternal: tabs.at(-1).width >= 68,
        separated: compact ? !visible(nav.querySelector('.group-tools')) && save.width >= 44 : save.left - tabs.at(-1).right >= 7,
        aligned: tabs.every(rect => Math.abs(rect.top - tabs[0].top) < 1),
        targets: [...nav.querySelectorAll('button')].filter(visible).every(el => {
          const rect = el.getBoundingClientRect();
          return rect.width >= 44 && rect.height >= 44;
        }),
      };
    });
    assert.deepEqual(toolbar, { equalGroups: true, roomForExternal: true, separated: true, aligned: true, targets: true }, `${width}: balanced edition toolbar`);
    await page.locator('#date-picker').click();
    assert.equal(await page.locator('#archive-dialog').isVisible(), true);
    await page.locator('#archive-dialog [data-close]').click();
  }
  await page.goto(url + '#rank/week');
  await page.waitForFunction(() => document.body.dataset.view === 'rank');
  assert.equal(await page.locator('#date-picker').isVisible(), false);
  await page.getByRole('button', { name: '日报', exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.view === 'digest');
  assert.equal(await page.locator('#date-label').isVisible(), true);
  await assertEditionDate();
  await page.goto(url + '#digest/2026-09-21/invalid');
  await page.waitForFunction(() => document.querySelector('#reading').dataset.page === 'group-1');
  // Exercise enlarged typography through the permitted local stylesheet.
  await page.evaluate(() => {
    // Built stylesheets carry a ?v= content hash, so match the path only.
    const sheet = [...document.styleSheets].find(s => s.href && new URL(s.href).pathname.endsWith('/daily.css'));
    sheet.insertRule('@media (max-width: 700px) { body[data-view="digest"] .masthead-main .wordmark { font-size: 40px; } body[data-view="digest"] .masthead-main #date-label { font-size: 26px; } }', sheet.cssRules.length);
  });
  assert.equal(await page.locator('.wordmark').evaluate(el => getComputedStyle(el).fontSize), '40px');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  assert.equal(await page.locator('.wordmark').getAttribute('translate'), 'no');
  assert.ok((await page.locator('.wordmark').getAttribute('class')).split(' ').includes('notranslate'));
  // Synthetic bilingual-extension output, not a claim about any specific extension.
  await page.locator('.wordmark').evaluate(el => {
    el.append(document.createTextNode(' AgentHub 群聊'));
  });
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}: extended brand wraps`);
    assert.equal(await page.evaluate(() => {
      const logo = document.querySelector('.wordmark').getBoundingClientRect();
      const date = document.querySelector('#date-picker').getBoundingClientRect();
      return Math.min(logo.right, date.right) > Math.max(logo.left, date.left) &&
        Math.min(logo.bottom, date.bottom) > Math.max(logo.top, date.top);
    }), false, `${width}: extended brand clears date`);
  }
  assert.deepEqual(errors, []);
  console.log(`Mobile navigation passed: deep links, history, bottom sheet, focus, issue paging, breakpoints. ${JSON.stringify(metrics)}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
