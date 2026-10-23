import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeWeeklyIssue } from '../weekly-editions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/import-reviewed-weekly.mjs <reviewed reader directory>');
const directory = path.resolve(source);
const reader = JSON.parse(await readFile(path.join(directory, 'reader.json'), 'utf8'));
if (!/^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(reader.id)) throw new Error('Invalid weekly ID');
const avatars = new Map();
for (const group of reader.rank?.groups || []) for (const leader of group.leaders) {
  if (!leader.avatar) continue;
  if (!/^avatars\/[a-zA-Z0-9-]+\.(jpg|png)$/.test(leader.avatar)) throw new Error('Invalid reviewed avatar');
  const original = leader.avatar;
  leader.avatar = `weekly-assets/${reader.id}/${original}`;
  avatars.set(original, leader.avatar);
}
const issue = normalizeWeeklyIssue(reader);
await mkdir(path.join(root, 'weekly-editions'), { recursive: true });
for (const [original, file] of avatars) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await copyFile(path.join(directory, 'preview', original), path.join(root, file));
}
await writeFile(path.join(root, 'weekly-editions', `${issue.id}.json`), JSON.stringify(issue, null, 2) + '\n');
console.log(JSON.stringify({ id: issue.id, pages: issue.pages.length, avatars: avatars.size }));
