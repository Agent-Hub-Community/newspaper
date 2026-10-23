import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const [directory, ...files] = process.argv.slice(2);
if (!directory || !files.length) throw new Error('Provide directory and review files');
const issues = JSON.parse(await readFile(path.join(directory, 'issues.json'), 'utf8'));
const applied = [];
for (const file of files) {
  for (const entry of JSON.parse(await readFile(file, 'utf8'))) {
    const page = issues.find(i => i.date === entry.date)?.pages.find(p => p.id === entry.group);
    if (!entry.title) {
      // Entries without a story title revise the page heading or theme.
      if (!entry.heading && !entry.theme) continue;
      assert.ok(page, `Review page not found: ${entry.date} ${entry.group}`);
      if (entry.heading) page.heading = entry.heading;
      if (entry.theme) page.theme = entry.theme;
      applied.push(entry);
      continue;
    }
    const index = page?.stories.findIndex(s => s.title === entry.title);
    assert.ok(index >= 0, `Review story not found: ${entry.date} ${entry.title}`);
    const input = JSON.parse(await readFile(path.join(directory, entry.date, `${entry.group}.input.json`), 'utf8'));
    assert.ok(entry.evidenceIds.every(id => input.messages.some(m => m.id === id)));
    const story = page.stories[index];
    if (entry.drop) page.stories.splice(index, 1);
    else {
      if (entry.proposedText) story.text = entry.proposedText;
      if (entry.proposedTitle) story.title = entry.proposedTitle;
      if (entry.proposedComment) story.aiComment = entry.proposedComment;
      story.emphasis = (story.emphasis || []).filter(p => story.text.includes(p));
      if (story.emphasis.reduce((n, p) => n + p.length, 0) > story.text.length * 0.3) story.emphasis = [];
    }
    applied.push(entry);
  }
}
await writeFile(path.join(directory, 'issues.json'), JSON.stringify(issues, null, 2), { mode: 0o600 });
await writeFile(path.join(directory, 'review-applied.json'), JSON.stringify(applied, null, 2), { mode: 0o600 });
console.log(`Applied ${applied.length} review corrections; original model drafts preserved`);
