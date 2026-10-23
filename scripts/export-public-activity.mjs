import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { projectActivity } from '../lib/public-activity.mjs';
import { digests } from '../lib/digest.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'scratch/activity');
const target = path.join(root, 'data/public-activity');
// Pass visually reviewed placeholder/missing avatar keys as positional arguments.
const unavailable = new Set(process.argv.slice(2));
const activity = JSON.parse(await readFile(path.join(source, 'activity.local.json'), 'utf8'));
const { snapshot, copies } = projectActivity(activity, digests, unavailable);
await rm(target, { recursive: true, force: true });
await mkdir(path.join(target, 'avatars'), { recursive: true });
for (const { source: file, destination } of copies) {
  await copyFile(path.join(source, file), path.join(target, destination));
}
await writeFile(path.join(target, 'snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Exported approved Top 3 snapshot with ${copies.length} avatars, as of ${snapshot.generatedAt}.`);
