import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import worker from '../feedback/worker.mjs';
import { SENSITIVE, cleanQuery } from '../feedback/search-events.mjs';
import { renderSearchPage } from '../lib/search-render.mjs';
import { origin } from '../lib/site.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(new URL('../feedback/schema.sql', import.meta.url), 'utf8'));
  const statement = (sql, values = []) => ({
    sql, values, bind: (...args) => statement(sql, args),
    run: async () => ({ meta: db.prepare(sql).run(...values) }),
  });
  const env = { ALLOWED_ORIGIN: origin, DB: {
    prepare: sql => statement(sql),
    async batch(statements) {
      db.exec('BEGIN');
      try { for (const s of statements) db.prepare(s.sql).run(...s.values); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  } };
  const search = { id: randomUUID(), query: '哈基米', results: 12, kind: '', group: '', time: '', sort: 'relevance' };
  const payload = { search, test: false };
  const req = (body = payload, method = 'POST', headers = {}) => new Request('https://feedback.example/search-events', {
    method, headers: { Origin: origin, 'Content-Type': 'text/plain;charset=UTF-8', ...headers },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  return { db, env, search, payload, req, send: body => worker.fetch(req(body), env) };
}

test('searches and clicks survive out-of-order retries without duplicating the denominator', async () => {
  const { db, search, payload, send } = fixture();
  const click = { id: randomUUID(), target: 'daily/2026-10-14/group-1/#topic-1', rank: 2 };
  assert.equal((await send({ ...payload, click })).status, 204);
  assert.equal((await send(payload)).status, 204);
  assert.equal((await send({ ...payload, click })).status, 204);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM search_events').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM search_clicks').get().n, 1);
  assert.equal((await send({ search: { ...search, id: randomUUID(), query: '龘靐齉爩', results: 0 }, test: true })).status, 204);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM search_events WHERE result_count = 0 AND is_test = 1').get().n, 1);
  // Altering a stored search cannot associate a click with a different query/denominator.
  await send({ ...payload, search: { ...search, query: 'other' }, click: { ...click, id: randomUUID() } });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM search_clicks').get().n, 1);
});

test('invalid paths, counts, payloads and origins cannot enter the database', async () => {
  const { db, env, search, payload, req, send } = fixture();
  for (const patch of [{ results: -1 }, { results: 0.5 }, { query: '' }, { kind: 'secret' }, { time: 'forever' }, { id: 'bad' }]) {
    assert.equal((await send({ ...payload, search: { ...search, ...patch } })).status, 400);
  }
  for (const target of ['https://evil.example/', 'daily/2026-10-14/group-1/?secret=x', '../private/#id']) {
    assert.equal((await send({ ...payload, click: { id: randomUUID(), target, rank: 1 } })).status, 400);
  }
  assert.equal((await send({ ...payload, click: { id: randomUUID(), target: 'library/#item', rank: 13 } })).status, 400);
  assert.equal((await send(' '.repeat(4097))).status, 413);
  assert.equal((await send('{')).status, 400);
  assert.equal((await worker.fetch(req(payload, 'POST', { Origin: 'https://evil.example' }), env)).status, 403);
  assert.equal((await worker.fetch(req(null, 'GET'), env)).status, 405, 'there is no public read endpoint');
  env.RATE_LIMITER = { limit: async () => ({ success: false }) };
  assert.equal((await send(payload)).status, 429);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM search_events').get().n, 0);
});

test('query normalization and retention apply at the server', async () => {
  const { db, env, payload, send } = fixture();
  assert.equal(cleanQuery('  Ａ社  coding\n agent  '), 'A社 coding agent');
  assert.equal(cleanQuery('x'.repeat(200)).length, 120);
  for (const query of ['138 0013 8000', '138-0013-8000', 'www.example.com/private?token=abc', 'example.com/secret',
    'sk_live_abcdef123', 'xoxb-12345-abc', 'AKIAIOSFODNN7EXAMPLE', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIi.sig', 'wxid_abc123',
    'abcdef1234567890ABCDEF12345']) assert.equal(cleanQuery(query), '[已隐藏敏感内容]', query);
  for (const query of ['GPT-6.1 Sol', 'Qwen3.6-35B-A3B', 'ICLR 2026', 'arxiv 2605.19516', '2026-10-07 到 2026-10-13', 'gpt-4o', 'o5-mini']) {
    assert.equal(cleanQuery(query), query, query);
  }
  const browser = (await import('node:fs')).readFileSync(new URL('../site/search-tracking.js', import.meta.url), 'utf8');
  assert.ok(browser.includes(SENSITIVE.toString()), 'the browser redacts with the same pattern');
  for (const query of ['a@example.com', 'sk-credential', 'https://private.example/?token=x', '13812345678']) {
    await send({ ...payload, search: { ...payload.search, id: randomUUID(), query } });
  }
  assert.deepEqual(db.prepare('SELECT DISTINCT query FROM search_events').all().map(x => x.query), ['[已隐藏敏感内容]']);
  const old = randomUUID();
  await send({ ...payload, search: { ...payload.search, id: old }, click: { id: randomUUID(), target: 'library/#some-item', rank: 1 } });
  db.prepare('UPDATE search_events SET created_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', old);
  await worker.scheduled({}, env);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM search_events').get().n, 4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM search_clicks').get().n, 0, 'expired search clicks cascade');
});

test('only a public build with an endpoint enables tracking and discloses collection', () => {
  const options = { examples: ['RSI'], count: 1, dailyHref: '../', weeklyHref: '../weekly/' };
  for (const extra of [{}, { publicBuild: true }, { feedbackEndpoint: 'https://feedback.example' }]) {
    const html = renderSearchPage({ ...options, ...extra });
    assert.ok(!html.includes('name="agenthub-search-endpoint"'));
    assert.match(html, /不上传/);
  }
  const html = renderSearchPage({ ...options, publicBuild: true, feedbackEndpoint: 'https://feedback.example' });
  assert.match(html, /connect-src https:\/\/cloudflareinsights.com https:\/\/feedback.example/);
  assert.match(html, /保留 30 天/);
  assert.ok(html.indexOf('src="../search-tracking.js') < html.indexOf('src="../search.js'));
});
