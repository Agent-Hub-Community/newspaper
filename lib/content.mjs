import { parseHTML } from 'linkedom';

export function cleanText(value) {
  return value
    .replace(/\b(?:aeskey|cdnthumbkey|authkey|access_token|refresh_token|api_key|xsec_token)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s&<>]+)/gi, '[敏感字段已隐藏]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9_.-]{20,})\b/g, '[敏感字段已隐藏]')
    .replace(/\b1[3-9]\d{9}\b/g, '[联系方式已隐藏]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[联系方式已隐藏]')
    .replace(/\b\d+@chatroom\b/g, '')
    .replace(/\blocal_id=\d+\b/g, '')
    .replace(/\/Users\/[^\s<>"']+/g, '[本地路径]')
    .replace(/<sysmsg[\s\S]*?(?:<\/sysmsg>|$)/g, '')
    .trim();
}

export function safeUrl(raw) {
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|auth|signature|session|share_id|track|from|utm_|app_|share|timestamp/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

export function parseMessages(text, source) {
  const messages = [];
  let current;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::\d{2})?\] (.*?): (.*)$/);
    if (match) {
      if (current) messages.push(current);
      current = { date: match[1], time: match[2], author: match[3], text: match[4], source };
    } else if (current) {
      current.text += '\n' + line;
    }
  }
  if (current) messages.push(current);
  return messages.map(message => ({
    ...message,
    author: cleanText(message.author),
    text: cleanText(message.text).replace(/https?:\/\/[^\s<>"]+/g, raw => safeUrl(raw) || '[链接]'),
    system: message.text.startsWith('[系统]'),
    media: /^\[(?:图片|表情|视频|语音)\](?:\s+local_id=\d+)?\s*$/.test(message.text.trim()),
  }));
}

// Retain readable structure, never execute archived markup or load its external resources.
const allowed = new Set(['H1', 'H2', 'H3', 'H4', 'P', 'DIV', 'SPAN', 'SECTION', 'ARTICLE',
  'HEADER', 'FOOTER', 'MAIN', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY',
  'TR', 'TH', 'TD', 'STRONG', 'B', 'EM', 'I', 'A', 'BR', 'CODE', 'PRE', 'HR', 'SUP', 'SUB']);
export function sanitizeFragment(html) {
  const { document } = parseHTML('<html><body></body></html>');
  const host = document.createElement('div');
  host.innerHTML = html;
  for (const el of [...host.querySelectorAll('*')]) {
    if (!allowed.has(el.tagName)) { el.remove(); continue; }
    for (const attr of [...el.attributes]) if (!['class', 'href'].includes(attr.name)) el.removeAttribute(attr.name);
    if (el.tagName === 'A') {
      const url = safeUrl(el.getAttribute('href'));
      if (url) { el.setAttribute('href', url); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
      else el.removeAttribute('href');
    }
    for (const child of el.childNodes) if (child.nodeType === 3) {
      const text = child.textContent;
      child.textContent = (/^\s/.test(text) ? ' ' : '') + cleanText(text) + (/\s$/.test(text) ? ' ' : '');
    }
  }
  return host.innerHTML;
}

export function extractReport(html) {
  const { document } = parseHTML(html);
  const body = document.querySelector('main') || document.body;
  const h1 = body.querySelector('h1')?.textContent.trim() || '';
  const firstSection = body.querySelector('section');
  const headline = /Weekly Signal/i.test(h1) ? firstSection?.querySelector('h2')?.textContent.trim() || h1 : h1;
  const lead = firstSection?.querySelector('.lead, p')?.textContent.trim() || '';
  const articles = [...body.querySelectorAll('article')].map(article => ({
    title: cleanText(article.querySelector('h3, h2')?.textContent || ''),
    text: cleanText(article.querySelector('p')?.textContent || ''),
  })).filter(a => a.title);
  return {
    headline: cleanText(headline), lead: cleanText(lead), articles,
    html: sanitizeFragment(body.innerHTML),
  };
}
