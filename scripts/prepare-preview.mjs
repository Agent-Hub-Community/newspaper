// Builds a daily batch as a local preview (with static attachments) and writes final-reader-issue.json.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readBuiltData } from '../lib/built-data.mjs';
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
const issuesFile = path.join(batch, 'issues.json'), activityFile = path.join(batch, 'activity/snapshot.json');

execFileSync(process.execPath, ['build.mjs', '--draft', issuesFile, '--draft-activity', activityFile, '--attachment-dir', path.resolve(batch),
  ...(external ? ['--draft-external', external, ...(selection ? [selection] : [])] : [])], { cwd: root, stdio: 'inherit' });
const out = path.join(root, 'dist-preview');
const data = await readBuiltData(out);
assert.equal(data.publicBuild, false);
const built = data.digests.find(issue => issue.date === date);
assert.ok(built, `${date} is missing from the preview build`);

// Served from the batch's preview/ directory, the copy sits under the same base path as the public site.
const preview = path.join(path.resolve(root, batch, 'preview'), basePath);
await rm(preview, { recursive: true, force: true });
await mkdir(path.dirname(preview), { recursive: true });
await cp(out, preview, { recursive: true });
await writeFile(path.resolve(root, batch, 'final-reader-issue.json'), JSON.stringify(built, null, 2));
console.log(JSON.stringify({ preview: `${base}/daily/${date}/`, pages: built.pages.map(page => [page.id, page.stories?.length || 0]) }));
