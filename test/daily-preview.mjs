import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}output/playwright/today`;
await mkdir(output, { recursive: true });
const data = await readFile(`${root}dist-preview/data.js`, 'utf8');
// Accepts a single issue or a batch issues.json; the preview opens on the latest date.
const parsed = JSON.parse(await readFile(process.argv[2] || `${root}scratch/daily/2026-09-23/agent.issue.json`, 'utf8'));
const issue = Array.isArray(parsed) ? parsed.at(-1) : parsed;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const errors = [], network = [];
try {
  for (const [width, height] of [[320, 740], [390, 844], [820, 1180], [1440, 1000], [2560, 1440]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
    await page.goto(pathToFileURL(`${root}dist-preview/index.html`).href);
    await page.locator('#digest-panel').waitFor();
    for (const group of issue.pages) {
      await page.getByRole('tab', { name: group.label }).click();
      assert.equal(await page.locator('.brief').count(), group.stories.length);
      assert.equal(await page.locator('.page-footer').count(), 0);
      assert.equal(await page.locator('.digest-heading .daily-ranking').count(), 1);
      assert.equal(await page.locator('.daily-ranking').getAttribute('data-group'), group.id);
      assert.ok((await page.locator('.daily-ranking').getAttribute('aria-label')).includes(issue.date));
      const expected = await page.evaluate(({ id, date }) =>
        AGENT_HUB_DATA.activity.groups.find(g => g.id === id)?.daily[date]?.leaders || [], { id: group.id, date: issue.date });
      assert.equal(await page.locator('.daily-leaders li').count(), expected.length);
      assert.deepEqual(await page.locator('.daily-leaders .rank-number').allTextContents(), expected.map(m => String(m.rank)));
      const rankingPosition = await page.evaluate(() => {
        const daily = document.querySelector('.daily-ranking').getBoundingClientRect();
        const reading = document.querySelector('#reading').getBoundingClientRect();
        const headline = document.querySelector('.digest-heading h1').getBoundingClientRect();
        const kicker = document.querySelector('.digest-kicker').getBoundingClientRect();
        return daily.bottom <= headline.top && Math.abs(daily.right - reading.right) < 1 && daily.left >= kicker.right;
      });
      assert.ok(rankingPosition, 'group Top 3 fits beside the kicker above the headline');
      const boxes = await page.locator('.brief').evaluateAll(nodes => nodes.map(el => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      }));
      const cols = width > 1199 ? 3 : width > 700 ? 2 : 1;
      for (let i = 0; i < boxes.length; i++) {
        assert.ok(boxes[i].left >= 0 && boxes[i].right <= width);
        if (i >= cols) assert.ok(boxes[i].top >= boxes[i - cols].bottom);
        if (i % cols) assert.ok(Math.abs(boxes[i].top - boxes[i - 1].top) < 1);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.locator('img[src]:not([src=""])').evaluateAll(imgs => Promise.all(imgs.map(i => i.decode())));
      await page.screenshot({ path: `${output}/${group.id}-${width}.png`, fullPage: true });
    }
    console.log(`Today's three groups passed ${width}px`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(network, [], 'local preview emits no telemetry or other external requests');
  // Internal generation metadata and raw messages must not enter the browser bundle.
  assert.doesNotMatch(data, /evidence_ids|topic_key|paginationExhausted|"claims"|"audit"|aeskey|wxid_|@chatroom/);
} finally {
  await browser.close();
}
