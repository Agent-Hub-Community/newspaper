import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { validateDraft, readerPage } from '../lib/daily-generation.mjs';
import { validatePublicActivity } from '../lib/public-activity.mjs';

// Explicit release packaging: revalidate the reviewed source, copy only reader fields.
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = process.argv[2];
if (!directory) throw new Error('Provide the reviewed draft directory');
const issue = JSON.parse(await readFile(path.join(directory, 'agent.issue.json'), 'utf8'));
assert.match(issue.date, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(issue.id, issue.date);
assert.equal(issue.pages.length, 3);
const cutoffs = new Set();
for (let i = 0; i < 3; i++) {
  const input = JSON.parse(await readFile(path.join(directory, `group-${i + 1}.input.json`), 'utf8'));
  const draft = JSON.parse(await readFile(path.join(directory, `group-${i + 1}.agent.json`), 'utf8'));
  validateDraft(draft, input);
  assert.equal(input.date, issue.date);
  assert.equal(input.group.id, `group-${i + 1}`);
  assert.deepEqual(issue.pages[i], readerPage(draft, input));
  cutoffs.add(input.cutoff);
}
assert.equal(cutoffs.size, 1);
const reader = { id: issue.id, date: issue.date, label: `${issue.date} 讨论选编`, pages: issue.pages };
await mkdir(path.join(root, 'editions'), { recursive: true });
await writeFile(path.join(root, 'editions', `${issue.date}.json`), JSON.stringify(reader, null, 2) + '\n');
const { digests } = await import('../lib/digest.mjs');
const snapshotDir = path.join(directory, 'activity');
const snapshot = JSON.parse(await readFile(path.join(snapshotDir, 'snapshot.json'), 'utf8'));
validatePublicActivity(snapshot, digests);
const target = path.join(root, 'public-activity');
for (const file of Object.values(snapshot.avatars)) await copyFile(path.join(snapshotDir, file), path.join(target, file));
await writeFile(path.join(target, 'snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Packaged ${reader.date}: ${reader.pages.length} groups and approved Top 3 only`);
