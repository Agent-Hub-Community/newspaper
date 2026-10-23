import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { agentReads, clientCategory } from '../feedback/agent-reads.mjs';
import { contentBase, readingBase, readingLinks, readablePath } from '../lib/agent-reading.mjs';
import worker from '../feedback/worker.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../feedback/schema.sql', import.meta.url), 'utf8'));
  const env = { DB: { prepare: sql => ({ bind: (...values) => ({ run: async () => db.prepare(sql).run(...values) }) }) } };
  const req = (path = 'index.md', options) => new Request(readingBase + path, options);
  const content = async () => new Response('# published content', { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
  return { db, env, req, content };
}

test('reads without Origin return content, count each request, and separate tests and HEAD', async () => {
  const { db, env, req, content } = fixture();
  for (let i = 0; i < 2; i++) {
    const res = await agentReads(req(), env, content);
    assert.equal(await res.text(), '# published content');
    assert.equal(res.headers.get('X-AgentHub-Recorded'), '1');
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  }
  await agentReads(req('index.md?analytics_test=1'), env, content);
  assert.equal(await (await agentReads(req('index.md', { method: 'HEAD' }), env, content)).text(), '');
  const rows = db.prepare('SELECT method, is_test, requests FROM agent_reads ORDER BY method, is_test').all();
  assert.deepEqual(rows.map(r => ({ ...r })), [
    { method: 'GET', is_test: 0, requests: 2 }, { method: 'GET', is_test: 1, requests: 1 },
    { method: 'HEAD', is_test: 0, requests: 1 },
  ]);
  assert.equal((await worker.fetch(new Request(readingBase + 'index.md', { method: 'POST' }), env)).status, 405);
  assert.equal((await worker.fetch(new Request(new URL('/votes', readingBase)), env)).status, 403);
});

test('the worker root and llms.txt path point an agent at the published guide', async () => {
  const { env } = fixture();
  for (const path of ['/', '/llms.txt']) {
    const res = await worker.fetch(new Request(new URL(path, readingBase)), env);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('Content-Type'), /^text\/plain/);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(res.headers.get('Link'), `<${readingBase}llms.txt>; rel="describedby"`);
    const text = await res.text();
    assert.ok(text.includes(readingBase + 'llms.txt') && text.includes('/content/search?q=%E7%A7%91'), 'examples are encoded');
  }
  assert.equal((await worker.fetch(new Request(new URL('/', readingBase), { method: 'POST' }), env)).status, 403);
});

test('reader cannot proxy arbitrary targets or forward caller secrets and cache validators', async () => {
  const { db, env, req } = fixture();
  const forbidden = async () => { throw new Error('must not fetch'); };
  for (const path of ['https://evil.example/a.md', '%2e%2e/private.md', 'data.js', 'feedback/schema.sql', 'index.html', 'daily/2026-10-15/group-x/index.md']) {
    assert.equal((await agentReads(req(path), env, forbidden)).status, 404);
  }
  assert.equal((await agentReads(req('index.md?token=secret'), env, forbidden)).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_reads').get().n, 0);
  await agentReads(req('library/resources.json?analytics_test=1', { headers: {
    Cookie: 'secret=1', Authorization: 'Bearer secret', 'If-None-Match': 'old', Range: 'bytes=0-10',
  } }), env, async (url, options) => {
    assert.equal(url, contentBase + 'library/resources.json');
    assert.deepEqual(options.headers, { 'User-Agent': 'AgentHub-Reader/1.0' });
    assert.equal(options.redirect, 'manual');
    return Response.json({ items: [] });
  });
});

test('404s and upstream failures count separately; DB failure preserves reading and signals missing statistics', async () => {
  const { db, env, req, content } = fixture();
  for (const [upstream, expected] of [[404, 404], [302, 502], [500, 502], [200, 502]]) {
    assert.equal((await agentReads(req(), env, async () => new Response('<html>error</html>', {
      status: upstream, headers: { 'Content-Type': 'text/html' },
    }))).status, expected);
  }
  assert.equal((await agentReads(req(), env, async () => { throw new Error('network'); })).status, 502);
  assert.equal(db.prepare('SELECT SUM(requests) n FROM agent_reads WHERE status=502').get().n, 4);
  const broken = { DB: { prepare() { throw new Error('database unavailable'); } } };
  const res = await agentReads(req(), broken, content);
  assert.equal(res.headers.get('X-AgentHub-Recorded'), '0');
  assert.equal(await res.text(), '# published content');
  env.READ_RATE_LIMITER = { limit: async () => ({ success: false }) };
  assert.equal((await agentReads(req(), env, content)).status, 429);
  assert.equal(db.prepare('SELECT SUM(requests) n FROM agent_reads').get().n, 5);
  assert.deepEqual(db.prepare('SELECT DISTINCT path FROM agent_reads').all().map(row => row.path), ['unavailable-document'],
    'failed reads share one label');
});

test('missing documents share one statistics row, and a stalled write does not hold the response', async t => {
  const { db, env, req } = fixture();
  const missing = async () => new Response('', { status: 404 });
  for (let i = 0; i < 5; i++) await agentReads(req(`agents/topics/daily:2026-10-0${i}:group-1:${'a'.repeat(24)}.md`), env, missing);
  assert.deepEqual(db.prepare('SELECT path, requests FROM agent_reads').all().map(row => ({ ...row })),
    [{ path: 'unavailable-document', requests: 5 }]);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stalled = { DB: { prepare: () => ({ bind: () => ({ run: () => new Promise(() => {}) }) }) } };
  const pending = agentReads(req(), stalled, async () => new Response('# ok', { headers: { 'Content-Type': 'text/markdown' } }));
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(1000);
  const res = await pending;
  assert.equal(await res.text(), '# ok');
  assert.equal(res.headers.get('X-AgentHub-Recorded'), '0');
});

test('client hints discard identifying strings and scheduled retention removes only expired records', async () => {
  const { db, env, req, content } = fixture();
  for (const [ua, expected] of [['ChatGPT-User/1.0', 'openai-declared'], ['Claude-User/1.0', 'anthropic-declared'],
    ['python-httpx/0.28', 'http-tool'], ['Mozilla/5.0', 'browser-like'], ['custom-secret-client', 'unknown']]) {
    assert.equal(clientCategory(ua), expected);
    await agentReads(req('index.md', { headers: { 'User-Agent': ua } }), env, content);
  }
  db.prepare("UPDATE agent_reads SET hour='2000-01-01T00:00:00.000Z' WHERE client='unknown'").run();
  const search = db.prepare(`INSERT INTO api_searches (endpoint, query, filters, result_count, unmatched_terms, client, is_test, created_at)
    VALUES ('content/search', ?, '', 1, '', 'unknown', 0, ?)`);
  search.run('old', '2000-01-01T00:00:00.000Z');
  search.run('recent', new Date().toISOString());
  await worker.scheduled({}, env);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_reads').get().n, 4);
  assert.deepEqual(db.prepare('SELECT query FROM api_searches').all().map(row => row.query), ['recent'],
    'API search records expire after 30 days too');
});

test('published discovery links use the reader while human citations stay on Pages', () => {
  const input = `${contentBase}daily/2026-10-15/external/index.md\n[资料](${contentBase}library/resources.json)\n网页：${contentBase}daily/2026-10-15/external/#topic-1`;
  const output = readingLinks(input);
  assert.ok(output.includes(readingBase + 'daily/2026-10-15/external/index.md'));
  assert.ok(output.includes(readingBase + 'library/resources.json'));
  assert.ok(output.includes(contentBase + 'daily/2026-10-15/external/#topic-1'));
  assert.equal(readingLinks(output), output);
  for (const path of ['llms.txt', 'llms-full.txt', 'agents/SKILL.md', 'library/resources.schema.json',
    'daily/2026-10-15/index.md', 'weekly/2026-10-05/2026-10-11/index.md', 'weekly/2026-09-28_2026-10-04/index.md']) {
    assert.ok(readablePath(path), path);
  }
});

test('topic reads stay allowlisted and a missing date supplies an edition discovery link', async () => {
  const { env, req } = fixture();
  assert.ok(readablePath('agents/topics/d:2026-10-14:group-4:abc123.md'));
  assert.ok(readablePath('search/catalog.json'));
  for (const path of ['agents/topics/../secret.md', 'agents/topics/private/raw.txt', 'search/private.json']) {
    assert.equal(readablePath(path), false);
  }
  const response = await agentReads(req('daily/2026-10-16/index.md'), env,
    async () => new Response('not found', { status: 404 }));
  assert.equal(response.status, 404);
  assert.match(response.headers.get('Link'), /content\/editions/);
  assert.match(await response.text(), /content\/editions/);
});
