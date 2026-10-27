import assert from 'node:assert/strict';
import { mergeExternalEditions } from './external-editions.mjs';

export function validateDate(date) {
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(date) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date, 'Invalid edition date');
  return date;
}

export function externalWindow(date, cutoff = new Date().toISOString()) {
  validateDate(date);
  const start = new Date(`${date}T00:00:00+08:00`).toISOString();
  assert.ok(Number.isFinite(Date.parse(cutoff)) && Date.parse(cutoff) > Date.parse(start), 'Invalid cutoff');
  const end = new Date(Math.min(Date.parse(cutoff), Date.parse(start) + 86400000)).toISOString();
  return { edition: date, timezone: 'Asia/Shanghai', windowStart: start, cutoff: end };
}

function https(url) {
  const parsed = new URL(url);
  assert.ok(parsed.protocol === 'https:' && !parsed.username && !parsed.password, 'Expected public HTTPS URL');
}

export function validateSelection(input) {
  validateDate(input.edition);
  assert.equal(input.timezone, 'Asia/Shanghai');
  assert.ok(Number.isFinite(Date.parse(input.windowStart)) &&
    Date.parse(input.cutoff) > Date.parse(input.windowStart), 'Invalid selection window');
  const window = externalWindow(input.edition, input.cutoff);
  assert.equal(Date.parse(input.windowStart), Date.parse(window.windowStart), 'Window must start on the content date');
  assert.equal(Date.parse(input.cutoff), Date.parse(window.cutoff), 'Window exceeds the content date');
  assert.ok(Array.isArray(input.candidates) && input.candidates.length > 0, 'No reviewed candidates');
  const ids = new Set();
  for (const item of input.candidates) {
    assert.ok(item.id && !ids.has(item.id), 'Duplicate candidate');
    ids.add(item.id);
    assert.ok(item.title && item.timing && item.selectionReason, 'Missing editorial decision');
    assert.ok(Array.isArray(item.attention) && item.attention.length, 'Missing attention evidence');
    for (const signal of item.attention) {
      https(signal.url);
      assert.ok(signal.platform && signal.observation && Number.isFinite(Date.parse(signal.fetchedAt)),
        'Missing attention snapshot');
    }
    assert.ok(Array.isArray(item.sources) && item.sources.length, 'Missing original source');
    for (const source of item.sources) {
      https(source.url);
      assert.ok(source.text?.trim() && source.publisher &&
        Number.isFinite(Date.parse(source.fetchedAt)), 'Unread original source');
    }
    if (item.kind === 'paper') {
      assert.ok(Number.isInteger(item.paperRanks?.hf) && item.paperRanks.hf >= 1 && item.paperRanks.hf <= 5 &&
        Number.isInteger(item.paperRanks?.alpha) && item.paperRanks.alpha >= 1 && item.paperRanks.alpha <= 5,
      'Paper must be in both top five lists');
    }
  }
  return input;
}

export function readerReport(draft) {
  mergeExternalEditions([], [draft]);
  return {
    date: draft.date, title: draft.title, intro: draft.intro,
    stories: draft.stories.map(({ title, timing, text, links, emphasis, aiComment }) => ({
      title, timing, text, links: links.map(({ kind, label, url }) => ({ ...(kind ? { kind } : {}), label, url })),
      ...(emphasis !== undefined ? { emphasis: [...emphasis] } : {}),
      ...(aiComment !== undefined ? { aiComment } : {}),
    })),
    trends: draft.trends.map(({ title, text }) => ({ title, text })),
  };
}

export function validateExternalDraft(draft, selection) {
  if (selection) validateSelection(selection);
  const report = readerReport(draft);
  if (selection) assert.equal(report.date, selection.edition, 'Wrong edition date');
  assert.ok(report.stories.length >= 1, 'Expected at least one story; do not pad');
  assert.ok(report.trends.length <= 3, 'Too many observations');
  if (selection) {
    const candidates = new Map(selection.candidates.map(item => [item.id, item]));
    const used = new Set();
    for (const story of draft.stories) {
      assert.ok(Array.isArray(story.candidateIds) && story.candidateIds.length, 'Missing story evidence');
      const allowed = new Set();
      for (const id of story.candidateIds) {
        assert.ok(candidates.has(id) && !used.has(id), 'Unknown or duplicated event');
        used.add(id);
        const item = candidates.get(id);
        for (const source of [...item.sources, ...item.attention]) allowed.add(source.url);
      }
      for (const link of story.links) assert.ok(allowed.has(link.url), 'Unverified story link');
      assert.ok(Array.isArray(story.emphasis), 'Missing emphasis selection');
    }
  } else {
    for (const story of draft.stories) {
      for (const link of story.links) https(link.url);
      assert.ok(Array.isArray(story.emphasis), 'Missing emphasis selection');
    }
  }
  return report;
}

export function validateExternalReview(draft, selection, review) {
  const report = validateExternalDraft(draft, selection);
  assert.ok(report.stories.every(story => story.aiComment?.trim()), 'Generate and review AI comments before import');
  if (review) {
    assert.equal(review.status, 'approved', 'Editorial approval required');
    assert.ok(review.reviewer?.trim() && Number.isFinite(Date.parse(review.reviewedAt)), 'Missing reviewer');
    if (review.draft) assert.deepEqual(review.draft, draft, 'Draft changed after review');
    if (review.selection && selection) assert.deepEqual(review.selection, selection, 'Evidence changed after review');
  }
  return report;
}
