import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readBuiltData } from '../built-data.mjs';
import { libraryFeedbackId } from '../feedback-id.mjs';

const { positionals } = parseArgs({ allowPositionals: true });
if (positionals.length !== 2) throw new Error('Usage: node scripts/feedback-catalog.mjs dist/data.js scratch/catalog.sql');
// Stories live in dist/issues/<date>.js next to the data.js index.
const data = await readBuiltData(path.dirname(positionals[0]));
if (!data.publicBuild) throw new Error('Only approved public editions can be registered for online feedback');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const rows = data.digests.flatMap(issue => issue.pages.flatMap(page => (page.stories || []).map(story => {
  if (!/^[a-f0-9]{32}$/.test(story.feedbackId)) throw new Error('Missing feedback ID');
  return `INSERT OR IGNORE INTO stories (id, date, group_id, title) VALUES (${[story.feedbackId, issue.date, page.id, story.title].map(quote).join(', ')});`;
})));
// Library items register under the "library" collection; the worker reads them in one request.
const library = JSON.parse(await readFile(path.join(path.dirname(positionals[0]), 'library/resources.json'), 'utf8'));
const items = library.items.map(item => `INSERT OR IGNORE INTO stories (id, date, group_id, title) VALUES (${[libraryFeedbackId(item.id), item.shared[0].date, 'library', item.title].map(quote).join(', ')});`);
await writeFile(positionals[1], `${[...rows, ...items].join('\n')}\n`);
console.log(`Registered ${rows.length} story revisions and ${items.length} library items in ${positionals[1]}`);
