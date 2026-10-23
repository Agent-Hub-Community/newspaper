import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { chromium } from 'playwright';

// Run the actual app against an in-memory archive without touching shared dist.
const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const { document } = parseHTML(await read('site/index.html'));
for (const node of document.querySelectorAll('script, link, meta[http-equiv]')) node.remove();
const style = document.createElement('style');
style.textContent = (await Promise.all(['site/style.css', 'site/daily.css', 'site/color-scheme.css'].map(read))).join('\n');
document.head.append(style);
const html = document.toString();
const scripts = await Promise.all(['node_modules/lucide/dist/umd/lucide.min.js', 'site/routes.js', 'site/discussion-panel.js', 'site/digest.js', 'site/ranking.js', 'site/app.js'].map(read));
const page = (id, content = true) => ({
  id, label: { 'group-1': '一群', 'group-2': '二群', 'group-3': '三群', 'group-4': '四群', external: '外部资讯' }[id],
  heading: `${id} 测试标题`, section: '测试版面', theme: '源码测试夹具',
  stories: content ? [{ title: '测试稿件', text: '这是一段用于检验版面导航的测试内容。', category: '测试' }] : [],
});
const issue = (date, fourth, content = true) => ({
  id: date, date, label: `${date} 日报`,
  pages: ['group-1', 'group-2', 'group-3', ...(fourth ? ['group-4'] : []), 'external'].map(id => page(id, content)),
});
const old = issue('2026-09-28', false), empty = issue('2026-09-29', true, false);
const missing = issue('2026-09-30', true);
missing.pages[3].stories = [];
const current = issue('2026-10-01', true);
const data = {
  digests: [old, empty, missing, current], coverage: { first: old.date, last: current.date },
  activity: {
    generatedAt: '2026-10-01T00:00:00Z',
    windows: Object.fromEntries(['week', 'month', 'all'].map(id => [id, { from: old.date, through: current.date }])),
    ranks: Object.fromEntries(['week', 'month', 'all'].map(id => [id, { leaders: [] }])),
    groups: [1, 2, 3, 4].map(n => ({ id: `group-${n}`, available: true, first: old.date, last: current.date,
      daily: n === 4 ? { [current.date]: { leaders: [{ key: 'member-001', rank: 1 }] } } : {} })),
    avatars: {},
  },
};
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const tab = await browser.newPage();
  // Issues step from the archive the masthead date opens.
  const step = async label => { await tab.locator('#date-picker').click(); await tab.locator('#archive-pagination button', { hasText: label }).click(); };
  const errors = [];
  tab.on('pageerror', error => errors.push(error.message));
  await tab.route('http://groups.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  async function open(date, group, mode = 'light', archive = data) {
    await tab.goto(`http://groups.test/?skin=national-day#digest/${date}/${group}`);
    await tab.evaluate(({ archive, mode }) => {
      document.documentElement.dataset.colorScheme = mode;
      window.AGENT_HUB_DATA = archive;
    }, { archive, mode });
    for (const script of scripts) await tab.addScriptTag({ content: script });
  }
  for (const width of [320, 390, 700, 701, 820, 1440]) {
    await tab.setViewportSize({ width, height: 900 });
    for (const mode of ['light', 'dark']) {
      await open(current.date, 'group-4', mode);
      assert.equal(await tab.locator('#reading').getAttribute('data-page'), 'group-4');
      assert.equal(await tab.getByRole('tab').count(), 5);
      assert.equal(await tab.locator('.daily-ranking').getAttribute('data-group'), 'group-4');
      assert.equal(await tab.locator('.daily-leaders li').count(), 1);
      const bounds = await tab.evaluate(() => {
        const tabs = [...document.querySelectorAll('[role="tab"]')].map(element => {
          const r = element.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width,
            fits: element.scrollWidth <= element.clientWidth + 1 };
        });
        const tools = document.querySelector('.group-tools').getBoundingClientRect();
        return { tabs, overflow: document.documentElement.scrollWidth > innerWidth,
          overlap: tabs.some(r => Math.min(r.right, tools.right) > Math.max(r.left, tools.left) + 1 &&
            Math.min(r.bottom, tools.bottom) > Math.max(r.top, tools.top) + 1) };
      });
      assert.equal(bounds.overflow, false, `${width} ${mode}: overflow`);
      assert.equal(bounds.overlap, false, `${width} ${mode}: tools overlap`);
      assert.ok(bounds.tabs.every(r => r.width >= 44 && r.fits && r.left >= 0 && r.right <= width), `${width}: tab bounds ${JSON.stringify(bounds)}`);
      assert.equal(new Set(bounds.tabs.map(r => r.top)).size, 1, 'five tabs share one row');
      await tab.getByRole('tab', { name: '四群', exact: true }).focus();
      await tab.keyboard.press('ArrowRight');
      assert.equal(await tab.locator('#reading').getAttribute('data-page'), 'external');
      await tab.keyboard.press('ArrowLeft');
      assert.equal(await tab.locator('#reading').getAttribute('data-page'), 'group-4');
      await step('上一期');
      assert.equal(await tab.locator('#reading').getAttribute('data-page'), 'group-1');
      assert.equal(await tab.getByRole('tab', { name: '四群，暂无稿件', exact: true }).isDisabled(), true);
      await tab.getByRole('tab', { name: '三群', exact: true }).focus();
      await tab.keyboard.press('ArrowRight');
      assert.equal(await tab.locator('#reading').getAttribute('data-page'), 'external');
      await step('上一期');
      assert.match(tab.url(), /2026-09-28\/external\//, 'skip wholly empty issue and retain readable section');
      assert.equal(await tab.getByRole('tab', { name: '四群，暂无稿件', exact: true }).isDisabled(), true);
      assert.equal(await tab.evaluate(() => window.AGENT_HUB_DATA.digests[0].pages.length), 4, 'historical archive is not mutated');
      await open(old.date, 'group-4', mode);
      assert.match(tab.url(), /2026-09-28\/group-1\//, 'absent group deep link falls back');
      assert.match(tab.url(), /skin=national-day/);
      await open(missing.date, 'group-4', mode);
      assert.match(tab.url(), /2026-09-30\/group-1\//, 'empty group deep link falls back');
    }
  }
  await open(current.date, 'group-4');
  await tab.locator('#date-picker').click();
  assert.match(await tab.locator('#archive-list [data-id="2026-09-28"]').getAttribute('aria-label'), /四群无稿/);
  await tab.locator('#archive-list [data-id="2026-09-28"]').click();
  assert.equal(await tab.locator('#reading').getAttribute('data-page'), 'group-1');
  await tab.goto('http://groups.test/?skin=national-day#rank/week');
  await tab.evaluate(archive => { window.AGENT_HUB_DATA = archive; }, data);
  for (const script of scripts) await tab.addScriptTag({ content: script });
  // One board lists the community and all four groups; no group has to be picked first.
  assert.deepEqual(await tab.locator('.rank-column h2').allTextContents(), ['全社区', '一群', '二群', '三群', '四群']);
  await open(old.date, 'group-1', 'light', { ...data, digests: [old] });
  assert.equal(await tab.getByRole('tab').count(), 4, 'three-group-only archives retain their existing navigation');
  assert.deepEqual(errors, []);
  console.log('Four groups: 12 responsive cases, tabs, keyboard, missing/absent fallback, calendar, rankings and historical immutability passed.');
} finally {
  await browser.close();
}
