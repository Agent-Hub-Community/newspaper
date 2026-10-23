import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentStories, validateComments, applyComments } from '../lib/story-comments.mjs';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { runDigest } from './digest-context.mjs';

const fixture = () => [{ date: '2026-09-22', pages: [
  { id: 'group-1', label: '一群', stories: [{ title: '测试标题', text: '原文内容保持不变。' }, { title: '另一条', text: '另一段正文。' }] },
  { id: 'group-2', stories: [] }, { id: 'papers', papers: [] },
] }];
const comment = '跑通一次演示之后，还得看看换个任务能不能用。';
test('short replies do not need filler to meet the old fifteen-character minimum', () => {
  const stories = commentStories(fixture());
  for (const length of [6, 14, 15, 90]) {
    assert.doesNotThrow(() => validateComments(stories.map(s => ({ id: s.id, comment: '好'.repeat(length) })), stories));
  }
  for (const length of [0, 5, 91]) {
    assert.throws(() => validateComments(stories.map(s => ({ id: s.id, comment: '好'.repeat(length) })), stories));
  }
});
test('comments match article revisions, preserve original prose and reject incomplete coverage', () => {
  const issues = fixture();
  const original = issues[0].pages[0].stories.map(s => ({ ...s }));
  const stories = commentStories(issues);
  const entries = stories.map(s => ({ id: s.id, comment })).reverse();
  applyComments(issues, entries);
  assert.deepEqual(issues[0].pages[0].stories.map(({ aiComment, ...s }) => s), original);
  assert.equal(issues[0].pages[0].stories[0].aiComment, comment);
  assert.throws(() => validateComments(entries.slice(1), stories), /coverage/);
  assert.throws(() => validateComments([entries[0], entries[0]], stories), /Invalid/);
  issues[0].pages[0].stories[0].text = '新版正文';
  assert.throws(() => applyComments(issues, entries), /Invalid/);
});
test('comments reject model markup and render as separate escaped editorial opinions', () => {
  const issues = fixture(), stories = commentStories(issues);
  assert.throws(() => validateComments(stories.map(s => ({ id: s.id, comment: '<script>alert("bad")</script>' })), stories));
  const { window } = parseHTML('<html><body><main id="reading"></main><div id="edition-sections"></div><aside id="sidebar"></aside></body></html>');
  window.lucide = { createIcons() {} };
  issues[0].pages[0].stories[0].aiComment = '<img src=x onerror=alert(1)> 评论';
  runDigest({ window, document: window.document });
  window.renderDigest(issues[0], () => {}, { weeks: [], topics: [] }, 'group-1');
  const aside = window.document.querySelector('.brief-comment');
  assert.equal(aside.getAttribute('aria-label'), 'AI 锐评');
  assert.equal(aside.querySelector('p').textContent, issues[0].pages[0].stories[0].aiComment);
  assert.equal(aside.querySelectorAll('img, script').length, 0);
  assert.equal(window.document.querySelectorAll('.brief-comment').length, 1);
});
