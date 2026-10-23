import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { contentCatalog, topicMarkdown } from '../lib/agent-content.mjs';
import { createContentAPI } from '../feedback/content-api.mjs';
import { readingBase } from '../lib/agent-reading.mjs';
import { normalizeLibrary } from '../lib/library.mjs';
import { renderLibraryPage } from '../lib/library-render.mjs';
import { looksLikePosting, normalizeOpportunities, opportunitiesJson, opportunitiesMarkdown, readOpportunities } from '../lib/opportunities.mjs';

const root = new URL('../', import.meta.url).pathname;
const hiring = (overrides = {}) => ({ id: 'sensetime-code-intern', kind: 'hiring', title: '基座模型 Code 方向实习', org: '商汤科技',
  summary: '研究 Code Agent 与 Coding LLM。', roles: ['intern'], topics: ['Code Agent'], links: [],
  shares: [{ date: '2026-10-16', group: 'group-4' }], ...overrides });
const workshop = (overrides = {}) => ({ id: 'agents-workshop', kind: 'cfp', title: 'Agents Workshop', org: 'AAAI 2027',
  summary: '征稿。', deadline: '2026-11-20', topics: [], links: [{ kind: 'docs', url: 'https://example.org/cfp' }],
  shares: [{ date: '2026-10-17', group: 'group-3' }], ...overrides });
const meetup = (overrides = {}) => ({ id: 'tb-meetup', kind: 'event', title: '见面会', org: '社区', summary: '线下交流。',
  location: '北京', event_date: '2026-10-02', topics: [], links: [{ kind: 'article', url: 'https://example.org/meetup' }],
  shares: [{ date: '2026-09-30', group: 'group-2' }, { date: '2026-09-30', group: 'group-2' }], ...overrides });
const file = (items, through = '2026-10-17') => ({ version: 1, through, items });

test('an opportunity stays open until its deadline, its event, or 60 days after the last share', () => {
  const { items } = normalizeOpportunities(file([hiring(), workshop(), meetup()]), { today: '2026-10-18' });
  assert.deepEqual(items.map(item => [item.id, item.open, item.closes, item.inferred_close]), [
    ['agents-workshop', true, '2026-11-20', false],
    ['sensetime-code-intern', true, '2026-12-15', true],
    ['tb-meetup', false, '2026-10-02', false],
  ], 'open ones come first, newest posted day first');
  assert.equal(items[2].shares.length, 1, 'two shares in one group on one day are one record');
  assert.equal(normalizeOpportunities(file([workshop()]), { today: '2026-11-20' }).items[0].open, true, 'the deadline day still counts');
  assert.equal(normalizeOpportunities(file([workshop()]), { today: '2026-11-21' }).items[0].open, false);
});

test('records that would publish a contact, a sender or a malformed field are rejected', () => {
  const rejects = (item, pattern) => assert.throws(() => normalizeOpportunities(file([item])), pattern);
  rejects(hiring({ summary: '简历发到 career@example.ai' }), /contact details/);
  rejects(hiring({ summary: '感兴趣的加微 abc123' }), /contact details/);
  rejects(hiring({ org: '电话 138 1234 5678' }), /contact details/);
  rejects(hiring({ summary: '扫描二维码报名' }), /contact details/);
  rejects(hiring({ roles: [] }), /needs roles/);
  rejects(hiring({ roles: ['boss'] }), /needs roles/);
  rejects(workshop({ roles: ['intern'] }), /Only hiring/);
  rejects(hiring({ shares: [{ date: '2026-10-16', group: 'group-4', sender: '某人' }] }), /Unexpected opportunity share field: sender/);
  rejects(hiring({ shares: [{ date: '2026-10-18', group: 'group-4' }] }), /Invalid opportunity share/);
  rejects(workshop({ links: [{ kind: 'docs', url: 'http://example.org/cfp' }] }), /Invalid opportunity link/);
  rejects(workshop({ deadline: '2026-02-30' }), /Invalid deadline/);
  assert.throws(() => normalizeOpportunities(file([hiring(), hiring()])), /duplicate opportunity id/);
  // Dates written in prose are not phone numbers.
  assert.doesNotThrow(() => normalizeOpportunities(file([meetup({ summary: '2026 年 10 月 2 日 14:00 开始，持续 3 小时。' })])));
});

test('the reviewed opportunities file validates and publishes no contact details', async () => {
  const opportunities = normalizeOpportunities(await readOpportunities(root), { today: '2026-10-18' });
  assert.ok(opportunities.items.length > 0);
  const published = JSON.stringify(opportunitiesJson(opportunities)) + opportunitiesMarkdown(opportunities);
  assert.doesNotMatch(published, /@[a-z0-9-]+\.[a-z]|微信号|wxid_|二维码|sender|avatar/i);
});

test('the library page shows open opportunities as cards and folds the closed ones', () => {
  const library = normalizeLibrary({ version: 1, through: '2026-10-17', items: [] });
  const opportunities = normalizeOpportunities(file([hiring(), workshop(), meetup({ title: '<b>见面会</b>' })]), { today: '2026-10-18' });
  const { document } = parseHTML(renderLibraryPage(library, { dailyHref: '../', weeklyHref: '../', opportunities }));
  const section = document.querySelector('#opportunities');
  assert.match(section.querySelector('.opportunities-head p').textContent, /开放中 2 项（招聘 1、征稿 1）/);
  assert.deepEqual([...section.querySelectorAll(':scope > .opportunity-list > .opportunity')].map(card => card.id), ['agents-workshop', 'sensetime-code-intern']);
  assert.deepEqual([...section.querySelectorAll('.opportunities-closed .opportunity')].map(card => card.id), ['tb-meetup']);
  assert.equal(section.querySelector('#tb-meetup b'), null, 'titles are escaped');
  const intern = section.querySelector('#sensetime-code-intern');
  // These go stale: every card says when it was posted, and never invents a deadline the post did not give.
  assert.equal(intern.querySelector('.opportunity-posted').textContent, '2026.10.16 发布');
  assert.equal(intern.querySelector('.opportunity-when').textContent, '未写截止日期');
  assert.ok(intern.querySelector('.opportunity-when.is-inferred'));
  assert.equal(section.querySelector('#agents-workshop .opportunity-when').textContent, '截止 2026.11.20');
  assert.equal(section.querySelector('#tb-meetup .opportunity-when').textContent, '活动日期 2026.10.02');
  assert.match(section.querySelector('.opportunities-head p').textContent, /收录到 2026\.10\.17/);
  assert.match(intern.querySelector('.opportunity-contact').textContent, /联系方式见四群 2026\.10\.16 的原消息/);
  assert.equal(section.querySelector('#agents-workshop .opportunity-title a').getAttribute('href'), 'https://example.org/cfp');
  assert.ok(document.querySelector('a.inline-link[href="#opportunities"]'), 'the intro links to the open opportunities');

  const quiet = normalizeOpportunities(file([meetup()]), { today: '2026-10-18' });
  const page = parseHTML(renderLibraryPage(library, { dailyHref: '../', weeklyHref: '../', opportunities: quiet })).document;
  assert.match(page.querySelector('.opportunities-head p').textContent, /目前没有开放中的机会/);
  assert.equal(page.querySelector('a.inline-link[href="#opportunities"]'), null);
});

test('agents find opportunities by kind and the API judges open against today, not the build date', async () => {
  // Built on 10-18, read on 11-25: the workshop deadline (11-20) has passed, the internship (12-15) has not.
  const opportunities = normalizeOpportunities(file([hiring(), workshop(), meetup()]), { today: '2026-10-18' });
  const catalog = contentCatalog({ library: normalizeLibrary({ version: 1, through: '2026-10-17', items: [] }), opportunities });
  const entry = catalog.entries.find(item => item.id === 'opportunity:sensetime-code-intern');
  assert.equal(entry.kind, 'opportunity');
  assert.deepEqual(entry.keywords, ['招聘', '实习', '商汤科技', 'Code Agent']);
  assert.match(entry.url, /\/library\/#sensetime-code-intern$/);
  assert.match(topicMarkdown(entry), /## 机会[\s\S]*状态：开放中，2026-10-16 发布，未写截止日期（按 60 天算到 2026-12-15）[\s\S]*联系方式见 2026-10-16 群里的原消息/);

  const now = () => Date.parse('2026-11-25T02:00:00Z');
  const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => {} }) }) } };
  const api = createContentAPI(async () => Response.json(catalog), now);
  const call = async path => (await api(new Request(new URL('/content/' + path, readingBase), {}), env)).json();
  const listed = await call('search?kind=opportunity&limit=20');
  assert.equal(listed.total, 3);
  assert.ok(listed.items.every(item => item.first_shared), 'every result says when it was posted');
  assert.deepEqual(Object.fromEntries(listed.items.map(item => [item.id, item.open])),
    { 'opportunity:sensetime-code-intern': true, 'opportunity:agents-workshop': false, 'opportunity:tb-meetup': false });
  const read = await call('item?id=opportunity:agents-workshop');
  assert.equal(read.item.open, false);
  assert.equal(read.item.deadline, '2026-11-20');
  const byGroup = await call('search?kind=opportunity&group=group-4');
  assert.deepEqual(byGroup.items.map(item => item.id), ['opportunity:sensetime-code-intern']);
  assert.equal((await call('search?q=' + encodeURIComponent('实习'))).items[0].id, 'opportunity:sensetime-code-intern');
});

test('the collector keeps postings and leaves questions, banter and relays out', () => {
  assert.ok(looksLikePosting('商汤基座模型code方向实习生招聘 本岗位聚焦商汤基座大模型，面向真实软件工程场景，开展 Code Agent 研究。'));
  assert.ok(looksLikePosting('北京融科秋招OpenDay（10/15-16），欢迎各位同学报名。我们团队是Maxgent，Founder会参加面对面。'));
  assert.ok(looksLikePosting('📣AAAI 2027 Workshop 征稿通知 官网 trust4rsi-agent.github.io 加拿大蒙特利尔 2027年2/22–23'));
  assert.ok(!looksLikePosting('有没有人知道哪里在招 agent 方向的实习？最好是北京的，求推荐一下谢谢各位'), 'a question is not a posting');
  assert.ok(!looksLikePosting('日报已更新：招聘、实习、北京、上海的讨论都在里面，大家可以去看看今天的内容'));
  assert.ok(!looksLikePosting('AgentHub 2026.10.17 日报已上线 【三群】看点还有自进化 Agent 操作系统方向的征稿，以及北京实习的讨论'), 'the daily relay names postings but is not one');
  assert.ok(!looksLikePosting('哈哈哈'));
  assert.ok(!looksLikePosting('同意，这个方向的实习确实不错↳ 商汤基座模型code方向实习生招聘 本岗位聚焦商汤基座大模型，面向真实软件工程场景'),
    'a reply quoting a posting is not itself a posting');
});
