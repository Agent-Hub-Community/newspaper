// Authenticated, read-only report. The generated HTML stays local; no query endpoint is public.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [wranglerCmd, ...wranglerPrefix] = process.env.WRANGLER_BIN ? [process.env.WRANGLER_BIN] : ['npx', '-y', 'wrangler@4'];
const output = path.resolve(process.argv[2] || path.join(root, 'output/playwright/search-stats.html'));
const sql = `SELECT s.is_test, COUNT(*) AS searches, SUM(s.result_count = 0) AS zero_results,
  SUM(EXISTS(SELECT 1 FROM search_clicks c WHERE c.search_id = s.id)) AS clicked_searches
  FROM search_events s WHERE s.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days') GROUP BY s.is_test;
SELECT s.is_test, s.query, s.kind, s.group_id, s.time_filter, s.sort,
  COUNT(*) AS searches, SUM(s.result_count = 0) AS zero_results,
  MIN(s.result_count) AS min_results, MAX(s.result_count) AS max_results,
  SUM(EXISTS(SELECT 1 FROM search_clicks c WHERE c.search_id = s.id)) AS clicked_searches,
  MAX(s.created_at) AS latest
  FROM search_events s WHERE s.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days') GROUP BY s.is_test, s.query, s.kind, s.group_id, s.time_filter, s.sort
  ORDER BY searches DESC, latest DESC LIMIT 200;
SELECT s.is_test, s.query, c.target, c.rank, c.created_at
  FROM search_clicks c JOIN search_events s ON s.id = c.search_id
  WHERE s.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
  ORDER BY c.created_at DESC LIMIT 30;
SELECT is_test, COUNT(*) AS searches, SUM(result_count = 0) AS zero_results
  FROM api_searches WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days') GROUP BY is_test;
SELECT is_test, endpoint, query, filters, COUNT(*) AS searches, SUM(result_count = 0) AS zero_results,
  MIN(result_count) AS min_results, MAX(result_count) AS max_results, MAX(unmatched_terms) AS unmatched_terms,
  GROUP_CONCAT(DISTINCT client) AS clients, MAX(created_at) AS latest
  FROM api_searches WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
  GROUP BY is_test, endpoint, query, filters ORDER BY searches DESC, latest DESC LIMIT 200;`;
const result = JSON.parse(execFileSync(wranglerCmd, [...wranglerPrefix, 'd1', 'execute', 'agenthub-feedback', '--remote',
  '--config', path.join(root, 'feedback/wrangler.jsonc'), '--command', sql, '--json'], { encoding: 'utf8', timeout: 120000 }));
if (result.length !== 5 || result.some(item => !item.success)) throw new Error('Search statistics query failed.');
const [totals, queries, clicks, apiTotals, apiQueries] = result.map(item => item.results);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const stat = flag => totals.find(row => row.is_test === flag) || { searches: 0, zero_results: 0, clicked_searches: 0 };
const table = flag => {
  const rows = queries.filter(row => row.is_test === flag);
  return rows.length ? `<div class="table"><table><thead><tr><th>搜索词</th><th>筛选</th><th>搜索次数</th><th>结果数量</th><th>零结果次数</th><th>有点击的搜索</th></tr></thead><tbody>${rows.map(row =>
    `<tr><td>${esc(row.query)}</td><td>${esc([row.kind || '全部栏目', row.group_id || '全部版面', row.time_filter ? `近 ${row.time_filter} 天` : '全部时间', row.sort === 'new' ? '最新' : '相关度'].join(' · '))}</td><td>${row.searches}</td><td>${row.min_results === row.max_results ? row.min_results : `${row.min_results}–${row.max_results}`}</td><td>${row.zero_results}</td><td>${row.clicked_searches}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">尚无记录。新埋点不会补写过去的搜索。</p>';
};
const actual = stat(0), check = stat(1);
const apiStat = flag => apiTotals.find(row => row.is_test === flag) || { searches: 0, zero_results: 0 };
const apiTable = flag => {
  const rows = apiQueries.filter(row => row.is_test === flag);
  return rows.length ? `<div class="table"><table><thead><tr><th>搜索词</th><th>接口</th><th>筛选</th><th>次数</th><th>结果数量</th><th>零结果</th><th>站内没有的词</th><th>客户端</th></tr></thead><tbody>${rows.map(row =>
    `<tr><td>${esc(row.query || '（只有筛选）')}</td><td>${row.endpoint === 'library/search' ? '资料库' : '全站'}</td><td>${esc(row.filters || '—')}</td><td>${row.searches}</td><td>${row.min_results === row.max_results ? row.min_results : `${row.min_results}–${row.max_results}`}</td><td>${row.zero_results}</td><td>${esc(row.unmatched_terms || '')}</td><td>${esc(row.clients)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">尚无记录。接口搜索记录从 Worker 部署新版本后开始。</p>';
};
const api = apiStat(0), apiCheck = apiStat(1);
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentHub 搜索统计</title>
<style>body{margin:0;background:#f5f4ef;color:#242822;font:15px/1.6 system-ui,sans-serif}main{max-width:1180px;margin:40px auto;padding:0 28px}header{border-bottom:2px solid #242822;padding-bottom:20px}h1{font-size:34px;margin:4px 0}h2{font-size:21px;margin:30px 0 10px}p{margin:6px 0}.muted{color:#62665e}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:26px 0}.card{background:white;padding:22px;border:1px solid #d8dbd0}.value{display:block;font-size:38px;line-height:1.3}.table{overflow:auto}table{width:100%;border-collapse:collapse;background:white;font-size:14px}th,td{padding:12px;text-align:left;border-bottom:1px solid #ddd;vertical-align:top}th{background:#e9ede3;white-space:nowrap}td:first-child{min-width:120px;word-break:break-word}.empty{padding:25px;background:white;border:1px dashed #bcc4b5}.test{border-left:4px solid #b28836;padding-left:18px}.tag{display:inline-block;background:#e9ede3;padding:3px 10px;font-size:12px}.target{overflow-wrap:anywhere;font-size:12px}@media(max-width:650px){main{margin:20px auto;padding:0 16px}.stats{gap:8px}.card{padding:12px}.value{font-size:28px}}</style></head><body><main>
<header><span class="tag">私有统计 · Cloudflare D1 实时查询快照</span><h1>AgentHub 搜索统计</h1><p class="muted">更新于 ${esc(time(new Date()))}（北京时间） · 最近 30 天保留记录</p></header>
<div class="stats"><div class="card">搜索次数<span class="value">${actual.searches}</span></div><div class="card">零结果搜索<span class="value">${actual.zero_results}</span></div><div class="card">有结果点击的搜索<span class="value">${actual.clicked_searches}</span></div></div>
<p class="muted">上方只计入未标记为验收的记录，不等于独立人数；输入停稳 1.2 秒、按回车或点击结果后记录。无点击不能直接解释为搜索失败。</p>
<h2>大家搜了什么</h2>${table(0)}
<section class="test"><h2>接入验收（不计入上方数字）</h2><p class="muted">以下是带 analytics_test 标记的实际测试记录，用来核对搜索、零结果和点击链路。</p><p>搜索 ${check.searches} 次 · 零结果 ${check.zero_results} 次 · 有点击 ${check.clicked_searches} 次</p>${table(1)}</section>
<h2>Agent 经接口搜了什么</h2><p class="muted">读者的 agent 调用 /content/search 和 /library/search 的首页查询。搜索 ${api.searches} 次 · 零结果 ${api.zero_results} 次。翻页不重复计数；客户端类别来自 User-Agent，可以伪造。“站内没有的词”是站内从未出现、搜索时被拒或去掉的写法，适合补进同义词表或黑话词典。</p>${apiTable(0)}
<section class="test"><h2>接口验收（不计入上方数字）</h2><p>搜索 ${apiCheck.searches} 次 · 零结果 ${apiCheck.zero_results} 次</p>${apiTable(1)}</section>
<h2>最近的结果点击</h2>${clicks.length ? `<div class="table"><table><thead><tr><th>类型</th><th>搜索词</th><th>结果位置</th><th>打开的内容</th></tr></thead><tbody>${clicks.map(row => `<tr><td>${row.is_test ? '验收' : '常规'}</td><td>${esc(row.query)}</td><td>第 ${row.rank} 条</td><td class="target">${esc(row.target)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">尚无点击记录。</p>'}
<p class="muted" style="margin-top:24px">关键词仅保留前 120 个字符；明显的邮箱、网址、长数字和令牌样式会隐藏。原始明细及关联点击保留 30 天。</p>
</main></body></html>`;
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, html);
console.log(JSON.stringify({ output, totals, api: apiTotals }, null, 2));
