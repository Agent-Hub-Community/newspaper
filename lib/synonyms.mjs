// The search vocabulary: interchangeable spellings (search-synonyms.json) merged with the keyword aliases and the
// glossary. A query that uses one spelling also finds items written with another; bm25.js scores those matches a
// little lower.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function validateSynonyms(file) {
  if (!file || file.version !== 1 || !Array.isArray(file.groups)) throw new Error('search-synonyms.json needs version 1 and groups');
  const seen = new Map();
  for (const group of file.groups) {
    if (!Array.isArray(group) || group.length < 2 || group.length > 8) throw new Error(`A synonym group needs 2 to 8 spellings: ${JSON.stringify(group)}`);
    for (const term of group) {
      if (typeof term !== 'string' || !term.trim() || term !== term.trim() || term.includes('|')) throw new Error(`Invalid synonym: ${JSON.stringify(term)}`);
      const key = term.toLowerCase();
      if (seen.has(key)) throw new Error(`“${term}” appears in two synonym groups`);
      seen.set(key, group);
    }
  }
  return file.groups;
}

export async function readSynonyms(dir) {
  return validateSynonyms(JSON.parse(await readFile(path.join(dir, 'search-synonyms.json'), 'utf8')));
}

// Glossary categories whose spellings all name one thing, so a search for any of them, the formal name included,
// finds the others. Code names and in-jokes (代号, 梗) only lead to what they stand for: a search for Anthropic
// should not also search “人类学”.
const BOTH_WAYS = new Set(['缩写', '行话', '网络用语']);

// expand maps a spelling (lower case) one way to what it stands for: library keyword aliases and every glossary
// spelling. groups are searched both ways: the synonym table and the glossary entries above with their formal
// names. Groups sharing a spelling merge, so 基准/Benchmark/评测集 joins bmk/bench/benchmark through benchmark.
// A glossary spelling must not also be in the synonym table, so each term is maintained in one place.
export function searchVocabulary({ aliases = {}, glossary, synonyms }) {
  const owner = new Map(glossary.terms.flatMap(entry => [entry.term, ...entry.variants].map(spelling => [spelling.toLowerCase(), entry.term])));
  for (const term of synonyms.flat()) {
    if (owner.has(term.toLowerCase())) throw new Error(`“${term}” is a spelling in glossary entry ${owner.get(term.toLowerCase())}; keep it in glossary.json and remove it from search-synonyms.json`);
  }
  const expand = {};
  const add = (spelling, target) => {
    const key = spelling.toLowerCase();
    if (key !== target.toLowerCase() && !(expand[key] ||= []).includes(target)) expand[key].push(target);
  };
  for (const [keyword, list] of Object.entries(aliases)) for (const alias of list) add(alias, keyword);
  const groups = [...synonyms];
  for (const entry of glossary.terms) {
    const spellings = [entry.term, ...entry.variants], names = [entry.refersTo, entry.keyword].filter(Boolean);
    for (const spelling of spellings) for (const name of names) add(spelling, name);
    // A formal name listing several things (“OpenAI、Anthropic”) is not another spelling of the entry.
    if (BOTH_WAYS.has(entry.category) && !names.some(name => name.includes('、'))) groups.push([...spellings, ...names]);
  }
  const merged = merge(groups);
  // bm25.js searches at most eight variants: the query and seven other spellings.
  const large = merged.find(group => group.length > 8);
  if (large) throw new Error(`Search group ${large.join(' / ')} has more than 8 spellings; split the synonym group or drop rare spellings`);
  return { expand, groups: merged };
}

// Groups sharing a spelling (ignoring case) become one; each spelling is kept once, as first written.
function merge(groups) {
  let merged = [];
  for (const group of groups) {
    const keys = new Set(group.map(term => term.toLowerCase()));
    const joined = merged.filter(other => other.some(term => keys.has(term.toLowerCase())));
    const spellings = new Map();
    for (const term of [...joined.flat(), ...group]) if (!spellings.has(term.toLowerCase())) spellings.set(term.toLowerCase(), term);
    merged = [...merged.filter(other => !joined.includes(other)), [...spellings.values()]];
  }
  return merged.filter(group => group.length > 1);
}
