// Merges a reviewed opportunities batch into opportunities.json.
//   node scripts/assemble-opportunities.mjs [--dir scratch/opportunities]
// Inputs: <dir>/candidates.json (collect-opportunity-candidates.mjs) and <dir>/reviewed.json (OPPORTUNITY_REVIEW.md).
// Every candidate must be reviewed exactly once. Items already in opportunities.json keep their id and wording; a
// later share of the same opportunity only adds its share record. Shares keep the date and group, never a sender.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalUrl, resourceKey } from '../lib/library.mjs';
import { normalizeOpportunities, readOpportunities } from '../lib/opportunities.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = process.argv.indexOf('--dir');
const dir = path.resolve(index >= 0 ? process.argv[index + 1] : path.join(root, 'scratch/opportunities'));
const { candidates, through } = JSON.parse(await readFile(path.join(dir, 'candidates.json'), 'utf8'));
const reviewed = JSON.parse(await readFile(path.join(dir, 'reviewed.json'), 'utf8'));
const byKey = new Map(candidates.map(candidate => [candidate.key, candidate]));
const REASONS = new Set(['promo', 'question', 'idea', 'work', 'duplicate', 'unclear']);

const seen = new Map(), errors = [];
const use = (key, where) => {
  if (!byKey.has(key)) errors.push(`${where}: unknown candidate ${key}`);
  if (seen.has(key)) errors.push(`${where}: ${key} is also used in ${seen.get(key)}`);
  seen.set(key, where);
};
reviewed.items.forEach((item, n) => (item.keys || []).forEach(key => use(key, `item ${n} (${item.title})`)));
(reviewed.excluded || []).forEach((entry, n) => {
  use(entry.key, `excluded ${n}`);
  if (!REASONS.has(entry.reason)) errors.push(`excluded ${n}: unknown reason ${entry.reason}`);
});
const missing = candidates.filter(candidate => !seen.has(candidate.key)).map(candidate => candidate.key);
if (missing.length) errors.push(`${missing.length} candidates not reviewed: ${missing.slice(0, 5).join(', ')}`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

const existing = await readOpportunities(root);
const items = [...existing.items];
const ids = new Set(items.map(item => item.id));
const linkOwner = new Map(items.flatMap(item => item.links.map(link => [resourceKey(link.url), item])));
// Ids are permanent once published. The reviewer may name one; otherwise the organisation and title's distinct
// ASCII words, else a short hash.
const words = value => value.normalize('NFKD').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
function slug(item) {
  if (item.id) return item.id;
  const parts = [...new Set([...words(item.org), ...words(item.title)])];
  let id = parts.slice(0, 6).join('-').slice(0, 48).replace(/-+$/, '');
  if (parts.length < 2) id = `${item.kind}-${createHash('sha256').update(item.keys[0]).digest('hex').slice(0, 8)}`;
  return id;
}
let added = 0, merged = 0;
for (const curated of reviewed.items) {
  const links = (curated.links || []).map(link => ({ kind: link.kind, url: canonicalUrl(link.url || byKey.get(link.key)?.links[0]) }));
  const shares = curated.keys.flatMap(key => byKey.get(key).shares.map(share => ({ date: share.date, group: share.group })));
  const found = links.map(link => linkOwner.get(resourceKey(link.url))).find(Boolean);
  if (found) { found.shares = [...found.shares, ...shares]; merged++; continue; }
  const base = slug(curated);
  if (curated.id && ids.has(base)) { console.error(`id ${base} is already taken`); process.exit(1); }
  let id = base;
  for (let k = 2; ids.has(id); k++) id = `${base}-${k}`;
  ids.add(id);
  const item = { id, kind: curated.kind, title: curated.title, org: curated.org, summary: curated.summary,
    ...(curated.roles?.length ? { roles: curated.roles } : {}), ...(curated.location ? { location: curated.location } : {}),
    ...(curated.deadline ? { deadline: curated.deadline } : {}), ...(curated.event_date ? { event_date: curated.event_date } : {}),
    topics: curated.topics || [], links, shares };
  items.push(item);
  for (const link of links) linkOwner.set(resourceKey(link.url), item);
  added++;
}
for (const item of items) {
  item.shares = [...new Map(item.shares.map(share => [`${share.date}/${share.group}`, share])).values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.group.localeCompare(b.group));
}
const file = { version: 1, through: [existing.through, through].sort().at(-1), items: items.sort((a, b) => a.shares[0].date.localeCompare(b.shares[0].date) || a.id.localeCompare(b.id)) };
normalizeOpportunities(file);
await writeFile(path.join(root, 'opportunities.json'), `${JSON.stringify(file, null, 2)}\n`);
console.log(JSON.stringify({ items: items.length, added, merged, through: file.through }, null, 2));
