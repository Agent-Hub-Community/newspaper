// Checks reviewed library batches against the candidates they came from, before assemble-library.mjs runs.
//   node scripts/check-library-review.mjs [--dir scratch/library] [curated/batch-1.json ...]
// Rules follow LIBRARY_REVIEW.md. Without file arguments every file in <dir>/curated/ is checked, and each
// candidate that still needs review must appear exactly once across them.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINK_KINDS, TOPICS, TYPES } from '../library.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dirIndex = args.indexOf('--dir');
const dir = path.resolve(dirIndex >= 0 ? args.splice(dirIndex, 2)[1] : path.join(root, 'scratch/library'));
const REASONS = new Set(['news', 'promo', 'personal', 'ephemeral', 'broken', 'local', 'offtopic', 'lowvalue', 'private']);
const { candidates } = JSON.parse(await readFile(path.join(dir, 'candidates.json'), 'utf8'));
const pending = new Set(candidates.filter(candidate => !candidate.exclude && !candidate.curated).map(candidate => candidate.key));
const known = new Set(candidates.map(candidate => candidate.key));
const files = args.length ? args.map(file => path.resolve(dir, file))
  : (await readdir(path.join(dir, 'curated'))).filter(name => name.endsWith('.json')).sort().map(name => path.join(dir, 'curated', name));

const errors = [];
const seen = new Map();
const use = (key, where) => {
  if (!known.has(key)) errors.push(`${where}: unknown candidate ${key}`);
  if (seen.has(key)) errors.push(`${where}: ${key} is also used in ${seen.get(key)}`);
  seen.set(key, where);
};
for (const file of files) {
  const review = JSON.parse(await readFile(file, 'utf8'));
  const name = path.basename(file);
  review.items.forEach((item, index) => {
    const where = `${name} item ${index} (${String(item.title).slice(0, 40)})`;
    const extra = Object.keys(item).filter(key => !['keys', 'title', 'summary', 'type', 'topics', 'keywords', 'links', 'verified', 'notes'].includes(key));
    if (extra.length) errors.push(`${where}: unexpected fields ${extra.join(', ')}`);
    if (!item.keys?.length) errors.push(`${where}: no keys`);
    for (const key of item.keys || []) use(key, where);
    if (!item.title?.trim() || item.title.length > 100) errors.push(`${where}: title empty or over 100 characters`);
    const hanzi = (item.summary?.match(/[一-鿿]/g) || []).length;
    if (!item.summary?.trim() || hanzi > 80 || item.summary.length > 160) errors.push(`${where}: summary empty or too long`);
    if (/不是.{0,30}而是|本文|该工作|重磅|颠覆/.test(item.summary || '')) errors.push(`${where}: summary uses a banned phrase`);
    if (!TYPES[item.type]) errors.push(`${where}: unknown type ${item.type}`);
    const topics = item.topics || [];
    if (topics.length < 1 || topics.length > 3 || new Set(topics).size !== topics.length || topics.some(topic => !TOPICS[topic])) errors.push(`${where}: topics must be 1 to 3 known values`);
    const keywords = item.keywords || [];
    if (keywords.length < 3 || keywords.length > 12 || new Set(keywords.map(keyword => keyword.toLowerCase())).size !== keywords.length ||
        keywords.some(keyword => !keyword.trim() || keyword.length > 30 || keyword.includes('|'))) errors.push(`${where}: keywords must be 3 to 12 distinct values without "|"`);
    if (!['source', 'chat-only'].includes(item.verified)) errors.push(`${where}: verified must be source or chat-only`);
    if (!item.links?.length) errors.push(`${where}: no links`);
    for (const link of item.links || []) {
      if (!item.keys?.includes(link.key)) errors.push(`${where}: link ${link.key} is not one of the item keys`);
      if (!LINK_KINDS[link.kind]) errors.push(`${where}: unknown link kind ${link.kind}`);
      if (link.url && !link.url.startsWith('https://')) errors.push(`${where}: corrected link must be https`);
    }
  });
  (review.excluded || []).forEach((entry, index) => {
    use(entry.key, `${name} excluded ${index}`);
    if (!REASONS.has(entry.reason)) errors.push(`${name} excluded ${index}: unknown reason ${entry.reason}`);
  });
}
if (!args.length) {
  const missing = [...pending].filter(key => !seen.has(key));
  if (missing.length) errors.push(`${missing.length} candidates not reviewed yet: ${missing.slice(0, 10).join(', ')}`);
}
console.log(errors.length ? errors.join('\n') : `OK: ${files.length} files, ${seen.size} candidates reviewed`);
process.exitCode = errors.length ? 1 : 0;
