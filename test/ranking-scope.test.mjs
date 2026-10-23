import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const source = await readFile(new URL('../ranking.js', import.meta.url), 'utf8');
const leaders = [1, 2, 2].map((rank, i) => ({ key: `m${i}`, rank }));
function render(groups, period = 'week', groupId) {
  const { document } = parseHTML('<main id="reading"></main>');
  const context = { document, window: {} };
  vm.runInNewContext(source, context);
  context.window.renderRanking({ id: period }, () => {}, {
    activity: {
      generatedAt: '2026-10-01T00:00:00Z', groups, avatars: {},
      ranks: { [period]: { leaders } },
      windows: { week: { from: '2026-09-21', through: '2026-09-27' },
        month: { from: '2026-09-01', through: '2026-09-30' },
        all: { from: null, through: '2026-10-01' } },
    },
  }, groupId);
  const columns = [...document.querySelectorAll('.rank-column')].map(column => ({
    label: column.querySelector('h2').textContent,
    since: column.querySelector('.rank-since')?.textContent || '',
    ranks: [...column.querySelectorAll('.rank-number')].map(rank => rank.textContent).join(','),
    empty: column.querySelector('.rank-empty')?.textContent || '',
  }));
  return { document, columns };
}
const group = (id, first = '2026-09-01', last = '2026-10-01') => ({ id, first, last, available: true, ranks: { week: { leaders }, month: { leaders }, all: { leaders } } });
const groups = [group('group-1'), group('group-2', '2026-09-23'), { id: 'group-3', available: false }, group('group-4', '2026-09-29')];

test('one board shows the community, then every group, with ranks and ties as published', () => {
  const { document, columns } = render(groups);
  assert.deepEqual(columns.map(column => column.label), ['全社区', '一群', '二群', '三群', '四群']);
  assert.equal(columns[0].ranks, '1,2,2');
  assert.equal(columns[3].empty, '暂无记录');
  assert.equal(document.querySelector('h1').textContent, '本周最活跃的群友');
  assert.equal(document.querySelector('[data-rank="week"]').getAttribute('aria-pressed'), 'true');
  // The board carries no score, count or scoring rule.
  assert.doesNotMatch(document.querySelector('#reading').textContent, /分数|计分|消息|条/);
});
test('a fifth group shares the board and carries its collection start', () => {
  const { columns } = render([...groups, group('group-5', '2026-10-16')], 'all', 'group-5');
  assert.deepEqual(columns.map(column => column.label), ['全社区', '一群', '二群', '三群', '四群', '五群']);
  assert.equal(columns.at(-1).since, '10 月 16 日起');
  assert.equal(columns.at(-1).ranks, '1,2,2');
});
test('a column names its start only when its records begin after the period does', () => {
  assert.deepEqual(render(groups).columns.map(column => column.since), ['', '', '9 月 23 日起', '', '9 月 29 日起']);
  assert.deepEqual(render(groups, 'month').columns.map(column => column.since), ['', '', '9 月 23 日起', '', '9 月 29 日起']);
  // 总榜 has no common start: every column says where its records begin.
  assert.deepEqual(render(groups, 'all').columns.map(column => column.since), ['9 月 1 日起', '9 月 1 日起', '9 月 23 日起', '', '9 月 29 日起']);
});
test('a group in the route does not single out its column', () => {
  const plain = render(groups).document.querySelector('.rank-board').outerHTML;
  assert.equal(render(groups, 'week', 'group-2').document.querySelector('.rank-board').outerHTML, plain);
});
test('without an activity snapshot the page says so instead of drawing empty columns', () => {
  const { document } = parseHTML('<main id="reading"></main>');
  const context = { document, window: {} };
  vm.runInNewContext(source, context);
  context.window.renderRanking({ id: 'month' }, () => {}, {});
  assert.equal(document.querySelectorAll('.rank-column').length, 0);
  assert.equal(document.querySelector('.rank-empty').textContent, '暂无可用榜单');
});
