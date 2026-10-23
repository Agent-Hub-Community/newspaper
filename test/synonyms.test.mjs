import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSynonyms, searchVocabulary, validateSynonyms } from '../synonyms.mjs';
import { mergedAliases, normalizeGlossary, readGlossary } from '../glossary.mjs';
import { normalizeLibrary, readLibrary } from '../library.mjs';

const root = new URL('..', import.meta.url).pathname;
const entry = (term, variants, category, refersTo, keyword) => ({ term, variants, meaning: '释义。', category, refersTo, keyword });
const glossary = (...terms) => ({ terms });

test('the synonym table rejects lone spellings and a spelling in two groups', () => {
  assert.throws(() => validateSynonyms({ version: 1, groups: [['画图']] }), /2 to 8/);
  assert.throws(() => validateSynonyms({ version: 1, groups: [['画图', '绘图'], ['绘图', '作图']] }), /two synonym groups/);
});

test('abbreviations and jargon search both ways; code names only lead to what they stand for', () => {
  const { expand, groups } = searchVocabulary({ synonyms: [], glossary: glossary(
    entry('基模', ['底座'], '缩写', '基座模型'),
    entry('A社', ['人类学'], '代号', 'Anthropic', 'Anthropic'),
    entry('OA两家', [], '缩写', 'OpenAI、Anthropic'),
  ) });
  assert.deepEqual(groups, [['基模', '底座', '基座模型']]);
  assert.deepEqual(expand['人类学'], ['Anthropic'], 'a code name still finds what it stands for');
  assert.ok(!groups.flat().includes('Anthropic'), 'searching Anthropic does not also search 人类学');
  assert.deepEqual(expand['oa两家'], ['OpenAI、Anthropic'], 'a name listing several things is a target, not a spelling');
  assert.deepEqual(expand['基模'], ['基座模型'], 'slang keeps its full-weight path to the formal name');
});

test('a synonym group that names a glossary entry joins it; a glossary spelling in the table is an error', () => {
  const bmk = entry('bmk', ['bench'], '缩写', 'benchmark');
  assert.deepEqual(searchVocabulary({ synonyms: [['基准', 'Benchmark', '评测集']], glossary: glossary(bmk) }).groups,
    [['基准', 'Benchmark', '评测集', 'bmk', 'bench']]);
  assert.throws(() => searchVocabulary({ synonyms: [['基准', 'Bench']], glossary: glossary(bmk) }), /glossary entry bmk/);
  assert.throws(() => searchVocabulary({ synonyms: [['乙', '丙', '丁', '戊', '己']], glossary: glossary(entry('甲', ['子', '丑', '寅', '卯'], '行话', '乙')) }), /more than 8/,
    'merged groups stay within the eight variants bm25.js searches');
});

test('the published glossary, synonym table and keyword aliases form one vocabulary', async () => {
  const library = normalizeLibrary(await readLibrary(root));
  const terms = normalizeGlossary(await readGlossary(root), library);
  const { expand, groups } = searchVocabulary({ aliases: mergedAliases(library, terms), glossary: terms, synonyms: await readSynonyms(root) });
  const group = spelling => (groups.find(list => list.some(term => term.toLowerCase() === spelling.toLowerCase())) || []).map(term => term.toLowerCase());
  assert.ok(group('画图').includes('绘图'));
  assert.ok(group('基座模型').includes('基模') && group('基座模型').includes('base model'), 'the formal name finds the slang');
  assert.ok(group('AI味').includes('ai腔'));
  assert.deepEqual(expand['哈基米'], ['Google Gemini']);
});
