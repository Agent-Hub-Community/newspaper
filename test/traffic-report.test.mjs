import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dateRange, formatReport, trafficReport } from '../scripts/traffic-report.mjs';
import { basePath } from '../lib/site.mjs';

// Stands in for `wrangler d1 execute --json`: runs each statement against a local copy of the schema.
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../feedback/schema.sql', import.meta.url), 'utf8'));
  const calls = [];
  const execute = args => {
    calls.push(args);
    const sql = args[args.indexOf('--command') + 1];
    return sql.split(/;\n/).map(statement => ({ success: true, results: db.prepare(statement).all().map(row => ({ ...row })) }));
  };
  const view = (day, path, source, views) => db.prepare('INSERT INTO page_views VALUES (?, ?, ?, ?)').run(day, basePath + path, source, views);
  const visitor = (day, hash) => db.prepare('INSERT INTO daily_visitors VALUES (?, ?)').run(day, hash);
  return { calls, execute, view, visitor };
}

test('the default range is the last 7 Beijing days and explicit ranges are checked', () => {
  // 16:30 UTC on Oct 22 is already Oct 23 in Beijing.
  assert.deepEqual(dateRange({ now: Date.parse('2026-10-22T16:30:00Z') }), { from: '2026-10-17', to: '2026-10-23' });
  assert.deepEqual(dateRange({ to: '2026-10-03' }), { from: '2026-09-27', to: '2026-10-03' });
  assert.deepEqual(dateRange({ from: '2026-10-20', to: '2026-10-20' }), { from: '2026-10-20', to: '2026-10-20' });
  for (const range of [{ from: '2026-10-21', to: '2026-10-20' }, { from: '2026-02-30', to: '2026-03-01' }, { from: '20261020' },
    { to: "2026-10-20' OR 1=1 --" }, { from: '' }]) assert.throws(() => dateRange(range), /--from|--to/, JSON.stringify(range));
});

test('each day reports views, daily visitors, the WeChat share and its ten most viewed pages', () => {
  const { calls, execute, view, visitor } = database();
  view('2026-10-21', '', 'other', 4);
  view('2026-10-21', '', 'wechat', 12);
  view('2026-10-21', 'daily/2026-10-21/group-1/', 'wechat', 9);
  for (let i = 1; i <= 11; i++) view('2026-10-22', `daily/2026-10-22/group-${i}/`, i % 2 ? 'wechat' : 'other', 20 - i);
  view('2026-10-22', 'daily/2026-10-22/group-11/', 'other', 30);
  view('2026-10-25', 'library/', 'other', 100);
  for (const hash of ['a', 'b', 'c']) visitor('2026-10-21', hash);
  visitor('2026-10-22', 'a');
  const report = trafficReport({ from: '2026-10-20', to: '2026-10-22', execute });
  assert.deepEqual(report.days.map(({ top_pages, ...day }) => day), [
    { day: '2026-10-20', views: 0, visitors: 0, wechat_views: 0, wechat_share: null },
    { day: '2026-10-21', views: 25, visitors: 3, wechat_views: 21, wechat_share: 0.84 },
    { day: '2026-10-22', views: 184, visitors: 1, wechat_views: 84, wechat_share: 84 / 184 },
  ]);
  assert.deepEqual(report.days[1].top_pages, [{ path: basePath, views: 16 }, { path: `${basePath}daily/2026-10-21/group-1/`, views: 9 }]);
  const top = report.days[2].top_pages;
  assert.equal(top.length, 10);
  // A page's sources are added together before ranking.
  assert.deepEqual(top[0], { path: `${basePath}daily/2026-10-22/group-11/`, views: 39 });
  assert.deepEqual(top.at(-1), { path: `${basePath}daily/2026-10-22/group-9/`, views: 11 });
  assert.ok(!top.some(page => page.path.endsWith('group-10/')), 'the eleventh page is cut');
  // One read-only Wrangler call against the remote production database.
  assert.equal(calls.length, 1);
  const [args] = calls;
  assert.deepEqual(args.slice(0, 4), ['d1', 'execute', 'agenthub-feedback', '--remote']);
  assert.equal(args[args.indexOf('--config') + 1], fileURLToPath(new URL('../feedback/wrangler.jsonc', import.meta.url)));
  assert.ok(args.includes('--json'));
  for (const statement of args[args.indexOf('--command') + 1].split(/;\n/)) assert.match(statement.trim(), /^SELECT\b/);
  assert.doesNotMatch(args.join(' '), /\b(?:INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b/i);
});

test('the text report lists every day and the per-day top pages', () => {
  const { execute, view, visitor } = database();
  view('2026-10-22', 'search/', 'wechat', 3);
  view('2026-10-22', 'library/', 'other', 1);
  visitor('2026-10-22', 'a');
  const text = formatReport(trafficReport({ from: '2026-10-21', to: '2026-10-22', execute }));
  assert.match(text, /^AgentHub 浏览量 · 2026-10-21 至 2026-10-22（北京时间）\n/);
  assert.match(text, /\n2026-10-21\s+0\s+0\s+—\n/);
  assert.match(text, /\n2026-10-22\s+4\s+1\s+75%\n/);
  assert.match(text, /\n合计\s+4\s+—\s+75%\n/);
  assert.match(text, new RegExp(`\\n2026-10-22 浏览最多的页面\\n\\s+1\\s+3\\s+${basePath}search/\\n\\s+2\\s+1\\s+${basePath}library/\\n$`));
  assert.doesNotMatch(text, /2026-10-21 浏览最多的页面/);
});

test('a failed or incomplete Wrangler result is an error, not an empty report', () => {
  const range = { from: '2026-10-21', to: '2026-10-22' };
  for (const output of [[], [{ success: true, results: [] }], [{ success: false }, { success: true }, { success: true }], { error: 'auth' }]) {
    assert.throws(() => trafficReport({ ...range, execute: () => output }), /query failed/, JSON.stringify(output));
  }
});
