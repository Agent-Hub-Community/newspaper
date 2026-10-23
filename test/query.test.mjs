import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../site/bm25.js';
import '../site/query.js';

test('shared query finds resource labels and URLs without exposing raw discussion', () => {
  const entries = [{ title: '群友讨论', text: '大家交换工具使用方法。', keywords: [],
    resources: [{ label: 'DistinctTool', url: 'https://example.org/distinct-tool' }],
    discussion: 'private-raw-marker' }];
  const index = globalThis.AgentHubQuery.createSearcher(entries);
  assert.deepEqual([...index.search('DistinctTool').keys()], [0]);
  assert.deepEqual([...index.search('distinct-tool').keys()], [0]);
  assert.deepEqual([...index.search('private-raw-marker').keys()], []);
  assert.deepEqual(globalThis.AgentHubQuery.createFields(entries[0]), globalThis.AgentHubQuery.createFields({
    t: entries[0].title, x: entries[0].text, kw: [], resources: entries[0].resources,
  }));
});

// Five items so that IDF stays positive; GPT appears with 6.1 only.
const corpus = [
  { title: 'GPT-6.1 Sol 体验', text: '群友比较 GPT-6.1 Sol 和 Opus 5.5。', keywords: [] },
  { title: 'Phone benchmarks', text: 'Benchmarks for phone agents and their tasks.', keywords: [] },
  { title: '奖励模型讨论', text: '群友讨论奖励模型与强化学习。', keywords: [] },
  { title: 'Mixture of Experts 路由', text: 'Mixture of Experts 的专家路由。', keywords: [] },
  { title: '无关内容', text: '别的话题。', keywords: [] },
];
const searcher = globalThis.AgentHubQuery.createSearcher(corpus, { expand: {}, groups: [['Mixture of Experts', 'MoE']] });

test('question words in Chinese and English do not decide the match', () => {
  assert.deepEqual([...searcher.search('群里有没有人聊过奖励模型').keys()], [2]);
  assert.deepEqual([...searcher.search('What benchmarks are there for phone agents?').keys()], [1],
    'what, are, there and for are question words, not unknown names');
  assert.deepEqual([...searcher.search('Mixture of Experts').keys()], [3], 'a vocabulary spelling keeps its own “of”');
});

test('a name with a version the site never wrote has no answer, and the response says so', () => {
  const missing = searcher.explain('GPT-7 发布');
  assert.equal(missing.matches.size, 0, 'GPT and 7 are known on their own but never together');
  assert.deepEqual(missing.missing_versions, ['gpt-7']);
  assert.deepEqual([...searcher.search('GPT-6.1 Sol').keys()], [0]);
  assert.deepEqual([...searcher.search('top 5').keys()], [], 'an ordinary word with a number is not a version');
});

test('years, sizes and versions the site wrote are never treated as missing versions', () => {
  const site = globalThis.AgentHubQuery.createSearcher([
    { title: 'Qwen3.6-35B 后训练', text: '基于 Qwen3.6-35B-A3B 的实验，对比 Llama 3.1。', keywords: [] },
    { title: 'ICLR 投稿', text: 'ICLR 2027 的审稿讨论。', keywords: [] },
    { title: 'DeepSeek V4.1', text: 'DeepSeek V4.1 Flash 发布，支持 1M 上下文。', keywords: [] },
    { title: '其他', text: '无关。', keywords: [] }, { title: '另一条', text: '还是无关。', keywords: [] },
  ], { expand: {}, groups: [] });
  for (const query of ['Qwen3.6', 'Llama 3.1', 'ICLR 2026', 'DeepSeek V4', 'context 1M', 'qwen 3.6']) {
    assert.deepEqual(site.explain(query).missing_versions, [], query);
  }
  assert.deepEqual(site.explain('Qwen3.6').matches.size > 0, true, 'a title finds itself');
  assert.deepEqual(site.explain('DeepSeek V5').missing_versions, ['deepseek v5']);
  assert.deepEqual(site.explain('Llama 5').known_versions, { llama: ['3.1'] });
});

test('an unknown English word is dropped only when the rest still carries the query, and the drop is reported', () => {
  const dropped = searcher.explain('Which phone benchmarks exist?');
  assert.deepEqual([...dropped.matches.keys()], [1], 'exist never occurs, but phone benchmarks carry the query');
  assert.deepEqual(dropped.dropped_terms, ['exist']);
  assert.equal(searcher.explain('rlaif reward 奖励模型').matches.size, 0,
    'two unknown words outweigh the rest, so the query is refused rather than reduced to common words');
  const alone = searcher.explain('RLAIF');
  assert.equal(alone.matches.size, 0, 'nothing is left to search');
  assert.deepEqual(alone.unknown_terms, ['rlaif']);
  assert.equal(searcher.explain('dpsk5 奖励模型').matches.size, 0, 'an identifier with digits is never dropped');
});
