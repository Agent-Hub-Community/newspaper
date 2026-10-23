import { cleanQuery } from './search-events.mjs';
import { RECORD_TIMEOUT_MS, clientCategory } from './agent-reads.mjs';

// Records what readers' agents search for through the reader APIs, so the editors can see what the community
// looks for and which words the site lacks. One row per first-page search; following next_url does not count
// again. The query is redacted like site searches. No IP, User-Agent string, cookie or visitor ID is kept, and
// the daily schedule deletes rows after 30 days.
export function recordSearch(request, env, ctx, { endpoint, q, filters, total, read }) {
  try {
    const url = new URL(request.url);
    const params = Object.entries(filters).filter(([, value]) => value);
    if ((url.searchParams.get('offset') || '0') !== '0' || (!q && !params.length)) return undefined;
    const query = cleanQuery(q);
    // Unmatched words come from the query, so a redacted query keeps none of them either.
    const redacted = q && query !== q.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120);
    const unmatched = read && !redacted ? [...new Set([...read.unknown_terms, ...read.missing_versions, ...read.dropped_terms])] : [];
    const write = env.DB.prepare(`INSERT INTO api_searches
      (endpoint, query, filters, result_count, unmatched_terms, client, is_test, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(endpoint, query, params.map(([key, value]) => `${key}=${value}`).join(' '), total,
        cleanQuery(unmatched.join(' ')), clientCategory(request.headers.get('User-Agent') || ''),
        url.searchParams.get('analytics_test') === '1' ? 1 : 0, new Date().toISOString())
      .run().catch(() => console.error('API search statistics write failed'));
    // The response does not wait for the write. Without ctx (tests, other callers) it waits at most one second.
    if (ctx?.waitUntil) { ctx.waitUntil(write); return undefined; }
    let timer;
    return Promise.race([write, new Promise(resolve => { timer = setTimeout(resolve, RECORD_TIMEOUT_MS); })])
      .finally(() => clearTimeout(timer));
  } catch {
    // A statistics failure never turns a search into an error.
    console.error('API search statistics write failed');
    return undefined;
  }
}
