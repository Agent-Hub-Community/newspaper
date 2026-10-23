// Builds the reviewed daily batch as a local preview and proves it matches the review inputs.
// Replaces the per-batch prepare-local.mjs copies, which patched dist-preview/data.js by hand.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readBuiltData } from '../lib/built-data.mjs';
import { mergeExternalEditions } from '../lib/external-editions.mjs';
import { readerReport } from '../lib/external-workflow.mjs';
import { basePath } from '../lib/site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  date: { type: 'string' }, batch: { type: 'string' },
  'external-draft': { type: 'string' }, 'external-selection': { type: 'string' },
  base: { type: 'string', default: `http://127.0.0.1:8780${basePath.replace(/\/$/, '')}` },
} });
const { date, batch, base } = values;
assert.match(date || '', /^\d{4}-\d{2}-\d{2}$/, 'Use --date YYYY-MM-DD');
assert.ok(batch, 'Use --batch scratch/day-YYYY-MM-DD-runN');
const external = values['external-draft'], selection = values['external-selection'];
assert.ok(Boolean(external) === Boolean(selection), 'Pass --external-draft and --external-selection together');
const read = file => readFile(path.resolve(root, file), 'utf8').then(JSON.parse);
const issuesFile = path.join(batch, 'issues.json'), activityFile = path.join(batch, 'activity/snapshot.json');

execFileSync(process.execPath, ['build.mjs', '--draft', issuesFile, '--draft-activity', activityFile,
  ...(external ? ['--draft-external', external, selection] : [])], { cwd: root, stdio: 'inherit' });
const out = path.join(root, 'dist-preview');
const data = await readBuiltData(out);
assert.equal(data.publicBuild, false);
assert.equal(data.feedbackEndpoint, '');

// The built issue must be exactly the reviewed batch plus the reviewed external page.
const expected = mergeExternalEditions(await read(issuesFile), external ? [readerReport(await read(external))] : [])
  .find(issue => issue.date === date);
const built = data.digests.find(issue => issue.date === date);
assert.ok(expected && built, `${date} is missing from the review inputs or the build`);
const withoutFeedback = structuredClone(built);
for (const page of withoutFeedback.pages) for (const story of page.stories || []) {
  assert.match(story.feedbackId, /^[a-f0-9]{32}$/);
  delete story.feedbackId;
}
const { version, ...comparable } = withoutFeedback;
assert.deepEqual(comparable, expected);
assert.deepEqual(data.activity, await read(activityFile));

// Served from the batch's preview/ directory, the copy sits under the same base path as the public site.
const preview = path.join(path.resolve(root, batch, 'preview'), basePath);
await rm(preview, { recursive: true, force: true });
await mkdir(path.dirname(preview), { recursive: true });
await cp(out, preview, { recursive: true });
const save = (file, value) => writeFile(path.resolve(root, batch, file), JSON.stringify(value, null, 2));
await save('final-reader-issue.json', built);
await save('integration-validation.json', {
  date, base, sourceEquality: true, activityEquality: true, publicBuild: false, feedbackDisabled: true,
  externalDraft: external || null, externalSelection: selection || null,
});
console.log(JSON.stringify({ preview: `${base}/daily/${date}/`, pages: built.pages.map(page => [page.id, page.stories?.length || 0]) }));
