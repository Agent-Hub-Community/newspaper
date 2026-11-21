import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  BANNED_KEYWORDS,
  canonicalizeKeywords,
  diagnoseLibrary,
  fetchUrlMetadata,
  generateSlug,
  inferMetadataFromUrl,
  parseSubmissionIssue,
  suggestTopicsAndKeywords,
  syncFromEditions,
  upsertLibraryItem,
} from '../lib/library-ingest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('canonicalizeKeywords maps aliases, deduplicates case-insensitively and drops banned terms', () => {
  const aliases = { RLVR: ['verifiable rewards'], 'agent skills': ['skill', 'skills'] };
  const res = canonicalizeKeywords(['AI', 'verifiable rewards', 'rlvr', 'skill', 'OSWorld', 'A|B'], aliases);
  assert.deepEqual(res.keywords, ['RLVR', 'agent skills', 'OSWorld', 'A B']);
  assert.ok(BANNED_KEYWORDS.has('ai'));
  assert.equal(res.dropped.includes('AI'), true);
  assert.equal(res.mapped.length, 3);
});

test('inferMetadataFromUrl detects arXiv, GitHub, HuggingFace, video and X links', () => {
  const arxiv = inferMetadataFromUrl('https://arxiv.org/pdf/2605.25624v2');
  assert.equal(arxiv.type, 'paper');
  assert.equal(arxiv.arxivId, '2605.25624');
  assert.equal(arxiv.key, 'arxiv:2605.25624');

  const gh = inferMetadataFromUrl('https://github.com/OpenAI/Math.git');
  assert.equal(gh.type, 'code');
  assert.equal(gh.githubRepo, 'openai/math');

  const ds = inferMetadataFromUrl('https://huggingface.co/datasets/xlangai/OSWorld');
  assert.equal(ds.type, 'dataset');
  assert.equal(ds.linkKind, 'data');

  const post = inferMetadataFromUrl('https://twitter.com/user/status/123?s=20');
  assert.equal(post.type, 'article');
  assert.equal(post.linkKind, 'post');
});

test('fetchUrlMetadata parses arXiv XML, GitHub JSON, generic HTML and blocks private hosts', async () => {
  const blocked = await fetchUrlMetadata('http://127.0.0.1:8080/secret');
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /Blocked/);

  const arxivRes = await fetchUrlMetadata('https://arxiv.org/abs/2605.25624', {
    fetchImpl: async () => new Response('<feed><entry><title>Test\n  Paper</title><summary>Solves\nRLVR.</summary></entry></feed>'),
  });
  assert.equal(arxivRes.ok, true);
  assert.equal(arxivRes.title, 'Test Paper');
  assert.equal(arxivRes.description, 'Solves RLVR.');

  const ghRes = await fetchUrlMetadata('https://github.com/org/repo', {
    fetchImpl: async () => Response.json({
      name: 'repo',
      description: 'Agent harness',
      topics: ['coding-agents'],
      homepage: 'https://repo.example.org',
      stargazers_count: 42,
    }),
  });
  assert.equal(ghRes.ok, true);
  assert.equal(ghRes.extraLinks[0].url, 'https://repo.example.org/');

  const htmlRes = await fetchUrlMetadata('https://example.org/post', {
    fetchImpl: async () => new Response('<html><head><meta property="og:title" content="Blog &amp; Post"><meta name="description" content="Desc"></head></html>'),
  });
  assert.equal(htmlRes.ok, true);
  assert.equal(htmlRes.title, 'Blog & Post');
});

test('suggestTopicsAndKeywords and generateSlug produce valid library identifiers', () => {
  const s = suggestTopicsAndKeywords('Evaluating coding agent harness on OSWorld with RLVR', {
    aliases: { RLVR: ['verifiable rewards'], OSWorld: ['OSWorld-Verified'] },
  });
  assert.ok(s.topics.includes('coding-agents') || s.topics.includes('evaluation'));
  assert.ok(s.keywords.includes('RLVR'));
  assert.ok(s.keywords.includes('OSWorld'));

  const slug1 = generateSlug({ title: 'PEAR: Post-training Engine', type: 'paper', links: [{ url: 'https://arxiv.org/abs/2605.25624' }] }, new Set(['pear']));
  assert.equal(slug1, 'pear-2');
});

test('upsertLibraryItem adds new items and merges duplicate keys without losing existing wording', () => {
  const base = {
    version: 1,
    through: '2026-11-15',
    items: [{
      id: 'cua-gym',
      title: 'CUA-Gym',
      summary: '合成 computer-use 训练环境。',
      type: 'dataset',
      topics: ['computer-use'],
      keywords: ['OSWorld', 'RLVR', 'data synthesis'],
      links: [{ kind: 'paper', url: 'https://arxiv.org/abs/2605.25624' }],
      shares: [{ date: '2026-11-15', group: 'group-1', avatar: null }],
    }],
  };

  const merged = upsertLibraryItem(base, {
    title: 'Ignored overwrite',
    summary: 'Ignored',
    url: 'https://arxiv.org/pdf/2605.25624v2',
    links: [{ kind: 'paper', url: 'https://arxiv.org/pdf/2605.25624v2' }, { kind: 'code', url: 'https://github.com/org/cua-gym' }],
    keywords: ['verifiable rewards', 'gui agent'],
    group: 'group-3',
    date: '2026-11-18',
  }, { aliases: { RLVR: ['verifiable rewards'] } });

  assert.equal(merged.action, 'merged');
  assert.equal(merged.item.title, 'CUA-Gym');
  assert.equal(merged.item.links.length, 2);
  assert.equal(merged.item.shares.length, 2);
  assert.equal(merged.library.through, '2026-11-18');

  const added = upsertLibraryItem(merged.library, {
    title: 'New Agent Tool',
    summary: '提供一键评测能力。',
    type: 'tool',
    topics: ['evaluation'],
    keywords: ['verifier', 'eval', 'CLI'],
    url: 'https://github.com/org/new-tool',
    date: '2026-11-19',
    group: 'group-2',
  });
  assert.equal(added.action, 'added');
  assert.equal(added.library.items.length, 2);
});

test('syncFromEditions discovers unindexed resources and parseSubmissionIssue parses GitHub form markdown', () => {
  const editions = [{
    date: '2026-11-18',
    pages: [{
      id: 'group-3',
      stories: [{
        title: '新工具发布',
        text: '群友讨论了一个新的评测工具。',
        resources: [{ kind: 'code', label: 'EvalTool', url: 'https://github.com/org/eval-tool' }],
      }],
    }],
  }];
  const candidates = syncFromEditions(editions, [], { items: [] });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].key, 'github:org/eval-tool');

  const parsed = parseSubmissionIssue(`### 主链接 (Primary URL)\n\nhttps://github.com/org/eval-tool\n\n### 标题 (Title)\n\nEvalTool\n\n### 类型 (Type)\n\ncode (开源项目)\n\n### 主题 (Topics)\n\nevaluation, coding-agents\n\n### 关键词 (Keywords)\n\nverifier, eval, CLI\n\n### 一句话简介 (Summary)\n\n自动化评测工具。\n\n### 补充链接 (Extra Links)\n\npaper=https://arxiv.org/abs/2605.99999\n\n### 来源群 (Group)\n\ngroup-3 (三群)`);
  assert.equal(parsed.type, 'code');
  assert.deepEqual(parsed.topics, ['evaluation', 'coding-agents']);
  assert.equal(parsed.links.length, 2);
  assert.equal(parsed.group, 'group-3');
});

test('diagnoseLibrary and library-cli doctor run cleanly against repository data', () => {
  const diag = diagnoseLibrary({ version: 1, through: '2026-11-15', items: [] });
  assert.equal(diag.totalItems, 0);

  const output = execFileSync(process.execPath, [path.join(root, 'scripts/library-cli.mjs'), 'doctor', '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(output);
  assert.ok(parsed.totalItems > 400);
  assert.ok(parsed.unindexedEditionResources.count >= 0);
});
