(() => {
  'use strict';
  // The public build adds this script with the feedback Worker origin when FEEDBACK_API_URL is set.
  const endpoint = document.currentScript?.dataset.endpoint;
  // Only the public site reports; test/site.test.mjs keeps the address equal to site.mjs.
  if (!endpoint || location.origin !== 'https://agent-hub-community.github.io' || !location.pathname.startsWith('/newspaper/')) return;
  // Reuse the anonymous browser ID of the vote buttons (feedback.js, library.js) instead of adding another one.
  // Without storage the ID would change on every page, so the report then counts the view only.
  let visitor = null;
  try {
    const key = 'agenthub:feedback:v1:voter';
    visitor = localStorage.getItem(key);
    if (!/^[a-f0-9-]{36}$/.test(visitor || '')) {
      visitor = crypto.randomUUID();
      localStorage.setItem(key, visitor);
    }
  } catch {
    visitor = null;
  }
  let last = '';
  function report() {
    const path = location.pathname;
    // Hash and query changes (discussion reader, filters) and repeated history entries are not new views.
    if (path === last) return;
    last = path;
    // fetch in CORS mode keeps the real Origin header: WebKit sends `Origin: null` for sendBeacon on a
    // no-referrer page. A text/plain body needs no preflight, and keepalive survives a following navigation.
    fetch(new URL('/views', endpoint).href, {
      method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(visitor ? { path, visitor } : { path }),
    }).catch(() => {});
  }
  // In-page navigation (app.js date and section changes) pushes history entries; back and forward fire popstate.
  // replaceState only rewrites the current entry, such as app.js resolving the home address, so it is not a view.
  const pushState = history.pushState;
  history.pushState = function (...args) {
    const result = pushState.apply(this, args);
    report();
    return result;
  };
  addEventListener('popstate', report);
  report();
})();
