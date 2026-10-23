import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalWindow, readerReport, validateSelection, validateExternalDraft, validateExternalReview } from '../lib/external-workflow.mjs';
import { mergeExternalEditions } from '../lib/external-editions.mjs';

const selection = () => ({
  ...externalWindow('2026-09-26', '2026-09-26T19:00:00Z'),
  candidates: [{ id: 'product', kind: 'news', title: 'Product update', timing: 'September 25',
    selectionReason: 'Observed discussion and a verified announcement',
    attention: [{ platform: 'X', url: 'https://x.com/i/status/123', fetchedAt: '2026-09-25T19:00:00Z',
      observation: '1000 likes at this snapshot' }],
    sources: [{ publisher: 'Vendor', url: 'https://example.com/release', fetchedAt: '2026-09-25T19:00:00Z',
      text: 'The product enters private preview.' }],
  }],
});
const draft = () => ({
  date: '2026-09-26', title: 'Product enters preview', intro: 'A limited release.',
  stories: [{ candidateIds: ['product'], title: 'Preview', timing: 'September 25',
    text: 'The product enters private preview.', emphasis: ['preview'],
    aiComment: 'The waiting room has a release date.',
    links: [{ label: '官方发布', url: 'https://example.com/release' }] }], trends: [],
});
test('links name their target in label and keep the type in kind; older type-only labels still map', () => {
  const data = draft();
  data.stories[0].links = [
    { kind: '论文', label: 'Ouro 论文', url: 'https://example.com/release' },
    { label: '代码', url: 'https://example.com/code' },
  ];
  assert.deepEqual(readerReport(data).stories[0].links.map(link => link.kind), ['论文', undefined]);
  const page = mergeExternalEditions([], [readerReport(data)])[0].pages.find(item => item.id === 'external');
  assert.deepEqual(page.stories[0].resources.map(({ kind, label }) => [kind, label]), [['paper', 'Ouro 论文'], ['code', '代码']]);
});
test('edition window uses China midnight and invalid dates fail', () => {
  assert.equal(selection().windowStart, '2026-09-25T16:00:00.000Z');
  assert.equal(selection().cutoff, '2026-09-26T16:00:00.000Z');
  assert.deepEqual(externalWindow('2026-09-25', '2026-09-25T19:00:00Z'), {
    edition:'2026-09-25', timezone:'Asia/Shanghai',
    windowStart:'2026-09-24T16:00:00.000Z', cutoff:'2026-09-25T16:00:00.000Z',
  });
  assert.throws(() => externalWindow('2026-02-30'));
  assert.throws(() => externalWindow('2026-09-26', '2026-09-24T00:00:00Z'));
  assert.throws(() => validateSelection({ ...selection(), cutoff:'2026-09-27T00:00:00Z' }), /exceeds/);
  assert.throws(() => validateSelection({ ...selection(), windowStart:'2026-09-24T16:00:00Z' }), /content date/);
});
test('selection requires original content and attention; papers need both top-five ranks', () => {
  validateSelection(selection());
  for (const change of [
    item => { item.sources[0].text = ''; },
    item => { item.attention = []; },
    item => { item.sources[0].url = 'http://example.com'; },
    item => { item.kind = 'paper'; item.paperRanks = { hf: 1, alpha: 15 }; },
  ]) {
    const input = selection();
    change(input.candidates[0]);
    assert.throws(() => validateSelection(input));
  }
  const paper = selection();
  Object.assign(paper.candidates[0], { kind: 'paper', paperRanks: { hf: 1, alpha: 3 } });
  validateSelection(paper);
});
test('draft validates per-event links, uniqueness and reader projection', () => {
  const data = draft();
  data.internal = 'private';
  const report = validateExternalDraft(data, selection());
  assert.equal(report.internal, undefined);
  assert.equal(report.stories[0].candidateIds, undefined);
  assert.throws(() => validateExternalDraft({ ...data, date: '2026-09-25' }, selection()));
  assert.throws(() => validateExternalDraft({ ...data, stories: [...data.stories, ...data.stories] }, selection()));
  data.stories[0].links[0].url = 'https://example.com/unread';
  assert.throws(() => validateExternalDraft(data, selection()), /Unverified/);
});
test('expanded editions retain per-event evidence and duplicate gates', () => {
  const input = selection(), data = draft();
  const candidate = input.candidates[0], story = data.stories[0];
  input.candidates = Array.from({ length: 12 }, (_, i) => ({
    ...structuredClone(candidate), id: `product-${i}`, title: `Product ${i}`,
  }));
  data.stories = input.candidates.map((item, i) => ({
    ...structuredClone(story), candidateIds: [item.id], title: `Preview ${i}`,
  }));
  validateExternalDraft(data, input);
  const badLink = structuredClone(data);
  badLink.stories.at(-1).links[0].url = 'https://example.com/unread';
  assert.throws(() => validateExternalDraft(badLink, input), /Unverified/);
  assert.throws(() => validateExternalDraft({ ...data, stories: [...data.stories, data.stories[0]] }, input));
  assert.throws(() => validateExternalDraft({ ...data, stories: [] }, input));
});
test('review is invalidated by prose or evidence changes without hashes', () => {
  const input = selection(), data = draft();
  const review = { status: 'approved', reviewer: 'Editor', reviewedAt: '2026-09-25T19:00:00Z',
    draft: structuredClone(data), selection: structuredClone(input) };
  validateExternalReview(data, input, review);
  const missing = structuredClone(data);
  delete missing.stories[0].aiComment;
  assert.throws(() => validateExternalReview(missing, input, { ...review, draft: missing }), /AI comments/);
  const edited = structuredClone(data);
  edited.stories[0].aiComment = 'The waiting room has new furniture.';
  assert.throws(() => validateExternalReview(edited, input, review), /Draft changed/);
  data.title = 'Changed';
  assert.throws(() => validateExternalReview(data, input, review), /Draft changed/);
  data.title = review.draft.title;
  input.candidates[0].sources[0].text += ' Correction.';
  assert.throws(() => validateExternalReview(data, input, review), /Evidence changed/);
});