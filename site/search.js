// Site search over the build-time index (search/data.js), ranked with BM25 (bm25.js). Chinese queries need no
// spaces; a known alias or glossary spelling in the query is also searched as what it stands for. State lives in
// the address so results can be shared.
(() => {
  'use strict';
  const data = window.AGENT_HUB_SEARCH;
  const { variants, ranges } = window.AgentHubBM25;
  const root = document.querySelector('meta[name="agenthub-root"]').content;
  const $ = selector => document.querySelector(selector);
  const input = $('#site-search'), results = $('#results'), status = $('#search-status'), more = $('#results-more');
  const KINDS = { d: '日报', w: '周报', l: '资料库', o: '机会' };
  const PAGE = 30;
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const latest = data.entries.map(entry => entry.date).sort().at(-1);
  const daysBefore = days => new Date(Date.parse(`${latest}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);

  // Titles weigh most, then keywords, then the body. Built once, when the browser is idle or at the first search.
  let index;
  const ensureIndex = () => index ||= window.AgentHubQuery.createSearcher(data.entries, { expand: data.expand, groups: data.synonyms });
  (window.requestIdleCallback || (callback => setTimeout(callback, 200)))(ensureIndex);

  const params = new URLSearchParams(location.search);
  const state = { q: params.get('q') || '', kind: params.get('in') || '', group: params.get('g') || '',
    time: ['7', '30'].includes(params.get('t')) ? params.get('t') : '', sort: params.get('sort') === 'new' ? 'new' : 'relevance', shown: PAGE };
  input.value = state.q;
  const filters = { kind: 'in', group: 'g', time: 't' };

  function search() {
    const query = variants(state.q, data.expand, data.synonyms);
    if (!query.variants.length) return { query, found: [] };
    const since = state.time ? daysBefore(Number(state.time)) : '';
    const fits = entry => (!state.kind || entry.k === state.kind) && (!state.group || entry.g === state.group) && (!since || entry.date >= since);
    // Filters apply inside the search, so relevance is judged among the items the reader asked for.
    const read = ensureIndex().explain(state.q, state.kind || state.group || since ? i => fits(data.entries[i]) : undefined);
    const found = [...read.matches]
      .map(([i, result]) => ({ entry: data.entries[i], ...result }))
      .sort((a, b) => state.sort === 'new'
        ? b.entry.date.localeCompare(a.entry.date) || b.score - a.score
        : b.score - a.score || b.entry.date.localeCompare(a.entry.date));
    return { query: { ...query, found: read.expanded }, found, read };
  }
  // A short passage around the first match, with matched words marked; neighbouring Chinese pairs mark as one phrase.
  function snippet(entry, variant) {
    const text = entry.x.replace(/\s+/g, ' ');
    const marks = ranges(text, variant);
    const start = marks.length ? Math.max(0, marks[0][0] - 40) : 0, end = start + 140;
    let html = '', last = start;
    for (const [from, to] of marks) {
      if (to <= start || from >= end) continue;
      const a = Math.max(from, start), b = Math.min(to, end);
      html += esc(text.slice(last, a)) + `<mark>${esc(text.slice(a, b))}</mark>`;
      last = b;
    }
    return `${start ? '…' : ''}${html}${esc(text.slice(last, end))}${end < text.length ? '…' : ''}`;
  }
  const label = entry => [KINDS[entry.k], entry.k === 'w' ? `${entry.from.replaceAll('-', '.')}–${entry.date.slice(5).replace('-', '.')}` : entry.date.replaceAll('-', '.'), entry.g && data.groups[entry.g]].filter(Boolean).join(' · ');
  // An alias is named as the reader typed it, falling back to its stored spelling.
  const typed = alias => { const at = state.q.toLowerCase().indexOf(alias); return at >= 0 ? state.q.slice(at, at + alias.length) : alias; };

  function render({ write = true } = {}) {
    for (const button of document.querySelectorAll('.chips button')) {
      const [name] = Object.keys(button.dataset);
      button.setAttribute('aria-pressed', String(state[name] === button.dataset[name]));
    }
    for (const button of document.querySelectorAll('.sort button')) button.setAttribute('aria-pressed', String(state.sort === button.dataset.sort));
    const { query, found, read } = search();
    results.innerHTML = found.slice(0, state.shown).map(({ entry, variant }, index) => `<li class="result"><p class="result-meta">${esc(label(entry))}</p>` +
      `<h2><a href="${esc(root + entry.u)}" data-target="${esc(entry.u)}" data-rank="${index + 1}">${esc(entry.t)}</a></h2><p class="result-snippet">${snippet(entry, variant)}</p></li>`).join('');
    more.hidden = found.length <= state.shown;
    const expanded = query.found.map(({ alias, targets }) => `${typed(alias)}（${targets.join('、')}）`);
    // Say what the search left out: a word the site never uses, or a version it never wrote.
    const dropped = read?.dropped_terms.length ? `；站内没有 ${read.dropped_terms.join('、')}，已按其余词搜索` : '';
    const versions = read?.missing_versions.length
      ? `站内没有提到 ${read.missing_versions.join('、')}（写过的有 ${Object.entries(read.known_versions)
        .map(([name, list]) => list.map(version => `${name} ${version}`).join('、')).join('；')}）` : '';
    const unknown = !found.length && read?.unknown_terms.length ? `站内没有出现过 ${read.unknown_terms.join('、')}，换个说法试试` : '';
    status.textContent = !query.variants.length ? '群里的叫法也能搜，比如 A社、oai、哈基米。'
      : `${found.length ? `找到 ${found.length} 条` : versions || unknown || '没找到，换个说法或放宽筛选试试'}${dropped}${expanded.length ? `；已同时搜索 ${expanded.join('、')}` : ''}`;
    window.AgentHubSearchTracking?.update(state, found.length);
    if (!write) return;
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    for (const [name, param] of Object.entries(filters)) if (state[name]) params.set(param, state[name]);
    if (state.sort === 'new') params.set('sort', 'new');
    if (new URLSearchParams(location.search).get('analytics_test') === '1') params.set('analytics_test', '1');
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  }

  for (const button of document.querySelectorAll('.chips button')) button.addEventListener('click', () => {
    // Choosing the active value again lifts that filter.
    const [name] = Object.keys(button.dataset);
    state[name] = state[name] === button.dataset[name] ? '' : button.dataset[name];
    state.shown = PAGE;
    render();
  });
  for (const button of document.querySelectorAll('.sort button')) button.addEventListener('click', () => {
    state.sort = button.dataset.sort;
    state.shown = PAGE;
    render();
  });
  let timer;
  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); window.AgentHubSearchTracking?.cancel(); });
  input.addEventListener('compositionend', () => { composing = false; input.dispatchEvent(new Event('input')); });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    window.AgentHubSearchTracking?.cancel();
    if (composing) return;
    timer = setTimeout(() => { state.q = input.value.trim(); state.shown = PAGE; render(); }, 150);
  });
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || composing) return;
    clearTimeout(timer); state.q = input.value.trim(); state.shown = PAGE; render();
    window.AgentHubSearchTracking?.flush();
  });
  const clicked = event => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = event.target.closest('a[data-target]');
    if (link) window.AgentHubSearchTracking?.click(link.dataset.target, Number(link.dataset.rank));
  };
  results.addEventListener('click', clicked);
  results.addEventListener('auxclick', clicked);
  more.addEventListener('click', () => { state.shown += PAGE; render({ write: false }); });
  render({ write: false });
})();
