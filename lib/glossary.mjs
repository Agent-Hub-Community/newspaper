// The group jargon glossary (glossary.json): validation, the merged search aliases it feeds into the library,
// and its page and agent copies. Entries explain terms only; none may point at a member (GLOSSARY_REVIEW.md).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { md } from './library.mjs';
import { site } from './site.mjs';

export const glossaryUrl = `${site}glossary/`;
export const CATEGORIES = ['缩写', '代号', '梗', '行话', '网络用语'];

export async function readGlossary(dir) {
  return JSON.parse(await readFile(path.join(dir, 'glossary.json'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '{"version":1,"terms":[]}';
    throw error;
  }));
}

const plain = (value, max) => typeof value === 'string' && value === value.trim() && value && [...value].length <= max && !value.includes('|');

// Validates the glossary against the library keywords it links to and returns terms sorted for reading.
export function normalizeGlossary(glossary, library) {
  if (glossary.version !== 1 || !Array.isArray(glossary.terms)) throw new Error('Invalid glossary file');
  const keywords = new Set(library.items.flatMap(item => item.keywords));
  const seen = new Map();
  const terms = glossary.terms.map(entry => {
    const extra = Object.keys(entry).filter(key => !['term', 'variants', 'meaning', 'category', 'refersTo', 'keyword'].includes(key));
    if (extra.length) throw new Error(`Unexpected glossary field: ${extra.join(', ')}`);
    if (!plain(entry.term, 30) || !plain(entry.meaning, 80) || !CATEGORIES.includes(entry.category)) throw new Error(`Invalid glossary entry ${entry.term}`);
    if (!Array.isArray(entry.variants) || entry.variants.some(variant => !plain(variant, 30))) throw new Error(`Invalid variants for ${entry.term}`);
    if (entry.refersTo !== undefined && !plain(entry.refersTo, 60)) throw new Error(`Invalid refersTo for ${entry.term}`);
    if (entry.keyword !== undefined && !keywords.has(entry.keyword)) throw new Error(`Glossary ${entry.term} links to unknown keyword ${entry.keyword}`);
    for (const spelling of [entry.term, ...entry.variants]) {
      const key = spelling.toLowerCase();
      if (seen.get(key) === entry.term) throw new Error(`Glossary ${entry.term} repeats "${spelling}" ignoring case; searches already ignore case`);
      if (seen.has(key)) throw new Error(`Glossary spelling "${spelling}" appears in ${seen.get(key)} and ${entry.term}`);
      seen.set(key, entry.term);
    }
    return { ...entry };
  });
  terms.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.term.localeCompare(b.term, 'zh-CN'));
  return { through: glossary.through, terms };
}

// Glossary spellings of a linked keyword become extra search aliases; spellings equal to the keyword are skipped.
export function mergedAliases(library, glossary) {
  const merged = Object.fromEntries(Object.entries(library.aliases || {}).map(([keyword, list]) => [keyword, [...list]]));
  const taken = new Set([...library.items.flatMap(item => item.keywords), ...Object.values(merged).flat()].map(value => value.toLowerCase()));
  for (const entry of glossary.terms.filter(entry => entry.keyword)) {
    for (const spelling of [entry.term, ...entry.variants]) {
      if (taken.has(spelling.toLowerCase())) continue;
      (merged[entry.keyword] ||= []).push(spelling);
      taken.add(spelling.toLowerCase());
    }
  }
  return merged;
}

export function glossaryJson(glossary) {
  return {
    name: 'AgentHub 群聊黑话',
    description: 'AgentHub 群里常用的缩写、代号、梗和行话。keyword 是资料库 resources.json 里对应的规范关键词。',
    page: glossaryUrl,
    through: glossary.through,
    count: glossary.terms.length,
    terms: glossary.terms.map(({ term, variants, meaning, category, refersTo, keyword }) => ({
      term, variants, meaning, category, ...(refersTo ? { refersTo } : {}),
      ...(keyword ? { keyword } : {}),
    })),
  };
}

export function glossaryMarkdown(glossary) {
  const lines = ['# AgentHub 群聊黑话', '', `> AgentHub 群里常用的缩写、代号、梗和行话，共 ${glossary.terms.length} 条，收录到 ${glossary.through}。网页：${glossaryUrl}`, ''];
  for (const category of CATEGORIES) {
    const terms = glossary.terms.filter(entry => entry.category === category);
    if (!terms.length) continue;
    lines.push(`## ${category}`, '');
    for (const entry of terms) {
      const also = entry.variants.length ? `（也写作 ${entry.variants.map(md).join('、')}）` : '';
      lines.push(`- ${md(entry.term)}${also}：${md(entry.meaning)}${entry.refersTo ? ` 指 ${md(entry.refersTo)}。` : ''}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
