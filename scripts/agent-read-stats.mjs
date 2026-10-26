import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { json: { type: 'boolean' }, days: { type: 'string', default: '30' },
  output: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help) {
  console.log('Usage: node scripts/agent-read-stats.mjs [--json] [--days 1..30] [--output report.html]\nRequires WRANGLER_BIN and an authenticated local Wrangler account. Runs fixed read-only SELECT queries.');
  process.exit(0);
}
if (!/^(?:[1-9]|[12][0-9]|30)$/.test(values.days)) throw new Error('--days must be an integer from 1 to 30.');
if (values.json && values.output) throw new Error('--json and --output cannot be combined.');
const [wranglerCmd, ...wranglerPrefix] = process.env.WRANGLER_BIN ? [process.env.WRANGLER_BIN] : ['npx', '-y', 'wrangler@4'];
const output = path.resolve(values.output || path.join(root, 'output/playwright/agent-read-stats.html'));
const window = `hour >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${values.days} days')`;
const sql = `SELECT is_test, SUM(requests) requests,
  SUM(CASE WHEN method='GET' AND status=200 THEN requests ELSE 0 END) successful_gets,
  SUM(CASE WHEN status>=400 THEN requests ELSE 0 END) errors,
  SUM(CASE WHEN method='HEAD' THEN requests ELSE 0 END) heads FROM agent_reads WHERE ${window} GROUP BY is_test;
SELECT date(hour, '+8 hours') day, SUM(requests) requests FROM agent_reads
  WHERE ${window} AND is_test=0 AND method='GET' AND status=200 GROUP BY day ORDER BY day DESC;
SELECT path, client, method, status, is_test, SUM(requests) requests, MAX(hour) latest_hour
  FROM agent_reads WHERE ${window} GROUP BY path, client, method, status, is_test ORDER BY requests DESC LIMIT 200;`;
const result = JSON.parse(execFileSync(wranglerCmd, [...wranglerPrefix, 'd1', 'execute', 'agenthub-feedback', '--remote',
  '--config', path.join(root, 'feedback/wrangler.jsonc'), '--command', sql, '--json'], { encoding: 'utf8', timeout: 120000 }));
if (result.length !== 3 || result.some(item => !item.success)) throw new Error('Agent read statistics query failed.');
const [totals, days, files] = result.map(item => item.results);
if (values.json) {
  console.log(JSON.stringify({ schema_version: 1, generated_at: new Date().toISOString(), days_requested: Number(values.days),
    scope: 'Worker /read/ and /library/search requests; hourly buckets; no unique visitor measurement; client labels are unverified UA hints',
    totals, daily_successful_gets: days, files, file_group_limit: 200 }, null, 2));
  process.exit(0);
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const table = (labels, rows) => rows.length ? `<table><thead><tr>${labels.map(s => `<th>${esc(s)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p>尚无记录。</p>';
const labels = { 'openai-declared': '自称 OpenAI 客户端', 'anthropic-declared': '自称 Anthropic 客户端',
  'perplexity-declared': '自称 Perplexity 客户端', 'search-bot-declared': '自称搜索爬虫',
  'http-tool': 'HTTP 工具（用途未知）', 'browser-like': '浏览器样式（用途未知）', unknown: '未知' };
const actual = totals.find(row => !row.is_test) || { requests: 0, successful_gets: 0, errors: 0, heads: 0 };
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentHub 内容读取统计</title>
<style>body{margin:32px auto;max-width:1200px;padding:0 24px;font:16px/1.6 system-ui;color:#242822;background:#f5f4ef}h1{font-size:32px}table{border-collapse:collapse;width:100%;background:white;margin:16px 0;font-size:14px}th,td{padding:10px;text-align:left;border-bottom:1px solid #ddd;overflow-wrap:anywhere}th{background:#e9ede3}.metrics{font-size:22px;border-block:1px solid #abb4a3;padding:20px 0}.scroll{overflow:auto}</style>
<h1>AgentHub 内容读取统计</h1><p>更新于 ${esc(new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }))}（北京时间） · 私有查询 · 最近 ${values.days} 天</p>
<p class="metrics">成功 GET ${actual.successful_gets} 次 · 错误响应 ${actual.errors} 次 · HEAD ${actual.heads} 次</p>
<p>仅统计 Worker 读取与资料库查询入口，验收请求不计入上方数字。成功 GET 表示服务端发出成功响应，不代表读完或独立人数；资料库查询也可能返回零结果。客户端类别来自可伪造的 User-Agent，无法确认是否由 agent 发起。旧的 GitHub Pages 直读、被限流或数据库写入失败的请求不在统计内。</p>
<h2>每天成功读取</h2>${table(['北京时间日期', '成功 GET 次数'], days.map(r => [r.day, r.requests]))}
<h2>文件与客户端</h2><div class="scroll">${table(['文件路径', '客户端线索', '方法', '状态码', '类型', '次数', '最近小时（UTC）'], files.map(r => [r.path, labels[r.client] || r.client, r.method, r.status, r.is_test ? '验收' : '普通', r.requests, r.latest_hour]))}</div>
<p>统计按小时汇总并保留 30 天，不保存 IP、完整 User-Agent、Cookie 或访客标识。</p></html>`;
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, html);
console.log(JSON.stringify({ output, totals, days }, null, 2));
