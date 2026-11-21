/* global AGENT_HUB_DATA, AGENT_HUB_THEMES */
(() => {
  function detectPageKind(doc) {
    if (!doc?.body) return null;
    const view = doc.body.dataset?.view;
    if (view === 'rank') return 'rank';
    if (view === 'digest') return 'daily';
    const page = doc.body.dataset?.page;
    if (!page) return 'daily';
    if (['library', 'glossary', 'search', 'agents'].includes(page)) return page;
    return 'weekly';
  }

  function supportsTarget(plugin, pageKind) {
    if (!plugin || !pageKind || !Array.isArray(plugin.targets) || !plugin.targets.length) return true;
    return plugin.targets.includes(pageKind);
  }

  function selectSkin({ plugins = [], campaigns = [], editions = {} }, preview, now = Date.now(), context = {}) {
    if (preview === 'default') return null;
    const pageKind = context?.pageKind || null;
    const explicit = plugins.find(plugin => plugin.id === preview);
    if (explicit) return explicit;
    const active = campaigns.find(campaign => Date.parse(campaign.startsAt) <= now && now < Date.parse(campaign.endsAt));
    if (active) {
      const matched = plugins.find(plugin => plugin.id === active.skin);
      if (matched && supportsTarget(matched, pageKind)) return matched;
    }
    const editionDate = context?.editionDate;
    if (editionDate && editions && editions[editionDate]) {
      const bound = plugins.find(plugin => plugin.id === editions[editionDate]);
      if (bound && supportsTarget(bound, pageKind)) return bound;
    }
    return null;
  }

  const rootMeta = () => document.querySelector?.('meta[name="agenthub-root"]')?.getAttribute('content') || './';
  const resolveAsset = file => {
    if (!file) return '';
    if (window.AgentHubRoutes?.asset) return window.AgentHubRoutes.asset(file);
    if (/^(?:https?:|\/|#)/i.test(file)) return file;
    return `${rootMeta()}${file.replace(/^(?:\.\/)+/, '')}`;
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  window.AgentHubSkins = { selectSkin };

  const config = window.AGENT_HUB_DATA?.skins || window.AGENT_HUB_THEMES;
  const masthead = document.querySelector('.masthead');
  if (!config || !masthead) return;

  const params = new URLSearchParams(location.search);
  const preview = params.get('theme') ?? params.get('skin');

  // Ensure masthead slots exist on both the daily SPA and static pages (weekly, library, glossary, search, agents).
  let brand = masthead.querySelector('.masthead-brand');
  if (!brand) {
    brand = document.createElement('div');
    brand.className = 'masthead-brand';
    while (masthead.firstChild) brand.append(masthead.firstChild);
    masthead.append(brand);
  }
  let top = brand.querySelector('.masthead-top');
  if (!top) {
    top = document.createElement('div');
    top.className = 'masthead-top';
    top.append(document.createElement('span'));
    brand.prepend(top);
  }
  let eyebrow = top.querySelector('span');
  if (!eyebrow) {
    eyebrow = document.createElement('span');
    top.append(eyebrow);
  }
  const originalEyebrow = eyebrow.textContent;

  const ensureSlot = (selector, tag, className, attrs = {}) => {
    let el = brand.querySelector(selector);
    if (!el) {
      el = document.createElement(tag);
      el.className = className;
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      el.hidden = true;
      brand.append(el);
    }
    return el;
  };
  const art = ensureSlot('.skin-art', 'img', 'skin-art', { alt: '' });
  const flora = ensureSlot('.skin-flora', 'img', 'skin-flora', { alt: '' });
  const note = ensureSlot('.skin-note', 'div', 'skin-note');
  if (!note.querySelector('.skin-label')) {
    const labelEl = document.createElement('span');
    labelEl.className = 'skin-label';
    const messageEl = document.createElement('span');
    messageEl.className = 'skin-message';
    note.append(labelEl, messageEl);
  }

  let sealEl = note.querySelector('.skin-seal');
  if (!sealEl) {
    sealEl = document.createElement('span');
    sealEl.className = 'skin-seal';
    sealEl.hidden = true;
    note.append(sealEl);
  }
  let storyBtn = note.querySelector('.skin-story-trigger');
  if (!storyBtn) {
    storyBtn = document.createElement('button');
    storyBtn.type = 'button';
    storyBtn.className = 'skin-story-trigger';
    storyBtn.hidden = true;
    storyBtn.textContent = '事件速览 ↗';
    note.append(storyBtn);
  }

  let activeSkin = null;
  let currentContext = {
    pageKind: detectPageKind(document),
    editionDate: null,
    pageId: document.body?.dataset?.page || document.querySelector?.('#reading')?.dataset?.page || null,
  };
  let timer;

  function isOverviewContext(ctx) {
    const pageId = ctx?.pageId || document.body?.dataset?.page || document.querySelector?.('#reading')?.dataset?.page || null;
    if (pageId) return pageId === 'overview';
    // Before app.js hydrates on SPA root /daily/<date>/overview/, fall back to pathname.
    return /\/overview\/?$/.test(location.pathname || '');
  }

  function dismissKey(id) { return `agenthub-theme-banner-dismissed:${id}`; }
  function isBannerDismissed(id) {
    try { return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(dismissKey(id)) === '1'; }
    catch { return false; }
  }
  function setBannerDismissed(id) {
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(dismissKey(id), '1'); }
    catch {}
  }

  function resetPreviewHref() {
    try {
      const next = new URLSearchParams(location.search);
      next.delete('skin');
      next.set('theme', 'default');
      return `${location.pathname || ''}?${next.toString()}${location.hash || ''}`;
    } catch {
      return '?theme=default';
    }
  }

  const formatShortDate = date => String(date || '').slice(5).replace('-', '.');
  const resolveThemeHref = href => {
    const resolved = resolveAsset(href);
    if (!preview || /^(?:https?:|#)/i.test(href)) return resolved;
    const [base, hash = ''] = resolved.split('#');
    const sep = base.includes('?') ? '&' : '?';
    const key = params.has('theme') ? 'theme' : 'skin';
    return `${base}${sep}${key}=${encodeURIComponent(preview)}${hash ? `#${hash}` : ''}`;
  };

  function openStoryDialog(skin) {
    if (!skin?.story || !document.body) return;
    let dialog = document.getElementById('theme-story-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'theme-story-dialog';
      dialog.setAttribute('aria-labelledby', 'theme-story-title');
      dialog.addEventListener('click', event => {
        if (event.target !== dialog || !dialog.getBoundingClientRect) return;
        const r = dialog.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) {
          dialog.close();
        }
      });
      document.body.append(dialog);
    }
    const { story } = skin;
    const factsHtml = story.facts?.length
      ? `<dl class="theme-story-facts">${story.facts.map(f => `<div class="theme-story-fact"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('')}</dl>`
      : '';
    const relatedItems = skin.knowledge?.relatedItems || [];
    const hasCurrentRelated = relatedItems.some(item => item.current);
    const relatedHeading = hasCurrentRelated
      ? '各群相关讨论'
      : (skin.knowledge?.related?.heading || '各群相关讨论');
    const relatedHtml = relatedItems.length
      ? `<section class="theme-story-related" aria-label="${esc(relatedHeading)}">` +
        `<h3>${esc(relatedHeading)}</h3>` +
        `<ul>${relatedItems.map(item => `<li><a href="${esc(resolveThemeHref(item.href))}"><span class="theme-related-meta">${item.current ? '<em class="theme-related-live">当期</em>' : ''}${esc(item.groupLabel)} · ${esc(formatShortDate(item.date))}</span><span class="theme-related-title">${esc(item.title)}</span><span class="theme-related-arrow" aria-hidden="true">→</span></a></li>`).join('')}</ul>` +
        `</section>`
      : '';
    const linksHtml = story.links?.length
      ? `<div class="theme-story-links">${story.links.map(l => {
        const href = resolveThemeHref(l.href);
        const external = /^https?:\/\//i.test(l.href);
        return `<a href="${esc(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(l.label)} <span aria-hidden="true">→</span></a>`;
      }).join('')}</div>`
      : '';
    const artHtml = skin.image
      ? `<img class="theme-story-art" src="${esc(resolveAsset(skin.image))}" alt="${esc(skin.artAlt || '')}">`
      : '';
    const sealHtml = skin.seal
      ? `<span class="theme-story-seal">${esc(skin.seal.text)}${skin.seal.caption ? ` · ${esc(skin.seal.caption)}` : ''}</span>`
      : '';
    const ambientAttr = skin.ambient?.preset ? ` data-ambient="${esc(skin.ambient.preset)}"` : '';
    dialog.innerHTML =
      `<div class="theme-story-head"${ambientAttr}><div class="theme-story-head-main"><div class="theme-story-head-meta"><span class="theme-story-kicker">${esc(story.kicker)}</span>${sealHtml}</div><h2 id="theme-story-title">${esc(story.title)}</h2></div>` +
      `${artHtml}<button type="button" class="theme-story-close" aria-label="关闭说明" title="关闭">×</button></div>` +
      `<div class="theme-story-body"><div class="theme-story-spread${relatedItems.length ? '' : ' is-single'}">` +
      `<div class="theme-story-copy">${story.body.map(p => `<p>${esc(p)}</p>`).join('')}${factsHtml}${linksHtml}</div>` +
      `${relatedHtml}</div>` +
      `<div class="theme-story-foot"><span>Agent Hub 特别主题 · ${esc(skin.name)}</span><a href="${esc(resetPreviewHref())}">切回常规样式</a></div></div>`;
    dialog.querySelector('.theme-story-close')?.addEventListener('click', () => dialog.close());
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  storyBtn.addEventListener('click', () => openStoryDialog(activeSkin));
  art.addEventListener('click', () => { if (activeSkin?.story) openStoryDialog(activeSkin); });

  function syncKnowledgeBanner(skin) {
    let banner = document.getElementById('theme-knowledge-banner');
    const spec = skin?.knowledge?.banner;
    const allowedHere = spec && (spec.placement === 'all' || isOverviewContext(currentContext));
    if (!allowedHere || (spec.dismissible && isBannerDismissed(skin.id))) {
      if (banner) banner.hidden = true;
      return;
    }
    if (!banner) {
      banner = document.createElement('aside');
      banner.id = 'theme-knowledge-banner';
      banner.className = 'theme-knowledge-banner';
      banner.setAttribute('aria-label', '专题导读');
      const anchor = masthead.nextElementSibling?.classList?.contains('edition-nav')
        ? masthead.nextElementSibling
        : masthead;
      anchor.after(banner);
    }
    const actionsHtml = (spec.links || []).map((link, index) => link.action === 'open-story'
      ? `<button type="button" class="theme-banner-link" data-theme-action="open-story">${esc(link.label)}</button>`
      : `<a class="theme-banner-link" href="${esc(resolveThemeHref(link.href))}"${/^https?:\/\//i.test(link.href) ? ' target="_blank" rel="noopener noreferrer"' : ''} data-banner-idx="${index}">${esc(link.label)} ↗</a>`
    ).join('');
    const relatedItems = (skin.knowledge?.relatedItems || []).slice(0, 4);
    const bannerRelatedHeading = relatedItems.some(item => item.current)
      ? '各群相关讨论'
      : (skin.knowledge?.related?.heading || '各群相关讨论');
    const relatedStrip = relatedItems.length
      ? `<div class="theme-banner-related" aria-label="${esc(bannerRelatedHeading)}">` +
        `<span class="theme-banner-related-label">${esc(bannerRelatedHeading)}</span>` +
        `<div class="theme-banner-related-list">${relatedItems.map(item =>
          `<a class="theme-related-chip" href="${esc(resolveThemeHref(item.href))}" title="${esc(item.title)}"><span class="theme-related-chip-group">${item.current ? '<em class="theme-related-live">当期</em>' : ''}${esc(item.groupLabel)} · ${esc(formatShortDate(item.date))}</span><span class="theme-related-chip-title">${esc(item.title)}</span></a>`
        ).join('')}</div></div>`
      : '';
    banner.innerHTML =
      `<div class="theme-banner-top"><div class="theme-banner-main"><span class="theme-banner-kicker">${esc(spec.kicker)}</span><span class="theme-banner-text">${esc(spec.text)}</span></div>` +
      `<div class="theme-banner-actions">${actionsHtml}${spec.dismissible ? '<button type="button" class="theme-banner-close" aria-label="收起专题导读" title="收起">×</button>' : ''}</div></div>` +
      relatedStrip;
    banner.hidden = false;
    banner.querySelector('[data-theme-action="open-story"]')?.addEventListener('click', () => openStoryDialog(skin));
    banner.querySelector('.theme-banner-close')?.addEventListener('click', () => {
      setBannerDismissed(skin.id);
      banner.hidden = true;
    });
  }

  function syncStoryHighlights(skin) {
    for (const existing of document.querySelectorAll('.theme-story-badge')) existing.remove();
    const highlight = skin?.knowledge?.highlight;
    if (!highlight?.keywords?.length || !highlight.badge) return;
    const needles = highlight.keywords.map(k => k.toLowerCase());
    const cards = document.querySelectorAll('article.brief, article.story, li.entry');
    for (const card of cards) {
      const text = (card.textContent || '').toLowerCase();
      if (!needles.some(needle => text.includes(needle))) continue;
      const target = card.querySelector('.brief-category, .story-number, .entry-meta');
      if (!target) continue;
      const badge = document.createElement('span');
      badge.className = 'theme-story-badge';
      badge.textContent = highlight.badge;
      target.append(badge);
    }
  }

  const footerNoteEl = document.querySelector('#footer-note, .footer > span:last-child');
  const originalFooterNote = footerNoteEl?.textContent || '';
  const searchInputEl = document.querySelector('#site-search');
  const originalSearchPlaceholder = searchInputEl?.getAttribute('placeholder') || '';

  function syncChromeTouchpoints(skin) {
    if (footerNoteEl) {
      footerNoteEl.textContent = skin?.footerNote || originalFooterNote;
    }
    if (searchInputEl) {
      const examples = skin?.knowledge?.searchExamples;
      searchInputEl.setAttribute('placeholder', examples?.length
        ? `搜话题、模型或资料，比如 ${examples.join('、')}`
        : originalSearchPlaceholder);
    }
    // Tag special-edition dates inside the archive dialog when editions bindings exist.
    const editions = config.editions || {};
    for (const row of document.querySelectorAll('#archive-list .issue-row[data-id]')) {
      const date = row.dataset.id;
      const boundId = editions[date];
      if (!boundId || row.querySelector('.archive-theme-badge')) continue;
      const boundPlugin = (config.plugins || []).find(p => p.id === boundId);
      const target = row.querySelector('.issue-row-groups');
      if (boundPlugin && target) {
        const badge = document.createElement('span');
        badge.className = 'archive-theme-badge';
        badge.textContent = boundPlugin.label;
        target.append(badge);
      }
    }
  }

  function applySkin(skin) {
    activeSkin = skin;
    const id = skin?.id || 'default';
    const changed = masthead.dataset.skin !== id;
    if (changed) {
      masthead.dataset.skin = id;
      document.body.dataset.skin = id;
      if (skin?.version === 2) masthead.dataset.themeVersion = '2';
      else delete masthead.dataset.themeVersion;

      if (skin?.ambient?.preset) brand.dataset.ambient = skin.ambient.preset;
      else delete brand.dataset.ambient;

      eyebrow.textContent = skin?.eyebrow || originalEyebrow;
      note.hidden = !skin;
      art.hidden = !skin?.image;
      flora.hidden = !skin?.ornament;

      if (skin?.ornament) flora.src = resolveAsset(skin.ornament);
      else flora.removeAttribute('src');

      if (skin) {
        note.querySelector('.skin-label').textContent = skin.label;
        note.querySelector('.skin-message').textContent = skin.message;
        if (skin.image) {
          art.src = resolveAsset(skin.image);
          art.alt = skin.artAlt || '';
          if (skin.artStyle) art.dataset.artStyle = skin.artStyle;
          else delete art.dataset.artStyle;
          if (skin.story) {
            art.dataset.interactive = 'true';
            art.title = `${skin.label} · 点击查看事件速览`;
          } else {
            delete art.dataset.interactive;
            art.removeAttribute('title');
          }
        } else {
          art.removeAttribute('src');
          delete art.dataset.artStyle;
          delete art.dataset.interactive;
        }
        if (skin.seal) {
          sealEl.innerHTML = `${esc(skin.seal.text)}${skin.seal.caption ? `<small>${esc(skin.seal.caption)}</small>` : ''}`;
          sealEl.hidden = false;
        } else {
          sealEl.textContent = '';
          sealEl.hidden = true;
        }
        storyBtn.hidden = !skin.story;
      } else {
        art.removeAttribute('src');
        delete art.dataset.artStyle;
        delete art.dataset.interactive;
        art.removeAttribute('title');
        sealEl.textContent = '';
        sealEl.hidden = true;
        storyBtn.hidden = true;
      }
    }
    syncKnowledgeBanner(skin);
    syncStoryHighlights(skin);
    syncChromeTouchpoints(skin);
  }

  function update(nextContext) {
    clearTimeout(timer);
    if (nextContext) currentContext = { ...currentContext, ...nextContext };
    else currentContext.pageKind = detectPageKind(document);
    const skin = selectSkin(config, preview, Date.now(), currentContext);
    applySkin(skin);
    const next = (config.campaigns || []).flatMap(c => [Date.parse(c.startsAt), Date.parse(c.endsAt)])
      .filter(time => time > Date.now()).sort((a, b) => a - b)[0];
    if (next) timer = setTimeout(() => update(), Math.min(next - Date.now() + 20, 2147483647));
  }

  window.AgentHubSkins = {
    selectSkin,
    sync(context) { update(context); },
    syncContent() { syncStoryHighlights(activeSkin); syncChromeTouchpoints(activeSkin); },
    openStory() { openStoryDialog(activeSkin); },
  };

  document.addEventListener('visibilitychange', () => update());
  window.addEventListener('pageshow', () => update());
  update();
})();
