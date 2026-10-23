import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../feedback/worker.mjs';
import { origin } from '../site.mjs';

const story = 'b'.repeat(32);
function fixture(limit = () => true) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../feedback/schema.sql', import.meta.url), 'utf8'));
  db.prepare('INSERT INTO stories VALUES (?, ?, ?, ?)').run(story, '2026-10-13', 'group-3', '测试');
  return {
    db,
    env: {
      ALLOWED_ORIGIN: origin,
      RATE_LIMITER: { limit: async () => ({ success: limit() }) },
      DB: { prepare: sql => ({ bind: (...values) => ({
        run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...values).changes) } }),
      }) }) },
    },
  };
}
const open = (id = story, init = {}) => new Request(`https://feedback.example/opens?story=${id}`, {
  method: 'POST', headers: { Origin: origin }, ...init,
});

test('each opening of a registered discussion adds one to that Beijing date', async t => {
  t.after(() => mock.timers.reset());
  // 17:00 UTC on Oct 14 is already Oct 15 in Beijing.
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T17:00:00Z') });
  const { db, env } = fixture();
  for (let i = 0; i < 2; i++) assert.equal((await worker.fetch(open(), env)).status, 204);
  assert.deepEqual({ ...db.prepare('SELECT story_id, day, opens FROM discussion_opens').get() },
    { story_id: story, day: '2026-10-15', opens: 2 });
});

test('openings reject unknown or malformed stories, other methods, other origins and bursts', async () => {
  let allowed = true;
  const { db, env } = fixture(() => allowed);
  assert.equal((await worker.fetch(open('c'.repeat(32)), env)).status, 404);
  assert.equal((await worker.fetch(open('not-a-story'), env)).status, 400);
  assert.equal((await worker.fetch(open(story, { method: 'GET' }), env)).status, 405);
  assert.equal((await worker.fetch(open(story, { headers: { Origin: 'https://evil.example' } }), env)).status, 403);
  const preflight = await worker.fetch(open(story, { method: 'OPTIONS' }), env);
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('Access-Control-Allow-Methods'), /POST/);
  allowed = false;
  assert.equal((await worker.fetch(open(), env)).status, 429);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM discussion_opens').get().n, 0);
});
