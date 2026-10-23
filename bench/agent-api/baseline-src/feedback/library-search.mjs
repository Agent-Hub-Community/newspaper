import '../bm25.js';
import { contentBase, readingBase } from '../agent-reading.mjs';
import { readerHeaders, readLimit, recordRead } from './agent-reads.mjs';

const { createIndex, variants } = globalThis.AgentHubBM25;
const norm = value => value.normalize('NFKC').trim().toLowerCase();

// One index per warm isolate. Coalesce cold loads; a failed refresh never serves stale data.
export function createLibrarySearch(fetchContent = fetch, now = Date.now) {
  let cached, pending, expires = 0, retryAt = 0;
  async function load() {
    if (cached && now() < expires) return cached;
    if (pending) return pending;
    if (now() < retryAt) throw new Error('Library unavailable');
    pending = (async () => {
      const response = await fetchContent(contentBase + 'library/resources.json', { redirect: 'manual',
        signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'AgentHub-Library/1.0' } });
      if (response.status !== 200) { await response.body?.cancel(); throw new Error('Library unavailable'); }
      const data = await response.json();
      if (!Array.isArray(data.items) || !Array.isArray(data.types) || !Array.isArray(data.topics) || !Array.isArray(data.keywords)) {
        throw new Error('Invalid library');
      }
      const expand = {}, aliases = new Map();
      for (const { keyword, aliases: names = [] } of data.keywords) {
        aliases.set(norm(keyword), keyword);
        for (const name of names) { aliases.set(norm(name), keyword); expand[norm(name)] = [keyword]; }
      }
      const index = createIndex(data.items.map(item => ({ title: item.title, keywords: item.keywords.join(' '),
        text: [item.summary, ...item.links.map(link => link.url)].join(' ') })), { title: 3, keywords: 2, text: 1 });
      cached = { data, index, expand, aliases, loadedAt: new Date(now()).toISOString() };
      expires = now() + 5 * 60e3;
      return cached;
    })();
    try { return await pending; }
    catch (error) { retryAt = now() + 30e3; throw error; }
    finally { pending = null; }
  }

  return async function librarySearch(request, env) {
    const json = (value, status = 200) => Response.json(value, { status, headers: readerHeaders });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204,
      headers: { ...readerHeaders, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
    if (request.method !== 'GET') return json({ error: 'Use GET' }, 405);
    const params = new URL(request.url).searchParams;
    const allowed = new Set(['q', 'type', 'topic', 'keyword', 'limit', 'offset', 'analytics_test']);
    if ([...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1)) {
      return json({ error: 'Unknown or repeated parameter', allowed: [...allowed] }, 400);
    }
    const q = (params.get('q') || '').normalize('NFKC').trim();
    const type = params.get('type') || '', topic = params.get('topic') || '', keyword = params.get('keyword') || '';
    const limitText = params.get('limit') || '10', offsetText = params.get('offset') || '0';
    if (q.length > 120 || keyword.length > 120 || type.length > 64 || topic.length > 64
      || !/^(?:[1-9]|1[0-9]|20)$/.test(limitText) || !/^(?:0|[1-9][0-9]{0,4})$/.test(offsetText)
      || (params.has('analytics_test') && params.get('analytics_test') !== '1')) {
      return json({ error: 'q/keyword max 120 characters; limit 1..20; offset 0..99999; analytics_test must be 1' }, 400);
    }
    const limited = await readLimit(request, env);
    if (limited) return limited;
    let response;
    try {
      const { data, index, expand, aliases, loadedAt } = await load();
      const available = { types: data.types, topics: data.topics };
      if ((type && !data.types.some(x => x.id === type)) || (topic && !data.topics.some(x => x.id === topic))) {
        return json({ error: 'Unknown type or topic', available }, 400);
      }
      const key = keyword ? aliases.get(norm(keyword)) || keyword : '';
      const matches = q ? index.search(variants(q, expand).variants) : null;
      const found = data.items.map((item, i) => ({ item, score: matches?.get(i)?.score || 0, i }))
        .filter(({ item, i }) => (!matches || matches.has(i)) && (!type || item.type === type)
          && (!topic || item.topics.includes(topic)) && (!key || item.keywords.some(k => norm(k) === norm(key))))
        .sort((a, b) => b.score - a.score || a.i - b.i);
      const limit = Number(limitText), offset = Number(offsetText);
      const items = found.slice(offset, offset + limit).map(({ item }) => ({
        id: item.id, title: item.title, summary: item.summary, type: item.type, topics: item.topics,
        keywords: item.keywords, links: item.links, shared: item.shared, related: item.related, url: item.url,
        discussions: item.discussions.map(d => ({ ...d, read_url: `${readingBase}daily/${d.date}/${d.group}/index.md` })),
      }));
      response = json({ schema_version: 1, query: { q, type, topic, keyword: key }, total: found.length, limit, offset,
        next_offset: offset + items.length < found.length ? offset + items.length : null,
        coverage: data.coverage, source_loaded_at: loadedAt, available, items });
    } catch {
      response = json({ error: 'Library temporarily unavailable; retry later' }, 503);
    }
    // Query text is deliberately not stored. Only this fixed endpoint and response metadata are counted.
    return recordRead(request, env, 'library/search', response);
  };
}

export const librarySearch = createLibrarySearch();
