import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../feedback/worker.mjs';
import { feedbackId, libraryFeedbackId } from '../lib/feedback-id.mjs';
import { origin } from '../lib/site.mjs';

const story = 'a'.repeat(32);
const voter = '00000000-0000-4000-8000-000000000001';
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../feedback/schema.sql', import.meta.url), 'utf8'));
  db.prepare('INSERT INTO stories VALUES (?, ?, ?, ?)').run(story, '2026-09-22', 'group-1', '测试');
  return {
    ALLOWED_ORIGIN: origin,
    DB: {
      prepare(sql) {
        return { bind(...values) {
          return { first: async () => db.prepare(sql).get(...values), all: async () => ({ results: db.prepare(sql).all(...values) }), sql, values };
        } };
      },
      async batch(statements) {
        db.exec('BEGIN');
        try {
          const rows = statements.map(s => ({ results: db.prepare(s.sql).all(...s.values) }));
          db.exec('COMMIT');
          return rows;
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      },
    },
  };
}
const req = (vote, overrides = {}) => new Request('https://feedback.example/votes', {
  method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ story, voter, vote, ...overrides }),
});
test('votes persist, are idempotent, switch mutually exclusively and cancel', async () => {
  const env = fixture();
  const call = async (vote, overrides) => (await worker.fetch(req(vote, overrides), env)).json();
  assert.deepEqual(await call('up'), { up: 1, down: 0, vote: 'up' });
  assert.deepEqual(await call('up'), { up: 1, down: 0, vote: 'up' });
  assert.deepEqual(await call('down'), { up: 0, down: 1, vote: 'down' });
  assert.deepEqual(await call('up', { voter: voter.replace(/1$/, '2') }), { up: 1, down: 1, vote: 'up' });
  const get = new Request(`https://feedback.example/votes?story=${story}&voter=${voter}`, { headers: { Origin: origin } });
  assert.deepEqual(await (await worker.fetch(get, env)).json(), { up: 1, down: 1, vote: 'down' });
  assert.deepEqual(await call(null), { up: 1, down: 0, vote: null });
});
test('API rejects unknown stories, invalid votes, origins, oversized bodies and rate limits', async () => {
  const env = fixture();
  assert.equal((await worker.fetch(req('up', { story: 'b'.repeat(32) }), env)).status, 404);
  assert.equal((await worker.fetch(req('invalid'), env)).status, 400);
  assert.equal((await worker.fetch(new Request('https://feedback.example/votes'), env)).status, 403);
  const large = new Request('https://feedback.example/votes', {
    method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: ' '.repeat(1025),
  });
  assert.equal((await worker.fetch(large, env)).status, 413);
  env.RATE_LIMITER = { limit: async () => ({ success: false }) };
  assert.equal((await worker.fetch(req('up'), env)).status, 429);
});
test('every listed site origin is accepted and echoed back; anything else is refused', async () => {
  const env = fixture();
  const old = 'https://hqhq1025.github.io';
  env.ALLOWED_ORIGIN = `${origin}, ${old}`;
  const read = from => worker.fetch(new Request(`https://feedback.example/votes?story=${story}&voter=${voter}`,
    { headers: from ? { Origin: from } : {} }), env);
  for (const from of [origin, old]) {
    const response = await read(from);
    assert.equal(response.status, 200, from);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), from);
    assert.equal(response.headers.get('Vary'), 'Origin');
    const preflight = await worker.fetch(new Request('https://feedback.example/votes', { method: 'OPTIONS', headers: { Origin: from } }), env);
    assert.equal(preflight.status, 204, from);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), from);
  }
  // Exact matches only: no longer hosts, other schemes, trailing paths or the raw list itself.
  for (const from of [`${origin}.evil.example`, origin.replace('https:', 'http:'), `${origin}/`, env.ALLOWED_ORIGIN, 'null', undefined]) {
    assert.equal((await read(from)).status, 403, String(from));
  }
  env.ALLOWED_ORIGIN = '';
  assert.equal((await read(origin)).status, 403, 'an empty list allows nobody');
});
test('the deployed Worker allows the site in site.mjs and the old address', () => {
  const config = JSON.parse(readFileSync(new URL('../feedback/wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  const allowed = config.vars.ALLOWED_ORIGIN.split(',');
  assert.ok(allowed.includes(origin), 'the current site');
  assert.ok(allowed.includes('https://hqhq1025.github.io'), 'pages still open on the old address');
  for (const entry of allowed) assert.equal(new URL(entry).origin, entry, 'each entry is a bare origin');
});
test('story identity survives emphasis but separates days, groups and content revisions', () => {
  const article = { title: '标题', text: '正文' };
  const id = feedbackId('2026-09-22', 'group-1', article);
  assert.equal(id, feedbackId('2026-09-22', 'group-1', { ...article, emphasis: ['正文'] }));
  assert.notEqual(id, feedbackId('2026-09-23', 'group-1', article));
  assert.notEqual(id, feedbackId('2026-09-22', 'group-2', article));
  assert.notEqual(id, feedbackId('2026-09-22', 'group-1', { ...article, text: '新正文' }));
});
test('a collection read returns every registered library item with this browser\'s choice', async () => {
  const env = fixture();
  const [first, second] = [libraryFeedbackId('cua-gym'), libraryFeedbackId('osworld-v2')];
  const db = env.DB;
  // Register through the same SQL the catalog script emits.
  for (const id of [first, second]) await db.batch([db.prepare('INSERT OR IGNORE INTO stories (id, date, group_id, title) VALUES (?, ?, ?, ?)').bind(id, '2026-10-01', 'library', '资料')]);
  await worker.fetch(req('up', { story: first }), env);
  await worker.fetch(req('up', { story: first, voter: voter.replace(/1$/, '2') }), env);
  const read = async query => worker.fetch(new Request(`https://feedback.example/votes?${query}`, { headers: { Origin: origin } }), env);
  const response = await read(`collection=library&voter=${voter}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: {
    [first]: { up: 2, down: 0, vote: 'up' },
    [second]: { up: 0, down: 0, vote: null },
  } });
  assert.equal((await read(`collection=group-1&voter=${voter}`)).status, 400, 'chat groups are not collections');
  assert.equal((await read('collection=library&voter=nobody')).status, 400);
});
test('library feedback ids depend only on the reviewed id', () => {
  assert.match(libraryFeedbackId('cua-gym'), /^[a-f0-9]{32}$/);
  assert.notEqual(libraryFeedbackId('cua-gym'), libraryFeedbackId('osworld-v2'));
  assert.notEqual(libraryFeedbackId('cua-gym'), feedbackId('library', 'cua-gym', { title: 'cua-gym', text: '' }));
});
