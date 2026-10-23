import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker from '../feedback/worker.mjs';
import { viewPath } from '../feedback/page-views.mjs';
import { basePath, origin } from '../lib/site.mjs';

const visitor = 'c0ffee00-1234-4abc-9def-0123456789ab';
const wechat = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.50(0x18003231) NetType/WIFI Language/zh_CN';
function fixture({ limit = () => true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../feedback/schema.sql', import.meta.url), 'utf8'));
  const statement = (sql, values = []) => ({ sql, values, bind: (...args) => statement(sql, args) });
  const env = {
    // The second origin is the old site address, as in feedback/wrangler.jsonc.
    ALLOWED_ORIGIN: `${origin},https://old.example`,
    RATE_LIMITER: { limit: async () => ({ success: limit() }) },
    DB: {
      prepare: sql => statement(sql),
      async batch(statements) {
        db.exec('BEGIN');
        try { for (const s of statements) db.prepare(s.sql).run(...s.values); db.exec('COMMIT'); }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      },
    },
  };
  const request = (body, { method = 'POST', headers = {} } = {}) => new Request('https://feedback.example/views', {
    method, headers: { Origin: origin, 'Content-Type': 'text/plain;charset=UTF-8', ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  const send = (body, init) => worker.fetch(request(body, init), env);
  const views = () => db.prepare('SELECT day, path, source, views FROM page_views ORDER BY path, source').all().map(row => ({ ...row }));
  const visitors = () => db.prepare('SELECT day, visitor_hash FROM daily_visitors ORDER BY day').all().map(row => ({ ...row }));
  return { db, env, send, views, visitors };
}
const at = (t, iso) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['Date'], now: Date.parse(iso) });
};

test('views add up per Beijing date, normalized path and source', async t => {
  // 17:00 UTC on Oct 21 is already Oct 22 in Beijing.
  at(t, '2026-10-21T17:00:00Z');
  const { send, views } = fixture();
  const page = `${basePath}daily/2026-10-22/group-1/`;
  for (const path of [page, `${page}?from=timeline#discussion-2`, `${page}index.html`]) assert.equal((await send({ path, visitor })).status, 204, path);
  assert.equal((await send({ path: page }, { headers: { 'User-Agent': wechat } })).status, 204);
  assert.equal((await send({ path: `${basePath}index.html` }, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/141' } })).status, 204);
  assert.deepEqual(views(), [
    { day: '2026-10-22', path: basePath, source: 'other', views: 1 },
    { day: '2026-10-22', path: page, source: 'other', views: 3 },
    { day: '2026-10-22', path: page, source: 'wechat', views: 1 },
  ]);
});

test('each browser counts once per day as a date-salted hash, never as its raw ID', async t => {
  at(t, '2026-10-22T02:00:00Z');
  const { db, send, visitors } = fixture();
  const path = `${basePath}library/`;
  for (let i = 0; i < 3; i++) await send({ path, visitor });
  await send({ path: `${basePath}search/`, visitor });
  await send({ path, visitor: visitor.replace(/b$/, 'c') });
  const hash = day => createHash('sha256').update(`${day}:${visitor}`).digest('hex').slice(0, 32);
  assert.equal(visitors().length, 2);
  assert.ok(visitors().some(row => row.visitor_hash === hash('2026-10-22')));
  mock.timers.setTime(Date.parse('2026-10-22T17:00:00Z'));
  await send({ path, visitor });
  assert.deepEqual(visitors().filter(row => row.day === '2026-10-23'), [{ day: '2026-10-23', visitor_hash: hash('2026-10-23') }]);
  assert.notEqual(hash('2026-10-23'), hash('2026-10-22'), 'the same browser has unrelated hashes on different days');
  const stored = JSON.stringify([db.prepare('SELECT * FROM page_views').all(), db.prepare('SELECT * FROM daily_visitors').all()]);
  assert.doesNotMatch(stored, new RegExp(visitor.slice(0, 8)));
});

test('a missing or malformed visitor ID still counts the view but no visitor', async () => {
  const { send, views, visitors } = fixture();
  for (const body of [{ path: basePath }, { path: basePath, visitor: 'not-a-uuid' }, { path: basePath, visitor: visitor.toUpperCase() },
    { path: basePath, visitor: '00000000-0000-1000-8000-000000000001' }, { path: basePath, visitor: 42 }]) {
    assert.equal((await send(body)).status, 204, JSON.stringify(body));
  }
  assert.equal(views()[0].views, 5);
  assert.equal(visitors().length, 0);
});

test('only the published route shapes are accepted', () => {
  const accepted = ['', 'index.html', 'daily/2026-10-22/group-1/', 'daily/2026-10-22/group-12/', 'daily/2026-10-22/external/',
    'daily/2026-10-22/group-5/index.html', 'weekly/2026-10-12/2026-10-18/group-3/', 'weekly/2026-10-12/2026-10-18/rank/',
    'weekly/2026-10-12_2026-10-18/external/', 'rank/week/', 'rank/month/group-2/', 'rank/all/', 'library/', 'glossary/',
    'search/', 'search/index.html'];
  for (const route of accepted) assert.equal(viewPath(basePath + route), basePath + route.replace(/index\.html$/, ''), route);
  assert.equal(viewPath(`${basePath}search/?q=private#top`), `${basePath}search/`);
  const rejected = ['/', '/other/', `${basePath.slice(0, -1)}`, `${basePath}404.html`, `${basePath}daily/`, `${basePath}daily/2026-10-22/`,
    `${basePath}daily/2026-10-22/group-0/`, `${basePath}daily/2026-10-22/group-1`, `${basePath}daily/2026-10-22/secret/`,
    `${basePath}daily/2026-10-22/group-1/extra/`, `${basePath}weekly/`, `${basePath}weekly/2026-10-12/group-1/`, `${basePath}rank/day/`,
    `${basePath}rank/week/external/`, `${basePath}agents/`, `${basePath}library/resources.json`, `${basePath}documents/x.html`,
    `${basePath}../etc/passwd`, `${basePath}daily/2026-10-22/%67roup-1/`, `${basePath}Library/`, `${basePath}library//`,
    `https://agent-hub-community.github.io${basePath}`, `${basePath}library/${'x'.repeat(200)}`, '', null, 42, [basePath], { path: basePath }];
  for (const value of rejected) assert.equal(viewPath(value), null, JSON.stringify(value));
});

test('invalid requests, other origins and bursts write nothing', async () => {
  let allowed = true;
  const { env, send, views, visitors } = fixture({ limit: () => allowed });
  assert.equal((await send({ path: `${basePath}private/`, visitor })).status, 400);
  assert.equal((await send({ path: `${basePath}library/${'a'.repeat(200)}/` })).status, 400);
  assert.equal((await send({ visitor })).status, 400);
  assert.equal((await send(undefined)).status, 400, 'bodyless');
  assert.equal((await send('')).status, 400);
  assert.equal((await send('{')).status, 400);
  assert.equal((await send('null')).status, 400);
  assert.equal((await send(JSON.stringify({ path: basePath, pad: ' '.repeat(1100) }))).status, 413);
  assert.equal((await send({ path: basePath }, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal((await send({ path: basePath }, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await worker.fetch(new Request('https://feedback.example/views', { method: 'POST', body: JSON.stringify({ path: basePath }) }), env)).status, 403, 'no Origin');
  assert.equal((await send({ path: basePath }, { headers: { Origin: 'null' } })).status, 403);
  assert.equal((await send(undefined, { method: 'GET' })).status, 405, 'there is no public read endpoint');
  const preflight = await send(undefined, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
  allowed = false;
  assert.equal((await send({ path: basePath, visitor })).status, 429);
  assert.deepEqual(views(), []);
  assert.deepEqual(visitors(), []);
  allowed = true;
  const accepted = await send({ path: basePath }, { headers: { Origin: 'https://old.example' } });
  assert.equal(accepted.status, 204);
  assert.equal(accepted.headers.get('Access-Control-Allow-Origin'), 'https://old.example');
});

test('page views use their own rate-limit key and fail closed when D1 fails', async () => {
  const keys = [];
  const { env, send } = fixture();
  env.RATE_LIMITER = { limit: async ({ key }) => { keys.push(key); return { success: true }; } };
  await send({ path: basePath }, { headers: { 'CF-Connecting-IP': '203.0.113.9' } });
  assert.deepEqual(keys, ['views:203.0.113.9']);
  env.DB.batch = async () => { throw new Error('D1 down'); };
  assert.equal((await send({ path: basePath })).status, 503);
});
