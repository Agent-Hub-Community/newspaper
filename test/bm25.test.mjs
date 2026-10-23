import { test } from 'node:test';
import assert from 'node:assert/strict';
await import('../bm25.js');
const { tokens, createIndex, variants, ranges } = globalThis.AgentHubBM25;

// “模型” appears in most items, as on the real site, so it carries little weight.
const docs = [
  { title: 'Opus 风控收紧', keywords: 'Claude', text: '多位使用者反馈账号被封号，警告后封号。' },
  { title: '模型发布汇总', keywords: 'GPT', text: '本周多个模型发布，模型能力继续提升，模型价格下降。' },
  { title: 'DeltaTTG', keywords: 'agentic RL', text: '针对多轮强化学习中奖励稀疏的问题，用剩余 token 进度条指导模型训练。' },
  { title: 'Agent 记忆', keywords: 'memory', text: '怎么做长期记忆：模型的分层存储与检索。' },
  { title: 'Anthropic 防蒸馏', keywords: 'Anthropic distillation', text: '介绍对模型蒸馏攻击的防护。' },
];
const index = createIndex(docs, { title: 3, keywords: 2, text: 1 });
const top = query => [...index.search(variants(query, { 'a社': ['Anthropic'], cc: ['Claude Code'], 'claude code': ['Claude Code'] }).variants)]
  .sort((a, b) => b[1].score - a[1].score).map(([i]) => i);

test('Chinese splits into overlapping pairs; Latin words and numbers stay whole', () => {
  assert.deepEqual(tokens('模型封号'), ['模型', '型封', '封号']);
  assert.deepEqual(tokens('GPT-6.1 Agent'), ['gpt', '6', '1', 'agent']);
  assert.deepEqual(tokens('社'), ['社']);
});

test('a Chinese sentence finds its topic without spaces, and a common word alone does not qualify', () => {
  assert.deepEqual(top('模型封号'), [0], 'only the item about 封号; the one that just says 模型 is left out');
  assert.equal(top('多轮强化学习奖励稀疏')[0], 2);
  assert.deepEqual(top('zzqqxx'), []);
});

test('question words in a query carry no topic', () => {
  assert.equal(top('agent 怎么做记忆')[0], 3);
  assert.ok(!variants('怎么做记忆', {}).variants[0].text.includes('怎么'));
});

test('aliases expand inside a sentence; Latin aliases only as whole words; longer aliases win', () => {
  assert.equal(top('a社的蒸馏')[0], 4);
  assert.deepEqual(variants('accuracy', { cc: ['Claude Code'] }).found, []);
  assert.deepEqual(variants('claude code 配置', { cc: ['X'], 'claude code': ['Z'], code: ['Y'] }).found.map(item => item.alias), ['claude code']);
  assert.deepEqual(variants('claude code 配置', { 'claude code': ['Claude Code'], code: ['Y'] }).found, [],
    'a spelling that only maps to itself still keeps the shorter alias inside it from firing');
});

test('neighbouring matched pairs highlight as one phrase', () => {
  assert.deepEqual(ranges('针对强化学习奖励稀疏的问题', '强化学习奖励'), [[2, 8]]);
});

test('a synonym finds items written another way, below items that use the typed spelling', () => {
  const corpus = [
    { title: '科研绘图工具', keywords: '', text: '用代码绘图并导出 SVG。' },
    { title: '画图经验', keywords: '', text: '群友分享画图的经验。' },
    { title: '模型发布', keywords: '', text: '无关内容。' },
  ];
  const synonymIndex = createIndex(corpus, { title: 3, keywords: 2, text: 1 });
  const query = variants('画图', {}, [['画图', '绘图', '作图']]);
  assert.deepEqual(query.found, [{ alias: '画图', targets: ['绘图', '作图'] }]);
  const order = [...synonymIndex.search(query.variants)].sort((a, b) => b[1].score - a[1].score).map(([i]) => i);
  assert.deepEqual(order, [1, 0], 'the typed spelling ranks first; the synonym match follows');
});

test('a name put in for an alias needs its rarest English word', () => {
  const corpus = [
    { title: 'Google Play 开放安装', keywords: '', text: 'Google 调整应用商店规则。' },
    { title: 'Google 发布 SynthID', keywords: '', text: 'Google 的水印检测工具。' },
    { title: 'Gemini 4 Argon 发布', keywords: '', text: '新一代 Gemini 模型。' },
  ];
  const named = createIndex(corpus, { title: 3, keywords: 2, text: 1 });
  const found = query => [...named.search(variants(query, { 哈基米: ['Google Gemini'] }).variants)].map(([i]) => i);
  assert.deepEqual(found('哈基米'), [2], 'Google items without Gemini stay out');
  assert.deepEqual(found('Google'), [0, 1], 'a typed query is not held to the rule');
});

test('after a synonym swap, the words left as typed still have to match', () => {
  // Agent is everywhere and weighs little; 智能体 is rarer, so on its own it could cover the swapped query.
  const corpus = [
    { title: 'Agent 记忆分层', keywords: '', text: 'Agent 的长期记忆。' },
    { title: '智能体协议草案', keywords: '', text: '个人智能体的通信协议。' },
    { title: '多智能体交易基准', keywords: '', text: '智能体在市场中交易。' },
    { title: 'Agent 评测', keywords: '', text: 'Agent 基准。' },
    { title: 'Agent 发布', keywords: '', text: 'Agent 产品。' },
  ];
  const swapped = createIndex(corpus, { title: 3, keywords: 2, text: 1 });
  const query = variants('Agent 记忆', {}, [['Agent', '智能体']]).variants;
  const found = [...swapped.search(query).keys()];
  assert.ok(found.includes(0) && !found.includes(1) && !found.includes(2), 'items that only say 智能体 stay out');
  const alone = [...swapped.search(variants('智能体', {}, [['Agent', '智能体']]).variants).keys()];
  assert.ok(alone.includes(1) && alone.includes(3), 'a query of the spelling alone still finds both ways of writing it');
});

test('an English word the site never uses still counts, so the rest of the query cannot match alone', () => {
  const corpus = [
    { title: 'GPT-6.1 Sol', keywords: '', text: '版本 6.1 发布。' },
    { title: 'DeepSeek V4.1', keywords: '', text: 'DeepSeek 新版本。' },
  ];
  const versions = createIndex(corpus, { title: 3, keywords: 2, text: 1 });
  assert.deepEqual([...versions.search(['dpsk4.1'])], [], 'only “1” is known, and that is too little of the query');
  assert.deepEqual([...versions.search(['v4.1'])].map(([i]) => i), [1], 'known words match as before');
});

test('a spelling that is both an alias and in a synonym group expands to both', () => {
  const query = variants('cua', { cua: ['Computer-Use Agent'] }, [['cua', 'computer use', 'Computer-Use Agent']]);
  assert.deepEqual(query.found, [{ alias: 'cua', targets: ['Computer-Use Agent', 'computer use'] }]);
  assert.deepEqual(query.variants.map(variant => [variant.text.trim(), variant.weight]),
    [['cua', 1], ['computer-use agent', 1], ['computer use', 0.85]], 'the alias keeps its full weight');
});

test('a mixed alias retains its entity in every query variant', () => {
  const corpus = [
    { title: 'Anthropic 防蒸馏', keywords: '', text: 'Claude 的 distillation 防护。' },
    { title: 'a distillation recipe', keywords: '', text: '另一个团队的蒸馏方案。' },
    { title: 'Anthropic 模型发布', keywords: '', text: '发布新的 Claude 模型。' },
  ];
  const idx = createIndex(corpus, { title: 3, keywords: 2, text: 1 });
  const query = variants('A社蒸馏', { 'a社': ['Anthropic'], '蒸馏': ['distillation'] }).variants;
  assert.deepEqual([...idx.search(query).keys()], [0], 'neither “a” nor the company alone covers the compound query');
});

test('unknown named identifiers do not collapse to generic topic matches', () => {
  const idx = createIndex([
    { title: 'model evaluation', text: '评测模型。' },
    { title: 'benchmark release', text: '新的评测工具。' },
  ], { title: 3, text: 1 });
  assert.deepEqual([...idx.search(['new-model-id-731 evaluation']).keys()], []);
});

test('an alias entity requirement accepts its interchangeable spellings', () => {
  const corpus = [
    { title: '基模训练', keywords: '', text: '专用模型的预训练。' },
    { title: '基座模型迭代', keywords: '', text: '模型能力提升。' },
    { title: 'Base Model release', keywords: '', text: 'A new model.' },
    { title: '无关模型', keywords: '', text: '普通模型发布。' },
  ];
  const idx = createIndex(corpus, { title: 3, keywords: 2, text: 1 });
  const query = variants('基座模型', { '基座模型': ['Base Model'] }, [['基座模型', '基模', 'Base Model']]);
  const hits = [...idx.search(query.variants).keys()];
  assert.ok(hits.includes(0), 'a synonym-only item retains the requested entity');
  assert.ok(hits.includes(1) && hits.includes(2), 'canonical and formal spellings still match');
  assert.ok(!hits.includes(3), 'the generic word model is insufficient');
});

test('a filter limits the items before the relative cut, so weaker matches inside it are kept', () => {
  // The daily item matches every query word; the library items match one of them and trail far behind it.
  const corpus = [
    { title: 'Coding agent harness review', keywords: '', text: 'coding agent harness comparison' },
    { title: 'Coding benchmark', keywords: '', text: 'library resource' },
    { title: 'Agent dataset', keywords: '', text: 'library resource' },
    { title: 'Unrelated', keywords: '', text: 'nothing relevant' },
  ];
  const idx = createIndex(corpus, { title: 3, keywords: 2, text: 1 });
  const query = variants('coding agent harness', {}).variants;
  assert.deepEqual([...idx.search(query).keys()], [0], 'without a filter the weak matches fall below the cut');
  assert.deepEqual([...idx.search(query, i => i > 0).keys()].sort(), [1, 2], 'inside the filter they are the best matches');
});
