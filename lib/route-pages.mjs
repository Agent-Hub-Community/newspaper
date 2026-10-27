import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { writeWeeklyPages } from './weekly-render.mjs';
import { clip, headTags } from './seo.mjs';
import { groupLabels, groups as communityGroups } from './groups.mjs';
import { site } from './site.mjs';

const groups = {
  ...groupLabels,
  external: '外部资讯',
};
const ranks = { week: '周榜', month: '月榜', all: '总榜' };

function setHeadElement(document, selector, tag, attributes) {
  const matches = [...document.head.querySelectorAll(selector)];
  const element = matches.shift() || document.createElement(tag);
  for (const duplicate of matches) duplicate.remove();
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (!element.parentNode) document.head.append(element);
  return element;
}

// Replaces the template's descriptive head tags with this route's (see seo.mjs).
function setMeta(document, meta) {
  for (const element of document.head.querySelectorAll('meta[name="robots"], meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], link[rel="alternate"][type="text/markdown"], link[rel="alternate"][type="application/feed+json"], link[rel="alternate"][type="application/atom+xml"], link[rel="describedby"], script[type="application/ld+json"]')) element.remove();
  const holder = document.createElement('div');
  holder.innerHTML = headTags(meta);
  document.head.append(...holder.childNodes);
}

function render(template, route, prefix, title, issue, meta, rank) {
  const { document } = parseHTML(template);
  if (meta) setMeta(document, { ...meta, llms: `${prefix}llms.txt` });
  for (const element of document.querySelectorAll('a[data-root-href]')) element.setAttribute('href', prefix + element.getAttribute('data-root-href'));
  // Daily routes preload their own issue so the first render needs no request; others need none.
  const issueScript = document.querySelector('script[data-issue]');
  if (issueScript && issue) issueScript.setAttribute('src', `issues/${issue.date}.js?v=${issue.version}`);
  else if (issueScript && route) issueScript.remove();
  setHeadElement(document, 'meta[name="agenthub-root"]', 'meta', {
    name: 'agenthub-root', content: prefix,
  });
  setHeadElement(document, 'link[rel="canonical"]', 'link', {
    rel: 'canonical', href: new URL(route, site).href,
  });
  // Linkedom serializes title text without RCDATA escaping.
  if (title) {
    setHeadElement(document, 'title', 'title', {}).textContent = title
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  }
  if (route) {
    for (const element of document.querySelectorAll('a.wordmark[href]')) {
      element.setAttribute('href', prefix);
    }
    for (const element of document.querySelectorAll('script[src], link[rel="stylesheet"][href]')) {
      const attribute = element.tagName === 'SCRIPT' ? 'src' : 'href';
      const value = element.getAttribute(attribute);
      if (!value || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(value)) continue;
      element.setAttribute(attribute, prefix + value.replace(/^(?:\.\/)+/, ''));
    }
  }
  // Rank pages name their section and window before app.js runs.
  if (rank) {
    for (const element of document.querySelectorAll('a.wordmark span')) element.textContent = '活跃榜';
    for (const element of document.querySelectorAll('#footer-label')) element.textContent = 'AGENT HUB / 活跃榜';
    for (const element of document.querySelectorAll('#rank-period')) element.textContent = rank.label;
    if (rank.through) for (const element of document.querySelectorAll('#rank-through')) element.textContent = `统计截至 ${rank.through.replaceAll('-', '.')}`;
  }
  return document.toString();
}

// Read the finalized root HTML on every call so post-build data hashes are reused.
export async function writeRoutePages(out, data, { issueVersions = {} } = {}) {
  out = out instanceof URL ? fileURLToPath(out) : out;
  const routes = [];
  const dates = new Set();
  for (const issue of data.digests) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issue.date) || dates.has(issue.date)) {
      throw new Error(`Invalid or duplicate route date: ${issue.date}`);
    }
    dates.add(issue.date);
    // Only issues with readable pages get a Markdown copy (agent-docs.mjs).
    const hasCopy = issue.pages.some(page => [page.stories, page.trends, page.papers]
      .some(items => items?.some(entry => typeof entry.text === 'string' && entry.text.trim())));
    const overviewHeadings = issue.pages.filter(page => [page.stories, page.trends, page.papers]
      .some(items => items?.some(entry => typeof entry.text === 'string' && entry.text.trim())))
      .map(page => page.heading).filter(Boolean);
    routes.push({
      route: `daily/${issue.date}/overview/`, prefix: '../../../', title: `本日总览 · ${issue.date} · AgentHub`,
      issue: issueVersions[issue.date] && { date: issue.date, version: issueVersions[issue.date] },
      meta: {
        section: 'daily', kind: 'article', title: `${issue.date} 各群与外部资讯总览`, date: issue.date,
        url: new URL(`daily/${issue.date}/overview/`, site).href, markdown: hasCopy ? '../index.md' : '',
        description: clip(`AgentHub ${issue.date} 本日总览：${overviewHeadings.join('；')}`),
      },
    });
    for (const [id, label] of Object.entries(groups)) {
      const group = communityGroups.find(group => group.id === id);
      const page = issue.pages.find(page => page.id === id);
      const pageHasContent = Boolean(page && [page.stories, page.trends, page.papers]
        .some(items => items?.some(entry => typeof entry.text === 'string' && entry.text.trim())));
      if (group) {
        if (group.pageFrom && issue.date < group.pageFrom) continue;
        if (!group.page && !(group.optionalPage && pageHasContent)) continue;
      }
      const routeTitle = `${page?.heading || label} · ${issue.date} · AgentHub`;
      routes.push({
        route: `daily/${issue.date}/${id}/`, prefix: '../../../', title: routeTitle,
        issue: issueVersions[issue.date] && { date: issue.date, version: issueVersions[issue.date] },
        meta: {
          section: 'daily', kind: 'article', title: page?.heading || `${issue.date} ${label}`, date: issue.date,
          url: new URL(`daily/${issue.date}/${id}/`, site).href, markdown: pageHasContent ? 'index.md' : hasCopy ? '../index.md' : '',
          description: clip(`AgentHub ${label} ${issue.date}：${[page?.heading, page?.theme].filter(Boolean).join('。')}`),
        },
      });
    }
  }
  for (const [id, label] of Object.entries(ranks)) {
    const rankMeta = { section: 'rank', title: `活跃榜 · ${label}`, url: new URL(`rank/${id}/`, site).href, description: `AgentHub 社区活跃榜${label}：一群到五群前三名。` };
    const rank = { label, through: data.activity?.windows?.[id]?.through || data.coverage?.last };
    routes.push({ route: `rank/${id}/`, prefix: '../../', title: `活跃榜 · ${label} · AgentHub`, meta: rankMeta, rank });
    for (const { id: groupId, label: groupLabel } of communityGroups.filter(group => group.page)) {
      routes.push({ route: `rank/${id}/${groupId}/`, prefix: '../../../', title: `活跃榜 · ${label} · ${groupLabel} · AgentHub`, meta: { ...rankMeta, url: new URL(`rank/${id}/${groupId}/`, site).href }, rank });
    }
  }
  const template = await readFile(path.join(out, 'index.html'), 'utf8');
  await writeFile(path.join(out, 'index.html'), render(template, '', './', '', null, {
    section: 'home', kind: 'home', title: 'AgentHub', url: site, markdown: 'index.md',
    description: 'AgentHub：AI Agent 研究者微信群（一群到五群）的每日群聊日报、周报、社区活跃榜和资料库。',
  }));
  for (const { route, prefix, title, issue, meta, rank } of routes) {
    const directory = path.join(out, route);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'index.html'), render(template, route, prefix, title, issue, meta, rank));
  }
  await writeWeeklyPages(out, data);
}
