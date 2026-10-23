import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { runDigest } from './digest-context.mjs';

function render(text, emphasis) {
  const { window } = parseHTML('<html><body><main id="reading"></main><div id="edition-sections"></div><aside id="sidebar"></aside></body></html>');
  window.lucide = { createIcons() {} };
  runDigest({ window, document: window.document });
  window.renderDigest({ date: '2026-09-22', pages: [{
    id: 'group-1', label: '一群', stories: [{ title: '标题', text, emphasis }],
  }] }, () => {}, { weeks: [], topics: [] }, 'group-1');
  return window.document.querySelector('.brief-body > p');
}
test('emphasis preserves text and wraps exact spans in reading order within the total budget', () => {
  const text = '用户需要申请商务号码才能代打电话，当前仍在等待审核。';
  const p = render(text, ['仍在等待审核', '申请商务号码']);
  assert.equal(p.textContent, text);
  assert.deepEqual([...p.querySelectorAll('strong')].map(s => s.textContent), []);
  const short = render(text, ['审核', '号码']);
  assert.deepEqual([...short.querySelectorAll('strong')].map(s => s.textContent), ['号码', '审核']);
  assert.equal(short.textContent, text);
});
test('renders a full emphasis span in each of three paragraphs without changing body text', () => {
  const phrases = ['首段给出具体机制以及观察成立的前提条件', '次段说明证据', '末段保留限制'];
  const paragraphs = phrases.map(phrase => `${phrase}，${'这里保留相应讨论的背景与说明。'.repeat(4)}`);
  const text = paragraphs.join('\n\n');
  const body = render(text, [...phrases].reverse());
  assert.equal(body.textContent, text);
  assert.deepEqual([...body.querySelectorAll('strong')].map(span => span.textContent), phrases);
});
test('no markup injection, duplicates, overlapping spans or fabricated emphasis', () => {
  const text = '一段较长正文包含<script>、重复字样与若干足够长的背景描述。';
  const p = render(text, ['<script>', '<script>']);
  assert.equal(p.textContent, text);
  assert.equal(p.querySelectorAll('script').length, 0);
  assert.equal(p.querySelectorAll('strong').length, 1);
  assert.equal(render(text, ['不存在']).querySelectorAll('strong').length, 0);
  assert.equal(render(text, null).textContent, text);
  const overlap = render('这里的技术限制需要保留，同时还有更多背景信息用于解释。', ['技术限制', '限制']);
  assert.equal(overlap.querySelectorAll('strong').length, 1);
});
