// Semantic search for the reader API. Every catalog entry has a stored embedding; the worker embeds the query with
// the same model through Workers AI and fuses the cosine ranking with BM25 (feedback/semantic-search.mjs).
// The browser search page stays lexical, so its queries never leave the reader's machine.
//
// `node scripts/embed-catalog.mjs` computes the vectors with Workers AI and stores them in semantic-vectors.json,
// one entry per line, keyed by entry id and a hash of the embedded text. The build packs the vectors whose text
// still matches into search/vectors.bin (int8 rows) and search/vectors.json (ids, scales, model). An entry
// without a current vector is not ranked semantically until the script runs again; BM25 still finds it.
import { createHash } from 'node:crypto';

export const SEMANTIC_MODEL = '@cf/qwen/qwen3-embedding-0.6b';
export const SEMANTIC_DIMENSIONS = 1024;
// Qwen3 embeddings expect an instruction before a query and none before a document.
export const QUERY_INSTRUCTION = 'Given a Chinese or English search query, retrieve community discussion summaries or resources that answer it';

export const embeddingText = entry => [entry.title, (entry.keywords || []).join(' '), entry.text, entry.ai_comment]
  .filter(Boolean).join('\n');
export const textHash = text => createHash('sha256').update(text).digest('hex').slice(0, 16);

// One int8 row per vector with its own scale: a quarter of float32. On the 40 labelled queries the top-10
// neighbours were 99.8% the same as with float32 (2026-10-18).
export function quantize(vector) {
  if (vector.length !== SEMANTIC_DIMENSIONS) throw new Error(`Expected ${SEMANTIC_DIMENSIONS} dimensions, got ${vector.length}`);
  const length = Math.hypot(...vector) || 1;
  const scale = Math.max(...vector.map(x => Math.abs(x / length))) / 127 || 1;
  const bytes = Int8Array.from(vector, x => Math.round(x / length / scale));
  return { scale, int8: Buffer.from(bytes.buffer).toString('base64') };
}

export function serializeVectors(stored) {
  const ids = Object.keys(stored.vectors).sort();
  return `{"schema_version":1,"model":${JSON.stringify(stored.model)},"dimensions":${SEMANTIC_DIMENSIONS},"vectors":{\n${
    ids.map(id => `${JSON.stringify(id)}:${JSON.stringify(stored.vectors[id])}`).join(',\n')}\n}}\n`;
}

// Returns the metadata file and the binary rows for the catalog entries whose stored text hash is current.
export function packVectors(entries, stored) {
  if (stored.model !== SEMANTIC_MODEL || stored.dimensions !== SEMANTIC_DIMENSIONS) throw new Error('semantic-vectors.json uses another model');
  const kept = entries.filter(entry => stored.vectors[entry.id]?.hash === textHash(embeddingText(entry)));
  const rows = Buffer.concat(kept.map(entry => Buffer.from(stored.vectors[entry.id].int8, 'base64')));
  if (rows.length !== kept.length * SEMANTIC_DIMENSIONS) throw new Error('A stored vector has the wrong length');
  const bin = new Uint8Array(rows);
  return {
    meta: { schema_version: 1, model: stored.model, dimensions: SEMANTIC_DIMENSIONS, ids: kept.map(entry => entry.id),
      scales: kept.map(entry => stored.vectors[entry.id].scale), bytes: bin.length,
      sha256: createHash('sha256').update(bin).digest('hex'), missing: entries.length - kept.length },
    bin,
  };
}
