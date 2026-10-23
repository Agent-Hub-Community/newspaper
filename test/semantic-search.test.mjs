import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContentAPI } from '../feedback/content-api.mjs';
import { readingBase } from '../agent-reading.mjs';
import { site } from '../site.mjs';
import { SEMANTIC_DIMENSIONS, SEMANTIC_MODEL, embeddingText, packVectors, quantize, textHash } from '../semantic.mjs';

const base = new URL('/content/', readingBase).href;
// Unit vectors along one axis each; the query vector chooses which entry is semantically closest.
const axis = k => Array.from({ length: SEMANTIC_DIMENSIONS }, (_, j) => (j === k ? 1 : 0));
const entry = (id, title, text) => ({ id, kind: 'daily', date: '2026-10-14', group: 'group-1', title, text, keywords: [],
  url: `${site}daily/2026-10-14/group-1/#${id}`, read_url: `${readingBase}agents/topics/${id}.md`, revision: 'b'.repeat(64) });
const entries = [entry('daily:words', 'Reward model notes', 'reward model training with Reward 5'), entry('daily:meaning', '奖励设计', '强化学习中的奖励塑形'),
  entry('daily:other', 'Drawing tools', 'Export editable SVG.')];
const catalog = { schema_version: 1, revision: 'a'.repeat(64), vocabulary: { expand: {}, groups: [] }, entries,
  editions: [], latest: { daily: null, weekly: null } };
const stored = { schema_version: 1, model: SEMANTIC_MODEL, dimensions: SEMANTIC_DIMENSIONS,
  vectors: Object.fromEntries(entries.map((e, k) => [e.id, { hash: textHash(embeddingText(e)), ...quantize(axis(k)) }])) };
const { meta, bin } = packVectors(entries, stored);
const db = { prepare: () => ({ bind: () => ({ run: async () => {} }) }) };
function fixture({ vectors = true } = {}) {
  const fetched = [];
  const api = createContentAPI(async url => {
    fetched.push(url);
    if (url.endsWith('search/catalog.json')) return Response.json(catalog);
    if (vectors && url.endsWith('search/vectors.json')) return Response.json(meta);
    if (vectors && url.endsWith('search/vectors.bin')) return new Response(bin);
    return new Response('', { status: 404 });
  });
  return { fetched, call: (q, env) => api(new Request(`${base}search?${new URLSearchParams({ q })}`), { DB: db, ...env }) };
}

test('with Workers AI the search adds a meaning match and labels how each result matched', async () => {
  const sent = [];
  const AI = { run: async (model, input) => { sent.push([model, input]); return { data: [[0, 0.7, 0.71, ...axis(0).slice(3)].map((x, j) => (j === 1 ? 1 : 0))] }; } };
  const { call } = fixture();
  const body = await (await call('reward model', { AI })).json();
  assert.equal(body.query.semantic, 'used');
  assert.deepEqual(body.items.map(item => [item.id, item.matched_by]).sort(), [['daily:meaning', 'meaning'], ['daily:words', 'words']]);
  assert.equal(sent[0][0], SEMANTIC_MODEL);
  assert.match(sent[0][1].text[0], /^Instruct: .+\nQuery: reward model$/);
});

test('a failed or missing embedding falls back to BM25 and says so', async () => {
  const { call } = fixture();
  const failed = await (await call('reward model', { AI: { run: async () => { throw new Error('daily allocation used up'); } } })).json();
  assert.equal(failed.query.semantic, 'unavailable');
  assert.deepEqual(failed.items.map(item => item.id), ['daily:words']);
  assert.ok(!('matched_by' in failed.items[0]));
  const noVectors = fixture({ vectors: false });
  assert.equal((await (await noVectors.call('reward model', { AI: { run: async () => ({ data: [axis(1)] }) } })).json()).query.semantic, 'unavailable');
  const lexical = await (await fixture().call('reward model', {})).json();
  assert.ok(!('semantic' in lexical.query), 'without the binding the search is lexical as before');
});

test('a name with a version the site never wrote is not sent to the model', async () => {
  let calls = 0;
  const { call } = fixture();
  // The guard needs the name itself to occur on the site, so this catalog gets a Reward 5 entry.
  const body = await (await call('Reward 9', { AI: { run: async () => { calls++; return { data: [axis(1)] }; } } })).json();
  assert.equal(body.query.semantic, 'skipped');
  assert.equal(body.total, 0);
  assert.equal(calls, 0);
});

test('vectors whose text changed are left out of the packed file', () => {
  const edited = entries.map(e => (e.id === 'daily:other' ? { ...e, text: 'Changed text.' } : e));
  const packed = packVectors(edited, stored);
  assert.deepEqual(packed.meta.ids, ['daily:words', 'daily:meaning']);
  assert.equal(packed.meta.missing, 1);
  assert.equal(packed.bin.length, 2 * SEMANTIC_DIMENSIONS);
});
