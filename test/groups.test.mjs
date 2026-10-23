import assert from 'node:assert/strict';
import test from 'node:test';
import { groups, groupIds, collectedGroups, pageGroups, isGroupId } from '../groups.mjs';

test('group ids and labels are unique and no chat identifier is published', () => {
  for (const key of ['id', 'label']) {
    assert.equal(new Set(groups.map(group => group[key])).size, groups.length, key);
  }
  for (const group of groups) {
    assert.deepEqual(Object.keys(group).filter(key => !['id', 'label', 'from', 'page', 'pageFrom'].includes(key)), [], group.id);
  }
});

test('a group is collected from its start date but only sectioned when it has a page', () => {
  assert.deepEqual(collectedGroups('2026-09-29').map(g => g.id), ['group-1', 'group-2', 'group-3']);
  assert.deepEqual(collectedGroups('2026-09-30').map(g => g.id), ['group-1', 'group-2', 'group-3', 'group-4']);
  assert.deepEqual(collectedGroups('2026-10-16').map(g => g.id), groupIds);
  // Collection predates the fifth group's reader section.
  assert.deepEqual(pageGroups('2026-10-16').map(g => g.id), ['group-1', 'group-2', 'group-3', 'group-4']);
  assert.ok(collectedGroups('2026-10-16').some(g => g.id === 'group-5'));
  assert.ok(!pageGroups('2026-10-19').some(g => g.id === 'group-5'));
  assert.deepEqual(pageGroups('2026-10-20').map(g => g.id), groupIds);
});

test('pages are always a subset of the groups collected that day', () => {
  for (const date of ['2026-09-29', '2026-09-30', '2026-10-16', '2026-12-31']) {
    const collected = new Set(collectedGroups(date).map(g => g.id));
    assert.ok(pageGroups(date).every(group => collected.has(group.id)), date);
  }
});

test('isGroupId accepts every known group and nothing else', () => {
  for (const id of groupIds) assert.ok(isGroupId(id));
  for (const id of ['external', 'group-0', 'group-9', '', undefined]) assert.ok(!isGroupId(id));
});
