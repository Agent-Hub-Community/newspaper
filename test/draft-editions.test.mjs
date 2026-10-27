import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDraftEditions } from '../lib/draft-editions.mjs';

const issue = date => ({ id: date, date, pages: [1, 2, 3].map(n => ({ id: `group-${n}`, stories: [] })) });
test('batch preview replaces matching dates and preserves untouched editions and papers', () => {
  const old = issue('2026-09-21'), retained = issue('2026-09-18');
  const replacement = issue(old.date);
  replacement.pages.push({ id: 'papers', papers: [{ title: 'Existing paper' }] });
  const result = mergeDraftEditions([old, retained], [issue('2026-09-23'), replacement]);
  assert.deepEqual(result.map(i => i.date), ['2026-09-18', '2026-09-21', '2026-09-23']);
  assert.equal(result[0], retained);
  assert.equal(result[1], replacement);
  assert.equal(old.pages.length, 3);
  assert.deepEqual(mergeDraftEditions([], replacement), [replacement]);
});
test('reject duplicate dates, wrong groups and malformed draft batches', () => {
  assert.throws(() => mergeDraftEditions([], []));
  assert.throws(() => mergeDraftEditions([], [issue('2026-09-21'), issue('2026-09-21')]));
  const invalid = issue('2026-09-21');
  invalid.pages[1].id = 'group-1';
  assert.throws(() => mergeDraftEditions([], invalid));
  assert.throws(() => mergeDraftEditions([], { ...issue('2026-09-21'), id: 'other' }));
});

test('four-group drafts accept an optional papers page without changing historical editions', () => {
  const old = issue('2026-09-29'), original = structuredClone(old);
  const next = issue('2026-09-30');
  next.pages.push({ id: 'group-4', stories: [{ text: '第四群稿件' }] });
  assert.deepEqual(mergeDraftEditions([old], next), [old, next]);
  next.pages.push({ id: 'papers', papers: [] });
  assert.deepEqual(mergeDraftEditions([old], next), [old, next]);
  assert.deepEqual(old, original);
  for (const id of ['group-5', 'group-3', 'external']) {
    const invalid = structuredClone(next);
    invalid.pages[3].id = id;
    assert.throws(() => mergeDraftEditions([], invalid), /Invalid draft/);
  }
  const duplicate = issue('2026-10-01');
  duplicate.pages.push({ id: 'papers', papers: [] }, { id: 'papers', papers: [] });
  assert.throws(() => mergeDraftEditions([], duplicate), /Invalid draft/);
});

test('five-group drafts accept optional populated topical groups and one external or papers page', () => {
  const next = issue('2026-10-21');
  next.pages.push(...[4, 5].map(n => ({ id: `group-${n}`, stories: [] })));
  for (const extra of [{ id: 'external', stories: [] }, { id: 'papers', papers: [] }]) {
    const complete = { ...next, pages: [...next.pages, extra] };
    assert.deepEqual(mergeDraftEditions([], complete), [complete]);
    const early = { ...complete, id: '2026-10-19', date: '2026-10-19' };
    assert.throws(() => mergeDraftEditions([], early), /Invalid draft/);
  }
  const withTopical = {
    ...next,
    pages: [
      ...next.pages,
      { id: 'group-6', stories: [{ title: 'AI Safety 讨论', text: '实质安全话题' }] },
      { id: 'group-8', stories: [{ title: 'AI4S 讨论', text: '实质科学话题' }] },
      { id: 'external', stories: [] },
    ],
  };
  assert.deepEqual(mergeDraftEditions([], withTopical), [withTopical]);
  const emptyTopical = {
    ...next,
    pages: [...next.pages, { id: 'group-7', stories: [] }],
  };
  assert.throws(() => mergeDraftEditions([], emptyTopical), /Invalid draft/);
  const missingFourth = structuredClone(next);
  missingFourth.pages.splice(3, 1);
  assert.throws(() => mergeDraftEditions([], missingFourth), /Invalid draft/);
  const malformedExternal = { ...next, pages: [...next.pages, { id: 'external', papers: [] }] };
  assert.throws(() => mergeDraftEditions([], malformedExternal), /Invalid draft/);
});
