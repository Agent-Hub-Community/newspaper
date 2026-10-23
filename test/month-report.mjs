import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

// Run with --experimental-vm-modules; virtual files keep this CLI test read-only.
const source = await readFile(new URL('../scripts/month-report.mjs', import.meta.url), 'utf8');
const issue = (date, groups) => ({ date, pages: groups.map(n => ({
  id: `group-${n}`, label: ['一群', '二群', '三群', '四群'][n - 1],
  stories: [{ text: 'Test', aiComment: 'Comment' }],
})) });
async function run(issues, complete = true) {
  const files = new Map([['/batch/issues.json', JSON.stringify(issues)]]);
  for (const item of issues) for (const page of item.pages.filter(p => p.id.startsWith('group-'))) {
    files.set(`/batch/${item.date}/${page.id}.input.json`, JSON.stringify({
      coverage: { completeDay: complete, paginationExhausted: true, count: Number(page.id.slice(-1)) },
    }));
  }
  const writes = new Map(), logs = [];
  const context = vm.createContext({ process: { argv: ['node', 'month-report.mjs', '/batch'] },
    console: { log: line => logs.push(JSON.parse(line)) } });
  const fs = new vm.SyntheticModule(['readFile', 'writeFile'], function () {
    this.setExport('readFile', async file => {
      assert.ok(files.has(file), `Unexpected read: ${file}`);
      return files.get(file);
    });
    this.setExport('writeFile', async (file, content) => { writes.set(file, content); });
  }, { context });
  const paths = new vm.SyntheticModule(['default'], function () { this.setExport('default', path); }, { context });
  const script = new vm.SourceTextModule(source, { context });
  await script.link(name => ({ 'node:fs/promises': fs, 'node:path': paths })[name]);
  await script.evaluate();
  return { report: writes.get('/batch/整理说明.md'), output: JSON.parse(writes.get('/batch/issues.json')), summary: logs[0] };
}

const historical = issue('2026-09-29', [1, 2, 3]);
const current = issue('2026-09-30', [1, 2, 3, 4]);
current.pages.push({ id: 'external', stories: [{ text: 'External news' }] });
const result = await run([historical, current]);
assert.deepEqual(result.summary.totals, [2, 4, 6, 4]);
assert.deepEqual(result.summary.days, [2, 2, 2, 1]);
assert.equal(result.summary.stories, 7);
assert.match(result.report, /2026-09-29.*未纳入/);
assert.match(result.report, /四群共 4 条记录、1 天有记录/);
assert.doesNotMatch(result.report, /NaN|三路并行|9 月 23 日/);
assert.deepEqual(result.output, [historical, current]);
assert.doesNotMatch((await run([historical])).report, /四群/);
await assert.rejects(run([current], false), /Incomplete export/);
console.log('Month report: three/four-group mixed history, external-page exclusion and incomplete-export rejection passed in memory.');
