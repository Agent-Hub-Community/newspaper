import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// The reader reports each discussion it opens to the feedback worker, once per story per tab.
const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  const errors = [], opens = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://feedback.example/**', route => {
    const request = route.request();
    opens.push({ method: request.method(), url: request.url(), referer: request.headers().referer, cookie: request.headers().cookie });
    return route.fulfill({ status: 204 });
  });
  await page.route('https://site.example/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><main></main>' }));
  await page.goto('https://site.example/daily/');
  await page.evaluate(() => { window.AGENT_HUB_DATA = { feedbackEndpoint: 'https://feedback.example/' }; });
  await page.addScriptTag({ content: await readFile(`${root}discussion-panel.js`, 'utf8') });
  const message = text => ({ speaker: 1, time: '10:00', text });
  await page.evaluate(([first, second, third]) => {
    const topics = [
      { title: 'First', messages: [first], feedbackId: 'a'.repeat(32) },
      { title: 'Second', messages: [second], feedbackId: 'b'.repeat(32) },
      { title: 'No id', messages: [third] },
    ];
    document.querySelector('main').innerHTML = topics.map((topic, index) => window.AgentHubDiscussion.trigger(topic.messages, index)).join('');
    window.AgentHubDiscussion.configure({ section: '测试', total: topics.length, topic: index => topics[index] || null });
  }, [message('one'), message('two'), message('three')]);
  const openAndClose = async index => {
    await page.locator(`#discussion-${index + 1}`).click();
    await page.locator('#discussion-dialog .discussion-text').first().waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#discussion-dialog').open);
  };
  await openAndClose(0);
  await openAndClose(0);
  await openAndClose(1);
  await openAndClose(2);
  assert.deepEqual(opens.map(open => [open.method, open.url]), [
    ['POST', `https://feedback.example/opens?story=${'a'.repeat(32)}`],
    ['POST', `https://feedback.example/opens?story=${'b'.repeat(32)}`],
  ]);
  assert.ok(opens.every(open => !open.referer && !open.cookie), 'no referrer or cookies leave the reader');
  assert.deepEqual(errors, []);
  console.log('Discussion opens: one report per story per tab, none without an id, no referrer or cookies.');
} finally {
  await browser.close();
}
