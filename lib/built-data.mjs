import { readFile } from 'node:fs/promises';
import path from 'node:path';

// build.mjs writes data.js as an index and each issue's pages as issues/<date>.js.
export function parseIndex(source) {
  const match = source.match(/^window\.AGENT_HUB_DATA = ([\s\S]+);\s*$/);
  if (!match) throw new Error('Unexpected data.js format');
  return JSON.parse(match[1]);
}

export function parseIssue(source, date) {
  const head = `(window.AGENT_HUB_ISSUES = window.AGENT_HUB_ISSUES || {})[${JSON.stringify(date)}] = `;
  if (!source.startsWith(head)) throw new Error(`Unexpected issue script for ${date}`);
  return JSON.parse(source.slice(head.length).replace(/;\s*$/, ''));
}

// Returns data.js with every daily issue's full pages restored, as the site had before the split.
export async function readBuiltData(dist) {
  const data = parseIndex(await readFile(path.join(dist, 'data.js'), 'utf8'));
  for (const issue of data.digests) {
    if (!issue.version) continue;
    issue.pages = parseIssue(await readFile(path.join(dist, 'issues', `${issue.date}.js`), 'utf8'), issue.date).pages;
  }
  return data;
}
