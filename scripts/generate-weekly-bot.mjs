import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { weeklyRoute } from '../lib/weekly-editions.mjs';

const [,, issueFile, outputFile, ...args] = process.argv;
if (!issueFile || !outputFile) {
  throw new Error('Usage: generate-weekly-bot.mjs ISSUE_JSON OUTPUT_MD [--base-url URL]');
}
const baseIndex = args.indexOf('--base-url');
const baseUrl = baseIndex >= 0 ? args[baseIndex + 1].replace(/\/$/, '') : '';
const splitIndex = args.indexOf('--split-dir');
const splitDir = splitIndex >= 0 ? path.resolve(args[splitIndex + 1]) : null;
const issue = JSON.parse(await readFile(path.resolve(issueFile), 'utf8'));
const statusLine = baseUrl
  ? '周报页面已上线，发送前请再确认链接和本期覆盖范围。'
  : '本地预览文案，未发群。正式发送前替换为线上核验过的周报地址。';
const publicationCheck = baseUrl
  ? '- 外部资讯和周榜使用本期独立入口，发送前再次确认页面可打开。'
  : '- 外部资讯和周榜使用本期独立入口；本地预览阶段不发送。';
const label = issue.label.replace(/\s*周报\s*$/, '');
const pageName = id => id === 'external' ? 'external' : id;
const pageLink = (label, page) => baseUrl
  ? `${baseUrl}/${weeklyRoute(issue, pageName(page.id))}`
  : '周报链接待上线后补充';
const rankLink = page => baseUrl
  ? `${baseUrl}/${weeklyRoute(issue, 'rank')}#${page.id}`
  : `${page.label}活跃榜链接待上线后补充`;
const top = page => page.stories.slice(0, 2).map(story => story.title);
const groupPages = issue.pages.filter(page => page.id !== 'external');
const groupLabels = groupPages.map(page => page.label).join('、');
const externalPage = issue.pages.find(page => page.id === 'external');

const lines = [
  `AgentHub ${label}周报已生成。`,
  statusLine,
  '',
  `本期覆盖${groupLabels}。内容按整周原始消息整理，独立话题保留并列，不把没有明确后续的讨论硬串成一条。`,
  '',
  ...groupPages.map(page => `【${page.label}】${top(page).join('；')}。${pageLink(`${page.label}周报`, page)}`),
  `【外部资讯】${top(externalPage).join('；')}。${pageLink('外部资讯周报', externalPage)}`,
  '',
  `本期活跃榜（分群）：${groupPages.map(rankLink).join('；')}。`,
  '',
  publicationCheck,
];
await writeFile(path.resolve(outputFile), lines.join('\n') + '\n');
if (splitDir) {
  await mkdir(splitDir, { recursive: true });
  await writeFile(path.join(splitDir, `${issue.id}-bot.md`), lines.join('\n') + '\n');
}
console.log(JSON.stringify({ output: path.resolve(outputFile), messages: 1, pages: issue.pages.length }));
