(() => {
  'use strict';
  const endpoint = document.querySelector('meta[name="agenthub-search-endpoint"]')?.content;
  // Only the public site reports searches; test/site.test.mjs keeps the address equal to site.mjs.
  if (!endpoint || location.protocol !== 'https:' || location.hostname !== 'agent-hub-community.github.io'
    || !location.pathname.startsWith('/newspaper/')) return;
  const test = new URLSearchParams(location.search).get('analytics_test') === '1';
  let current, timer;
  const clean = value => {
    const q = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    // Same pattern as SENSITIVE in feedback/search-events.mjs; test/search-events.test.mjs keeps them equal.
    return /@|https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|cn|net|org|io|ai|dev|app|me|co)\/\S|(?<![\d-])(?!(?:19|20)\d\d-\d\d-\d\d(?![\d-]))(?:\d[\s-]?){7,}|\b(?:sk-|sk_|pk_|rk_|ghp_|gho_|ghs_|github_pat_|glpat-|xox[abpr]-|AKIA[0-9A-Z]{8}|AIza|hf_|Bearer\s|wxid_)|\beyJ[\w-]{8,}\.|\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}/i.test(q) ? '[已隐藏敏感内容]' : q.slice(0, 120);
  };
  function send(search, click) {
    // keepalive permits delivery during navigation; reporting must never delay a result click.
    return fetch(new URL('/search-events', endpoint).href, {
      method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ search, ...(click ? { click } : {}), test }),
    }).then(response => response.ok).catch(() => false);
  }
  function flush() {
    clearTimeout(timer);
    if (!current || current.sent || current.pending || document.visibilityState === 'hidden') return;
    const record = current;
    record.pending = true;
    send(record.search).then(ok => { record.sent = ok; record.pending = false; });
  }
  window.AgentHubSearchTracking = {
    cancel() { clearTimeout(timer); },
    update(state, results) {
      clearTimeout(timer);
      if (!state.q.trim()) { current = null; return; }
      const key = JSON.stringify([state.q, state.kind, state.group, state.time, state.sort]);
      if (current?.key !== key) current = { key, search: {
        id: crypto.randomUUID(), query: clean(state.q), results,
        kind: state.kind, group: state.group, time: state.time, sort: state.sort,
      } };
      // Rendering uses 150 ms; recording waits for a settled search instead of every keystroke.
      timer = setTimeout(flush, 1200);
    },
    flush,
    click(target, rank) {
      clearTimeout(timer);
      if (!current) return;
      // Sending the search together with the click avoids a race between two requests.
      send(current.search, { id: crypto.randomUUID(), target, rank });
    },
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush();
  });
})();
