import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeExternalEditions } from '../lib/external-editions.mjs';

const issue = date => ({ id: date, date, pages: [1, 2, 3].map(i => ({ id: `group-${i}`, stories: [{ title: 'Existing' }] })) });
const report = () => ({
  date: '2026-09-26', title: 'Concrete daily headline', intro: 'Summary',
  stories: [{ title: 'News', timing: 'September 25', text: 'Supported facts', links: [
    { label: '讨论', url: 'https://news.ycombinator.com/item?id=123' },
    { label: '代码', url: 'https://github.com/example/project' },
  ] }], trends: [{ title: 'Observation', text: 'Bounded inference' }],
});
test('adds peer page without changing group copy; retains links with query parameters', () => {
  const original = issue('2026-09-26');
  const result = mergeExternalEditions([original], [report()]);
  assert.equal(original.pages.length, 3);
  assert.deepEqual(result[0].pages.slice(0, 3), original.pages);
  const page = result[0].pages[3];
  assert.equal(page.id, 'external');
  assert.equal(page.heading, report().title);
  assert.equal(page.stories[0].resources[0].url, report().stories[0].links[0].url);
  assert.equal(page.stories[0].resources[1].kind, 'code');
  assert.equal(page.trends.length, 1);
});
test('missing dates stay empty and merging is idempotent', () => {
  const merged = mergeExternalEditions([issue('2026-09-25')], [report()]);
  assert.equal(merged[0].pages[3].stories.length, 0);
  assert.ok(merged[1].pages.slice(0, 3).every(p => p.stories.length === 0));
  assert.deepEqual(mergeExternalEditions(merged, [report()]), merged);
});
test('external merge preserves four-group pages and does not backfill historical group data', () => {
  const old = issue('2026-09-25'), current = issue('2026-09-26');
  current.pages.push({ id: 'group-4', stories: [{ text: 'Fourth group copy' }] });
  const before = structuredClone([old, current]);
  const merged = mergeExternalEditions([old, current], [report()]);
  assert.deepEqual(merged[1].pages.map(page => page.id), ['group-1', 'group-2', 'group-3', 'group-4', 'external']);
  assert.deepEqual(merged[1].pages[3], current.pages[3]);
  assert.equal(merged[0].pages.some(page => page.id === 'group-4'), false);
  assert.deepEqual([old, current], before);
});
test('rejects duplicates, malformed content, unsafe links and credentials', () => {
  assert.throws(() => mergeExternalEditions([], [report(), report()]));
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com']) {
    const invalid = report();
    invalid.stories[0].links[0].url = url;
    assert.throws(() => mergeExternalEditions([], [invalid]));
  }
  assert.throws(() => mergeExternalEditions([], [{ ...report(), title: '' }]));
});
test('preserves exact emphasis without sharing arrays or changing the copy', () => {
  const input = report();
  input.stories[0].text = 'Keep independently verified results separate from product claims.';
  input.stories[0].emphasis = ['verified results'];
  const story = mergeExternalEditions([], [input])[0].pages[3].stories[0];
  assert.equal(story.text, input.stories[0].text);
  assert.deepEqual(story.emphasis, input.stories[0].emphasis);
  assert.notEqual(story.emphasis, input.stories[0].emphasis);
  for (const emphasis of [['invented'], ['verified results', 'verified results'], ['independently verified', 'verified results'], ['Keep independently verified results separate from product claims.']]) {
    assert.throws(() => mergeExternalEditions([], [{
      ...input, stories: [{ ...input.stories[0], emphasis }],
    }]), /emphasis/);
  }
});
test('external AI comments survive mapping and unsafe comments are rejected', () => {
  const input = report();
  input.stories[0].aiComment = 'The preview has a waiting room.';
  const story = mergeExternalEditions([], [input])[0].pages[3].stories[0];
  assert.equal(story.aiComment, input.stories[0].aiComment);
  assert.equal(story.text, input.stories[0].text);
  for (const aiComment of ['', '<b>unsafe</b>', 'line one\nline two', 'x'.repeat(91)]) {
    assert.throws(() => mergeExternalEditions([], [{
      ...input, stories: [{ ...input.stories[0], aiComment }],
    }]), /Invalid comment/);
  }
});
test('external mapping accepts more than two highlights and rejects overlap beyond the first pair', () => {
  const input = report();
  input.stories[0].text = `alpha beta gamma delta ${'.'.repeat(100)}\n\nSecond paragraph has evidence.`;
  input.stories[0].emphasis = ['alpha', 'beta', 'gamma'];
  const story = mergeExternalEditions([], [input])[0].pages[3].stories[0];
  assert.deepEqual(story.emphasis, input.stories[0].emphasis);
  input.stories[0].emphasis = ['alpha', 'beta gamma', 'gamma'];
  assert.throws(() => mergeExternalEditions([], [input]), /Overlapping external emphasis/);
  input.stories[0].emphasis = ['.\n\nSecond'];
  assert.throws(() => mergeExternalEditions([], [input]), /Invalid external emphasis/);
});
