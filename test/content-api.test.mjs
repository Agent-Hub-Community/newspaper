import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContentAPI } from '../feedback/content-api.mjs';
import { contentBase, readingBase } from '../agent-reading.mjs';

const base = new URL('/content/', readingBase).href;
const revision = 'a'.repeat(64);
const entry = (id, kind, date, title, text) => ({ id, kind, date, title, text, keywords: [],
  group: 'group-1', url: contentBase + `daily/${date}/group-1/#topic-1`,
  read_url: readingBase + `agents/topics/${id}.md`, revision: 'b'.repeat(64) });
const section = (group, kind, date, extras = {}) => ({ group, label: group === 'external' ? '外部资讯' : '一群',
  title: '科研与工具进展', summary: '先浏览话题，再选择正文。',
  url: contentBase + `${kind}/${date}/${group}/`,
  ...(kind === 'daily' ? { read_url: readingBase + `daily/${date}/${group}/index.md` } : {}),
  trend_count: 0, ...extras });
const edition = (kind, date, sections, extras = {}) => ({ kind, date, groups: sections.map(item => item.group),
  url: contentBase + `${kind}/${date}/`, read_url: readingBase + `${kind}/${date}/index.md`, sections, ...extras });
const latestDaily = edition('daily', '2026-10-14', [section('group-1', 'daily', '2026-10-14'),
  section('external', 'daily', '2026-10-14', { label: '外部资讯', title: '外部工作', trend_count: 2 })]);
const latestWeekly = edition('weekly', '2026-10-11', [section('group-1', 'weekly', '2026-10-11')], { from: '2026-10-05' });
const catalog = { schema_version: 1, revision, vocabulary: { expand: {}, groups: [] },
  entries: [entry('daily:one', 'daily', '2026-10-14', 'Research question selection', 'Choose a falsifiable hypothesis.'),
    entry('weekly:two', 'weekly', '2026-10-11', 'Research experiment design', 'Compare against a fixed baseline.'),
    entry('library:three', 'library', '2026-10-10', 'Drawing tools', 'Export editable SVG.')],
  editions: [latestWeekly, latestDaily], latest: { daily: latestDaily, weekly: latestWeekly } };
catalog.entries[1].from = '2026-10-05';
delete catalog.entries[2].group;
catalog.entries[2].shared = [{ group: 'group-2', date: '2026-10-02' }, { group: 'group-1', date: '2026-10-10' }];

function fixture(fetchContent = async () => Response.json(catalog), now) {
  const recorded = [];
  const env = { DB: { prepare: () => ({ bind: (...args) => ({ run: async () => { recorded.push(args); } }) }) } };
  const handler = createContentAPI(fetchContent, now);
  const call = (path, options) => handler(new Request(base + path, options), env);
  return { call, recorded, env };
}

test('a reader searches, follows an exact result, and paginates within a revision', async () => {
  const { call, recorded } = fixture();
  const first = await (await call('search?q=research&limit=1&analytics_test=1')).json();
  assert.equal(first.total, 2);
  assert.equal(first.revision, revision);
  assert.equal(first.items.length, 1);
  assert.ok(first.items[0].read_url);
  assert.ok(!('text' in first.items[0]), 'search results do not send full topic bodies');
  const second = await (await call('search?q=research&limit=1&offset=1&revision=' + revision)).json();
  assert.notEqual(first.items[0].id, second.items[0].id);
  const detail = await (await call('item?id=' + encodeURIComponent(first.items[0].id))).json();
  assert.ok(detail.item.text);
  assert.equal(detail.item.id, first.items[0].id);
  const stale = await call('search?revision=' + 'c'.repeat(64));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).revision, revision);
  const searches = recorded.filter(args => args.length === 8);
  assert.equal(searches.length, 1, 'only the first page of a search is recorded, not the next page or exact reads');
  assert.deepEqual(searches[0].slice(0, 4), ['content/search', 'research', '', 2]);
  assert.equal(searches[0][6], 1, 'a test-marked search stays separate');
  assert.ok(recorded.filter(args => args.length !== 8).every(args => !JSON.stringify(args).includes('research')),
    'hourly read counts still never carry the query');
});

test('reader API searches are kept in D1 with redaction, unmatched words and no client identity', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync } = await import('node:fs');
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../feedback/schema.sql', import.meta.url), 'utf8'));
  const env = { DB: { prepare: sql => ({ bind: (...values) => ({ run: async () => db.prepare(sql).run(...values) }) }) } };
  const handler = createContentAPI(async () => Response.json(catalog));
  const call = (path, headers = {}) => handler(new Request(base + path, { headers }), env);
  await call('search?q=' + encodeURIComponent('zzunknownzz research') + '&kind=daily', { 'User-Agent': 'curl/8', 'CF-Connecting-IP': '203.0.113.9' });
  await call('search?q=' + encodeURIComponent('联系 someone@example.com'));
  await call('search?kind=weekly');
  await call('search');
  const rows = db.prepare('SELECT endpoint, query, filters, result_count, unmatched_terms, client, is_test FROM api_searches ORDER BY id').all();
  assert.deepEqual(rows.map(row => ({ ...row })), [
    { endpoint: 'content/search', query: 'zzunknownzz research', filters: 'kind=daily', result_count: 0,
      unmatched_terms: 'zzunknownzz', client: 'http-tool', is_test: 0 },
    { endpoint: 'content/search', query: '[已隐藏敏感内容]', filters: '', result_count: 0, unmatched_terms: '', client: 'unknown', is_test: 0 },
    { endpoint: 'content/search', query: '', filters: 'kind=weekly', result_count: 1, unmatched_terms: '', client: 'unknown', is_test: 0 },
  ], 'a bare listing with no query or filter is not a search');
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM api_searches').all()).includes('203.0.113.9'));
});

test('date filters overlap weekly periods and missing content gives a recovery route', async () => {
  const { call } = fixture();
  const weekly = await (await call('search?kind=weekly&from=2026-10-07&to=2026-10-08')).json();
  assert.equal(weekly.total, 1);
  const empty = await (await call('search?q=zzabsentzz')).json();
  assert.equal(empty.total, 0);
  assert.ok(empty.links.editions);
  const editions = await (await call('editions?kind=daily')).json();
  assert.equal(editions.latest.daily.date, '2026-10-14');
  assert.ok(editions.items[0].read_url);
  const missing = await call('item?id=missing');
  assert.equal(missing.status, 404);
  assert.ok((await missing.json()).links.search);
});

test('a resource group and date range must match the same share', async () => {
  const { call } = fixture();
  const found = await (await call('search?kind=library&group=group-2&from=2026-10-01&to=2026-10-03')).json();
  assert.equal(found.total, 1);
  assert.equal(found.items[0].date, '2026-10-02');
  assert.deepEqual(found.items[0].matched_shared, [{ group: 'group-2', date: '2026-10-02' }]);
  const wrongDate = await (await call('search?kind=library&group=group-2&from=2026-10-09')).json();
  assert.equal(wrongDate.total, 0, 'a later share in group-1 cannot satisfy group-2 time filters');
});

test('a kind filter keeps library matches that trail a stronger daily match', async () => {
  // Without the filter the daily item outranks the library item by far and the relative cut drops it.
  // A third, unrelated item keeps the query words from appearing in every document, where IDF would be zero.
  const filler = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
  const entries = [entry('daily:strong', 'daily', '2026-10-14', 'Coding agent harness review',
    'coding agent harness comparison coding agent harness'),
  entry('library:weak', 'library', '2026-10-10', 'Notes', `mentions a coding agent harness once ${filler}`),
  entry('daily:other', 'daily', '2026-10-13', 'Drawing tools', 'Export editable SVG.')];
  delete entries[1].group;
  const { call } = fixture(async () => Response.json({ ...catalog, entries }));
  assert.deepEqual((await (await call('search?q=coding%20agent%20harness')).json()).items.map(item => item.id), ['daily:strong']);
  const filtered = await (await call('search?q=coding%20agent%20harness&kind=library')).json();
  assert.deepEqual(filtered.items.map(item => item.id), ['library:weak']);
});

test('a search reports how it read the query and explains a zero result', async () => {
  const { call } = fixture();
  const found = await (await call('search?q=research')).json();
  assert.ok(found.items.every(item => item.relevance > 0 && item.relevance <= 1));
  assert.equal(found.items[0].relevance, 1);
  assert.deepEqual(found.query.dropped_terms, []);
  assert.ok(!('hint' in found));
  const partly = await (await call('search?q=' + encodeURIComponent('zzunknownzz research'))).json();
  assert.equal(partly.total, 0, 'an unknown word that outweighs the rest still refuses the query');
  assert.deepEqual(partly.query.unmatched_terms, ['zzunknownzz']);
  assert.match(partly.hint, /never uses: zzunknownzz/);
  assert.match(partly.hint, /do not prove the group never discussed it/);
  assert.equal(partly.retry_url, null, 'no retry that drops a rare word the search itself refused to drop');
});

test('a version the site never wrote names the versions it has and offers the family search', async () => {
  const entries = [...catalog.entries, { ...entry('daily:gpt', 'daily', '2026-10-14', 'GPT-6.1 release', 'GPT-6.1 and GPT-5.5 compared.') }];
  const { call } = fixture(async () => Response.json({ ...catalog, entries }));
  const body = await (await call('search?q=' + encodeURIComponent('GPT-7 release'))).json();
  assert.equal(body.total, 0);
  assert.deepEqual(body.query.missing_versions, ['gpt-7']);
  assert.deepEqual(body.query.known_versions, { gpt: ['6.1', '5.5'] });
  assert.equal(new URL(body.retry_url).searchParams.get('q'), 'gpt release');
  assert.equal((await (await call('search?q=' + encodeURIComponent('GPT-6.1'))).json()).total, 1);
  assert.ok((await (await call('search?q=' + encodeURIComponent('ICLR 2026 research'))).json()).query.missing_versions?.length !== 1,
    'a year is a date, not a version');
});

test('a reader gets the latest outline and follows a topic without sending bodies', async () => {
  const data = structuredClone(catalog);
  data.entries.push({ ...entry('daily:four', 'daily', '2026-10-14', 'A later source-order title', 'PRIVATE-BODY'),
    keywords: ['PRIVATE-KEYWORD'], ai_comment: 'PRIVATE-COMMENT', speakers: ['PRIVATE-SPEAKER'] });
  data.latest.daily.sections[0].summary = '🙂'.repeat(180);
  data.latest.daily.private_note = 'PRIVATE-EDITION';
  const { call, recorded } = fixture(async () => Response.json(data));
  const response = await call('edition?analytics_test=1');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(response.headers.get('X-AgentHub-Recorded'), '1');
  const outline = await response.json();
  assert.equal(outline.revision, revision);
  assert.equal(outline.edition.date, '2026-10-14');
  assert.equal(outline.topic_count, 2);
  assert.equal(outline.groups.length, 2);
  assert.equal([...outline.groups[0].summary].length, 160, 'summaries are bounded by Unicode characters');
  assert.deepEqual(outline.groups[0].topics.map(item => item.title), ['Research question selection', 'A later source-order title']);
  assert.deepEqual(Object.keys(outline.groups[0].topics[0]), ['title', 'read_url']);
  assert.equal(outline.groups[1].topic_count, 0);
  assert.equal(outline.groups[1].trend_count, 2, 'a readable trends-only group is still discoverable');
  assert.equal(outline.groups[1].read_url, readingBase + 'daily/2026-10-14/external/index.md');
  assert.ok(!JSON.stringify(outline).includes('PRIVATE'), 'outline selects public navigation and metadata only');
  const selected = await (await call('edition?date=2026-10-14&group=group-1')).json();
  assert.equal(selected.topic_count, 2);
  assert.equal(selected.groups.length, 1);
  assert.equal(selected.groups[0].outline_url, base + 'edition?kind=daily&date=2026-10-14&group=group-1&revision=' + revision);
  assert.equal(selected.edition.outline_url, base + 'edition?kind=daily&date=2026-10-14&revision=' + revision);
  assert.ok(recorded.every(args => args[1] === 'content/edition'));
  assert.ok(recorded.every(args => !JSON.stringify(args).includes('2026-10-14')));
});

test('weekly outlines isolate the exact period and never invent group Markdown', async () => {
  const data = structuredClone(catalog);
  data.entries.push(entry('daily:same-end', 'daily', '2026-10-11', 'Daily on weekly end date', 'daily'));
  data.entries.push({ ...entry('weekly:other-start', 'weekly', '2026-10-11', 'Different weekly period', 'other'), from: '2026-10-01' });
  data.latest.weekly.sections[0].read_url = readingBase + 'DOES-NOT-EXIST.md';
  const { call } = fixture(async () => Response.json(data));
  const outline = await (await call('edition?kind=weekly&date=latest')).json();
  assert.equal(outline.edition.kind, 'weekly');
  assert.equal(outline.edition.from, '2026-10-05');
  assert.equal(outline.topic_count, 1);
  assert.deepEqual(outline.groups[0].topics.map(item => item.title), ['Research experiment design']);
  assert.ok(!('read_url' in outline.groups[0]), 'weekly whole issue is readable, group documents are not');
  assert.ok(outline.edition.read_url);
});

test('edition list and latest objects stay compact when the source includes full sections', async () => {
  const { call } = fixture();
  const list = await (await call('editions?limit=20')).json();
  assert.ok(list.items.every(item => item.outline_url));
  assert.ok(list.items.every(item => !('sections' in item)));
  assert.ok(!('sections' in list.latest.daily));
  assert.ok(!('sections' in list.latest.weekly));
  assert.equal(list.latest.daily.outline_url, base + 'edition?kind=daily&date=2026-10-14&revision=' + revision);
});

test('missing edition or group returns recovery links without choosing an older edition', async () => {
  const data = structuredClone(catalog);
  data.editions.push(edition('daily', '2026-10-13', [section('group-2', 'daily', '2026-10-13')]));
  const { call } = fixture(async () => Response.json(data));
  for (const path of ['edition?date=2026-10-12', 'edition?group=group-2', 'edition?kind=weekly&group=external']) {
    const response = await call(path);
    assert.equal(response.status, 404, path);
    const missing = await response.json();
    assert.equal(missing.code, 'not_found');
    assert.equal(missing.links.editions, base + 'editions');
    assert.ok(!('latest_daily' in missing.links));
    const recovery = new URL(missing.recovery_url);
    assert.equal(recovery.pathname, '/content/edition');
    assert.ok(!recovery.searchParams.has('group'));
    if (missing.edition) {
      assert.notEqual(missing.edition.date, '2026-10-13');
      assert.equal(recovery.searchParams.get('date'), missing.edition.date);
      assert.equal(recovery.searchParams.get('revision'), revision);
    } else assert.equal(recovery.searchParams.get('date'), 'latest');
  }
  const none = structuredClone(catalog);
  none.latest.weekly = null;
  const absent = fixture(async () => Response.json(none));
  assert.equal((await absent.call('edition?kind=weekly')).status, 404);
});

test('old catalogs remain searchable but cannot pretend to contain edition outlines', async () => {
  const old = structuredClone(catalog);
  old.editions.forEach(item => delete item.sections);
  delete old.latest.daily.sections;
  delete old.latest.weekly.sections;
  const { call } = fixture(async () => Response.json(old));
  const response = await call('edition');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), '30');
  assert.equal((await response.json()).code, 'edition_outline_unavailable');
  assert.equal((await call('search?q=research')).status, 200);
  assert.equal((await call('editions')).status, 200);
});

test('invalid section metadata fails clearly rather than synthesizing an overview', async () => {
  for (const modify of [data => delete data.latest.daily.sections[0].title,
    data => data.latest.daily.sections.push(data.latest.daily.sections[0]),
    data => data.latest.daily.sections[0].trend_count = -1,
    data => delete data.latest.weekly.from]) {
    const data = structuredClone(catalog);
    modify(data);
    const { call } = fixture(async () => Response.json(data));
    const response = await call('edition?kind=' + (data.latest.weekly.from ? 'daily' : 'weekly'));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'edition_outline_unavailable');
  }
});

test('directory and exact reads share the catalog and lazily initialize the search index once', async () => {
  const original = globalThis.AgentHubQuery.createSearcher;
  let builds = 0, loads = 0;
  globalThis.AgentHubQuery.createSearcher = (...args) => { builds++; return original(...args); };
  try {
    const { call, env } = fixture(async () => { loads++; return Response.json(catalog); }, () => 0);
    await Promise.all([call('edition'), call('item?id=daily:one'), call('editions'), call('search')]);
    assert.equal(loads, 1);
    assert.equal(builds, 0, 'browsing or a queryless list needs no BM25 index');
    await Promise.all([call('search?q=research'), call('search?q=drawing')]);
    assert.equal(loads, 1);
    assert.equal(builds, 1, 'two searches reuse the cached index');
    const conflict = await call('edition?revision=' + 'c'.repeat(64));
    assert.equal(conflict.status, 409);
    const body = await conflict.json();
    assert.equal(body.revision, revision);
    assert.equal(body.source_loaded_at, '1970-01-01T00:00:00.000Z');
    assert.equal(body.error, 'Content changed; reload the edition outline');
    env.READ_RATE_LIMITER = { limit: async () => ({ success: false }) };
    assert.equal((await call('edition')).status, 429);
    assert.equal(loads, 1);
  } finally { globalThis.AgentHubQuery.createSearcher = original; }
});

test('an empty parameter means the parameter was not given, on every route', async () => {
  const { call } = fixture();
  for (const path of ['edition?date=', 'edition?kind=', 'edition?group=', 'edition?revision=', 'search?limit=', 'search?kind=&q=research']) {
    assert.equal((await call(path)).status, 200, path);
  }
  assert.equal((await (await call('search?limit=')).json()).limit, 5);
});

test('invalid queries never fetch; limiter and failure recovery stay bounded', async () => {
  let loads = 0, time = 0;
  const { call, env } = fixture(async (url, options) => {
    assert.equal(url, contentBase + 'search/catalog.json');
    assert.equal(options.redirect, 'manual');
    loads++;
    return loads === 2 ? Response.json({ entries: null }) : Response.json(catalog);
  }, () => time);
  for (const path of ['search?sql=SELECT', 'search?kind=private', 'search?q=a&q=b', 'search?limit=21',
    'search?from=2026-02-30', 'search?from=2026-10-15&to=2026-10-01', 'item', 'item?id=x&id=y',
    'editions?q=research', 'search?analytics_test=0', 'search?revision=bad',
    'edition?date=2026-02-30', 'edition?kind=library',
    'edition?group=group-x', 'edition?date=latest&date=latest', 'edition?limit=5',
    'edition?from=2026-10-01', 'edition?analytics_test=0']) {
    const res = await call(path);
    assert.equal(res.status, 400, path);
    const body = await res.json();
    assert.equal(body.code, 'invalid_parameter', path);
    assert.ok(body.param, `${path} names the parameter`);
  }
  assert.equal((await (await call('search?limit=21')).json()).param, 'limit');
  assert.match((await (await call('search?type=benchmark')).json()).hint, /library\/search/);
  assert.equal(loads, 0);
  assert.equal((await call('search', { method: 'POST' })).status, 405);
  assert.equal((await call('search', { method: 'OPTIONS' })).status, 204);
  await Promise.all([call('search'), call('editions')]);
  assert.equal(loads, 1);
  time = 300001;
  const kept = await call('search');
  assert.equal(kept.status, 200, 'a failed refresh keeps serving the previous catalog');
  assert.equal((await kept.json()).stale, true);
  assert.equal((await (await call('search')).json()).stale, true, 'no second refresh inside the retry window');
  assert.equal(loads, 2);
  time += 30001;
  const fresh = await (await call('search')).json();
  assert.ok(!('stale' in fresh));
  env.READ_RATE_LIMITER = { limit: async () => ({ success: false }) };
  const limited = await call('search');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '60');
  assert.equal((await limited.json()).code, 'rate_limited', 'a JSON endpoint answers its limit in JSON');
});

test('a new group is served from the catalog without a worker change', async () => {
  const daily = { ...latestDaily, groups: [...latestDaily.groups, 'group-5'],
    sections: [...latestDaily.sections, section('group-5', 'daily', '2026-10-14', { label: '五群' })] };
  const fifth = { ...entry('daily:five', 'daily', '2026-10-14', 'Fifth group topic', 'A new group.'), group: 'group-5' };
  const { call } = fixture(async () => Response.json({ ...catalog, entries: [...catalog.entries, fifth],
    editions: [latestWeekly, daily], latest: { daily, weekly: latestWeekly } }));
  assert.equal((await call('edition')).status, 200, 'one new section does not take the outline down');
  const outline = await (await call('edition?group=group-5')).json();
  assert.deepEqual(outline.groups[0].topics.map(topic => topic.title), ['Fifth group topic']);
  assert.equal((await (await call('search?group=group-5')).json()).total, 1);
  assert.equal((await call('edition?group=group-6')).status, 404, 'a well-formed group the catalog lacks is missing, not invalid');
});

test('an edition observation is searchable but is not listed as a topic', async () => {
  const trend = { ...entry('daily:2026-10-14:external:trend-' + 'd'.repeat(24), 'daily', '2026-10-14', 'Verification bottleneck',
    'Human review cannot keep up with agent output.'), group: 'external', trend: true };
  const { call } = fixture(async () => Response.json({ ...catalog, entries: [...catalog.entries, trend] }));
  const found = await (await call('search?q=' + encodeURIComponent('review agent output'))).json();
  assert.equal(found.items[0].id, trend.id);
  assert.equal(found.items[0].trend, true);
  assert.ok(found.coverage.indexed.includes('edition_trends'));
  const outline = await (await call('edition?group=external')).json();
  assert.deepEqual(outline.groups[0].topics, [], 'observations stay out of the topic outline');
  assert.equal(outline.groups[0].trend_count, 2);
});

test('a missing edition points at the issues around it, and a weekly found by its first day', async () => {
  const { call } = fixture();
  const gap = await (await call('edition?date=2026-10-12')).json();
  assert.equal(gap.nearest.after.date, '2026-10-14');
  assert.equal(gap.nearest.before, undefined, 'no daily issue precedes it in the fixture');
  const weekly = await (await call('edition?kind=weekly&date=2026-10-05')).json();
  assert.match(weekly.error, /last day/);
  assert.equal(new URL(weekly.recovery_url).searchParams.get('date'), '2026-10-11');
});

test('a search states today in Beijing and the period each kind covers', async () => {
  // 2026-10-17T20:00Z is already 2026-10-18 in Beijing.
  const { call } = fixture(undefined, () => Date.parse('2026-10-17T20:00:00Z'));
  const found = await (await call('search?q=research')).json();
  assert.equal(found.today, '2026-10-18');
  assert.deepEqual(found.coverage.daily, { from: '2026-10-14', to: '2026-10-14' });
  assert.deepEqual(found.coverage.weekly, { from: '2026-10-05', to: '2026-10-11' });
  const before = await (await call('search?from=2026-01-01&to=2026-01-31')).json();
  assert.equal(before.total, 0);
  assert.match(before.coverage.note, /outside every published period/);
  assert.ok(!('note' in found.coverage));
});

test('when a refresh fails, every waiting request gets the previous catalog and the index is built once', async () => {
  let time = 0, loads = 0, builds = 0;
  const original = globalThis.AgentHubQuery.createSearcher;
  globalThis.AgentHubQuery.createSearcher = (...args) => { builds++; return original(...args); };
  try {
    const { call } = fixture(async () => { loads++; if (loads > 1) throw new Error('upstream down'); return Response.json(catalog); }, () => time);
    assert.equal((await call('edition')).status, 200);
    time = 300001;
    const responses = await Promise.all([1, 2, 3, 4].map(() => call('search?q=research')));
    assert.deepEqual(responses.map(response => response.status), [200, 200, 200, 200]);
    assert.ok((await Promise.all(responses.map(response => response.json()))).every(body => body.stale === true));
    await call('search?q=research'); await call('search?q=design');
    assert.equal(loads, 2, 'one refresh attempt for the concurrent requests');
    assert.equal(builds, 1, 'stale searches reuse one index');
  } finally { globalThis.AgentHubQuery.createSearcher = original; }
});

test('a broken or stalled statistics write never holds or breaks a search', async t => {
  const broken = createContentAPI(async () => Response.json(catalog));
  const env = { DB: { prepare() { throw new Error('database unavailable'); } } };
  const res = await broken(new Request(base + 'search?q=research'), env);
  assert.equal(res.status, 200, 'a synchronous D1 failure does not turn the search into 503');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stalled = { DB: { prepare: () => ({ bind: () => ({ run: () => new Promise(() => {}) }) }) } };
  const pending = createContentAPI(async () => Response.json(catalog))(new Request(base + 'search?q=research'), stalled);
  for (let i = 0; i < 5; i++) { await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(1000); }
  assert.equal((await pending).status, 200);
});

test('library coverage starts at the first share, not the latest', async () => {
  const library = { ...catalog.entries[2], date: '2026-10-10', shared: [{ group: 'group-1', date: '2026-04-30' }, { group: 'group-1', date: '2026-10-10' }] };
  const { call } = fixture(async () => Response.json({ ...catalog, entries: [catalog.entries[0], catalog.entries[1], library] }));
  const body = await (await call('search?kind=library&from=2026-04-01&to=2026-04-30')).json();
  assert.equal(body.coverage.library.from, '2026-04-30');
  assert.equal(body.total, 1);
  assert.ok(!('note' in body.coverage), 'no claim that the range is outside coverage when it returned a share');
});

test('an exact read accepts a bare library id and an old revision points at the current entry', async () => {
  const { call } = fixture();
  assert.equal((await (await call('item?id=three')).json()).item.id, 'library:three');
  const stale = await call('item?id=daily:one&revision=' + 'c'.repeat(64));
  assert.equal(stale.status, 409);
  const restart = new URL((await stale.json()).restart_url);
  assert.equal(restart.searchParams.get('id'), 'daily:one');
  assert.ok(!restart.searchParams.has('revision'));
  assert.equal((await call(restart.pathname.slice('/content/'.length) + restart.search)).status, 200);
});
