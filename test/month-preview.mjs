import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { validatePublicActivity } from '../lib/public-activity.mjs';

const directory = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Provide month draft directory');
const issues = JSON.parse(await readFile(path.join(directory, 'issues.json'), 'utf8'));
const activity = JSON.parse(await readFile(path.join(directory, 'activity/snapshot.json'), 'utf8'));
assert.equal(issues.length, 31);
assert.equal(issues[0].date, '2026-08-24');
assert.equal(issues.at(-1).date, '2026-09-23');
validatePublicActivity(activity, issues);
for (const issue of issues) {
  assert.equal(issue.pages.length, 3);
  for (const page of issue.pages) {
    assert.ok(page.stories.length <= 9);
    assert.doesNotMatch(page.note, /Gemini|原稿预览|截至北京时间/);
    const input = JSON.parse(await readFile(path.join(directory, issue.date, `${page.id}.input.json`), 'utf8'));
    assert.equal(Date.parse(input.cutoff), Date.parse(`${issue.date}T00:00:00+08:00`) + 86400000);
    assert.equal(input.coverage.paginationExhausted, true);
    if (!input.coverage.count) assert.equal(page.stories.length, 0);
    for (const story of page.stories) {
      assert.ok(story.aiComment?.trim());
      for (const phrase of story.emphasis || []) assert.ok(story.text.includes(phrase));
      for (const resource of story.resources || []) {
        const url = new URL(resource.url);
        assert.equal(url.protocol, 'https:');
        assert.equal(url.search + url.username + url.password, '');
      }
    }
  }
}
const out = path.resolve('output/playwright/month-preview');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  for (const width of [390, 820, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const date of ['2026-08-25', '2026-08-31', '2026-09-02', '2026-09-23']) {
      for (const group of date === '2026-09-23' ? ['group-1', 'group-2', 'group-3'] : ['group-1']) {
        await page.goto(`${pathToFileURL(path.join(directory, 'site/index.html')).href}#digest/${date}/${group}`);
        await page.waitForFunction(() => window.AGENT_HUB_DATA && document.querySelector('main')?.textContent.length > 30);
        const stories = issues.find(i => i.date === date).pages.find(p => p.id === group).stories;
        assert.equal(await page.locator('.brief-comment').count(), stories.length);
        assert.doesNotMatch(await page.locator('#reading').innerText(), /当日本地记录|无本地可读记录/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await page.locator('[data-mode="week"], [data-mode="topic"], .archive-teaser, #sidebar').count(), 0);
        assert.equal(await page.evaluate(() => {
          const layout = document.querySelector('.reading-layout').getBoundingClientRect();
          return Math.abs(layout.width - document.querySelector('#reading').getBoundingClientRect().width) < 2;
        }), true, 'Daily content must use the former sidebar space');
        await page.locator('img').evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
        for (const s of stories) assert.ok((await page.locator('body').innerText()).includes(s.title));
        await page.screenshot({ path: path.join(out, `${date}-${group}-${width}.png`), fullPage: true });
      }
    }
    await page.locator('#date-picker').click();
    assert.equal(await page.locator('[data-jump="week"], [data-jump="topic"]').count(), 0);
    await page.locator('#archive-list [data-id="2026-08-31"]').click();
    await page.waitForURL(/#digest\/2026-08-31/);
    if (width >= 820) {
      await page.locator('#date-picker').click();
      await page.locator('#archive-pagination button', { hasText: '下一期' }).click();
      await page.waitForURL(/#digest\/2026-09-01/);
    }
    for (const oldRoute of ['week/2026-06-15_2026-06-21', 'topic/2026-09-20-retired', 'digest/%E0%A4%A']) {
      await page.goto(`${pathToFileURL(path.join(directory, 'site/index.html')).href}#${oldRoute}`);
      await page.waitForURL(/#digest\/2026-09-23\/group-1$/);
      assert.equal(await page.locator('body').getAttribute('data-view'), 'digest');
    }
    await page.locator('#date-picker').click();
    await page.locator('[data-jump="rank"]').click();
    await page.waitForURL(/#rank\/week$/);
    assert.equal(await page.locator('[aria-labelledby="rank-community"] .activity-leaders li').count(), 3);
    await page.locator('[data-mode="digest"]').click();
    await page.waitForURL(/#digest\/2026-09-23\/group-1$/);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('31 editions / 93 group pages validated; empty days, full final day, comments, avatars and layout checked at three widths.');
} finally { await browser.close(); }
