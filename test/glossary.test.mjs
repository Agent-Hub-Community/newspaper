import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glossaryJson, glossaryMarkdown, mergedAliases, normalizeGlossary, readGlossary } from '../lib/glossary.mjs';
import { normalizeLibrary, readLibrary } from '../lib/library.mjs';

const library = normalizeLibrary({ version: 1, through: '2026-10-13', aliases: { OpenAI: ['open ai'] }, items: [{
  id: 'gpt', title: 'GPT', summary: '模型发布。', type: 'model', topics: ['models'], keywords: ['OpenAI', 'GPT', 'Codex'],
  links: [{ kind: 'model', url: 'https://openai.com/' }], shares: [{ date: '2026-10-01', group: 'group-1', avatar: null }],
}] });
const entry = (overrides = {}) => ({ term: 'oai', variants: ['oa', 'open-ai'], meaning: 'OpenAI 的缩写。', category: '缩写', refersTo: 'OpenAI', keyword: 'OpenAI', ...overrides });
const glossary = terms => ({ version: 1, through: '2026-10-13', terms });

test('glossary entries are validated against the library and each other', () => {
  assert.equal(normalizeGlossary(glossary([entry()]), library).terms.length, 1);
  const invalid = {
    'unknown keyword': entry({ keyword: 'Anthropic' }),
    'unknown category': entry({ category: '外号' }),
    'private review fields': entry({ evidence: ['2026-09-29 三群 01:24'] }),
    'meaning too long': entry({ meaning: '很'.repeat(81) }),
    'reserved separator': entry({ variants: ['o|a'] }),
  };
  for (const [reason, value] of Object.entries(invalid)) assert.throws(() => normalizeGlossary(glossary([value]), library), undefined, reason);
  assert.throws(() => normalizeGlossary(glossary([entry(), entry({ term: 'OA', variants: [] })]), library), /appears in/, 'one spelling, one entry');
  assert.throws(() => normalizeGlossary(glossary([entry({ variants: ['OAI'] })]), library), /ignoring case/, 'case-only variants are redundant');
});

test('linked glossary spellings extend search aliases without shadowing keywords', () => {
  const normalized = normalizeGlossary(glossary([entry({ variants: ['oa', 'Codex'] }), entry({ term: '哈基米', variants: [], keyword: undefined, refersTo: 'Google Gemini' })]), library);
  const aliases = mergedAliases(library, normalized);
  assert.deepEqual(aliases.OpenAI, ['open ai', 'oai', 'oa'], 'Codex is a keyword of its own and is skipped');
  assert.equal(Object.values(aliases).flat().includes('哈基米'), false, 'unlinked terms only explain');
});

test('the public copies explain terms without review evidence', () => {
  const normalized = normalizeGlossary(glossary([entry()]), library);
  const json = glossaryJson(normalized);
  assert.deepEqual(Object.keys(json.terms[0]).sort(), ['category', 'keyword', 'meaning', 'refersTo', 'term', 'variants']);
  assert.equal(json.terms[0].keyword, 'OpenAI');
  assert.match(glossaryMarkdown(normalized), /- oai（也写作 oa、open-ai）：OpenAI 的缩写。 指 OpenAI。/);
});

test('the published glossary validates against the published library', async () => {
  const dataDir = new URL('../data/', import.meta.url).pathname;
  const normalized = normalizeGlossary(await readGlossary(dataDir), normalizeLibrary(await readLibrary(dataDir)));
  for (const term of normalized.terms) assert.doesNotMatch(term.meaning, /群友|成员|某人/, `${term.term} must explain a concept, not a member`);
});
