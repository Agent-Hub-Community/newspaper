import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { libraryJson, libraryUrl, md, readableStories } from './library.mjs';
import { site } from './site.mjs';
import { groupLabels } from './groups.mjs';
import { HIRING_ROLES, OPPORTUNITY_KINDS, opportunityWhen } from './opportunities.mjs';
import { contentAPIBase, readingBase } from './agent-reading.mjs';
import { weeklyRoute } from './weekly-editions.mjs';
import { contentRevision, topicId, topicReadPath } from './agent-content-id.mjs';
import { packVectors } from './semantic.mjs';

export { contentRevision, topicId, topicReadPath } from './agent-content-id.mjs';

const labels = { ...groupLabels, external: '外部资讯' };
const readable = page => [page.stories, page.trends, page.papers].some(items => items?.some(entry => typeof entry.text === 'string' && entry.text.trim()));
const compactSummary = text => typeof text === 'string' ? [...text.trim()].slice(0, 160).join('') : '';
const publicTitle = (text, group) => typeof text === 'string' && text.trim() ? text.trim() : labels[group] || group;
const outlineUrl = (kind, date) => `${contentAPIBase}edition?kind=${kind}&date=${date}`;
const entryRevision = ({ url, read_path, read_url, detail_url, ...content }) => contentRevision(content);
const sourceLink = resource => {
  const url = new URL(resource.url);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid content source URL');
  return { kind: resource.kind || 'article', label: resource.label || '', url: url.href };
};

function storyEntry(kind, issue, page, story, index) {
  const id = topicId(kind, issue, page, story);
  const route = kind === 'weekly' ? weeklyRoute(issue, page.id) : `daily/${issue.date}/${page.id}/`;
  const read_path = topicReadPath(id);
  // Copy only fields already approved for Markdown. Raw excerpts, speakers and avatars never enter the catalog.
  const entry = { id, kind, date: kind === 'weekly' ? issue.end || issue.through : issue.date,
    ...(kind === 'weekly' ? { from: issue.start || issue.from } : {}), group: page.id,
    title: story.title, text: story.text, ai_comment: story.aiComment || story.review || '', keywords: [],
    resources: (story.resources || []).map(sourceLink),
    ...(story.timeline?.length ? { timeline: story.timeline.map(step => ({ date: step.date, text: step.text })) } : {}),
    url: `${site}${route}#topic-${index + 1}`, read_path,
    read_url: readingBase + read_path.replace(/\.json$/, '.md'), detail_url: readingBase + read_path };
  return { ...entry, revision: entryRevision(entry) };
}

// An edition-level observation (动向观察) is searchable on its own. It is not a topic: edition outlines list only
// stories and count observations in trend_count. Its id carries trend- so a story with the same title stays distinct.
function trendEntry(issue, page, trend) {
  const id = `daily:${issue.date}:${page.id}:trend-${contentRevision(String(trend.title || trend.text).normalize('NFKC').trim()).slice(0, 24)}`;
  const read_path = topicReadPath(id);
  const entry = { id, kind: 'daily', date: issue.date, group: page.id, trend: true,
    title: trend.title || [...trend.text].slice(0, 30).join(''), text: trend.text, ai_comment: '', keywords: [], resources: [],
    url: `${site}daily/${issue.date}/${page.id}/#trends-heading`, read_path,
    read_url: readingBase + read_path.replace(/\.json$/, '.md'), detail_url: readingBase + read_path };
  return { ...entry, revision: entryRevision(entry) };
}

export function contentCatalog({ digests = [], weeklies = [], library, opportunities = null, vocabulary = { expand: {}, groups: [] } }) {
  const entries = [], editions = [];
  for (const issue of digests) {
    const pages = issue.pages.filter(readable);
    if (!pages.length) continue;
    const edition = { kind: 'daily', date: issue.date, groups: pages.map(page => page.id),
      url: `${site}daily/${issue.date}/${pages[0].id}/`, read_url: `${readingBase}daily/${issue.date}/index.md`,
      outline_url: outlineUrl('daily', issue.date),
      sections: pages.map(page => ({ group: page.id, label: labels[page.id] || page.id,
        title: publicTitle(page.heading, page.id), summary: compactSummary(page.theme),
        url: `${site}daily/${issue.date}/${page.id}/`, read_url: `${readingBase}daily/${issue.date}/${page.id}/index.md`,
        trend_count: (page.trends || []).filter(trend => typeof trend.text === 'string' && trend.text.trim()).length })) };
    editions.push(edition);
    for (const page of pages) readableStories(page).forEach((story, index) => entries.push(storyEntry('daily', issue, page, story, index)));
    for (const page of pages) for (const trend of page.trends || []) {
      if (typeof trend.text === 'string' && trend.text.trim()) entries.push(trendEntry(issue, page, trend));
    }
  }
  for (const issue of weeklies) {
    const pages = issue.pages;
    editions.push({ kind: 'weekly', date: issue.end || issue.through, from: issue.start || issue.from,
      groups: pages.map(page => page.id), url: site + weeklyRoute(issue, pages[0]?.id),
      read_url: `${readingBase}weekly/${issue.start || issue.from}/${issue.end || issue.through}/index.md`,
      outline_url: outlineUrl('weekly', issue.end || issue.through),
      sections: pages.map(page => ({ group: page.id, label: labels[page.id] || page.id,
        title: publicTitle(page.title, page.id), summary: compactSummary(page.intro),
        url: site + weeklyRoute(issue, page.id), trend_count: 0 })) });
    for (const page of pages) page.stories.forEach((story, index) => entries.push(storyEntry('weekly', issue, page, story, index)));
  }
  for (const item of libraryJson(library).items) {
    const id = `library:${item.id}`, read_path = topicReadPath(id);
    const entry = { id, resource_id: item.id, kind: 'library', date: item.shared.at(-1)?.date || library.through,
      first_shared: item.shared[0]?.date || library.through,
      last_shared: item.shared.at(-1)?.date || library.through,
      title: item.title, text: item.summary, ai_comment: '', keywords: item.keywords,
      type: item.type, topics: item.topics, links: item.links, shared: item.shared, related: item.related,
      discussions: item.discussions, url: item.url, read_path,
      read_url: readingBase + read_path.replace(/\.json$/, '.md'), detail_url: readingBase + read_path };
    entries.push({ ...entry, revision: entryRevision(entry) });
  }
  // Opportunities are searchable like library entries; `open` says whether one is still worth acting on.
  for (const item of opportunities?.items || []) {
    const id = `opportunity:${item.id}`, read_path = topicReadPath(id);
    const roles = item.roles.map(role => HIRING_ROLES[role]);
    const entry = { id, kind: 'opportunity', opportunity_kind: item.kind, date: item.last, first_shared: item.first,
      title: item.title, text: `${item.org}${item.location ? `，${item.location}` : ''}。${item.summary}`, ai_comment: '',
      keywords: [...new Set([OPPORTUNITY_KINDS[item.kind], ...roles, item.org, ...item.topics])],
      ...(item.roles.length ? { roles: item.roles } : {}), ...(item.deadline ? { deadline: item.deadline } : {}),
      ...(item.event_date ? { event_date: item.event_date } : {}), closes: item.closes, open: item.open,
      links: item.links, shared: item.shares, url: `${libraryUrl}#${item.id}`, read_path,
      read_url: readingBase + read_path.replace(/\.json$/, '.md'), detail_url: readingBase + read_path };
    entries.push({ ...entry, revision: entryRevision(entry) });
  }
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate content identity: ${entry.id}; give stories distinct titles`);
    ids.add(entry.id);
  }
  const sortedEditions = editions.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  const data = { schema_version: 1, entries, vocabulary: { expand: vocabulary.expand || {}, groups: vocabulary.groups || [] },
    editions: sortedEditions, latest: {
      daily: sortedEditions.filter(edition => edition.kind === 'daily').at(-1) || null,
      weekly: sortedEditions.filter(edition => edition.kind === 'weekly').at(-1) || null } };
  return { ...data, revision: contentRevision(data) };
}

export function topicMarkdown(entry) {
  const lines = [`# ${md(entry.title)}`, '', `栏目：${entry.kind} · ${entry.from ? `${entry.from} 至 ` : ''}${entry.date}${entry.group ? ` · ${labels[entry.group] || entry.group}` : ''}`,
    `ID：${entry.id}`, `内容版本：${entry.revision}`, '', entry.kind === 'library' ? '## 资料简介' : entry.kind === 'opportunity' ? '## 机会' : entry.trend ? '## 动向观察' : '## 讨论摘要', '', md(entry.text), ''];
  if (entry.kind === 'opportunity') {
    lines.push(`状态：${entry.open ? '开放中' : '已截止'}，${opportunityWhen({ ...entry, kind: entry.opportunity_kind, first: entry.first_shared })}`, '');
    if (!entry.links.length) lines.push(`联系方式见 ${entry.shared.at(-1).date} 群里的原消息。`, '');
  }
  if (entry.ai_comment) lines.push('## AI 评论', '', md(entry.ai_comment), '');
  if (entry.timeline?.length) lines.push('## 时间线', '', ...entry.timeline.map(step => `- ${step.date}：${md(step.text)}`), '');
  const links = entry.links || entry.resources || [];
  if (links.length) lines.push('## 来源', '', ...links.map(link => `- [${md(link.label || link.kind)}](${link.url})`), '');
  if (entry.discussions?.length) lines.push('## 相关讨论', '', ...entry.discussions.map(discussion => `- [${md(discussion.title)}](${discussion.read_url})`), '');
  lines.push(`网页：${entry.url}`, '');
  return lines.join('\n');
}

export async function writeContentFiles(out, catalog, stored) {
  await mkdir(path.join(out, 'search'), { recursive: true });
  await mkdir(path.join(out, 'agents/topics'), { recursive: true });
  await writeFile(path.join(out, 'search/catalog.json'), `${JSON.stringify(catalog)}\n`);
  // Semantic vectors for the reader API, when semantic-vectors.json exists (see semantic.mjs).
  if (stored) {
    const { meta, bin } = packVectors(catalog.entries, stored);
    await writeFile(path.join(out, 'search/vectors.json'), `${JSON.stringify(meta)}\n`);
    await writeFile(path.join(out, 'search/vectors.bin'), bin);
    // Not an error: those entries are still found by words. The warning reminds the publisher to run the script.
    if (meta.missing) console.warn(`${meta.missing} catalog entries have no semantic vector; run node scripts/embed-catalog.mjs`);
  }
  for (const entry of catalog.entries) {
    await writeFile(path.join(out, entry.read_path), `${JSON.stringify({ schema_version: 1, ...entry })}\n`);
    await writeFile(path.join(out, entry.read_path.replace(/\.json$/, '.md')), topicMarkdown(entry));
  }
}
