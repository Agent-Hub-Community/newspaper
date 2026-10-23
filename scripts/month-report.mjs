import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const dir = process.argv[2];
if (!dir) throw new Error('Provide month directory');
const issues = JSON.parse(await readFile(path.join(dir, 'issues.json'), 'utf8'));
const groups = [...new Map(issues.flatMap(issue => issue.pages)
  .filter(page => /^group-[1-4]$/.test(page.id)).map(page => [page.id, page.label])).entries()]
  .sort(([a], [b]) => a.localeCompare(b));
const rows = [], totals = groups.map(() => 0), days = groups.map(() => 0);
for (const issue of issues) {
  const counts = [];
  for (const [i, [id]] of groups.entries()) {
    const page = issue.pages.find(page => page.id === id);
    if (!page) { counts.push('未纳入'); continue; }
    const input = JSON.parse(await readFile(path.join(dir, issue.date, `${id}.input.json`), 'utf8'));
    if (!input.coverage.completeDay || !input.coverage.paginationExhausted) throw new Error('Incomplete export');
    const n = input.coverage.count;
    totals[i] += n; days[i] += Number(n > 0);
    counts.push(`${n} / ${page.stories.length}`);
    if (!page.stories.length) {
      page.heading = n ? '本日暂无技术精华' : '本日暂无可读记录';
      page.theme = n ? '当日可读内容未选出独立的技术资讯或观点' : '当前本地档案未覆盖这一天';
    }
  }
  rows.push(`| ${issue.date} | ${counts.join(' | ')} |`);
}
const stories = issues.flatMap(i => i.pages.filter(p => /^group-[1-4]$/.test(p.id)).flatMap(p => p.stories));
const report = `# AgentHub 近一个月日报整理

范围：${issues[0].date} 至 ${issues.at(-1).date}，北京时间逐日 00:00–24:00，不含今天。

共 ${issues.length} 天、${stories.length} 条精华，${stories.filter(s => s.aiComment).length} 条 AI 锐评，${stories.reduce((n, s) => n + (s.resources?.length || 0), 0)} 个资料入口。
生成模型、提示词与审核修订以本批次凭证为准，原稿不覆盖。

${groups.map(([, label], i) => `${label}共 ${totals[i]} 条记录、${days[i]} 天有记录`).join('；')}。
已纳入群日的输入均为整日且分页已读尽，但不能代表入群前或其他设备的完整历史。
仅有转发、广告、表情或系统消息的日期不强凑六条；无本地记录与有记录但无技术选题分开显示。

下表为原始记录数 / 入选条数，仅保存在本地报告，不进入网页榜单。

| 日期 | ${groups.map(([, label]) => label).join(' | ')} |
| --- | ${groups.map(() => '---').join(' | ')} |
${rows.join('\n')}
`;
await writeFile(path.join(dir, '整理说明.md'), report, { mode: 0o600 });
await writeFile(path.join(dir, 'issues.json'), JSON.stringify(issues, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ editions: issues.length, stories: stories.length, totals, days }));
