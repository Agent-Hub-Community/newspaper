import { contentBase, readablePath } from '../agent-reading.mjs';

export const readerHeaders = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'X-AgentHub-Recorded': '0',
  'Access-Control-Expose-Headers': 'X-AgentHub-Recorded' };

export async function readLimit(request, env) {
  if (!env.READ_RATE_LIMITER) return null;
  try {
    const { success } = await env.READ_RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
    return success ? null : new Response('Too many requests', { status: 429, headers: { ...readerHeaders, 'Retry-After': '60' } });
  } catch {
    return new Response('Reader temporarily unavailable', { status: 503, headers: readerHeaders });
  }
}

export function clientCategory(userAgent = '') {
  if (/ChatGPT-User|GPTBot|OAI-SearchBot/i.test(userAgent)) return 'openai-declared';
  if (/Claude-User|ClaudeBot|Claude-SearchBot|anthropic-ai/i.test(userAgent)) return 'anthropic-declared';
  if (/PerplexityBot|Perplexity-User/i.test(userAgent)) return 'perplexity-declared';
  if (/Googlebot|bingbot|Baiduspider|DuckDuckBot|Applebot/i.test(userAgent)) return 'search-bot-declared';
  if (/curl|wget|python|node|undici|httpx|Go-http-client/i.test(userAgent)) return 'http-tool';
  if (/Mozilla\//i.test(userAgent)) return 'browser-like';
  return 'unknown';
}

export async function agentReads(request, env, fetchContent = fetch) {
  const url = new URL(request.url);
  const path = url.pathname.slice('/read/'.length);
  const headers = readerHeaders;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
    ...headers, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  } });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {
    status: 405, headers: { ...headers, Allow: 'GET, HEAD, OPTIONS' },
  });
  if (!readablePath(path)) return new Response('Unknown document', { status: 404, headers });
  if ([...url.searchParams].some(([key, value]) => key !== 'analytics_test' || value !== '1')) {
    return new Response('Unsupported query parameter', { status: 400, headers });
  }
  const limited = await readLimit(request, env);
  if (limited) return limited;
  let response;
  try {
    // Do not forward cookies, authorization, query strings, ranges, or conditional headers.
    const upstream = await fetchContent(contentBase + path, { method: request.method,
      redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'AgentHub-Reader/1.0' } });
    const type = upstream.headers.get('Content-Type') || '';
    if (upstream.status === 200 && (path.endsWith('.json') ? type.includes('application/json') : /^text\/(plain|markdown)/.test(type))) {
      response = new Response(request.method === 'HEAD' ? null : upstream.body, { headers: { ...headers, 'Content-Type': type } });
    } else {
      await upstream.body?.cancel();
      const status = upstream.status === 404 ? 404 : 502;
      response = new Response(request.method === 'HEAD' ? null : status === 404 ? 'Document not found' : 'Content unavailable', { status, headers });
    }
  } catch {
    response = new Response(request.method === 'HEAD' ? null : 'Content unavailable', { status: 502, headers });
  }
  return recordRead(request, env, path, response);
}

export async function recordRead(request, env, path, response) {
  const hour = new Date().toISOString().slice(0, 13) + ':00:00.000Z';
  try {
    await env.DB.prepare(`INSERT INTO agent_reads (hour, path, method, client, status, is_test, requests)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(hour, path, method, client, status, is_test) DO UPDATE SET requests = requests + 1`)
      .bind(hour, path, request.method, clientCategory(request.headers.get('User-Agent') || ''), response.status,
        new URL(request.url).searchParams.get('analytics_test') === '1' ? 1 : 0).run();
    response.headers.set('X-AgentHub-Recorded', '1');
  } catch {
    // A statistics failure must not prevent reading; the response makes the gap observable.
    console.error('Agent read statistics write failed');
  }
  return response;
}
