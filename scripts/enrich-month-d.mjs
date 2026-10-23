import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { applyComments } from '../story-comments.mjs';
import { feedbackId } from '../feedback-id.mjs';

const directory = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Provide the month draft directory');
const issues = JSON.parse(await readFile(path.join(directory, 'issues.json'), 'utf8'));
const jobs = [];
const parts = [];
for (let i = 0; i < issues.length; i += 5) {
  const batch = issues.slice(i, i + 5);
  const dir = path.join(directory, 'enrichment', String(i / 5 + 1));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'issues.json');
  await writeFile(file, JSON.stringify(batch, null, 2), { mode: 0o600 });
  parts.push(dir);
  if (!process.argv.includes('--assemble')) {
    for (const type of ['comments', 'headlines', 'emphasis']) jobs.push({ type, file, dir });
  }
}
const errors = [];
await Promise.all([0, 1, 2].map(async () => {
  while (jobs.length) {
    const { type, file, dir } = jobs.shift();
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [new URL(`generate-${type}.mjs`, import.meta.url).pathname,
          file, path.join(dir, `${type}.json`)], { stdio: 'inherit', env: process.env });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${type} ${dir}: ${code}`)));
      });
    } catch (error) { errors.push(error.message); }
  }
}));
if (errors.length) throw new Error(errors.join('\n'));
const comments = [], headlines = [], emphasis = [];
for (const dir of parts) {
  comments.push(...JSON.parse(await readFile(path.join(dir, 'comments.json'), 'utf8')));
  headlines.push(...JSON.parse(await readFile(path.join(dir, 'headlines.json'), 'utf8')));
  emphasis.push(...JSON.parse(await readFile(path.join(dir, 'emphasis.json'), 'utf8')));
}
applyComments(issues, comments);
const spans = new Map(emphasis.map(e => [e.id, e.emphasis]));
for (const issue of issues) for (const page of issue.pages) for (const story of page.stories) {
  story.emphasis = spans.get(feedbackId(issue.date, page.id, story));
  if (!story.emphasis) throw new Error('Missing emphasis');
}
for (const entry of headlines) {
  const [date, id] = entry.id.split('/');
  const page = issues.find(i => i.date === date)?.pages.find(p => p.id === id);
  if (!page) throw new Error('Unknown headline');
  page.heading = entry.heading;
  page.theme = entry.theme;
}
for (const [name, value] of Object.entries({ comments, headlines, emphasis, issues })) {
  await writeFile(path.join(directory, `${name}.json`), JSON.stringify(value, null, 2), { mode: 0o600 });
}
console.log(`Enriched ${issues.length} editions with ${comments.length} comments and ${headlines.length} headlines`);
