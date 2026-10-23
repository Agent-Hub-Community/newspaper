import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseHTML } from 'linkedom';
import { externalWindow } from '../external-workflow.mjs';

const [date, directory] = process.argv.slice(2);
if (!date || !directory) throw new Error('Usage: node scripts/collect-external.mjs EDITION_DATE NEW_BATCH_DIRECTORY');
const window = externalWindow(date);
const output = path.resolve(directory);
await mkdir(output, { recursive: true, mode: 0o700 });
try {
  await access(path.join(output, 'discovery.json'));
  throw new Error('Use a new batch directory; preserve the earlier snapshot');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const run = promisify(execFile);
const sources = {};
async function get(url, type = 'json') {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}; Retry-After=${r.headers.get('retry-after') || 'none'}`);
  return type === 'json' ? r.json() : r.text();
}
async function capture(name, url, collect) {
  try { sources[name] = { status: 'ok', url, fetchedAt: new Date().toISOString(), data: await collect() }; }
  catch (error) { sources[name] = { status: 'failed', url, fetchedAt: new Date().toISOString(), error: error.message }; }
}
await capture('aihot', 'https://aihot.news/api/v1/hot-topics',
  () => get('https://aihot.news/api/v1/hot-topics'));
await capture('hf', `https://huggingface.co/api/daily_papers?date=${date}`, async () => {
  const rows = await get(`https://huggingface.co/api/daily_papers?date=${date}`);
  return rows.map(({ paper }) => ({ id: paper.id, title: paper.title, votes: paper.upvotes,
    publishedAt: paper.publishedAt, url: `https://huggingface.co/papers/${paper.id}` }))
    .sort((a, b) => b.votes - a.votes).map((row, index) => ({ ...row, rank: index + 1 }));
});
await capture('alpha', 'https://www.alphaxiv.org/', async () => {
  const doc = parseHTML(await get('https://www.alphaxiv.org/', 'text')).document;
  const graphs = [...doc.querySelectorAll('script[type="application/ld+json"]')]
    .flatMap(el => { const value = JSON.parse(el.textContent); return value['@graph'] || [value]; });
  const list = graphs.find(x => x['@type'] === 'ItemList' && x.name === 'Trending Papers');
  if (!list) throw new Error('Explicit ranking unavailable; do not infer rank from DOM position');
  return list.itemListElement.map(({ position, item }) => ({
    rank: position, title: item.headline, url: item.url, interactions: item.interactionStatistic,
  }));
});
await capture('hn', 'https://news.ycombinator.com/', async () => {
  const { stdout } = await run('opencli', ['hackernews', 'top', '--limit', '60', '-f', 'json'],
    { timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
});
const since = new Date(Date.parse(window.windowStart)).toISOString().slice(0, 10);
const until = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
await capture('x', 'https://x.com/', async () => {
  const query = `(AI OR LLM OR agent OR Claude OR Copilot OR OpenAI) since:${since} until:${until} min_faves:500 -filter:replies`;
  const { stdout } = await run('opencli', ['twitter', 'search', query, '--limit', '40', '-f', 'json'],
    { timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  const rows = JSON.parse(stdout);
  return { query, rows, eligible: rows.filter(row => Date.parse(row.created_at) >= Date.parse(window.windowStart) &&
    Date.parse(row.created_at) < Date.parse(window.cutoff)) };
});
const cutoff = new Date().toISOString();
const intersection = sources.hf.status === 'ok' && sources.alpha.status === 'ok'
  ? sources.hf.data.filter(p => p.rank <= 5 && sources.alpha.data.some(a =>
    a.rank <= 5 && new URL(a.url).pathname.split('/').at(-1) === p.id)).map(p => p.id) : null;
const failed = Object.entries(sources).filter(([, value]) => value.status === 'failed').map(([key]) => key);
await writeFile(path.join(output, 'discovery.json'), JSON.stringify({
  ...window, collectedAt: cutoff, sources, paperTop5Intersection: intersection,
  complete: failed.length === 0,
  notes: ['Edition is the content date in Asia/Shanghai, not the generation date. AIHOT uses a rolling 48-hour window; HF uses the edition date; alpha and HN are current snapshots.',
    'This bounded discovery is not exhaustive. Follow event-specific original links and perform targeted X reads.'],
}, null, 2), { mode: 0o600 });
await writeFile(path.join(output, 'selection.json'), JSON.stringify({
  ...window, collectedAt: cutoff, candidates: [], rejected: [], coverageNotes: failed.map(name => `${name}: collection failed`),
}, null, 2), { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ output, failed, paperTop5Intersection: intersection }));
if (failed.length) process.exitCode = 1;
