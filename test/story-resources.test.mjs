import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { runDigest } from './digest-context.mjs';

function render(resources) {
  const { window } = parseHTML('<html><body><main id="reading"></main><div id="edition-sections"></div><aside id="sidebar"></aside></body></html>');
  window.lucide = { createIcons() {} };
  runDigest(
    { window, document: window.document, URL });
  window.renderDigest({ date: '2026-09-23', pages: [{
    id: 'group-1', stories: [{ title: 'Topic', text: 'Body', aiComment: 'Comment', resources }],
  }] }, () => {}, { weeks: [], topics: [] }, 'group-1');
  return window.document;
}
test('optional resources are escaped, open independently and precede AI comments', () => {
  const doc = render([{ kind: 'paper', label: '<img src=x> Paper', url: 'https://arxiv.org/abs/2602.20946' }]);
  const link = doc.querySelector('.brief-resources a');
  assert.equal(link.textContent.trim(), '<img src=x> Paper arxiv.org');
  assert.equal(link.querySelector('.resource-label').textContent, '<img src=x> Paper');
  assert.equal(link.getAttribute('href'), 'https://arxiv.org/abs/2602.20946');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(doc.querySelector('.brief-resources img'), null);
  assert.equal(doc.querySelector('.brief-resources').nextElementSibling.className, 'brief-comment');
  assert.equal(doc.querySelector('.brief-comment').nextElementSibling.className, 'brief-actions');
  assert.equal(render(undefined).querySelector('.brief-resources'), null);
});
test('all reviewed resources remain visible beyond the former three-link limit', () => {
  const resources = Array.from({ length: 4 }, (_, i) => ({ kind: 'code', label: `Tool ${i}`, url: `https://example.com/tool-${i}` }));
  const doc = render(resources);
  assert.deepEqual([...doc.querySelectorAll('.brief-resources a')].map(a => a.getAttribute('href')), resources.map(r => r.url));
});
test('public HN addresses retain the discussion id but reject extra query parameters', () => {
  const doc = render([
    { kind: 'discussion', label: '讨论', url: 'https://news.ycombinator.com/item?id=123' },
    { kind: 'discussion', label: '讨论', url: 'https://news.ycombinator.com/item?id=123&token=private' },
  ]);
  assert.equal(doc.querySelectorAll('.brief-resources a').length, 1);
  // The visible address is the host; the full link, including the item id, stays in href.
  assert.equal(doc.querySelector('.resource-address').textContent, 'news.ycombinator.com');
});
test('unsafe links, credentials, query tokens and duplicate resources are not rendered', () => {
  const urls = ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/a',
    'https://user:secret@example.com/', 'https://example.com/?token=private',
    'https://arxiv.org/abs/2602.20946', 'https://arxiv.org/abs/2602.20946'];
  const doc = render(urls.map(url => ({ kind: 'paper', label: 'Paper', url })));
  assert.equal(doc.querySelectorAll('.brief-resources a').length, 1);
});
test('a GitHub or arXiv address decides the source icon; other sources keep their kind', () => {
  const doc = render([
    { kind: 'article', label: 'Repo', url: 'https://github.com/owner/repo' },
    { kind: 'article', label: 'Abstract', url: 'https://arxiv.org/abs/2602.20946' },
    { kind: 'article', label: 'Post', url: 'https://example.com/post' },
    { kind: 'discussion', label: 'HN', url: 'https://news.ycombinator.com/item?id=1' },
  ]);
  assert.deepEqual([...doc.querySelectorAll('.brief-resources .resource-icon i')].map(i => i.dataset.lucide),
    ['code-xml', 'file-text', 'book-open', 'messages-square']);
});
