import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { runDigest } from './digest-context.mjs';

function render(id = 'group-4', mode = 'digest', count = 4) {
  const { window } = parseHTML('<html><body><main id="reading"></main><div id="edition-sections"></div><aside id="sidebar"></aside></body></html>');
  window.lucide = { createIcons() {} };
  runDigest({ window, document: window.document });
  const stories = Array.from({ length: count }, (_, i) => ({
    title: `Editorial position ${i}`, text: 'One position.\n\nA different position.', aiComment: 'An independent comment.',
  }));
  window.renderDigest({ date: '2026-10-07', pages: [{ id, label: id, stories }] }, () => {}, { weeks: [], topics: [] }, id, mode);
  return { document: window.document, stories };
}

test('daily groups preserve editorial order with identical article structure', () => {
  const { document, stories } = render();
  assert.equal(document.querySelectorAll('.featured-discussion').length, 0);
  assert.deepEqual([...document.querySelectorAll('.brief')].map(n => n.className), ['brief', 'brief', 'brief', 'brief']);
  assert.deepEqual([...document.querySelectorAll('.brief h2')].map(n => n.textContent), stories.map(s => s.title));
  assert.deepEqual([...document.querySelectorAll('.brief-body > p')].map(n => n.textContent), stories.map(s => s.text));
  assert.equal(document.querySelectorAll('.brief-comment').length, 4);
  assert.equal(document.querySelectorAll('.brief-title').length, 4);
  assert.equal(render('group-1', 'digest', 1).document.querySelectorAll('.brief').length, 1);
  assert.equal(render('group-1', 'digest', 0).document.querySelectorAll('.featured-discussion').length, 0);
});

test('external and weekly pages retain their existing hierarchy', () => {
  for (const [id, mode] of [['external', 'digest'], ['group-4', 'weekly']]) {
    const { document } = render(id, mode);
    assert.equal(document.querySelectorAll('.discussion-stories, .featured-discussion').length, 0);
    assert.equal(document.querySelectorAll('.brief').length, 4);
  }
});
