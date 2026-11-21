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

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
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

test('the page escapes text, drops feedback hearts and only allows the configured views origin', () => {
  const normalized = normalizeLibrary(library([item({ title: '<img src=x onerror=alert(1)>' })]));
  const html = renderLibraryPage(normalized, { dailyHref: '../', weeklyHref: '../', feedbackEndpoint: 'https://votes.example/' });
  const { document } = parseHTML(html);
  assert.equal(document.querySelector('.entry-title img'), null);
  assert.equal(document.querySelector('.heart'), null);
  assert.equal(document.querySelector('.entry').dataset.keyword, 'OSWorld|RLVR|data synthesis');
  assert.equal(document.querySelector('.chips [data-filter="keyword"][data-value="RLVR"]'), null, 'a keyword on one item has no chip');
  assert.ok(document.querySelector('.entry-tags a[data-filter="keyword"][data-value="RLVR"]'), 'but stays clickable on its card');
  assert.equal(document.querySelector('meta[name="robots"]').content, 'noindex,nofollow', 'unlisted sections stay out of search');
  assert.match(document.querySelector('meta[http-equiv="Content-Security-Policy"]').content, /connect-src https:\/\/votes\.example;/);
  assert.equal(document.querySelector('meta[name="agenthub-feedback"]'), null);
  assert.equal(document.querySelector('.source img').getAttribute('src'), '../library-avatars/0123456789abcdef.jpg');
  const offline = parseHTML(renderLibraryPage(normalized, { dailyHref: '../', weeklyHref: '../' })).document;
  assert.match(offline.querySelector('meta[http-equiv="Content-Security-Policy"]').content, /connect-src 'none'/);
  assert.equal(offline.querySelector('meta[name="agenthub-feedback"]'), null);
});

test('the reviewed library validates against published editions and ships exactly its avatars', async () => {
  const normalized = normalizeLibrary(await readLibrary(dataDir), digests);
  assert.ok(normalized.items.length > 0);
  const used = new Set(normalized.items.flatMap(entry => entry.shares.map(share => share.avatar)).filter(Boolean));
  assert.deepEqual((await readdir(new URL('../data/library-avatars/', import.meta.url))).sort(), [...used].sort());
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

test('every configured group can share, including groups added after the library began', () => {
  const result = normalizeLibrary(library([item({ shares: [{ date: '2026-10-21', group: 'group-5', avatar: null }] })], '2026-10-22'));
  assert.equal(result.items[0].shares[0].group, 'group-5');
  assert.match(libraryMarkdown(result), /五群/);
  assert.throws(() => normalizeLibrary(library([item({ shares: [{ date: '2026-10-21', group: 'group-9', avatar: null }] })], '2026-10-22')));
});

test('normalizeLibrary computes derived activity and heat metrics without leaking private fields', () => {
  const editions = [{
    date: '2026-10-10',
    pages: [{
      id: 'group-2',
      stories: [{ title: '热议讨论', text: '讨论这款工具。', resources: [{ kind: 'paper', url: 'https://arxiv.org/abs/2605.25624' }] }],
    }],
  }];
  const weeklies = [{
    start: '2026-10-06',
    end: '2026-10-12',
    pages: [{
      id: 'group-1',
      stories: [{ title: '周报汇总', text: '周报回顾。', resources: [{ kind: 'paper', url: 'https://arxiv.org/pdf/2605.25624v2' }] }],
    }],
  }];
  const normalized = normalizeLibrary(library([
    item({
      id: 'hot-paper',
      type: 'paper',
      links: [
        { kind: 'paper', url: 'https://arxiv.org/abs/2605.25624' },
        { kind: 'code', url: 'https://github.com/example/hot-paper' },
      ],
      shares: [
        { date: '2026-10-08', group: 'group-2', avatar: null },
        { date: '2026-10-01', group: 'group-1', avatar: '0123456789abcdef.jpg' },
        { date: '2026-10-11', group: 'group-1', avatar: 'fedcba9876543210.png' },
      ],
    }),
    item({
      id: 'single-link',
      links: [{ kind: 'project', url: 'https://example.org/single' }],
      shares: [{ date: '2026-10-05', group: 'group-3', avatar: null }],
    }),
  ], '2026-10-13'), editions, weeklies);

  const byId = Object.fromEntries(normalized.items.map(entry => [entry.id, entry]));
  assert.equal(byId['hot-paper'].first, '2026-10-01');
  assert.equal(byId['hot-paper'].last, '2026-10-11');
  assert.equal(byId['hot-paper'].groupCount, 2);
  assert.equal(byId['hot-paper'].shareCount, 3);
  assert.equal(byId['hot-paper'].discussionCount, 2);
  // groupCount*3 + shareCount*2 + discussionCount*4 + (links.length > 1 ? 1 : 0) = 6 + 6 + 8 + 1 = 21
  assert.equal(byId['hot-paper'].heat, 21);

  assert.equal(byId['single-link'].first, '2026-10-05');
  assert.equal(byId['single-link'].last, '2026-10-05');
  assert.equal(byId['single-link'].groupCount, 1);
  assert.equal(byId['single-link'].shareCount, 1);
  assert.equal(byId['single-link'].discussionCount, 0);
  // 1*3 + 1*2 + 0*4 + 0 = 5
  assert.equal(byId['single-link'].heat, 5);

  const json = libraryJson(normalized);
  assert.doesNotMatch(JSON.stringify(json), /avatar|sender|wxid/);
  assert.doesNotMatch(libraryMarkdown(normalized), /avatar|sender|wxid/);
});

test('rendered library page exposes workspace landmarks, enriched cards, and safe search payload', () => {
  const editions = [{
    date: '2026-10-12',
    pages: [{
      id: 'group-1',
      stories: [{ title: 'CUA 论文热议', text: '深入讨论。', resources: [{ kind: 'paper', url: 'https://arxiv.org/abs/2605.25624' }] }],
    }],
  }];
  const weeklies = [{
    start: '2026-10-07',
    end: '2026-10-13',
    pages: [{
      id: 'group-2',
      stories: [{ title: '本周 CUA 精选', text: '周报汇总。', resources: [{ kind: 'paper', url: 'https://arxiv.org/abs/2605.25624' }] }],
    }],
  }];
  const kws = Array.from({ length: 14 }, (_, i) => `kw-${String(i + 1).padStart(2, '0')}`);
  const items = [
    item({
      id: 'hot-paper',
      title: 'Hot Paper',
      type: 'paper',
      topics: ['computer-use', 'training'],
      keywords: kws.slice(0, 12),
      links: [
        { kind: 'paper', url: 'https://arxiv.org/abs/2605.25624' },
        { kind: 'code', url: 'https://github.com/example/hot-paper' },
      ],
      shares: [
        { date: '2026-10-10', group: 'group-1', avatar: '0123456789abcdef.jpg' },
        { date: '2026-10-12', group: 'group-2', avatar: null },
      ],
    }),
    item({
      id: 'bench-one',
      title: 'Bench One',
      type: 'benchmark',
      topics: ['evaluation'],
      keywords: kws.slice(0, 12),
      links: [{ kind: 'leaderboard', url: 'https://example.org/bench' }],
      shares: [{ date: '2026-10-09', group: 'group-1', avatar: null }],
    }),
    item({
      id: 'extra-kw-item',
      title: 'Extra KW Item',
      type: 'code',
      topics: ['coding-agents'],
      keywords: kws.slice(0, 12),
      links: [{ kind: 'code', url: 'https://github.com/example/extra' }],
      shares: [{ date: '2026-09-20', group: 'group-3', avatar: null }],
    }),
    item({
      id: 'kw-overflow-1',
      title: 'KW Overflow 1',
      type: 'tool',
      topics: ['research-tools'],
      keywords: [...kws.slice(12, 14), 'unique-kw'],
      links: [{ kind: 'project', url: 'https://example.org/ov1' }],
      shares: [{ date: '2026-09-18', group: 'group-3', avatar: null }],
    }),
    item({
      id: 'kw-overflow-2',
      title: 'KW Overflow 2',
      type: 'tool',
      topics: ['research-tools'],
      keywords: [...kws.slice(12, 14), 'unique-kw-2'],
      links: [{ kind: 'project', url: 'https://example.org/ov2' }],
      shares: [{ date: '2026-09-17', group: 'group-3', avatar: null }],
    }),
    item({
      id: 'kw-overflow-3',
      title: 'KW Overflow 3',
      type: 'tool',
      topics: ['research-tools'],
      keywords: [...kws.slice(12, 14), 'unique-kw-3'],
      links: [{ kind: 'project', url: 'https://example.org/ov3' }],
      shares: [{ date: '2026-09-16', group: 'group-3', avatar: null }],
    }),
  ];
  const normalized = normalizeLibrary(library(items, '2026-10-13'), editions, weeklies);
  const html = renderLibraryPage(normalized, { dailyHref: '../', weeklyHref: '../' });
  const { document } = parseHTML(html);

  // SVG sprite symbols
  for (const id of ['i-e', 'i-bm', 'i-chat', 'i-plus', 'i-dl', 'i-info']) {
    assert.ok(document.querySelector(`symbol#${id}`), `missing sprite symbol #${id}`);
  }

  // Heading actions & search shell
  assert.ok(document.querySelector('#library-saved-toggle'));
  assert.ok(document.querySelector('#library-saved-count[hidden]'));
  assert.ok(document.querySelector('#library-submit-open.is-primary'));
  assert.ok(document.querySelector('#library-search'));
  assert.ok(document.querySelector('#library-search-clear[hidden]'));
  assert.ok(document.querySelector('#library-suggest[hidden]'));
  assert.ok(document.querySelector('#library-explain[hidden]'));

  // Quick research lenses
  const lenses = [...document.querySelectorAll('.lenses .lens')].map(el => el.dataset.lens);
  assert.deepEqual(lenses, ['all', 'recent', 'hot', 'paper-code', 'benchmarks', 'saved']);
  assert.ok(document.querySelector('#lens-saved-count'));

  // Topic tooltips, keyword quick search + KEYWORDS_SHOWN=12, discussed filter in more-filters
  const cuaChip = document.querySelector('[data-row="topic"] button[data-value="computer-use"]');
  assert.ok(cuaChip.getAttribute('title').includes('GUI'));
  assert.ok(document.querySelector('[data-row="keyword"] .keyword-controls #keyword-filter-input'));
  assert.ok(document.querySelector('[data-row="keyword"] #keyword-matches[hidden]'));
  assert.equal(document.querySelectorAll('[data-row="keyword"] .chips button[data-filter="keyword"].is-extra').length, 2);
  assert.ok(document.querySelector('[data-row="keyword"] .chips-more[aria-expanded="false"]'));
  assert.ok(document.querySelector('.more-filters [data-row="discussed"] button[data-value="1"]'));

  // Toolbar controls, atlas, dialogs, toast
  assert.deepEqual([...document.querySelectorAll('.library-sort button')].map(b => b.dataset.sortBy), ['recent', 'heat', 'active', 'relevance']);
  assert.ok(document.querySelector('.library-sort button[data-sort-by="relevance"]').hasAttribute('hidden'));
  assert.deepEqual([...document.querySelectorAll('.view-switch button')].map(b => b.dataset.viewMode), ['cards', 'list', 'atlas']);
  assert.ok(document.querySelector('#library-export-toggle'));
  assert.deepEqual([...document.querySelectorAll('#library-export-menu button')].map(b => b.dataset.export), ['markdown', 'bibtex', 'download-md', 'share-url']);
  const atlas = document.querySelector('#library-atlas');
  assert.ok(atlas && atlas.hasAttribute('hidden'));
  assert.equal(atlas.nextElementSibling.tagName, 'OL');
  assert.ok(document.querySelector('dialog#library-detail'));
  assert.ok(document.querySelector('dialog#library-submit'));
  assert.ok(document.querySelector('#library-toast[hidden]'));

  // Enhanced entry card
  const hotCard = document.querySelector('li.entry#hot-paper');
  assert.equal(hotCard.dataset.last, '2026-10-12');
  assert.equal(hotCard.dataset.heat, '19');
  assert.equal(hotCard.dataset.discussed, '1');
  assert.equal(hotCard.dataset.hot, '1');
  assert.equal(hotCard.querySelector('.entry-type').dataset.type, 'paper');
  assert.equal(hotCard.querySelectorAll('.entry-badge').length, 2);
  assert.ok(hotCard.querySelector('.entry-save[data-save-id="hot-paper"]'));
  assert.match(hotCard.querySelector('.entry-discussion').textContent, /群聊摘要 · 2/);
  assert.match(hotCard.querySelector('.entry-detail-btn[data-detail-id="hot-paper"]').textContent, /详情 · 相关 \d+/);

  // Enriched #library-search-data payload (no private fields)
  const rawPayload = document.querySelector('#library-search-data').textContent;
  assert.doesNotMatch(rawPayload, /avatar|sender|wxid/);
  const payload = JSON.parse(rawPayload);
  assert.equal(payload.repoUrl, 'https://github.com/Agent-Hub-Community/newspaper');
  assert.ok(payload.types.paper && payload.topics['computer-use'] && payload.linkKinds.code && payload.groups['group-1']);
  assert.ok(Array.isArray(payload.keywords) && payload.keywords.length === 17);
  const hotPayload = payload.items.find(entry => entry.id === 'hot-paper');
  assert.equal(hotPayload.first, '2026-10-10');
  assert.equal(hotPayload.last, '2026-10-12');
  assert.deepEqual(hotPayload.groups, ['group-1', 'group-2']);
  assert.equal(hotPayload.shareCount, 2);
  assert.equal(hotPayload.heat, 19);
  assert.equal(hotPayload.discussions.length, 2);
  assert.equal(hotPayload.discussions[0].kind, 'weekly');
  assert.equal(hotPayload.discussions[0].from, '2026-10-07');
  assert.match(hotPayload.discussions[0].href, /^\.\.\/weekly\/2026-10-07\/2026-10-13\/group-2\/#topic-1$/);
  assert.ok(hotPayload.related.length > 0);
});
