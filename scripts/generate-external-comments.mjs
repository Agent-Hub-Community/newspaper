import { lstat, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mergeExternalEditions } from '../lib/external-editions.mjs';
import { commentStories, validateComments } from '../lib/story-comments.mjs';

const [input, output, reviewFile] = process.argv.slice(2);
if (!input || !output || path.resolve(input) === path.resolve(output)) {
  throw new Error('Usage: node scripts/generate-external-comments.mjs DRAFT_JSON NEW_OUTPUT_JSON [REVIEW_FILE]');
}
try {
  await lstat(output);
  throw new Error('Output already exists; choose a new output path');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const draft = JSON.parse(await readFile(input, 'utf8'));
const issues = mergeExternalEditions([], [draft]);
const stories = commentStories(issues);
const source = `${output}.issues.json`;
const commentsFile = `${output}.comments.json`;
await writeFile(source, JSON.stringify(issues, null, 2), { mode: 0o600 });
execFileSync(process.execPath, [
  fileURLToPath(new URL('./generate-comments.mjs', import.meta.url)), source, commentsFile,
  ...(reviewFile ? ['', reviewFile] : []),
], { stdio: 'inherit', timeout: 310000 });
const entries = validateComments(JSON.parse(await readFile(commentsFile, 'utf8')), stories);
const comments = new Map(entries.map(entry => [entry.id, entry.comment]));
const result = { ...draft, stories: draft.stories.map((story, index) => ({
  ...story, aiComment: comments.get(stories[index].id),
})) };
mergeExternalEditions([], [result]);
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log(`Added ${entries.length} AI comments; review the enriched draft before importing.`);
