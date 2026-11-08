// A small summary of the whole newspaper for the community homepage, written to hub.json. The homepage is served
// from the same origin and reads it at runtime, so its "what's new" panel follows each daily rebuild without the
// homepage being rebuilt. Paths are root-relative (basePath + route) so the same file works on GitHub Pages and in a
// local preview that serves both sites together.
import { basePath } from './site.mjs';
import { groupLabels } from './groups.mjs';
import { weeklyRoute } from './weekly-editions.mjs';
import { TYPES } from './library.mjs';

const LABELS = { ...groupLabels, external: '外部资讯' };
const readable = page => [page.stories, page.trends, page.papers].some(items => items?.some(entry => typeof entry.text === 'string' && entry.text.trim()));
const RECENT = 4;

function latestDaily(digests) {
  const issue = digests.filter(entry => entry.pages.some(readable)).at(-1);
  if (!issue) return null;
  return {
    date: issue.date,
    path: `${basePath}daily/${issue.date}/overview/`,
    pages: issue.pages.filter(readable).map(page => ({
      id: page.id, label: LABELS[page.id] || page.label, title: (page.heading || '').trim(),
      path: `${basePath}daily/${issue.date}/${page.id}/`,
    })),
  };
}

function latestWeekly(weeklies) {
  const issue = weeklies.at(-1);
  if (!issue) return null;
  const pages = issue.pages.filter(page => page.stories?.length);
  return {
    start: issue.start, end: issue.end, title: issue.title || '',
    path: `${basePath}${weeklyRoute(issue, 'overview')}`,
    pages: pages.map(page => ({ id: page.id, label: LABELS[page.id] || page.label, title: (page.title || page.heading || '').trim(),
      path: `${basePath}${weeklyRoute(issue, page.id)}` })),
  };
}

function recentResources(library) {
  // The normalized library keeps each sharing as `shares`; resources.json renames it `shared`.
  const sharedOn = item => (item.shares || item.shared || []).map(entry => entry.date).sort().at(-1) || '';
  // The library can hold a project's repository and its project page as two items with one title; show it once.
  const seen = new Set();
  return [...library.items].sort((a, b) => sharedOn(b).localeCompare(sharedOn(a)) || a.id.localeCompare(b.id))
    .filter(item => !seen.has(item.title) && seen.add(item.title)).slice(0, RECENT)
    .map(item => ({ title: item.title, type: TYPES[item.type] || item.type, date: sharedOn(item), path: `${basePath}library/#${item.id}` }));
}

// Hiring, events and calls for papers shared in the groups; the homepage shows how many are still open.
function openings(opportunities) {
  const items = opportunities?.items || [];
  const open = items.filter(item => item.open);
  const kinds = {};
  for (const item of open) kinds[item.kind] = (kinds[item.kind] || 0) + 1;
  return { count: items.length, open: open.length, kinds, path: `${basePath}library/#opportunities` };
}

export function hubSummary({ data, library, glossary, opportunities, searchable = 0 }) {
  return {
    name: 'AgentHub',
    description: 'AgentHub 日报全站摘要：最新日报与周报、资料库与群聊黑话的规模和入口。社群主页在运行时读取。',
    daily: latestDaily(data.digests),
    weekly: latestWeekly(data.weeklies),
    issues: { daily: data.digests.filter(issue => issue.pages.some(readable)).length, weekly: data.weeklies.length, first: data.coverage.first, last: data.coverage.last },
    library: { count: library.items.length, path: `${basePath}library/`, recent: recentResources(library) },
    opportunities: openings(opportunities),
    glossary: { count: glossary.terms.length, path: `${basePath}glossary/` },
    search: { count: searchable, path: `${basePath}search/` },
    rank: { groups: data.activity?.groups?.filter(group => group.available !== false).length || 0, path: `${basePath}rank/week/` },
    sections: {
      daily: `${basePath}`, weekly: `${basePath}weekly/`, library: `${basePath}library/`, glossary: `${basePath}glossary/`,
      rank: `${basePath}rank/week/`, search: `${basePath}search/`,
      agents: { llms: `${basePath}llms.txt`, skill: `${basePath}agents/SKILL.md`, feed: `${basePath}feed.xml`, json: `${basePath}feed.json` },
    },
  };
}
