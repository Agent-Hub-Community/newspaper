import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createContentAPI } from '../../feedback/content-api.mjs';
import { agentReads } from '../../feedback/agent-reads.mjs';
import { contentBase, contentAPIBase } from '../../lib/agent-reading.mjs';

const here = new URL('./', import.meta.url);
const dist = new URL('../../dist/', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('search/catalog.json', dist)));
const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } };
globalThis.fetch = async () => { throw new Error('Offline benchmark: network disabled'); };
const fixture = async url => {
  assert.ok(url.startsWith(contentBase));
  const file = url.slice(contentBase.length);
  try { return new Response(await readFile(new URL(file, dist)), {
    headers: { 'Content-Type': file.endsWith('.json') ? 'application/json' : 'text/markdown' },
  }); } catch (error) { if (error.code !== 'ENOENT') throw error; return new Response('Not found', { status: 404 }); }
};
const handler = createContentAPI(fixture, () => 0);
const calls = [];
async function call(url, expectedStatus = 200) {
  const request = new Request(new URL(url, contentAPIBase));
  const response = request.url.includes('/read/') ? await agentReads(request, env, fixture) : await handler(request, env);
  const body = await response.text();
  assert.equal(response.status, expectedStatus, request.url + ': ' + body.slice(0, 200));
  const saved = { url: request.url, status: response.status, bytes: Buffer.byteLength(body), body };
  calls.push(saved);
  return response.headers.get('Content-Type')?.includes('application/json') ? JSON.parse(body) : body;
}
const inventory = catalog.editions.map(({ kind, date, from }) => ({ kind, date, from }));
const date = catalog.latest.daily.date;
const topics = catalog.entries.filter(entry => entry.kind === 'daily' && entry.date === date);
const corpus = topics.map(({ id, group, title, revision }) => ({ id, group, title, revision }));
const metric = () => ({ requests: calls.length, bytes: calls.reduce((sum, call) => sum + call.bytes, 0) });
if (process.argv.includes('--freeze')) {
  const discovery = await call('editions?kind=daily&limit=1');
  const discoveryCost = metric();
  calls.length = 0;
  let url = new URL('search?' + new URLSearchParams({ kind: 'daily', from: date, to: date, limit: '20' }), contentAPIBase);
  const listed = [];
  while (url) { const page = await call(url); listed.push(...page.items); url = page.next_url; }
  assert.deepEqual(listed.map(item => item.id), topics.map(item => item.id));
  const listCost = metric();
  calls.length = 0;
  await call(discovery.latest.daily.read_url);
  const wholeCost = metric();
  const report = { protocol: 1, source_commit: 'e7fa92b64a4bee583017cbc5303bf14f483cb259', date,
    frozen_at: new Date().toISOString(), inventory, corpus,
    catalog_sha256: createHash('sha256').update(await readFile(new URL('search/catalog.json', dist))).digest('hex'),
    discovery: discoveryCost, list: listCost, whole: wholeCost,
    tasks: { browse_all_titles: { requests: discoveryCost.requests + listCost.requests, bytes: discoveryCost.bytes + listCost.bytes },
      read_whole_edition: { requests: discoveryCost.requests + wholeCost.requests, bytes: discoveryCost.bytes + wholeCost.bytes } },
    acceptance: { all_topics: true, group_counts: true, no_body_in_outline: true, max_outline_bytes: 20000,
      selected_titles: ['MAI-Gym', 'OpenGCUA'], max_focused_requests: 3, max_focused_bytes: 24000 } };
  await writeFile(new URL('baseline.json', here), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report.tasks, null, 2));
} else {
  const baseline = JSON.parse(await readFile(new URL('baseline.json', here)));
  assert.equal(JSON.stringify(inventory), JSON.stringify(baseline.inventory), 'edition inventory changed; start a new benchmark');
  assert.equal(JSON.stringify(corpus), JSON.stringify(baseline.corpus), 'topic content changed; start a new benchmark');
  const outline = await call('edition');
  assert.equal(outline.edition.date, baseline.date);
  const listed = outline.groups.flatMap(group => group.topics);
  assert.deepEqual(listed.map(topic => topic.read_url), topics.map(topic => topic.read_url));
  assert.deepEqual(listed.map(topic => topic.title), topics.map(topic => topic.title));
  assert.equal(outline.topic_count, topics.length);
  for (const group of outline.groups) {
    assert.equal(group.topic_count, topics.filter(topic => topic.group === group.id).length);
    for (const topic of group.topics) assert.deepEqual(Object.keys(topic).sort(), ['read_url', 'title']);
  }
  const browseCost = metric();
  assert.ok(browseCost.bytes <= baseline.acceptance.max_outline_bytes);
  const selected = [];
  for (const name of baseline.acceptance.selected_titles) {
    const topic = listed.find(topic => topic.title.includes(name));
    assert.ok(topic, name);
    const markdown = await call(topic.read_url);
    const entry = topics.find(entry => entry.read_url === topic.read_url);
    assert.ok(markdown.includes(entry.url), 'read includes the original citation');
    for (const evidence of name === 'MAI-Gym' ? ['49', '在线 RL'] : ['程序化接口', '评测轨迹']) {
      assert.ok(markdown.includes(evidence), name + ': missing evidence ' + evidence);
    }
    selected.push({ title: topic.title, url: entry.url });
  }
  const focusedCost = metric();
  assert.ok(focusedCost.requests <= baseline.acceptance.max_focused_requests);
  assert.ok(focusedCost.bytes <= baseline.acceptance.max_focused_bytes);
  calls.length = 0;
  const group = outline.groups[0];
  const narrowed = await call(group.outline_url);
  assert.equal(narrowed.edition.date, baseline.date);
  assert.deepEqual(narrowed.groups.map(group => group.id), [group.id]);
  assert.deepEqual(narrowed.groups[0].topics, group.topics);
  const groupCost = metric();
  calls.length = 0;
  const weekly = await call('edition?kind=weekly');
  assert.equal(weekly.edition.date, catalog.latest.weekly.date);
  const weeklyTopics = catalog.entries.filter(entry => entry.kind === 'weekly'
    && entry.date === weekly.edition.date && entry.from === weekly.edition.from);
  assert.deepEqual(weekly.groups.flatMap(group => group.topics.map(topic => topic.read_url)), weeklyTopics.map(topic => topic.read_url));
  const weeklyCost = metric();
  calls.length = 0;
  const missing = await call('edition?date=2099-01-01', 404);
  assert.ok(missing.links.edition);
  const recovered = await call(missing.links.edition);
  assert.equal(recovered.edition.date, baseline.date);
  const recoveryCost = metric();
  const report = { protocol: 1, date, verified_at: new Date().toISOString(), topics: topics.length,
    baseline: baseline.tasks, candidate: { browse_all_titles: browseCost, read_two_selected: focusedCost,
      browse_one_group: groupCost, browse_weekly: weeklyCost, missing_date_recovery: recoveryCost },
    selected, title_coverage: 'all frozen topics with unchanged content versions',
    source_hashes: Object.fromEntries(await Promise.all(['lib/agent-content.mjs', 'feedback/content-api.mjs'].map(async file =>
      [file, createHash('sha256').update(await readFile(new URL('../../' + file, here))).digest('hex')]))),
    passed: true };
  await writeFile(new URL('candidate.json', here), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
