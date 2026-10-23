// Subscription feeds: one item per published daily or weekly edition, newest first. JSON Feed 1.1 serves agents
// and feed readers that read JSON; Atom serves the rest. Items carry the published section headings and links,
// not the topic bodies, so a reader follows the link to read and the feed stays small. Item ids are tag URIs
// (RFC 4151): stable, and not mistaken for pages the site does not have. They keep the site's first address
// (hqhq1025.github.io, agent_hub) after the move: a changed id makes feed readers deliver every item again.
import { site } from './site.mjs';
import { groupLabels } from './groups.mjs';
import { weeklyRoute } from './weekly-editions.mjs';
import { dailyMarkdownPath, weeklyMarkdownPath } from './agent-docs.mjs';

export const feedUrl = `${site}feed.json`;
export const atomUrl = `${site}feed.xml`;
const LIMIT = 30;
const LABELS = { ...groupLabels, external: '外部资讯' };
// Editions are dated in Beijing time; the stamp is the start of that Beijing day.
const stamp = date => `${date}T00:00:00+08:00`;
const readable = page => [page.stories, page.trends, page.papers].some(items => items?.some(entry => typeof entry.text === 'string' && entry.text.trim()));

function items({ digests, weeklies }) {
  const daily = digests.filter(issue => issue.pages.some(readable)).map(issue => {
    const pages = issue.pages.filter(readable);
    return { id: `tag:hqhq1025.github.io,2026:agent_hub/daily/${issue.date}`, url: `${site}daily/${issue.date}/${pages[0].id}/`, date: issue.date,
      title: `AgentHub 日报 ${issue.date}`, markdown: `${site}${dailyMarkdownPath(issue.date)}`,
      lines: pages.map(page => `${LABELS[page.id] || page.label}：${(page.heading || '').trim() || '（本版无标题）'}`) };
  });
  const weekly = weeklies.map(issue => {
    const pages = issue.pages.filter(page => page.stories?.length);
    return { id: `tag:hqhq1025.github.io,2026:agent_hub/weekly/${issue.start}/${issue.end}`, url: new URL(weeklyRoute(issue, pages[0]?.id || issue.pages[0].id), site).href,
      date: issue.end, title: `AgentHub 周报 ${issue.start} 至 ${issue.end}${issue.title ? `：${issue.title}` : ''}`,
      markdown: `${site}${weeklyMarkdownPath(issue)}`,
      lines: pages.map(page => `${LABELS[page.id] || page.label}：${(page.title || page.heading || '').trim() || '（本版无标题）'}`) };
  });
  return [...daily, ...weekly].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).slice(0, LIMIT);
}

export function jsonFeed(data) {
  return `${JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'AgentHub',
    home_page_url: site,
    feed_url: feedUrl,
    description: 'AI Agent 研究者微信群 AgentHub 的每日群聊日报和每周周报。正文用角色代称群友，不含聊天原话。',
    language: 'zh-CN',
    items: items(data).map(item => ({ id: item.id, url: item.url, title: item.title,
      content_text: `${item.lines.join('\n')}\n\nMarkdown：${item.markdown}`, date_published: stamp(item.date),
      attachments: [{ url: item.markdown, mime_type: 'text/markdown', title: 'Markdown' }] })),
  }, null, 2)}\n`;
}

const xml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

export function atomFeed(data) {
  const list = items(data);
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="zh-CN">
  <title>AgentHub</title>
  <subtitle>AI Agent 研究者微信群 AgentHub 的每日群聊日报和每周周报</subtitle>
  <id>${xml(site)}</id>
  <link rel="alternate" type="text/html" href="${xml(site)}"/>
  <link rel="self" type="application/atom+xml" href="${xml(atomUrl)}"/>
  <updated>${stamp(list[0]?.date || '2026-01-01')}</updated>
  <author><name>AgentHub</name></author>
${list.map(item => `  <entry>
    <id>${xml(item.id)}</id>
    <title>${xml(item.title)}</title>
    <link rel="alternate" type="text/html" href="${xml(item.url)}"/>
    <link rel="alternate" type="text/markdown" href="${xml(item.markdown)}"/>
    <updated>${stamp(item.date)}</updated>
    <summary type="text">${xml(item.lines.join('\n'))}</summary>
  </entry>`).join('\n')}
</feed>
`;
}
