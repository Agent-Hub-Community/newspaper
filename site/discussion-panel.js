// Anonymous source discussions open in one shared reader on daily and weekly pages.
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rootPrefix = () => (typeof document !== 'undefined' && document.querySelector('meta[name="agenthub-root"]')?.content) || '';
  const asset = file => window.AgentHubRoutes?.asset(file) || `${rootPrefix()}${file}`;
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
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
    external: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  };
  const icon = name => `<svg class="discussion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
  const speakerName = number => number === null ? '未编号群友' : `群友 ${number}`;
  const speakerColor = number => number === null ? 'unknown' : (number - 1) % 12;
  const speakerSide = number => (number !== null && number % 2 === 0) ? 'right' : 'left';
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
  const sites = { 'mp.weixin.qq.com': '公众号', 'zhihu.com': '知乎', 'xiaohongshu.com': '小红书', 'github.com': 'GitHub', 'arxiv.org': 'arXiv', 'x.com': 'X', 'twitter.com': 'X', 'bilibili.com': 'B 站', 'youtube.com': 'YouTube', 'huggingface.co': 'Hugging Face', 'blog.google': 'Google Blog', 'openai.com': 'OpenAI', 'anthropic.com': 'Anthropic' };
  const siteName = host => sites[host] || sites[host.split('.').slice(-2).join('.')];
  let linkPreviews = (typeof window !== 'undefined' && window.AGENT_HUB_LINK_PREVIEWS) || null;
  let linkPreviewsPromise = null;
  function loadLinkPreviews() {
    if (typeof window !== 'undefined' && window.AGENT_HUB_LINK_PREVIEWS) {
      linkPreviews = window.AGENT_HUB_LINK_PREVIEWS;
      return;
    }
    if (linkPreviews || linkPreviewsPromise || typeof document === 'undefined' || !document.head) return;
    const version = typeof window !== 'undefined' && (window.AGENT_HUB_DATA?.lazyAssets?.['link-previews.js'] || window.AGENT_HUB_DATA?.linkPreviewsVersion);
    const src = asset(`link-previews.js${version ? `?v=${version}` : ''}`);
    linkPreviewsPromise = new Promise(resolve => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        linkPreviews = (typeof window !== 'undefined' && window.AGENT_HUB_LINK_PREVIEWS) || {};
        if (dialog?.open && active >= 0 && body?.querySelector('.discussion-card.is-unfurl')) {
          const prevScroll = body.scrollTop;
          fill(active);
          body.scrollTop = prevScroll;
        }
        resolve();
      };
      script.onerror = () => { linkPreviews = {}; script.remove(); resolve(); };
      document.head.append(script);
    });
  }
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
    const inner = `<span class="discussion-card-origin">${icon('link')}<span>${esc(origin || '链接')}</span>${url ? icon('external') : ''}</span><span class="discussion-card-title">${esc(title)}</span>${
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
  // A plain address reads like a share card: real OpenGraph preview when cached, else a clean path title.
  function linkTitle(url) {
    const host = url.hostname.replace(/^www\./, '');
    const parts = url.pathname.split('/').filter(Boolean);
    if (host === 'arxiv.org' && ['abs', 'pdf', 'html'].includes(parts[0]) && parts[1]) return `arXiv ${parts[1].replace(/\.pdf$/, '')}`;
    if (host === 'github.com' && parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    if (host === 'huggingface.co' && parts[0] === 'papers' && parts[1]) return `Hugging Face 论文 ${parts[1]}`;
    let path = parts.join('/');
    try { path = decodeURIComponent(path); } catch { /* Keep the encoded path. */ }
    return !path ? host : path.length > 48 ? `${path.slice(0, 47)}…` : path;
  }
  function linkCard(url) {
    const host = url.hostname.replace(/^www\./, '');
    const preview = (typeof window !== 'undefined' && window.AGENT_HUB_LINK_PREVIEWS?.[url.href]) || linkPreviews?.[url.href];
    const kindIcon = host === 'github.com' ? 'code' : (host === 'arxiv.org' || host === 'huggingface.co') ? 'paper' : 'link';
    const tone = host === 'github.com' ? 'code' : (host === 'arxiv.org' || host === 'huggingface.co') ? 'paper' : (host === 'x.com' || host === 'twitter.com') ? 'social' : 'web';
    const fallbackTitle = linkTitle(url);
    const title = preview?.title || fallbackTitle;
    const named = siteName(host) || preview?.siteName;
    const origin = named ? (named.toLowerCase() === host.toLowerCase() ? named : `${named} · ${host}`) : (fallbackTitle === host ? '网站' : host);
    const desc = preview?.description ? `<span class="discussion-card-summary">${esc(preview.description)}</span>` : '';
    return `<a class="discussion-card is-unfurl" data-link-tone="${tone}" href="${esc(url.href)}" title="${esc(url.href)}" target="_blank" rel="noopener noreferrer"><span class="discussion-card-origin">${icon(kindIcon)}<span>${esc(origin)}</span>${icon('external')}</span><span class="discussion-card-title">${esc(title)}</span>${desc}</a>`;
  }
  function fileExtInfo(name) {
    const match = /\.([a-z0-9]{1,5})$/i.exec((name || '').trim());
    const ext = match ? match[1].toUpperCase() : 'FILE';
    const tone = ext === 'PDF' ? 'pdf'
      : ['HTML', 'HTM'].includes(ext) ? 'web'
      : ['MD', 'TXT', 'JSON', 'YAML', 'YML', 'CSV'].includes(ext) ? 'doc'
      : ['ZIP', 'RAR', '7Z', 'TAR', 'GZ'].includes(ext) ? 'zip'
      : ['DOC', 'DOCX', 'PPT', 'PPTX', 'XLS', 'XLSX'].includes(ext) ? 'office'
      : ['MP4', 'MOV', 'WEBM', 'MKV', 'MP3', 'WAV', 'M4A'].includes(ext) ? 'media'
      : 'other';
    return { ext: ext.slice(0, 4), tone };
  }
  function fileCard({ name, detail, bytes, href }) {
    const { ext, tone } = fileExtInfo(name);
    const metaParts = [bytes ? formatBytes(bytes) : detail, ext !== 'FILE' ? ext : ''].filter(Boolean);
    const inner = `<span class="discussion-file-badge" data-file-tone="${tone}">${esc(ext)}</span><span class="discussion-file-copy"><strong title="${esc(name)}">${esc(name)}</strong>${metaParts.length ? `<small>${esc(metaParts.join(' · '))}</small>` : ''}</span>${href ? `<span class="discussion-file-action" aria-hidden="true">${icon('download')}</span>` : ''}`;
    return href
      ? `<a class="discussion-file-card" href="${esc(href)}" download="${esc(name)}">${inner}</a>`
      : `<div class="discussion-file-card is-static">${inner}</div>`;
  }
  const forwardPayloads = new Map();
  let forwardSerial = 0;
  function forwardCard(text) {
    const lines = text.split('\n');
    const head = /^\[合并聊天记录\]\s*(.+?)(?:\s*\((\d+)条\))?\s*$/.exec(lines[0]);
    if (!head || lines.length < 2) return null;
    const items = [];
    for (const rawLine of lines.slice(1)) {
      const m = /^\s*-\s*([^:：\n]{1,48})[:：]\s*(.*)$/.exec(rawLine);
      if (m) items.push({ sender: m[1].trim(), text: m[2] });
      else if (items.length) items.at(-1).text += `\n${rawLine.trim()}`;
    }
    if (!items.length) return null;
    const renderItemText = value => {
      const t = value.trim();
      if (/^(?:jpg|jpeg|png|gif|webp|\[图片\])$/i.test(t)) return '<span class="discussion-forward-chip">图片</span>';
      if (/^(?:mp4|\[视频\])$/i.test(t)) return '<span class="discussion-forward-chip">视频</span>';
      if (/^\[(?:动画表情|表情)\]$/.test(t)) return '<span class="discussion-forward-chip">表情</span>';
      return inline(t).html;
    };
    const renderRow = (item, clamp = false) => `<li class="discussion-forward-row${clamp ? ' is-clamped' : ''}"><span class="discussion-forward-sender">${esc(item.sender)}</span><span class="discussion-forward-body">${renderItemText(item.text)}</span></li>`;
    const title = head[1].trim();
    const count = head[2] || String(items.length);
    const totalChars = items.reduce((sum, item) => sum + item.text.length, 0);
    // Short forwarded chats render in full inline; only long ones become a WeChat-style preview card that opens a detail modal.
    if (items.length <= 8 && totalChars <= 450) {
      return `<div class="discussion-forward-card"><div class="discussion-forward-head">${icon('messages')}<strong class="discussion-forward-title">${esc(title)}</strong><span class="discussion-forward-count">${esc(count)} 条</span></div><ul class="discussion-forward-list">${items.map(item => renderRow(item, false)).join('')}</ul></div>`;
    }
    const id = `fwd-${++forwardSerial}`;
    forwardPayloads.set(id, { title, count, html: `<ul class="discussion-forward-list is-detail">${items.map(item => renderRow(item, false)).join('')}</ul>` });
    const previewRows = items.slice(0, 4).map(item => renderRow(item, true)).join('');
    return `<button type="button" class="discussion-forward-card is-interactive" data-forward-id="${id}"><div class="discussion-forward-head">${icon('messages')}<strong class="discussion-forward-title">${esc(title)}</strong><span class="discussion-forward-count">${esc(count)} 条</span></div><ul class="discussion-forward-list is-preview">${previewRows}</ul><div class="discussion-forward-foot"><span>查看全部 ${esc(count)} 条聊天记录</span>${icon('right')}</div></button>`;
  }
  function attachmentIcon(kind) {
    return icon(kind === 'image' ? 'paper' : kind === 'video' ? 'demo' : kind === 'audio' ? 'messages' : 'file');
  }
  function attachmentBody(attachment) {
    const rawSource = attachment.src || attachment.href;
    const source = typeof rawSource === 'string' && rawSource.startsWith('attachments/') ? asset(rawSource) : '';
    const label = attachment.name || attachment.label || (attachment.kind === 'image' ? '图片' : attachment.kind === 'video' ? '视频' : attachment.kind === 'audio' ? '语音' : '文件');
    const caption = typeof attachment.caption === 'string' && attachment.caption.trim() ? attachment.caption.trim() : '';
    if (attachment.kind === 'image' && source) {
      const dimensions = attachment.width && attachment.height ? ` width="${esc(attachment.width)}" height="${esc(attachment.height)}"` : '';
      return `<figure class="discussion-media discussion-image"><a class="discussion-zoom" href="${esc(source)}" data-lightbox-src="${esc(source)}" data-lightbox-alt="${esc(caption || attachment.alt || '')}"><img src="${esc(source)}" alt="${esc(attachment.alt || '图片')}"${dimensions} loading="lazy" decoding="async"></a>${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`;
    }
    if (attachment.kind === 'video' && source) {
      const dimensions = attachment.width && attachment.height ? ` width="${esc(attachment.width)}" height="${esc(attachment.height)}"` : '';
      const poster = typeof attachment.poster === 'string' && attachment.poster.startsWith('attachments/') ? asset(attachment.poster) : '';
      return `<figure class="discussion-media discussion-video"><video controls muted playsinline preload="metadata"${dimensions}${poster ? ` poster="${esc(poster)}"` : ''}><source src="${esc(source)}"${attachment.mime ? ` type="${esc(attachment.mime)}"` : ''}>${esc(label)}</video>${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`;
    }
    if (attachment.kind === 'video' && typeof attachment.poster === 'string' && attachment.poster.startsWith('attachments/')) {
      const poster = asset(attachment.poster);
      return `<figure class="discussion-media discussion-video-thumb"><a class="discussion-zoom" href="${esc(poster)}" data-lightbox-src="${esc(poster)}" data-lightbox-alt="${esc(caption || '视频封面')}"><img src="${esc(poster)}" alt="${esc(attachment.alt || '视频')}" loading="lazy" decoding="async"><span class="discussion-video-badge">${icon('demo')}<span>视频</span></span></a></figure>`;
    }
    if (attachment.kind === 'audio' && source) {
      return `<div class="discussion-media discussion-audio"><audio controls muted preload="metadata"><source src="${esc(source)}"${attachment.mime ? ` type="${esc(attachment.mime)}"` : ''}>${esc(label)}</audio><span>${esc(label)}</span></div>`;
    }
    if (attachment.kind === 'file') {
      return fileCard({ name: attachment.name || label, detail: attachment.label || '', bytes: attachment.bytes, href: source });
    }
    return `<span class="discussion-attachment is-placeholder">${attachmentIcon(attachment.kind)}${esc(label)}</span>`;
  }
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 1024) return bytes ? `${bytes} B` : '';
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024, unit = units[0];
    for (let i = 1; value >= 1024 && i < units.length; i += 1) { value /= 1024; unit = units[i]; }
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
  }
  function messageBody(text, attachments = []) {
    const share = shareCard(text);
    if (share) return { html: share, card: true };
    const forwarded = forwardCard(text);
    if (forwarded) return { html: forwarded, card: true };
    const file = /^\[文件\]\s*(.+?)\s*\(([^,()]+),[^()]*\)\s*$/.exec(text);
    if (attachments.length) {
      const media = attachments.map(attachmentBody).join('');
      const hideRaw = /^\[(?:图片|视频|语音)\]$/.test(text.trim()) || (text.trim().startsWith('[文件]') && attachments.some(a => a.kind === 'file'));
      const placeholder = hideRaw ? '' : textWithStickers(text);
      const isRichMedia = hideRaw && attachments.every(a => (a.kind === 'image' && a.src) || (a.kind === 'video' && (a.src || a.poster)) || a.kind === 'file');
      return { html: `${placeholder}${media}`, card: isRichMedia };
    }
    if (file) return { html: fileCard({ name: file[1], detail: file[2] }), card: true };
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
      const body = messageBody(message.text, Array.isArray(message.attachments) ? message.attachments : []);
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
      return `${divider}<li data-speaker-color="${speakerColor(group[0].speaker)}" data-side="${speakerSide(group[0].speaker)}">
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
      typeof item.comment === 'string' && item.comment.trim() ? `<aside class="discussion-lead-comment" aria-label="Bot 锐评"><span>Bot 锐评</span><p>${esc(item.comment)}</p></aside>` : ''}${
      links.length ? `<section class="discussion-lead-resources" aria-label="相关资料"><p class="discussion-lead-label">相关资料</p>
        <ul class="discussion-lead-links">${links.map(({ url, label, kind }) => `<li><a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">
          <span class="discussion-lead-link-icon">${icon(kind)}</span>
          <span class="discussion-lead-link-text"><strong>${esc(label)}</strong> <small>${esc(url.hostname.replace(/^www\./, ''))}</small></span>${icon('external')}
        </a></li>`).join('')}</ul></section>` : ''}`;
  }
  // weekly-render.mjs writes the same trigger markup into its static pages.
  function trigger(messagesOrMeta, index) {
    const { count, speakers } = Array.isArray(messagesOrMeta) ? summary(messagesOrMeta) : messagesOrMeta;
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
      const zoom = event.target.closest('a[data-lightbox-src]');
      if (zoom && dialog.contains(zoom) && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
        event.preventDefault();
        openLightbox(zoom.dataset.lightboxSrc, zoom.dataset.lightboxAlt || '');
        return;
      }
      const control = event.target.closest('button');
      if (!control || !dialog.contains(control)) return;
      if (control.dataset.forwardId) { openForwardModal(control.dataset.forwardId); return; }
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
  let lightbox;
  function openLightbox(src, alt) {
    if (!lightbox) {
      lightbox = document.createElement('dialog');
      lightbox.className = 'discussion-lightbox';
      lightbox.innerHTML = `<div class="discussion-lightbox-bar"><a class="discussion-lightbox-raw" target="_blank" rel="noopener noreferrer">原图${icon('external')}</a><button type="button" class="discussion-lightbox-close" aria-label="关闭大图">${icon('close')}</button></div><figure class="discussion-lightbox-stage"><img alt=""></figure>`;
      document.body.append(lightbox);
      lightbox.addEventListener('click', event => {
        if (event.target === lightbox || event.target.closest('.discussion-lightbox-close') || event.target.classList.contains('discussion-lightbox-stage')) {
          if (typeof lightbox.close === 'function') lightbox.close(); else lightbox.removeAttribute('open');
        }
      });
    }
    const img = lightbox.querySelector('img');
    img.src = src;
    img.alt = alt || '图片预览';
    lightbox.querySelector('.discussion-lightbox-raw').href = src;
    if (typeof lightbox.showModal === 'function') lightbox.showModal(); else lightbox.setAttribute('open', '');
  }
  let forwardModal;
  function openForwardModal(id) {
    const data = forwardPayloads.get(id);
    if (!data) return;
    if (!forwardModal) {
      forwardModal = document.createElement('dialog');
      forwardModal.className = 'discussion-forward-modal';
      forwardModal.innerHTML = `<header class="discussion-forward-modal-head"><div class="discussion-forward-modal-title">${icon('messages')}<strong></strong><span class="discussion-forward-count"></span></div><button type="button" class="discussion-forward-modal-close" aria-label="关闭聊天记录">${icon('close')}</button></header><div class="discussion-forward-modal-body"></div>`;
      document.body.append(forwardModal);
      forwardModal.addEventListener('click', event => {
        if (event.target === forwardModal || event.target.closest('.discussion-forward-modal-close')) {
          if (typeof forwardModal.close === 'function') forwardModal.close(); else forwardModal.removeAttribute('open');
        }
      });
    }
    forwardModal.querySelector('.discussion-forward-modal-title strong').textContent = data.title;
    forwardModal.querySelector('.discussion-forward-modal-title .discussion-forward-count').textContent = `${data.count} 条`;
    forwardModal.querySelector('.discussion-forward-modal-body').innerHTML = data.html;
    if (typeof forwardModal.showModal === 'function') forwardModal.showModal(); else forwardModal.setAttribute('open', '');
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
    for (const el of body.querySelectorAll('video, audio')) {
      el.muted = true;
      el.volume = 0.25;
    }
  }
  let pendingOpen = -1;
  function open(index, historyMode = 'push') {
    const item = topic(index);
    if (!item) return;
    if (item.pending && typeof provider?.ensureLoaded === 'function') {
      pendingOpen = index;
      const targetProvider = provider;
      loadLinkPreviews();
      provider.ensureLoaded().then(() => {
        if (provider !== targetProvider || pendingOpen !== index) return;
        pendingOpen = -1;
        const loaded = topic(index);
        if (loaded && !loaded.pending) open(index, historyMode);
      }).catch(() => { pendingOpen = -1; });
      return;
    }
    pendingOpen = -1;
    ensureDialog();
    clearTimeout(closeTimer);
    const wasOpen = dialog.open;
    active = index;
    loadLinkPreviews();
    fill(index);
    reportOpen(item.feedbackId);
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
    pendingOpen = -1;
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
  const prefetchFromEvent = event => {
    const control = event.target?.closest?.('[data-discussion-index]');
    if (!control || !provider) return;
    provider.prefetch?.();
    loadLinkPreviews();
  };
  document.addEventListener('pointerenter', prefetchFromEvent, true);
  document.addEventListener('focusin', prefetchFromEvent);
  document.addEventListener('click', event => {
    const control = event.target.closest?.('[data-discussion-index]');
    if (!control || !provider) return;
    event.preventDefault();
    open(Number(control.dataset.discussionIndex));
  });
  Object.assign(api, { configure, open });
})();
