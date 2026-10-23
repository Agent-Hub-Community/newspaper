import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.AGENT_HUB_SITE_URL || pathToFileURL(path.join(root, 'dist/index.html')).href;
const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const network = [];
page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
const overflow = () => page.evaluate(() => [...document.querySelectorAll('.paper-shell *')]
  .filter(el => el.getBoundingClientRect().width && (el.getBoundingClientRect().right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 1))
  .map(el => `${el.tagName}.${el.className}`));
async function checkDigestPage() {
  const expected = await page.evaluate(() => {
    const id = document.body.dataset.edition.slice('digest/'.length);
    const issue = AGENT_HUB_DATA.digests.find(item => item.id === id);
    const current = issue.pages.find(item => item.id === document.querySelector('#reading').dataset.page);
    return { stories: current.stories || [], papers: current.papers || [], note: current.note, figure: current.figure };
  });
  assert.deepEqual(await page.locator('.brief h2').allTextContents(), expected.stories.map(story => story.title));
  assert.equal(await page.locator('.brief').count(), expected.stories.length);
  assert.equal(await page.locator('.paper-list article').count(), expected.papers.length);
  if (!expected.stories.length && !expected.papers.length) {
    assert.ok(await page.locator('.digest-empty').isVisible());
    const note = (expected.note || '').split(' · ').filter(part => part && !['当日本地记录', '无本地可读记录'].includes(part));
    if (note.some(part => !/^\d{4}-\d{2}-\d{2}$/.test(part))) {
      assert.equal(await page.locator('.digest-empty p').innerText(), note.join(' · '));
    } else {
      assert.equal(await page.locator('.digest-empty p').count(), 0);
    }
  }
  if (expected.stories.length && expected.figure) {
    assert.ok(await page.locator('.lead-figure').evaluate(el =>
      el.getBoundingClientRect().top >= document.querySelector('.digest-stories').getBoundingClientRect().bottom,
    ), 'paper evidence follows all discussion points');
    if (expected.figure.src) {
      await page.locator('.lead-figure img').evaluate(img => img.decode());
    } else {
      assert.equal(await page.locator('.lead-figure img').count(), 0);
    }
    assert.equal(await page.locator('.lead-figure figcaption a').getAttribute('href'), expected.figure.url);
  }
  const boxes = await page.locator('.brief').evaluateAll(items => items.map(el => {
    const { x, y, width, bottom } = el.getBoundingClientRect();
    return { x, y, width, bottom };
  }));
  for (let i = 0; i < boxes.length; i++) {
    assert.ok(Math.abs(boxes[i].width - boxes[0].width) < 1, 'all stories have equal column widths');
    if (i % 3) {
      assert.ok(Math.abs(boxes[i].y - boxes[i - 1].y) < 1, 'three stories per desktop row');
      assert.ok(boxes[i].x >= boxes[i - 1].x + boxes[i - 1].width, 'columns do not overlap');
    } else if (i) {
      assert.ok(boxes[i].y >= Math.max(...boxes.slice(i - 3, i).map(box => box.bottom)), 'subsequent rows do not overlap');
    }
  }
}
try {
  if (process.env.SOURCE_UI === '1') {
    for (const name of ['daily.css', 'digest.js']) {
      const body = await readFile(path.join(root, name));
      await page.route(`**/${name}`, route => route.fulfill({
        body, contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript',
      }));
    }
  }
  await page.goto(url);
  await page.locator('#digest-panel h1').waitFor();
  const hasActivity = await page.evaluate(() => !!AGENT_HUB_DATA.activity);
  await checkDigestPage();
  const firstPage = await page.evaluate(() => AGENT_HUB_DATA.digests.at(-1).pages.find(p =>
    [p.stories, p.papers, p.trends].some(items => items?.some(s => s.text?.trim()))).id);
  assert.equal(await page.locator('#reading').getAttribute('data-page'), firstPage);
  assert.equal(await page.locator('.masthead-main .edition-controls').count(), 1);
  const pageCount = await page.evaluate(() => AGENT_HUB_DATA.digests.at(-1).pages.length);
  assert.equal(await page.locator('#edition-sections [role="tab"]').count(), pageCount);
  assert.equal(await page.locator('.digest-heading .daily-ranking').count(), 1);
  assert.equal(await page.locator('#sidebar .daily-ranking').count(), 0);
  assert.equal(await page.locator('.page-footer, #page-prev, #page-next').count(), 0);
  const dailyPosition = await page.evaluate(() => {
    const rank = document.querySelector('.daily-ranking').getBoundingClientRect();
    const headline = document.querySelector('.digest-heading h1').getBoundingClientRect();
    const reading = document.querySelector('#reading').getBoundingClientRect();
    return Math.abs(rank.right - reading.right) < 1 && rank.bottom <= headline.top;
  });
  assert.ok(dailyPosition, 'group ranking sits at the top right of the headline');
  assert.deepEqual(await overflow(), []);
  await page.screenshot({ path: '/tmp/agenthub-home-desktop.png', fullPage: true });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.locator('.paper-shell').evaluate(el => el.getBoundingClientRect().width >= innerWidth - 1), 'newspaper fills desktop width');
    assert.deepEqual(await overflow(), []);
    assert.ok(await page.evaluate(() => Math.abs(
      document.querySelector('#reading').getBoundingClientRect().width -
      document.querySelector('.reading-layout').getBoundingClientRect().width,
    ) < 1), 'daily content fills the former sidebar');
    assert.equal(await page.locator('#sidebar, .archive-teaser').count(), 0);
    await page.screenshot({ path: `/tmp/agenthub-home-${viewport.width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-page="1"]').click();
  await checkDigestPage();
  assert.equal(await page.locator('.daily-ranking').getAttribute('data-group'), 'group-2');
  assert.equal(await page.locator('#daily-ranking-title').innerText(), '本群活跃榜');
  await page.locator('[data-mode="rank"]').click();
  await page.waitForFunction(() => document.body.dataset.view === 'rank');
  await page.locator('[data-rank="month"]').click();
  assert.equal(await page.locator('[data-rank="month"]').getAttribute('aria-pressed'), 'true');
  if (hasActivity) {
    for (const period of ['week', 'all', 'month']) {
      await page.locator(`[data-rank="${period}"]`).click();
      assert.equal(await page.locator('[aria-labelledby="rank-community"] .activity-leaders li').count(), 3);
    }
    assert.doesNotMatch(await page.locator('#reading').innerText(), /消息|媒体|活跃.*天|统计口径|每条|分数/);
    const payload = await page.evaluate(() => JSON.stringify(AGENT_HUB_DATA.activity));
    assert.doesNotMatch(payload, /"count"|"counted"|"media"|"activeDays"|"policy"|"excluded"|"raw"/);
    await page.locator('.activity-leaders img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
    assert.ok(await page.locator('.activity-leaders img').count() > 0);
  }
  await page.locator('[data-mode="digest"]').click();
  await page.getByRole('tab', { name: '三群' }).click();
  await checkDigestPage();
  assert.equal(await page.locator('.daily-ranking').getAttribute('data-group'), 'group-3');
  if (pageCount === 4) {
    await page.getByRole('tab', { name: '外部资讯' }).click();
    await checkDigestPage();
    assert.equal(await page.locator('.daily-ranking').count(), 0);
    assert.equal(await page.getByRole('tab', { name: '外部资讯' }).getAttribute('aria-selected'), 'true');
  }
  await page.locator(`[data-page="${pageCount - 1}"]`).focus();
  await page.keyboard.press('Home');
  assert.equal(await page.locator('#reading').getAttribute('data-page'), firstPage);
  await page.locator('[role="tab"]:not(:disabled)').first().focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#reading').getAttribute('data-page'), 'group-3');
  await page.locator('[role="tab"]:not(:disabled)').first().click();
  for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 812 }, { width: 320, height: 640 }]) {
    await page.setViewportSize(viewport);
    assert.deepEqual(await overflow(), []);
    await page.screenshot({ path: `/tmp/agenthub-home-mobile-${viewport.width}.png` });
    await page.locator(`[data-page="${pageCount - 1}"]`).click();
    assert.deepEqual(await overflow(), [], 'papers should fit horizontally');
    await page.screenshot({ path: `/tmp/agenthub-papers-mobile-${viewport.width}.png` });
    await page.locator('[role="tab"]:not(:disabled)').first().click();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#archive-toggle').click();
  assert.equal(await page.locator('[data-mode="week"], [data-mode="topic"], [data-jump="week"], [data-jump="topic"]').count(), 0);
  const publicBuild = await page.evaluate(() => AGENT_HUB_DATA.publicBuild);
  const editions = await page.evaluate(() => AGENT_HUB_DATA.digests.map(issue => issue.id));
  const readableEditions = await page.evaluate(() => AGENT_HUB_DATA.digests.filter(issue =>
    issue.pages.some(p => [p.stories, p.papers, p.trends].some(items => items?.some(s => s.text?.trim())))).map(issue => issue.id));
  assert.equal(await page.locator('#archive-list .issue-row').count(), readableEditions.length);
  await page.locator('#archive-list .issue-row').last().click();
  await page.waitForFunction(id => document.body.dataset.edition === `digest/${id}`, readableEditions[0]);
  // The oldest issue has nothing before it in the archive's pager.
  await page.locator('#date-picker').click();
  assert.equal(await page.locator('#archive-pagination button', { hasText: '上一期' }).isDisabled(), true);
  await page.keyboard.press('Escape');
  for (const id of editions) {
    await page.goto(`${url}#digest/${id}`);
    await page.waitForFunction(id => document.body.dataset.edition === `digest/${id}`, id);
    await checkDigestPage();
    assert.deepEqual(await overflow(), [], `overflow in ${id}`);
  }
  if (publicBuild) {
    assert.equal(hasActivity, true, 'public builds include the approved Top 3 snapshot');
    const members = await page.evaluate(() => Object.values(AGENT_HUB_DATA.activity.ranks).flatMap(r => r.leaders));
    assert.ok(members.every(member => Object.keys(member).sort().join(',') === 'key,rank'));
  }
  assert.equal(await page.locator('[data-mode="day"]').count(), 0);
  assert.equal(await page.evaluate(() => 'days' in AGENT_HUB_DATA), false);
  await page.goto(`${url}#day/2026-09-18`);
  await page.waitForFunction(() => document.body.dataset.edition.startsWith('digest/'));
  assert.equal(await page.locator('.message-stream').count(), 0);

  for (const mode of ['topic', 'week']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${url}#${mode}/retired`);
    await page.waitForURL(/#digest\//);
    await page.locator('#digest-panel').waitFor();
    assert.deepEqual(await overflow(), [], `mobile fallback from ${mode}`);
  }
  assert.deepEqual(errors, []);
  if (!process.env.AGENT_HUB_SITE_URL) assert.deepEqual(network, []);
  else assert.ok(network.every(u => new URL(u).origin === new URL(url).origin));
  console.log(`Passed: ${editions.length} daily views, retired route redirects, paging and mobile views; public=${publicBuild}.`);
} finally {
  await browser.close();
}
