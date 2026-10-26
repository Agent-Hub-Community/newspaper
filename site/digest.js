/* global lucide */
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const routes = window.AgentHubRoutes;
  const asset = file => window.AgentHubRoutes?.asset(file) || file;
  function storyResources(story) {
    const icons = { paper: 'file-text', article: 'book-open', code: 'code-xml', demo: 'play', discussion: 'messages-square' };
    const lucideNames = { ...icons, messages: 'messages-square', link: 'link' };
    const seen = new Set();
    const links = (Array.isArray(story.resources) ? story.resources : []).flatMap(resource => {
      try {
        const url = new URL(resource.url);
        const publicDiscussionQuery = url.hostname === 'news.ycombinator.com' &&
          url.pathname === '/item' && /^\?id=\d+$/.test(url.search);
        if (url.protocol !== 'https:' || url.username || url.password ||
            (url.search && !publicDiscussionQuery) ||
            !icons[resource.kind] || typeof resource.label !== 'string' || !resource.label.trim() ||
            seen.has(url.href)) return [];
        seen.add(url.href);
        return [{ ...resource, url: url.href }];
      } catch { return []; }
    });
    if (!links.length) return '';
    return `<ul class="brief-resources" aria-label="相关资料">${links.map(resource =>
      `<li><a href="${esc(resource.url)}" target="_blank" rel="noopener noreferrer">
        <span class="resource-icon"><i data-lucide="${lucideNames[window.AgentHubDiscussion.resourceKind(resource)]}"></i></span><span class="resource-copy"><span class="resource-label">${esc(resource.label)}</span> <span class="resource-address">${esc(new URL(resource.url).hostname.replace(/^www\./, ''))}</span></span>
        <i class="resource-external" data-lucide="arrow-up-right"></i>
      </a></li>`).join('')}</ul>`;
  }
  function briefText(story) {
    const text = String(story.text ?? '');
    const candidates = [...new Set(Array.isArray(story.emphasis) ? story.emphasis : [])]
      .filter(phrase => typeof phrase === 'string' && phrase.length >= 2 && phrase.trim() === phrase &&
        !/\n\s*\n/.test(phrase) && text.indexOf(phrase) === text.lastIndexOf(phrase))
      .map(phrase => ({ start: text.indexOf(phrase), length: phrase.length }))
      .filter(r => r.start >= 0).sort((a, b) => a.start - b.start);
    const ranges = candidates.filter((r, i) => !candidates.slice(0, i).some(previous =>
      previous.start + previous.length > r.start));
    if (ranges.reduce((sum, r) => sum + r.length, 0) * 10 > text.length * 3) return esc(text);
    let end = 0, html = '';
    for (const range of ranges) {
      if (range.start < end) continue;
      html += esc(text.slice(end, range.start));
      end = range.start + range.length;
      html += `<strong class="brief-emphasis">${esc(text.slice(range.start, end))}</strong>`;
    }
    return html + esc(text.slice(end));
  }
  let pageIndex = 0;
  // Index entries carry a precomputed flag until their issue script has loaded (build.mjs).
  const hasContent = page => typeof page?.hasContent === 'boolean' ? page.hasContent
    : [page?.stories, page?.papers, page?.id === 'external' ? page.trends : []]
      .some(items => items?.some(entry => typeof entry.text === 'string' && entry.text.trim()));
  window.digestPageHasContent = hasContent;
  window.renderDigest = (issue, navigate, archive, pageId, mode = 'digest') => {
    const weekly = mode === 'weekly';
    // Groups added later (四群, 五群, …) show as unavailable tabs on older editions, without rewriting them.
    if (!weekly) {
      const known = new Map();
      for (const edition of archive.digests || []) {
        for (const page of edition.pages) if (/^group-\d+$/.test(page.id) && !known.has(page.id)) known.set(page.id, page.label);
      }
      const missing = [...known].filter(([id]) => !issue.pages.some(page => page.id === id));
      if (missing.length) {
        const number = page => Number(page.id.slice(6));
        const groupPages = [...issue.pages.filter(page => page.id.startsWith('group-')),
          ...missing.map(([id, label]) => ({ id, label, stories: [] }))].sort((a, b) => number(a) - number(b));
        issue = { ...issue, pages: [...groupPages, ...issue.pages.filter(page => !page.id.startsWith('group-'))] };
      }
    }
    const availablePages = issue.pages.flatMap((page, index) => hasContent(page) ? [index] : []);
    const isOverview = !weekly && pageId === 'overview' && availablePages.length > 0;
    pageIndex = isOverview ? -1 : Math.max(0, issue.pages.findIndex(page => page.id === pageId));
    const page = isOverview ? { id: 'overview', label: '本日总览', section: '本日全版总览' } : issue.pages[pageIndex];
    const external = page.id === 'external';
    const stories = page.stories?.filter(story => typeof story.text === 'string' && story.text.trim()) || [];
    const papers = page.papers?.filter(paper => typeof paper.text === 'string' && paper.text.trim()) || [];
    const noteParts = String(page.note || '').split(' · ')
      .filter(part => !['当日本地记录', '无本地可读记录'].includes(part.trim()));
    const note = noteParts.some(part => part.trim() && part.trim() !== issue.date) ? noteParts.join(' · ') : '';
    const activity = archive.activity;
    const groupActivity = activity?.groups.find(g => g.id === page.id);
    const daily = groupActivity?.daily[issue.date];
    const avatar = member => activity?.avatars?.[member.key]
      ? `<img src="${esc(asset(activity.avatars[member.key]))}${archive.avatarVersion ? `?v=${esc(archive.avatarVersion)}` : ''}" alt="第 ${esc(member.rank)} 名成员头像" width="28" height="28">`
      : '<span class="avatar-missing" aria-label="头像未获取"><i data-lucide="user-round"></i></span>';
    const main = document.querySelector('#reading');
    const rankingHref = routes?.href
      ? routes.href('rank', 'week', external || isOverview ? undefined : page.id)
      : `#/rank/week/${external || isOverview ? '' : `${encodeURIComponent(page.id)}/`}`;
    const loc = typeof location !== 'undefined' ? location : window.location || { protocol: 'http:', pathname: '', search: '' };
    const pageHref = (targetPage, anchor = '') => routes?.href && loc.protocol !== 'file:'
      ? `${routes.href(mode, issue.id, targetPage)}${loc.search || ''}${anchor}`
      : `${loc.pathname || ''}${loc.search || ''}#${mode}/${encodeURIComponent(issue.id)}/${encodeURIComponent(targetPage)}${anchor}`;

    let overviewBody = '';
    let overviewDeck = '';
    if (isOverview) {
      const groupPages = issue.pages.filter(p => p.id.startsWith('group-'));
      const activeGroupPages = groupPages.filter(hasContent);
      const quietGroupPages = groupPages.filter(p => !hasContent(p));
      const externalPage = issue.pages.find(p => p.id === 'external' && hasContent(p));
      const totalGroupTopics = activeGroupPages.reduce((sum, p) =>
        sum + (p.stories?.filter(s => typeof s.text === 'string' && s.text.trim()).length || 0), 0);
      const externalStories = externalPage?.stories?.filter(s => typeof s.text === 'string' && s.text.trim()) || [];
      const externalPapers = externalPage?.papers?.filter(p => typeof p.text === 'string' && p.text.trim()) || [];
      const externalCount = externalStories.length + externalPapers.length;
      overviewDeck = [
        activeGroupPages.length ? `${activeGroupPages.map(p => p.label).join(' · ')} 共 ${totalGroupTopics} 个话题` : '',
        externalCount ? `外部资讯 ${externalCount} 条${externalPage?.trends?.length ? ` · ${externalPage.trends.length} 条动向` : ''}` : '',
      ].filter(Boolean).join(' · ');
      overviewBody = `<div class="daily-overview-grid" aria-label="本日各版概览">
        ${activeGroupPages.map(p => {
          const pStories = p.stories?.filter(s => typeof s.text === 'string' && s.text.trim()) || [];
          return `<article class="daily-overview-card" data-overview-page="${esc(p.id)}">
            <div class="daily-overview-top">
              <div class="daily-overview-meta">
                <a class="daily-overview-badge" href="${esc(pageHref(p.id))}" data-overview-target="${esc(p.id)}">${esc(p.label)}</a>
                <span class="daily-overview-count">${pStories.length} 个话题</span>
              </div>
            </div>
            <h2><a href="${esc(pageHref(p.id))}" data-overview-target="${esc(p.id)}">${esc(p.heading || p.label)}</a></h2>
            ${p.theme ? `<p class="daily-overview-theme">${esc(p.theme)}</p>` : ''}
            <ol class="daily-overview-topics" aria-label="${esc(p.label)}话题列表">${pStories.map((s, idx) =>
              `<li><a href="${esc(pageHref(p.id, `#topic-${idx + 1}`))}" data-overview-target="${esc(p.id)}" data-overview-topic="topic-${idx + 1}"><span class="overview-topic-num">${String(idx + 1).padStart(2, '0')}</span><span class="overview-topic-title">${esc(s.title)}</span>${s.category ? `<span class="overview-topic-cat">${esc(s.category)}</span>` : ''}</a></li>`).join('')}</ol>
            <a class="daily-overview-enter" href="${esc(pageHref(p.id))}" data-overview-target="${esc(p.id)}">阅读${esc(p.label)}全文 (${pStories.length}) <span aria-hidden="true">→</span></a>
          </article>`;
        }).join('')}
        ${externalPage ? `<article class="daily-overview-card daily-overview-external" data-overview-page="external">
          <div class="daily-overview-top">
            <div class="daily-overview-meta">
              <a class="daily-overview-badge" href="${esc(pageHref('external'))}" data-overview-target="external">${esc(externalPage.label)}</a>
              <span class="daily-overview-count">${externalCount} 条资讯${externalPage.trends?.length ? ` · ${externalPage.trends.length} 条动向` : ''}</span>
            </div>
          </div>
          <h2><a href="${esc(pageHref('external'))}" data-overview-target="external">${esc(externalPage.heading || externalPage.label)}</a></h2>
          ${externalPage.theme ? `<p class="daily-overview-theme">${esc(externalPage.theme)}</p>` : ''}
          <ol class="daily-overview-topics daily-overview-external-list" aria-label="外部资讯列表">${(externalStories.length ? externalStories : externalPapers).map((s, idx) =>
            `<li><a href="${esc(pageHref('external', externalStories.length ? `#topic-${idx + 1}` : ''))}" data-overview-target="external"${externalStories.length ? ` data-overview-topic="topic-${idx + 1}"` : ''}><span class="overview-topic-num">${String(idx + 1).padStart(2, '0')}</span><span class="overview-topic-title">${esc(s.title)}</span></a></li>`).join('')}</ol>
          ${externalPage.trends?.length ? `<div class="daily-overview-trends" aria-label="动向观察概览"><span class="overview-trends-label">动向观察</span><div class="overview-trends-items">${externalPage.trends.map(t => `<span class="overview-trend-chip">${esc(t.title)}</span>`).join('')}</div></div>` : ''}
          <a class="daily-overview-enter" href="${esc(pageHref('external'))}" data-overview-target="external">阅读外部资讯全文 (${externalCount}) <span aria-hidden="true">→</span></a>
        </article>` : ''}
        ${quietGroupPages.length ? `<p class="daily-overview-quiet">版面注记：今日${esc(quietGroupPages.map(p => p.label).join('、'))}暂无可读讨论记录。</p>` : ''}
      </div>`;
    }

    const firstReadableId = issue.pages[availablePages[0]]?.id || issue.pages[0]?.id;
    const relaySequence = [
      ...(!weekly && availablePages.length > 1 ? [{ id: 'overview', label: '本日总览', title: `${issue.date.replaceAll('-', '.')} 各群与外部资讯总览`, count: `${availablePages.length} 个版面` }] : []),
      ...availablePages.map(idx => {
        const sec = issue.pages[idx];
        const secStories = sec.stories?.filter(s => typeof s.text === 'string' && s.text.trim()) || [];
        const secPapers = sec.papers?.filter(p => typeof p.text === 'string' && p.text.trim()) || [];
        const count = sec.id === 'external' ? `${secStories.length + secPapers.length} 条资讯` : `${secStories.length} 个话题`;
        return { id: sec.id, label: sec.label, title: sec.heading || sec.label, count };
      }),
    ];
    const relayIndex = relaySequence.findIndex(item => item.id === page.id);
    const prevRelay = relaySequence.length > 1 && relayIndex >= 0 ? relaySequence[(relayIndex - 1 + relaySequence.length) % relaySequence.length] : null;
    const nextRelay = relaySequence.length > 1 && relayIndex >= 0 ? relaySequence[(relayIndex + 1) % relaySequence.length] : null;
    const relayNav = prevRelay && nextRelay ? `<nav class="section-relay" aria-label="相邻版面切换">
      <a class="relay-card is-prev" href="${esc(pageHref(prevRelay.id))}" data-overview-target="${esc(prevRelay.id)}" data-relay="prev"><span class="relay-dir">← 上一版 · ${esc(prevRelay.label)}（${esc(prevRelay.count)}）</span><strong class="relay-title">${esc(prevRelay.title)}</strong></a>
      <a class="relay-card is-next" href="${esc(pageHref(nextRelay.id))}" data-overview-target="${esc(nextRelay.id)}" data-relay="next"><span class="relay-dir">下一版 · ${esc(nextRelay.label)}（${esc(nextRelay.count)}） →</span><strong class="relay-title">${esc(nextRelay.title)}</strong></a>
    </nav>` : '';
    main.innerHTML = `
      <nav class="group-nav" aria-label="本期版面" data-page-count="${issue.pages.length}">
        <div role="tablist" aria-label="群聊与外部资讯">${issue.pages.map((p, i) => `<button role="tab" id="group-${i}" ${hasContent(p) ? '' : `disabled title="${esc(p.label)}暂无稿件" aria-label="${esc(p.label)}，暂无稿件"`} aria-selected="${!isOverview && i === pageIndex}" aria-controls="digest-panel" tabindex="${!isOverview && i === pageIndex && hasContent(p) ? 0 : isOverview && i === availablePages[0] ? 0 : -1}" data-page="${i}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(p.label)}</button>`).join('')}</div>
        <div class="group-tools">
          ${!weekly && availablePages.length > 1 ? `<button type="button" class="overview-pill" aria-pressed="${isOverview}" title="查看本日各群与外部资讯总览"><i data-lucide="layout-grid"></i><span>本日总览</span></button>` : ''}
          <button type="button" class="save-image" aria-label="保存图片" aria-haspopup="dialog" aria-controls="share-dialog" title="把这一版保存为长图"><i data-lucide="image-down"></i><span>保存图片</span></button>
        </div>
      </nav>
      <section id="digest-panel" role="tabpanel"${isOverview ? ' aria-label="本日总览"' : ` aria-labelledby="group-${pageIndex}"`}>
        ${isOverview ? `<header class="digest-heading is-overview-heading">
          <div class="overview-bar">
            <div class="overview-bar-main">
              <h1>本日全版导览</h1>
              <p class="digest-deck">${esc(overviewDeck)}</p>
            </div>
            <a class="overview-inline-switch" href="${esc(pageHref(firstReadableId))}" data-overview-target="${esc(firstReadableId)}">单群详读 →</a>
          </div>
        </header>` : `<header class="digest-heading">
          <div class="digest-heading-top">
            <p class="digest-kicker">${esc(page.section)}${!weekly && availablePages.length > 1 ? `<a class="overview-inline-switch" href="${esc(pageHref('overview'))}" data-overview-target="overview">本日总览 ↗</a>` : ''}</p>
            ${weekly ? `<a class="ranking-link" href="${esc(rankingHref)}" aria-label="打开${external ? '社区' : page.label}周榜">${external ? '社区周榜' : '本群周榜'}<i data-lucide="arrow-up-right"></i></a>` : ''}
            ${weekly || page.papers || external ? '' : `<div class="daily-ranking" aria-label="${esc(issue.date)} ${esc(page.label)}活跃榜" data-group="${esc(page.id)}">
              <span id="daily-ranking-title">本群活跃榜</span>
              ${daily?.leaders.length ? `<ol class="daily-leaders" aria-label="本群 Top 3">${daily.leaders.slice(0, 3).map(m => `<li><span class="rank-number">${m.rank}</span>${avatar(m)}</li>`).join('')}</ol>` : '<span class="daily-rank-empty">暂无数据</span>'}
            </div>`}
          </div>
          <h1>${esc(page.heading)}</h1>
          <p class="digest-deck">${esc(page.theme || '等待收录')}</p>
        </header>`}
        ${isOverview ? overviewBody : stories.length ? `<section class="digest-stories${!external && !weekly ? ' discussion-stories' : ''}" aria-label="${external ? '本期外部资讯' : '本期讨论观点'}">${stories.map((s, i) => `<article class="brief" id="topic-${i + 1}">
          <div class="brief-copy"><header class="brief-title"><div class="brief-category"><span>${String(i + 1).padStart(2, '0')}</span>${esc(s.category)}</div>
          <h2>${esc(s.title)}</h2></header><div class="brief-body"><p>${briefText(s)}</p>
          ${s.takeaway ? `<p class="brief-takeaway"><span>讨论摘记</span>${esc(s.takeaway)}</p>` : ''}
          ${storyResources(s)}
          ${s.aiComment ? `<aside class="brief-comment" aria-label="AI 锐评"><span class="brief-comment-label">AI 锐评</span><p>${esc(s.aiComment)}</p></aside>` : ''}
          <div class="brief-actions">${!external && !weekly && s.discussion?.length ? window.AgentHubDiscussion.trigger(s.discussion, i) : ''}</div></div></div>
        </article>`).join('')}
        </section>
          ${page.figure ? `<figure class="lead-figure" aria-labelledby="evidence-heading"><figcaption><h2 id="evidence-heading">论文依据</h2><a href="${esc(page.figure.url)}" target="_blank" rel="noopener noreferrer">${esc(page.figure.credit)}<i data-lucide="arrow-up-right"></i></a></figcaption><div class="evidence-body">${page.figure.src ? `<a href="${esc(page.figure.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(page.figure.src)}" alt="${esc(page.figure.alt)}" width="4086" height="1930"></a>` : `<p>${esc(page.figure.alt)}</p>`}<p class="evidence-note">${esc(page.figure.caption)}</p></div></figure>` : ''}
        ` : papers.length ? `<div class="paper-list">${papers.map((p, i) => `<article>
          <div class="brief-category"><span>${String(i + 1).padStart(2, '0')}</span>${esc(p.topic)}</div>
          <h2><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}<i data-lucide="arrow-up-right"></i></a></h2>
          <p>${esc(p.text)}</p><a class="paper-source" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">arXiv: ${esc(p.id)}<i data-lucide="arrow-up-right"></i></a>
        </article>`).join('')}</div>` : hasContent(page) ? '' : `<div class="digest-empty"><i data-lucide="newspaper"></i><h2>${esc(issue.date)} · ${esc(page.label || '本版')}暂无稿件</h2>${note ? `<p>${esc(note)}</p>` : ''}<span class="digest-empty-status">本期暂无可阅读的版面</span></div>`}
        ${!isOverview && external && page.trends?.length ? `<section class="external-trends" aria-labelledby="trends-heading"><h2 id="trends-heading">动向观察</h2><div>${page.trends.map(trend => `<article><h3>${esc(trend.title)}</h3><p>${esc(trend.text)}</p></article>`).join('')}</div></section>` : ''}
        ${!isOverview && note && hasContent(page) ? `<div class="digest-source">${esc(note)}</div>` : ''}
        ${relayNav}
      </section>`;
    for (const image of main.querySelectorAll('.lead-figure img')) image.src = asset(image.getAttribute('src'));
    window.AgentHubDiscussion.configure(!isOverview && !external && !weekly && stories.some(story => story.discussion?.length) ? {
      section: page.label, back: '日报', total: stories.length,
      topic: index => stories[index]?.discussion?.length ? {
        title: stories[index].title, messages: stories[index].discussion, category: stories[index].category,
        text: stories[index].text, emphasis: stories[index].emphasis, comment: stories[index].aiComment,
        resources: stories[index].resources, feedbackId: stories[index].feedbackId,
      } : null,
    } : null);
    const sections = document.querySelector('#edition-sections');
    sections.replaceChildren(main.querySelector('.group-nav'));
    function flip(index, focus = false) {
      if (!availablePages.includes(index)) return;
      navigate(mode, issue.id, true, issue.pages[index].id);
      if (focus) document.querySelector(`#group-${index}`).focus();
    }
    window.flipDigestPage = delta => flip(isOverview
      ? (delta < 0 ? availablePages.at(-1) : availablePages[0])
      : (delta < 0
          ? availablePages.findLast(index => index < pageIndex)
          : availablePages.find(index => index > pageIndex)));
    for (const button of sections.querySelectorAll('[data-page]')) {
      button.onclick = () => flip(Number(button.dataset.page), true);
      button.onkeydown = e => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
        const index = availablePages.indexOf(Number(button.dataset.page));
        if (index < 0) return;
        let next;
        if (e.key === 'ArrowRight') next = availablePages[(index + 1) % availablePages.length];
        if (e.key === 'ArrowLeft') next = availablePages[(index - 1 + availablePages.length) % availablePages.length];
        if (e.key === 'Home') next = availablePages[0];
        if (e.key === 'End') next = availablePages.at(-1);
        if (next === undefined) return;
        e.preventDefault(); e.stopPropagation(); flip(next, true);
      };
    }
    const overviewPill = sections.querySelector('.overview-pill');
    if (overviewPill) {
      overviewPill.onclick = () => navigate(mode, issue.id, true, isOverview ? firstReadableId : 'overview');
    }
    for (const link of main.querySelectorAll('[data-overview-target]')) {
      link.onclick = e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        const targetPage = link.dataset.overviewTarget;
        const targetTopic = link.dataset.overviewTopic;
        navigate(mode, issue.id, !targetTopic, targetPage);
        if (targetTopic) {
          document.getElementById(targetTopic)?.scrollIntoView();
        }
      };
    }
    if (window.matchMedia?.('(max-width: 700px)').matches) {
      const selected = sections.querySelector('[aria-selected="true"]');
      const tablist = selected?.closest('[role="tablist"]');
      if (selected && tablist) {
        const target = selected.offsetLeft - (tablist.clientWidth - selected.offsetWidth) / 2;
        tablist.scrollLeft = Math.max(0, Math.min(target, tablist.scrollWidth - tablist.clientWidth));
      }
    }
    // The toolbar button and the compact header's copy save the same page.
    for (const button of document.querySelectorAll('.save-image')) button.onclick = () =>
      window.AgentHubShare.save(`${issue.label} ${page.label}`, `AgentHub日报-${issue.date}-${page.label}.png`);
    main.dataset.page = page.id;
    window.AgentHubFeedback?.mount(main, isOverview ? [] : page.stories || []);
    window.lucide.createIcons({ attrs: { 'aria-hidden': 'true', 'stroke-width': 1.6 } });
  };
})();
