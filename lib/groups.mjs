// The AgentHub groups, in reader order. One source of truth: collection, rankings and the reader pages
// all read this list instead of repeating ids and labels. The chat collectors live in a separate, private
// pipeline that adds each group's chat identifier by id; no chat identifier belongs in this repository.
//
// `from` is the first collection date, and `page` marks the groups that have
// their own reader section. A group is collected and counted in the community ranking from `from`
// onward; `pageFrom` can start its reader section later without changing the collection history.
export const groups = [
  { id: 'group-1', label: '一群', from: null, page: true },
  { id: 'group-2', label: '二群', from: null, page: true },
  { id: 'group-3', label: '三群', from: null, page: true },
  { id: 'group-4', label: '四群', from: '2026-09-30', page: true },
  { id: 'group-5', label: '五群', from: '2026-10-16', page: true, pageFrom: '2026-10-20' },
];

export const groupIds = groups.map(group => group.id);
export const groupLabels = Object.fromEntries(groups.map(group => [group.id, group.label]));
export const isGroupId = value => groupIds.includes(value);
// The whole range of groups in reader prose, e.g. “一群到五群”.
export const groupSpan = `${groups[0].label}到${groups.at(-1).label}`;

// Groups to collect for a date: everything that existed by then.
export const collectedGroups = date => groups.filter(group => !group.from || group.from <= date);

// Groups that get a reader section for a date; the rest are collected but stay out of the edition.
export const pageGroups = date => collectedGroups(date).filter(group => group.page && (!group.pageFrom || group.pageFrom <= date));
