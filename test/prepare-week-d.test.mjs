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
import { sanitizeInput } from '../lib/daily-generation.mjs';
import { llmModel } from '../lib/llm.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const date = '2026-09-24';

async function fixture(t, respond) {
  const directory = await mkdtemp(path.join(tmpdir(), 'agenthub-gemini-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const day = path.join(directory, date);
  await mkdir(day);
  const inputs = [1, 2, 3].map(group => ({
    group: { id: `group-${group}`, label: `Group ${group}` }, date,
    cutoff: `${date}T16:00:00Z`, coverage: { count: group === 1 ? 1 : 0, completeDay: true },
    messages: group === 1 ? [{ id: 'm1', content: 'A member reported a failed local test.' }] : [],
  }));
  for (const input of inputs) {
    await writeFile(path.join(day, `${input.group.id}.input.json`), JSON.stringify(input));
  }
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, body: JSON.parse(body) });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(respond(requests.length)));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const run = (mode, ...flags) => exec(process.execPath, [
    path.join(root, 'scripts/prepare-week-d.mjs'), mode, date, date, directory, ...flags,
  ], { env: { ...process.env, DAILY_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` },
    timeout: 20000 });
  const json = async file => JSON.parse(await readFile(file, 'utf8'));
  return { directory, day, inputs, requests, run, json };
}

function response({ invalid = false, model = llmModel, evidenceId = 'm1', emphasis = [] } = {}) {
  return { model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
    heading: 'Local tests', theme: 'A reported test failure',
    stories: [{ category: 'Testing', title: 'A failed test', text: 'A member reported a failed local test.',
      topic_key: 'testing', emphasis, evidence_ids: [invalid ? 'unknown' : evidenceId],
      claims: [{ text: 'A test failed.', kind: 'reported_experience', evidence_ids: [evidenceId] }] }],
    resources: [],
  }) } }], usage: { total_tokens: 100 } };
}

test('batch uses Gemini with the unchanged prompt, retries, resumes and packages actual models', async t => {
  for (const emphasis of [false, true]) {
    await t.test(`emphasis=${emphasis}`, async t => {
      const f = await fixture(t, count => response({ invalid: count === 1 }));
      const flags = emphasis ? ['--emphasis'] : [];
      await f.run('generate', ...flags);
      assert.equal(f.requests.length, 2);
      const parts = ['daily-group.md', ...(emphasis ? ['daily-emphasis.md'] : [])];
      const prompt = (await Promise.all(parts.map(file => readFile(path.join(root, 'prompts', file), 'utf8')))).join('\n\n');
      assert.equal(await readFile(path.join(f.directory, 'prompt.md'), 'utf8'), prompt);
      for (const request of f.requests) {
        assert.equal(request.url, '/v1/chat/completions');
        assert.equal(request.body.model, llmModel);
        assert.deepEqual(request.body.messages, [
          { role: 'system', content: prompt },
          { role: 'user', content: JSON.stringify(sanitizeInput(f.inputs[0])) },
        ]);
        assert.equal(request.body.tools, undefined);
      }
      const output = path.join(f.day, 'group-1.draft.json');
      const info = await f.json(`${output}.run.json`);
      assert.equal(info.model, llmModel);
      assert.equal('promptSHA256' in info, false);
      assert.equal('inputSHA256' in info, false);
      assert.equal(info.route, 'single-chat-completion-no-tools');
      assert.deepEqual(info.usage, { total_tokens: 100 });
      assert.ok(Number.isFinite(info.elapsedMs));
      const draftBytes = await readFile(output);
      const responseBytes = await readFile(`${output}.response.json`);
      assert.deepEqual(await f.json(path.join(f.directory, 'failures.json')), []);
      assert.deepEqual((await f.json(path.join(f.day, 'group-2.draft.json'))).stories, []);
      await f.run('package', ...flags);
      const manifest = await f.json(path.join(f.directory, 'manifest.json'));
      assert.deepEqual(manifest.map(entry => entry.model), [llmModel, null, null]);
      assert.ok(manifest.every(entry => !('promptSHA256' in entry)));
      const reportPath = path.join(f.directory, '\u4e00\u5468\u539f\u7a3f.md');
      const report = await readFile(reportPath, 'utf8');
      assert.ok(report.includes(llmModel));
      assert.doesNotMatch(report, /Claude/);
      await f.run('generate', ...flags, '--resume');
      assert.equal(f.requests.length, 2);
      assert.deepEqual(await readFile(output), draftBytes);
      assert.deepEqual(await readFile(`${output}.response.json`), responseBytes);

      // Historical audit hashes are ignored, without rewriting the original provenance.
      const legacyInfo = JSON.stringify({ ...info, model: 'claude-opus-5-5',
        promptSHA256: 'historical-prompt', inputSHA256: 'historical-input' });
      await writeFile(`${output}.run.json`, legacyInfo);
      await f.run('generate', ...flags, '--resume');
      assert.equal(f.requests.length, 2);
      assert.equal(await readFile(`${output}.run.json`, 'utf8'), legacyInfo);
      await f.run('package', ...flags);
      assert.match(await readFile(reportPath, 'utf8'), /claude-opus-5-5/);

      await f.run('generate', ...flags);
      assert.equal(f.requests.length, 3, 'without resume, regenerate successful drafts');
      assert.equal((await f.json(`${output}.run.json`)).model, llmModel);
    });
  }
});

test('emphasis-only failures are repaired before the draft is regenerated', async t => {
  const f = await fixture(t, count => response({ emphasis: count === 1 ? ['not in the text'] : ['failed'] }));
  await f.run('generate', '--emphasis');
  assert.equal(f.requests.length, 2);
  const [, , previous, repair] = f.requests[1].body.messages;
  assert.equal(previous.content, response({ emphasis: ['not in the text'] }).choices[0].message.content);
  assert.match(repair.content, /只修正 emphasis/);
  const output = path.join(f.day, 'group-1.draft.json');
  assert.deepEqual((await f.json(output)).stories[0].emphasis, ['failed']);
  assert.equal((await f.json(`${output}.run.json`)).route, 'emphasis-validation-repair-no-tools');
  assert.deepEqual(await f.json(path.join(f.directory, 'failures.json')), []);
});

test('a failed call leaves no stale raw response for emphasis repair', async t => {
  const f = await fixture(t, () => response());
  const output = path.join(f.day, 'group-1.draft.json');
  await writeFile(`${output}.response.json`, JSON.stringify(response({ emphasis: ['not in the text'] })));
  const server = createServer((req, res) => { res.statusCode = 500; res.end('{}'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const args = [path.join(root, 'scripts/generate-daily-gemini.mjs'), path.join(f.day, 'group-1.input.json'), output,
    path.join(root, 'prompts/daily-group.md'), '--require-emphasis'];
  const options = { env: { ...process.env, DAILY_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` }, timeout: 20000 };
  await assert.rejects(exec(process.execPath, args, options), /HTTP 500/);
  await assert.rejects(exec(process.execPath, [...args, '--repair-emphasis'], options), /ENOENT/);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
});

test('resume validates against current input without requiring run metadata', async t => {
  let evidenceId = 'm1';
  const f = await fixture(t, () => response({ evidenceId }));
  await f.run('generate');
  const output = path.join(f.day, 'group-1.draft.json');
  await rm(`${output}.run.json`);
  f.inputs[0].messages[0].content += ' Further details were added.';
  await writeFile(path.join(f.day, 'group-1.input.json'), JSON.stringify(f.inputs[0]));
  await f.run('generate', '--resume');
  assert.equal(f.requests.length, 1, 'valid drafts are reused even when input text changes');

  evidenceId = 'm2';
  f.inputs[0].messages[0].id = evidenceId;
  await writeFile(path.join(f.day, 'group-1.input.json'), JSON.stringify(f.inputs[0]));
  await f.run('generate', '--resume');
  assert.equal(f.requests.length, 2, 'evidence absent from current input triggers generation');
  assert.deepEqual((await f.json(output)).stories[0].evidence_ids, ['m2']);
});

test('resume regenerates missing, malformed and emphasis-invalid drafts', async t => {
  const f = await fixture(t, () => response());
  await f.run('generate', '--resume');
  assert.equal(f.requests.length, 1);
  const output = path.join(f.day, 'group-1.draft.json');
  await writeFile(output, '{');
  await f.run('generate', '--resume');
  assert.equal(f.requests.length, 2);
  const draft = await f.json(output);
  delete draft.stories[0].emphasis;
  await writeFile(output, JSON.stringify(draft));
  await f.run('generate', '--resume');
  assert.equal(f.requests.length, 2);
  await f.run('generate', '--resume', '--emphasis');
  assert.equal(f.requests.length, 3);
  assert.deepEqual((await f.json(output)).stories[0].emphasis, []);
});

test('unexpected response models fail after one retry and leave no successful draft', async t => {
  const f = await fixture(t, () => response({ model: 'other-model' }));
  await assert.rejects(f.run('generate', '--emphasis'), /1 generations failed/);
  assert.equal(f.requests.length, 2);
  const failures = await f.json(path.join(f.directory, 'failures.json'));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].id, 'group-1');
  await assert.rejects(readFile(path.join(f.day, 'group-1.draft.json')), { code: 'ENOENT' });
});
