import '../site/bm25.js';
import '../site/query.js';
import { contentBase, readingBase } from '../agent-reading.mjs';
import { readerHeaders, readLimit, recordRead } from './agent-reads.mjs';
import { relevance, searchReading, zeroResultHint } from './search-explain.mjs';
import { recordSearch } from './api-searches.mjs';
import { createVectorStore, embedQuery, fuse, semanticRanking } from './semantic-search.mjs';

const base = new URL('/content/', readingBase).href;
const links = { search: base + 'search', editions: base + 'editions', edition: base + 'edition',
  library: new URL('/library/search', base).href };
const kinds = ['daily', 'weekly', 'library', 'opportunity'];
// Any group-N passes syntax; the published catalog decides which groups exist, so a new group needs no worker change.
const groups = /^(?:group-\d{1,2}|external)$/;
const day = value => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const json = (value, status = 200) => Response.json(value, { status, headers: readerHeaders });
const outlineUrl = (kind, date, group, revision) => base + 'edition?' + new URLSearchParams({ kind, date,
  ...(group ? { group } : {}), ...(revision ? { revision } : {}) });
const compactEdition = (edition, revision) => edition && ({ kind: edition.kind, date: edition.date,
  ...(edition.from ? { from: edition.from } : {}), ...(edition.groups ? { groups: edition.groups } : {}),
  ...(edition.url ? { url: edition.url } : {}), ...(edition.read_url ? { read_url: edition.read_url } : {}),
  outline_url: outlineUrl(edition.kind, edition.date, undefined, revision) });
const validSections = edition => kinds.slice(0, 2).includes(edition.kind) && day(edition.date)
  && (edition.kind !== 'weekly' || (day(edition.from) && edition.from <= edition.date))
  && typeof edition.url === 'string' && typeof edition.read_url === 'string'
  && Array.isArray(edition.sections) && edition.sections.length > 0
  && edition.sections.every(section => groups.test(section.group)
    && typeof section.label === 'string' && typeof section.title === 'string' && section.title.trim()
    && typeof section.summary === 'string' && typeof section.url === 'string'
    && Number.isSafeInteger(section.trend_count) && section.trend_count >= 0
    && (edition.kind !== 'daily' || typeof section.read_url === 'string'))
  && new Set(edition.sections.map(section => section.group)).size === edition.sections.length;

// First and last dates of each kind, so “nothing before August” reads as outside coverage, not as no discussion.
// A library entry counts from its first share, not the latest one its date shows.
const spans = data => Object.fromEntries(kinds.map(kind => {
  const dates = data.entries.filter(entry => entry.kind === kind)
    .flatMap(entry => [entry.from || entry.date, entry.date, ...(entry.shared || []).map(share => share.date)]).sort();
  return [kind, { from: dates[0] || null, to: dates.at(-1) || null }];
}));

// One published catalog supplies search, exact reads, and edition discovery in a warm isolate.
export function createContentAPI(fetchContent = fetch, now = Date.now) {
  let cached, pending, expires = 0, retryAt = 0;
  const vectors = createVectorStore(fetchContent);
  // After a failed refresh the previous catalog keeps serving, marked stale, until a refresh succeeds;
  // pagination is still pinned by revision. Without one, the request fails for the 30-second retry window.
  // The stale view shares the cached object's index, so a long outage does not rebuild it per search.
  const staleView = () => Object.create(cached, { stale: { value: true } });
  async function load() {
    if (cached && now() < expires) return cached;
    if (pending) return pending;
    if (now() < retryAt) { if (cached) return staleView(); throw new Error('Catalog unavailable'); }
    pending = (async () => {
      const response = await fetchContent(contentBase + 'search/catalog.json', { redirect: 'manual',
        signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'AgentHub-Content/1.0' } });
      if (response.status !== 200) { await response.body?.cancel(); throw new Error('Catalog unavailable'); }
      const data = await response.json();
      if (data.schema_version !== 1 || !/^[a-f0-9]{64}$/.test(data.revision || '')
        || !Array.isArray(data.entries) || !Array.isArray(data.editions) || !data.latest
        || !data.vocabulary || !Array.isArray(data.vocabulary.groups)
        || !data.entries.every(e => typeof e.id === 'string' && kinds.includes(e.kind) && day(e.date)
          && typeof e.title === 'string' && typeof e.text === 'string' && Array.isArray(e.keywords)
          && typeof e.read_url === 'string' && typeof e.url === 'string')
        || new Set(data.entries.map(e => e.id)).size !== data.entries.length) throw new Error('Invalid catalog');
      cached = { data, searcher: null, spans: spans(data), indexById: new Map(data.entries.map((e, i) => [e.id, i])),
        byId: new Map(data.entries.map(e => [e.id, e])), loadedAt: new Date(now()).toISOString() };
      expires = now() + 300000;
      return cached;
    })().catch(error => {
      // Every request waiting on this refresh gets the previous catalog, not only the one that started it.
      retryAt = now() + 30000;
      if (cached) return staleView();
      throw error;
    }).finally(() => { pending = null; });
    return pending;
  }

  return async function contentAPI(request, env, ctx) {
    const url = new URL(request.url), route = url.pathname.slice('/content/'.length);
    if (!['search', 'item', 'editions', 'edition'].includes(route)) return json({ error: 'Unknown endpoint', code: 'not_found', links }, 404);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204,
      headers: { ...readerHeaders, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
    if (request.method !== 'GET') return json({ error: 'Use GET', code: 'method_not_allowed', links }, 405);
    const p = url.searchParams;
    const allowed = new Set(['analytics_test', 'revision', ...(route === 'edition' ? ['kind', 'date', 'group'] : route === 'item' ? ['id']
      : ['kind', 'limit', 'offset', ...(route === 'search' ? ['q', 'group', 'from', 'to'] : [])])]);
    const extra = [...p.keys()].find(key => !allowed.has(key) || p.getAll(key).length !== 1);
    if (extra) {
      const libraryOnly = ['type', 'topic', 'keyword'].includes(extra) && route === 'search';
      return json({ error: allowed.has(extra) ? `Repeated parameter: ${extra}` : `Unknown parameter: ${extra}`,
        code: 'invalid_parameter', param: extra, allowed: [...allowed],
        ...(libraryOnly ? { hint: `${extra} filters the resource library; use ${links.library}` } : {}), links }, 400);
    }
    // An empty value means the parameter was not given, on every route and in both reader APIs.
    const get = name => p.get(name) || '';
    const q = get('q').normalize('NFKC').trim(), kind = get('kind') || (route === 'edition' ? 'daily' : ''), group = get('group');
    const date = get('date') || 'latest';
    const from = get('from'), to = get('to'), revision = get('revision');
    const limitText = get('limit') || '5', offsetText = get('offset') || '0', id = get('id');
    // Name the first invalid parameter, so an agent can fix that one value instead of rereading every rule.
    const invalid = [
      ['q', [...q].length > 120, 'at most 120 characters'],
      ['kind', kind && !(['editions', 'edition'].includes(route) ? kinds.slice(0, 2) : kinds).includes(kind),
        ['editions', 'edition'].includes(route) ? 'daily or weekly' : 'daily, weekly, library or opportunity'],
      ['group', group && !groups.test(group), 'group-N (group-1, group-2, ...) or external'],
      ['from', from && !day(from), 'a real date as YYYY-MM-DD'],
      ['to', to && !day(to), 'a real date as YYYY-MM-DD'],
      ['to', from && to && day(from) && day(to) && from > to, 'not earlier than from'],
      ['limit', !/^(?:[1-9]|1[0-9]|20)$/.test(limitText), 'an integer from 1 to 20'],
      ['offset', !/^(?:0|[1-9][0-9]{0,4})$/.test(offsetText), 'an integer from 0 to 99999'],
      ['revision', revision && !/^[a-f0-9]{64}$/.test(revision), '64 lowercase hex characters from an earlier response'],
      ['id', route === 'item' && (!id || id.length > 200), 'required; an id from a search result (library ids start with library:, opportunities with opportunity:)'],
      ['date', route === 'edition' && date !== 'latest' && !day(date), 'latest or a real date as YYYY-MM-DD'],
      ['analytics_test', p.has('analytics_test') && p.get('analytics_test') !== '1', '1'],
    ].find(([, bad]) => bad);
    if (invalid) {
      const [param, , expected] = invalid;
      return json({ error: `Invalid ${param}: expected ${expected}`, code: 'invalid_parameter', param, expected, links }, 400);
    }
    const limited = await readLimit(request, env, { json: true });
    if (limited) return limited;
    let response;
    try {
      const loaded = await load(), { data, byId, loadedAt } = loaded;
      // Readers ask for “this week” or “yesterday”; today is the Beijing date the editions use.
      const meta = { schema_version: 1, revision: data.revision, source_loaded_at: loadedAt,
        ...(loaded.stale ? { stale: true } : {}), today: new Date(now() + 8 * 3600e3).toISOString().slice(0, 10), links };
      if (revision && revision !== data.revision) {
        // The restart keeps the request without its revision and offset, so it reads the current catalog from the start.
        const restart = new URL(url);
        restart.searchParams.delete('revision');
        restart.searchParams.delete('offset');
        response = json({ ...meta, error: route === 'edition' ? 'Content changed; reload the edition outline'
          : route === 'item' ? 'Content changed; read the current entry at restart_url'
            : 'Content changed; restart pagination at offset 0', code: 'revision_conflict', restart_url: restart.href }, 409);
      } else if (route === 'item') {
        // Library search returns bare resource ids; the catalog stores them with the library: prefix.
        const found = byId.get(id) || byId.get(`library:${id}`);
        // The catalog's `open` is as of the last build; the worker knows today's date.
        const item = found?.kind === 'opportunity' ? { ...found, open: found.closes >= meta.today } : found;
        response = item ? json({ ...meta, item }) : json({ ...meta, error: 'Unknown content ID', code: 'not_found',
          hint: 'Use an id from a search result; topic ids change when a title changes' }, 404);
      } else if (route === 'edition') {
        // Select the edition before applying the group. Missing groups must not select an older issue.
        const edition = date === 'latest' ? data.latest[kind]
          : data.editions.find(item => item.kind === kind && item.date === date);
        if (!edition) {
          // Point at the issues on either side of a missing date. A weekly asked for by its first day is that week.
          const same = data.editions.filter(item => item.kind === kind).sort((a, b) => a.date.localeCompare(b.date));
          const week = kind === 'weekly' && same.find(item => item.from === date);
          const before = same.filter(item => item.date < date).at(-1), after = same.find(item => item.date > date);
          const near = item => item && { date: item.date, ...(item.from ? { from: item.from } : {}),
            outline_url: outlineUrl(kind, item.date, undefined, data.revision) };
          response = json({ ...meta, error: week ? 'A weekly edition is addressed by its last day'
            : 'No edition was published on this date', code: 'not_found',
            recovery_url: week ? outlineUrl(kind, week.date, undefined, data.revision) : outlineUrl(kind, 'latest'),
            nearest: { before: near(before), after: near(after) } }, 404);
        } else if (!validSections(edition)) {
          response = json({ ...meta, error: 'Published edition outline temporarily unavailable; retry later',
            code: 'edition_outline_unavailable', retry_after_seconds: 30 }, 503);
          response.headers.set('Retry-After', '30');
        } else {
          const sections = edition.sections.filter(section => !group || section.group === group);
          if (!sections.length) {
            response = json({ ...meta, error: 'Group not found in this edition', code: 'not_found',
              edition: compactEdition(edition, data.revision),
              recovery_url: outlineUrl(edition.kind, edition.date, undefined, data.revision) }, 404);
          } else {
            const outline = sections.map(section => {
              const topics = data.entries.filter(item => !item.trend && item.kind === edition.kind && item.date === edition.date
                && (edition.kind !== 'weekly' || item.from === edition.from) && item.group === section.group)
                .map(item => ({ title: item.title, read_url: item.read_url }));
              return { id: section.group, label: section.label, title: section.title,
                summary: [...section.summary].slice(0, 160).join(''), url: section.url,
                ...(edition.kind === 'daily' ? { read_url: section.read_url } : {}),
                outline_url: outlineUrl(edition.kind, edition.date, section.group, data.revision),
                topic_count: topics.length, trend_count: section.trend_count, topics };
            });
            const { groups: ignored, ...editionMeta } = compactEdition(edition, data.revision);
            response = json({ ...meta, edition: editionMeta,
              topic_count: outline.reduce((count, section) => count + section.topic_count, 0), groups: outline });
          }
        }
      } else {
        const limit = Number(limitText), offset = Number(offsetText);
        if (route === 'search' && q && !loaded.searcher) {
          // Stored on the cache entry itself (a stale view reads through to it), so it is built once per catalog.
          (Object.getPrototypeOf(loaded) === cached ? cached : loaded).searcher = globalThis.AgentHubQuery.createSearcher(data.entries, data.vocabulary);
        }
        // A library resource may be shared in several groups on different dates.
        // Group and time constraints must match the same share, not unrelated rows.
        const shares = item => (item.shared || []).filter(share => (!group || share.group === group)
          && (!from || share.date >= from) && (!to || share.date <= to));
        const fits = item => (!kind || item.kind === kind) && (item.kind === 'library' || item.kind === 'opportunity'
          ? !(group || from || to) || shares(item).length > 0
          : (!group || item.group === group) && (!from || item.date >= from) && (!to || (item.from || item.date) <= to));
        // Filters apply inside the search, so relevance is judged among the items the reader asked for.
        const keep = kind || group || from || to ? i => fits(data.entries[i]) : undefined;
        const read = route === 'search' && q ? loaded.searcher.explain(q, keep) : null;
        let matches = read?.matches || null, semantic;
        // With Workers AI bound, a query is also ranked by embedding similarity and fused with BM25. A name with a
        // version the site never wrote has no answer, so it is not sent. Failure falls back to BM25 and says so.
        if (read && env.AI) {
          semantic = 'unavailable';
          if (!read.missing_versions.length) {
            // The model gets the query as typed; NFKC would turn full-width punctuation into ASCII it never saw.
            const store = await vectors(data.revision), query = store && await embedQuery(env, get('q').trim());
            if (query) {
              matches = fuse(read.matches, semanticRanking(store, query, loaded.indexById, keep));
              semantic = 'used';
            }
          } else semantic = 'skipped';
        }
        const top = matches ? Math.max(0, ...[...matches.values()].map(match => match.score)) : 0;
        const source = route === 'editions' ? data.editions : data.entries;
        const found = source.map((item, i) => {
          if ((item.kind === 'library' || item.kind === 'opportunity') && (group || from || to)) {
            const shared = shares(item);
            return { item: { ...item, matched_shared: shared,
              date: shared.map(share => share.date).sort().at(-1) || item.date }, i, score: matches?.get(i)?.score || 0 };
          }
          return { item, i, score: matches?.get(i)?.score || 0 };
        }).filter(({ item, i }) => (!matches || matches.has(i)) && fits(item))
          .sort((a, b) => b.score - a.score || b.item.date.localeCompare(a.item.date) || a.i - b.i);
        const selected = found.slice(offset, offset + limit);
        const items = route === 'editions' ? selected.map(({ item }) => compactEdition(item, data.revision)) : selected.map(({ item, score, i }) => ({ id: item.id, kind: item.kind,
          date: item.date, ...(item.from ? { from: item.from } : {}), ...(item.group ? { group: item.group } : {}),
          title: item.title, ...(item.trend ? { trend: true } : {}), ...(matches ? { relevance: relevance(score, top) } : {}),
          ...(item.kind === 'opportunity' ? { opportunity_kind: item.opportunity_kind, first_shared: item.first_shared, open: item.closes >= meta.today, closes: item.closes,
            ...(item.deadline ? { deadline: item.deadline } : {}), ...(item.event_date ? { event_date: item.event_date } : {}) } : {}),
          ...(semantic === 'used' ? { matched_by: matches.get(i).lexical ? matches.get(i).similarity ? 'both' : 'words' : 'meaning' } : {}),
          excerpt: [...item.text].slice(0, 400).join(''), keywords: item.keywords,
          ...(item.matched_shared ? { matched_shared: item.matched_shared } : {}),
          url: item.url, read_url: item.read_url, revision: item.revision,
          detail_url: base + 'item?' + new URLSearchParams({ id: item.id, revision: data.revision }) }));
        const nextOffset = offset + items.length < found.length ? offset + items.length : null;
        const next = new URL(url);
        next.searchParams.set('revision', data.revision);
        if (nextOffset !== null) next.searchParams.set('offset', String(nextOffset));
        response = json({ ...meta, ...(route === 'editions' ? { latest: {
          daily: compactEdition(data.latest.daily, data.revision), weekly: compactEdition(data.latest.weekly, data.revision) } }
          : { query: { q, kind, group, from, to, ...(read ? searchReading(read, q) : {}), ...(semantic ? { semantic } : {}) },
            coverage: { indexed: ['story_summaries', 'ai_commentary', 'library_entries', 'opportunities', 'edition_trends'],
              not_indexed: ['raw_chat'], edition_reader: links.editions, ...loaded.spans,
              // A kind with no entries yet has no period, so it neither covers nor excludes the dates.
              ...(from && to && Object.values(loaded.spans).every(span => !span.from || to < span.from || from > span.to)
                ? { note: 'The requested dates fall outside every published period' } : {}) } }),
        total: found.length, limit, offset, next_offset: nextOffset, next_url: nextOffset === null ? null : next.href,
        ...(read ? zeroResultHint({ ...read, matches }, q, url, rest => loaded.searcher.search(rest, keep).size > 0) : {}), items });
        if (route === 'search') await recordSearch(request, env, ctx, { endpoint: 'content/search', q,
          filters: { kind, group, from, to }, total: found.length, read });
      }
    } catch {
      response = json({ error: 'Published content temporarily unavailable; retry later', code: 'upstream_unavailable',
        retry_after_seconds: 30, links }, 503);
      response.headers.set('Retry-After', '30');
    }
    // Count the endpoint and status here; recordSearch keeps the redacted text of first-page searches.
    return recordRead(request, env, 'content/' + route, response);
  };
}

export const contentAPI = createContentAPI();
