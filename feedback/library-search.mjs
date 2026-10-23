import '../site/bm25.js';
import '../site/query.js';
import { contentAPIBase, contentBase, librarySearchUrl, readingBase } from '../lib/agent-reading.mjs';

const links = { search: contentAPIBase + 'search', item: contentAPIBase + 'item', library: librarySearchUrl };
import { readerHeaders, readLimit, recordRead } from './agent-reads.mjs';
import { relevance, searchReading, zeroResultHint } from './search-explain.mjs';
import { recordSearch } from './api-searches.mjs';

const { createSearcher } = globalThis.AgentHubQuery;
const norm = value => value.normalize('NFKC').trim().toLowerCase();

// One index per warm isolate. Coalesce cold loads; a failed refresh keeps the previous data, marked stale.
export function createLibrarySearch(fetchContent = fetch, now = Date.now) {
  let cached, pending, expires = 0, retryAt = 0;
  // After a failed refresh the previous data keeps serving, marked stale, until a refresh succeeds.
  async function load() {
    if (cached && now() < expires) return cached;
    if (pending) return pending;
    if (now() < retryAt) { if (cached) return { ...cached, stale: true }; throw new Error('Library unavailable'); }
    // Every request waiting on this refresh gets the previous data when it fails, not only the one that started it.
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
      const vocabulary = data.vocabulary || { expand, groups: [] };
      const index = createSearcher(data.items, vocabulary);
      cached = { data, index, aliases, loadedAt: new Date(now()).toISOString() };
      expires = now() + 5 * 60e3;
      return cached;
    })().catch(error => {
      retryAt = now() + 30e3;
      if (cached) return { ...cached, stale: true };
      throw error;
    }).finally(() => { pending = null; });
    return pending;
  }

  return async function librarySearch(request, env, ctx) {
    const json = (value, status = 200) => Response.json(value, { status, headers: readerHeaders });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204,
      headers: { ...readerHeaders, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
    if (request.method !== 'GET') return json({ error: 'Use GET', code: 'method_not_allowed', links }, 405);
    const params = new URL(request.url).searchParams;
    const allowed = new Set(['q', 'type', 'topic', 'keyword', 'limit', 'offset', 'revision', 'analytics_test']);
    const extra = [...params.keys()].find(key => !allowed.has(key) || params.getAll(key).length !== 1);
    if (extra) {
      return json({ error: allowed.has(extra) ? `Repeated parameter: ${extra}` : `Unknown parameter: ${extra}`,
        code: 'invalid_parameter', param: extra, allowed: [...allowed], links }, 400);
    }
    // An empty value means the parameter was not given, as in the content API.
    const get = name => params.get(name) || '';
    const q = get('q').normalize('NFKC').trim();
    const type = get('type'), topic = get('topic'), keyword = get('keyword').normalize('NFKC').trim(), revision = get('revision');
    const limitText = get('limit') || '5', offsetText = get('offset') || '0';
    const invalid = [
      ['q', [...q].length > 120, 'at most 120 characters'],
      ['keyword', [...keyword].length > 120, 'at most 120 characters'],
      ['type', type.length > 64, 'a type id from available.types'],
      ['topic', topic.length > 64, 'a topic id from available.topics'],
      ['limit', !/^(?:[1-9]|1[0-9]|20)$/.test(limitText), 'an integer from 1 to 20'],
      ['offset', !/^(?:0|[1-9][0-9]{0,4})$/.test(offsetText), 'an integer from 0 to 99999'],
      ['revision', revision && !/^[a-f0-9]{64}$/.test(revision), '64 lowercase hex characters from an earlier library response'],
      ['analytics_test', params.has('analytics_test') && params.get('analytics_test') !== '1', '1'],
    ].find(([, bad]) => bad);
    if (invalid) {
      const [param, , expected] = invalid;
      return json({ error: `Invalid ${param}: expected ${expected}`, code: 'invalid_parameter', param, expected, links }, 400);
    }
    const limited = await readLimit(request, env, { json: true });
    if (limited) return limited;
    let response;
    try {
      const { data, index, aliases, loadedAt, stale } = await load();
      const meta = { schema_version: 1, revision: data.revision || null, source_loaded_at: loadedAt, ...(stale ? { stale: true } : {}), links };
      if (revision && revision !== data.revision) {
        // The library has its own revision; one from /content/ never matches here.
        const restart = new URL(request.url);
        restart.searchParams.delete('revision');
        restart.searchParams.delete('offset');
        return recordRead(request, env, 'library/search', json({ ...meta,
          error: 'Library changed, or the revision came from another endpoint; restart at restart_url',
          code: 'revision_conflict', restart_url: restart.href }, 409));
      }
      const available = { types: data.types, topics: data.topics };
      const unknown = [['type', type, data.types], ['topic', topic, data.topics]].find(([, value, list]) => value && !list.some(x => x.id === value));
      if (unknown) {
        const [param, value] = unknown;
        return json({ ...meta, error: `Unknown ${param}: ${value}`, code: 'invalid_parameter', param, available }, 400);
      }
      const key = keyword ? aliases.get(norm(keyword)) : '';
      if (keyword && !key) {
        return json({ ...meta, error: `Unknown keyword: ${keyword}`, code: 'invalid_parameter', param: 'keyword',
          hint: 'keyword takes a recorded keyword or alias; search free text with q', available }, 400);
      }
      const fits = item => (!type || item.type === type) && (!topic || item.topics.includes(topic))
        && (!key || item.keywords.some(k => norm(k) === norm(key)));
      // Filters apply inside the search, so relevance is judged among the items the reader asked for.
      const keep = type || topic || key ? i => fits(data.items[i]) : undefined;
      const read = q ? index.explain(q, keep) : null;
      const matches = read?.matches || null;
      const top = matches ? Math.max(0, ...[...matches.values()].map(match => match.score)) : 0;
      const found = data.items.map((item, i) => ({ item, score: matches?.get(i)?.score || 0, i }))
        .filter(({ item, i }) => (!matches || matches.has(i)) && fits(item))
        .sort((a, b) => b.score - a.score || a.i - b.i);
      const limit = Number(limitText), offset = Number(offsetText);
      const items = found.slice(offset, offset + limit).map(({ item, score }) => ({
        id: item.id, content_id: `library:${item.id}`,
        detail_url: `${contentAPIBase}item?${new URLSearchParams({ id: `library:${item.id}` })}`, title: item.title, ...(matches ? { relevance: relevance(score, top) } : {}), summary: item.summary, type: item.type, topics: item.topics,
        keywords: item.keywords, links: item.links, shared: item.shared, related: item.related, url: item.url,
        discussions: item.discussions.map(d => ({ ...d, read_url: d.read_url || (d.kind === 'weekly'
          ? `${readingBase}weekly/${d.from}/${d.date}/index.md`
          : `${readingBase}daily/${d.date}/${d.group}/index.md`) })),
        // discussions list only topics that cite one of the item's links. Topics that name the work without its link,
        // and shares from before the dailies began, are reached by searching for its name.
        discussion_search_url: `${contentAPIBase}search?${new URLSearchParams({ q: item.title.split(/[:：]/)[0].trim().slice(0, 120) })}`,
      }));
      const next = offset + items.length < found.length ? offset + items.length : null;
      const nextUrl = new URL(request.url);
      nextUrl.searchParams.set('offset', String(next));
      if (data.revision) nextUrl.searchParams.set('revision', data.revision);
      response = json({ ...meta, query: { q, type, topic, keyword: key, ...(read ? searchReading(read, q) : {}) },
        total: found.length, limit, offset, next_offset: next, next_url: next === null ? null : nextUrl.href,
        ...(read ? zeroResultHint(read, q, request.url, rest => index.search(rest, keep).size > 0) : {}),
        coverage: data.coverage, ...(offset === 0 || !found.length ? { available } : {}), items });
      await recordSearch(request, env, ctx, { endpoint: 'library/search', q, filters: { type, topic, keyword: key },
        total: found.length, read });
    } catch {
      response = json({ error: 'Library temporarily unavailable; retry later', code: 'upstream_unavailable',
        retry_after_seconds: 30, links }, 503);
      response.headers.set('Retry-After', '30');
    }
    // Count the endpoint and status here; recordSearch keeps the redacted text of first-page searches.
    return recordRead(request, env, 'library/search', response);
  };
}

export const librarySearch = createLibrarySearch();
