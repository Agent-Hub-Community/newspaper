// Computes document embeddings for the reader API's semantic search and updates semantic-vectors.json.
// Only entries that are new or whose text changed are sent (one daily issue: about 30 entries, 10 seconds).
// Run after a public build and before committing:
//
//   FEEDBACK_API_URL=https://agenthub-feedback.haoqingeric.workers.dev npm run build -- --public
//   CLOUDFLARE_ACCOUNT_ID=... node scripts/embed-catalog.mjs
//
// CLOUDFLARE_ACCOUNT_ID names the Cloudflare account that runs Workers AI (`npx wrangler whoami` lists it).
// The token comes from CLOUDFLARE_API_TOKEN, or else from the local Wrangler login (`wrangler auth token`, which
// refreshes it); it needs Workers AI permission and is never written. Entries no longer in the catalog are dropped.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEMANTIC_DIMENSIONS, SEMANTIC_MODEL, embeddingText, quantize, serializeVectors, textHash } from '../lib/semantic.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!/^[0-9a-f]{32}$/.test(account || '')) {
  throw new Error('Set CLOUDFLARE_ACCOUNT_ID to the 32-character Cloudflare account ID that runs Workers AI (`npx wrangler whoami` lists it).');
}
function wranglerToken() {
  try {
    const output = execFileSync('npx', ['-y', 'wrangler@4', 'auth', 'token', '--json'],
      { cwd: path.join(root, 'feedback'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 });
    return JSON.parse(output).token;
  } catch {
    return '';
  }
}
const token = process.env.CLOUDFLARE_API_TOKEN || wranglerToken();
if (!token) throw new Error('No Cloudflare token: run `npx wrangler login` in newspaper/feedback, or set CLOUDFLARE_API_TOKEN.');
const file = path.join(root, 'semantic-vectors.json');
const catalog = JSON.parse(await readFile(path.join(root, 'dist/search/catalog.json'), 'utf8'));
const stored = await readFile(file, 'utf8').then(JSON.parse, error => {
  if (error.code === 'ENOENT') return { schema_version: 1, model: SEMANTIC_MODEL, dimensions: SEMANTIC_DIMENSIONS, vectors: {} };
  throw error;
});
if (stored.model !== SEMANTIC_MODEL) throw new Error(`semantic-vectors.json holds ${stored.model}; delete it to re-embed with ${SEMANTIC_MODEL}`);

const pending = catalog.entries.map(entry => ({ id: entry.id, text: embeddingText(entry) }))
  .filter(item => stored.vectors[item.id]?.hash !== textHash(item.text));
let tokens = 0;
for (let i = 0; i < pending.length; i += 16) {
  const batch = pending.slice(i, i + 16);
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${SEMANTIC_MODEL}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    // Plain text, as the worker sends its query: no model-side template differs between the two sides.
    body: JSON.stringify({ text: batch.map(item => item.text) }), signal: AbortSignal.timeout(120000),
  });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(`Workers AI ${response.status}: ${JSON.stringify(body.errors)}`);
  const vectors = body.result.data;
  if (vectors.length !== batch.length || vectors.some(vector => vector.length !== SEMANTIC_DIMENSIONS)) throw new Error('Unexpected embedding shape');
  batch.forEach((item, k) => { stored.vectors[item.id] = { hash: textHash(item.text), ...quantize(vectors[k]) }; });
  tokens += batch.reduce((sum, item) => sum + item.text.length, 0);
  console.log(`${Math.min(i + batch.length, pending.length)}/${pending.length}`);
}
const ids = new Set(catalog.entries.map(entry => entry.id));
for (const id of Object.keys(stored.vectors)) if (!ids.has(id)) delete stored.vectors[id];
await writeFile(file, serializeVectors(stored));
console.log(JSON.stringify({ embedded: pending.length, stored: Object.keys(stored.vectors).length, characters: tokens }));
