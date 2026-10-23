(() => {
  'use strict';
  const root = new URL(document.querySelector('meta[name="agenthub-root"]')?.content || './', location.href);
  // History navigation changes document.baseURI; pin loaded asset references first.
  for (const element of document.querySelectorAll('script[src], link[rel="stylesheet"]')) {
    const attribute = element.tagName === 'SCRIPT' ? 'src' : 'href';
    element.setAttribute(attribute, new URL(element.getAttribute(attribute), location.href).href);
  }
  const localFile = location.protocol === 'file:';
  const decode = value => { try { return decodeURIComponent(value || ''); } catch { return ''; } };
  const legacy = hash => /^#\/?(digest|weekly|rank)(?:\/|$)/.test(hash);
  function read() {
    if (legacy(location.hash)) {
      const [mode, id, page] = location.hash.replace(/^#\/?/, '').split('/');
      return { mode, id: decode(id), page, legacy: true, anchor: '' };
    }
    const relative = location.pathname.startsWith(root.pathname) ? location.pathname.slice(root.pathname.length) : '';
    const parts = relative.replace(/index\.html$/, '').split('/');
    const [section, id, page] = parts;
    if (section === 'weekly' && /^\d{4}-\d{2}-\d{2}$/.test(id) && /^\d{4}-\d{2}-\d{2}$/.test(page)) {
      return { mode: 'weekly', id: `${id}_${page}`, page: parts[3], legacy: false, anchor: location.hash };
    }
    return { mode: section === 'daily' ? 'digest' : section, id: decode(id), page, legacy: false, anchor: location.hash };
  }
  function href(mode, id, page) {
    const route = mode === 'weekly'
      ? `weekly/${encodeURIComponent(id.split('_')[0])}/${encodeURIComponent(id.split('_')[1])}/${encodeURIComponent(page || 'group-3')}/`
      : mode === 'rank'
      ? `rank/${encodeURIComponent(id)}/${page ? `${encodeURIComponent(page)}/` : ''}`
      : `${mode === 'weekly' ? 'weekly' : 'daily'}/${encodeURIComponent(id)}/${encodeURIComponent(page)}/`;
    return new URL(route, root).href;
  }
  function write(mode, id, page, { replace = false, anchor = '' } = {}) {
    // file:// cannot pushState across files. Keep its offline preview usable.
    const url = localFile
      ? `${location.pathname}${location.search}#${mode}/${encodeURIComponent(id)}${page ? `/${page}` : ''}`
      : `${href(mode, id, page)}${location.search}${anchor}`;
    if (new URL(url, location.href).href !== location.href) history[replace ? 'replaceState' : 'pushState'](null, '', url);
  }
  window.AgentHubRoutes = { root: root.href, read, write, href, asset: file => new URL(file, root).href, legacy };
})();
