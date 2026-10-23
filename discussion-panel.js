// Anonymous source discussions open in one shared reader on daily and weekly pages.
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const paths = {
    messages: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    reply: '<path d="M20 20v-7a4 4 0 0 0-4-4H4"/><path d="M9 14 4 9l5-5"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    paper: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    article: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    code: '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
    demo: '<polygon points="6 3 20 12 6 21 6 3"/>',
    external: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  };
  const icon = name => `<svg class="discussion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
  const speakerName = number => number === null ? '未编号群友' : `群友 ${number}`;
  const speakerColor = number => number === null ? 'unknown' : (number - 1) % 6;
  // Weekly times carry a date ("10.07 12:35"); daily times are only "12:35".
  const day = time => time.includes(' ') ? time.slice(0, time.indexOf(' ')) : '';
  const pad = number => String(number).padStart(2, '0');

  // Only public web addresses become links; credentials and secret-looking queries stay text.
  function safeUrl(raw) {
    try {
      const url = new URL(raw);
      const privateQuery = [...url.searchParams.keys()].some(key => /token|key|auth|signature|session/i.test(key));
      return /^https?:$/.test(url.protocol) && !url.username && !url.password && !privateQuery ? url : null;
    } catch { return null; }
  }
  // Links in running text and quote previews (a button, which cannot hold a link) show the address people recognize.
  const urlLabel = url => {
    const label = `${url.hostname.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}`;
    return label.length > 42 ? `${label.slice(0, 41)}…` : label;
  };
  // WeChat sends its built-in faces as "[名称]" codes. Known ones become Unicode emoji, drawn by the
  // reader's system font rather than Tencent's artwork; the code stays as the tooltip and the name is read
  // aloud. Other short codes stay as muted text, and longer bracketed text is left alone.
  const emoji = {
    微笑: '🙂', 撇嘴: '😕', 色: '😍', 发呆: '😳', 得意: '😎', 流泪: '😢', 害羞: '☺️', 闭嘴: '🤐', 睡: '😴', 大哭: '😭', 尴尬: '😅', 发怒: '😠',
    调皮: '😜', 呲牙: '😁', 惊讶: '😲', 难过: '🙁', 囧: '😓', 抓狂: '😫', 吐: '🤮', 偷笑: '🤭', 愉快: '😊', 白眼: '🙄', 傲慢: '😤', 困: '😪',
    惊恐: '😱', 憨笑: '😄', 悠闲: '😌', 咒骂: '🤬', 疑问: '🤨', 嘘: '🤫', 晕: '😵', 衰: '😩', 骷髅: '💀', 敲打: '🔨', 再见: '👋', 擦汗: '😓',
    鼓掌: '👏', 坏笑: '😏', 哈欠: '🥱', 鄙视: '😒', 委屈: '🥺', 快哭了: '😢', 阴险: '😈', 亲亲: '😘', 可怜: '🥺', 笑脸: '😀', 生病: '😷',
    脸红: '😳', 破涕为笑: '😂', 恐惧: '😨', 失望: '😞', 无语: '😑', 嘿哈: '🤪', 捂脸: '🤦', 奸笑: '😏', 机智: '🤓', 皱眉: '😟', 耶: '✌️',
    吃瓜: '🍉', 加油: '💪', 汗: '😓', 天啊: '😱', Emm: '🤔', 社会社会: '🤙', 旺柴: '🐶', 好的: '👌', 打脸: '🤕', 哇: '🤩', 翻白眼: '🙄',
    '666': '👍', 让我看看: '👀', 叹气: '😮‍💨', 苦涩: '🥲', 裂开: '💔', 嘴唇: '👄', 爱心: '❤️', 心碎: '💔', 拥抱: '🤗', 强: '👍', 弱: '👎',
    握手: '🤝', 胜利: '✌️', 抱拳: '🙏', 拳头: '👊', OK: '👌', 合十: '🙏', 啤酒: '🍺', 咖啡: '☕', 蛋糕: '🎂', 玫瑰: '🌹', 凋谢: '🥀',
    菜刀: '🔪', 炸弹: '💣', 便便: '💩', 月亮: '🌙', 太阳: '☀️', 庆祝: '🎉', 礼物: '🎁', 红包: '🧧', 發: '💰', 福: '🧧', 烟花: '🎆', 爆竹: '🧨',
    猪头: '🐷', 发抖: '🥶', 转圈: '💫', Doge: '🐶', Lol: '😆', Smile: '🙂', Grin: '😁', Laugh: '😄', Joyful: '😊',
    Facepalm: '🤦', Smirk: '😏', Smart: '🤓', Concerned: '😟', 'Yeah!': '✌️', Onlooker: '🍉', GoForIt: '💪',
    Sweats: '😓', OMG: '😱', Respect: '🙏', NoProb: '👌', MyBad: '🤕', Wow: '🤩', Boring: '🙄', Awesome: '👍',
    LetMeSee: '👀', Sigh: '😮‍💨', Hurt: '🥲', Broken: '💔', Shocked: '😲', Cry: '😭',
  };
  const textWithStickers = text => esc(text).replace(/\[([^\[\]\s]{1,10})\]/g, (code, name) => Object.hasOwn(emoji, name)
    ? `<span class="discussion-emoji" role="img" aria-label="${name}" title="${code}">${emoji[name]}</span>`
    : name.length <= 6 ? `<span class="discussion-sticker">${code}</span>` : code);
  // An address ends before Chinese punctuation, trailing ASCII punctuation and unbalanced closing brackets.
  // Addresses with credentials or tokens get no url and stay as plain text.
  function* addresses(text) {
    for (const match of text.matchAll(/https?:\/\/[^\s<>"'，。；！？、]+/g)) {
      let label = match[0].replace(/[.,;!?]+$/, '');
      for (const [open, close] of [['(', ')'], ['[', ']'], ['（', '）']]) {
        while (label.endsWith(close) && label.split(close).length > label.split(open).length) label = label.slice(0, -1);
      }
      yield { start: match.index, end: match.index + label.length, url: safeUrl(label) };
    }
  }
  // A message that is nothing but addresses is a link share: each address shows as a card, like the
  // share cards WeChat sends, and card is true so the entry needs no bubble. Addresses in running text
  // stay where they are as short links, with the full address in href and title.
  function inline(text) {
    const found = [...addresses(text)].filter(address => address.url);
    let rest = '', end = 0;
    for (const { start, end: stop } of found) { rest += text.slice(end, start); end = stop; }
    if (found.length && !/[^\s.,;!?。，；！？、()（）[\]]/.test(rest + text.slice(end))) {
      return { html: found.map(({ url }) => linkCard(url)).join(''), card: true };
    }
    let html = '';
    end = 0;
    for (const { start, end: stop, url } of found) {
      html += `${textWithStickers(text.slice(end, start))}<a href="${esc(url.href)}" title="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(urlLabel(url))}</a>`;
      end = stop;
    }
    return { html: html + textWithStickers(text.slice(end)), card: false };
  }
  const sites = { 'mp.weixin.qq.com': '公众号', 'zhihu.com': '知乎', 'xiaohongshu.com': '小红书', 'github.com': 'GitHub', 'arxiv.org': 'arXiv', 'x.com': 'X', 'twitter.com': 'X', 'bilibili.com': 'B 站', 'youtube.com': 'YouTube', 'huggingface.co': 'Hugging Face' };
  // Subdomains such as zhuanlan.zhihu.com fall back to their site's name.
  const siteName = host => sites[host] || sites[host.split('.').slice(-2).join('.')];
  const placeholders = { 表情: '表情', 图片: '图片', 视频: '视频', 语音: '语音', 动画表情: '表情', 媒体引用未解析: '图片或视频' };
  // WeChat exports cards as "[链接] title" plus indented 来源/摘要/URL lines.
  function shareCard(text) {
    const [head, ...rest] = text.split('\n');
    const title = /^\[链接\]\s*(.+)$/.exec(head)?.[1].trim();
    if (!title) return null;
    const fields = {};
    for (const line of rest) {
      const field = /^\s+(来源|摘要|URL)[:：]\s*(.*)$/.exec(line);
      if (!field) return null;
      fields[field[1]] = field[2].trim();
    }
    const url = fields.URL ? safeUrl(fields.URL) : null;
    const host = url?.hostname.replace(/^www\./, '');
    const origin = [host && (siteName(host) || host), fields.来源].filter(Boolean).join(' · ');
    const inner = `<span class="discussion-card-origin">${icon('link')}${esc(origin || '链接')}</span><span class="discussion-card-title">${esc(title)}</span>${
      fields.摘要 ? `<span class="discussion-card-summary">${esc(fields.摘要)}</span>` : ''}`;
    return url ? `<a class="discussion-card" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : `<span class="discussion-card">${inner}</span>`;
  }
  // Article pages and the reader show the same icon for a source. Weekly kinds are free-form ("repo",
  // "wechat", "article" for a GitHub page), so a GitHub or arXiv address decides first.
  function resourceKind(resource) {
    let host = '';
    try { host = new URL(resource.url).hostname.replace(/^www\./, ''); } catch { /* No address: use the kind. */ }
    if (host === 'github.com') return 'code';
    if (host === 'arxiv.org') return 'paper';
    return { paper: 'paper', arxiv: 'paper', article: 'article', wechat: 'article', official: 'article', code: 'code',
      github: 'code', repo: 'code', demo: 'demo', discussion: 'messages' }[resource.kind] || 'link';
  }
  // A plain address reads like a share card: the site, then a title people recognize.
  function linkTitle(url) {
    const host = url.hostname.replace(/^www\./, '');
    const parts = url.pathname.split('/').filter(Boolean);
    if (host === 'arxiv.org' && ['abs', 'pdf', 'html'].includes(parts[0]) && parts[1]) return `arXiv ${parts[1].replace(/\.pdf$/, '')}`;
    if (host === 'github.com' && parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    if (host === 'huggingface.co' && parts[0] === 'papers' && parts[1]) return `Hugging Face 论文 ${parts[1]}`;
    // The origin line already names the host, so the title is the path people would recognize.
    let path = parts.join('/');
    try { path = decodeURIComponent(path); } catch { /* Keep the encoded path. */ }
    return !path ? host : path.length > 48 ? `${path.slice(0, 47)}…` : path;
  }
  function linkCard(url) {
    const host = url.hostname.replace(/^www\./, ''), title = linkTitle(url);
    // A site's front page has the host as its title; the line above it then says it is a website.
    const origin = siteName(host) || (title === host ? '网站' : host);
    return `<a class="discussion-card" href="${esc(url.href)}" title="${esc(url.href)}" target="_blank" rel="noopener noreferrer"><span class="discussion-card-origin">${icon('link')}${esc(origin)}</span><span class="discussion-card-title">${esc(title)}</span></a>`;
  }
  function messageBody(text) {
    const share = shareCard(text);
    if (share) return { html: share, card: true };
    const file = /^\[文件\]\s*(.+?)\s*\(([^,()]+),[^()]*\)\s*$/.exec(text);
    if (file) return { html: `<span class="discussion-attachment">${icon('file')}${esc(file[1])}<small>${esc(file[2])}</small></span>` };
    const media = /^\[([^\[\]]+)\]$/.exec(text.trim());
    if (media && placeholders[media[1]]) return { html: `<span class="discussion-attachment is-placeholder">${esc(placeholders[media[1]])}</span>` };
    return inline(text);
  }
  // Quote previews drop the export's "[引用]" marker, fold a quoted share card to its title and
  // shorten addresses.
  function quoteText(text) {
    text = text.replace(/^(?:\[引用\]\s*)+/, '').replace(/(\[链接\][^\n]*)(?:\n\s+(?:来源|摘要|URL)[:：][^\n]*)+/g, '$1');
    let short = '', end = 0;
    for (const { start, end: stop, url } of addresses(text)) {
      if (url) { short += text.slice(end, start) + urlLabel(url); end = stop; }
    }
    return short + text.slice(end);
  }
  function quotedMessage(messages, index) {
    const quote = messages[index].quote;
    if (!quote || quote.speaker === null) return -1;
    const normalize = text => text.replace(/^(?:\[引用\]\s*)+/, '').replace(/\s+/g, ' ').trim();
    const text = normalize(quote.text);
    // A quoted preview can be truncated; ambiguous or media-only matches stay expandable.
    const ellipsis = /(?:\.{3}|…|\[\.\.\.\])\s*$/;
    const truncated = ellipsis.test(text);
    const prefix = text.replace(ellipsis, '').trim();
    const candidates = messages.slice(0, index).flatMap((message, i) => {
      const original = normalize(message.text);
      return message.speaker === quote.speaker && (original === text ||
        (truncated && prefix.length >= 20 && original.startsWith(prefix))) ? [i] : [];
    });
    return candidates.length === 1 ? candidates[0] : -1;
  }
  function renderList(messages, prefix) {
    const messageId = index => `${prefix}-message-${index + 1}`;
    const groups = [];
    for (const [index, message] of messages.entries()) {
      const previous = messages[index - 1];
      if (!previous || previous.speaker !== message.speaker || day(previous.time) !== day(message.time)) groups.push([]);
      groups.at(-1).push({ ...message, index });
    }
    const entry = message => {
      const target = quotedMessage(messages, message.index);
      const quoteId = `${messageId(message.index)}-quote`;
      const quote = message.quote ? `<button type="button" class="discussion-quote" data-speaker-color="${speakerColor(message.quote.speaker)}" ${target >= 0
        ? `data-message-target="${messageId(target)}" aria-label="查看${esc(speakerName(message.quote.speaker))}的原消息"`
        : `aria-expanded="false" aria-controls="${quoteId}" aria-label="展开完整引文"`}>
<span class="discussion-quote-body"><span class="discussion-quote-label">${icon('reply')}${esc(speakerName(message.quote.speaker))}</span><span class="discussion-quote-text" id="${quoteId}">${textWithStickers(quoteText(message.quote.text))}</span></span>
        </button>` : '';
      const body = messageBody(message.text);
      // A card on its own needs no bubble around it; with a quote, the bubble holds both.
      const cardOnly = !quote && body.card;
      return `<div class="discussion-entry${cardOnly ? ' is-card' : ''}" id="${messageId(message.index)}" tabindex="-1" aria-label="${esc(speakerName(message.speaker))}，${esc(message.time)}">${quote}<div class="discussion-text">${body.html}</div></div>`;
    };
    // Weekly discussions span days; a date rule marks where each new day starts.
    let shownDay = '';
    return `<ol class="discussion-messages">${groups.map(group => {
      const groupDay = day(group[0].time);
      const divider = groupDay && groupDay !== shownDay ? `<li class="discussion-day" aria-hidden="true"><span>${esc(groupDay)}</span></li>` : '';
      shownDay = groupDay || shownDay;
      return `${divider}<li data-speaker-color="${speakerColor(group[0].speaker)}">
      <span class="discussion-avatar" aria-hidden="true">${esc(group[0].speaker)}</span>
      <div class="discussion-message"><div class="discussion-meta"><span class="discussion-speaker">${esc(speakerName(group[0].speaker))}</span><time>${esc(groupDay ? group[0].time.slice(groupDay.length + 1) : group[0].time)}</time></div>
      <div class="discussion-entries">${group.map(entry).join('')}</div></div>
    </li>`;
    }).join('')}</ol>`;
  }
  function summary(messages) {
    const first = messages[0].time, last = messages.at(-1).time;
    const span = day(first) ? (day(first) === day(last) ? day(first) : `${day(first)}–${day(last)}`)
      : first === last ? first : `${first}–${last}`;
    return { count: messages.length, speakers: new Set(messages.map(message => message.speaker)).size, span };
  }
  // The summary beside the chat repeats the article: same text, and the page's emphasis rule
  // (unique spans within one paragraph, dropped together when they exceed 30% of the text).
  function emphasize(text, phrases) {
    const spans = [...new Set(Array.isArray(phrases) ? phrases : [])]
      .filter(phrase => typeof phrase === 'string' && phrase.length >= 2 && phrase.trim() === phrase &&
        !/\n\s*\n/.test(phrase) && text.includes(phrase) && text.indexOf(phrase) === text.lastIndexOf(phrase))
      .map(phrase => ({ start: text.indexOf(phrase), end: text.indexOf(phrase) + phrase.length }))
      .sort((a, b) => a.start - b.start);
    if (spans.reduce((sum, span) => sum + span.end - span.start, 0) * 10 > text.length * 3) return esc(text);
    let html = '', end = 0;
    for (const span of spans) {
      if (span.start < end) continue;
      html += `${esc(text.slice(end, span.start))}<strong>${esc(text.slice(span.start, span.end))}</strong>`;
      end = span.end;
    }
    return html + esc(text.slice(end));
  }
  function lead(item) {
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    const links = (Array.isArray(item.resources) ? item.resources : []).flatMap(resource => {
      const url = typeof resource?.url === 'string' ? safeUrl(resource.url) : null;
      return url?.protocol === 'https:' && typeof resource.label === 'string' && resource.label.trim()
        ? [{ url, label: resource.label.trim(), kind: resourceKind(resource) }] : [];
    });
    return `${text ? `<div class="discussion-lead-text">${emphasize(text, item.emphasis).split(/\n\s*\n/).map(part => `<p>${part}</p>`).join('')}</div>` : ''}${
      typeof item.comment === 'string' && item.comment.trim() ? `<aside class="discussion-lead-comment" aria-label="AI 锐评"><span>AI 锐评</span><p>${esc(item.comment)}</p></aside>` : ''}${
      links.length ? `<section class="discussion-lead-resources" aria-label="相关资料"><p class="discussion-lead-label">相关资料</p>
        <ul class="discussion-lead-links">${links.map(({ url, label, kind }) => `<li><a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">
          <span class="discussion-lead-link-icon">${icon(kind)}</span>
          <span class="discussion-lead-link-text"><strong>${esc(label)}</strong> <small>${esc(url.hostname.replace(/^www\./, ''))}</small></span>${icon('external')}
        </a></li>`).join('')}</ul></section>` : ''}`;
  }
  // weekly-render.mjs writes the same trigger markup into its static pages.
  function trigger(messages, index) {
    const { count, speakers } = summary(messages);
    return `<button type="button" class="discussion-trigger" id="discussion-${index + 1}" data-discussion-index="${index}" aria-haspopup="dialog" aria-label="查看原始讨论，${count} 条消息，${speakers} 位群友">
      ${icon('messages')}<span class="discussion-trigger-label">原始讨论</span><span class="discussion-trigger-meta">${count} 条 · ${speakers} 人</span>${icon('right')}
    </button>`;
  }
  const api = { renderList, summary, trigger, resourceKind, configure() {}, open() {} };
  (typeof window === 'undefined' ? globalThis : window).AgentHubDiscussion = api;
  if (typeof document === 'undefined' || typeof history === 'undefined') return;

  const fileMode = location.protocol === 'file:';
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pageKey = () => location.pathname + location.search;
  const hashIndex = () => { const match = /^#discussion-(\d+)$/.exec(location.hash); return match ? Number(match[1]) - 1 : -1; };
  const positions = new Map();
  let dialog, body, returnButton, returnTo = null, returnObserver = null;
  let provider = null, active = -1, opener = null, owned = false, expectingPop = false, closeTimer = 0, pageY = 0;

  // Created on first use so page scripts that wire existing dialogs leave this one alone.
  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.id = 'discussion-dialog';
    dialog.className = 'discussion-dialog';
    dialog.setAttribute('aria-labelledby', 'discussion-dialog-title');
    // Wide screens read it as a spread: the editor's summary on the left, the chat on the right.
    // Narrow screens fold the summary into the top of the chat (.discussion-lead-inline).
    dialog.innerHTML = `<button type="button" class="discussion-dialog-close" data-discussion-close aria-label="关闭原始讨论" title="关闭">${icon('close')}</button>
      <header class="discussion-dialog-header">
        <div class="discussion-dialog-heading">
          <p class="discussion-dialog-kicker"></p>
          <h2 id="discussion-dialog-title"></h2>
          <p class="discussion-dialog-meta"></p>
        </div>
      </header>
      <aside class="discussion-lead" aria-label="编辑导读"></aside>
      <section class="discussion-chat" aria-label="原始讨论">
        <p class="discussion-chat-label">${icon('messages')}<span>原始讨论</span><span class="discussion-chat-meta"></span></p>
        <div class="discussion-dialog-body" tabindex="-1"></div>
        <button type="button" class="discussion-return" hidden>${icon('reply')}回到引用处</button>
      </section>`;
    body = dialog.querySelector('.discussion-dialog-body');
    returnButton = dialog.querySelector('.discussion-return');
    document.body.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
    // Our own paths clean up synchronously. This queued event matters only when the platform closed
    // the dialog itself (Chrome's Android back request); it is stale if the reader reopened meanwhile.
    dialog.addEventListener('close', () => {
      if (dialog.open || active < 0) return;
      const leave = owned && history.state?.agentHubDiscussion && pageKey() === provider?.page;
      finish();
      if (leave) { expectingPop = true; history.back(); }
    });
    body.addEventListener('scroll', () => {
      if (active >= 0) positions.set(`${provider.page}#${active}`, body.scrollTop);
      // Fold the header to one line while reading; the gap between thresholds prevents flicker.
      if (body.scrollTop > 48) dialog.classList.add('is-scrolled');
      else if (body.scrollTop < 8) dialog.classList.remove('is-scrolled');
    }, { passive: true });
    dialog.addEventListener('click', event => {
      if (event.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) requestClose();
        return;
      }
      const control = event.target.closest('button');
      if (!control || !dialog.contains(control)) return;
      if (control.hasAttribute('data-discussion-close')) requestClose();
      else if (control.dataset.discussionStep) open(Number(control.dataset.discussionStep));
      else if (control.classList.contains('discussion-quote')) followQuote(control);
      else if (control === returnButton && returnTo) {
        const quote = returnTo;
        hideReturn();
        quote.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'instant' : 'smooth' });
        quote.focus({ preventScroll: true });
      }
    });
  }
  function hideReturn() {
    if (returnButton) returnButton.hidden = true;
    returnObserver?.disconnect();
    returnObserver = returnTo = null;
  }
  // Offer the way back only once the quote has actually left the screen.
  function trackReturn(quote) {
    hideReturn();
    if (typeof IntersectionObserver !== 'function') return;
    let left = false;
    returnTo = quote;
    returnObserver = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) { left = true; returnButton.hidden = false; }
      else if (left) hideReturn();
    }, { root: body });
    returnObserver.observe(quote);
  }
  function finish() {
    clearTimeout(closeTimer);
    hideReturn();
    active = -1; owned = false;
    // A class instead of :has() keeps the lock working on older WeChat Android kernels.
    document.documentElement.classList.remove('discussion-reader-open');
    // iOS can still scroll the page underneath; put the reader's place back.
    if (Math.abs(scrollY - pageY) > 1) scrollTo({ top: pageY, behavior: 'instant' });
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }
  function closeReader() {
    if (!dialog?.open) return;
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    finish();
  }
  function followQuote(quote) {
    if (!quote.dataset.messageTarget) {
      const expanded = quote.getAttribute('aria-expanded') !== 'true';
      quote.setAttribute('aria-expanded', String(expanded));
      quote.setAttribute('aria-label', expanded ? '收起完整引文' : '展开完整引文');
      return;
    }
    const target = document.getElementById(quote.dataset.messageTarget);
    trackReturn(quote);
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'instant' : 'smooth' });
    target.classList.remove('is-highlighted');
    void target.offsetWidth;
    target.classList.add('is-highlighted');
    target.addEventListener('animationend', () => target.classList.remove('is-highlighted'), { once: true });
  }
  const topic = index => Number.isInteger(index) && index >= 0 ? provider?.topic(index) || null : null;
  // The feedback worker counts how often each discussion is opened (public build only). A tab reports
  // a story once, so reopening or switching back does not inflate the count; no reader id is sent.
  const reported = new Set();
  function reportOpen(story) {
    const endpoint = window.AGENT_HUB_DATA?.feedbackEndpoint;
    if (!endpoint || fileMode || !/^[a-f0-9]{32}$/.test(story || '') || reported.has(story)) return;
    reported.add(story);
    try {
      if (sessionStorage.getItem(`agenthub:opened:${story}`)) return;
      sessionStorage.setItem(`agenthub:opened:${story}`, '1');
    } catch { /* Storage can be blocked; the in-memory set still dedupes this page. */ }
    const url = new URL('opens', endpoint.endsWith('/') ? endpoint : `${endpoint}/`);
    url.search = new URLSearchParams({ story });
    fetch(url, { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true }).catch(() => {});
  }
  function neighbor(index, step) {
    for (let i = index + step; i >= 0 && i < provider.total; i += step) if (topic(i)) return i;
    return -1;
  }
  function fill(index) {
    const item = topic(index);
    hideReturn();
    const { count, speakers, span } = summary(item.messages);
    dialog.querySelector('.discussion-dialog-kicker').textContent =
      `${provider.section} · 话题 ${pad(index + 1)} / ${pad(provider.total)}${item.category ? ` · ${item.category}` : ''}`;
    dialog.querySelector('#discussion-dialog-title').textContent = item.title;
    dialog.querySelector('.discussion-dialog-meta').textContent = `${count} 条消息 · ${speakers} 位群友 · ${span}`;
    dialog.querySelector('.discussion-chat-meta').textContent = `${count} 条 · ${speakers} 人 · ${span}`;
    const previous = neighbor(index, -1), next = neighbor(index, 1);
    const summaryHtml = lead(item);
    const nextButton = next >= 0 ? `<button type="button" class="discussion-next" data-discussion-step="${next}">
          <span class="discussion-next-label">下一个话题 · ${pad(next + 1)}</span><strong>${esc(topic(next).title)}</strong>${icon('right')}
        </button>` : '';
    const actions = `<div class="discussion-dialog-actions">
          ${previous >= 0 ? `<button type="button" data-discussion-step="${previous}">${icon('left')}上一个话题</button>` : '<span></span>'}
          <button type="button" data-discussion-close>返回${esc(provider.back)}</button>
        </div>`;
    dialog.querySelector('.discussion-lead').innerHTML = `<div class="discussion-lead-body">${
      summaryHtml || '<p class="discussion-lead-empty">这条没有编辑摘要。</p>'}</div>
      <nav class="discussion-lead-nav" aria-label="切换话题">${nextButton}${actions}</nav>`;
    body.innerHTML = `${summaryHtml ? `<details class="discussion-lead-inline">
        <summary><span class="discussion-lead-inline-label">编辑导读</span><span class="discussion-lead-inline-hint">展开摘要与锐评</span>${icon('down')}</summary>
        <div class="discussion-lead-body">${summaryHtml}</div>
      </details>` : ''}
      ${renderList(item.messages, `discussion-${index + 1}`)}
      <p class="discussion-end">以上是全部 ${count} 条消息</p>
      <footer class="discussion-dialog-footer">${nextButton}${actions}</footer>`;
  }
  function open(index, historyMode = 'push') {
    if (!topic(index)) return;
    ensureDialog();
    clearTimeout(closeTimer);
    const wasOpen = dialog.open;
    active = index;
    fill(index);
    reportOpen(topic(index).feedbackId);
    if (!wasOpen) {
      // A deep link has no clicked control, so focus returns to the topic's own trigger.
      opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement : document.getElementById(`discussion-${index + 1}`);
      pageY = scrollY;
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
      document.documentElement.classList.add('discussion-reader-open');
    }
    // Restore after showing: a closed dialog has no layout, so scrollTop would not stick.
    body.scrollTop = positions.get(`${provider.page}#${index}`) || 0;
    dialog.querySelector('.discussion-lead').scrollTop = 0;
    dialog.classList.toggle('is-scrolled', body.scrollTop > 48);
    body.focus({ preventScroll: true });
    if (historyMode === 'none') return;
    const url = fileMode ? location.href : `${location.pathname}${location.search}#discussion-${index + 1}`;
    const state = { ...(history.state || {}), agentHubDiscussion: index + 1 };
    if (!wasOpen && historyMode === 'push') { history.pushState(state, '', url); owned = true; }
    else history.replaceState(state, '', url);
  }
  function requestClose() {
    if (!dialog?.open) return;
    if (owned && history.state?.agentHubDiscussion) {
      // The reader owns one history entry, so the close button and the back gesture agree.
      expectingPop = true;
      history.back();
      // Embedded browsers occasionally swallow the traversal; never leave the reader stuck open.
      closeTimer = setTimeout(closeReader, 600);
      return;
    }
    if (!fileMode && hashIndex() >= 0) {
      const { agentHubDiscussion, ...state } = history.state || {};
      history.replaceState(Object.keys(state).length ? state : null, '', pageKey());
    }
    closeReader();
  }
  function configure(next) {
    closeReader();
    provider = next ? { section: '', back: '正文', ...next, page: pageKey() } : null;
    if (provider && hashIndex() >= 0) open(hashIndex(), 'none');
  }
  // Registered before app.js so a reader-only history step never re-renders the edition.
  addEventListener('popstate', event => {
    if (!dialog || !provider) return;
    if (pageKey() !== provider.page) {
      closeReader();
      return;
    }
    const target = event.state?.agentHubDiscussion ? event.state.agentHubDiscussion - 1 : hashIndex();
    if (topic(target)) {
      open(target, 'none');
      owned = Boolean(event.state?.agentHubDiscussion);
    } else if (dialog.open) closeReader();
    else if (!expectingPop) return;
    expectingPop = false;
    event.stopImmediatePropagation();
  });
  document.addEventListener('click', event => {
    const control = event.target.closest?.('[data-discussion-index]');
    if (!control || !provider) return;
    event.preventDefault();
    open(Number(control.dataset.discussionIndex));
  });
  Object.assign(api, { configure, open });
})();
