// Exercise the rendered library directly; no site build or checked-in data changes are needed.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { normalizeLibrary } from '../library.mjs';
import { renderLibraryPage } from '../library-render.mjs';
import { normalizeOpportunities } from '../opportunities.mjs';

const root = new URL('../', import.meta.url);
const library = normalizeLibrary({ version: 1, through: '2026-10-17', items: [
  { id: 'cua-paper', title: 'CUA 论文', summary: 'Computer Use 研究。', type: 'paper', topics: ['computer-use'], keywords: ['OSWorld', 'RLVR', '环境'],
    links: [{ kind: 'paper', url: 'https://arxiv.org/abs/2605.25624' }], shares: [{ date: '2026-10-16', group: 'group-1', avatar: null }] },
  { id: 'agent-tool', title: 'Agent 工具', summary: '工具开发。', type: 'tool', topics: ['coding-agents'], keywords: ['MCP', '开发', '工具'],
    links: [{ kind: 'code', url: 'https://github.com/example/agent' }], shares: [{ date: '2026-10-17', group: 'group-2', avatar: null }] },
] });
const opportunities = normalizeOpportunities({ version: 1, through: '2026-10-17', items: [
  { id: 'code-intern', kind: 'hiring', title: 'Code 实习', org: '商汤科技', summary: '研究代码智能体。', roles: ['intern'], topics: [], links: [],
    shares: [{ date: '2026-10-16', group: 'group-4' }] },
  { id: 'workshop', kind: 'cfp', title: 'Agents Workshop', org: 'AAAI', summary: '可信智能体征稿。', deadline: '2026-11-20', topics: [],
    links: [{ kind: 'docs', url: 'https://example.org/cfp' }], shares: [{ date: '2026-10-17', group: 'group-3' }] },
  { id: 'meetup', kind: 'event', title: '北京见面会', org: '社区', summary: '线下交流。', event_date: '2026-10-02', topics: [],
    links: [{ kind: 'article', url: 'https://example.org/meetup' }], shares: [{ date: '2026-09-30', group: 'group-2' }] },
] }, { today: '2026-10-18' });
const html = renderLibraryPage(library, { dailyHref: '../', weeklyHref: '../', opportunities });
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/library/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); return; }
  if (!/^\/[a-z0-9-]+\.(js|css)$/.test(pathname)) { response.writeHead(404); response.end(); return; }
  try {
    const asset = await readFile(new URL(pathname.slice(1), root));
    response.writeHead(200, { 'content-type': pathname.endsWith('.js') ? 'text/javascript' : 'text/css' }); response.end(asset);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/library/`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const type = value => page.locator(`.chips button[data-filter="type"][data-value="${value}"]`);
  await page.goto(base);
  assert.equal(await page.locator('#opportunities').isVisible(), false);
  await type('paper').click();
  await page.locator('.chips button[data-filter="topic"][data-value="computer-use"]').click();
  assert.equal(await page.locator('.entry:visible').count(), 1);
  await type('opportunity').click();
  assert.equal(await page.locator('.entries').isVisible(), false);
  assert.equal(await page.locator('#opportunities').isVisible(), true);
  assert.equal(await page.locator('.opportunity:visible').count(), 2);
  assert.equal(await page.locator('[data-row="topic"]').isVisible(), false);
  assert.equal(new URL(page.url()).search, '?type=opportunity');
  await page.locator('#library-search').fill('代码智能体');
  await page.waitForFunction(() => document.querySelector('#library-status').textContent === '显示 1 / 3 项机会');
  assert.equal(await page.locator('#code-intern').isVisible(), true);
  assert.equal(await page.locator('#workshop').isVisible(), false);
  await page.locator('#library-search').fill('Agents Workshop');
  await page.waitForFunction(() => !document.querySelector('#workshop').hidden);
  assert.equal(await page.locator('#code-intern').isVisible(), false);
  await type('tool').click();
  assert.equal(await page.locator('#opportunities').isVisible(), false);
  assert.equal(await page.locator('.entry:visible').count(), 1);
  assert.equal(await page.locator('#library-search').inputValue(), '');
  await type('').click();
  assert.equal(await page.locator('.entry:visible').count(), 2);
  await page.goto(`${base}?type=opportunity&q=${encodeURIComponent('可信智能体')}`);
  assert.equal(await page.locator('#workshop').isVisible(), true);
  assert.equal(await page.locator('#code-intern').isVisible(), false);
  await page.goto(`${base}?type=paper&topic=computer-use#opportunities`);
  assert.equal(await page.locator('#opportunities').isVisible(), true);
  assert.equal(await page.locator('.opportunity:visible').count(), 2);
  assert.equal(await page.locator('.opportunities-closed').getAttribute('open'), null);
  await page.locator('.opportunities-closed summary').click();
  assert.equal(await page.locator('#meetup').isVisible(), true);
  await page.goto(`${base}#meetup`);
  assert.equal(await page.locator('#meetup').isVisible(), true);
  await page.goto(base);
  await page.locator('a[href="#opportunities"]').click();
  await page.locator('#opportunities').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#opportunities').isVisible(), true);
  await type('').click();
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(await page.locator('#opportunities').isVisible(), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  const position = await type('opportunity').boundingBox();
  assert.ok(position && position.x >= 0 && position.x + position.width <= 390, 'opportunity chip is visible without scrolling the type row');
  assert.ok(position.y + position.height <= 844, 'opportunity chip is in the phone first screen');
  assert.deepEqual(errors, []);
  console.log('Passed: independent opportunity view, title/summary search, resource return, shared URL, legacy anchors, closed fold.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
