// Library ingestion, enrichment, deduplication, sync from editions, and health diagnostics.
import { createHash } from 'node:crypto';
import net from 'node:net';
import {
  GROUPS,
  LINK_KINDS,
  TOPICS,
  TYPES,
  canonicalUrl,
  normalizeLibrary,
  readableStories,
  resourceKey,
} from './library.mjs';

export const BANNED_KEYWORDS = new Set([
  'ai', 'llm', 'llms', 'agent', 'agents', '人工智能', '大模型', '智能体',
]);

// Map overly generic or non-canonical terms to canonical library-keywords.json entries.
export function canonicalizeKeywords(keywords = [], aliases = {}) {
  const aliasMap = new Map();
  for (const [canonical, list] of Object.entries(aliases || {})) {
    aliasMap.set(canonical.toLowerCase(), canonical);
    for (const alias of list || []) aliasMap.set(String(alias).trim().toLowerCase(), canonical);
  }
  const seen = new Set();
  const out = [];
  const mapped = [];
  const dropped = [];
  for (const raw of keywords || []) {
    const clean = String(raw || '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean || [...clean].length > 30) {
      if (clean) dropped.push(clean);
      continue;
    }
    const low = clean.toLowerCase();
    if (BANNED_KEYWORDS.has(low)) {
      dropped.push(clean);
      continue;
    }
    const canonical = aliasMap.get(low) || clean;
    const canonLow = canonical.toLowerCase();
    if (BANNED_KEYWORDS.has(canonLow)) {
      dropped.push(clean);
      continue;
    }
    if (canonical !== clean) mapped.push({ from: clean, to: canonical });
    if (seen.has(canonLow)) continue;
    seen.add(canonLow);
    out.push(canonical);
  }
  return { keywords: out, mapped, dropped };
}

export function inferMetadataFromUrl(rawUrl) {
  const url = canonicalUrl(rawUrl);
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, '');
  const key = resourceKey(url);
  const base = { url, key, host };

  if (key.startsWith('arxiv:')) {
    const arxivId = key.slice('arxiv:'.length);
    return { ...base, type: 'paper', linkKind: 'paper', arxivId, suggestedTitle: `arXiv:${arxivId}` };
  }
  if (key.startsWith('github:')) {
    const githubRepo = key.slice('github:'.length);
    const repo = githubRepo.split('/')[1] || githubRepo;
    return { ...base, type: 'code', linkKind: 'code', githubRepo, suggestedTitle: repo };
  }
  if (host === 'github.com') {
    const parts = parsed.pathname.split('/').filter(Boolean);
    const repo = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : '';
    return { ...base, type: 'code', linkKind: 'code', ...(repo ? { githubRepo: repo, suggestedTitle: parts[1] } : {}) };
  }
  if (host === 'huggingface.co') {
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] === 'datasets' && parts.length >= 3) {
      const hfId = `${parts[1]}/${parts[2]}`;
      return { ...base, type: 'dataset', linkKind: 'data', hfId, suggestedTitle: parts[2] };
    }
    if (parts[0] === 'spaces' && parts.length >= 3) {
      const hfId = `${parts[1]}/${parts[2]}`;
      return { ...base, type: 'tool', linkKind: 'demo', hfId, suggestedTitle: parts[2] };
    }
    if (parts.length >= 2 && !['papers', 'blog', 'docs', 'models'].includes(parts[0])) {
      const hfId = `${parts[0]}/${parts[1]}`;
      return { ...base, type: 'model', linkKind: 'model', hfId, suggestedTitle: parts[1] };
    }
  }
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'bilibili.com' || host === 'b23.tv') {
    return { ...base, type: 'video', linkKind: 'video' };
  }
  if (host === 'x.com') {
    return { ...base, type: 'article', linkKind: 'post' };
  }
  return { ...base, type: 'article', linkKind: 'article' };
}

function isBlockedHost(hostname) {
  const low = hostname.toLowerCase();
  if (low === 'localhost' || low.endsWith('.localhost') || low.endsWith('.local') || low.endsWith('.internal')) return true;
  if (net.isIP(low)) {
    if (low === '::1' || low.startsWith('fe80:') || low.startsWith('fc') || low.startsWith('fd')) return true;
    const parts = low.split('.').map(Number);
    if (parts.length === 4) {
      const [a, b] = parts;
      if (a === 0 || a === 10 || a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
    }
  }
  return false;
}

const decodeEntities = str => String(str || '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/\s+/g, ' ')
  .trim();

function extractMeta(html, names) {
  for (const name of names) {
    const escName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${escName}["'][^>]+content=["']([^"']+)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escName}["']`, 'i');
    const match = html.match(re1) || html.match(re2);
    if (match?.[1]) return decodeEntities(match[1]);
  }
  return '';
}

export async function fetchUrlMetadata(rawUrl, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  let inferred;
  try {
    inferred = inferMetadataFromUrl(rawUrl);
  } catch (error) {
    return { ok: false, error: error.message, inferred: null };
  }
  const parsed = new URL(inferred.url);
  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, error: `Blocked private or local host: ${parsed.hostname}`, inferred };
  }
  try {
    if (inferred.arxivId) {
      const res = await fetchImpl(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(inferred.arxivId)}`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'AgentHub-Library/1.0' },
      });
      if (!res.ok) return { ok: false, error: `arXiv HTTP ${res.status}`, inferred };
      const xml = await res.text();
      const entryXml = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1] || '';
      const title = decodeEntities(entryXml.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
      const description = decodeEntities(entryXml.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] || '');
      if (!title) return { ok: false, error: 'arXiv entry not found', inferred };
      return { ok: true, title, description, extraLinks: [], tags: ['arXiv'], inferred };
    }
    if (inferred.githubRepo && inferred.key.startsWith('github:')) {
      const res = await fetchImpl(`https://api.github.com/repos/${inferred.githubRepo}`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AgentHub-Library/1.0' },
      });
      if (!res.ok) return { ok: false, error: `GitHub HTTP ${res.status}`, inferred };
      const repo = await res.json();
      const extraLinks = [];
      if (repo.homepage && /^https?:\/\//i.test(repo.homepage)) {
        try {
          const homeUrl = canonicalUrl(repo.homepage);
          if (resourceKey(homeUrl) !== inferred.key) extraLinks.push({ kind: 'project', url: homeUrl });
        } catch { /* ignore invalid homepage */ }
      }
      return {
        ok: true,
        title: repo.name || inferred.suggestedTitle,
        description: String(repo.description || '').trim(),
        extraLinks,
        tags: Array.isArray(repo.topics) ? repo.topics : [],
        stars: repo.stargazers_count ?? null,
        inferred,
      };
    }
    const res = await fetchImpl(inferred.url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'AgentHub-Library/1.0' },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, inferred };
    const text = (await res.text()).slice(0, 512 * 1024);
    const title = extractMeta(text, ['og:title', 'twitter:title'])
      || decodeEntities(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    const description = extractMeta(text, ['og:description', 'twitter:description', 'description']);
    return { ok: true, title: title || inferred.host, description, extraLinks: [], tags: [], inferred };
  } catch (error) {
    return { ok: false, error: error.message || 'Fetch failed', inferred };
  }
}

const TOPIC_RULES = [
  ['coding-agents', ['coding', 'swe', 'code', 'claude code', 'codex', 'harness', 'scaffold', 'mcp', 'skill', 'skills', 'cli', 'terminal', 'repo', '编程', '代码', '脚手架']],
  ['computer-use', ['computer use', 'computer-use', 'gui', 'osworld', 'browser', 'desktop', 'android', 'phone', 'grounding', '桌面', '手机', '浏览器']],
  ['training', ['rl', 'rlvr', 'grpo', 'ppo', 'sft', 'post-training', 'training', 'reward', 'distillation', 'verl', '强化学习', '训练', '微调', '蒸馏', '奖励']],
  ['data-environments', ['dataset', 'environment', 'env', 'sandbox', 'trajectory', 'synthetic', 'data synthesis', '数据集', '沙箱', '环境', '合成数据', '轨迹']],
  ['evaluation', ['benchmark', 'eval', 'evaluation', 'leaderboard', 'judge', 'rubric', '评测', '基准', '榜单']],
  ['research-agents', ['deep research', 'research agent', 'scientist', 'rsi', 'self-improv', 'self-evolv', 'math', 'lean', 'theorem', '科研', '数学', '自我改进']],
  ['memory', ['memory', 'context', 'long-horizon', 'long horizon', 'state', '记忆', '上下文', '长程']],
  ['multi-agent', ['multi-agent', 'multiagent', 'swarm', 'collaboration', 'orchestrat', '多智能体', '协作', '集群']],
  ['safety', ['safety', 'alignment', 'prompt injection', 'red team', 'monitor', 'security', 'privacy', '安全', '对齐', '注入', '隐私']],
  ['models', ['model', 'release', 'technical report', 'qwen', 'deepseek', 'claude', 'gpt', 'gemini', 'open-weight', 'moe', '模型', '技术报告']],
  ['multimodal-embodied', ['vlm', 'vla', 'robot', 'embodied', 'world model', 'multimodal', 'vision', '3d', 'spatial', '具身', '机器人', '世界模型', '多模态']],
  ['systems', ['kernel', 'gpu', 'inference', 'serving', 'kv cache', 'mlsys', 'latency', 'cost', 'npu', 'ascend', '推理', '算子', '系统', '成本']],
  ['research-tools', ['paper', 'figure', 'diagram', 'writing', 'latex', 'review', 'search', 'literature', '论文', '作图', '绘图', '写作', '检索']],
  ['industry', ['industry', 'trend', 'interview', 'essay', 'opinion', 'pricing', '行业', '观点', '访谈', '趋势', '定价']],
];

export function suggestTopicsAndKeywords(text, { aliases = {}, existingItems = [], strict = false } = {}) {
  const low = String(text || '').toLowerCase();
  const topicScores = [];
  for (const [topic, terms] of TOPIC_RULES) {
    let score = 0;
    for (const term of terms) {
      if (low.includes(term)) score += term.length > 4 ? 2 : 1;
    }
    if (score > 0) topicScores.push([topic, score]);
  }
  topicScores.sort((a, b) => b[1] - a[1]);
  const topics = topicScores.slice(0, 3).map(([t]) => t);
  if (!topics.length && !strict) topics.push('coding-agents');

  const matchedKeywords = [];
  const seen = new Set();
  const addKw = kw => {
    const k = kw.toLowerCase();
    if (!BANNED_KEYWORDS.has(k) && !seen.has(k)) {
      seen.add(k);
      matchedKeywords.push(kw);
    }
  };
  for (const [canonical, list] of Object.entries(aliases || {})) {
    const candidates = [canonical, ...(list || [])];
    for (const cand of candidates) {
      const cLow = String(cand).toLowerCase();
      if (cLow.length >= 2 && low.includes(cLow)) {
        addKw(canonical);
        break;
      }
    }
  }
  const freq = new Map();
  for (const item of existingItems || []) {
    for (const kw of item.keywords || []) freq.set(kw, (freq.get(kw) || 0) + 1);
  }
  for (const [kw] of [...freq].sort((a, b) => b[1] - a[1])) {
    if (matchedKeywords.length >= 8) break;
    if (kw.length >= 3 && low.includes(kw.toLowerCase())) addKw(kw);
  }
  return { topics, keywords: matchedKeywords.slice(0, 8) };
}

const words = value => String(value || '').normalize('NFKD').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const opaque = /^(?:mp\.weixin\.qq\.com|(?:www\.|zhuanlan\.)?zhihu\.com|x\.com|(?:www\.)?bilibili\.com|b23\.tv)$/;

export function generateSlug(item, existingIds = new Set()) {
  const title = item.title || '';
  const head = /[:：]/.test(title) ? words(title.split(/[:：]/)[0]) : [];
  let parts = head.join('').length >= 3 ? head : words(title);
  while (/^\d+$/.test(parts[0] || '')) parts.shift();
  if (parts.join('').length < (parts === head ? 3 : 6)) {
    const primaryUrl = item.links?.[0]?.url || '';
    const key = primaryUrl ? resourceKey(primaryUrl) : '';
    const host = primaryUrl ? new URL(primaryUrl).hostname : '';
    if (key.startsWith('arxiv:')) parts = ['arxiv', ...words(key.slice(6))];
    else if (key.startsWith('github:')) parts = words(key.split('/')[1]);
    else if (host && !opaque.test(host)) parts = words(`${host.replace(/^www\./, '')} ${new URL(primaryUrl).pathname}`);
    else parts = [item.type || 'item', createHash('sha256').update(key || title).digest('hex').slice(0, 8)];
  }
  let base = '';
  for (const part of parts) {
    if (base && base.length + part.length + 1 > 40) break;
    base = base ? `${base}-${part}` : part.slice(0, 40);
  }
  if (!base) base = `${item.type || 'item'}-entry`;
  let id = base;
  for (let n = 2; existingIds.has(id); n++) id = `${base}-${n}`;
  return id;
}

export function upsertLibraryItem(library, draft, { merge = true, aliases = {}, today = new Date().toISOString().slice(0, 10) } = {}) {
  const warnings = [];
  const cloned = {
    version: 1,
    through: library.through || today,
    items: structuredClone(library.items || []),
  };
  const rawLinks = (draft.links?.length ? draft.links : draft.url ? [{ kind: draft.linkKind || inferMetadataFromUrl(draft.url).linkKind, url: draft.url }] : []);
  if (!rawLinks.length) throw new Error('Draft must include at least one link or url');
  const links = rawLinks.map(l => ({ kind: l.kind, url: canonicalUrl(l.url) }));
  const draftAliases = (draft.aliases || []).map(canonicalUrl);
  const { keywords, mapped, dropped } = canonicalizeKeywords(draft.keywords || [], aliases);
  if (mapped.length) warnings.push(`Mapped keywords: ${mapped.map(m => `${m.from}->${m.to}`).join(', ')}`);
  if (dropped.length) warnings.push(`Dropped invalid/generic keywords: ${dropped.join(', ')}`);

  const keyIndex = new Map();
  for (const existing of cloned.items) {
    for (const url of [...existing.links.map(l => l.url), ...(existing.aliases || [])]) {
      keyIndex.set(resourceKey(url), existing);
    }
  }
  const candidateKeys = [...links.map(l => l.url), ...draftAliases].map(resourceKey);
  const match = candidateKeys.map(k => keyIndex.get(k)).find(Boolean);

  const shareDate = draft.date || today;
  const shareGroup = draft.group || 'group-3';
  const incomingShares = draft.shares?.length ? draft.shares : [{ date: shareDate, group: shareGroup, avatar: null }];

  let resultItem;
  let action;
  if (match) {
    if (!merge) throw new Error(`Duplicate resource already exists: ${match.id} (${match.title})`);
    action = 'merged';
    const existingLinkKeys = new Set(match.links.map(l => resourceKey(l.url)));
    for (const link of links) {
      if (!existingLinkKeys.has(resourceKey(link.url))) {
        match.links.push(link);
        existingLinkKeys.add(resourceKey(link.url));
      }
    }
    const mergedAliases = new Set([...(match.aliases || []), ...draftAliases]);
    match.aliases = [...mergedAliases].filter(u => !existingLinkKeys.has(resourceKey(u)));
    if (!match.aliases.length) delete match.aliases;

    const shareMap = new Map(match.shares.map(s => [`${s.date}/${s.group}/${s.avatar || ''}`, s]));
    for (const s of incomingShares) {
      const k = `${s.date}/${s.group}/${s.avatar || ''}`;
      if (!shareMap.has(k)) shareMap.set(k, { date: s.date, group: s.group, avatar: s.avatar ?? null });
    }
    match.shares = [...shareMap.values()].sort((a, b) => a.date.localeCompare(b.date) || a.group.localeCompare(b.group));

    if (keywords.length) {
      const kwSet = new Set(match.keywords.map(k => k.toLowerCase()));
      for (const kw of keywords) {
        if (match.keywords.length >= 12) break;
        if (!kwSet.has(kw.toLowerCase())) {
          match.keywords.push(kw);
          kwSet.add(kw.toLowerCase());
        }
      }
    }
    if (draft.overwriteText) {
      if (draft.title) match.title = draft.title.trim();
      if (draft.summary) match.summary = draft.summary.trim();
    }
    resultItem = match;
  } else {
    action = 'added';
    const existingIds = new Set(cloned.items.map(i => i.id));
    const id = draft.id && !existingIds.has(draft.id) ? draft.id : generateSlug({ ...draft, links }, existingIds);
    const finalKeywords = keywords.length >= 3 ? keywords.slice(0, 12) : [...keywords, ...['AI Agent', '工具'].filter(x => !keywords.includes(x))].slice(0, 12);
    if (finalKeywords.length < 3) throw new Error(`Need at least 3 valid keywords for ${id}`);
    resultItem = {
      id,
      title: String(draft.title || '').trim(),
      summary: String(draft.summary || '').trim(),
      type: draft.type || inferMetadataFromUrl(links[0].url).type,
      topics: (draft.topics?.length ? draft.topics : ['coding-agents']).slice(0, 3),
      keywords: finalKeywords,
      links,
      ...(draftAliases.length ? { aliases: [...new Set(draftAliases)] } : {}),
      shares: incomingShares.map(s => ({ date: s.date, group: s.group, avatar: s.avatar ?? null })),
    };
    cloned.items.push(resultItem);
  }

  for (const s of resultItem.shares) {
    if (s.date > cloned.through) cloned.through = s.date;
  }
  const firstOf = it => it.shares.map(s => s.date).sort()[0];
  cloned.items.sort((a, b) => firstOf(b).localeCompare(firstOf(a)) || a.id.localeCompare(b.id));
  normalizeLibrary({ ...cloned, aliases });
  return { library: cloned, action, item: resultItem, warnings };
}

const EXCLUDE_PATTERNS = [
  /^https:\/\/(?:agent-hub-community|hqhq1025)\.github\.io\//,
  /^https:\/\/(?:www\.)?(?:xiaohongshu\.com|xhslink\.c(?:om|n))\//,
  /^https:\/\/(?:meet\.google\.com|(?:[\w-]+\.)?zoom\.us|meeting\.tencent\.com|vc\.feishu\.cn)\//,
  /^https:\/\/(?:forms\.gle|docs\.google\.com\/forms|wj\.qq\.com|(?:[\w-]+\.)?jinshuju\.(?:net|com))\//,
  /\.(?:png|jpe?g|gif|webp|mp4|mov)$/i,
];

export function syncFromEditions(editions = [], weeklies = [], library = { items: [] }, { linkPreviews = {}, aliases = {}, since = '' } = {}) {
  const indexedKeys = new Set();
  for (const item of library.items || []) {
    for (const link of item.links || []) {
      try { indexedKeys.add(resourceKey(link.url)); } catch { /* ignore */ }
    }
    for (const alias of item.aliases || []) {
      try { indexedKeys.add(resourceKey(alias)); } catch { /* ignore */ }
    }
  }
  const candidates = new Map();
  const collect = (issue, isWeekly) => {
    const issueDate = isWeekly ? (issue.end || issue.through) : issue.date;
    if (since && issueDate < since) return;
    for (const page of issue.pages || []) {
      if (!GROUPS[page.id]) continue;
      for (const story of readableStories(page)) {
        for (const res of story.resources || []) {
          let url, key;
          try {
            url = canonicalUrl(res.url);
            key = resourceKey(url);
          } catch { continue; }
          if (indexedKeys.has(key) || EXCLUDE_PATTERNS.some(re => re.test(url))) continue;
          if (!candidates.has(key)) {
            const inferred = inferMetadataFromUrl(url);
            const preview = linkPreviews[res.url] || linkPreviews[url] || null;
            candidates.set(key, {
              key,
              url,
              inferred,
              preview,
              stories: [],
              shares: new Map(),
            });
          }
          const cand = candidates.get(key);
          cand.stories.push({
            kind: isWeekly ? 'weekly' : 'daily',
            date: issueDate,
            group: page.id,
            storyTitle: story.title,
            storyExcerpt: story.text.slice(0, 140),
            label: res.label || '',
            linkKind: res.kind || cand.inferred.linkKind,
          });
          cand.shares.set(`${issueDate}/${page.id}`, { date: issueDate, group: page.id, avatar: null });
        }
      }
    }
  };
  for (const issue of editions) collect(issue, false);
  for (const issue of weeklies) collect(issue, true);

  return [...candidates.values()].map(cand => {
    const title = cand.preview?.title || cand.stories[0]?.label || cand.inferred.suggestedTitle || cand.inferred.host;
    const summaryHint = cand.preview?.description || cand.stories[0]?.storyExcerpt || '';
    const { topics, keywords } = suggestTopicsAndKeywords(
      `${title} ${summaryHint} ${cand.stories.map(s => s.storyTitle).join(' ')}`,
      { aliases, existingItems: library.items },
    );
    const shares = [...cand.shares.values()].sort((a, b) => a.date.localeCompare(b.date));
    return {
      key: cand.key,
      url: cand.url,
      inferred: cand.inferred,
      preview: cand.preview,
      suggestedTopics: topics,
      suggestedKeywords: keywords,
      stories: cand.stories,
      shares,
      draft: {
        title: title.slice(0, 100),
        summary: summaryHint.slice(0, 160),
        type: cand.inferred.type,
        topics,
        keywords: keywords.length >= 3 ? keywords : [...keywords, ...topics.map(t => TOPICS[t]?.label || t)].slice(0, 5),
        links: [{ kind: cand.stories[0]?.linkKind || cand.inferred.linkKind, url: cand.url }],
        shares,
      },
    };
  }).sort((a, b) => b.shares[0].date.localeCompare(a.shares[0].date) || a.key.localeCompare(b.key));
}

export function parseSubmissionIssue(input) {
  if (typeof input === 'object' && input !== null) return input;
  const raw = String(input || '').trim();
  if (raw.startsWith('{')) return JSON.parse(raw);

  const sections = new Map();
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    const heading = line.match(/^###\s+(.+)$/);
    if (heading) {
      current = heading[1].trim();
      sections.set(current, []);
    } else if (current) {
      sections.get(current).push(line);
    }
  }
  const get = (...names) => {
    for (const name of names) {
      for (const [k, lines] of sections) {
        if (k.toLowerCase().includes(name.toLowerCase())) {
          const val = lines.join('\n').trim();
          if (val && val !== '_No response_') return val;
        }
      }
    }
    return '';
  };
  const url = get('主链接', 'URL', 'Primary URL');
  const title = get('标题', 'Title');
  const summary = get('简介', 'Summary');
  const typeRaw = get('类型', 'Type').split(/\s+/)[0].toLowerCase();
  const topicsRaw = get('主题', 'Topics')
    .split(/[\n,，、]+/)
    .map(s => s.replace(/^-\s*\[[xX ]\]\s*/, '').trim().split(/\s+/)[0])
    .filter(t => TOPICS[t]);
  const keywords = get('关键词', 'Keywords')
    .split(/[,，、\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const extraRaw = get('补充链接', 'Extra');
  const extraLinks = [];
  for (const line of extraRaw.split(/\r?\n/)) {
    const m = line.match(/^(?:([a-z]+)\s*[:=]\s*)?(https?:\/\/\S+)$/i);
    if (m) extraLinks.push({ kind: LINK_KINDS[m[1]] ? m[1] : inferMetadataFromUrl(m[2]).linkKind, url: canonicalUrl(m[2]) });
  }
  const group = get('来源群', 'Group').split(/\s+/)[0];
  const date = get('分享日期', 'Date');
  const inferred = url ? inferMetadataFromUrl(url) : { type: 'article', linkKind: 'article' };
  return {
    title,
    summary,
    type: TYPES[typeRaw] ? typeRaw : inferred.type,
    topics: topicsRaw.length ? topicsRaw.slice(0, 3) : ['coding-agents'],
    keywords,
    links: url ? [{ kind: inferred.linkKind, url: canonicalUrl(url) }, ...extraLinks] : extraLinks,
    ...(GROUPS[group] ? { group } : {}),
    ...(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {}),
  };
}

export function diagnoseLibrary(library, editions = [], weeklies = [], { aliases = {}, linkPreviews = {} } = {}) {
  const items = library.items || [];
  const editionDates = editions.map(e => e.date).sort();
  const latestEditionDate = editionDates.at(-1) || library.through;
  const coverageGapDays = Math.max(0, Math.round((Date.parse(latestEditionDate) - Date.parse(library.through)) / 86400e3));

  const unindexed = syncFromEditions(editions, weeklies, library, { linkPreviews, aliases });
  const kwCounts = new Map();
  const uncanonicalized = [];
  const aliasLookup = new Map();
  for (const [canon, list] of Object.entries(aliases || {})) {
    for (const a of list || []) aliasLookup.set(String(a).toLowerCase(), canon);
  }
  for (const item of items) {
    for (const kw of item.keywords || []) {
      kwCounts.set(kw, (kwCounts.get(kw) || 0) + 1);
      if (aliasLookup.has(kw.toLowerCase())) {
        uncanonicalized.push({ itemId: item.id, keyword: kw, canonical: aliasLookup.get(kw.toLowerCase()) });
      }
    }
  }
  const kwList = [...kwCounts.entries()].sort((a, b) => b[1] - a[1]);
  const singleUse = kwList.filter(([, c]) => c === 1).length;
  const nearDuplicateKeywords = [];
  const normKw = k => k.toLowerCase().replace(/[-_\s]+/g, '').replace(/s$/, '');
  const buckets = new Map();
  for (const [kw] of kwList) {
    const n = normKw(kw);
    if (!buckets.has(n)) buckets.set(n, []);
    buckets.get(n).push(kw);
  }
  for (const group of buckets.values()) {
    if (group.length > 1) nearDuplicateKeywords.push(group);
  }

  const normalized = normalizeLibrary({ version: 1, through: library.through, items, aliases }, editions, weeklies);
  const itemsWithDiscussions = normalized.items.filter(i => i.discussions.length > 0).length;
  const multiGroupItems = normalized.items.filter(i => new Set(i.shares.map(s => s.group)).size > 1).length;
  const multiLinkItems = normalized.items.filter(i => i.links.length > 1).length;
  const itemsMissingCodeOrPaper = normalized.items.filter(i => i.type === 'paper' && !i.links.some(l => l.kind === 'code')).length;

  return {
    totalItems: items.length,
    through: library.through,
    latestEditionDate,
    coverageGapDays,
    unindexedEditionResources: {
      count: unindexed.length,
      examples: unindexed.slice(0, 10).map(c => ({ url: c.url, date: c.shares[0]?.date, title: c.draft.title })),
    },
    keywordStats: {
      unique: kwList.length,
      singleUse,
      singleUseRatio: kwList.length ? Number((singleUse / kwList.length).toFixed(3)) : 0,
      topKeywords: kwList.slice(0, 15),
      uncanonicalized,
    },
    nearDuplicateKeywords: nearDuplicateKeywords.slice(0, 20),
    itemsWithDiscussions,
    multiGroupItems,
    multiLinkItems,
    itemsMissingCodeOrPaper,
  };
}
