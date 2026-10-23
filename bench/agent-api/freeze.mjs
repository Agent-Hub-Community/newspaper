import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const hash = value => createHash('sha256').update(value).digest('hex');
try { await access(path.join(here, 'freeze.json')); throw new Error('Already frozen; create a new benchmark version instead'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const library = JSON.parse(await readFile(path.join(root, 'dist/library/resources.json'), 'utf8'));
const searchText = await readFile(path.join(root, 'dist/search/data.js'), 'utf8');
const search = JSON.parse(searchText.slice(searchText.indexOf('=') + 1).trim().replace(/;$/, ''));
const documents = {};
async function scan(directory) {
  for (const file of await readdir(path.join(root, 'dist', directory), { withFileTypes: true })) {
    const relative = path.posix.join(directory, file.name);
    if (file.isDirectory()) await scan(relative);
    else if (file.name === 'index.md') documents[relative] = await readFile(path.join(root, 'dist', relative), 'utf8');
  }
}
await scan('daily'); await scan('weekly');
documents['library/resources.json'] = JSON.stringify(library);
const corpus = { source_sha: '4f6160efeb59d87e01c97867f08cc424daa0092c', library, search, documents };
await mkdir(here, { recursive: true });
await writeFile(path.join(here, 'corpus.json'), JSON.stringify(corpus));
const files = ['corpus.json', 'cases.json', 'baseline-src/feedback/library-search.mjs',
  'baseline-src/feedback/agent-reads.mjs', 'baseline-src/feedback/schema.sql', 'baseline-src/bm25.js', 'baseline-src/agent-reading.mjs'];
const hashes = {};
for (const file of files) hashes[file] = hash(await readFile(path.join(here, file)));
// Source hashes name reader data files relative to data/.
const data = path.join(root, 'data');
const source_hashes = {};
for (const directory of ['editions', 'external-editions', 'weekly-editions']) {
  for (const file of (await readdir(path.join(data, directory))).filter(x => x.endsWith('.json')).sort()) {
    const relative = `${directory}/${file}`;
    source_hashes[relative] = hash(await readFile(path.join(data, relative)));
  }
}
source_hashes['library.json'] = hash(await readFile(path.join(data, 'library.json')));
await writeFile(path.join(here, 'freeze.json'), JSON.stringify({ source_sha: corpus.source_sha,
  frozen_at: '2026-10-17', library_count: library.items.length, search_entry_count: search.entries.length,
  document_count: Object.keys(documents).length, hashes, source_hashes }, null, 2) + '\n');
console.log(JSON.stringify({ library: library.items.length, search: search.entries.length,
  documents: Object.keys(documents).length, hashes }, null, 2));
