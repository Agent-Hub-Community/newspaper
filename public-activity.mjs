import assert from 'node:assert/strict';
import { isGroupId } from './groups.mjs';

// Project only approved, visible rankings; never publish stable private member IDs.
export function projectActivity(activity, issues, unavailable = new Set()) {
  const identities = new Map(), avatars = {}, copies = [];
  function ranking(stats) {
    return { leaders: stats.leaders.slice(0, 3).map(member => {
      if (!identities.has(member.key)) {
        const key = `member-${String(identities.size + 1).padStart(3, '0')}`;
        identities.set(member.key, key);
        const source = activity.avatars[member.key];
        if (source && !unavailable.has(member.key)) {
          assert.match(source, /^avatars\/[a-f0-9]{12}\.(jpg|png)$/);
          const destination = `avatars/${key}.${source.split('.').at(-1)}`;
          avatars[key] = destination;
          copies.push({ source, destination });
        }
      }
      return { key: identities.get(member.key), rank: member.rank };
    }) };
  }
  const periods = ['week', 'month', 'all'];
  const snapshot = {
    generatedAt: activity.generatedAt,
    windows: Object.fromEntries(periods.map(id => [id, {
      from: activity.windows[id].from, through: activity.windows[id].through,
    }])),
    ranks: Object.fromEntries(periods.map(id => [id, ranking(activity.ranks[id])])),
    groups: activity.groups.map(group => ({
      id: group.id, first: group.first, last: group.last, available: group.available,
      ranks: Object.fromEntries(periods.map(id => [id, ranking(group.ranks?.[id] || { leaders: [] })])),
      daily: Object.fromEntries(issues
        .filter(issue => issue.pages.some(page => page.id === group.id) && group.daily[issue.date])
        .map(issue => [issue.date, ranking(group.daily[issue.date])])),
    })),
    avatars,
  };
  validatePublicActivity(snapshot, issues);
  return { snapshot, copies };
}

export function validatePublicActivity(activity, issues) {
  const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), expected.sort());
  const date = value => assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
  keys(activity, ['generatedAt', 'windows', 'ranks', 'groups', 'avatars']);
  assert.ok(Number.isFinite(Date.parse(activity.generatedAt)));
  const periods = ['week', 'month', 'all'], members = new Set();
  keys(activity.windows, periods);
  keys(activity.ranks, periods);
  function checkRanking(stats) {
    keys(stats, ['leaders']);
    assert.ok(stats.leaders.length <= 3);
    const seen = new Set();
    for (const member of stats.leaders) {
      keys(member, ['key', 'rank']);
      assert.match(member.key, /^member-\d{3}$/);
      assert.ok(Number.isInteger(member.rank) && member.rank >= 1 && member.rank <= 3);
      assert.ok(!seen.has(member.key));
      seen.add(member.key);
      members.add(member.key);
    }
  }
  for (const period of periods) {
    keys(activity.windows[period], ['from', 'through']);
    if (activity.windows[period].from !== null) date(activity.windows[period].from);
    date(activity.windows[period].through);
    checkRanking(activity.ranks[period]);
  }
  assert.equal(new Set(activity.groups.map(g => g.id)).size, activity.groups.length);
  for (const group of activity.groups) {
    keys(group, group.ranks ? ['id', 'first', 'last', 'available', 'ranks', 'daily']
      : ['id', 'first', 'last', 'available', 'daily']);
    assert.ok(isGroupId(group.id));
    assert.equal(typeof group.available, 'boolean');
    for (const bound of [group.first, group.last]) if (bound !== null) date(bound);
    if (group.ranks) {
      keys(group.ranks, periods);
      for (const period of periods) checkRanking(group.ranks[period]);
    }
    for (const [day, stats] of Object.entries(group.daily)) {
      assert.ok(issues.some(issue => issue.date === day && issue.pages.some(page => page.id === group.id)));
      checkRanking(stats);
    }
  }
  for (const [key, file] of Object.entries(activity.avatars)) {
    assert.ok(members.has(key));
    assert.ok(file === `avatars/${key}.jpg` || file === `avatars/${key}.png`);
  }
}
