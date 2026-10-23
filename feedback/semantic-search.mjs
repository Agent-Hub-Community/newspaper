import { contentBase } from '../agent-reading.mjs';
import { QUERY_INSTRUCTION, SEMANTIC_MODEL } from '../semantic.mjs';

// Semantic candidates must clear this cosine similarity; below it the 2026-10-18 tests found mostly noise.
export const SIMILARITY_FLOOR = 0.5;
// Reciprocal-rank fusion constant and the number of candidates each ranking contributes.
const RRF_K = 60, DEPTH = 50;

// Loads search/vectors.json (ids, scales) and search/vectors.bin (int8 rows) once per catalog revision.
// A missing or inconsistent pair leaves search lexical; the caller reports that.
export function createVectorStore(fetchContent = fetch) {
  let store, loadedFor, pending;
  const get = path => fetchContent(contentBase + path, { redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'AgentHub-Content/1.0' } });
  return async function vectors(revision) {
    if (loadedFor === revision) return store;
    pending ||= (async () => {
      try {
        const [metaResponse, binResponse] = await Promise.all([get('search/vectors.json'), get('search/vectors.bin')]);
        if (metaResponse.status !== 200 || binResponse.status !== 200) {
          await Promise.all([metaResponse.body?.cancel(), binResponse.body?.cancel()]);
          return null;
        }
        const [meta, buffer] = await Promise.all([metaResponse.json(), binResponse.arrayBuffer()]);
        if (meta.schema_version !== 1 || meta.model !== SEMANTIC_MODEL || !Array.isArray(meta.ids)
          || buffer.byteLength !== meta.ids.length * meta.dimensions || meta.scales.length !== meta.ids.length) return null;
        return { ids: meta.ids, scales: Float32Array.from(meta.scales), matrix: new Int8Array(buffer), dimensions: meta.dimensions };
      } catch { return null; }
    })();
    try { store = await pending; loadedFor = revision; return store; } finally { pending = null; }
  };
}

// Embeds the query with Workers AI; returns null when the binding is missing, the daily allocation is used up,
// or the call fails, so the caller can say the search fell back to BM25.
export async function embedQuery(env, query) {
  if (!env.AI) return null;
  try {
    // The instruction is written into the text, as the document vectors were made, rather than relying on the
    // binding's own query template.
    const result = await env.AI.run(SEMANTIC_MODEL, { text: [`Instruct: ${QUERY_INSTRUCTION}\nQuery: ${query}`] });
    const vector = result?.data?.[0];
    if (!Array.isArray(vector)) return null;
    const length = Math.hypot(...vector) || 1;
    return vector.map(x => x / length);
  } catch {
    return null;
  }
}

// Cosine similarity of the query against every stored vector that passes `keep`, best first.
export function semanticRanking(store, query, byId, keep) {
  const { ids, scales, matrix, dimensions } = store;
  const scored = [];
  for (let row = 0; row < ids.length; row++) {
    const index = byId.get(ids[row]);
    if (index === undefined || (keep && !keep(index))) continue;
    let sum = 0;
    const offset = row * dimensions;
    for (let j = 0; j < dimensions; j++) sum += matrix[offset + j] * query[j];
    const similarity = sum * scales[row];
    if (similarity >= SIMILARITY_FLOOR) scored.push([index, similarity]);
  }
  return scored.sort((a, b) => b[1] - a[1]).slice(0, DEPTH);
}

// Fuses BM25 matches (Map index → { score }) and the semantic ranking by reciprocal rank. Returns a Map in the
// same shape as BM25 matches, with the fused score, so the response code ranks and pages it unchanged.
export function fuse(lexical, semantic) {
  const fused = new Map();
  const add = (index, rank, extra) => {
    const current = fused.get(index) || { score: 0 };
    fused.set(index, { ...current, ...extra, score: current.score + 1 / (RRF_K + rank + 1) });
  };
  [...lexical].sort((a, b) => b[1].score - a[1].score).slice(0, DEPTH)
    .forEach(([index, match], rank) => add(index, rank, { lexical: true, variant: match.variant }));
  semantic.forEach(([index, similarity], rank) => add(index, rank, { similarity: Math.round(similarity * 1000) / 1000 }));
  return fused;
}
