/* global AGENT_HUB_DATA, lucide */
(() => {
  'use strict';
  const data = window.AGENT_HUB_DATA;
  const routes = window.AgentHubRoutes;
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icons = () => window.lucide.createIcons({ attrs: { 'aria-hidden': 'true', 'stroke-width': 1.6 } });
  const dateText = date => date.replaceAll('-', '.');
  let state = { mode: 'digest', id: data.digests.at(-1)?.id };
  const weeklies = data.weeklies || [];
  const ranks = Object.entries({ week: '周榜', month: '月榜', all: '总榜' }).map(([id, label]) => ({
    id, label, date: data.activity?.windows[id]?.through || data.coverage.last,
  }));
  const rankGroups = () => (data.activity?.groups || []).filter(group => /^group-\d+$/.test(group.id));
  // The board shows every group; a route may still name one (rank/week/group-2/) so going back to the daily opens it.
  const rankGroup = pageId => rankGroups().some(group => group.id === pageId) ? pageId : undefined;
  const entries = mode => mode === 'rank' ? ranks : mode === 'weekly' ? weeklies : data.digests;
  const key = item => item.id || item.date;
  const current = () => entries(state.mode).find(item => key(item) === state.id);
  const itemDate = item => item.date || item.start;
  const isoWeek = date => {
    const value = new Date(`${date}T00:00:00Z`);
    const day = value.getUTCDay() || 7;
    value.setUTCDate(value.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
    return Math.ceil((((value - yearStart) / 86400000) + 1) / 7);
  };
  const periodText = (mode, item) => mode === 'weekly'
    ? `第 ${isoWeek(item.start)} 周`
    : mode === 'rank' && item.id === 'week'
      ? `第 ${isoWeek(item.date)} 周`
      : dateText(itemDate(item));
  const periodRange = (mode, item) => mode === 'weekly'
    ? `${dateText(item.start)}–${dateText(item.end).slice(5)}`
    : periodText(mode, item);
  const title = (mode, item) => mode === 'rank' ? `社区活跃榜 · ${item.label}` : item.label;
  const badge = mode => ({ digest: '社区日报', weekly: '社区周报', rank: '社区活跃榜' }[mode]);
  // A readable page anywhere in the issue keeps its date reachable.
  const published = (mode = state.mode) => entries(mode).filter(item =>
    mode !== 'digest' || item.pages.some(window.digestPageHasContent));
  const selectPage = (item, pageId) => pageId === 'overview' && item.pages?.some(window.digestPageHasContent)
    ? { id: 'overview', label: '总览' }
    : item.pages?.find(page => page.id === pageId && window.digestPageHasContent(page)) ||
      item.pages?.find(window.digestPageHasContent) ||
      item.pages?.find(page => page.id === pageId) || item.pages?.[0];
  const pageAvailability = item => {
    if (state.page === 'overview') {
      const active = item.pages.filter(window.digestPageHasContent).map(page => page.label);
      return active.length ? `${active.join('、')}有稿` : '本期暂无稿件';
    }
    const page = item.pages.find(page => page.id === state.page);
    if (window.digestPageHasContent(page)) return `${page.label}有稿`;
    const others = item.pages.filter(window.digestPageHasContent).map(page => page.label);
    const label = page?.label || current().pages.find(page => page.id === state.page)?.label || '本版';
    return `${label}暂无稿件${others.length ? `；${others.join('、')}有稿` : '；本期暂无稿件'}`;
  };
  const neighbor = delta => {
    const list = published(), date = current().date;
    if (state.mode !== 'digest') return list[list.indexOf(current()) + delta];
    return delta < 0 ? list.findLast(item => item.date < date) : list.find(item => item.date > date);
  };
  // data.js carries only the issue index; each issue's articles arrive as issues/<date>.js.
  const issues = window.AGENT_HUB_ISSUES || (window.AGENT_HUB_ISSUES = {});
  const loading = new Map();
  function hydrate(item) {
    if (!item.version || item.loaded) return true;
    if (!issues[item.date]) return false;
    item.pages = issues[item.date].pages;
    item.loaded = true;
    return true;
  }
  function loadIssue(item) {
    if (!loading.has(item.date)) loading.set(item.date, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = routes.asset(`issues/${item.date}.js?v=${item.version}`);
      script.onload = () => issues[item.date] ? resolve() : reject(new Error('Issue script was empty'));
      script.onerror = () => { loading.delete(item.date); script.remove(); reject(new Error('Issue unavailable')); };
      document.head.append(script);
    }));
    return loading.get(item.date);
  }
  function showLoading(item) {
    $('#reading').innerHTML = `<div class="issue-status" role="status">正在加载 ${esc(dateText(item.date))} 的日报…</div>`;
    loadIssue(item).then(() => { if (current() === item) render(); }, () => {
      if (current() !== item) return;
      $('#reading').innerHTML = `<div class="issue-status" role="alert">${esc(dateText(item.date))} 的日报没有加载成功。<button type="button" class="text-action issue-retry">重新加载</button></div>`;
      $('.issue-retry').onclick = () => render();
    });
  }
  let archiveOpener;
  function navigate(mode, id, scroll = true, pageId) {
    // The library and the agent page are static pages, like a weekly edition.
    if (mode === 'library' || mode === 'agents') {
      location.assign(routes.asset(location.protocol === 'file:' ? `${mode}/index.html` : `${mode}/`));
      return;
    }
    const list = entries(mode);
    if (!list?.length) return;
    const selected = list.find(item => key(item) === id) || (mode === 'rank' ? list[0] : published(mode).at(-1) || list.at(-1));
    if (mode === 'weekly') {
      location.assign(routes.href(mode, key(selected), selectPage(selected, pageId)?.id) + location.search);
      return;
    }
    routes.write(mode, key(selected), mode === 'rank' ? rankGroup(pageId) : selectPage(selected, pageId)?.id);
    restore();
    if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function restore() {
    const { mode, id, page: pageId, anchor, legacy } = routes.read();
    const modes = ['digest', 'weekly', 'rank'];
    const chosen = modes.includes(mode) && entries(mode).length ? mode : 'digest';
    const selected = entries(chosen).find(item => key(item) === id) || (chosen === 'rank' ? ranks[0] : published(chosen).at(-1) || entries(chosen).at(-1));
    state = { mode: chosen, id: key(selected), page: chosen === 'rank' ? rankGroup(pageId) : selectPage(selected, pageId)?.id };
    if (chosen === 'weekly') {
      location.replace(routes.href(chosen, state.id, state.page) + location.search + anchor);
      return;
    }
    routes.write(chosen, state.id, state.page, { replace: true, anchor });
    render();
    if (anchor && !legacy) {
      document.getElementById(anchor.slice(1))?.scrollIntoView();
    }
  }
  function jumpButton(mode, item, small = false) {
    const label = mode === 'weekly' ? '周报' : mode === 'digest' ? pageAvailability(item) : title(mode, item);
    return `<button class="issue-link ${small ? 'small' : ''}" data-jump="${mode}" data-id="${esc(key(item))}"><span>${esc(periodRange(mode, item))}</span><strong>${esc(label)}</strong><i data-lucide="arrow-up-right"></i></button>`;
  }
  // Daily archive rows name each issue by the heading of the reader's current section and list
  // which sections have articles; month labels break the run of dates.
  function archiveRows(list) {
    let month = '';
    return list.slice().reverse().map(item => {
      const pages = item.pages.filter(window.digestPageHasContent);
      const isOverview = state.page === 'overview';
      const own = isOverview ? pages[0] : pages.find(page => page.id === state.page);
      const shown = own || pages[0];
      // Older issues may lack the reader's section (三群-only days before 四群 existed); name it from the current issue.
      const ownLabel = item.pages.find(page => page.id === state.page)?.label || current().pages.find(page => page.id === state.page)?.label || '本版';
      const [year, mm, dd] = item.date.split('-');
      const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${item.date}T00:00:00Z`));
      const heading = shown?.heading || `${shown?.label || ''}有稿`;
      const label = `${Number(mm)} 月 ${Number(dd)} 日${weekday}，${own ? '' : `${ownLabel}无稿，`}${shown?.label || ''}：${heading}`;
      const monthLabel = `${year}-${mm}` === month ? '' : `<p class="issue-month">${Number(year)} 年 ${Number(mm)} 月</p>`;
      month = `${year}-${mm}`;
      return `${monthLabel}<button class="issue-row" data-jump="digest" data-id="${esc(key(item))}" aria-label="${esc(label)}">
        <span class="issue-row-date"><b>${mm}.${dd}</b><small>${esc(weekday)}</small></span>
        <span class="issue-row-main"><strong>${own ? '' : `<em>${esc(shown?.label || '')}</em>`}${esc(heading)}</strong>
          <span class="issue-row-groups">${own ? '' : `<span class="issue-row-note">${esc(ownLabel)}无稿</span>`}${pages.map(page =>
            `<span${page.id === state.page ? ' class="is-current"' : ''}>${esc(page.label)}</span>`).join('')}</span></span>
      </button>`;
    }).join('');
  }
  function render() {
    const item = current(), list = entries(state.mode), index = list.indexOf(item);
    // Weekly editions use the daily reading surface; the route mode stays separate for navigation.
    document.body.dataset.view = state.mode === 'weekly' ? 'digest' : state.mode;
    $('#edition-sections').replaceChildren();
    $('#reading').ontouchstart = $('#reading').ontouchend = null;
    document.title = `${title(state.mode, item)} · AgentHub`;
    const section = { rank: '活跃榜', weekly: '周报' }[state.mode] || '日报';
    $('.wordmark span').textContent = section;
    $('#footer-label').textContent = `AGENT HUB / ${section}`;
    if (state.mode === 'rank') {
      $('#rank-period').textContent = item.label;
      $('#rank-through').textContent = `统计截至 ${dateText(item.date)}`;
    }
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
    const routeName = state.mode === 'rank' ? 'rank' : state.mode === 'weekly' ? 'weekly' : 'daily';
    // The public address from site.mjs; test/site.test.mjs keeps the two equal.
    canonical.href = new URL(`${routeName}/${encodeURIComponent(state.id)}/${state.page ? `${state.page}/` : ''}`, 'https://agent-hub-community.github.io/newspaper/').href;
    // Keep the Markdown alternate on the issue being read; issues without readable pages have none.
    const markdown = document.querySelector('link[rel="alternate"][type="text/markdown"]');
    if (markdown && state.mode === 'digest' && item.pages.some(window.digestPageHasContent)) markdown.href = routes.asset(`daily/${item.date}/index.md`);
    $('.wordmark').href = routes.root;
    // Site-wide links (search) resolve from the site root; a relative href would follow the daily path the app pushes.
    for (const link of document.querySelectorAll('a[data-root-href]')) link.href = routes.asset(link.dataset.rootHref);
    for (const tab of document.querySelectorAll('[data-mode]')) {
      tab.classList.toggle('active', tab.dataset.mode === state.mode);
      tab.setAttribute('aria-pressed', String(tab.dataset.mode === state.mode));
    }
    $('#edition-kind').textContent = badge(state.mode);
    $('#edition-label').textContent = state.mode === 'digest' ? '' : `${index + 1} / ${list.length}`;
    $('#date-label').textContent = periodText(state.mode, item);
    $('#date-label').dateTime = itemDate(item);
    $('#date-weekday').textContent = state.mode === 'digest'
      ? new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${item.date}T00:00:00Z`))
      : state.mode === 'weekly' ? periodRange(state.mode, item) : '';
    $('#date-picker').setAttribute('aria-label', `${badge(state.mode)} ${$('#date-label').textContent} ${$('#date-weekday').textContent}，打开往期目录`);
    if (state.mode === 'digest' && !hydrate(item)) showLoading(item);
    else if (state.mode === 'digest' || state.mode === 'weekly') window.renderDigest(item, navigate, data, state.page, state.mode);
    else window.renderRanking(item, navigate, data, state.page);
    bindJumps();
    if ($('#archive-dialog').open) $('#archive-dialog').close();
    window.AgentHubAppearance?.update();
    icons();
    document.body.dataset.edition = `${state.mode}/${state.id}`;
  }
  function bindJumps() {
    for (const button of document.querySelectorAll('[data-jump]')) button.onclick = () => {
      if (button.dataset.jump === 'digest' && !published('digest').some(item => key(item) === button.dataset.id)) return;
      $('#archive-dialog').close();
      navigate(button.dataset.jump, button.dataset.id, true,
        ['digest', 'weekly'].includes(button.dataset.jump) ? state.page : undefined);
    };
  }
  function openArchive(event) {
    const list = published();
    archiveOpener = event.currentTarget;
    $('#archive-heading').textContent = state.mode === 'weekly' ? '选择周报'
      : state.mode === 'rank' ? '选择榜单' : '往期目录';
    $('#archive-list').innerHTML = (state.mode === 'digest' ? archiveRows(list) : list.slice().reverse().map(item => jumpButton(state.mode, item)).join('')) || '<p>暂无可选日期。</p>';
    const previous = neighbor(-1), next = neighbor(1);
    $('#archive-pagination').innerHTML = list.length > 1 ? `
      <button class="text-action" ${previous ? `data-jump="${state.mode}" data-id="${esc(key(previous))}"` : 'disabled'}><i data-lucide="chevron-left"></i>上一期</button>
      <span>${list.length} 期</span>
      <button class="text-action" ${next ? `data-jump="${state.mode}" data-id="${esc(key(next))}"` : 'disabled'}>下一期<i data-lucide="chevron-right"></i></button>` : '';
    for (const button of $('#archive-list').querySelectorAll('[data-id]')) {
      if (button.dataset.id === state.id) button.setAttribute('aria-current', 'page');
    }
    archiveOpener.setAttribute('aria-expanded', 'true');
    bindJumps(); icons(); $('#archive-dialog').showModal();
  }
  function flip(delta) {
    const item = neighbor(delta);
    if (item) navigate(state.mode, key(item), true, state.page);
  }
  for (const tab of document.querySelectorAll('[data-mode]')) {
    tab.onclick = () => navigate(tab.dataset.mode, undefined, true, state.page);
  }
  for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => document.getElementById(button.dataset.close).close();
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', e => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  });
  $('#archive-toggle').onclick = openArchive;
  $('#date-picker').onclick = openArchive;
  $('#archive-dialog').addEventListener('close', () => {
    for (const id of ['date-picker', 'archive-toggle']) $('#' + id).setAttribute('aria-expanded', 'false');
    if (archiveOpener?.getClientRects().length) archiveOpener.focus({ preventScroll: true });
  });
  $('#back-top').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  window.addEventListener('hashchange', () => {
    if (routes.legacy(location.hash)) restore();
  });
  window.addEventListener('popstate', restore);
  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]') || /INPUT|SELECT|TEXTAREA|BUTTON|A/.test(e.target.tagName) || e.altKey || e.ctrlKey || e.metaKey) return;
    const turn = state.mode === 'digest' ? window.flipDigestPage : flip;
    if (e.key === 'ArrowLeft') { e.preventDefault(); turn(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); turn(1); }
  });
  restore();
})();
