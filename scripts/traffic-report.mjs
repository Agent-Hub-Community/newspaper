// Private page view report from the feedback D1 database (tables page_views and daily_visitors, written by
// POST /views). It runs fixed read-only SELECT queries through Wrangler and never accepts SQL from the caller.
//
//   node scripts/traffic-report.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json]
//
// Dates are Beijing dates; the default is the last 7 days ending today. Set WRANGLER_BIN to use an installed
// Wrangler; otherwise the script runs `npx -y wrangler@4`. Either way Wrangler must be logged in to the account.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const shift = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400e3).toISOString().slice(0, 10);
const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && shift(value, 0) === value;

// Missing ends default to today in Beijing and the six days before the end date.
export function dateRange({ from, to, now = Date.now() } = {}) {
  const end = to ?? new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
  if (!isDay(end)) throw new Error('--to must be a date as YYYY-MM-DD.');
  const start = from ?? shift(end, -6);
  if (!isDay(start)) throw new Error('--from must be a date as YYYY-MM-DD.');
  if (start > end) throw new Error('--from must not be after --to.');
  return { from: start, to: end };
}

// Wrangler's --command cannot bind parameters; dateRange has already reduced both dates to YYYY-MM-DD.
export function trafficQueries({ from, to }) {
  const range = `day BETWEEN '${from}' AND '${to}'`;
  return [
    `SELECT day, SUM(views) AS views, SUM(CASE WHEN source = 'wechat' THEN views ELSE 0 END) AS wechat
      FROM page_views WHERE ${range} GROUP BY day`,
    `SELECT day, COUNT(*) AS visitors FROM daily_visitors WHERE ${range} GROUP BY day`,
    `SELECT day, path, views FROM (SELECT day, path, SUM(views) AS views,
      ROW_NUMBER() OVER (PARTITION BY day ORDER BY SUM(views) DESC, path) AS place
      FROM page_views WHERE ${range} GROUP BY day, path) WHERE place <= 10 ORDER BY day, place`,
  ];
}

export function wrangler(args) {
  const [command, ...prefix] = process.env.WRANGLER_BIN ? [process.env.WRANGLER_BIN] : ['npx', '-y', 'wrangler@4'];
  return JSON.parse(execFileSync(command, [...prefix, ...args], { encoding: 'utf8', timeout: 120000 }));
}

// `execute` receives Wrangler's arguments and returns its parsed --json output: one result per statement.
export function trafficReport({ from, to, execute = wrangler }) {
  const queries = trafficQueries({ from, to });
  const output = execute(['d1', 'execute', 'agenthub-feedback', '--remote', '--config', path.join(root, 'feedback/wrangler.jsonc'),
    '--json', '--command', queries.join(';\n')]);
  if (!Array.isArray(output) || output.length !== queries.length || output.some(item => !item?.success)) {
    throw new Error('Page view query failed.');
  }
  const [totals, visitors, pages] = output.map(item => item.results);
  const days = [];
  for (let day = from; day <= to; day = shift(day, 1)) {
    const views = totals.find(row => row.day === day)?.views || 0;
    const wechat = totals.find(row => row.day === day)?.wechat || 0;
    days.push({
      day, views, visitors: visitors.find(row => row.day === day)?.visitors || 0,
      wechat_views: wechat, wechat_share: views ? wechat / views : null,
      top_pages: pages.filter(row => row.day === day).map(({ path, views }) => ({ path, views })),
    });
  }
  return { from, to, days };
}

const percent = share => share === null ? '—' : `${Math.round(share * 100)}%`;

export function formatReport({ from, to, days }) {
  const lines = [`AgentHub 浏览量 · ${from} 至 ${to}（北京时间）`, '', '日期          浏览    访客  微信占比'];
  for (const row of days) lines.push(`${row.day}  ${String(row.views).padStart(6)}  ${String(row.visitors).padStart(6)}  ${percent(row.wechat_share).padStart(8)}`);
  const views = days.reduce((sum, row) => sum + row.views, 0);
  const wechat = days.reduce((sum, row) => sum + row.wechat_views, 0);
  lines.push(`合计        ${String(views).padStart(6)}       —  ${percent(views ? wechat / views : null).padStart(8)}`);
  lines.push('访客按天去重，同一浏览器在不同日期各算一次，所以访客不能跨天相加。');
  for (const row of days.filter(row => row.top_pages.length)) {
    lines.push('', `${row.day} 浏览最多的页面`);
    row.top_pages.forEach((page, index) => lines.push(`${String(index + 1).padStart(3)}  ${String(page.views).padStart(6)}  ${page.path}`));
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('Usage: node scripts/traffic-report.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json]\n'
      + 'Beijing dates; default: the last 7 days. Runs fixed read-only queries on the remote agenthub-feedback D1 database.');
    return;
  }
  const report = trafficReport(dateRange(values));
  process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
