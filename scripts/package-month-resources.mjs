import { readFile, readdir, writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseHTML } from 'linkedom';

// No source drafts are modified. Default mode is offline; --fetch enables GETs.
// Output: resources[date][group][topic_key] = [{ kind, label, url }].
// Audit status pending means no HTTP request was made, not a verified resource.
const DEFAULT_DIRECTORY = fileURLToPath(new URL('../scratch/month-d-2026-09-23/', import.meta.url));
const KINDS = new Set(['paper', 'article', 'code', 'demo', 'discussion']);
const LABELS = { paper: '\u8bba\u6587\u539f\u6587', article: '\u539f\u6587\u8d44\u6599', code: '\u4ee3\u7801\u4ed3\u5e93',
  demo: '\u6f14\u793a\u94fe\u63a5', discussion: '\u539f\u59cb\u8ba8\u8bba' };
const URL_PATTERN = /https?:\/\/[^\s<>"'\u3000\u3001\u3002\uff0c\uff01\uff1f\uff1b\uff08\uff09\u3010\u3011]+/giu;
const blocked = new BlockList();
for (const [network, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
]) blocked.addSubnet(network, bits, 'ipv4');
for (const [network, bits] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
  ['3fff::', 20]]) blocked.addSubnet(network, bits, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

export function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, 'ipv4') :
    family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

export function checkUrl(raw) {
  if (typeof raw !== 'string' || raw !== raw.trim() || /[\u0000-\u0020\\]/u.test(raw)) {
    return { reason: 'malformed_url' };
  }
  let url;
  try { url = new URL(raw); } catch { return { reason: 'malformed_url' }; }
  if (url.protocol !== 'https:') return { reason: 'https_required' };
  if (url.username || url.password) return { reason: 'credentials_forbidden' };
  // Do not strip queries: that would invent an unproven replacement URL.
  if (raw.split('#')[0].includes('?')) return { reason: url.hostname === 'mp.weixin.qq.com'
    ? 'wechat_query_not_supported' : 'query_not_supported' };
  if (url.port) return { reason: 'nonstandard_port' };
  if (/\.\.\.|\u2026|%e2%80%a6/i.test(raw)) return { reason: 'truncated_url' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (!isPublicAddress(host)) return { reason: 'nonpublic_address' };
  } else if (!host.includes('.') || host.endsWith('.') ||
      /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|test|invalid|example|onion|arpa)$/i.test(host)) {
    return { reason: 'nonpublic_hostname' };
  }
  return { url: url.href };
}

function clean(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function extractLinks(content) {
  const text = String(content ?? '');
  const links = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    let url = match[0].replace(/[.,;!]+$/, '');
    // Remove prose/Markdown closing delimiters only when they are unbalanced.
    for (const [open, close] of [['(', ')'], ['[', ']']]) {
      while (url.endsWith(close) && url.split(close).length > url.split(open).length) url = url.slice(0, -1);
    }
    const lineStart = text.lastIndexOf('\n', match.index - 1) + 1;
    let label = text.slice(lineStart, match.index).replace(URL_PATTERN, '').trim();
    const markdown = label.match(/\[([^\]]+)\]\($/);
    if (markdown) label = markdown[1];
    if (/^(?:URL|link)?\s*[:\uff1a]?$/i.test(label)) {
      label = text.match(/^\[\u94fe\u63a5\]\s*(.+)$/m)?.[1] || '';
    }
    links.push({ url, link_text: clean(label.replace(/[:\uff1a\s]+$/, '')).slice(0, 160) });
  }
  return links;
}

function identity(url) {
  try { const u = new URL(url); u.hash = ''; return u.href; } catch { return url; }
}

function evidence(refs, messages) {
  return Array.isArray(refs) && refs.every(id => typeof id === 'string' && messages.has(id));
}

export function collectCandidates(input, draft) {
  if (!Array.isArray(input.messages) || !Array.isArray(draft.stories) ||
      (draft.resources !== undefined && !Array.isArray(draft.resources))) throw new Error('Invalid input/draft shape');
  const messages = new Map(input.messages.map(m => [m.id, m]));
  if (messages.size !== input.messages.length) throw new Error('Duplicate message IDs');
  const links = new Map(input.messages.map(m => [m.id, extractLinks(m.content)]));
  const topics = new Set();
  const rejectedResources = [];
  const validResources = (draft.resources || []).filter((r, index) => {
    const refs = r?.evidence_ids;
    const found = evidence(refs, messages) && refs.length &&
      typeof r.url === 'string' && refs.some(id => links.get(id).some(l => identity(l.url) === identity(r.url)));
    if (!found) rejectedResources.push({ index, url: r?.url ?? null,
      source_message_ids: Array.isArray(refs) ? refs : [], reason: 'draft_resource_without_url_in_declared_evidence' });
    return found;
  });
  const stories = draft.stories.map(story => {
    if (typeof story.topic_key !== 'string' || !story.topic_key.trim() || topics.has(story.topic_key) ||
        !evidence(story.evidence_ids, messages) || !story.evidence_ids.length) {
      throw new Error('Missing/duplicate topic_key or invalid story evidence');
    }
    topics.add(story.topic_key);
    const candidates = new Map();
    const add = (link, sourceIds, refs, origin, resource = null) => {
      const key = identity(link.url);
      let item = candidates.get(key);
      if (!item) {
        item = { url: link.url, source_message_ids: [], evidence_ids: [],
          origins: [], link_texts: [], draft_labels: [], draft_kinds: [], source_text: '' };
        candidates.set(key, item);
      }
      item.source_message_ids = [...new Set([...item.source_message_ids, ...sourceIds])];
      item.evidence_ids = [...new Set([...item.evidence_ids, ...refs])];
      item.origins = [...new Set([...item.origins, origin])];
      if (link.link_text && !item.link_texts.includes(link.link_text)) item.link_texts.push(link.link_text);
      if (resource) {
        const label = clean(resource.label || resource.title || resource.text);
        if (label && !item.draft_labels.includes(label)) item.draft_labels.push(label);
        if (KINDS.has(resource.kind)) item.draft_kinds.push(resource.kind);
      }
      item.source_text = item.source_message_ids.map(id =>
        String(messages.get(id).content).replace(URL_PATTERN, '')).join('\n');
    };
    for (const id of story.evidence_ids) {
      for (const link of links.get(id)) add(link, [id], [id], 'story_evidence');
    }
    for (const resource of validResources) {
      const intersection = resource.evidence_ids.filter(id => story.evidence_ids.includes(id));
      if (!intersection.length) continue;
      const sourceIds = resource.evidence_ids.filter(id => links.get(id).some(l => identity(l.url) === identity(resource.url)));
      const link = links.get(sourceIds[0]).find(l => identity(l.url) === identity(resource.url));
      add(link, sourceIds, intersection, 'draft_resource', resource);
    }
    return { topic_key: story.topic_key, title: story.title, evidence_ids: story.evidence_ids,
      story_text: [story.title, story.text].join('\n').replace(URL_PATTERN, ''),
      candidates: [...candidates.values()] };
  });
  return { stories, rejected_resources: rejectedResources };
}

function bounded(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('dns_timeout')), ms);
  })]).finally(() => clearTimeout(timer));
}

export async function resolvePublic(host, resolver = lookup) {
  const name = host.replace(/^\[|\]$/g, '');
  const records = isIP(name) ? [{ address: name, family: isIP(name) }] :
    await bounded(resolver(name, { all: true, verbatim: true }), 8000);
  if (!records.length || records.some(r => !isPublicAddress(r.address))) {
    throw new Error('nonpublic_dns_answer');
  }
  return records;
}

// Pin DNS for the actual socket, use TLS hostname verification, no proxy, cookies,
// browser execution, automatic redirects, or subresource requests.
export async function fetchHop(raw) {
  const url = new URL(raw);
  const addresses = await resolvePublic(url.hostname);
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    let timer;
    const req = request(url, {
      method: 'GET', agent: false, family: pinned.family,
      lookup: (_host, options, callback) => options.all
        ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
      headers: { 'User-Agent': 'AgentHub-ResourceAudit/1.0', Accept: 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'identity' },
    }, res => {
      const base = { status: res.statusCode, location: res.headers.location || null,
        content_type: res.headers['content-type'] || '', addresses: addresses.map(r => r.address) };
      if (res.statusCode < 200 || res.statusCode >= 300 ||
          !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(base.content_type) ||
          (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) {
        clearTimeout(timer);
        resolve({ ...base, body: '', body_reason: 'non_html_or_http_error' });
        res.destroy();
        return;
      }
      let size = 0;
      const chunks = [];
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 524288) {
          clearTimeout(timer);
          resolve({ ...base, body: Buffer.concat(chunks).toString('utf8'), truncated: true });
          res.destroy();
        } else chunks.push(chunk);
      });
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ ...base, body: Buffer.concat(chunks).toString('utf8'), truncated: false });
      });
      res.on('error', error => { clearTimeout(timer); reject(error); });
      res.on('aborted', () => { clearTimeout(timer); reject(new Error('response_aborted')); });
    });
    timer = setTimeout(() => req.destroy(new Error('request_timeout')), 12000);
    req.on('error', error => { clearTimeout(timer); reject(error); });
    req.end();
  });
}

export async function verifyUrl(raw, { hop = fetchHop, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const attempts = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let current = raw;
    const visited = new Set();
    let retry = false;
    for (let redirect = 0; redirect <= 4; redirect++) {
      const checked = checkUrl(current);
      if (checked.reason) return { state: 'skipped', reason: checked.reason, http_status: null, page_title: null, attempts };
      current = checked.url;
      if (visited.has(current)) return { state: 'failed', reason: 'redirect_loop', http_status: null, page_title: null, attempts };
      visited.add(current);
      let response;
      try { response = await hop(current); } catch (error) {
        const reason = error.code || error.message;
        attempts.push({ attempt: attempt + 1, url: current, http_status: null, error: reason });
        if (reason === 'nonpublic_dns_answer') {
          return { state: 'skipped', reason, http_status: null, page_title: null, attempts };
        }
        retry = attempt === 0;
        if (!retry) return { state: 'failed', reason, http_status: null, page_title: null, attempts };
        break;
      }
      attempts.push({ attempt: attempt + 1, url: current, http_status: response.status,
        addresses: response.addresses || [], location: response.location || null });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.location || redirect === 4) {
          return { state: 'failed', reason: 'redirect_limit_or_missing_location',
            http_status: response.status, page_title: null, attempts };
        }
        try { current = new URL(response.location, current).href; } catch {
          return { state: 'failed', reason: 'invalid_redirect', http_status: response.status, page_title: null, attempts };
        }
        continue;
      }
      if (attempt === 0 && [408, 429, 500, 502, 503, 504].includes(response.status)) { retry = true; break; }
      let title = '';
      if (response.body) {
        const { document } = parseHTML(response.body);
        title = clean(document.querySelector('title')?.textContent);
      }
      const result = { http_status: response.status, page_title: title || null, final_url: current,
        content_type: response.content_type, attempts, checked_at: new Date().toISOString() };
      if (response.status < 200 || response.status >= 300) return { ...result, state: 'failed', reason: 'http_error' };
      if (!title || title.includes('\ufffd')) return { ...result, state: 'unverified', reason: 'title_unavailable' };
      if (/^(?:just a moment|access denied|page not found|not found|404\b|403\b|sign in|log in|security check|attention required)|captcha|verify (?:you are|your identity)|\u5b89\u5168\u9a8c\u8bc1|\u8bbf\u95ee\u53d7\u9650/i.test(title)) {
        return { ...result, state: 'unverified', reason: 'login_error_or_challenge_page' };
      }
      return { ...result, state: 'fetched', reason: null };
    }
    if (retry) await sleep(500);
  }
  throw new Error('Unreachable retry state');
}

const STOP_WORDS = new Set(('about after agent agents article based bench benchmark blog code daily demo discussion ' +
  'download framework github introduction language large learning llm model models network official open paper papers ' +
  'project release research source system systems training using welcome safety evaluation introducing ' +
  'performance intelligence artificial reasoning skills security analysis development').split(' '));
function normalized(text) {
  return clean(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
}

// A conservative lexical gate, not a claim of semantic fact-checking. The title
// must share specific words with BOTH the original message and the selected story.
export function titleCorrespondence(title, sourceText, storyText) {
  const t = normalized(title), source = normalized(sourceText), story = normalized(storyText);
  const terms = [...new Set(t.match(/[a-z][a-z0-9]{3,}/g) || [])].filter(w => !STOP_WORDS.has(w));
  const matched = terms.filter(w => new RegExp(`\\b${w}\\b`).test(source) && new RegExp(`\\b${w}\\b`).test(story));
  const distinctive = (String(title).match(/\b[A-Za-z][A-Za-z0-9-]{3,}\b/g) || [])
    .filter(w => /[a-z][A-Z]|[A-Z]{2,}|[a-zA-Z]\d|\d[a-zA-Z]|[a-zA-Z]-[a-zA-Z]/.test(w))
    .flatMap(w => normalized(w).split(' ')).filter(w => !STOP_WORDS.has(w));
  const han = [...new Set((t.match(/[\u3400-\u9fff]{4,}/g) || []).flatMap(s =>
    Array.from({ length: s.length - 3 }, (_, i) => s.slice(i, i + 4))))];
  const matchedHan = han.filter(w => source.includes(w) && story.includes(w));
  return { matched: matched.length >= 2 || matched.some(w => distinctive.includes(w)) || matchedHan.length > 0,
    terms: [...matched, ...matchedHan],
    method: 'specific_title_terms_in_source_and_story' };
}

export function chooseResource(candidate, storyText, verification) {
  if (verification.state !== 'fetched') return { reason: verification.reason || verification.state };
  const correspondence = titleCorrespondence(verification.page_title, candidate.source_text, storyText);
  if (!correspondence.matched) return { reason: 'title_correspondence_unverified', correspondence };
  const descriptive = candidate.link_texts.join(' ');
  let kind = 'article';
  if (/\bpaper\b|\u8bba\u6587/i.test(descriptive)) kind = 'paper';
  else if (/\bdemo\b|\u6f14\u793a|\u8bd5\u73a9/i.test(descriptive)) kind = 'demo';
  else if (/\bdiscussion\b|\u8ba8\u8bba|\u4e89\u8bae/i.test(descriptive)) kind = 'discussion';
  else if (candidate.draft_kinds.length === 1) kind = candidate.draft_kinds[0];
  // Never use a generated draft title as the public label.
  const label = candidate.link_texts.find(s => s.length >= 2 && s.length <= 56 &&
    !/^(?:url|link|paper|code|project|github|app)$/i.test(s)) || LABELS[kind];
  return { resource: { kind, label, url: new URL(candidate.url).href }, correspondence };
}

export async function mapLimited(values, fn, concurrency = 4) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Concurrency must be 1..4');
  let next = 0;
  const result = new Array(values.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) { const i = next++; result[i] = await fn(values[i], i); }
  }));
  return result;
}

export async function packageResources(directory, { fetch = false } = {}) {
  const resources = Object.create(null);
  const audit = { schema_version: 1, mode: fetch ? 'fetch' : 'candidates',
    generated_at: new Date().toISOString(), complete_inputs: true, files: [], stories: [], summary: {} };
  for (const day of (await readdir(directory, { withFileTypes: true }))
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name)).map(d => d.name).sort()) {
    const files = await readdir(path.join(directory, day));
    const groups = [...new Set(files.map(f => f.match(/^(group-\d+)\.(?:input|draft)\.json$/)?.[1]).filter(Boolean))].sort();
    for (const group of groups) {
      const record = { date: day, group };
      audit.files.push(record);
      try {
        const inputBytes = await readFile(path.join(directory, day, `${group}.input.json`), 'utf8');
        const draftBytes = await readFile(path.join(directory, day, `${group}.draft.json`), 'utf8');
        const input = JSON.parse(inputBytes), draft = JSON.parse(draftBytes);
        if (input.date !== day || input.group?.id !== group) throw new Error('Date/group mismatch');
        const collected = collectCandidates(input, draft);
        record.state = 'ready';
        record.rejected_resources = collected.rejected_resources;
        resources[day] ??= Object.create(null);
        resources[day][group] = Object.create(null);
        for (const story of collected.stories) {
          resources[day][group][story.topic_key] = [];
          audit.stories.push({ date: day, group, ...story });
        }
      } catch (error) {
        record.state = error.code === 'ENOENT' ? 'pending_input' : 'invalid_input';
        record.reason = error.message;
        audit.complete_inputs = false;
      }
    }
  }
  const urls = [...new Set(audit.stories.flatMap(s => s.candidates)
    .filter(c => !checkUrl(c.url).reason).map(c => identity(c.url)))];
  const fetched = new Map();
  if (fetch) await mapLimited(urls, async url => { fetched.set(url, await verifyUrl(url)); });
  for (const story of audit.stories) {
    const selected = resources[story.date][story.group][story.topic_key];
    const destinations = new Set();
    for (const candidate of story.candidates) {
      const invalid = checkUrl(candidate.url).reason;
      const verification = invalid ? { state: 'skipped', reason: invalid, http_status: null, page_title: null, attempts: [] }
        : fetched.get(identity(candidate.url)) || { state: 'pending', reason: 'fetch_not_requested',
          http_status: null, page_title: null, attempts: [] };
      candidate.verification = verification;
      const choice = chooseResource(candidate, story.story_text, verification);
      candidate.correspondence = choice.correspondence || null;
      const destination = identity(verification.final_url || candidate.url);
      if (choice.resource && selected.length < 3 && !destinations.has(destination)) {
        selected.push(choice.resource);
        destinations.add(destination);
        candidate.state = 'selected';
        candidate.reason = 'title_and_evidence_match';
      } else {
        candidate.state = verification.state === 'pending' ? 'pending' :
          verification.state === 'failed' ? 'failed' : 'skipped';
        candidate.reason = choice.resource ? (destinations.has(destination) ? 'duplicate_destination' : 'three_resource_limit') : choice.reason;
      }
      delete candidate.source_text;
    }
    story.state = selected.length ? 'selected' : story.candidates.some(c => c.state === 'pending') ? 'pending' : 'empty';
    story.reason = !story.candidates.length ? 'no_url_in_story_evidence' : null;
    delete story.story_text;
  }
  const candidates = audit.stories.flatMap(s => s.candidates);
  if (!audit.files.length) audit.complete_inputs = false;
  audit.summary = {
    input_pairs: audit.files.length, ready_pairs: audit.files.filter(f => f.state === 'ready').length,
    pending_pairs: audit.files.filter(f => f.state === 'pending_input').length,
    invalid_pairs: audit.files.filter(f => f.state === 'invalid_input').length,
    stories: audit.stories.length, candidates: candidates.length, unique_fetchable_urls: urls.length,
    selected: candidates.filter(c => c.state === 'selected').length,
    skipped: candidates.filter(c => c.state === 'skipped').length,
    failed: candidates.filter(c => c.state === 'failed').length,
    pending: candidates.filter(c => c.state === 'pending').length,
    stories_without_urls: audit.stories.filter(s => s.reason === 'no_url_in_story_evidence').length,
    rejected_draft_resources: audit.files.reduce((n, f) => n + (f.rejected_resources?.length || 0), 0),
  };
  return { resources, audit };
}

// Embedded tests keep this task's write surface to the one owned script.
async function selfTest() {
  const { default: assert } = await import('node:assert/strict');
  const { test } = await import('node:test');
  const html = title => ({ status: 200, body: `<html><head><title>${title}</title></head></html>`,
    content_type: 'text/html' });
  const input = { messages: [
    { id: 'm1', content: 'UrbanGround\nPaper: https://arxiv.org/abs/1' },
    { id: 'm2', content: 'UrbanGround code https://outside.org/code' },
    { id: 'm3', content: 'UrbanGround details without URL' },
  ] };
  const story = { topic_key: 'urban', title: 'UrbanGround', text: 'UrbanGround spatial city', evidence_ids: ['m1', 'm3'] };
  await test('URL gate rejects credentials, queries, local hosts, truncation and unknown ports', () => {
    for (const url of ['http://arxiv.org/a', 'https://u:p@arxiv.org/a', 'https://arxiv.org/?',
      'https://arxiv.org/?token=x', 'https://localhost/a', 'https://foo.local/a', 'https://foo.internal/a',
      'https://127.1/a', 'https://2130706433/a', 'https://0x7f000001/a', 'https://[::1]/',
      'https://[::ffff:127.0.0.1]/', 'https://foo.org:8443/', 'https://foo.org/truncated.../',
      'https://foo.org/\n']) assert.ok(checkUrl(url).reason, url);
    assert.equal(checkUrl('https://mp.weixin.qq.com/s?mid=1').reason, 'wechat_query_not_supported');
    assert.equal(checkUrl('https://arxiv.org/abs/2608.27456').reason, undefined);
    assert.equal(checkUrl('https://foo.org:443/a').url, 'https://foo.org/a');
  });
  await test('IP gate denies reserved IPv4/IPv6 and transitional ranges', () => {
    for (const ip of ['0.1.2.3', '10.1.1.1', '100.100.100.200', '169.254.169.254', '172.31.0.1',
      '192.168.0.1', '192.0.2.1', '198.19.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1',
      '255.255.255.255', '::', '::ffff:8.8.8.8', '64:ff9b::7f00:1', 'fc00::1', 'fe80::1',
      '2001:db8::1', '2002:0808:0808::1', '2001::1', '3fff::1']) assert.equal(isPublicAddress(ip), false, ip);
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
  });
  await test('mixed public/private DNS answers fail closed', async () => {
    await assert.rejects(resolvePublic('public.org', async () => [
      { address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 },
    ]), /nonpublic_dns_answer/);
    assert.equal((await resolvePublic('public.org', async () => [{ address: '8.8.8.8', family: 4 }])).length, 1);
  });
  await test('literal URL extraction preserves balanced paths and Markdown labels', () => {
    const links = extractLinks('[UrbanGround](https://urbanground.github.io/)\nPaper: https://arxiv.org/abs/1\u3002\nhttps://site.org/a_(b)\nhttps://site.org/c.../');
    assert.deepEqual(links.map(l => l.url), ['https://urbanground.github.io/', 'https://arxiv.org/abs/1',
      'https://site.org/a_(b)', 'https://site.org/c.../']);
    assert.equal(links[0].link_text, 'UrbanGround');
  });
  await test('draft resources need URL-bearing evidence and a story evidence intersection', () => {
    const result = collectCandidates(input, { stories: [story], resources: [
      { url: 'https://outside.org/code', evidence_ids: ['m2'] },
      { url: 'https://invented.org/', evidence_ids: ['m1'] },
      { url: 'https://outside.org/code', evidence_ids: ['m1'] },
    ] });
    assert.equal(result.stories[0].candidates.length, 1);
    assert.equal(result.rejected_resources.length, 2);
    assert.deepEqual(result.stories[0].candidates[0].source_message_ids, ['m1']);
    const linked = collectCandidates(input, { stories: [story], resources: [
      { url: 'https://outside.org/code', evidence_ids: ['m2', 'm3'] },
    ] }).stories[0].candidates[1];
    assert.deepEqual(linked.evidence_ids, ['m3']);
    assert.deepEqual(linked.source_message_ids, ['m2']);
    assert.throws(() => collectCandidates(input, { stories: [story, story] }), /topic_key/);
    assert.equal(collectCandidates(input, { stories: [{ ...story, evidence_ids: ['m3'] }] }).stories[0].candidates.length, 0);
  });
  await test('unsafe redirects are never fetched and loops are bounded', async () => {
    for (const location of ['https://127.0.0.1/', 'https://safe.org:8080/', 'http://safe.org/', 'https://safe.org/?secret=1']) {
      let calls = 0;
      const result = await verifyUrl('https://safe.org/', { hop: async () => { calls++; return { status: 302, location }; } });
      assert.equal(calls, 1);
      assert.equal(result.state, 'skipped');
      assert.equal(result.attempts[0].http_status, 302);
    }
    let calls = 0;
    const result = await verifyUrl('https://safe.org/', { hop: async () => { calls++; return { status: 302, location: '/' }; } });
    assert.equal(result.reason, 'redirect_loop');
    assert.equal(calls, 1);
  });
  await test('only transient failures retry once; permanent HTTP failures do not', async () => {
    let calls = 0;
    const success = await verifyUrl('https://safe.org/', { hop: async () => ++calls === 1 ? { status: 503 } : html('UrbanGround'),
      sleep: async () => {} });
    assert.equal(calls, 2);
    assert.equal(success.page_title, 'UrbanGround');
    calls = 0;
    const failure = await verifyUrl('https://safe.org/', { hop: async () => { calls++; throw new Error('timeout'); },
      sleep: async () => {} });
    assert.equal(calls, 2);
    assert.equal(failure.state, 'failed');
    calls = 0;
    await verifyUrl('https://safe.org/', { hop: async () => { calls++; return { status: 404 }; } });
    assert.equal(calls, 1);
  });
  await test('missing titles and login/challenge/error pages are not verified', async () => {
    for (const title of ['', 'Just a moment...', 'Access Denied', 'Sign in to continue', '404 Not Found']) {
      const result = await verifyUrl('https://safe.org/', { hop: async () => html(title) });
      assert.equal(result.state, 'unverified', title);
    }
  });
  await test('title correspondence uses source and story, not URL guesses or draft titles', () => {
    const candidate = collectCandidates(input, { stories: [story] }).stories[0].candidates[0];
    const verified = { state: 'fetched', page_title: 'UrbanGround: From Local Perception to Spatial Agency' };
    assert.equal(chooseResource(candidate, 'UrbanGround', verified).resource.kind, 'paper');
    assert.equal(chooseResource(candidate, 'Other topic', verified).resource, undefined);
    assert.equal(titleCorrespondence('UnknownCoolPaper', 'unrelated text', 'UnknownCoolPaper').matched, false);
    assert.equal(titleCorrespondence('GitHub Paper Models', 'GitHub Paper Models', 'GitHub Paper Models').matched, false);
    assert.equal(titleCorrespondence('Introducing Safety Evaluation', 'Safety evaluation methods', 'Safety evaluation report').matched, false);
    assert.equal(titleCorrespondence('Evaluation of Biology', 'Biology agents', 'Biology task').matched, false);
    assert.equal(titleCorrespondence('\u4eba\u5de5\u667a\u80fd\u5b89\u5168\u76d1\u63a7', '\u4eba\u5de5\u667a\u80fd\u5b89\u5168\u76d1\u63a7', '\u5b89\u5168\u76d1\u63a7\u8ba8\u8bba').matched, true);
    assert.equal(chooseResource(candidate, 'UrbanGround', { state: 'fetched', page_title: 'UnrelatedArticle' }).resource, undefined);
  });
  await test('four workers maximum, deterministic order without timing sleeps', async () => {
    let active = 0, peak = 0;
    const waiters = [];
    const result = mapLimited([0, 1, 2, 3, 4, 5, 6, 7], async n => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => waiters.push(resolve));
      active--;
      return n;
    });
    await Promise.resolve();
    assert.equal(active, 4);
    waiters.splice(0).forEach(resolve => resolve());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(active, 4);
    waiters.splice(0).forEach(resolve => resolve());
    assert.deepEqual(await result, [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(peak, 4);
    await assert.rejects(mapLimited([], async () => {}, 5), /Concurrency/);
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') return selfTest();
  if (args.includes('--help')) {
    console.log('Usage: node scripts/package-month-resources.mjs [DIRECTORY] [--fetch] | --self-test\n' +
      'Default: offline candidates. --fetch: HTTPS GET, concurrency 4, at most one retry.\n' +
      'Writes only resources.json and resources-audit.json; does not publish or edit drafts.');
    return;
  }
  if (args.some(a => a.startsWith('--') && a !== '--fetch') ||
      args.filter(a => !a.startsWith('--')).length > 1) throw new Error('Unknown arguments; use --help');
  const directory = path.resolve(args.find(a => !a.startsWith('--')) || DEFAULT_DIRECTORY);
  const { resources, audit } = await packageResources(directory, { fetch: args.includes('--fetch') });
  await writeFile(path.join(directory, 'resources.json'), JSON.stringify(resources, null, 2) + '\n', { mode: 0o600 });
  await writeFile(path.join(directory, 'resources-audit.json'), JSON.stringify(audit, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(audit.summary, null, 2));
  if (!audit.complete_inputs) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
