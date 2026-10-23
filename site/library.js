// Library page: filters and search over the server-rendered list, shareable through the query string,
// plus hearts stored by the same feedback worker as the daily votes.
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const entries = [...document.querySelectorAll('.entry')];
  const original = entries.slice();
  const list = $('.entries');
  const input = $('#library-search');
  const status = $('#library-status');
  const empty = $('.library-empty');
  const total = entries.length;
  const opportunities = $('#opportunities');
  const opportunityCards = [...document.querySelectorAll('.opportunity')];
  let sortingAvailable = false;
  // Search ranks with BM25 (bm25.js) over the title, the keywords with their aliases, and the rest of the card
  // including its link addresses. The query expands with the same vocabulary as site search (synonyms.mjs).
  const data = JSON.parse(document.getElementById('library-search-data').textContent);
  const opportunityText = new Map(opportunityCards.map(card => [card, card.textContent.toLocaleLowerCase()]));
  const opportunityMatches = (card, query = state.q) => query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
    .every(term => opportunityText.get(card).includes(term));
  const index = window.AgentHubQuery.createSearcher(data.items, data.vocabulary);
  // One query is searched once; filters, chip counts and ordering read the cached hits.
  const cache = new Map();
  const hits = query => {
    if (!cache.has(query)) cache.set(query, new Map([...index.search(query)].map(([i, result]) => [entries[i], result.score])));
    return cache.get(query);
  };
  // Each filter maps to a URL parameter and a "|"-separated data attribute. Values inside one filter combine
  // with OR, filters combine with AND.
  const filters = { topic: 'topic', type: 'type', keyword: 'kw', link: 'has', group: 'group', when: 'when' };
  const values = new Map(entries.map(entry => [entry, Object.fromEntries(Object.keys(filters).map(filter =>
    [filter, (entry.dataset[filter] || '').split('|').filter(Boolean)]))]));
  const chips = [...document.querySelectorAll('.chips button[data-filter]')];
  const labels = new Map(chips.map(chip => [`${chip.dataset.filter}|${chip.dataset.value}`, chip.firstChild.textContent]));
  const params = new URLSearchParams(location.search);
  const hashTarget = location.hash ? document.getElementById(location.hash.slice(1)) : null;
  const state = { q: params.get('q') || '', sort: 'recent', selected: {},
    opportunities: Boolean(opportunities && (params.getAll('type').includes('opportunity') || hashTarget === opportunities || hashTarget?.classList.contains('opportunity'))) };
  // A shared address may name any value a card carries, including keywords too rare to have a chip.
  for (const [filter, param] of Object.entries(filters)) {
    state.selected[filter] = new Set(state.opportunities ? [] : params.getAll(param).filter(value => entries.some(entry => values.get(entry)[filter].includes(value))));
  }
  input.value = state.q;

  const matches = (entry, selected = state.selected, query = state.q) =>
    Object.keys(filters).every(filter => !selected[filter].size || values.get(entry)[filter].some(value => selected[filter].has(value))) &&
    (!query || hits(query).has(entry));
  const without = (filter, value) => ({ ...state.selected, [filter]: new Set([...state.selected[filter]].filter(other => other !== value)) });
  const count = (selected, query) => entries.filter(entry => matches(entry, selected, query)).length;
  const label = (filter, value) => labels.get(`${filter}|${value}`) || value;

  // While searching, the most relevant cards come first.
  const score = entry => hits(state.q).get(entry) || 0;
  function order() {
    const sorted = state.sort === 'hearts'
      ? original.slice().sort((a, b) => (counts.get(b.querySelector('.heart').dataset.feedback) || 0) - (counts.get(a.querySelector('.heart').dataset.feedback) || 0))
      : state.q ? original.slice().sort((a, b) => score(b) - score(a)) : original;
    if (sorted.some((entry, index) => list.children[index] !== entry)) list.append(...sorted);
  }

  function apply({ write = true } = {}) {
    const opportunityView = state.opportunities;
    list.hidden = opportunityView;
    if (opportunities) opportunities.hidden = !opportunityView;
    for (const row of document.querySelectorAll('.filter-row:not([data-row="type"]), .more-filters')) row.hidden = opportunityView;
    $('.sort').hidden = opportunityView || !sortingAvailable;
    $('.search .visually-hidden').textContent = opportunityView ? '搜索机会' : '搜索资料';
    input.placeholder = opportunityView ? '搜机会标题、简介或机构' : '搜标题、简介或网址';
    let shown = 0;
    for (const entry of entries) {
      const visible = matches(entry);
      entry.hidden = !visible;
      if (visible) shown++;
    }
    if (opportunityView) {
      shown = 0;
      for (const card of opportunityCards) {
        card.hidden = !opportunityMatches(card);
        if (!card.hidden) shown++;
      }
      for (const opportunityList of opportunities.querySelectorAll('.opportunity-list')) {
        opportunityList.hidden = ![...opportunityList.children].some(card => !card.hidden);
      }
      const closed = opportunities.querySelector('.opportunities-closed');
      if (closed) {
        const matches = [...closed.querySelectorAll('.opportunity')].filter(card => !card.hidden).length;
        closed.hidden = !matches;
        closed.querySelector('summary').textContent = `已截止 ${matches} 项`;
      }
    }
    // A chip counts what it would show if added, with its own filter's other choices set aside.
    for (const chip of chips) {
      const { filter, value } = chip.dataset;
      const selected = state.selected[filter];
      chip.setAttribute('aria-pressed', String(value === 'opportunity' ? opportunityView : !opportunityView && (value ? selected.has(value) : !selected.size)));
      const result = value === 'opportunity' ? opportunityCards.length
        : count({ ...state.selected, [filter]: new Set(value ? [value] : []) }, opportunityView ? '' : state.q);
      chip.querySelector('.chip-count').textContent = result;
      chip.classList.toggle('is-empty', !result);
    }
    const active = opportunityView ? [['type', 'opportunity']] : Object.entries(state.selected).flatMap(([filter, set]) => [...set].map(value => [filter, value]));
    applied.hidden = !active.length && !state.q;
    applied.innerHTML = active.map(([filter, value]) => `<button type="button" data-remove="${esc(filter)}" data-value="${esc(value)}">${esc(label(filter, value))}<span aria-hidden="true">×</span><span class="visually-hidden">（移除）</span></button>`).join('') +
      (state.q ? `<button type="button" data-remove="q">搜索“${esc(state.q)}”<span aria-hidden="true">×</span></button>` : '') +
      (active.length + Boolean(state.q) > 1 ? '<button type="button" class="applied-clear" data-remove="all">清除全部</button>' : '');
    // Filters kept in the collapsed section stay visible while they are active.
    if (['link', 'group', 'when'].some(filter => state.selected[filter].size)) $('.more-filters').open = true;
    const viewTotal = opportunityView ? opportunityCards.length : total;
    status.textContent = opportunityView ? (state.q ? `显示 ${shown} / ${viewTotal} 项机会` : `共 ${viewTotal} 项机会`)
      : shown === total ? `共 ${total} 项` : `显示 ${shown} / ${total} 项`;
    empty.querySelector('p').textContent = opportunityView ? '没找到符合条件的机会。' : '没找到符合条件的资料。';
    empty.hidden = shown > 0;
    // With no result, offer each single relaxation that brings items back.
    relax.innerHTML = shown ? '' : (opportunityView ? (state.q ? [['不限搜索词', opportunityCards.length, 'q', '']] : []) : [
      ...active.map(([filter, value]) => [`去掉“${label(filter, value)}”`, count(without(filter, value)), filter, value]),
      ...(state.q ? [[`不限搜索词`, count(state.selected, ''), 'q', '']] : []),
    ]).filter(([, n]) => n).map(([text, n, filter, value]) => `<li><button type="button" data-remove="${esc(filter)}" data-value="${esc(value)}">${esc(text)}，有 ${n} 项</button></li>`).join('');
    if (!opportunityView) order();
    if (!write) return;
    const query = new URLSearchParams();
    if (opportunityView) query.set('type', 'opportunity');
    else for (const [filter, param] of Object.entries(filters)) for (const value of state.selected[filter]) query.append(param, value);
    if (state.q) query.set('q', state.q);
    const hash = !opportunityView && (location.hash === '#opportunities' || document.getElementById(location.hash.slice(1))?.classList.contains('opportunity')) ? '' : location.hash;
    const url = `${location.pathname}${query.size ? `?${query}` : ''}${hash}`;
    if (url !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(null, '', url);
  }
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const applied = $('.applied');
  const relax = $('.relax');
  const clear = () => {
    for (const filter of Object.keys(filters)) state.selected[filter] = new Set();
    state.q = '';
    input.value = '';
    state.opportunities = false;
  };
  const toggle = (filter, value) => {
    if (filter === 'type' && (value === 'opportunity' || state.opportunities)) {
      const enter = value === 'opportunity' && !state.opportunities;
      clear();
      state.opportunities = enter;
      if (!enter && value && value !== 'opportunity') state.selected.type.add(value);
      apply();
      return;
    }
    const set = state.selected[filter];
    if (!value) set.clear();
    else if (set.has(value)) set.delete(value);
    else set.add(value);
    apply();
  };

  for (const chip of chips) chip.addEventListener('click', () => toggle(chip.dataset.filter, chip.dataset.value));
  // Applied-filter tags and no-result suggestions remove one condition.
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-remove]');
    if (!button) return;
    const { remove, value } = button.dataset;
    if (remove === 'all') clear();
    else if (remove === 'q') { state.q = ''; input.value = ''; }
    else if (remove === 'type' && value === 'opportunity') clear();
    else state.selected[remove].delete(value);
    apply();
  });
  const more = $('.chips-more');
  more?.addEventListener('click', () => {
    const open = more.getAttribute('aria-expanded') !== 'true';
    more.setAttribute('aria-expanded', String(open));
    more.closest('.chips').classList.toggle('show-all', open);
    more.textContent = open ? '收起' : more.dataset.label;
  });
  // Topic and keyword tags on a card select that value and return to the filters.
  document.addEventListener('click', event => {
    const tag = event.target.closest('.entry-tags a[data-filter], a[data-filter-link]');
    if (!tag || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    if (state.opportunities) clear();
    state.selected[tag.dataset.filter].add(tag.dataset.value);
    apply();
    $('.filters').scrollIntoView({ block: 'start' });
  });
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = input.value.trim(); apply(); }, 120);
  });
  $('#library-reset').addEventListener('click', () => {
    clear();
    apply();
    input.focus();
  });
  apply({ write: false });
  const showOpportunityTarget = () => {
    const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    if (!opportunities || (target !== opportunities && !target?.classList.contains('opportunity'))) return;
    if (!state.opportunities) { clear(); state.opportunities = true; }
    apply();
    if (target.classList.contains('opportunity')) {
      if (target.hidden) { state.q = ''; input.value = ''; apply(); }
      const closed = target.closest('details');
      if (closed) closed.open = true;
    }
    target.scrollIntoView({ block: 'start' });
  };
  window.addEventListener('hashchange', showOpportunityTarget);
  if (state.opportunities && location.hash) showOpportunityTarget();
  // On phones each filter row scrolls sideways; bring a preselected chip into view without moving the page.
  for (const chip of chips.filter(chip => chip.dataset.value && chip.getAttribute('aria-pressed') === 'true')) {
    const row = chip.parentElement;
    if (chip.offsetLeft + chip.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = chip.offsetLeft - row.offsetLeft - 16;
  }
  // A shared #id link should land on its card even if the list was filtered.
  const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
  if (target?.classList.contains('entry') && target.hidden) {
    clear();
    apply();
    target.scrollIntoView();
  }

  // Hearts. Local previews keep the choice on this device and never invent counts.
  const endpoint = document.querySelector('meta[name="agenthub-feedback"]')?.content;
  const remote = Boolean(endpoint) && location.protocol !== 'file:';
  const prefix = 'agenthub:feedback:v1:';
  const stored = key => { try { return localStorage.getItem(prefix + key); } catch { return null; } };
  const store = (key, value) => { try { localStorage.setItem(prefix + key, value); return true; } catch { return false; } };
  let voter = stored('voter');
  if (!/^[a-f0-9-]{36}$/.test(voter || '')) { voter = crypto.randomUUID(); store('voter', voter); }
  const counts = new Map();
  const hearts = new Map(entries.map(entry => [entry.querySelector('.heart').dataset.feedback, entry.querySelector('.heart')]));
  function paint(id, { up = null, vote = null, busy = false } = {}) {
    const button = hearts.get(id);
    const title = button.closest('.entry').querySelector('.entry-title').textContent;
    button.setAttribute('aria-pressed', String(vote === 'up'));
    button.setAttribute('aria-label', `${vote === 'up' ? '取消喜欢' : '喜欢'}：${title}`);
    button.title = vote === 'up' ? '取消喜欢' : remote ? '喜欢' : '喜欢（仅保存在此设备）';
    button.disabled = busy;
    button.querySelector('.heart-count').textContent = up ?? '—';
    if (up !== null) counts.set(id, up);
  }
  const url = query => {
    const address = new URL('votes', endpoint.endsWith('/') ? endpoint : `${endpoint}/`);
    if (query) address.search = new URLSearchParams(query);
    return address;
  };
  const validCounts = data => data && (data.vote === null || data.vote === 'up' || data.vote === 'down') && Number.isSafeInteger(data.up) && data.up >= 0;
  let loaded = !remote;
  async function load() {
    try {
      const response = await fetch(url({ collection: 'library', voter }), { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Feedback unavailable');
      const { items } = await response.json();
      for (const [id, data] of Object.entries(items || {})) if (hearts.has(id) && validCounts(data)) paint(id, data);
      loaded = true;
      sortingAvailable = true;
      $('.sort').hidden = state.opportunities;
    } catch { /* Counts stay "—"; a click retries. */ }
  }
  for (const [id, button] of hearts) {
    if (!remote) paint(id, { vote: stored(id) === 'up' ? 'up' : null });
    button.addEventListener('click', async () => {
      if (remote && !loaded) { await load(); if (!loaded) return; }
      const vote = button.getAttribute('aria-pressed') === 'true' ? null : 'up';
      if (!remote) { store(id, vote || ''); paint(id, { vote }); return; }
      const previous = { up: counts.get(id) ?? null, vote: button.getAttribute('aria-pressed') === 'true' ? 'up' : null };
      paint(id, { ...previous, busy: true });
      try {
        const response = await fetch(url(), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ story: id, voter, vote }),
          credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(8000),
        });
        const data = await response.json();
        if (!response.ok || !validCounts(data)) throw new Error('Feedback unavailable');
        paint(id, data);
      } catch {
        // A timed-out write may still have committed; re-read before the next click.
        loaded = false;
        paint(id, previous);
      }
    });
  }
  if (remote) load();
  for (const button of document.querySelectorAll('.sort button')) button.addEventListener('click', () => {
    state.sort = button.dataset.sort;
    for (const other of document.querySelectorAll('.sort button')) other.setAttribute('aria-pressed', String(other === button));
    order();
  });
})();
