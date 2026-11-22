// Library page: intelligent search, query operators, research lenses, cards/list/atlas views,
// detail drawer with related items & discussions, local reading list, export, and submission modal.
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const entries = [...document.querySelectorAll('.entry')];
  const original = entries.slice();
  const list = $('.entries');
  const atlasEl = $('#library-atlas');
  const input = $('#library-search');
  const searchClear = $('#library-search-clear');
  const suggestEl = $('#library-suggest');
  const explainEl = $('#library-explain');
  const status = $('#library-status');
  const empty = $('.library-empty');
  const applied = $('.applied');
  const relax = $('.relax');
  const total = entries.length;
  const opportunities = $('#opportunities');
  const opportunityCards = [...document.querySelectorAll('.opportunity')];

  const data = JSON.parse(document.getElementById('library-search-data').textContent);
  const itemsById = new Map();
  const itemMeta = new Map();
  const linkKeyMap = new Map();
  entries.forEach((entry, idx) => {
    const raw = data.items?.[idx] || {};
    const id = entry.id || raw.id || `item-${idx}`;
    const item = {
      id,
      title: raw.title || entry.querySelector('.entry-title a')?.textContent || '',
      summary: raw.summary || entry.querySelector('.entry-summary')?.textContent || '',
      type: raw.type || entry.dataset.type || '',
      topics: raw.topics || (entry.dataset.topic || '').split('|').filter(Boolean),
      keywords: raw.keywords || (entry.dataset.keyword || '').split('|').filter(Boolean),
      links: raw.links || [...entry.querySelectorAll('.entry-links a')].map(a => ({ kind: 'article', url: a.href })),
      aliases: raw.aliases || [],
      first: raw.first || entry.dataset.first || '',
      last: raw.last || entry.dataset.last || entry.dataset.first || '',
      groups: raw.groups || (entry.dataset.group || '').split('|').filter(Boolean),
      shareCount: raw.shareCount || 1,
      heat: Number(raw.heat ?? entry.dataset.heat ?? 0),
      discussions: raw.discussions || [],
      related: raw.related || [],
    };
    itemsById.set(id, item);
    itemMeta.set(entry, item);
    for (const u of [...item.links.map(l => l.url), ...(item.aliases || [])]) {
      const k = clientResourceKey(u);
      if (k) linkKeyMap.set(k, item);
    }
  });

  function clientResourceKey(raw) {
    try {
      const url = new URL(String(raw).trim());
      url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
      const arxiv = (url.hostname === 'arxiv.org' || url.hostname === 'alphaxiv.org')
        && url.pathname.match(/^\/(?:abs|pdf|html|overview)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?\/?$/)?.[1];
      if (arxiv) return `arxiv:${arxiv}`;
      if (url.hostname === 'github.com') {
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length >= 2 && !url.search && (!parts[2] || parts[2] === 'tree' && parts.length === 3)) {
          return `github:${parts[0].toLowerCase()}/${parts[1].toLowerCase().replace(/\.git$/, '')}`;
        }
      }
      url.hash = '';
      return url.href.replace(/\/$/, '').toLowerCase();
    } catch { return ''; }
  }

  // Store plain text for safe <mark> highlighting and clean restoration.
  const plainText = new Map(entries.map(entry => {
    const titleEl = entry.querySelector('.entry-title a');
    const summaryEl = entry.querySelector('.entry-summary');
    return [entry, { titleEl, title: titleEl?.textContent || '', summaryEl, summary: summaryEl?.textContent || '' }];
  }));

  const opportunityText = new Map(opportunityCards.map(card => [card, card.textContent.toLocaleLowerCase()]));
  const opportunityMatches = (card, query = state.q) => query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
    .every(term => opportunityText.get(card).includes(term));

  const index = window.AgentHubQuery.createSearcher(data.items, data.vocabulary);
  const bm25 = window.AgentHubBM25;

  // Parse inline search operators like type:paper has:code topic:training kw:RLVR group:group-3 when:7d
  const OP_MAP = { type: 'type', topic: 'topic', kw: 'keyword', keyword: 'keyword', has: 'link', link: 'link', group: 'group', when: 'when' };
  function parseQuery(rawQuery) {
    const ops = { type: [], topic: [], keyword: [], link: [], group: [], when: [] };
    const free = [];
    for (const token of String(rawQuery || '').trim().split(/\s+/).filter(Boolean)) {
      const m = token.match(/^([a-z]+):(.+)$/i);
      const filter = m && OP_MAP[m[1].toLowerCase()];
      if (filter && m[2]) ops[filter].push(m[2]);
      else free.push(token);
    }
    return { ops, freeText: free.join(' ') };
  }

  const explainCache = new Map();
  const explainQuery = (freeText) => {
    if (!freeText) return null;
    if (!explainCache.has(freeText)) {
      const read = index.explain(freeText);
      const map = new Map([...read.matches].map(([i, result]) => [entries[i], result]));
      explainCache.set(freeText, { read, map });
    }
    return explainCache.get(freeText);
  };

  const filters = { topic: 'topic', type: 'type', keyword: 'kw', link: 'has', discussed: 'discussed', group: 'group', when: 'when' };
  const values = new Map(entries.map(entry => [entry, Object.fromEntries(Object.keys(filters).map(filter =>
    [filter, (entry.dataset[filter] || '').split('|').filter(Boolean)]))]));
  const chips = [...document.querySelectorAll('.chips button[data-filter]')];
  const labels = new Map(chips.map(chip => [`${chip.dataset.filter}|${chip.dataset.value}`, chip.firstChild.textContent]));

  const STORAGE_KEY = 'agenthub-library-saved';
  const loadSaved = () => {
    try {
      const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return new Set(Array.isArray(arr) ? arr.filter(id => itemsById.has(id)) : []);
    } catch { return new Set(); }
  };
  const saveToStorage = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...savedIds])); } catch { /* ignore */ }
  };
  const savedIds = loadSaved();

  const params = new URLSearchParams(location.search);
  const hashTarget = location.hash ? document.getElementById(location.hash.slice(1)) : null;
  const state = {
    q: params.get('q') || '',
    selected: {},
    hotOnly: params.get('hot') === '1',
    savedOnly: params.get('saved') === '1',
    sort: ['recent', 'heat', 'active', 'relevance'].includes(params.get('sort')) ? params.get('sort') : (params.get('q') ? 'relevance' : 'recent'),
    view: ['cards', 'list', 'atlas'].includes(params.get('view')) ? params.get('view') : 'cards',
    opportunities: Boolean(opportunities && (params.getAll('type').includes('opportunity') || hashTarget === opportunities || hashTarget?.classList.contains('opportunity'))),
  };
  for (const [filter, param] of Object.entries(filters)) {
    state.selected[filter] = new Set(state.opportunities ? [] : params.getAll(param).filter(value => entries.some(entry => values.get(entry)[filter].includes(value))));
  }
  input.value = state.q;

  function effectiveSelected(selected = state.selected, ops = parsedQuery.ops) {
    const merged = {};
    for (const filter of Object.keys(filters)) {
      const set = new Set(selected[filter]);
      for (const v of ops[filter] || []) {
        const match = entries.find(e => values.get(e)[filter].some(val => val.toLowerCase() === v.toLowerCase()));
        if (match) set.add(values.get(match)[filter].find(val => val.toLowerCase() === v.toLowerCase()));
        else set.add(v);
      }
      merged[filter] = set;
    }
    return merged;
  }

  let parsedQuery = parseQuery(state.q);
  const matches = (entry, selected = state.selected, query = state.q, hotOnly = state.hotOnly, savedOnly = state.savedOnly) => {
    const pq = query === state.q ? parsedQuery : parseQuery(query);
    const eff = effectiveSelected(selected, pq.ops);
    if (!Object.keys(filters).every(filter => !eff[filter].size || values.get(entry)[filter].some(value => eff[filter].has(value)))) return false;
    if (hotOnly && entry.dataset.hot !== '1') return false;
    if (savedOnly && !savedIds.has(entry.id)) return false;
    if (pq.freeText) {
      const exp = explainQuery(pq.freeText);
      if (!exp || !exp.map.has(entry)) return false;
    }
    return true;
  };
  const without = (filter, value) => ({ ...state.selected, [filter]: new Set([...state.selected[filter]].filter(other => other !== value)) });
  const count = (selected, query, hotOnly = state.hotOnly, savedOnly = state.savedOnly) =>
    entries.filter(entry => matches(entry, selected, query, hotOnly, savedOnly)).length;
  const label = (filter, value) => labels.get(`${filter}|${value}`) || (filter === 'discussed' ? '有群聊摘要' : value);

  const highlightText = (text, variant) => {
    if (!variant || !bm25?.ranges) return esc(text);
    const ranges = bm25.ranges(text, variant);
    if (!ranges.length) return esc(text);
    let out = '', pos = 0;
    for (const [start, end] of ranges) {
      if (start > pos) out += esc(text.slice(pos, start));
      out += `<mark>${esc(text.slice(start, end))}</mark>`;
      pos = end;
    }
    if (pos < text.length) out += esc(text.slice(pos));
    return out;
  };

  function updateHighlights() {
    const exp = parsedQuery.freeText ? explainQuery(parsedQuery.freeText) : null;
    for (const entry of entries) {
      const p = plainText.get(entry);
      const hit = exp?.map.get(entry);
      if (hit?.variant) {
        if (p.titleEl) p.titleEl.innerHTML = highlightText(p.title, hit.variant);
        if (p.summaryEl) p.summaryEl.innerHTML = highlightText(p.summary, hit.variant);
      } else {
        if (p.titleEl && p.titleEl.innerHTML !== esc(p.title)) p.titleEl.textContent = p.title;
        if (p.summaryEl && p.summaryEl.innerHTML !== esc(p.summary)) p.summaryEl.textContent = p.summary;
      }
    }
  }

  function order() {
    const exp = parsedQuery.freeText ? explainQuery(parsedQuery.freeText) : null;
    const mode = state.sort === 'relevance' && !exp ? 'recent' : state.sort;
    let sorted = original;
    if (mode === 'relevance' && exp) {
      sorted = original.slice().sort((a, b) => (exp.map.get(b)?.score || 0) - (exp.map.get(a)?.score || 0));
    } else if (mode === 'heat') {
      sorted = original.slice().sort((a, b) => Number(b.dataset.heat || 0) - Number(a.dataset.heat || 0) || (b.dataset.first || '').localeCompare(a.dataset.first || ''));
    } else if (mode === 'active') {
      sorted = original.slice().sort((a, b) => (b.dataset.last || '').localeCompare(a.dataset.last || '') || (b.dataset.first || '').localeCompare(a.dataset.first || ''));
    }
    if (sorted.some((entry, index) => list.children[index] !== entry)) list.append(...sorted);
  }

  function renderExplain() {
    if (!explainEl) return;
    if (state.opportunities || !parsedQuery.freeText) {
      explainEl.hidden = true;
      explainEl.innerHTML = '';
      return;
    }
    const { read } = explainQuery(parsedQuery.freeText);
    const parts = [];
    if (read.expanded?.length) {
      parts.push(`<span>已同时搜索：${read.expanded.map(e => `<strong>${esc(e.alias)}</strong>（${esc(e.targets.slice(0, 3).join('、'))}）`).join('、')}</span>`);
    }
    if (read.dropped_terms?.length) {
      parts.push(`<span>已忽略未收录词：${read.dropped_terms.map(t => `<code>${esc(t)}</code>`).join('、')}</span>`);
    }
    if (read.missing_versions?.length) {
      const knownText = Object.entries(read.known_versions || {}).map(([name, vs]) => `${name}: ${vs.join(', ')}`).join('；');
      parts.push(`<span>暂未收录 ${read.missing_versions.map(v => `<code>${esc(v)}</code>`).join('、')}${knownText ? `（已有版本：${esc(knownText)}）` : ''}</span>`
        + (read.version_free ? ` <button type="button" class="explain-retry" data-retry-q="${esc(read.version_free)}">改搜“${esc(read.version_free)}”</button>` : ''));
    }
    explainEl.hidden = !parts.length;
    explainEl.innerHTML = parts.join(' <span class="explain-sep">·</span> ');
  }

  function renderAtlas() {
    if (!atlasEl) return;
    if (state.opportunities || state.view !== 'atlas') {
      atlasEl.hidden = true;
      return;
    }
    const visibleItems = entries.filter(e => !e.hidden).map(e => itemMeta.get(e));
    const topics = data.topics || {};
    const cards = Object.entries(topics).map(([id, info]) => {
      const items = visibleItems.filter(it => it.topics.includes(id));
      if (!items.length) return '';
      const top = items.slice().sort((a, b) => b.heat - a.heat || b.first.localeCompare(a.first)).slice(0, 3);
      const typeCounts = new Map();
      for (const it of items) typeCounts.set(it.type, (typeCounts.get(it.type) || 0) + 1);
      const typePills = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([t, n]) => `<span class="atlas-type">${esc(data.types?.[t] || t)} ${n}</span>`).join('');
      return `<article class="atlas-card">` +
        `<header class="atlas-head"><h3>${esc(info.label)}</h3><span class="atlas-count">${items.length}</span></header>` +
        `<p class="atlas-covers">${esc(info.covers)}</p>` +
        `<div class="atlas-types">${typePills}</div>` +
        `<ul class="atlas-top">${top.map(it => `<li><button type="button" data-detail-id="${esc(it.id)}"><span class="atlas-item-title">${esc(it.title)}</span><span class="atlas-item-meta">${esc(data.types?.[it.type] || it.type)}${it.discussions.length ? ` · ${it.discussions.length} 讨论` : ''}</span></button></li>`).join('')}</ul>` +
        `<footer class="atlas-foot"><button type="button" class="atlas-all" data-atlas-topic="${esc(id)}">查看全部 ${items.length} 项 →</button></footer>` +
        `</article>`;
    }).filter(Boolean);
    atlasEl.hidden = !cards.length;
    atlasEl.innerHTML = cards.join('');
  }

  function syncSavedUI() {
    const n = savedIds.size;
    const badge = $('#library-saved-count');
    const lensCount = $('#lens-saved-count');
    const toggle = $('#library-saved-toggle');
    if (badge) { badge.textContent = String(n); badge.hidden = n === 0; }
    if (lensCount) lensCount.textContent = String(n);
    if (toggle) toggle.setAttribute('aria-pressed', String(state.savedOnly));
    for (const btn of document.querySelectorAll('.entry-save[data-save-id]')) {
      const active = savedIds.has(btn.dataset.saveId);
      btn.setAttribute('aria-pressed', String(active));
    }
  }

  function syncLenses() {
    const noFilters = !Object.values(state.selected).some(s => s.size) && !state.q && !state.hotOnly && !state.savedOnly;
    for (const btn of document.querySelectorAll('.lenses .lens')) {
      const l = btn.dataset.lens;
      let pressed = false;
      if (l === 'all') pressed = noFilters && !state.opportunities;
      else if (l === 'recent') pressed = state.selected.when.has('7d') && !state.savedOnly;
      else if (l === 'hot') pressed = state.hotOnly;
      else if (l === 'paper-code') pressed = state.selected.type.has('paper') && state.selected.link.has('code');
      else if (l === 'benchmarks') pressed = state.selected.type.has('benchmark');
      else if (l === 'saved') pressed = state.savedOnly;
      btn.setAttribute('aria-pressed', String(pressed));
    }
  }

  function apply({ write = true } = {}) {
    parsedQuery = parseQuery(state.q);
    if (searchClear) searchClear.hidden = !state.q;
    const opportunityView = state.opportunities;
    if (opportunities) opportunities.hidden = !opportunityView;
    for (const row of document.querySelectorAll('.filter-row:not([data-row="type"]), .more-filters, .lenses, .toolbar-controls, #library-explain')) {
      row.hidden = opportunityView;
    }
    $('.search .visually-hidden').textContent = opportunityView ? '搜索机会' : '搜索资料';
    input.placeholder = opportunityView ? '搜机会标题、简介或机构' : '搜标题、简介、网址，或 type:paper has:code';

    let shown = 0;
    for (const entry of entries) {
      const visible = !opportunityView && matches(entry);
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
        const m = [...closed.querySelectorAll('.opportunity')].filter(card => !card.hidden).length;
        closed.hidden = !m;
        closed.querySelector('summary').textContent = `已截止 ${m} 项`;
      }
    }

    list.hidden = opportunityView || state.view === 'atlas' || shown === 0;
    list.classList.toggle('is-list-view', state.view === 'list');

    for (const chip of chips) {
      const { filter, value } = chip.dataset;
      const selected = state.selected[filter];
      chip.setAttribute('aria-pressed', String(value === 'opportunity' ? opportunityView : !opportunityView && (value ? selected.has(value) : !selected.size)));
      const result = value === 'opportunity' ? opportunityCards.length
        : count({ ...state.selected, [filter]: new Set(value ? [value] : []) }, opportunityView ? '' : state.q);
      chip.querySelector('.chip-count').textContent = result;
      chip.classList.toggle('is-empty', !result);
    }

    const active = opportunityView
      ? [['type', 'opportunity']]
      : [
        ...Object.entries(state.selected).flatMap(([filter, set]) => [...set].map(value => [filter, value])),
        ...(state.hotOnly ? [['hot', '1']] : []),
        ...(state.savedOnly ? [['saved', '1']] : []),
      ];
    applied.hidden = !active.length && !state.q;
    applied.innerHTML = active.map(([filter, value]) => {
      const text = filter === 'hot' ? '群内热议' : filter === 'saved' ? '我的收藏' : label(filter, value);
      return `<button type="button" data-remove="${esc(filter)}" data-value="${esc(value)}">${esc(text)}<span aria-hidden="true">×</span><span class="visually-hidden">（移除）</span></button>`;
    }).join('') +
      (state.q ? `<button type="button" data-remove="q">搜索“${esc(state.q)}”<span aria-hidden="true">×</span></button>` : '') +
      (active.length + Boolean(state.q) > 1 ? '<button type="button" class="applied-clear" data-remove="all">清除全部</button>' : '');

    if (['link', 'group', 'when', 'discussed'].some(filter => state.selected[filter]?.size)) $('.more-filters').open = true;

    const viewTotal = opportunityView ? opportunityCards.length : total;
    status.textContent = opportunityView
      ? (state.q ? `显示 ${shown} / ${viewTotal} 项机会` : `共 ${viewTotal} 项机会`)
      : (shown === total ? `共 ${total} 项` : `显示 ${shown} / ${total} 项`);
    empty.querySelector('p').textContent = opportunityView ? '没找到符合条件的机会。' : '没找到符合条件的资料。';
    empty.hidden = shown > 0;
    relax.innerHTML = shown ? '' : (opportunityView ? (state.q ? [['不限搜索词', opportunityCards.length, 'q', '']] : []) : [
      ...active.map(([filter, value]) => {
        if (filter === 'hot') return ['取消“群内热议”', count(state.selected, state.q, false, state.savedOnly), 'hot', '1'];
        if (filter === 'saved') return ['取消“我的收藏”', count(state.selected, state.q, state.hotOnly, false), 'saved', '1'];
        return [`去掉“${label(filter, value)}”`, count(without(filter, value), state.q), filter, value];
      }),
      ...(state.q ? [['不限搜索词', count(state.selected, ''), 'q', '']] : []),
    ]).filter(([, n]) => n).map(([text, n, filter, value]) => `<li><button type="button" data-remove="${esc(filter)}" data-value="${esc(value)}">${esc(text)}，有 ${n} 项</button></li>`).join('');

    const relBtn = $('.library-sort [data-sort-by="relevance"]');
    if (relBtn) relBtn.hidden = !parsedQuery.freeText;
    for (const btn of document.querySelectorAll('.library-sort button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.sortBy === state.sort));
    }
    for (const btn of document.querySelectorAll('.view-switch button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.viewMode === state.view));
    }

    if (opportunityView) {
      if (atlasEl) atlasEl.hidden = true;
    } else {
      order();
      updateHighlights();
      renderExplain();
      renderAtlas();
    }
    syncLenses();
    syncSavedUI();
    renderKeywordQuickMatches();

    if (!write) return;
    const query = new URLSearchParams();
    if (opportunityView) query.set('type', 'opportunity');
    else {
      for (const [filter, param] of Object.entries(filters)) for (const value of state.selected[filter]) query.append(param, value);
      if (state.hotOnly) query.set('hot', '1');
      if (state.savedOnly) query.set('saved', '1');
      if (state.sort !== 'recent' && !(state.sort === 'relevance' && parsedQuery.freeText)) query.set('sort', state.sort);
      if (state.view !== 'cards') query.set('view', state.view);
    }
    if (state.q) query.set('q', state.q);
    const hash = !opportunityView && (location.hash === '#opportunities' || document.getElementById(location.hash.slice(1))?.classList.contains('opportunity')) ? '' : location.hash;
    const url = `${location.pathname}${query.size ? `?${query}` : ''}${hash}`;
    if (url !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(null, '', url);
  }

  const clear = () => {
    for (const filter of Object.keys(filters)) state.selected[filter] = new Set();
    state.q = '';
    input.value = '';
    state.hotOnly = false;
    state.savedOnly = false;
    state.opportunities = false;
    if (state.sort === 'relevance') state.sort = 'recent';
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

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-remove]');
    if (!button) return;
    const { remove, value } = button.dataset;
    if (remove === 'all') clear();
    else if (remove === 'q') { state.q = ''; input.value = ''; if (state.sort === 'relevance') state.sort = 'recent'; }
    else if (remove === 'hot') state.hotOnly = false;
    else if (remove === 'saved') state.savedOnly = false;
    else if (remove === 'type' && value === 'opportunity') clear();
    else state.selected[remove]?.delete(value);
    apply();
  });

  const more = $('.chips-more');
  more?.addEventListener('click', () => {
    const open = more.getAttribute('aria-expanded') !== 'true';
    more.setAttribute('aria-expanded', String(open));
    more.closest('.chips').classList.toggle('show-all', open);
    more.textContent = open ? '收起' : more.dataset.label;
  });

  document.addEventListener('click', event => {
    const tag = event.target.closest('.entry-tags a[data-filter], a[data-filter-link]');
    if (!tag || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    if (state.opportunities) clear();
    state.selected[tag.dataset.filter].add(tag.dataset.value);
    apply();
    $('.filters').scrollIntoView({ block: 'start' });
  });

  // Keyword quick-search across ALL keywords (including count < 3).
  const kwInput = $('#keyword-filter-input');
  const kwMatchesEl = $('#keyword-matches');
  function renderKeywordQuickMatches() {
    if (!kwInput || !kwMatchesEl) return;
    const term = kwInput.value.trim().toLowerCase();
    if (!term) { kwMatchesEl.hidden = true; kwMatchesEl.innerHTML = ''; return; }
    const expandTargets = new Set();
    for (const [alias, targets] of Object.entries(data.vocabulary?.expand || {})) {
      if (alias.toLowerCase().includes(term)) for (const t of targets) expandTargets.add(t.toLowerCase());
    }
    const matched = (data.keywords || [])
      .filter(([kw]) => kw.toLowerCase().includes(term) || expandTargets.has(kw.toLowerCase()))
      .slice(0, 24);
    kwMatchesEl.hidden = false;
    kwMatchesEl.innerHTML = matched.length
      ? matched.map(([kw, n]) => `<button type="button" class="kw-match" data-pick-kw="${esc(kw)}" aria-pressed="${state.selected.keyword.has(kw)}">${esc(kw)}<span class="chip-count">${n}</span></button>`).join('')
      : '<span class="kw-none">没有匹配的关键词</span>';
  }
  kwInput?.addEventListener('input', renderKeywordQuickMatches);
  kwMatchesEl?.addEventListener('click', event => {
    const btn = event.target.closest('[data-pick-kw]');
    if (!btn) return;
    const kw = btn.dataset.pickKw;
    if (state.selected.keyword.has(kw)) state.selected.keyword.delete(kw);
    else state.selected.keyword.add(kw);
    apply();
  });

  // Quick lenses.
  document.querySelector('.lenses')?.addEventListener('click', event => {
    const btn = event.target.closest('.lens');
    if (!btn) return;
    const l = btn.dataset.lens;
    if (l === 'all') {
      clear();
    } else if (l === 'recent') {
      const had = state.selected.when.has('7d');
      clear();
      if (!had) state.selected.when.add('7d');
    } else if (l === 'hot') {
      state.hotOnly = !state.hotOnly;
    } else if (l === 'paper-code') {
      const active = state.selected.type.has('paper') && state.selected.link.has('code');
      clear();
      if (!active) { state.selected.type.add('paper'); state.selected.link.add('code'); }
    } else if (l === 'benchmarks') {
      const active = state.selected.type.has('benchmark');
      clear();
      if (!active) state.selected.type.add('benchmark');
    } else if (l === 'saved') {
      state.savedOnly = !state.savedOnly;
    }
    apply();
  });

  $('#library-saved-toggle')?.addEventListener('click', () => {
    if (state.opportunities) clear();
    state.savedOnly = !state.savedOnly;
    apply();
  });

  // Sort & View switches.
  document.querySelector('.library-sort')?.addEventListener('click', event => {
    const btn = event.target.closest('[data-sort-by]');
    if (!btn) return;
    state.sort = btn.dataset.sortBy;
    apply();
  });
  document.querySelector('.view-switch')?.addEventListener('click', event => {
    const btn = event.target.closest('[data-view-mode]');
    if (!btn) return;
    state.view = btn.dataset.viewMode;
    apply();
  });
  atlasEl?.addEventListener('click', event => {
    const topicBtn = event.target.closest('[data-atlas-topic]');
    if (topicBtn) {
      state.selected.topic.clear();
      state.selected.topic.add(topicBtn.dataset.atlasTopic);
      state.view = 'cards';
      apply();
      $('.filters').scrollIntoView({ block: 'start' });
      return;
    }
    const detailBtn = event.target.closest('[data-detail-id]');
    if (detailBtn) openDetail(detailBtn.dataset.detailId, detailBtn);
  });

  // Search input + Autocomplete suggestions.
  let suggestIndex = -1;
  function renderSuggestions() {
    if (!suggestEl) return;
    const raw = input.value.trim();
    if (!raw || state.opportunities || document.activeElement !== input) {
      suggestEl.hidden = true;
      suggestEl.innerHTML = '';
      suggestIndex = -1;
      return;
    }
    const qLow = raw.toLowerCase();
    const groups = [];
    const topicMatches = Object.entries(data.topics || {})
      .filter(([id, info]) => id.includes(qLow) || info.label.toLowerCase().includes(qLow))
      .slice(0, 2);
    if (topicMatches.length) {
      groups.push(`<div class="suggest-group"><div class="suggest-head">主题</div>${topicMatches.map(([id, info]) =>
        `<button type="button" class="suggest-item" role="option" data-suggest-topic="${esc(id)}"><span>${esc(info.label)}</span><kbd>筛选主题</kbd></button>`).join('')}</div>`);
    }
    const kwMatches = (data.keywords || []).filter(([kw]) => kw.toLowerCase().includes(qLow)).slice(0, 3);
    if (kwMatches.length) {
      groups.push(`<div class="suggest-group"><div class="suggest-head">关键词</div>${kwMatches.map(([kw, n]) =>
        `<button type="button" class="suggest-item" role="option" data-suggest-kw="${esc(kw)}"><span>${esc(kw)}</span><kbd>${n} 项</kbd></button>`).join('')}</div>`);
    }
    const itemHits = (data.items || [])
      .filter(it => it.title.toLowerCase().includes(qLow) || it.summary.toLowerCase().includes(qLow))
      .slice(0, 4);
    if (itemHits.length) {
      groups.push(`<div class="suggest-group"><div class="suggest-head">直达条目</div>${itemHits.map(it =>
        `<button type="button" class="suggest-item" role="option" data-suggest-item="${esc(it.id)}"><span>${esc(it.title)}</span><kbd>${esc(data.types?.[it.type] || it.type)}</kbd></button>`).join('')}</div>`);
    }
    if (!groups.length) { suggestEl.hidden = true; suggestEl.innerHTML = ''; return; }
    suggestEl.innerHTML = groups.join('');
    suggestEl.hidden = false;
    suggestIndex = -1;
  }

  let timer;
  input.addEventListener('input', () => {
    renderSuggestions();
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = input.value.trim();
      if (state.q && !state.opportunities && state.sort === 'recent') state.sort = 'relevance';
      else if (!state.q && state.sort === 'relevance') state.sort = 'recent';
      apply();
    }, 120);
  });
  input.addEventListener('focus', renderSuggestions);
  input.addEventListener('blur', () => setTimeout(() => { if (suggestEl) suggestEl.hidden = true; }, 160));
  input.addEventListener('keydown', event => {
    if (!suggestEl || suggestEl.hidden) return;
    const opts = [...suggestEl.querySelectorAll('.suggest-item')];
    if (!opts.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      suggestIndex = (suggestIndex + 1) % opts.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      suggestIndex = (suggestIndex - 1 + opts.length) % opts.length;
    } else if (event.key === 'Enter' && suggestIndex >= 0) {
      event.preventDefault();
      opts[suggestIndex].click();
      return;
    } else if (event.key === 'Escape') {
      suggestEl.hidden = true;
      return;
    } else return;
    opts.forEach((o, i) => o.classList.toggle('is-active', i === suggestIndex));
  });
  suggestEl?.addEventListener('mousedown', event => event.preventDefault());
  suggestEl?.addEventListener('click', event => {
    const opt = event.target.closest('.suggest-item');
    if (!opt) return;
    suggestEl.hidden = true;
    if (opt.dataset.suggestTopic) {
      state.q = ''; input.value = ''; state.sort = 'recent';
      state.selected.topic.add(opt.dataset.suggestTopic);
      apply();
    } else if (opt.dataset.suggestKw) {
      state.q = ''; input.value = ''; state.sort = 'recent';
      state.selected.keyword.add(opt.dataset.suggestKw);
      apply();
    } else if (opt.dataset.suggestItem) {
      openDetail(opt.dataset.suggestItem, input);
    }
  });

  searchClear?.addEventListener('click', () => {
    state.q = ''; input.value = '';
    if (state.sort === 'relevance') state.sort = 'recent';
    apply();
    input.focus();
  });

  explainEl?.addEventListener('click', event => {
    const btn = event.target.closest('[data-retry-q]');
    if (!btn) return;
    state.q = btn.dataset.retryQ;
    input.value = state.q;
    apply();
  });

  $('#library-reset').addEventListener('click', () => {
    clear();
    apply();
    input.focus();
  });

  // Bookmark buttons.
  document.addEventListener('click', event => {
    const btn = event.target.closest('.entry-save[data-save-id]');
    if (!btn) return;
    const id = btn.dataset.saveId;
    if (savedIds.has(id)) { savedIds.delete(id); showToast('已从收藏移除'); }
    else { savedIds.add(id); showToast('已加入本地收藏夹'); }
    saveToStorage();
    if (state.savedOnly) apply();
    else syncSavedUI();
  });

  // Toast helper.
  let toastTimer;
  function showToast(msg) {
    const toast = $('#library-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
  }

  async function copyText(text, toastMsg) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(toastMsg);
    } catch {
      showToast('复制失败，请手动复制');
    }
  }

  function buildBibtex(item) {
    const arxivLink = item.links.find(l => /arxiv\.org\/abs\/(\d{4}\.\d{4,5})/.test(l.url));
    const arxivId = arxivLink?.url.match(/(\d{4}\.\d{4,5})/)?.[1];
    const year = item.first?.slice(0, 4) || '2026';
    const key = item.id.replace(/[^a-z0-9]/gi, '_');
    return `@article{${key},\n  title={${item.title}},\n  year={${year}},${arxivId ? `\n  eprint={${arxivId}},\n  archivePrefix={arXiv},` : ''}\n  url={${item.links[0]?.url || ''}}\n}`;
  }

  // Export menu.
  const exportBtn = $('#library-export-toggle');
  const exportMenu = $('#library-export-menu');
  exportBtn?.addEventListener('click', () => {
    const open = exportMenu.hidden;
    if (open) {
      const rect = exportBtn.getBoundingClientRect();
      exportMenu.classList.toggle('is-align-left', rect.right < 210);
    }
    exportMenu.hidden = !open;
    exportBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', event => {
    if (exportMenu && !exportMenu.hidden && !event.target.closest('.export-menu')) {
      exportMenu.hidden = true;
      exportBtn?.setAttribute('aria-expanded', 'false');
    }
  });
  exportMenu?.addEventListener('click', event => {
    const btn = event.target.closest('[data-export]');
    if (!btn) return;
    const mode = btn.dataset.export;
    exportMenu.hidden = true;
    exportBtn?.setAttribute('aria-expanded', 'false');
    const visibleItems = entries.filter(e => !e.hidden).map(e => itemMeta.get(e));
    if (mode === 'markdown') {
      const md = `# Agent Hub 资料库筛选清单（${visibleItems.length} 项）\n\n` +
        visibleItems.map(it => `- [${it.title}](${it.links[0]?.url || ''}) · ${data.types?.[it.type] || it.type} · ${it.first}\n  ${it.summary}`).join('\n');
      copyText(md, `已复制 ${visibleItems.length} 条资料的 Markdown 清单`);
    } else if (mode === 'bibtex') {
      const papers = visibleItems.filter(it => it.type === 'paper' || it.links.some(l => l.url.includes('arxiv.org')));
      if (!papers.length) { showToast('当前结果中没有论文条目'); return; }
      copyText(papers.map(buildBibtex).join('\n\n'), `已复制 ${papers.length} 篇论文的 BibTeX`);
    } else if (mode === 'download-md') {
      const md = `# Agent Hub 资料库导出（${visibleItems.length} 项）\n\n` +
        visibleItems.map(it => `- [${it.title}](${it.links[0]?.url || ''}) · ${data.types?.[it.type] || it.type} · ${it.first}\n  ${it.summary}`).join('\n');
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `agenthub-library-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      showToast(`已下载 ${visibleItems.length} 条资料`);
    } else if (mode === 'share-url') {
      copyText(location.href, '已复制当前筛选链接');
    }
  });

  // Slide-over Detail Drawer.
  const detailDialog = $('#library-detail');
  let detailStack = [];
  let detailOpener = null;

  function drawerLinkIcon(url, kind) {
    let h = '';
    try { h = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch {}
    let id = 'l-globe', brand = 'kind';
    if (h === 'github.com') { id = 'l-github'; brand = 'github'; }
    else if (h === 'arxiv.org' || h === 'alphaxiv.org') { id = 'l-arxiv'; brand = 'arxiv'; }
    else if (h === 'huggingface.co') { id = 'l-hf'; brand = 'color'; }
    else if (h === 'mp.weixin.qq.com') { id = 'l-wechat'; brand = 'wechat'; }
    else if (h === 'x.com' || h === 'twitter.com') { id = 'l-x'; brand = 'x'; }
    else if (h === 'zhihu.com' || h === 'zhuanlan.zhihu.com') { id = 'l-zhihu'; brand = 'zhihu'; }
    else if (h === 'anthropic.com' || h.endsWith('.anthropic.com') || h === 'claude.ai' || h === 'claude.com' || h.endsWith('.claude.com')) { id = 'l-anthropic'; brand = 'anthropic'; }
    else if (h === 'openai.com' || h.endsWith('.openai.com') || h === 'chatgpt.com') { id = 'l-openai'; brand = 'openai'; }
    else if (h === 'qwen.ai' || h.endsWith('.qwen.ai') || h === 'qwenlm.github.io') { id = 'l-qwen'; brand = 'color'; }
    else if (h === 'deepmind.google' || h.endsWith('.deepmind.com')) { id = 'l-deepmind'; brand = 'color'; }
    else if (h === 'blog.google' || h === 'ai.google.dev' || h.endsWith('.google.com') || h === 'google.com') { id = 'l-google'; brand = 'color'; }
    else if (h === 'deepseek.com' || h.endsWith('.deepseek.com')) { id = 'l-deepseek'; brand = 'color'; }
    else if (h === 'nvidia.com' || h.endsWith('.nvidia.com')) { id = 'l-nvidia'; brand = 'color'; }
    else if (h === 'mistral.ai' || h.endsWith('.mistral.ai')) { id = 'l-mistral'; brand = 'color'; }
    else if (h === 'kimi.ai' || h.endsWith('.kimi.ai') || h === 'moonshot.cn' || h.endsWith('.moonshot.cn')) { id = 'l-kimi'; brand = 'color'; }
    else if (h === 'bilibili.com' || h === 'b23.tv') { id = 'l-bilibili'; brand = 'bilibili'; }
    else if (h === 'youtube.com' || h === 'youtu.be') { id = 'l-youtube'; brand = 'youtube'; }
    else if (h.endsWith('.vercel.app') || h === 'vercel.com') { id = 'l-vercel'; brand = 'vercel'; }
    else if (h === 'notion.so' || h.endsWith('.notion.site')) { id = 'l-notion'; brand = 'notion'; }
    else if (h.endsWith('.github.io')) { id = 'l-ghpages'; brand = 'ghpages'; }
    else if (h === 'openreview.net' || h === 'biorxiv.org' || h === 'medrxiv.org' || h === 'doi.org') { id = 'l-paper'; brand = 'kind'; }
    else {
      const byKind = { paper: 'l-paper', code: 'l-code', data: 'l-data', model: 'l-model', leaderboard: 'l-board', docs: 'l-docs', video: 'l-video' };
      id = byKind[kind] || 'l-globe';
    }
    return `<svg class="icon link-logo" data-brand="${brand}" width="15" height="15" aria-hidden="true"><use href="#${id}"/></svg>`;
  }

  function renderDetail(item) {
    if (!detailDialog || !item) return;
    const isSaved = savedIds.has(item.id);
    const topicsHtml = item.topics.map(t => `<button type="button" class="tag-topic" data-drawer-filter="topic" data-value="${esc(t)}">${esc(data.topics?.[t]?.label || t)}</button>`).join('');
    const kwHtml = item.keywords.map(k => `<button type="button" class="tag-keyword" data-drawer-filter="keyword" data-value="${esc(k)}">${esc(k)}</button>`).join('');
    const linksHtml = item.links.map(l => `<a class="drawer-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${drawerLinkIcon(l.url, l.kind)}<span class="link-kind">${esc(data.linkKinds?.[l.kind] || l.kind)}</span><span class="drawer-link-url">${esc(l.url.replace(/^https?:\/\//, ''))}</span></a>`).join('');
    const discHtml = item.discussions?.length
      ? `<section class="drawer-section"><h3>群聊讨论脉络（${item.discussions.length}）</h3><ul class="drawer-discussions">${item.discussions.map(d =>
        `<li><a href="${esc(d.href)}"><span class="disc-badge">${d.kind === 'weekly' ? '周报' : '日报'}</span><span class="disc-date">${esc(d.date)} · ${esc(data.groups?.[d.group] || d.group)}</span><span class="disc-title">${esc(d.title)}</span></a></li>`).join('')}</ul></section>`
      : '';
    const relatedItems = (item.related || []).map(id => itemsById.get(id)).filter(Boolean);
    const relatedHtml = relatedItems.length
      ? `<section class="drawer-section"><h3>相关资料推荐</h3><div class="drawer-related">${relatedItems.map(r =>
        `<button type="button" class="related-card" data-drawer-open="${esc(r.id)}"><span class="related-type">${esc(data.types?.[r.type] || r.type)}</span><strong>${esc(r.title)}</strong><span>${esc(r.summary)}</span></button>`).join('')}</div></section>`
      : '';
    const repoUrl = data.repoUrl || 'https://github.com/Agent-Hub-Community/newspaper';
    const editIssueUrl = `${repoUrl}/issues/new?title=${encodeURIComponent(`[资料纠错] ${item.title}`)}&body=${encodeURIComponent(`条目 ID: \`${item.id}\`\n页面: ${location.origin}${location.pathname}#${item.id}\n\n请说明需要补充的链接或修正内容：\n`)}`;

    detailDialog.innerHTML = `<div class="drawer-shell">` +
      `<header class="drawer-top">` +
      `<div class="drawer-nav">${detailStack.length > 1 ? '<button type="button" class="drawer-back" data-drawer-back>← 返回</button>' : ''}` +
      `<span class="entry-type" data-type="${esc(item.type)}">${esc(data.types?.[item.type] || item.type)}</span>` +
      `<span class="drawer-dates">首次 ${esc(item.first)}${item.last && item.last !== item.first ? ` · 最近 ${esc(item.last)}` : ''}</span></div>` +
      `<div class="drawer-top-actions"><button type="button" class="entry-save" data-drawer-save="${esc(item.id)}" aria-pressed="${isSaved}" title="收藏"><svg class="icon" width="16" height="16"><use href="#i-bm"/></svg></button>` +
      `<button type="button" class="drawer-close" data-drawer-close aria-label="关闭详情">×</button></div></header>` +
      `<div class="drawer-body">` +
      `<h2 id="detail-title" class="drawer-title"><a href="${esc(item.links[0]?.url || '#')}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a></h2>` +
      `<p class="drawer-summary">${esc(item.summary)}</p>` +
      `<section class="drawer-section"><h3>直达链接</h3><div class="drawer-links">${linksHtml}</div></section>` +
      `<section class="drawer-section"><h3>主题与关键词</h3><div class="entry-tags">${topicsHtml}${kwHtml}</div></section>` +
      discHtml + relatedHtml +
      `<section class="drawer-section drawer-tools">` +
      `<button type="button" data-drawer-copy="md">复制 Markdown</button>` +
      (item.type === 'paper' || item.links.some(l => l.url.includes('arxiv.org')) ? `<button type="button" data-drawer-copy="bib">复制 BibTeX</button>` : '') +
      `<button type="button" data-drawer-copy="link">复制深链</button>` +
      `<a class="drawer-edit-link" href="${esc(editIssueUrl)}" target="_blank" rel="noopener noreferrer">纠错 / 补充链接</a>` +
      `</section></div></div>`;
  }

  function openDetail(id, opener = null) {
    const item = itemsById.get(id);
    if (!item || !detailDialog) return;
    if (!detailDialog.open) { detailStack = []; detailOpener = opener || document.activeElement; }
    detailStack.push(id);
    renderDetail(item);
    if (!detailDialog.open) detailDialog.showModal();
  }

  document.addEventListener('click', event => {
    const btn = event.target.closest('.entry-detail-btn[data-detail-id]');
    if (btn) openDetail(btn.dataset.detailId, btn);
  });

  detailDialog?.addEventListener('click', event => {
    if (event.target === detailDialog || event.target.closest('[data-drawer-close]')) {
      detailDialog.close();
      return;
    }
    if (event.target.closest('[data-drawer-back]')) {
      detailStack.pop();
      const prev = itemsById.get(detailStack.at(-1));
      if (prev) renderDetail(prev);
      return;
    }
    const openBtn = event.target.closest('[data-drawer-open]');
    if (openBtn) {
      openDetail(openBtn.dataset.drawerOpen);
      return;
    }
    const saveBtn = event.target.closest('[data-drawer-save]');
    if (saveBtn) {
      const id = saveBtn.dataset.drawerSave;
      if (savedIds.has(id)) { savedIds.delete(id); showToast('已从收藏移除'); }
      else { savedIds.add(id); showToast('已加入本地收藏夹'); }
      saveToStorage();
      saveBtn.setAttribute('aria-pressed', String(savedIds.has(id)));
      if (state.savedOnly) apply();
      else syncSavedUI();
      return;
    }
    const filterBtn = event.target.closest('[data-drawer-filter]');
    if (filterBtn) {
      const { drawerFilter, value } = filterBtn.dataset;
      detailDialog.close();
      if (state.opportunities) clear();
      state.selected[drawerFilter].add(value);
      apply();
      $('.filters').scrollIntoView({ block: 'start' });
      return;
    }
    const copyBtn = event.target.closest('[data-drawer-copy]');
    if (copyBtn) {
      const item = itemsById.get(detailStack.at(-1));
      if (!item) return;
      if (copyBtn.dataset.drawerCopy === 'md') copyText(`- [${item.title}](${item.links[0]?.url || ''}) — ${item.summary}`, '已复制 Markdown');
      else if (copyBtn.dataset.drawerCopy === 'bib') copyText(buildBibtex(item), '已复制 BibTeX');
      else copyText(`${location.origin}${location.pathname}#${item.id}`, '已复制条目深链');
    }
  });
  detailDialog?.addEventListener('close', () => { detailOpener?.focus?.(); });

  // Community Submit Resource Modal.
  const submitDialog = $('#library-submit');
  const submitOpen = $('#library-submit-open');
  let submitOpener = null;

  function inferTypeFromInput(rawUrl) {
    const k = clientResourceKey(rawUrl);
    if (k.startsWith('arxiv:')) return 'paper';
    if (k.startsWith('github:')) return 'code';
    try {
      const u = new URL(rawUrl);
      if (u.hostname.includes('huggingface.co') && u.pathname.startsWith('/datasets/')) return 'dataset';
      if (u.hostname.includes('huggingface.co') && !u.pathname.startsWith('/spaces/')) return 'model';
      if (/youtube\.com|youtu\.be|bilibili\.com/.test(u.hostname)) return 'video';
    } catch { /* ignore */ }
    return 'article';
  }

  function renderSubmitModal() {
    if (!submitDialog) return;
    const typeOptions = Object.entries(data.types || {}).map(([k, v]) => `<option value="${esc(k)}">${esc(v)} (${esc(k)})</option>`).join('');
    const topicPills = Object.entries(data.topics || {}).map(([k, v]) => `<button type="button" class="submit-topic" data-sub-topic="${esc(k)}" aria-pressed="false">${esc(v.label)}</button>`).join('');
    const groupOptions = Object.entries(data.groups || {}).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    submitDialog.innerHTML = `<div class="submit-shell">` +
      `<header class="drawer-top"><h2 id="submit-title">推荐资料到 Agent Hub 资料库</h2><button type="button" class="drawer-close" data-sub-close aria-label="关闭">×</button></header>` +
      `<form class="submit-form" id="library-submit-form">` +
      `<label>主链接 (URL) *<input type="url" name="url" id="sub-url" required placeholder="https://arxiv.org/abs/... 或 https://github.com/..."></label>` +
      `<div class="submit-dup" id="sub-dup" hidden></div>` +
      `<div class="submit-row">` +
      `<label>标题 *<input type="text" name="title" id="sub-title" required maxlength="100" placeholder="资料正式名称"></label>` +
      `<label>类型 *<select name="type" id="sub-type">${typeOptions}</select></label></div>` +
      `<div class="submit-field"><span>主题（1–3 个）*</span><div class="submit-topics">${topicPills}</div></div>` +
      `<label>关键词（3–12 个，逗号分隔）*<input type="text" name="keywords" id="sub-keywords" required placeholder="如：OSWorld, RLVR, verifier"></label>` +
      `<label>一句话简介（中文，≤80 汉字）*<textarea name="summary" id="sub-summary" rows="2" required maxlength="160" placeholder="平实讲清楚它是什么、解决什么问题或关键规模/结果"></textarea><small class="sub-counter" id="sub-counter">0 / 80 汉字</small></label>` +
      `<div class="submit-row">` +
      `<label>补充链接（可选）<input type="url" name="extraUrl" id="sub-extra" placeholder="https://github.com/..."></label>` +
      `<label>来源群（可选）<select name="group" id="sub-group"><option value="">未知 / 公开渠道</option>${groupOptions}</select></label></div>` +
      `<footer class="submit-actions">` +
      `<button type="button" class="is-primary" data-sub-action="github">去 GitHub 提交推荐</button>` +
      `<button type="button" data-sub-action="json">复制标准 JSON</button>` +
      `<button type="button" data-sub-action="cli">复制 CLI 入库命令</button>` +
      `</footer></form></div>`;
  }

  submitOpen?.addEventListener('click', () => {
    if (!submitDialog) return;
    submitOpener = document.activeElement;
    if (!submitDialog.innerHTML) renderSubmitModal();
    submitDialog.showModal();
  });

  submitDialog?.addEventListener('input', event => {
    if (event.target.id === 'sub-url') {
      const val = event.target.value.trim();
      const dupEl = $('#sub-dup');
      const key = clientResourceKey(val);
      const existing = key && linkKeyMap.get(key);
      if (existing && dupEl) {
        dupEl.hidden = false;
        dupEl.innerHTML = `<span>资料库已收录相同链接：<strong>${esc(existing.title)}</strong></span> <button type="button" data-sub-view="${esc(existing.id)}">查看已有条目</button>`;
      } else if (dupEl) {
        dupEl.hidden = true;
        dupEl.innerHTML = '';
      }
      const typeSel = $('#sub-type');
      if (val && typeSel) typeSel.value = inferTypeFromInput(val);
    }
    if (event.target.id === 'sub-summary') {
      const hanzi = (event.target.value.match(/[\u4e00-\u9fff]/g) || []).length;
      const counter = $('#sub-counter');
      if (counter) counter.textContent = `${hanzi} / 80 汉字`;
    }
  });

  submitDialog?.addEventListener('click', event => {
    if (event.target === submitDialog || event.target.closest('[data-sub-close]')) {
      submitDialog.close();
      return;
    }
    const viewBtn = event.target.closest('[data-sub-view]');
    if (viewBtn) {
      submitDialog.close();
      openDetail(viewBtn.dataset.subView, submitOpen);
      return;
    }
    const topicBtn = event.target.closest('[data-sub-topic]');
    if (topicBtn) {
      const selected = submitDialog.querySelectorAll('[data-sub-topic][aria-pressed="true"]');
      const active = topicBtn.getAttribute('aria-pressed') === 'true';
      if (!active && selected.length >= 3) { showToast('最多选择 3 个主题'); return; }
      topicBtn.setAttribute('aria-pressed', String(!active));
      return;
    }
    const actionBtn = event.target.closest('[data-sub-action]');
    if (!actionBtn) return;
    const url = $('#sub-url')?.value.trim() || '';
    const title = $('#sub-title')?.value.trim() || '';
    const type = $('#sub-type')?.value || 'paper';
    const topics = [...submitDialog.querySelectorAll('[data-sub-topic][aria-pressed="true"]')].map(b => b.dataset.subTopic);
    const keywords = ($('#sub-keywords')?.value || '').split(/[,，、]+/).map(s => s.trim()).filter(Boolean);
    const summary = $('#sub-summary')?.value.trim() || '';
    const extraUrl = $('#sub-extra')?.value.trim() || '';
    const group = $('#sub-group')?.value || '';
    if (!url) { showToast('请先填写主链接'); return; }

    const mode = actionBtn.dataset.subAction;
    if (mode === 'github') {
      const repoUrl = data.repoUrl || 'https://github.com/Agent-Hub-Community/newspaper';
      const params = new URLSearchParams({
        template: 'library-submission.yml',
        title: `[资料推荐] ${title || url}`,
        url,
        ...(title ? { title_field: title } : {}),
      });
      const body = `### 主链接 (Primary URL)\n\n${url}\n\n### 标题 (Title)\n\n${title}\n\n### 类型 (Type)\n\n${type}\n\n### 主题 (Topics，1-3 个，逗号分隔)\n\n${topics.join(', ')}\n\n### 关键词 (Keywords，3-12 个，逗号分隔)\n\n${keywords.join(', ')}\n\n### 一句话简介 (Summary)\n\n${summary}${extraUrl ? `\n\n### 补充链接 (Extra Links)\n\n${extraUrl}` : ''}${group ? `\n\n### 来源群 (Group)\n\n${group}` : ''}`;
      params.set('body', body);
      window.open(`${repoUrl}/issues/new?${params}`, '_blank', 'noopener,noreferrer');
    } else if (mode === 'json') {
      const draft = {
        title, summary, type, topics: topics.length ? topics : ['coding-agents'], keywords,
        links: [{ kind: inferTypeFromInput(url) === 'paper' ? 'paper' : inferTypeFromInput(url) === 'code' ? 'code' : 'article', url },
          ...(extraUrl ? [{ kind: inferTypeFromInput(extraUrl) === 'code' ? 'code' : 'project', url: extraUrl }] : [])],
        ...(group ? { group } : {}),
      };
      copyText(JSON.stringify(draft, null, 2), '已复制资料草稿 JSON');
    } else if (mode === 'cli') {
      const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
      const cmd = `node scripts/library-cli.mjs add ${q(url)} --fetch` +
        (title ? ` --title ${q(title)}` : '') +
        (summary ? ` --summary ${q(summary)}` : '') +
        ` --type ${q(type)}` +
        (topics.length ? ` --topics ${q(topics.join(','))}` : '') +
        (keywords.length ? ` --keywords ${q(keywords.join(','))}` : '') +
        (extraUrl ? ` --extra-link ${q(extraUrl)}` : '') +
        (group ? ` --group ${q(group)}` : '');
      copyText(cmd, '已复制 CLI 入库命令');
    }
  });
  submitDialog?.addEventListener('close', () => { submitOpener?.focus?.(); });

  // Keyboard shortcuts: / or Cmd/Ctrl+K to focus search; 1/2/3 to switch view.
  document.addEventListener('keydown', event => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if ((event.key === '/' && !typing) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
      event.preventDefault();
      input.focus();
      input.select();
      return;
    }
    if (!typing && !detailDialog?.open && !submitDialog?.open && !state.opportunities) {
      if (event.key === '1') { state.view = 'cards'; apply(); }
      else if (event.key === '2') { state.view = 'list'; apply(); }
      else if (event.key === '3') { state.view = 'atlas'; apply(); }
    }
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

  for (const chip of chips.filter(chip => chip.dataset.value && chip.getAttribute('aria-pressed') === 'true')) {
    const row = chip.parentElement;
    if (chip.offsetLeft + chip.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = chip.offsetLeft - row.offsetLeft - 16;
  }

  const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
  if (target?.classList.contains('entry') && target.hidden) {
    clear();
    apply();
    target.scrollIntoView();
  }
})();
