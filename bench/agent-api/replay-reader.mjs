// Replay the recorded reader requests without new query choices or network access.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dist = path.join(root, 'dist');
const original = JSON.parse(await readFile(path.join(here, 'heldout-reader-audit.json'), 'utf8'));
globalThis.fetch = async () => { throw new Error('Network access disabled in reader replay'); };
const { createContentAPI } = await import('../../feedback/content-api.mjs');
const { createLibrarySearch } = await import('../../feedback/library-search.mjs');
const { agentReads } = await import('../../feedback/agent-reads.mjs');
const { contentBase, contentAPIBase } = await import('../../lib/agent-reading.mjs');
async function fixture(url) {
  if (!url.startsWith(contentBase)) throw new Error('Unexpected upstream origin');
  const file = path.resolve(dist, url.slice(contentBase.length));
  if (!file.startsWith(dist + path.sep)) throw new Error('Fixture path escapes dist');
  try {
    return new Response(await readFile(file), { headers: {
      'Content-Type': file.endsWith('.json') ? 'application/json' : 'text/markdown',
    } });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return new Response('Not found', { status: 404 });
  }
}
const content = createContentAPI(fixture, () => 0);
const library = createLibrarySearch(fixture, () => 0);
const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) } };
function comparable(body) {
  try {
    const data = JSON.parse(body);
    delete data.source_loaded_at;
    return data;
  } catch { return body; }
}
const tasks = [];
for (const task of original.frozen_tasks) {
  const calls = [];
  for (const saved of task.calls) {
    const url = new URL(saved.url);
    if (url.origin !== new URL(contentAPIBase).origin) throw new Error('Unexpected request origin');
    const request = new Request(url);
    const response = url.pathname.startsWith('/content/') ? await content(request, env)
      : url.pathname === '/library/search' ? await library(request, env)
      : url.pathname.startsWith('/read/') ? await agentReads(request, env, fixture) : null;
    if (!response) throw new Error('Unexpected recorded route: ' + url.pathname);
    const body = await response.text();
    calls.push({ url: saved.url, status: response.status, bytes: Buffer.byteLength(body),
      matches_recording: response.status === saved.status && isDeepStrictEqual(comparable(body), comparable(saved.body)) });
  }
  const bytes = calls.reduce((sum, call) => sum + call.bytes, 0);
  tasks.push({ id: task.id, requests: calls.length, response_bytes: bytes,
    within_budget: calls.length <= task.queryBudget && bytes <= task.byteBudget,
    matches_recording: calls.every(call => call.matches_recording), calls });
}
const source_hashes = {};
// The frozen audit names files by their paths when it was recorded; browser files now live in site/.
const currentPath = file => ['bm25.js', 'query.js'].includes(file) ? `site/${file}` : file;
for (const file of [...Object.keys(original.source_hashes).map(currentPath), 'feedback/agent-reads.mjs']) {
  source_hashes[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
}
const report = { generated_at: new Date().toISOString(),
  mode: 'Offline replay of recorded requests; no new retrieval choices, model run, or network calls',
  ignored_response_fields: ['source_loaded_at'], source_hashes,
  requests: tasks.reduce((sum, task) => sum + task.requests, 0),
  response_bytes: tasks.reduce((sum, task) => sum + task.response_bytes, 0),
  passed: tasks.every(task => task.matches_recording && task.within_budget), tasks };
await writeFile(path.join(here, 'reader-replay.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, requests: report.requests, response_bytes: report.response_bytes,
  tasks: tasks.map(({ calls, ...result }) => result) }, null, 2));
if (!report.passed) process.exitCode = 1;
