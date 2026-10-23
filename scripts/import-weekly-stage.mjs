import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { groupLabels, isGroupId, pageGroups } from '../lib/groups.mjs';

const sourceDir = process.env.WEEKLY_SOURCE_DIR;
const outDir = process.env.WEEKLY_OUT_DIR || path.resolve('data/weekly-editions');
const issueId = process.env.WEEKLY_ISSUE_ID || '2026-09-28_2026-10-04';
if (!sourceDir) throw new Error('WEEKLY_SOURCE_DIR is required');

const [start, end] = issueId.split('_');
const pages = [];
// Default to the groups that had a reader section on the week's last day.
const weekGroups = (process.env.WEEKLY_GROUPS ? process.env.WEEKLY_GROUPS.split(',') : pageGroups(end).map(group => group.id))
  .filter(isGroupId);
for (const id of [...weekGroups, 'external']) {
  const source = JSON.parse(await readFile(path.join(sourceDir, `${id}.json`), 'utf8'));
  pages.push({
    id,
    label: id === 'external' ? '外部资讯' : groupLabels[id],
    section: id === 'external' ? '本期外部资讯' : '本周讨论',
    heading: source.title.replace(new RegExp(`^\\s*(?:AgentHub\\s*)?(?:${[...Object.values(groupLabels), '外部资讯'].join('|')})?\\s*周报\\s*[:：]\\s*`, 'u'), ''),
    theme: source.intro,
    note: `${start} 至 ${end} · 周报`,
    stories: source.stories.map(story => ({
      category: '本周重点',
      title: story.title,
      text: story.text,
      emphasis: story.emphasis || [],
      aiComment: story.review,
      resources: story.url ? [{
        kind: /^https:\/\/arxiv\.org\//.test(story.url) ? 'paper' : 'article',
        label: '原始来源',
        url: story.url,
      }] : [],
    })),
  });
}

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, `${issueId}.json`), JSON.stringify({
  id: issueId,
  start,
  end,
  label: `${start.replaceAll('-', '.')}–${end.slice(5).replaceAll('-', '.')} 周报`,
  pages,
}, null, 2) + '\n');
console.log(JSON.stringify({ issueId, output: path.join(outDir, `${issueId}.json`), pages: pages.map(page => [page.id, page.stories.length]) }, null, 2));
