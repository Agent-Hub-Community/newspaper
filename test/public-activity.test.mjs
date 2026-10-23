import test from 'node:test';
import assert from 'node:assert/strict';
import { projectActivity, validatePublicActivity } from '../public-activity.mjs';

const issues = [{ date: '2026-09-21', pages: [{ id: 'group-1' }] }];
function fixture() {
  const stats = { counted: 500, leaders: [1, 2, 3, 4].map(i => ({
    key: String(i).repeat(12), rank: i, count: 100 - i, label: `private-name-${i}`,
  })) };
  return {
    generatedAt: '2026-09-23T00:00:00Z', policy: 'private rule',
    windows: Object.fromEntries(['week', 'month', 'all'].map(id => [id, { from: null, through: '2026-09-23' }])),
    ranks: { week: stats, month: stats, all: stats },
    groups: [{ id: 'group-1', first: '2026-03-22', last: '2026-09-23', available: true,
      daily: { '2026-09-20': stats, '2026-09-21': stats } }],
    avatars: Object.fromEntries([1, 2, 3, 4].map(i => [String(i).repeat(12), `avatars/${String(i).repeat(12)}.jpg`])),
  };
}
test('approved projection limits members and dates, remaps IDs, omits reviewed placeholders', () => {
  const source = fixture(), original = structuredClone(source);
  const { snapshot, copies } = projectActivity(source, issues, new Set(['111111111111']));
  assert.deepEqual(source, original);
  assert.equal(snapshot.ranks.week.leaders.length, 3);
  assert.deepEqual(Object.keys(snapshot.groups[0].daily), ['2026-09-21']);
  assert.equal(copies.length, 2);
  assert.equal(snapshot.avatars['member-001'], undefined);
  assert.equal(snapshot.ranks.week.leaders[0].rank, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /private|count|policy|111111111111|444444444444/);
});
test('public validation rejects private fields, excess members, unrelated dates and unsafe image paths', () => {
  const { snapshot } = projectActivity(fixture(), issues);
  for (const change of [
    a => { a.policy = 'secret'; },
    a => { a.ranks.week.leaders[0].count = 3; },
    a => { a.ranks.week.leaders.push({ key: 'member-004', rank: 3 }); },
    a => { a.groups[0].daily['2026-09-20'] = { leaders: [] }; },
    a => { a.avatars['member-001'] = '../private.jpg'; },
    a => { a.avatars['member-099'] = 'avatars/member-099.jpg'; },
  ]) {
    const invalid = structuredClone(snapshot);
    change(invalid);
    assert.throws(() => validatePublicActivity(invalid, issues));
  }
});

test('fourth-group activity remains anonymous and only includes dates with a group page', () => {
  const source = fixture();
  source.groups.push({ ...structuredClone(source.groups[0]), id: 'group-4' });
  const editions = [...issues, { date: '2026-09-20', pages: [{ id: 'group-4' }] }];
  const { snapshot } = projectActivity(source, editions);
  assert.deepEqual(Object.keys(snapshot.groups[1].daily), ['2026-09-20']);
  assert.doesNotMatch(JSON.stringify(snapshot), /private|count|policy|@chatroom/);
  assert.doesNotThrow(() => validatePublicActivity(snapshot, editions));
  snapshot.groups[1].daily['2026-09-21'] = { leaders: [] };
  assert.throws(() => validatePublicActivity(snapshot, editions));
  delete snapshot.groups[1].daily['2026-09-21'];
  snapshot.groups[1].id = 'group-5';
  assert.throws(() => validatePublicActivity(snapshot, editions));
});

test('fifth-group ranks are anonymous and daily ranks only accompany a reader page', () => {
  const source = fixture();
  const fifth = { ...structuredClone(source.groups[0]), id: 'group-5', first: '2026-10-16', last: '2026-10-20' };
  fifth.daily = { '2026-10-19': source.ranks.week, '2026-10-20': source.ranks.week };
  fifth.ranks = structuredClone(source.ranks);
  source.groups.push(fifth);
  const editions = [...issues, { date: '2026-10-19', pages: [{ id: 'group-1' }] },
    { date: '2026-10-20', pages: [{ id: 'group-5' }] }];
  const { snapshot } = projectActivity(source, editions);
  assert.deepEqual(Object.keys(snapshot.groups[1].daily), ['2026-10-20']);
  assert.equal(snapshot.groups[1].ranks.week.leaders.length, 3);
  assert.doesNotMatch(JSON.stringify(snapshot), /private|count|@chatroom/);
  assert.doesNotThrow(() => validatePublicActivity(snapshot, editions));
  snapshot.groups[1].id = 'group-6';
  assert.throws(() => validatePublicActivity(snapshot, editions));
});
