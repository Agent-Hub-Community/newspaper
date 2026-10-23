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
import { llmModel } from '../llm.mjs';
import { site as publicSite } from '../site.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const site = 'https://example.com/agent_hub';

async function setup(t, reply) {
  const dir = await mkdtemp(path.join(tmpdir(), 'llm-tools-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    const { status = 200, content } = reply(requests.at(-1));
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: llmModel, choices: [{ finish_reason: 'stop', message: { content } }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const run = (script, args) => exec(process.execPath, [path.join(root, 'scripts', script), ...args], {
    env: { ...process.env, DAILY_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` }, timeout: 20000 });
  return { dir, requests, run };
}

test('bot message covers only pages with stories, links each once and rejects empty-page notes', async t => {
  const issue = { date: '2026-10-13', pages: [
    { id: 'group-1', label: '一群', stories: [] },
    { id: 'group-2', label: '二群', stories: [{ title: 'Review cycles', text: 'Models change faster than reviews.' }] },
  ] };
  let dropLink = false, noteEmpty = false;
  const f = await setup(t, request => {
    const { firstLine, sections, rank } = JSON.parse(request.messages[1].content);
    assert.equal(rank, undefined, 'the leaderboard is not offered to the model');
    const lines = [firstLine, ...(noteEmpty ? ['【一群】当天未选编独立话题'] : []),
      `【二群】${sections[0].titles[0]}`, ...(dropLink ? [] : [sections[0].url])];
    return { content: lines.join('\n') };
  });
  const data = path.join(f.dir, 'data.json'), output = path.join(f.dir, 'bot.md');
  await writeFile(data, JSON.stringify({ digests: [issue] }));
  await f.run('generate-bot.mjs', [data, '2026-10-13', output, '--site', site]);
  const input = JSON.parse(f.requests[0].messages[1].content);
  assert.equal(input.firstLine, 'AgentHub 2026.10.13 日报已上线');
  assert.deepEqual(input.sections.map(section => section.url), [`${site}/daily/2026-10-13/group-2/`], 'the empty page is not offered');
  assert.match(await readFile(output, 'utf8'), /daily\/2026-10-13\/group-2\//);

  await writeFile(data, JSON.stringify(issue));
  await f.run('generate-bot.mjs', [data, '2026-10-13', output, '--site', site, '--preview']);
  assert.match(JSON.parse(f.requests[1].messages[1].content).firstLine, /链接待上线核验/);
  await f.run('generate-bot.mjs', [data, '2026-10-13', output]);
  assert.deepEqual(JSON.parse(f.requests[2].messages[1].content).sections.map(section => section.url),
    [`${publicSite}daily/2026-10-13/group-2/`], 'links default to the site in site.mjs');

  noteEmpty = true;
  await assert.rejects(f.run('generate-bot.mjs', [data, '2026-10-13', output, '--site', site]), /mentions an empty page/);
  noteEmpty = false; dropLink = true;
  await assert.rejects(f.run('generate-bot.mjs', [data, '2026-10-13', output, '--site', site]), /Invalid bot message: links/);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
});

test('call-llm stays within the output cap and leaves no stale answer after a failed call', async t => {
  let status = 200;
  const f = await setup(t, () => ({ status, content: '```json\n{"ok":true}\n```' }));
  const prompt = path.join(f.dir, 'prompt.md'), output = path.join(f.dir, 'out.json');
  await writeFile(prompt, 'Return JSON.');
  await assert.rejects(f.run('call-llm.mjs', [prompt, output, '--max-tokens', '64000']), /Usage/);
  assert.equal(f.requests.length, 0);
  await f.run('call-llm.mjs', [prompt, output, '--reasoning', 'high']);
  assert.equal(await readFile(output, 'utf8'), '{"ok":true}\n');
  assert.equal(f.requests[0].reasoning_effort, 'high');
  status = 500;
  await assert.rejects(f.run('call-llm.mjs', [prompt, output]), /"http":500/);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
});
