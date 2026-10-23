import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { runDigest } from './digest-context.mjs';

function render(note, stories = []) {
  const { window } = parseHTML('<html><body><main id="reading"></main><div id="edition-sections"></div></body></html>');
  window.lucide = { createIcons() {} };
  runDigest(
    { window, document: window.document, URL });
  window.renderDigest({ date: '2026-09-15', pages: [{
    id: 'group-1', note, stories,
  }] }, () => {}, {}, 'group-1');
  return window.document;
}

test('local record labels and date-only remnants leave no empty note element', () => {
  for (const stories of [[], [{ title: 'Title', text: 'Body' }]]) {
    for (const note of ['2026-09-15 · 当日本地记录 · 无本地可读记录', '2026-09-15 · 当日本地记录']) {
      const doc = render(note, stories);
      assert.doesNotMatch(doc.querySelector('main').textContent, /当日本地记录|无本地可读记录/);
      assert.equal(doc.querySelector('.digest-source, .digest-empty p'), null);
    }
  }
});

test('substantive source notes remain visible and escaped', () => {
  const doc = render('2026-09-15 · 当日本地记录 · 资料来自 <原文>');
  assert.equal(doc.querySelector('.digest-empty p').textContent, '2026-09-15 · 资料来自 <原文>');
  assert.equal(doc.querySelector('.digest-empty p').children.length, 0);
});
