import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { contentCatalog, topicMarkdown, writeContentFiles } from '../agent-content.mjs';
import { normalizeLibrary } from '../library.mjs';
import { site } from '../site.mjs';

const librarySource = { version: 1, through: '2026-10-16', items: [{
  id: 'research-guide', title: '科研指南', summary: '选题与研究工具。', type: 'article', topics: ['research-tools'],
  keywords: ['research', 'writing', 'figure'], links: [{ kind: 'article', url: 'https://example.org/guide' }],
  shares: [{ date: '2026-10-10', group: 'group-1', avatar: null }, { date: '2026-10-16', group: 'group-2', avatar: null }] }] };
const story = { title: '科研经验分享', text: '群友讨论选题的边界。', aiComment: '先定义可检验的研究问题。',
  resources: [{ kind: 'article', label: '指南', url: 'https://example.org/guide' }],
  discussion: [{ speaker: 1, time: '22:00', text: 'PRIVATE_RAW_MESSAGE' }], avatar: 'PRIVATE_AVATAR' };
const source = () => ({ digests: [{ date: '2026-10-16', pages: [{ id: 'group-2', stories: [structuredClone(story)] }] }],
  weeklies: [{ start: '2026-10-05', end: '2026-10-11', pages: [{ id: 'group-3', stories: [{ ...structuredClone(story),
    timeline: [{ date: '2026-10-07', text: '明确研究问题。' }] }] }] }],
  vocabulary: { expand: { 科研: ['research'] }, groups: [['绘图', '画图']] } });
const catalog = data => contentCatalog({ ...data, library: normalizeLibrary(librarySource, data.digests, data.weeklies) });

test('catalog copies only approved content and separates summaries from AI comments', () => {
  const result = catalog(source());
  assert.equal(result.entries.length, 3);
  assert.match(result.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.vocabulary.groups, [['绘图', '画图']]);
  const [daily, weekly, item] = result.entries;
  assert.equal(daily.text, story.text);
  assert.equal(daily.ai_comment, story.aiComment);
  assert.equal(item.date, '2026-10-16');
  assert.equal(item.first_shared, '2026-10-10');
  assert.equal(item.last_shared, '2026-10-16');
  assert.equal(item.discussions.length, 2);
  assert.equal(weekly.from, '2026-10-05');
  assert.equal(result.latest.daily.date, '2026-10-16');
  assert.equal(result.latest.weekly.date, '2026-10-11');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|speaker|avatar/);
  assert.match(topicMarkdown(daily), /## 讨论摘要\n\n群友讨论选题的边界。\n\n## AI 评论/);
});

test('topic identity survives reordering and body edits but a title change creates a new identity', () => {
  const data = source();
  const first = catalog(data).entries[0];
  data.digests[0].pages[0].stories.unshift({ title: '另一个话题', text: '另一段内容。' });
  const moved = catalog(data).entries.find(entry => entry.title === story.title && entry.kind === 'daily');
  assert.equal(moved.id, first.id);
  assert.notEqual(moved.url, first.url);
  assert.equal(moved.revision, first.revision, 'a moved browser anchor is not a content revision');
  data.digests[0].pages[0].stories[1].text += ' 添加新的证据。';
  const edited = catalog(data).entries.find(entry => entry.id === first.id);
  assert.equal(edited.id, first.id);
  assert.notEqual(edited.revision, moved.revision);
  data.digests[0].pages[0].stories[1].title = '新的科研话题';
  assert.ok(!catalog(data).entries.some(entry => entry.id === first.id));
});

test('private discussion changes do not change public content or revisions', () => {
  const data = source(), before = catalog(data);
  data.digests[0].pages[0].stories[0].discussion = [{ speaker: 99, text: 'ANOTHER_PRIVATE_MESSAGE' }];
  assert.deepEqual(catalog(data), before);
  data.digests[0].pages[0].stories.push(structuredClone(data.digests[0].pages[0].stories[0]));
  assert.throws(() => catalog(data), /Duplicate content identity/);
});

test('edition sections expose bounded published headings and preserve group routes', () => {
  const data = source();
  Object.assign(data.digests[0].pages[0], { heading: '当天科研讨论', theme: `  ${'🙂'.repeat(161)}  `,
    trends: [{ title: '观察', text: '研究进展。' }, { text: '  ' }],
    note: 'PRIVATE_PAGE_NOTE', discussion: [{ speaker: 42, text: 'PRIVATE_PAGE_DISCUSSION' }] });
  Object.assign(data.weeklies[0].pages[0], { title: '一周科研进展', intro: '  汇总选题与复现经验。  ',
    heading: '忽略旧标题', theme: '忽略旧摘要', note: 'PRIVATE_WEEKLY_NOTE' });
  const result = catalog(data);
  const daily = result.latest.daily, weekly = result.latest.weekly;
  assert.deepEqual(daily.groups, ['group-2']);
  assert.equal(daily.sections.length, 1);
  assert.deepEqual(daily.sections[0], { group: 'group-2', label: '二群', title: '当天科研讨论',
    summary: '🙂'.repeat(160), url: `${site}daily/2026-10-16/group-2/`,
    read_url: 'https://agenthub-feedback.haoqingeric.workers.dev/read/daily/2026-10-16/group-2/index.md', trend_count: 1 });
  assert.equal([...daily.sections[0].summary].length, 160);
  assert.equal(daily.outline_url, 'https://agenthub-feedback.haoqingeric.workers.dev/content/edition?kind=daily&date=2026-10-16');
  assert.equal(weekly.outline_url, 'https://agenthub-feedback.haoqingeric.workers.dev/content/edition?kind=weekly&date=2026-10-11');
  assert.deepEqual(weekly.sections[0], { group: 'group-3', label: '三群', title: '一周科研进展', summary: '汇总选题与复现经验。',
    url: `${site}weekly/2026-10-05/2026-10-11/group-3/`, trend_count: 0 });
  assert.ok(!Object.hasOwn(weekly.sections[0], 'read_url'), 'weekly sections must not invent a nonexistent Markdown file');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|speaker|avatar|忽略旧/);
  assert.equal(result.entries.filter(entry => entry.kind === 'daily' && !entry.trend).length, 1, 'sections do not duplicate story entries');
});

test('daily outlines omit empty drafts but retain readable trend-only sections', () => {
  const data = source();
  data.digests[0].pages.push({ id: 'group-1', heading: '空稿', theme: '空稿摘要', stories: [{ title: '空故事', text: '  ' }],
    trends: [{ text: '' }], papers: [] });
  data.digests[0].pages.push({ id: 'external', stories: [], theme: '资讯观察',
    trends: [{ text: '资讯趋势。' }, { text: '\n' }, { text: null }] });
  const result = catalog(data), daily = result.latest.daily;
  assert.deepEqual(daily.groups, ['group-2', 'external']);
  assert.deepEqual(daily.sections.map(section => section.group), daily.groups);
  assert.equal(daily.sections[0].title, '二群', 'missing heading uses the existing group label');
  assert.equal(daily.sections[0].summary, '');
  assert.equal(daily.sections[1].title, '外部资讯');
  assert.equal(daily.sections[1].trend_count, 1);
  assert.equal(daily.sections[1].summary, '资讯观察');
  assert.equal(result.entries.filter(entry => entry.kind === 'daily' && !entry.trend).length, 1);
  const trends = result.entries.filter(entry => entry.trend);
  assert.deepEqual(trends.map(entry => [entry.group, entry.text]), [['external', '资讯趋势。']], 'blank observations get no entry');
  assert.match(trends[0].id, /^daily:2026-10-16:external:trend-[a-f0-9]{24}$/);
  assert.match(trends[0].url, /#trends-heading$/);
  data.digests.push({ date: '2026-10-17', pages: [{ id: 'group-1', heading: '未发布稿', stories: [], trends: [] }] });
  assert.equal(catalog(data).latest.daily.date, '2026-10-16');
});

test('fifth-group content outlines use its reader label without linking group identity', () => {
  const data = source();
  data.digests[0].date = '2026-10-20';
  data.digests[0].pages[0].id = 'group-5';
  const section = catalog(data).latest.daily.sections[0];
  assert.equal(section.label, '五群');
  assert.equal(section.title, '五群');
  assert.match(section.read_url, /\/daily\/2026-10-20\/group-5\/index\.md$/);
});

test('writer emits bounded single-topic files linked by each catalog result', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'agenthub-content-test-'));
  try {
    const result = catalog(source());
    await writeContentFiles(out, result);
    assert.deepEqual(JSON.parse(await readFile(path.join(out, 'search/catalog.json'), 'utf8')), result);
    for (const entry of result.entries) {
      const json = JSON.parse(await readFile(path.join(out, entry.read_path), 'utf8'));
      const markdown = await readFile(path.join(out, entry.read_path.replace(/\.json$/, '.md')), 'utf8');
      assert.equal(json.id, entry.id);
      assert.equal(json.text, entry.text);
      assert.ok(markdown.includes(entry.text));
      assert.doesNotMatch(markdown, /PRIVATE_|speaker|avatar/);
      assert.ok(entry.read_url.endsWith('.md'));
      assert.ok(entry.detail_url.endsWith('.json'));
    }
  } finally { await rm(out, { recursive: true, force: true }); }
});
