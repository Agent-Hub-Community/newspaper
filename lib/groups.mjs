// The AgentHub groups, in reader order. One source of truth: collection, rankings and the reader pages
// all read this list instead of repeating ids and labels. The chat collectors live in a separate, private
// pipeline that adds each group's chat identifier by id; no chat identifier belongs in this repository.
//
// `from` is the first collection date, `page` marks the main groups that always have a daily reader section,
// `optionalPage` marks topical groups that join the daily edition and overview only on days they have stories,
// and `weekly` marks the groups included in the weekly edition (defaulting to `page` when omitted).
// A group is collected and counted in the community ranking from `from` onward; `pageFrom` or `weeklyFrom`
// can start its reader section later without changing the collection history.
export const groups = [
  { id: 'group-1', label: '一群', from: null, page: true },
  { id: 'group-2', label: '二群', from: null, page: true },
  { id: 'group-3', label: '三群', from: null, page: true },
  { id: 'group-4', label: '四群', from: '2026-09-30', page: true },
  { id: 'group-5', label: '五群', from: '2026-10-16', page: true, pageFrom: '2026-10-20' },
  { id: 'group-6', label: 'AI Safety', from: '2026-10-21', page: false, optionalPage: true, weekly: true },
  { id: 'group-7', label: 'Robot', from: '2026-10-21', page: false, optionalPage: true, weekly: true },
  { id: 'group-8', label: 'AI4S', from: '2026-10-21', page: false, optionalPage: true, weekly: true },
];

export const groupIds = groups.map(group => group.id);
export const groupLabels = Object.fromEntries(groups.map(group => [group.id, group.label]));
export const isGroupId = value => groupIds.includes(value);
const dailyGroups = groups.filter(group => group.page);
// The whole range of main daily groups in reader prose, e.g. “一群到五群”.
export const groupSpan = `${dailyGroups[0].label}到${dailyGroups.at(-1).label}`;

// Groups to collect for a date: everything that existed by then.
export const collectedGroups = date => groups.filter(group => !group.from || group.from <= date);

// Main groups that always get a daily reader section for a date (even when empty).
export const pageGroups = date => collectedGroups(date).filter(group => group.page && (!group.pageFrom || group.pageFrom <= date));

// Topical groups that enter a daily edition only when they have stories on that date.
export const optionalPageGroups = date => collectedGroups(date).filter(group =>
  group.optionalPage && (!group.pageFrom || group.pageFrom <= date));

// Groups that get a weekly reader section on a date (main daily groups plus weekly-only topical groups).
export const weeklyGroups = date => collectedGroups(date).filter(group =>
  (group.weekly ?? group.page) && (!(group.weeklyFrom ?? group.pageFrom) || (group.weeklyFrom ?? group.pageFrom) <= date));
