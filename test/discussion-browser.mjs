import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { expectedMessageText } from './digest-context.mjs';

const base = process.env.VERIFY_SITE;
const date = process.env.DISCUSSION_DATE;
const discussionGroups = process.env.DISCUSSION_GROUPS?.split(',').map(group => group.trim()) || ['group-2', 'group-3', 'group-4'];
assert.ok(discussionGroups.length && discussionGroups.every(group => /^group-[1-5]$/.test(group)), 'DISCUSSION_GROUPS must be comma-separated known group ids');
const primaryGroup = discussionGroups[0];
assert.ok(base && /^\d{4}-\d{2}-\d{2}$/.test(date), 'Set VERIFY_SITE and DISCUSSION_DATE to the prepared preview');
const output = `output/playwright/${date}-discussions`;
await mkdir(output, { recursive: true });
const results = [];
const reader = page => page.locator('#discussion-dialog');
const readerState = page => page.evaluate(() => ({
  open: Boolean(document.querySelector('#discussion-dialog')?.open),
  hash: location.hash,
  focus: document.activeElement?.id || document.activeElement?.className || '',
}));
// Same-document traversals: Playwright's goBack waits for a load event WebKit never sends here.
// The caller waits for the closed state; the reader stops popstate before late listeners see it.
const back = page => page.evaluate(() => history.back());
for (const engine of ['chromium', 'webkit']) {
  const browser = await (engine === 'chromium'
    ? chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
    : webkit.launch());
  try {
    const page = await browser.newPage({ acceptDownloads: true, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const group of discussionGroups) {
        await page.goto(`${base}/daily/${date}/${group}/`);
        const stories = await page.evaluate(({ date, group }) => window.AGENT_HUB_DATA.digests.find(i => i.date === date).pages.find(p => p.id === group).stories, { date, group });
        const withDiscussion = stories.flatMap((story, index) => story.discussion?.length ? [index] : []);
        assert.equal(await page.locator('.discussion-trigger').count(), withDiscussion.length);
        assert.equal((await readerState(page)).open, false);
        for (const [order, index] of withDiscussion.entries()) {
          const story = stories[index];
          const trigger = page.locator(`#discussion-${index + 1}`);
          assert.ok((await trigger.boundingBox()).height >= 44);
          await trigger.focus();
          const y = await page.evaluate(() => scrollY);
          if (process.env.DEBUG_DISCUSSION) console.log(engine, width, group, index, order % 3);
          await page.keyboard.press(order % 2 ? 'Space' : 'Enter');
          await reader(page).locator('.discussion-text').first().waitFor({ state: 'visible' });
          assert.equal((await readerState(page)).hash, `#discussion-${index + 1}`);
          assert.equal(await reader(page).locator('#discussion-dialog-title').textContent(), story.title);
          // The summary repeats the article text and emphasis: a left column on wide screens, folded above the chat on phones.
          const lead = await reader(page).evaluate(dialog => {
            const wide = getComputedStyle(dialog.querySelector('.discussion-lead')).display !== 'none';
            const box = dialog.querySelector(wide ? '.discussion-lead' : '.discussion-lead-inline');
            return { wide, folded: !wide && !box.open, emphasis: box.querySelectorAll('.discussion-lead-text strong').length,
              text: [...box.querySelectorAll('.discussion-lead-text p')].map(p => p.textContent).join('\n\n') };
          });
          assert.equal(lead.wide, width !== 390);
          assert.equal(lead.folded, width === 390);
          assert.equal(lead.text, story.text.trim().split(/\n\s*\n/).join('\n\n'));
          assert.equal(lead.emphasis, await page.locator(`#topic-${index + 1} .brief-emphasis`).count());
          const visible = await reader(page).locator('.discussion-text').evaluateAll(els => els.map(el => {
            const copy = el.cloneNode(true);
            for (const link of copy.querySelectorAll('a')) link.remove();
            // Emoji stand in for WeChat codes; the tooltip keeps the original code, so compare that.
            for (const face of copy.querySelectorAll('.discussion-emoji')) face.replaceWith(face.title);
            // Same normalization as strip() in digest-context.mjs.
            return copy.textContent.replace(/[\s.,;!?()[\]（）。，；！？、]/g, '');
          }));
          assert.equal(visible.length, story.discussion.length);
          story.discussion.forEach((m, i) => { const expected = expectedMessageText(m.text); if (expected !== null) assert.equal(visible[i], expected); });
          assert.deepEqual(await reader(page).locator('.discussion-entry').evaluateAll(els => els.map(el => el.getAttribute('aria-label'))), story.discussion.map(m => `群友 ${m.speaker}，${m.time}`));
          assert.equal(await reader(page).locator('.discussion-quote-text').count(), story.discussion.filter(m => m.quote).length);
          const layout = await reader(page).evaluate(dialog => ({
            overflow: dialog.scrollWidth > dialog.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1,
            clipped: [...dialog.querySelectorAll('.discussion-text')].some(p => p.scrollWidth > p.clientWidth + 1),
            width: dialog.getBoundingClientRect().width,
          }));
          assert.equal(layout.overflow, false);
          assert.equal(layout.clipped, false);
          assert.ok(Math.abs(layout.width - (width === 390 ? 390 : Math.min(1180, width - 48))) < 1);
          if (group === primaryGroup && order === 0) {
            const groups = story.discussion.filter((message, i, messages) => !i || message.speaker !== messages[i - 1].speaker).length;
            assert.equal(await reader(page).locator('.discussion-speaker').count(), groups);
            const jump = reader(page).locator('[data-message-target]').first();
            if (await jump.count()) {
              const targetId = await jump.getAttribute('data-message-target');
              await jump.focus();
              await page.keyboard.press('Enter');
              assert.equal(await page.evaluate(() => document.activeElement.id), targetId);
              assert.equal(await page.locator(`#${targetId}`).evaluate(el => el.classList.contains('is-highlighted')), true);
            }
            const fallback = reader(page).locator('.discussion-quote[aria-expanded]').first();
            if (await fallback.count()) {
              await fallback.click();
              assert.equal(await fallback.getAttribute('aria-expanded'), 'true');
              await fallback.click();
              assert.equal(await fallback.getAttribute('aria-expanded'), 'false');
            }
            if (width === 390) {
              const widths = await reader(page).locator('.discussion-entry').evaluateAll(entries => {
                const el = entries.reduce((longest, entry) =>
                  entry.querySelector('.discussion-text').textContent.length > longest.querySelector('.discussion-text').textContent.length ? entry : longest);
                const text = el.querySelector('.discussion-text');
                return { text: text.getBoundingClientRect().width, list: el.closest('ol').getBoundingClientRect().width, font: getComputedStyle(text).fontSize };
              });
              // Avatar column and bubble padding take a little width; the text keeps most of the line.
              assert.ok(widths.text >= widths.list * 0.75);
              assert.equal(widths.font, '16px');
            }
            await reader(page).screenshot({ path: `${output}/${engine}-${width}-reader.png` });
          }
          // Alternate the three closing paths; each must restore the page and the trigger focus.
          if (order % 3 === 0) await page.keyboard.press('Escape');
          else if (order % 3 === 1) await reader(page).locator('.discussion-dialog-close').click();
          else await back(page);
          await page.waitForFunction(() => !document.querySelector('#discussion-dialog')?.open && !location.hash);
          const closed = await readerState(page);
          assert.equal(closed.focus, `discussion-${index + 1}`);
          assert.equal(await page.evaluate(() => scrollY), y);
        }
        await page.reload();
        assert.equal((await readerState(page)).open, false);
        results.push({ engine, width, group, discussions: withDiscussion.length, status: 'passed' });
      }
    }
    await page.goto(`${base}/daily/${date}/external/`);
    assert.equal(await page.locator('.discussion-trigger').count(), 0);
    await page.goto(`${base}/daily/2026-10-08/group-2/`);
    assert.equal(await page.locator('.discussion-trigger').count(), 0);
    // A deep link opens the reader without adding history, and closing keeps the reader on the page.
    await page.goto(`${base}/daily/${date}/${primaryGroup}/#discussion-1`);
    await reader(page).locator('.discussion-text').first().waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#discussion-dialog')?.open);
    assert.match(page.url(), new RegExp(`/daily/${date}/${primaryGroup}/$`));
    // Message text is untrusted even when the sender label has been anonymized.
    const inject = discussion => page.evaluate(({ date, discussion, group }) => {
      const issue = window.AGENT_HUB_DATA.digests.find(i => i.date === date);
      issue.pages.find(p => p.id === group).stories[0].discussion = discussion;
      window.renderDigest(issue, () => {}, window.AGENT_HUB_DATA, group);
    }, { date, discussion, group: primaryGroup });
    await inject([{
      speaker: 1, time: '10:00', text: '<img src=x onerror="window.discussionXss=1"> & 原话',
      quote: { speaker: 2, text: '</p><script>window.discussionXss=2</script>' },
    }]);
    await page.locator('.discussion-trigger').first().click();
    assert.equal(await reader(page).locator('img, script').count(), 0);
    assert.equal(await page.evaluate(() => window.discussionXss), undefined);
    assert.match(await reader(page).locator('.discussion-text').first().textContent(), /<img src=x/);
    await page.keyboard.press('Escape');
    // Exercise a long missing-source quote and a link without visiting an external site.
    await inject([{
      speaker: 1, time: '10:00', text: '资料 https://example.org/discussion-test',
      quote: { speaker: 2, text: '这是节选之外的长引文，展开后应完整保留。\n'.repeat(12) },
    }]);
    await page.locator('.discussion-trigger').first().click();
    const longQuote = reader(page).locator('.discussion-quote').first();
    const previewHeight = await longQuote.locator('.discussion-quote-body').evaluate(el => el.getBoundingClientRect().height);
    await longQuote.click();
    assert.ok(await longQuote.locator('.discussion-quote-body').evaluate(el => el.getBoundingClientRect().height) > previewHeight * 3);
    await longQuote.click();
    assert.equal(await longQuote.locator('.discussion-quote-body').evaluate(el => el.getBoundingClientRect().height), previewHeight);
    await page.context().route('https://example.org/discussion-test', route => route.fulfill({ body: 'Link opened', contentType: 'text/plain' }));
    const popupPromise = page.waitForEvent('popup');
    await reader(page).locator('.discussion-text a').first().click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert.equal(popup.url(), 'https://example.org/discussion-test');
    assert.equal((await readerState(page)).open, true);
    await popup.close();
    await page.goto(`${base}/daily/${date}/${primaryGroup}/`);
    await page.evaluate(() => {
      new MutationObserver(() => {
        const copy = document.querySelector('.capture-stage .discussion-trigger');
        if (copy) window.discussionCaptureDisplay = getComputedStyle(copy).display;
      }).observe(document.body, { childList: true });
    });
    const downloadPromise = page.waitForEvent('download', { timeout: 45000 });
    await page.locator('.save-image:visible').click();
    const download = await downloadPromise;
    await download.saveAs(`${output}/${engine}-summary-export.png`);
    assert.equal(await page.evaluate(() => window.discussionCaptureDisplay), 'none');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
await writeFile(`${output}/validation.json`, JSON.stringify({ date, results, escapedText: true, readerClosedByDefault: true, closePathsRestorePosition: true, exportExcludesTrigger: true, historicalAndExternalUnaffected: true }, null, 2));
console.log(JSON.stringify({ cases: results.length, engines: ['chromium', 'webkit'], status: 'passed' }));
