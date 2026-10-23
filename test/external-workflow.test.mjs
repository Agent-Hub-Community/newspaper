import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { externalWindow, readerReport, validateSelection, validateExternalDraft, validateExternalReview } from '../external-workflow.mjs';
import { mergeExternalEditions } from '../external-editions.mjs';
import { llmModel } from '../llm.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const selection = () => ({
  ...externalWindow('2026-09-26', '2026-09-26T19:00:00Z'),
  candidates: [{ id: 'product', kind: 'news', title: 'Product update', timing: 'September 25',
    selectionReason: 'Observed discussion and a verified announcement',
    attention: [{ platform: 'X', url: 'https://x.com/i/status/123', fetchedAt: '2026-09-25T19:00:00Z',
      observation: '1000 likes at this snapshot' }],
    sources: [{ publisher: 'Vendor', url: 'https://example.com/release', fetchedAt: '2026-09-25T19:00:00Z',
      text: 'The product enters private preview.' }],
  }],
});
const draft = () => ({
  date: '2026-09-26', title: 'Product enters preview', intro: 'A limited release.',
  stories: [{ candidateIds: ['product'], title: 'Preview', timing: 'September 25',
    text: 'The product enters private preview.', emphasis: ['preview'],
    aiComment: 'The waiting room has a release date.',
    links: [{ label: '官方发布', url: 'https://example.com/release' }] }], trends: [],
});
test('links name their target in label and keep the type in kind; older type-only labels still map', () => {
  const data = draft();
  data.stories[0].links = [
    { kind: '论文', label: 'Ouro 论文', url: 'https://example.com/release' },
    { label: '代码', url: 'https://example.com/code' },
  ];
  assert.deepEqual(readerReport(data).stories[0].links.map(link => link.kind), ['论文', undefined]);
  const page = mergeExternalEditions([], [readerReport(data)])[0].pages.find(item => item.id === 'external');
  assert.deepEqual(page.stories[0].resources.map(({ kind, label }) => [kind, label]), [['paper', 'Ouro 论文'], ['code', '代码']]);
});
test('edition window uses China midnight and invalid dates fail', () => {
  assert.equal(selection().windowStart, '2026-09-25T16:00:00.000Z');
  assert.equal(selection().cutoff, '2026-09-26T16:00:00.000Z');
  assert.deepEqual(externalWindow('2026-09-25', '2026-09-25T19:00:00Z'), {
    edition:'2026-09-25', timezone:'Asia/Shanghai',
    windowStart:'2026-09-24T16:00:00.000Z', cutoff:'2026-09-25T16:00:00.000Z',
  });
  assert.throws(() => externalWindow('2026-02-30'));
  assert.throws(() => externalWindow('2026-09-26', '2026-09-24T00:00:00Z'));
  assert.throws(() => validateSelection({ ...selection(), cutoff:'2026-09-27T00:00:00Z' }), /exceeds/);
  assert.throws(() => validateSelection({ ...selection(), windowStart:'2026-09-24T16:00:00Z' }), /content date/);
});
test('selection requires original content and attention; papers need both top-five ranks', () => {
  validateSelection(selection());
  for (const change of [
    item => { item.sources[0].text = ''; },
    item => { item.attention = []; },
    item => { item.sources[0].url = 'http://example.com'; },
    item => { item.kind = 'paper'; item.paperRanks = { hf: 1, alpha: 15 }; },
  ]) {
    const input = selection();
    change(input.candidates[0]);
    assert.throws(() => validateSelection(input));
  }
  const paper = selection();
  Object.assign(paper.candidates[0], { kind: 'paper', paperRanks: { hf: 1, alpha: 3 } });
  validateSelection(paper);
});
test('draft validates per-event links, uniqueness and reader projection', () => {
  const data = draft();
  data.internal = 'private';
  const report = validateExternalDraft(data, selection());
  assert.equal(report.internal, undefined);
  assert.equal(report.stories[0].candidateIds, undefined);
  assert.throws(() => validateExternalDraft({ ...data, date: '2026-09-25' }, selection()));
  assert.throws(() => validateExternalDraft({ ...data, stories: [...data.stories, ...data.stories] }, selection()));
  data.stories[0].links[0].url = 'https://example.com/unread';
  assert.throws(() => validateExternalDraft(data, selection()), /Unverified/);
});
test('expanded editions retain per-event evidence and duplicate gates', () => {
  const input = selection(), data = draft();
  const candidate = input.candidates[0], story = data.stories[0];
  input.candidates = Array.from({ length: 12 }, (_, i) => ({
    ...structuredClone(candidate), id: `product-${i}`, title: `Product ${i}`,
  }));
  data.stories = input.candidates.map((item, i) => ({
    ...structuredClone(story), candidateIds: [item.id], title: `Preview ${i}`,
  }));
  validateExternalDraft(data, input);
  const badLink = structuredClone(data);
  badLink.stories.at(-1).links[0].url = 'https://example.com/unread';
  assert.throws(() => validateExternalDraft(badLink, input), /Unverified/);
  assert.throws(() => validateExternalDraft({ ...data, stories: [...data.stories, data.stories[0]] }, input));
  assert.throws(() => validateExternalDraft({ ...data, stories: [] }, input));
});
test('review is invalidated by prose or evidence changes without hashes', () => {
  const input = selection(), data = draft();
  const review = { status: 'approved', reviewer: 'Editor', reviewedAt: '2026-09-25T19:00:00Z',
    draft: structuredClone(data), selection: structuredClone(input) };
  validateExternalReview(data, input, review);
  const missing = structuredClone(data);
  delete missing.stories[0].aiComment;
  assert.throws(() => validateExternalReview(missing, input, { ...review, draft: missing }), /AI comments/);
  const edited = structuredClone(data);
  edited.stories[0].aiComment = 'The waiting room has new furniture.';
  assert.throws(() => validateExternalReview(edited, input, review), /Draft changed/);
  data.title = 'Changed';
  assert.throws(() => validateExternalReview(data, input, review), /Draft changed/);
  data.title = review.draft.title;
  input.candidates[0].sources[0].text += ' Correction.';
  assert.throws(() => validateExternalReview(data, input, review), /Evidence changed/);
});
test('Gemini generator and review CLI round trip, fail closed for bad model and invented URL', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'external-workflow-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'selection.json'), output = path.join(dir, 'draft.json');
  const receipt = path.join(dir, 'review.json');
  await writeFile(input, JSON.stringify(selection()));
  let result = { model: llmModel, choices: [{ finish_reason: 'stop',
    message: { content: JSON.stringify(draft()) } }], usage: { total_tokens: 10 } };
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const options = { env: { ...process.env, DAILY_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` } };
  const generate = () => run(process.execPath, [path.join(root, 'scripts/generate-external.mjs'), input, output], options);
  await generate();
  assert.equal(requests[0].model, llmModel);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), draft());
  await run(process.execPath, [path.join(root, 'scripts/review-external.mjs'), output, input, receipt, 'Editor', '--approve']);
  validateExternalReview(draft(), selection(), JSON.parse(await readFile(receipt, 'utf8')));
  result.model = 'wrong-model';
  await assert.rejects(generate(), /unexpected model/);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
  result.model = llmModel;
  const bad = draft();
  bad.stories[0].links[0].url = 'https://invented.example/';
  result.choices[0].message.content = JSON.stringify(bad);
  await assert.rejects(generate(), /Unverified story link/);

  // Spans that break the emphasis rules are dropped instead of failing the draft, and the run record
  // names the story so the editor can pick its emphasis again.
  const overBudget = draft();
  overBudget.stories[0].emphasis = ['product', overBudget.stories[0].text, 'not in the text'];
  result.choices[0].message.content = JSON.stringify(overBudget);
  requests.length = 0;
  await generate();
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')),
    { ...draft(), stories: [{ ...draft().stories[0], emphasis: ['product'] }] });
  assert.deepEqual(JSON.parse(await readFile(`${output}.run.json`, 'utf8')).emphasisTrimmed, ['Preview']);
});

test('external comments reuse the original prompt, map by ID and preserve approved copy', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'external-comments-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'draft.json'), output = path.join(dir, 'commented.json');
  const data = draft();
  delete data.stories[0].aiComment;
  data.stories.push({ ...structuredClone(data.stories[0]), candidateIds: ['other'],
    title: 'Another preview', text: 'Another product enters private preview.' });
  const original = JSON.stringify(data);
  await writeFile(input, original);
  let mode = 'valid';
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    requests.push(request);
    const stories = JSON.parse(request.messages[1].content);
    const entries = stories.map((story, i) => ({ id: story.id, comment: `Comment for article ${i + 1}.` })).reverse();
    if (mode === 'missing') entries.pop();
    if (mode === 'unknown') entries[0].id = 'invented';
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: llmModel, choices: [{ finish_reason: 'stop',
      message: { content: JSON.stringify(entries) } }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const generate = target => run(process.execPath, [
    path.join(root, 'scripts/generate-external-comments.mjs'), input, target,
  ], { env: { ...process.env, DAILY_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` } });
  await generate(output);
  assert.equal(requests[0].model, llmModel);
  assert.equal(requests[0].messages[0].content, await readFile(path.join(root, 'prompts/daily-comment.md'), 'utf8'));
  const enriched = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(enriched, { ...data, stories: data.stories.map((story, i) => ({
    ...story, aiComment: `Comment for article ${i + 1}.`,
  })) });
  assert.equal(await readFile(input, 'utf8'), original);
  const reviewFile = path.join(dir, 'review.md');
  await writeFile(reviewFile, 'Keep token units and reporting actors precise.');
  await run(process.execPath, [
    path.join(root, 'scripts/generate-external-comments.mjs'), input, path.join(dir, 'revised.json'), reviewFile,
  ], { env: { ...process.env, DAILY_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` } });
  assert.equal(requests[1].messages[0].content, requests[0].messages[0].content);
  assert.match(requests[1].messages[2].content, /Keep token units/);
  await assert.rejects(generate(output), /Output already exists/);
  await assert.rejects(generate(input), /Usage:/);
  for (mode of ['missing', 'unknown']) {
    const failed = path.join(dir, `${mode}.json`);
    await assert.rejects(generate(failed), /coverage mismatch|Invalid comment/);
    await assert.rejects(readFile(failed), { code: 'ENOENT' });
  }
  const selectionFile = path.join(dir, 'selection.json'), receipt = path.join(dir, 'review.json');
  await writeFile(selectionFile, JSON.stringify(selection()));
  await writeFile(input, JSON.stringify({ ...data, stories: [data.stories[0]] }));
  await assert.rejects(run(process.execPath, [
    path.join(root, 'scripts/review-external.mjs'), input, selectionFile, receipt, 'Editor', '--approve',
  ]), /AI comments/);
  await assert.rejects(readFile(receipt), { code: 'ENOENT' });
});
