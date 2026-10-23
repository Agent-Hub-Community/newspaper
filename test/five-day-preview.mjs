import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = process.argv[2] || 'scratch/five-day-d';
const issues = JSON.parse(await readFile(`${root}${directory}/issues.json`, 'utf8'));
if (process.argv.includes('--require-comments')) {
  for (const issue of issues) for (const group of issue.pages) for (const story of group.stories || []) {
    assert.ok(story.aiComment?.trim(), `Missing AI comment: ${issue.date}/${group.id}/${story.title}`);
  }
}
const activity = JSON.parse(await readFile(`${root}${directory}/activity/snapshot.json`, 'utf8'));
const output = `${root}output/playwright/${directory.split('/').at(-1)}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const errors = [], network = [];
try {
  for (const [width, height] of [[390, 844], [820, 1180], [1440, 1000]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
    for (const issue of issues) {
      await page.goto(`${pathToFileURL(`${root}dist-preview/index.html`).href}#digest/${issue.date}/group-1`);
      await page.locator('#digest-panel').waitFor();
      assert.deepEqual(await page.locator('.brief h2').allTextContents(), issue.pages[0].stories.map(s => s.title));
      assert.deepEqual(await page.locator('.brief-body > p:first-of-type').allTextContents(), issue.pages[0].stories.map(s => s.text));
      for (const [index, story] of issue.pages[0].stories.entries()) {
        const comment = page.locator('.brief').nth(index).locator('.brief-comment');
        assert.equal(await comment.count(), story.aiComment ? 1 : 0);
        if (story.aiComment) assert.equal(await comment.locator('p').textContent(), story.aiComment);
        const strong = page.locator('.brief').nth(index).locator('.brief-emphasis');
        assert.equal(await strong.count(), story.emphasis?.length || 0);
        for (const phrase of await strong.allTextContents()) assert.ok(story.emphasis.includes(phrase));
      }
      const leaders = activity.groups.find(g => g.id === 'group-1').daily[issue.date].leaders;
      assert.equal(await page.locator('.daily-leaders li').count(), leaders.length);
      if (!issue.pages[0].stories.length) assert.equal(await page.locator('#read-first').count(), 0);
      assert.ok((await page.locator('.daily-ranking').getAttribute('aria-label')).includes(issue.date));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.locator('img').evaluateAll(imgs => Promise.all(imgs.map(i => i.decode())));
      await page.screenshot({ path: `${output}/${issue.date}-${width}.png`, fullPage: true });
      const boxes = await page.locator('.brief').evaluateAll(nodes => nodes.map(el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }));
      const cols = width > 1199 ? 3 : width > 700 ? 2 : 1;
      for (let i = 0; i < boxes.length; i++) {
        assert.ok(boxes[i].left >= 0 && boxes[i].right <= width);
        if (i >= cols) assert.ok(boxes[i].top >= boxes[i - cols].bottom);
      }
    }
    for (const issue of issues) for (const group of issue.pages.slice(1).filter(p => p.stories?.length)) {
      await page.goto(`${pathToFileURL(`${root}dist-preview/index.html`).href}#digest/${issue.date}/${group.id}`);
      await page.locator('#digest-panel').waitFor();
      assert.deepEqual(await page.locator('.brief-body > p:first-of-type').allTextContents(), group.stories.map(s => s.text));
      assert.deepEqual(await page.locator('.brief-comment p').allTextContents(), group.stories.filter(s => s.aiComment).map(s => s.aiComment));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      const leaders = activity.groups.find(g => g.id === group.id).daily[issue.date]?.leaders || [];
      assert.equal(await page.locator('.daily-leaders li').count(), leaders.length);
      await page.locator('img').evaluateAll(imgs => Promise.all(imgs.map(i => i.decode())));
    }
    await page.goto(`${pathToFileURL(`${root}dist-preview/index.html`).href}#digest/${issues.at(-1).date}/group-1`);
    await page.locator('#date-picker').click();
    await page.locator('#archive-dialog').waitFor({ state: 'visible' });
    await page.locator('#archive-dialog [data-jump="digest"][data-id="2026-09-21"]').click();
    await page.waitForFunction(() => location.hash === '#digest/2026-09-21/group-1');
    assert.ok((await page.locator('.daily-ranking').getAttribute('aria-label')).includes('2026-09-21'));
    await page.close();
  }
  const sheet = await browser.newPage({ viewport: { width: 800, height: 800 } });
  const images = [];
  for (const [key, file] of Object.entries(activity.avatars)) {
    const bytes = await readFile(`${root}${directory}/activity/${file}`);
    images.push({ key, src: `data:image/${file.endsWith('png') ? 'png' : 'jpeg'};base64,${bytes.toString('base64')}` });
  }
  await sheet.setContent('<html><body><main style="display:grid;grid-template-columns:repeat(5,140px);gap:16px"></main></body></html>');
  await sheet.evaluate(images => {
    for (const image of images) {
      const figure = document.createElement('figure');
      figure.style.margin = '0';
      const img = document.createElement('img');
      img.src = image.src; img.width = 120; img.height = 120;
      const label = document.createElement('figcaption');
      label.textContent = image.key;
      figure.append(img, label);
      document.querySelector('main').append(figure);
    }
  }, images);
  await sheet.locator('img').evaluateAll(imgs => Promise.all(imgs.map(i => i.decode())));
  await sheet.screenshot({ path: `${output}/avatar-review.png`, fullPage: true });
  await sheet.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  const data = await readFile(`${root}dist-preview/data.js`, 'utf8');
  assert.doesNotMatch(data, /evidence_ids|topic_key|paginationExhausted|"claims"|"audit"|aeskey|wxid_|@chatroom|"counted"|"activeDays"|"policy"/);
  console.log(`${issues.length} dates x three viewports: content, dated Top 3, images, overflow and privacy passed.`);
} finally {
  await browser.close();
}
