import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sanitizeInput, validateDraft, readerPage } from '../lib/daily-generation.mjs';

const input = { group: { id: 'group-1', label: '一群' }, date: '2026-09-23',
  cutoff: '2026-09-23T09:41:09Z', messages: [{ id: 'm0001', content: '一项有条件的观察' }] };
const story = { category: '评测', title: '一个问题', text: '一次观察', topic_key: 'evaluation',
  evidence_ids: ['m0001'], claims: [{ text: '一次观察', kind: 'reported_experience', evidence_ids: ['m0001'] }] };
const draft = () => ({ heading: '今天的讨论', theme: '评测问题', stories: [structuredClone(story)], resources: [] });
test('daily packaging preserves long discussion paragraphs and composes uncapped editorial guidance', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'daily-depth-'));
  try {
    const date = input.date;
    await mkdir(path.join(dir, date));
    const d = draft();
    d.stories[0].text = Array.from({ length: 12 }, (_, i) =>
      `第${i + 1}轮讨论提出不同条件：已有观察只覆盖特定任务，仍需比较其他场景中的结果。`).join('\n\n');
    d.stories[0].emphasis = ['已有观察只覆盖特定任务'];
    // A repeated phrase is not a valid highlight even in an expanded discussion.
    assert.throws(() => validateDraft(d, input), /emphasis/);
    d.stories[0].emphasis = ['第1轮讨论提出不同条件'];
    for (const [suffix, data] of Object.entries({
      'input.json': { ...input, coverage: { count: 1, completeDay: true } },
      'draft.json': d,
      'draft.json.run.json': { model: 'test-fixture' },
    })) await writeFile(path.join(dir, date, `group-1.${suffix}`), JSON.stringify(data));
    execFileSync(process.execPath, [new URL('../scripts/prepare-week-d.mjs', import.meta.url).pathname,
      'package', date, date, dir, '--emphasis']);
    const issues = JSON.parse(await readFile(path.join(dir, 'issues.json'), 'utf8'));
    assert.equal(issues[0].pages[0].stories[0].text, d.stories[0].text);
    assert.deepEqual(issues[0].pages[0].stories[0].emphasis, d.stories[0].emphasis);
    const prompt = await readFile(path.join(dir, 'prompt.md'), 'utf8');
    // Length follows the information in each story, so the prompt must not cap characters per story.
    assert.ok(prompt.endsWith(await readFile(new URL('../prompts/daily-emphasis.md', import.meta.url), 'utf8')));
    assert.match(prompt, /篇幅跟着信息量走/);
    assert.doesNotMatch(prompt, /每条正文不超过\s*\d+\s*字/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('story count follows evidence coverage, including rich and sparse days', () => {
  for (const n of [0, 1, 6, 9, 12, 20]) {
    const d = draft();
    d.stories = Array.from({ length: n }, (_, i) => ({ ...structuredClone(story), title: `观点${i}` }));
    assert.equal(readerPage(d, input).stories.length, n);
  }
});
test('expanded editions still reject duplicate titles and unaudited tail stories', () => {
  const d = draft();
  d.stories = Array.from({ length: 12 }, (_, i) => ({ ...structuredClone(story), title: `观点${i}` }));
  d.stories[11].evidence_ids = ['unknown'];
  assert.throws(() => validateDraft(d, input), /evidence/);
  d.stories[11] = structuredClone(d.stories[0]);
  assert.throws(() => validateDraft(d, input), /Duplicate title/);
});
test('reader projection removes audit, source IDs and arbitrary model fields', () => {
  const d = draft(); d.secret = 'never';
  assert.doesNotMatch(JSON.stringify(readerPage(d, input)), /evidence|claims|topic_key|never|m0001/);
});
test('reject invented references, private content and unsupported links', () => {
  const d = draft(); d.stories[0].evidence_ids = ['m9999'];
  assert.throws(() => validateDraft(d, input), /evidence/);
  const p = draft(); p.stories[0].text = 'wxid_private';
  assert.throws(() => validateDraft(p, input), /Private/);
  const r = draft(); r.resources = [{ url: 'https://example.com', evidence_ids: ['m0001'] }];
  assert.throws(() => validateDraft(r, input), /Invented/);
});
test('generation input removes media keys and link tokens', () => {
  const data = sanitizeInput({ messages: [{ content: 'https://example.com/?xsec_token=secret&v=1 wxid_abc <msg><img aeskey="secret"></msg>' }] });
  assert.doesNotMatch(JSON.stringify(data), /secret|wxid_abc|<img/);
});
test('model emphasis survives reader projection without changing body or sharing mutable arrays', () => {
  const d = draft();
  d.stories[0].text = '代打电话可以办事，但申请商业号码需要审核，当前还需要用户自己处理。';
  d.stories[0].emphasis = ['代打电话', '需要审核'];
  validateDraft(d, input, { requireEmphasis: true });
  const page = readerPage(d, input);
  assert.equal(page.stories[0].text, d.stories[0].text);
  assert.deepEqual(page.stories[0].emphasis, d.stories[0].emphasis);
  page.stories[0].emphasis.push('changed');
  assert.equal(d.stories[0].emphasis.length, 2);
});
test('emphasis rejects missing, fabricated, repeated, overlapping and excessive spans', () => {
  assert.throws(() => validateDraft(draft(), input, { requireEmphasis: true }), /emphasis/);
  for (const phrases of [null, ['不存在'], ['关键', '关键'], ['关键短语', '短语'],
    ['关键短语比较长而且几乎占了整个正文'], ['重复']]) {
    const d = draft();
    d.stories[0].text = '关键短语比较长而且几乎占了整个正文，重复重复。';
    d.stories[0].emphasis = phrases;
    assert.throws(() => validateDraft(d, input), /emphasis/);
  }
  const d = draft(); d.stories[0].emphasis = [];
  assert.doesNotThrow(() => validateDraft(d, input, { requireEmphasis: true }));
});
test('daily projection retains emphasis across three paragraphs and rejects third-span overlap', () => {
  const d = draft();
  d.stories[0].text = `首段观察具体机制，${'背景说明。'.repeat(10)}\n\n次段提出证据，${'背景说明。'.repeat(10)}\n\n末段解释限制，${'背景说明。'.repeat(10)}`;
  d.stories[0].emphasis = ['首段观察具体机制', '次段提出证据', '末段解释限制'];
  assert.deepEqual(readerPage(d, input).stories[0].emphasis, d.stories[0].emphasis);
  d.stories[0].emphasis = ['首段观察具体机制', '次段提出证据', '解释限制', '末段解释限制'];
  assert.throws(() => validateDraft(d, input), /Overlapping emphasis/);
  d.stories[0].emphasis = ['证据，' + '背景说明。'.repeat(10) + '\n\n末段'];
  assert.throws(() => validateDraft(d, input), /Invalid emphasis/);
});
