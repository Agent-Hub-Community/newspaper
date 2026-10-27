import { groupIds, pageGroups, optionalPageGroups } from './groups.mjs';

function validPages(issue) {
  if (!Array.isArray(issue.pages) || issue.pages.length < 3) return false;
  const required = pageGroups(issue.date).map(group => group.id);
  const optional = new Set(optionalPageGroups(issue.date).map(group => group.id));
  const allowed = new Set([...required, ...optional]);
  let groupCount = 0;
  let lastOrder = -1;
  for (const [index, page] of issue.pages.entries()) {
    if (groupIds.includes(page?.id)) {
      const order = groupIds.indexOf(page.id);
      if (!allowed.has(page.id) || order <= lastOrder || !Array.isArray(page.stories)) return false;
      if (optional.has(page.id) && !page.stories.length) return false;
      lastOrder = order;
      groupCount++;
    } else if (index < 3 || index !== issue.pages.length - 1 ||
        (page?.id === 'papers' ? !Array.isArray(page.papers)
          : page?.id !== 'external' || !Array.isArray(page.stories))) return false;
  }
  const presentIds = new Set(issue.pages.map(page => page.id));
  if (issue.date >= '2026-10-20' && !required.every(id => presentIds.has(id))) return false;
  if (issue.date < '2026-10-20' && !['group-1', 'group-2', 'group-3'].every(id => presentIds.has(id))) return false;
  return groupCount >= 3;
}

export function mergeDraftEditions(existing, payload) {
  const drafts = Array.isArray(payload) ? payload : [payload];
  if (!drafts.length) throw new Error('Empty draft editions');
  const ids = new Set();
  for (const issue of drafts) {
    if (!issue || !/^\d{4}-\d{2}-\d{2}$/.test(issue.date) || issue.id !== issue.date ||
        ids.has(issue.id) || !validPages(issue) ||
        new Set(issue.pages.map(page => page.id)).size !== issue.pages.length) {
      throw new Error('Invalid draft edition');
    }
    ids.add(issue.id);
  }
  return [...existing.filter(issue => !ids.has(issue.id)), ...drafts]
    .sort((a, b) => a.date.localeCompare(b.date));
}
