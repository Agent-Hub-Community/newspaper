// Merges reviewed library batches into library.json and stages sharer avatars for review.
//   node scripts/assemble-library.mjs [--dir scratch/library]
// Inputs under --dir: candidates.json (written by the private pipeline's chat collector), curated/*.json
// (reviewed batches, see GUIDE.md) and avatar-review.json ({ "approved": [file], "rejected": [file] }).
// Only approved avatars are copied into library-avatars/; new ones wait in <dir>/avatars-pending/ and their
// shares show the group without an avatar until a later run. Items already in library.json keep their id and
// wording, so edit published wording in library.json; curated batches only add new items.
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalUrl, normalizeLibrary, resourceKey } from '../lib/library.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = process.argv.indexOf('--dir');
const dir = path.resolve(index >= 0 ? process.argv[index + 1] : path.join(root, 'scratch/library'));
const read = async (file, fallback) => JSON.parse(await readFile(file, 'utf8').catch(error => {
  if (error.code === 'ENOENT' && fallback !== undefined) return JSON.stringify(fallback);
  throw error;
}));
const { since, candidates, members = {}, generatedFrom, operators } = await read(path.join(dir, 'candidates.json'));
const byKey = new Map(candidates.map(candidate => [candidate.key, candidate]));
const review = await read(path.join(dir, 'avatar-review.json'), { approved: [], rejected: [] });
const existing = await read(path.join(root, 'library.json'), { version: 1, through: generatedFrom.through, items: [] });

// Avatars are cached per member hash; the public file name is a hash of the image bytes.
const cacheDir = path.join(dir, 'avatar-cache');
const pendingDir = path.join(dir, 'avatars-pending');
await mkdir(cacheDir, { recursive: true, mode: 0o700 });
await rm(pendingDir, { recursive: true, force: true });
await mkdir(pendingDir, { recursive: true, mode: 0o700 });
await mkdir(path.join(root, 'library-avatars'), { recursive: true });
const cached = new Set(await readdir(cacheDir));
const pending = new Set();
const avatars = new Map();
async function avatar(sender) {
  if (!sender) return null;
  if (avatars.has(sender)) return avatars.get(sender);
  let file = null;
  try {
    let name = [...cached].find(entry => entry.startsWith(`${sender}.`));
    if (!name) {
      const source = members[sender]?.avatarUrl;
      if (!source) throw new Error('No avatar');
      const url = new URL(source);
      if (!(/(^|\.)qlogo\.cn$/.test(url.hostname) || url.hostname === 'mmhead.c2c.wechat.com')) throw new Error('Unexpected avatar host');
      url.protocol = 'https:';
      const response = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'error' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const ext = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'jpg'
        : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' : null;
      if (!ext || bytes.length > 2_000_000) throw new Error('Invalid image');
      name = `${sender}.${ext}`;
      await writeFile(path.join(cacheDir, name), bytes, { mode: 0o600 });
      cached.add(name);
    }
    const bytes = await readFile(path.join(cacheDir, name));
    const candidate = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}${path.extname(name)}`;
    if (review.approved.includes(candidate)) {
      await copyFile(path.join(cacheDir, name), path.join(root, 'library-avatars', candidate));
      file = candidate;
    } else if (!review.rejected.includes(candidate)) {
      await copyFile(path.join(cacheDir, name), path.join(pendingDir, candidate));
      pending.add(candidate);
    }
  } catch (error) {
    console.warn(`avatar unavailable for one sharer: ${error.message}`);
  }
  avatars.set(sender, file);
  return file;
}

// The account that posts the daily updates also relays outside links into every group. Its posts are not
// member shares: they never show an avatar and only count when no member shared the link. The collector lists
// its member hashes in candidates.json; a file without that list treats every sender as a member.
const OPERATORS = new Set(operators || []);
if (!operators) console.warn('candidates.json lists no operators: relayed links count as member shares. Rerun the chat collector to add them.');

// One share per sharer and group, at its earliest date; an unknown sharer only shows when the group has no known one.
async function shares(keys) {
  const all = keys.flatMap(key => byKey.get(key)?.shares || []);
  const members = all.filter(share => !OPERATORS.has(share.sender));
  const relayed = all.filter(share => OPERATORS.has(share.sender)).sort((a, b) => a.date.localeCompare(b.date));
  const earliest = new Map();
  for (const share of members.length ? members : relayed.slice(0, 1).map(share => ({ ...share, sender: null }))) {
    const sender = share.quoted ? null : share.sender || null;
    const id = `${share.group}/${sender || '?'}`;
    if (!earliest.has(id) || share.date < earliest.get(id).date) earliest.set(id, { date: share.date, group: share.group, sender });
  }
  const known = new Set([...earliest.values()].filter(share => share.sender).map(share => share.group));
  const result = [];
  for (const share of [...earliest.values()].filter(share => share.sender || !known.has(share.group))) {
    result.push({ date: share.date, group: share.group, avatar: await avatar(share.sender) });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.group.localeCompare(b.group));
}

// Ids are permanent once published (hearts are keyed by them). Prefer the project name before a colon, then the
// title's ASCII words; titles without them fall back to the arXiv id, repository or host, and opaque article
// hosts get the type plus a short hash.
const words = value => value.normalize('NFKD').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const opaque = /^(?:mp\.weixin\.qq\.com|(?:www\.|zhuanlan\.)?zhihu\.com|x\.com|(?:www\.)?bilibili\.com|b23\.tv)$/;
function slug({ title, type, links, keys }) {
  const head = /[:：]/.test(title) ? words(title.split(/[:：]/)[0]) : [];
  let parts = head.join('').length >= 3 ? head : words(title);
  while (/^\d+$/.test(parts[0] || '')) parts.shift();
  if (parts.join('').length < (parts === head ? 3 : 6)) {
    const key = resourceKey(links[0].url), host = new URL(links[0].url).hostname;
    if (key.startsWith('arxiv:')) parts = ['arxiv', ...words(key.slice(6))];
    else if (key.startsWith('github:')) parts = words(key.split('/')[1]);
    else if (!opaque.test(host)) parts = words(`${host.replace(/^www\./, '')} ${new URL(links[0].url).pathname}`);
    else return `${type}-${createHash('sha256').update(keys[0]).digest('hex').slice(0, 8)}`;
  }
  let id = '';
  for (const part of parts) {
    if (id && id.length + part.length + 1 > 40) break;
    id = id ? `${id}-${part}` : part.slice(0, 40);
  }
  return id;
}
const ids = new Set(existing.items.map(item => item.id));
const existingByKey = new Map(existing.items.flatMap(item => [...item.links.map(link => link.url), ...(item.aliases || [])]
  .map(url => [resourceKey(url), item])));
const items = [...existing.items];
let added = 0, merged = 0;
for (const file of (await readdir(path.join(dir, 'curated'))).filter(name => name.endsWith('.json')).sort()) {
  for (const curated of (await read(path.join(dir, 'curated', file))).items) {
    const missing = curated.keys.filter(key => !byKey.has(key));
    if (missing.length) throw new Error(`${file}: unknown candidate keys ${missing.join(', ')}`);
    const links = curated.links.map(link => ({ kind: link.kind, url: canonicalUrl(link.url || byKey.get(link.key).url) }));
    const linkKeys = new Set(links.map(link => resourceKey(link.url)));
    const aliases = [...new Set(curated.keys.flatMap(key => [byKey.get(key).url, ...byKey.get(key).urls]).map(canonicalUrl))]
      .filter(url => !linkKeys.has(resourceKey(url)));
    const found = [...linkKeys, ...aliases.map(resourceKey)].map(key => existingByKey.get(key)).find(Boolean);
    const itemShares = await shares(curated.keys);
    if (found) {
      // A reviewed item keeps its wording. Shares inside this candidate window are recomputed, so a newly
      // approved avatar replaces the earlier avatar-less record; older shares stay as they were.
      const foundKeys = [...found.links.map(link => link.url), ...(found.aliases || [])].map(resourceKey);
      const recomputed = await shares([...new Set([...curated.keys, ...foundKeys])].filter(key => byKey.has(key)));
      found.shares = [...found.shares.filter(share => share.date < since), ...recomputed];
      found.aliases = [...new Set([...(found.aliases || []), ...aliases, ...links.map(link => link.url)])]
        .filter(url => !found.links.some(link => resourceKey(link.url) === resourceKey(url)));
      merged++;
      continue;
    }
    const base = slug({ ...curated, links });
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    const item = { id, title: curated.title, summary: curated.summary, type: curated.type, topics: curated.topics, keywords: curated.keywords, links,
      ...(aliases.length ? { aliases } : {}), shares: itemShares };
    items.push(item);
    for (const key of [...linkKeys, ...aliases.map(resourceKey)]) existingByKey.set(key, item);
    added++;
  }
}
const first = item => item.shares.map(share => share.date).sort()[0];
items.sort((a, b) => first(b).localeCompare(first(a)) || a.id.localeCompare(b.id));
const through = [existing.through, generatedFrom.through].sort().at(-1);
const library = { version: 1, through, items };
normalizeLibrary(library);
await writeFile(path.join(root, 'library.json'), `${JSON.stringify(library, null, 2)}\n`);
// Drop approved files no share uses any more, so the repository only carries published avatars.
const used = new Set(items.flatMap(item => item.shares.map(share => share.avatar)).filter(Boolean));
for (const name of await readdir(path.join(root, 'library-avatars'))) if (!used.has(name)) await rm(path.join(root, 'library-avatars', name));
await writeFile(path.join(dir, 'avatar-pending.json'), `${JSON.stringify([...pending].sort(), null, 2)}\n`);
console.log(JSON.stringify({ items: items.length, added, merged, through, avatars: used.size, pendingAvatars: pending.size }, null, 2));
if (pending.size) console.log(`Review ${path.relative(root, pendingDir)}/ and list each file in avatar-review.json, then run again.`);
