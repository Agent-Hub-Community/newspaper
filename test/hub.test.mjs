import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hubSummary } from '../lib/hub.mjs';
import { basePath } from '../lib/site.mjs';

const page = (id, heading, text = '摘要。') => ({ id, label: id, heading, stories: text ? [{ title: '题', text }] : [], trends: [], papers: [] });
const input = {
  data: {
    digests: [
      { date: '2026-10-15', pages: [page('group-1', '一群标题')] },
      { date: '2026-10-16', pages: [page('group-2', ' 二群标题 '), page('group-3', '空稿', '  '), page('external', '资讯标题')] },
      { date: '2026-10-17', pages: [page('group-1', '还没写', '')] },
    ],
    weeklies: [{ start: '2026-10-05', end: '2026-10-11', title: '一周', pages: [
      { id: 'overview', label: '总览', stories: [] },
      { id: 'group-3', label: '三群', title: '三群周报', stories: [{ title: '题', text: '文' }] },
    ] }],
    coverage: { first: '2026-10-15', last: '2026-10-17' },
    activity: { groups: [{ id: 'group-1', available: true }, { id: 'group-2', available: false }, { id: 'group-3' }] },
  },
  library: { items: [
    { id: 'b', title: '同名项目', type: 'code', shares: [{ date: '2026-10-16' }] },
    { id: 'a', title: '同名项目', type: 'tool', shares: [{ date: '2026-10-16' }] },
    { id: 'c', title: '旧论文', type: 'paper', shares: [{ date: '2026-09-01' }, { date: '2026-10-01' }] },
    { id: 'd', title: '没有日期', type: 'paper' },
  ] },
  glossary: { terms: [{ term: 'RL' }, { term: 'SFT' }] },
  opportunities: { items: [{ kind: 'hiring', open: true }, { kind: 'cfp', open: true }, { kind: 'hiring', open: false }] },
  searchable: 42,
};

test('the hub summary points at the latest readable daily; a quiet group keeps its place with its last page', () => {
  const hub = hubSummary(input);
  assert.equal(hub.daily.date, '2026-10-16', 'an edition with no readable page is skipped');
  assert.equal(hub.daily.path, `${basePath}daily/2026-10-16/overview/`);
  assert.deepEqual(hub.daily.pages.filter(entry => !entry.quiet).map(entry => [entry.id, entry.label, entry.title]),
    [['group-2', '二群', '二群标题'], ['external', '外部资讯', '资讯标题']]);
  // 三群 was empty on 10-16 and never had a page before, so it is left out; nothing invents a page.
  assert.equal(hub.daily.pages.some(entry => entry.id === 'group-3'), false);
  const quiet = hubSummary({ ...input, data: { ...input.data, digests: [
    { date: '2026-10-15', pages: [page('group-1', '一群标题')] },
    { date: '2026-10-16', pages: [page('group-1', '空', ''), page('group-2', '二群标题')] },
  ] } }).daily.pages;
  assert.deepEqual(quiet.map(entry => [entry.id, Boolean(entry.quiet)]), [['group-1', true], ['group-2', false]], 'groups stay in order');
  assert.deepEqual(quiet[0].last, { date: '2026-10-15', id: 'group-1', label: '一群', title: '一群标题', path: `${basePath}daily/2026-10-15/group-1/` });
  assert.deepEqual(hub.issues, { daily: 2, weekly: 1, first: '2026-10-15', last: '2026-10-17' });
});

test('the hub summary links the latest weekly overview and its sections with stories', () => {
  const { weekly } = hubSummary(input);
  assert.equal(weekly.path, `${basePath}weekly/2026-10-05/2026-10-11/overview/`);
  assert.deepEqual(weekly.pages.map(entry => [entry.id, entry.title, entry.path]),
    [['group-3', '三群周报', `${basePath}weekly/2026-10-05/2026-10-11/group-3/`]]);
});

test('recent resources are newest first, shown once per title, and link into the library', () => {
  const { library } = hubSummary(input);
  assert.equal(library.count, 4);
  assert.deepEqual(library.recent.map(item => [item.title, item.date, item.path]), [
    ['同名项目', '2026-10-16', `${basePath}library/#a`],
    ['旧论文', '2026-10-01', `${basePath}library/#c`],
    ['没有日期', '', `${basePath}library/#d`],
  ]);
  assert.deepEqual(library.recent.map(item => item.type), ['工具与产品', '论文', '论文'], 'types use their reader-facing names');
  assert.deepEqual(library.recent.map(item => item.kind), ['tool', 'paper', 'paper'], 'and keep their ids for other languages');
});

test('counts and paths cover every section, with root-relative links only', () => {
  const hub = hubSummary(input);
  assert.equal(hub.glossary.count, 2);
  assert.equal(hub.opportunities.count, 3);
  assert.equal(hub.opportunities.open, 2, 'closed postings are not counted as open');
  assert.deepEqual(hub.opportunities.kinds, { hiring: 1, cfp: 1 });
  assert.deepEqual(hub.search, { count: 42, path: `${basePath}search/` });
  assert.equal(hub.rank.groups, 2, 'groups marked unavailable are not counted');
  const paths = JSON.stringify(hub).match(/"path":"[^"]*"/g);
  assert.ok(paths.every(entry => entry.startsWith(`"path":"${basePath}`)), 'every path is root-relative under the newspaper');
  assert.equal(JSON.stringify(hubSummary(input)), JSON.stringify(hub), 'the summary is deterministic');
});

test('the hub summary tolerates an empty newspaper', () => {
  const hub = hubSummary({ data: { digests: [], weeklies: [], coverage: {} }, library: { items: [] }, glossary: { terms: [] } });
  assert.equal(hub.daily, null);
  assert.equal(hub.weekly, null);
  assert.equal(hub.rank.groups, 0);
  assert.equal(hub.search.count, 0);
});
