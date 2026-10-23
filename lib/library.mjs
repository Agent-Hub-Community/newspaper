// The reviewed library (library.json) and everything derived from it: URL identity, validation,
// links back to daily and weekly stories, and the machine-readable copies for agents.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { contentRevision, topicId, topicReadPath } from './agent-content-id.mjs';
import { readingBase } from './agent-reading.mjs';
import { site } from './site.mjs';

export const libraryUrl = `${site}library/`;

// Type says what a resource is; topics say what it is about, so their labels must not repeat each other.
export const TYPES = {
  paper: '论文', benchmark: 'Benchmark', dataset: '数据集', code: '开源项目', model: '模型',
  tool: '工具与产品', article: '文章与帖子', video: '视频',
};
export const TOPICS = {
  'coding-agents': { label: '编程 Agent 与 Harness', covers: '编程 agent、harness、scaffold、skills、MCP、工具调用、SWE 任务' },
  'computer-use': { label: 'Computer Use 与 GUI', covers: '桌面、手机、浏览器和 GUI agent，grounding，OS 环境' },
  training: { label: '强化学习与训练', covers: 'agentic RL、post-training、训练框架、credit assignment、reward、数据配方' },
  'data-environments': { label: '数据与环境', covers: '数据合成、环境构建与规模化、sandbox、轨迹数据' },
  evaluation: { label: '评测', covers: 'benchmark、榜单、评测方法、judge' },
  'research-agents': { label: '科研 Agent 与自我改进', covers: 'deep research、AI scientist、AI 做数学和科学、递归自我改进（RSI）' },
  memory: { label: '记忆与长程任务', covers: 'agent memory、上下文管理、长程任务' },
  'multi-agent': { label: '多智能体', covers: '多 agent 协作、agent 集群、群聊 agent' },
  safety: { label: '安全与对齐', covers: '安全、对齐、可监控性、提示注入、red teaming' },
  models: { label: '模型与技术报告', covers: '前沿和开源模型发布、技术报告、能力分析' },
  'multimodal-embodied': { label: '多模态、具身与世界模型', covers: 'VLM、统一多模态、机器人、具身、世界模型、空间智能' },
  systems: { label: '系统与基础设施', covers: '推理与训练系统、GPU 与 kernel、MLSys、成本' },
  'research-tools': { label: '科研工具与写作', covers: '读论文、找论文、作图、写作、审稿、学术数据工具' },
  industry: { label: '行业与观点', covers: '行业分析、趋势判断、访谈、长篇观点' },
};
export const LINK_KINDS = {
  paper: '论文', code: '代码', project: '主页', data: '数据', model: '模型', leaderboard: '榜单',
  demo: '演示', docs: '文档', article: '文章', post: '帖子', video: '视频',
};
export const GROUPS = { 'group-1': '一群', 'group-2': '二群', 'group-3': '三群', 'group-4': '四群' };

// Daily pages number their topics after dropping stories without text (digest.js); anchors must count the same way.
export const readableStories = page => (page.stories || []).filter(story => typeof story.text === 'string' && story.text.trim());

// Query keys that only describe how a link was shared, never which page it is.
const tracking = /^(?:utm_.*|spm|from|share.*|xsec_.*|app_.*|track.*|scene|subscene|clicktime|enterid|ascene|devicetype|nettype|lang|exportkey|pass_ticket|wx_header|sessionid|ref|ref_src|fbclid|gclid|si|srcid|vd_source|xhsshare|apptime|author_share)$/i;

export function canonicalUrl(raw) {
  const url = new URL(String(raw).trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported library URL');
  url.hostname = url.hostname.toLowerCase();
  if (/^(?:mobile\.|www\.)?twitter\.com$|^(?:mobile\.|www\.)x\.com$/.test(url.hostname)) url.hostname = 'x.com';
  for (const key of [...url.searchParams.keys()]) if (tracking.test(key)) url.searchParams.delete(key);
  if (url.hostname === 'x.com') { url.searchParams.delete('s'); url.searchParams.delete('t'); }
  const arxiv = arxivId(url);
  if (arxiv) return `https://arxiv.org/abs/${arxiv}`;
  url.hash = '';
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '').replace(/\.git$/, '');
  url.protocol = 'https:';
  return url.href;
}

function arxivId(url) {
  const host = url.hostname.replace(/^www\./, '');
  if (!['arxiv.org', 'alphaxiv.org'].includes(host)) return null;
  return url.pathname.match(/^\/(?:abs|pdf|html|overview)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?\/?$/)?.[1] || null;
}

// Two URLs share a key when they name the same work: an arXiv paper on any mirror, or a GitHub repository root.
export function resourceKey(raw) {
  const url = new URL(canonicalUrl(raw));
  // WeChat articles open more reliably with chksm, but it is a checksum, not part of the article's identity.
  if (url.hostname === 'mp.weixin.qq.com') url.searchParams.delete('chksm');
  // A repository page opened on a README or license tab is still the repository.
  if (url.hostname === 'github.com' && /-ov-file$/.test(url.searchParams.get('tab') || '')) url.searchParams.delete('tab');
  // Sorting also re-encodes the query, so the same parameters always give the same key.
  url.searchParams.sort();
  const arxiv = arxivId(url) || (url.hostname === 'huggingface.co' && url.pathname.match(/^\/papers\/(\d{4}\.\d{4,5})$/)?.[1]);
  if (arxiv) return `arxiv:${arxiv}`;
  if (url.hostname === 'github.com') {
    const [owner, repo, kind, , ...rest] = url.pathname.split('/').slice(1);
    if (owner && repo && !url.search && (!kind || kind === 'tree' && !rest.length || kind === 'blob' && /^readme(?:\.md)?$/i.test(rest.join('/')))) {
      return `github:${owner.toLowerCase()}/${repo.toLowerCase()}`;
    }
  }
  return url.href.replace(/\/$/, '');
}

export async function readLibrary(dir) {
  const library = JSON.parse(await readFile(path.join(dir, 'library.json'), 'utf8'));
  const aliases = JSON.parse(await readFile(path.join(dir, 'library-keywords.json'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '{}';
    throw error;
  }));
  return { ...library, aliases };
}

const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const only = (value, allowed, what) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid library ${what}`);
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  if (extra.length) throw new Error(`Unexpected library ${what} field: ${extra.join(', ')}`);
};
const text = (value, max, what) => {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || [...value].length > max) throw new Error(`Invalid library ${what}`);
};

// Attach both daily and weekly topics that cite each work; source URLs determine the association.
export function normalizeLibrary(library, editions = [], weeklies = []) {
  only(library, ['version', 'through', 'items', 'aliases'], 'file');
  if (library.version !== 1 || !date(library.through) || !Array.isArray(library.items)) throw new Error('Invalid library file');
  // Aliases map other spellings to one canonical keyword; items must use the canonical form.
  const aliases = library.aliases || {};
  const aliasOf = new Map();
  for (const [keyword, list] of Object.entries(aliases)) {
    if (!Array.isArray(list)) throw new Error(`Invalid aliases for ${keyword}`);
    for (const alias of list) {
      const key = String(alias).toLowerCase();
      if (!alias || alias !== alias.trim() || aliasOf.has(key) || Object.keys(aliases).some(other => other.toLowerCase() === key)) {
        throw new Error(`Alias "${alias}" is empty, repeated or a canonical keyword`);
      }
      aliasOf.set(key, keyword);
    }
  }
  const stories = new Map();
  for (const issue of editions) for (const page of issue.pages || []) readableStories(page).forEach((story, index) => {
    for (const resource of story.resources || []) {
      let key;
      try { key = resourceKey(resource.url); } catch { continue; }
      if (!stories.has(key)) stories.set(key, []);
      const id = topicId('daily', issue, page, story);
      stories.get(key).push({ kind: 'daily', id, read_path: topicReadPath(id), date: issue.date, group: page.id, title: story.title, anchor: `topic-${index + 1}` });
    }
  });
  for (const issue of weeklies) for (const page of issue.pages || []) readableStories(page).forEach((story, index) => {
    for (const resource of story.resources || []) {
      let key;
      try { key = resourceKey(resource.url); } catch { continue; }
      if (!stories.has(key)) stories.set(key, []);
      const id = topicId('weekly', issue, page, story);
      stories.get(key).push({ kind: 'weekly', id, read_path: topicReadPath(id), from: issue.start || issue.from,
        date: issue.end || issue.through, group: page.id, title: story.title, anchor: `topic-${index + 1}` });
    }
  });
  const ids = new Set(), keys = new Map();
  const items = library.items.map(item => {
    only(item, ['id', 'title', 'summary', 'type', 'topics', 'keywords', 'links', 'aliases', 'shares'], 'item');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) || item.id.length > 64 || ids.has(item.id)) throw new Error(`Invalid or duplicate library id: ${item.id}`);
    ids.add(item.id);
    text(item.title, 100, `title for ${item.id}`);
    text(item.summary, 160, `summary for ${item.id}`);
    if (!TYPES[item.type]) throw new Error(`Invalid library type for ${item.id}`);
    if (!Array.isArray(item.topics) || item.topics.length < 1 || item.topics.length > 3 ||
        new Set(item.topics).size !== item.topics.length || item.topics.some(topic => !TOPICS[topic])) {
      throw new Error(`Invalid library topics for ${item.id}`);
    }
    // Keywords become filter values joined with "|" in the page, so that character is reserved.
    if (!Array.isArray(item.keywords) || item.keywords.length < 3 || item.keywords.length > 12 ||
        new Set(item.keywords.map(keyword => keyword.toLowerCase())).size !== item.keywords.length ||
        item.keywords.some(keyword => typeof keyword !== 'string' || keyword !== keyword.trim() || !keyword || [...keyword].length > 30 || keyword.includes('|'))) {
      throw new Error(`Invalid library keywords for ${item.id}`);
    }
    for (const keyword of item.keywords) {
      if (aliasOf.has(keyword.toLowerCase())) throw new Error(`Library item ${item.id} uses alias "${keyword}"; write "${aliasOf.get(keyword.toLowerCase())}"`);
    }
    if (!Array.isArray(item.links) || !item.links.length) throw new Error(`Library item ${item.id} has no links`);
    const urls = [...item.links.map(link => {
      only(link, ['kind', 'url'], 'link');
      if (!LINK_KINDS[link.kind] || canonicalUrl(link.url) !== link.url || !link.url.startsWith('https://')) {
        throw new Error(`Invalid library link for ${item.id}: ${link.url}`);
      }
      return link.url;
    }), ...(item.aliases || []).map(url => {
      if (typeof url !== 'string' || canonicalUrl(url) !== url) throw new Error(`Invalid library alias for ${item.id}`);
      return url;
    })];
    for (const key of new Set(urls.map(resourceKey))) {
      if (keys.has(key)) throw new Error(`Library items ${keys.get(key)} and ${item.id} share ${key}`);
      keys.set(key, item.id);
    }
    if (!Array.isArray(item.shares) || !item.shares.length) throw new Error(`Library item ${item.id} has no shares`);
    for (const share of item.shares) {
      only(share, ['date', 'group', 'avatar'], 'share');
      if (!date(share.date) || share.date > library.through || !GROUPS[share.group] ||
          !(share.avatar === null || /^[a-f0-9]{16}\.(?:jpg|png)$/.test(share.avatar))) {
        throw new Error(`Invalid library share for ${item.id}`);
      }
    }
    const shares = [...item.shares].sort((a, b) => a.date.localeCompare(b.date) || a.group.localeCompare(b.group));
    const discussions = [...new Map([...new Set(urls.map(resourceKey))].flatMap(key => stories.get(key) || [])
      .map(story => [story.id, story])).values()]
      .sort((a, b) => b.date.localeCompare(a.date) || a.group.localeCompare(b.group));
    return { ...item, aliases: item.aliases || [], shares, first: shares[0].date, discussions };
  });
  items.sort((a, b) => b.first.localeCompare(a.first) || a.title.localeCompare(b.title, 'zh-CN'));
  // Related items share the most keywords and topics (Jaccard), newest first on ties; computed, never edited.
  const terms = new Map(items.map(item => [item, new Set([...item.keywords.map(keyword => `k:${keyword}`), ...item.topics.map(topic => `t:${topic}`)])]));
  for (const item of items) {
    const own = terms.get(item);
    item.related = items.filter(other => other !== item).map(other => {
      const theirs = terms.get(other);
      const shared = [...own].filter(term => theirs.has(term));
      return { id: other.id, score: shared.some(term => term.startsWith('k:')) ? shared.length / new Set([...own, ...theirs]).size : 0 };
    }).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(entry => entry.id);
  }
  const first = items.map(item => item.first).sort()[0] || library.through;
  return { through: library.through, first, items, aliases };
}

export const discussionUrl = story => story.kind === 'weekly'
  ? `${site}weekly/${story.from}/${story.date}/${story.group}/#${story.anchor}`
  : `${site}daily/${story.date}/${story.group}/#${story.anchor}`;

export function keywordCounts(library) {
  const counts = new Map();
  for (const keyword of library.items.flatMap(item => item.keywords)) counts.set(keyword, (counts.get(keyword) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
    .map(([keyword, count]) => ({ keyword, count, ...(library.aliases?.[keyword]?.length ? { aliases: library.aliases[keyword] } : {}) }));
}

// The agent copy carries the same facts as the page, minus sharer avatars.
export function libraryJson(library, { vocabulary = library.vocabulary || { expand: {}, groups: [] } } = {}) {
  const result = {
    $schema: `${libraryUrl}resources.schema.json`,
    name: 'AgentHub 资料库',
    description: 'AgentHub 微信群（一群到四群）分享过的 AI Agent 论文、代码、数据集、评测、模型、工具和文章，按主题和类型整理。同一资料在多个群出现只记一条。',
    page: libraryUrl,
    markdown: `${libraryUrl}resources.md`,
    skill: `${site}agents/SKILL.md`,
    coverage: { from: library.first, through: library.through },
    count: library.items.length,
    types: Object.entries(TYPES).map(([id, label]) => ({ id, label })),
    topics: Object.entries(TOPICS).map(([id, topic]) => ({ id, label: topic.label, covers: topic.covers })),
    groups: Object.entries(GROUPS).map(([id, label]) => ({ id, label })),
    keywords: keywordCounts(library),
    vocabulary,
    items: library.items.map(item => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      type: item.type,
      topics: item.topics,
      keywords: item.keywords,
      links: item.links,
      shared: [...new Map(item.shares.map(share => [`${share.date}/${share.group}`, { date: share.date, group: share.group }])).values()],
      discussions: item.discussions.map(story => ({ kind: story.kind || 'daily', id: story.id, date: story.date,
        ...(story.from ? { from: story.from } : {}), group: story.group, title: story.title, url: discussionUrl(story),
        read_path: story.read_path, read_url: readingBase + story.read_path.replace(/\.json$/, '.md'),
        detail_url: readingBase + story.read_path })),
      related: item.related,
      url: `${libraryUrl}#${item.id}`,
    })),
  };
  return { ...result, revision: contentRevision(result) };
}

export const md = value => String(value).replace(/([\\`*_[\]<>|])/g, '\\$1');
const groupList = item => [...new Set(item.shares.map(share => GROUPS[share.group]))].join('、');

export function libraryMarkdown(library) {
  const lines = [
    '# AgentHub 资料库', '',
    `> AgentHub 微信群分享过的 ${library.items.length} 项 AI Agent 资料，按主题分组。收录 ${library.first} 至 ${library.through} 的分享。同一资料在多个群出现只记一条，每条只列在它的第一个主题下。`,
    `> 网页：${libraryUrl}　JSON：${libraryUrl}resources.json`, '',
  ];
  for (const [id, topic] of Object.entries(TOPICS)) {
    const items = library.items.filter(item => item.topics[0] === id);
    if (!items.length) continue;
    lines.push(`## ${topic.label}（${items.length}）`, '', `覆盖：${topic.covers}`, '');
    for (const item of items) {
      const [primary, ...rest] = item.links;
      lines.push(`- [${md(item.title)}](${primary.url}) · ${TYPES[item.type]} · ${item.first} · ${groupList(item)}`);
      lines.push(`  ${md(item.summary)}`);
      lines.push(`  关键词：${item.keywords.map(md).join('、')}`);
      const more = [...rest.map(link => `[${LINK_KINDS[link.kind]}](${link.url})`),
        ...item.discussions.slice(0, 2).map(story => `[群聊摘要 ${story.date}](${discussionUrl(story)})`)];
      if (item.topics.length > 1) more.push(`另属：${item.topics.slice(1).map(topic => TOPICS[topic].label).join('、')}`);
      if (more.length) lines.push(`  ${more.join(' · ')}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

// JSON Schema for resources.json, published next to it so agents can validate and discover fields.
export function libraryJsonSchema() {
  const id = { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' };
  const day = { type: 'string', format: 'date' };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${libraryUrl}resources.schema.json`,
    title: 'AgentHub 资料库',
    type: 'object',
    required: ['name', 'coverage', 'count', 'types', 'topics', 'groups', 'keywords', 'items'],
    properties: {
      $schema: { type: 'string', format: 'uri' },
      name: { type: 'string' },
      description: { type: 'string' },
      page: { type: 'string', format: 'uri', description: '资料库网页' },
      markdown: { type: 'string', format: 'uri', description: '按主题分组的 Markdown 版本' },
      skill: { type: 'string', format: 'uri', description: '给 agent 的 SKILL.md' },
      coverage: { type: 'object', properties: { from: day, through: day }, description: '收录的分享日期范围' },
      count: { type: 'integer' },
      revision: { type: 'string', pattern: '^[a-f0-9]{64}$', description: '公开数据和词表的内容哈希；不使用加载时间' },
      vocabulary: { type: 'object', properties: { expand: { type: 'object' }, groups: { type: 'array', items: { type: 'array', items: { type: 'string' } } } }, description: '网页和查询接口共用的别名与同义词' },
      types: { type: 'array', items: { type: 'object', properties: { id: { enum: Object.keys(TYPES) }, label: { type: 'string' } } } },
      topics: { type: 'array', items: { type: 'object', properties: { id: { enum: Object.keys(TOPICS) }, label: { type: 'string' }, covers: { type: 'string' } } } },
      groups: { type: 'array', items: { type: 'object', properties: { id: { enum: Object.keys(GROUPS) }, label: { type: 'string' } } } },
      keywords: { type: 'array', description: '全库关键词、使用次数和别名；按别名找到规范写法再筛选', items: { type: 'object', required: ['keyword', 'count'],
        properties: { keyword: { type: 'string' }, count: { type: 'integer' }, aliases: { type: 'array', items: { type: 'string' } } } } },
      items: { type: 'array', items: { type: 'object', required: ['id', 'title', 'summary', 'type', 'topics', 'keywords', 'links', 'shared', 'url'], properties: {
        id,
        title: { type: 'string' },
        summary: { type: 'string', description: '中文一到两句简介，依据资料原文' },
        type: { enum: Object.keys(TYPES) },
        topics: { type: 'array', minItems: 1, maxItems: 3, items: { enum: Object.keys(TOPICS) }, description: '按相关度排序' },
        keywords: { type: 'array', minItems: 3, maxItems: 12, items: { type: 'string' }, description: '规范关键词，按重要程度排序' },
        links: { type: 'array', minItems: 1, items: { type: 'object', required: ['kind', 'url'], properties: { kind: { enum: Object.keys(LINK_KINDS) }, url: { type: 'string', format: 'uri' } } }, description: '第一个是主链接' },
        shared: { type: 'array', items: { type: 'object', properties: { date: day, group: { enum: Object.keys(GROUPS) } } }, description: '在哪天、哪个群被分享过；不含分享人' },
        discussions: { type: 'array', items: { type: 'object', properties: { kind: { enum: ['daily', 'weekly'] }, id: { type: 'string' },
          from: day, date: day, group: { type: 'string' }, title: { type: 'string' }, url: { type: 'string', format: 'uri' },
          read_path: { type: 'string' }, read_url: { type: 'string', format: 'uri' }, detail_url: { type: 'string', format: 'uri' } } }, description: '引用这项资料的日报和周报话题；只开放讨论摘要' },
        related: { type: 'array', maxItems: 3, items: id, description: '关键词和主题最接近的其他条目 id' },
        url: { type: 'string', format: 'uri' },
      } } },
    },
  };
}
