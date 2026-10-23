import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { digests } from '../lib/digest.mjs';
import { libraryFeedbackId } from '../lib/feedback-id.mjs';
import {
  canonicalUrl, libraryJson, libraryMarkdown, normalizeLibrary, readLibrary, resourceKey,
} from '../lib/library.mjs';
import { renderLibraryPage } from '../lib/library-render.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const item = (overrides = {}) => ({
  id: 'cua-gym', title: 'CUA-Gym', summary: '合成 computer-use 训练环境。', type: 'dataset', topics: ['computer-use'], keywords: ['OSWorld', 'RLVR', 'data synthesis'],
  links: [{ kind: 'paper', url: 'https://arxiv.org/abs/2605.25624' }],
  shares: [{ date: '2026-06-02', group: 'group-1', avatar: '0123456789abcdef.jpg' }], ...overrides,
});
const library = (items, through = '2026-10-13') => ({ version: 1, through, items });

test('one work keeps one key across mirrors, versions and share decorations', () => {
  for (const url of ['https://arxiv.org/pdf/2609.33356v2', 'https://www.alphaxiv.org/abs/2609.33356', 'http://arxiv.org/abs/2609.33356/', 'https://huggingface.co/papers/2609.33356']) {
    assert.equal(resourceKey(url), 'arxiv:2609.33356', url);
  }
  for (const url of ['https://github.com/OpenAI/Math', 'https://github.com/openai/math.git', 'https://github.com/openai/math/tree/main', 'https://github.com/openai/math/blob/main/README.md', 'https://github.com/openai/math?tab=readme-ov-file']) {
    assert.equal(resourceKey(url), 'github:openai/math', url);
  }
  assert.notEqual(resourceKey('https://github.com/openai/math/tree/main/lean'), 'github:openai/math', 'a folder is its own resource');
  assert.equal(canonicalUrl('https://twitter.com/a/status/1?s=46&t=abc'), 'https://x.com/a/status/1');
  assert.equal(canonicalUrl('https://example.com/post/?utm_source=x&id=7#top'), 'https://example.com/post?id=7');
  const wechat = 'https://mp.weixin.qq.com/s?__biz=M&mid=1&idx=1&sn=a&chksm=b&scene=21#rd';
  assert.equal(canonicalUrl(wechat), 'https://mp.weixin.qq.com/s?__biz=M&mid=1&idx=1&sn=a&chksm=b', 'chksm keeps the article openable');
  assert.equal(resourceKey(wechat), resourceKey('https://mp.weixin.qq.com/s?__biz=M&mid=1&idx=1&sn=a'));
  assert.equal(resourceKey('https://example.com/p?id=a==&x=1'), resourceKey('https://example.com/p?x=1&utm_source=z&id=a=='), 'query order and encoding do not split a page');
  assert.throws(() => canonicalUrl('javascript:alert(1)'));
  assert.throws(() => canonicalUrl('https://user:pass@example.com/'));
});

test('items sort by first share and link back to the daily stories that cite them', () => {
  const editions = [{ date: '2026-10-01', pages: [{ id: 'group-2', stories: [
    { title: '空稿', text: ' ', resources: [] },
    { title: '别的话题', text: '另一段讨论。', resources: [] },
    { title: 'CUA 环境讨论', text: '讨论 CUA 环境。', resources: [{ kind: 'paper', url: 'https://arxiv.org/pdf/2605.25624v3' }] },
  ] }] }];
  const result = normalizeLibrary(library([
    item(),
    item({ id: 'osworld', links: [{ kind: 'project', url: 'https://osworld-v2.xlang.ai/' }], shares: [{ date: '2026-06-27', group: 'group-1', avatar: null }] }),
  ]), editions);
  assert.deepEqual(result.items.map(entry => entry.id), ['osworld', 'cua-gym']);
  assert.equal(result.first, '2026-06-02');
  const [discussion] = result.items[1].discussions;
  assert.equal(discussion.kind, 'daily');
  assert.equal(discussion.date, '2026-10-01');
  assert.equal(discussion.group, 'group-2');
  assert.equal(discussion.title, 'CUA 环境讨论');
  assert.equal(discussion.anchor, 'topic-2');
  assert.match(discussion.id, /^daily:2026-10-01:group-2:[a-f0-9]{24}$/);
});

test('daily and weekly references to one work link to their own single-topic copies', () => {
  const story = { title: 'CUA 的研究经验', text: '训练环境的科研经验。',
    resources: [{ kind: 'paper', url: 'https://arxiv.org/abs/2605.25624' }] };
  const daily = { date: '2026-10-01', pages: [{ id: 'group-2', stories: [story] }] };
  const weekly = { start: '2026-09-28', end: '2026-10-04', pages: [{ id: 'group-2', stories: [story] }] };
  const json = libraryJson(normalizeLibrary(library([item()]), [daily], [weekly]));
  const links = json.items[0].discussions;
  assert.equal(links.length, 2);
  assert.equal(links[0].kind, 'weekly');
  assert.equal(links[0].from, '2026-09-28');
  assert.match(links[0].url, /weekly\/2026-09-28\/2026-10-04\/group-2\/#topic-1$/);
  assert.match(links[0].read_url, /agents\/topics\/weekly:2026-09-28:2026-10-04:group-2:[a-f0-9]{24}\.md$/);
  assert.equal(links[1].kind, 'daily');
  assert.match(links[1].url, /daily\/2026-10-01\/group-2\/#topic-1$/);
  assert.match(links[1].read_url, /agents\/topics\/daily:2026-10-01:group-2:[a-f0-9]{24}\.md$/);
});

test('invalid library records are rejected instead of published', () => {
  const invalid = {
    'unknown type': item({ type: 'blog' }),
    'unknown topic': item({ topics: ['agents'] }),
    'too many topics': item({ topics: ['computer-use', 'training', 'evaluation', 'memory'] }),
    'link not canonical': item({ links: [{ kind: 'paper', url: 'https://arxiv.org/pdf/2605.25624' }] }),
    'share after coverage': item({ shares: [{ date: '2026-10-14', group: 'group-1', avatar: null }] }),
    'avatar outside the reviewed folder': item({ shares: [{ date: '2026-06-02', group: 'group-1', avatar: '../avatars/x.jpg' }] }),
    'unknown group': item({ shares: [{ date: '2026-06-02', group: 'group-9', avatar: null }] }),
    'extra field': item({ sharer: 'p1' }),
    'too few keywords': item({ keywords: ['OSWorld'] }),
    'keyword repeated in another case': item({ keywords: ['RLVR', 'rlvr', 'GRPO'] }),
    'keyword with the reserved separator': item({ keywords: ['A|B', 'GRPO', 'RLVR'] }),
  };
  for (const [reason, entry] of Object.entries(invalid)) assert.throws(() => normalizeLibrary(library([entry])), undefined, reason);
  assert.throws(() => normalizeLibrary(library([item(), item()])), /duplicate/, 'duplicate id');
  assert.throws(() => normalizeLibrary({ ...library([item({ keywords: ['OSWorld', 'verifiable rewards', 'GRPO'] })]), aliases: { RLVR: ['verifiable rewards'] } }), /write "RLVR"/, 'aliases must be written in canonical form');
  assert.throws(() => normalizeLibrary({ ...library([item()]), aliases: { RLVR: ['GRPO'], GRPO: [] } }), /canonical/, 'an alias cannot be another canonical keyword');
  assert.throws(() => normalizeLibrary(library([item(), item({ id: 'other', links: [{ kind: 'code', url: 'https://example.com/' }], aliases: ['https://arxiv.org/abs/2605.25624'] })])), /share/, 'one work in two items');
});

test('agent copies carry the page facts without avatars and stay consistent with the item list', () => {
  const normalized = normalizeLibrary(library([
    item({ shares: [{ date: '2026-06-02', group: 'group-1', avatar: '0123456789abcdef.jpg' }, { date: '2026-06-02', group: 'group-1', avatar: 'fedcba9876543210.png' }] }),
    item({ id: 'memory-paper', title: 'Memory <script>', topics: ['memory', 'training'], keywords: ['RLVR', 'memory bank', 'LoCoMo'], links: [{ kind: 'code', url: 'https://github.com/a/b' }] }),
  ]));
  const json = libraryJson(normalized);
  assert.doesNotMatch(JSON.stringify(json), /avatar|\.jpg|\.png/);
  assert.deepEqual(json.items[0].shared, [{ date: '2026-06-02', group: 'group-1' }], 'two sharers on one day are one share record');
  assert.equal(json.count, 2);
  const markdown = libraryMarkdown(normalized);
  assert.equal(markdown.match(/^- \[/gm).length, 2, 'each item appears once, under its first topic');
  assert.match(markdown, /Memory \\<script\\>/);
  assert.deepEqual(json.keywords[0], { keyword: 'RLVR', count: 2 }, 'the keyword index counts every item');
  assert.deepEqual(json.items.map(entry => entry.related), [['memory-paper'], ['cua-gym']], 'related items share a keyword');
});

test('the page escapes text, keys hearts by item id and only allows the configured feedback origin', () => {
  const normalized = normalizeLibrary(library([item({ title: '<img src=x onerror=alert(1)>' })]));
  const html = renderLibraryPage(normalized, { dailyHref: '../', weeklyHref: '../', feedbackEndpoint: 'https://votes.example/' });
  const { document } = parseHTML(html);
  assert.equal(document.querySelector('.entry-title img'), null);
  assert.equal(document.querySelector('.heart').dataset.feedback, libraryFeedbackId('cua-gym'));
  assert.equal(document.querySelector('.entry').dataset.keyword, 'OSWorld|RLVR|data synthesis');
  assert.equal(document.querySelector('.chips [data-filter="keyword"][data-value="RLVR"]'), null, 'a keyword on one item has no chip');
  assert.ok(document.querySelector('.entry-tags a[data-filter="keyword"][data-value="RLVR"]'), 'but stays clickable on its card');
  assert.equal(document.querySelector('meta[name="robots"]').content, 'noindex,nofollow', 'unlisted sections stay out of search');
  assert.match(document.querySelector('meta[http-equiv="Content-Security-Policy"]').content, /connect-src https:\/\/votes\.example;/);
  assert.equal(document.querySelector('meta[name="agenthub-feedback"]').content, 'https://votes.example/');
  assert.equal(document.querySelector('.source img').getAttribute('src'), '../library-avatars/0123456789abcdef.jpg');
  const offline = parseHTML(renderLibraryPage(normalized, { dailyHref: '../', weeklyHref: '../' })).document;
  assert.match(offline.querySelector('meta[http-equiv="Content-Security-Policy"]').content, /connect-src 'none'/);
  assert.equal(offline.querySelector('meta[name="agenthub-feedback"]'), null);
});

test('the reviewed library validates against published editions and ships exactly its avatars', async () => {
  const normalized = normalizeLibrary(await readLibrary(root), digests);
  assert.ok(normalized.items.length > 0);
  const used = new Set(normalized.items.flatMap(entry => entry.shares.map(share => share.avatar)).filter(Boolean));
  assert.deepEqual((await readdir(new URL('../library-avatars/', import.meta.url))).sort(), [...used].sort());
});

test('links on a site the entry uses once show the site; links sharing a site show their paths', () => {
  const normalized = normalizeLibrary(library([item({ links: [
    { kind: 'paper', url: 'https://arxiv.org/abs/2605.25624' },
    { kind: 'code', url: 'https://github.com/openai/math' },
    { kind: 'code', url: 'https://github.com/openai/math/tree/main/lean' },
    { kind: 'code', url: 'https://github.com/openai/math/tree/main/src/agents/explore' },
  ] })]));
  const { document } = parseHTML(renderLibraryPage(normalized, { dailyHref: '../', weeklyHref: '../' }));
  assert.deepEqual([...document.querySelectorAll('.entry-links a')].map(a => a.textContent),
    ['论文 arxiv.org', '代码 openai/math', '代码 math/lean', '代码 math/…/explore']);
  assert.ok([...document.querySelectorAll('.entry-links a')].every(a => a.title === a.getAttribute('href')));
});
