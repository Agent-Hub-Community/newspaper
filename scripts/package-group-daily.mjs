import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { readerPage } from '../lib/daily-generation.mjs';
import { digests } from '../lib/digest.mjs';
import { mergeDraftEditions } from '../lib/draft-editions.mjs';
import { applyComments } from '../lib/story-comments.mjs';
import { validateEmphasis } from '../lib/emphasis.mjs';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: package-group-daily.mjs DIRECTORY');
const emphasis = await readFile(path.join(directory, 'emphasis.json'), 'utf8')
  .then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return {};
    throw error;
  });
const issues = [], manifest = [];
for (const day of (await readdir(directory)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()) {
  const input = JSON.parse(await readFile(path.join(directory, day, 'group-1.input.json'), 'utf8'));
  const draft = JSON.parse(await readFile(path.join(directory, day, 'group-1.gemini.json'), 'utf8'));
  if (input.date !== day || input.group.id !== 'group-1') throw new Error('Input mismatch');
  const page = readerPage(draft, input);
  for (const entry of emphasis[day] || []) {
    const story = page.stories.find(s => s.title === entry.title);
    if (story?.emphasis !== undefined) continue;
    if (!story) throw new Error(`Invalid emphasis: ${day} ${entry.title}`);
    validateEmphasis(story.text, entry.phrases, {
      invalidMessage: `Invalid emphasis: ${day} ${entry.title}`, overlapMessage: `Overlapping emphasis: ${day} ${entry.title}`,
    });
    story.emphasis = entry.phrases;
  }
  const time = new Date(input.cutoff).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }).slice(0, 5);
  page.note = `${day} · ${input.coverage.completeDay ? '当日本地记录' : `截至北京时间 ${time}`}`;
  if (!page.stories.length) page.note += ' · 本地记录中没有可成稿的技术讨论';
  const existing = digests.find(d => d.date === day);
  const pages = existing ? structuredClone(existing.pages) : [1, 2, 3].map(n => ({
    id: `group-${n}`, label: ['一群', '二群', '三群'][n - 1], section: '今日讨论',
    heading: '本期尚未收录', note: '本次仅更新一群。', stories: [],
  }));
  pages[0] = page;
  issues.push({ id: day, date: day, label: `${day} 日报`, pages });
  manifest.push({ date: day, stories: page.stories.length, cutoff: input.cutoff,
    records: input.coverage.count, model: 'gemini-3.8-flash', prompt: 'original-D', editorialChanges: false });
}
mergeDraftEditions(digests, issues);
const comments = await readFile(path.join(directory, 'comments.json'), 'utf8')
  .then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
if (comments) applyComments(issues, comments);
await writeFile(path.join(directory, 'issues.json'), JSON.stringify(issues, null, 2), { mode: 0o600 });
await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
console.log(JSON.stringify(manifest, null, 2));
