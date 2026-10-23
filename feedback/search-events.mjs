const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const targetPath = /^(?:daily\/\d{4}-\d{2}-\d{2}\/(?:group-\d{1,2}|external)\/|weekly\/[\d/_-]+\/(?:group-\d{1,2}|external)\/|library\/)#[a-zA-Z0-9_-]+$/;

// Obvious credentials and contact details: emails, URLs with or without a scheme, phone-like digit runs (also with
// spaces or dashes), common token prefixes, JWTs, WeChat ids and long unbroken letter-digit strings. Not a general
// personal-data detector. search-tracking.js applies the same pattern in the browser.
export const SENSITIVE = /@|https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|cn|net|org|io|ai|dev|app|me|co)\/\S|(?<![\d-])(?!(?:19|20)\d\d-\d\d-\d\d(?![\d-]))(?:\d[\s-]?){7,}|\b(?:sk-|sk_|pk_|rk_|ghp_|gho_|ghs_|github_pat_|glpat-|xox[abpr]-|AKIA[0-9A-Z]{8}|AIza|hf_|Bearer\s|wxid_)|\beyJ[\w-]{8,}\.|\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}/i;

// Keep obvious credentials/contact details out of the search report, even for direct API callers.
export function cleanQuery(value) {
  if (typeof value !== 'string') return '';
  const query = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (SENSITIVE.test(query)) return '[已隐藏敏感内容]';
  return query.slice(0, 120);
}

export async function searchEvents(request, env, headers) {
  const json = (value, status) => Response.json(value, { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    if (env.RATE_LIMITER && !(await env.RATE_LIMITER.limit({ key: `search:${request.headers.get('CF-Connecting-IP') || 'unknown'}` })).success) {
      return json({ error: 'Too many requests' }, 429);
    }
    // text/plain avoids a preflight on navigation; JSON is accepted for operators/tests.
    if (!/^(text\/plain|application\/json)(;|$)/i.test(request.headers.get('Content-Type') || '')) return json({ error: 'Unsupported content type' }, 415);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'Missing body' }, 400);
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); return json({ error: 'Body too large' }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let input;
    try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const s = input?.search, c = input?.click;
    const query = cleanQuery(s?.query);
    if (!s || !uuid.test(s.id || '') || !query || !Number.isSafeInteger(s.results) || s.results < 0 || s.results > 100000
      || !['', 'd', 'w', 'l', 'o'].includes(s.kind) || !/^(?:|group-\d{1,2}|external)$/.test(s.group)
      || !['', '7', '30'].includes(s.time) || !['relevance', 'new'].includes(s.sort) || typeof input.test !== 'boolean'
      || (c !== undefined && (!c || !uuid.test(c.id || '') || typeof c.target !== 'string' || c.target.length > 250
        || !targetPath.test(c.target) || !Number.isSafeInteger(c.rank) || c.rank < 1 || c.rank > s.results))) {
      return json({ error: 'Invalid search event' }, 400);
    }
    const now = new Date().toISOString();
    const statements = [env.DB.prepare(`INSERT OR IGNORE INTO search_events
      (id, query, result_count, kind, group_id, time_filter, sort, is_test, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(s.id, query, s.results, s.kind, s.group, s.time, s.sort, Number(input.test), now)];
    if (c) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO search_clicks (id, search_id, target, rank, created_at)
      SELECT ?, id, ?, ?, ? FROM search_events
      WHERE id = ? AND query = ? AND result_count = ? AND kind = ? AND group_id = ? AND time_filter = ? AND sort = ? AND is_test = ?`)
      .bind(c.id, c.target, c.rank, now, s.id, query, s.results, s.kind, s.group, s.time, s.sort, Number(input.test)));
    await env.DB.batch(statements);
    return new Response(null, { status: 204, headers });
  } catch {
    return json({ error: 'Search statistics unavailable' }, 503);
  }
}
