import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commentStories } from '../story-comments.mjs';
import { packageResources } from '../scripts/package-month-resources.mjs';
import { llmModel } from '../llm.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const input = {
  date: '2026-09-24', group: { id: 'group-1', label: 'Group 1' },
  messages: [{ id: 'm1', content: 'UrbanGround paper https://arxiv.org/abs/1' }],
};
const draft = {
  heading: 'UrbanGround', theme: 'A shared paper', resources: [],
  stories: [{ category: 'Paper', title: 'UrbanGround paper', text: 'A member shared the UrbanGround paper.',
    topic_key: 'urban', evidence_ids: ['m1'],
    claims: [{ text: 'A paper was shared.', kind: 'shared_link', evidence_ids: ['m1'] }] }],
};

async function directory(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'agenthub-records-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('HTTP generators preserve responses and usage without audit hashes', async t => {
  for (const variant of ['daily', 'comments', 'comments-custom', 'emphasis', 'emphasis-custom']) {
    await t.test(variant, async t => {
      const kind = variant.replace('-custom', '');
      const custom = variant.endsWith('-custom');
      const dir = await directory(t);
      const issues = [{ date: input.date, pages: [{ id: input.group.id, stories: draft.stories }] }];
      const id = commentStories(issues)[0].id;
      const generated = kind === 'daily' ? draft : kind === 'comments'
        ? [{ id, comment: 'The reported result still needs an independent test.' }]
        : [{ id, emphasis: ['UrbanGround'] }];
      const result = kind === 'daily'
        ? { model: 'test-responses-model', status: 'completed', output_text: JSON.stringify(generated),
          usage: { total_tokens: 42 } }
        : { model: llmModel, choices: [{ finish_reason: 'stop',
          message: { content: JSON.stringify(generated) } }], usage: { total_tokens: 42 } };
      const requests = [];
      const server = createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        requests.push({ url: req.url, authorization: req.headers.authorization, body: JSON.parse(body) });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      t.after(() => new Promise(resolve => server.close(resolve)));
      const file = path.join(dir, 'input.json'), output = path.join(dir, 'output.json');
      await writeFile(file, JSON.stringify(kind === 'daily' ? input : issues));
      const promptFile = path.join(dir, 'custom.md');
      if (custom) await writeFile(promptFile, 'Select grounded content without rewriting.');
      await exec(process.execPath, [path.join(root, `scripts/generate-${kind}.mjs`), file, output,
        ...(custom ? [promptFile] : [])], {
        env: { ...process.env, DAILY_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, DAILY_LLM_API_KEY: 'test-key' },
        timeout: 20000,
      });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, kind === 'daily' ? '/v1/responses' : '/v1/chat/completions');
      if (kind !== 'daily') assert.equal(requests[0].authorization, 'Bearer test-key');
      if (kind === 'daily') {
        const prompt = (await Promise.all(['daily-editor.md', 'daily-reader-copy.md']
          .map(name => readFile(path.join(root, 'prompts', name), 'utf8')))).join('\n\n');
        assert.equal(requests[0].body.instructions, prompt);
      } else if (kind === 'comments') {
        assert.equal(requests[0].body.messages[0].content,
          await readFile(variant === 'comments-custom' ? promptFile : path.join(root, 'prompts/daily-comment.md'), 'utf8'));
      } else if (custom) {
        assert.equal(requests[0].body.messages[0].content, await readFile(promptFile, 'utf8'));
        assert.equal(JSON.parse(requests[0].body.messages[1].content)[0].maxEmphasisCharacters,
          Math.floor(draft.stories[0].text.length * 0.3));
      }
      assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), generated);
      assert.deepEqual(JSON.parse(await readFile(`${output}.response.json`, 'utf8')), result);
      const run = JSON.parse(await readFile(`${output}.run.json`, 'utf8'));
      assert.equal(run.model, result.model);
      assert.deepEqual(run.usage, result.usage);
      assert.equal('promptSHA256' in run, false);
      assert.equal('inputSHA256' in run, false);
      if (kind !== 'emphasis') assert.ok(Number.isFinite(run.elapsedMs));
      if (kind === 'daily') assert.equal(run.route, 'single-llm-call');
    });
  }
});

test('comment requests number stories and map replies and review notes back to feedback ids', async t => {
  const dir = await directory(t);
  const second = { ...draft.stories[0], title: 'Second paper', text: 'Another member shared a second paper.' };
  const issues = [{ date: input.date, pages: [{ id: 'group-1', stories: [draft.stories[0], second] }] }];
  const stories = commentStories(issues);
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    requests.push(request);
    const entries = JSON.parse(request.messages[1].content)
      .map(story => ({ id: story.id, comment: `Comment on ${story.title}.` })).reverse();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: llmModel, choices: [{ finish_reason: 'stop',
      message: { content: JSON.stringify(entries) } }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const file = path.join(dir, 'issues.json'), output = path.join(dir, 'comments.json');
  const reviewFile = path.join(dir, 'review.md');
  await writeFile(file, JSON.stringify(issues));
  await writeFile(reviewFile, `Revise ${stories[1].id}.`);
  await exec(process.execPath, [path.join(root, 'scripts/generate-comments.mjs'), file, output, '', reviewFile], {
    env: { ...process.env, DAILY_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` }, timeout: 20000,
  });
  assert.deepEqual(JSON.parse(requests[0].messages[1].content).map(story => story.id), ['1', '2']);
  assert.match(requests[0].messages[2].content, /Revise 2\./);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')),
    [stories[1], stories[0]].map(story => ({ id: story.id, comment: `Comment on ${story.title}.` })));
});

test('resource audit retains input status and candidates without file hashes or draft edits', async t => {
  const dir = await directory(t), day = path.join(dir, input.date);
  await mkdir(day);
  const inputBytes = JSON.stringify(input), draftBytes = JSON.stringify(draft);
  const inputPath = path.join(day, 'group-1.input.json'), draftPath = path.join(day, 'group-1.draft.json');
  await writeFile(inputPath, inputBytes);
  await writeFile(draftPath, draftBytes);
  await writeFile(path.join(day, 'group-2.input.json'), '{}');
  const { resources, audit } = await packageResources(dir);
  assert.equal(audit.complete_inputs, false);
  assert.deepEqual(audit.files[0], {
    date: input.date, group: 'group-1', state: 'ready', rejected_resources: [],
  });
  assert.equal(audit.files[1].state, 'pending_input');
  for (const file of audit.files) {
    assert.equal('input_sha256' in file, false);
    assert.equal('draft_sha256' in file, false);
  }
  assert.equal(audit.summary.ready_pairs, 1);
  assert.equal(audit.summary.pending_pairs, 1);
  assert.equal(audit.stories[0].candidates[0].url, 'https://arxiv.org/abs/1');
  assert.equal(audit.stories[0].candidates[0].verification.state, 'pending');
  assert.deepEqual(resources[input.date]['group-1'].urban, []);
  assert.equal(await readFile(inputPath, 'utf8'), inputBytes);
  assert.equal(await readFile(draftPath, 'utf8'), draftBytes);
});

test('daily and weekly generators accept three paragraph highlights and reject a third overlapping span', async t => {
  for (const kind of ['emphasis', 'weekly-emphasis', 'weekly-gemini']) {
    await t.test(kind, async t => {
      const dir = await directory(t);
      const text = ['alpha beta gamma', 'second paragraph result', 'third paragraph limit']
        .map(paragraph => `${paragraph} ${'.'.repeat(80)}`).join('\n\n');
      const good = ['alpha', 'second paragraph result', 'third paragraph limit'];
      const bad = ['alpha', 'beta gamma', 'gamma'];
      const story = { ...draft.stories[0], text, review: 'A bounded observation.', emphasis: good };
      const page = { id: 'group-1', title: 'A grounded report', intro: 'This week.', stories: [story] };
      let phrases = good;
      const server = createServer(async (req, res) => {
        for await (const chunk of req) { /* Consume the complete request before responding. */ }
        const id = kind === 'emphasis' ? commentStories([{ date: input.date, pages: [page] }])[0].id : 'group-1:0';
        const generated = kind === 'weekly-gemini' ? { ...page, stories: [{ ...story, emphasis: phrases }] }
          : [{ id, emphasis: phrases }];
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ model: llmModel, choices: [{ finish_reason: 'stop',
          message: { content: JSON.stringify(generated) } }] }));
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      t.after(() => new Promise(resolve => server.close(resolve)));
      const env = { ...process.env, DAILY_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` };
      const file = path.join(dir, kind === 'weekly-emphasis' ? 'group-1.json' : 'input.json');
      const output = kind === 'emphasis' ? path.join(dir, 'output.json') : path.join(dir, 'group-1.json');
      let args;
      if (kind === 'weekly-gemini') {
        await mkdir(path.join(dir, input.date));
        await writeFile(path.join(dir, input.date, 'group-1.input.json'), JSON.stringify(input));
        args = [input.date, input.date, dir, dir, '--groups', 'group-1'];
      } else {
        await writeFile(file, JSON.stringify(kind === 'emphasis' ? [{ date: input.date, pages: [page] }] : page));
        args = kind === 'emphasis' ? [file, output] : [dir];
      }
      const command = [path.join(root, `scripts/generate-${kind}.mjs`), ...args];
      await exec(process.execPath, command, { env, timeout: 20000 });
      const bytes = await readFile(output, 'utf8');
      const result = JSON.parse(bytes);
      assert.deepEqual(kind === 'emphasis' ? result[0].emphasis : result.stories[0].emphasis, good);
      phrases = bad;
      await assert.rejects(() => exec(process.execPath, command, { env, timeout: 20000 }), /[Oo]verlapping.*emphasis/);
      assert.equal(await readFile(output, 'utf8'), bytes);
    });
  }
});
