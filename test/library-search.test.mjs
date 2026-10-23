import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createLibrarySearch } from '../feedback/library-search.mjs';
import { librarySearchUrl, readingBase, contentBase } from '../agent-reading.mjs';

const data = { coverage: { through: '2026-10-15' }, types: [{ id: 'benchmark' }, { id: 'code' }],
  topics: [{ id: 'computer-use' }, { id: 'training' }], keywords: [{ keyword: 'agent skills', aliases: ['技能'] }], items: [
    { id: 'a', title: '桌面 agent skills', summary: 'Computer use evaluation', type: 'benchmark', topics: ['computer-use'],
      keywords: ['agent skills'], links: [{ kind: 'code', url: 'https://example.org/a' }], shared: [], related: [],
      url: contentBase + 'library/#a', discussions: [{ date: '2026-10-15', group: 'group-2', url: contentBase + 'daily/2026-10-15/group-2/#topic-1' }] },
    { id: 'b', title: 'Computer use benchmark', summary: 'Evaluate desktop agents', type: 'benchmark', topics: ['computer-use'],
      keywords: [], links: [], shared: [], related: [], discussions: [], url: contentBase + 'library/#b' },
    { id: 'c', title: 'agent skills training', summary: 'RL framework', type: 'code', topics: ['training'], keywords: ['agent skills'],
      links: [], shared: [], related: [], discussions: [], url: contentBase + 'library/#c' },
  ] };
function fixture(fetchContent, now) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../feedback/schema.sql', import.meta.url), 'utf8'));
  const env = { DB: { prepare: sql => ({ bind: (...values) => ({ run: async () => db.prepare(sql).run(...values) }) }) } };
  const handler = createLibrarySearch(fetchContent || (async () => Response.json(data)), now);
  const call = (query = '', options) => handler(new Request(librarySearchUrl + query, options), env);
  return { db, env, call };
}

test('public library API combines search and filters, paginates, and supplies discussion reads', async () => {
  const { call, db } = fixture();
  const first = await (await call('?type=benchmark&topic=computer-use&limit=1')).json();
  assert.equal(first.total, 2);
  assert.equal(first.next_offset, 1);
  assert.equal(first.items[0].discussions[0].read_url, readingBase + 'daily/2026-10-15/group-2/index.md');
  const second = await (await call('?type=benchmark&topic=computer-use&limit=1&offset=1')).json();
  assert.equal(second.next_offset, null);
  assert.notEqual(first.items[0].id, second.items[0].id);
  const alias = await (await call('?keyword=' + encodeURIComponent('技能'))).json();
  assert.equal(alias.total, 2);
  const found = await (await call('?q=computer%20use&type=benchmark')).json();
  assert.equal(found.total, 2);
  const none = await (await call('?q=absentunfindable&analytics_test=1')).json();
  assert.equal(none.total, 0);
  assert.deepEqual(none.items, []);
  assert.deepEqual(none.query.unmatched_terms, ['absentunfindable']);
  assert.equal(none.retry_url, null, 'nothing is left to retry');
  assert.match(none.hint, /never uses/);
  assert.equal(found.items[0].relevance, 1);
  assert.equal(db.prepare('SELECT SUM(requests) n FROM agent_reads WHERE is_test=1 AND status=200').get().n, 1);
  assert.equal(db.prepare('SELECT DISTINCT path FROM agent_reads').get().path, 'library/search');
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM agent_reads').all()).includes('absentunfindable'));
});

test('public queries cannot request SQL, unbounded pages or external sources', async () => {
  let calls = 0;
  const { call, env, db } = fixture(async () => { calls++; return Response.json(data); });
  for (const query of ['?sql=SELECT', '?url=https://evil.example', '?limit=21', '?limit=-1', '?offset=1.5', '?q=a&q=b', '?analytics_test=0', '?q=' + 'a'.repeat(121)]) {
    assert.equal((await call(query)).status, 400, query);
  }
  assert.equal((await call('', { method: 'POST' })).status, 405);
  assert.equal((await call('', { method: 'OPTIONS' })).status, 204);
  assert.equal(calls, 0);
  assert.equal((await call('?type=secret')).status, 400);
  env.READ_RATE_LIMITER = { limit: async () => ({ success: false }) };
  const limited = await call();
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, 'rate_limited');
  env.READ_RATE_LIMITER.limit = async () => { throw new Error('limiter down'); };
  assert.equal((await call()).status, 503);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_reads').get().n, 0);
});

test('concurrent cold queries share a load; expiry refreshes and failures have a bounded retry window', async () => {
  let time = 0, loads = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const { call } = fixture(async (url, options) => {
    assert.equal(url, contentBase + 'library/resources.json');
    assert.equal(options.redirect, 'manual');
    loads++;
    await gate;
    if (loads === 2) throw new Error('upstream unavailable');
    return Response.json(loads > 2 ? { ...data, items: data.items.slice(0, 1) } : data);
  }, () => time);
  const requests = [call(), call('?q=desktop')];
  release();
  assert.ok((await Promise.all(requests)).every(r => r.status === 200));
  assert.equal(loads, 1);
  time = 300001;
  const kept = await (await call()).json();
  assert.equal(kept.stale, true, 'a failed refresh keeps serving the previous library');
  assert.equal(kept.total, 3);
  assert.equal((await (await call()).json()).stale, true);
  assert.equal(loads, 2);
  time += 30001;
  assert.equal((await (await call()).json()).total, 1);
  assert.equal(loads, 3);
});

test('public library search shares synonyms and separates content revision from cache load time', async () => {
  let time = 0;
  const source = { ...data, revision: 'content-1', vocabulary: { expand: {}, groups: [['画图', '绘图']] }, items: [
    { ...data.items[0], id: 'drawing', title: '科研绘图工具', summary: '制作论文图表。', keywords: [] },
  ] };
  const { call } = fixture(async () => Response.json(source), () => time);
  const a = await (await call('?q=' + encodeURIComponent('画图'))).json();
  assert.equal(a.total, 1);
  time = 300001;
  const b = await (await call('?q=' + encodeURIComponent('绘图'))).json();
  assert.equal(b.items[0].id, a.items[0].id);
  assert.equal(b.revision, a.revision);
  assert.notEqual(b.source_loaded_at, a.source_loaded_at);
});

test('library pagination pins the content revision and rejects changed snapshots', async () => {
  const revision = '1'.repeat(64);
  const { call } = fixture(async () => Response.json({ ...data, revision }));
  const first = await (await call('?limit=1')).json();
  assert.equal(new URL(first.next_url).searchParams.get('revision'), revision);
  assert.equal((await call('?revision=' + revision)).status, 200);
  const changed = await call('?type=benchmark&offset=1&revision=' + '2'.repeat(64));
  assert.equal(changed.status, 409);
  const conflict = await changed.json();
  assert.equal(conflict.code, 'revision_conflict');
  const restart = new URL(conflict.restart_url);
  assert.equal(restart.searchParams.get('type'), 'benchmark', 'the restart keeps the filters');
  assert.ok(!restart.searchParams.has('revision') && !restart.searchParams.has('offset'));
});

test('library results read as content items, and errors name the parameter to fix', async () => {
  const { call } = fixture();
  const page = await (await call('?type=code')).json();
  assert.equal(page.limit, 5, 'the default page size matches the content API');
  assert.equal(page.items[0].content_id, 'library:c');
  const more = new URL(page.items[0].discussion_search_url);
  assert.equal(more.pathname, '/content/search');
  assert.equal(more.searchParams.get('q'), 'agent skills training', 'unlinked discussions are found by the work name');
  assert.equal(new URL(page.items[0].detail_url).searchParams.get('id'), 'library:c');
  assert.ok(page.available, 'the first page lists the filter values');
  const later = await (await call('?limit=1&offset=1')).json();
  assert.ok(!('available' in later), 'later pages skip the unchanged filter values');
  const type = await (await call('?topic=nope')).json();
  assert.deepEqual([type.code, type.param], ['invalid_parameter', 'topic']);
  assert.ok(type.available.topics.length);
  const keyword = await call('?keyword=' + encodeURIComponent('不存在的关键词'));
  assert.equal(keyword.status, 400, 'an unknown keyword is an error, not an empty list');
  assert.equal((await keyword.json()).param, 'keyword');
  assert.equal((await (await call('?keyword=' + encodeURIComponent('技能'))).json()).total, 2, 'aliases still resolve');
  assert.equal((await call('?limit=')).status, 200, 'an empty value means not given');
  assert.equal((await (await call('?limit=99')).json()).param, 'limit');
});

test('when a library refresh fails, every waiting request gets the previous data', async () => {
  let time = 0, loads = 0;
  const { call } = fixture(async () => { loads++; if (loads > 1) throw new Error('upstream down'); return Response.json(data); }, () => time);
  assert.equal((await call()).status, 200);
  time = 300001;
  const bodies = await Promise.all([1, 2, 3].map(async () => (await call('?q=desktop')).json()));
  assert.ok(bodies.every(body => body.stale === true && body.total >= 1));
  assert.equal(loads, 2);
});
