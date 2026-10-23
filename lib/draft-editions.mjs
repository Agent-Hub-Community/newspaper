import { groupIds, pageGroups } from './groups.mjs';

function validPages(issue) {
  if (!Array.isArray(issue.pages) || issue.pages.length < 3 || issue.pages.length > 6) return false;
  const sectioned = new Set(pageGroups(issue.date).map(group => group.id));
  let groups = 0;
  for (const [index, page] of issue.pages.entries()) {
    if (groupIds.includes(page?.id)) {
      if (page.id !== groupIds[index] || !Array.isArray(page.stories) ||
          (page.id === 'group-5' && !sectioned.has(page.id))) return false;
      groups++;
    } else if (index < 3 || index !== issue.pages.length - 1 ||
        (page?.id === 'papers' ? !Array.isArray(page.papers)
          : page?.id !== 'external' || !Array.isArray(page.stories))) return false;
  }
  return groups >= 3;
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
