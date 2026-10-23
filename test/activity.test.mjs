import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, deduplicate, summarize, startOf, dayOf } from '../activity.mjs';

const row = (sender, type, timestamp, server, extra = {}) => ({
  sender, type, timestamp, server, group: 'one', content: '分享', ...extra,
});
test('media counts equally; emoji, pats and systems do not count', () => {
  for (const type of [1, 3, 34, 43, 62, 5 * 4294967296 + 49, 57 * 4294967296 + 49])
    assert.equal(classify(row('alice', type)), 'counted');
  assert.equal(classify(row('', 62 * 4294967296 + 49)), 'system');
  assert.equal(classify(row('alice', 62 * 4294967296 + 49)), 'system');
  assert.equal(classify(row('alice', 10000)), 'system');
  assert.equal(classify(row('alice', 47)), 'other');
  assert.equal(classify(row('', 1)), 'unresolved');
});
test('stable identity, ties, exclusive boundaries and media breakdown', () => {
  const start = startOf('2026-09-21');
  const data = [row('a', 1, start, '1'), row('a', 3, start + 1, '2'),
    row('b', 34, start + 2, '3'), row('b', 1, start + 3, '4'),
    row('c', 1, start + 86400, '5'), row('a', 47, start + 4, '6')];
  const s = summarize(data, start, start + 86400);
  assert.equal(s.raw, 5);
  assert.equal(s.counted, 4);
  assert.equal(s.media, 2);
  assert.equal(s.participants, 2);
  assert.deepEqual(s.leaders.map(l => [l.rank, l.count, l.media, l.activeDays]), [[1, 2, 1, 1], [1, 2, 1, 1]]);
  assert.equal(dayOf(start), '2026-09-21');
  assert.equal(dayOf(start - 1), '2026-09-20');
});
test('64-bit server IDs deduplicate across shards without collapsing distinct messages', () => {
  const a = row('a', 1, 0, '6691791431834355264', { shard: 'first', local: 1 });
  const b = { ...a, shard: 'second', local: 5 };
  const c = { ...a, server: '6691791431834355265' };
  assert.equal(deduplicate([a, b, c]).length, 2);
  assert.equal(deduplicate([a, { ...a, group: 'two' }]).length, 2);
});
