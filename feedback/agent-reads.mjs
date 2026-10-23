import { contentBase, contentAPIBase, readablePath } from '../agent-reading.mjs';

export const readerHeaders = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'X-AgentHub-Recorded': '0',
  'Access-Control-Expose-Headers': 'X-AgentHub-Recorded' };

// JSON endpoints answer limits in JSON, so a caller that parses every response still learns when to retry.
export async function readLimit(request, env, { json = false } = {}) {
  if (!env.READ_RATE_LIMITER) return null;
  const reply = (status, error, code, seconds) => json
    ? Response.json({ error, code, retry_after_seconds: seconds }, { status, headers: { ...readerHeaders, 'Retry-After': String(seconds) } })
    : new Response(error, { status, headers: { ...readerHeaders, 'Retry-After': String(seconds) } });
  try {
    const { success } = await env.READ_RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
    return success ? null : reply(429, 'Too many requests', 'rate_limited', 60);
  } catch {
    return reply(503, 'Reader temporarily unavailable', 'limiter_unavailable', 30);
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
      response = new Response(request.method === 'HEAD' ? null : status === 404
        ? `Document not found. Find published dates: ${contentAPIBase}editions\nSearch content: ${contentAPIBase}search`
        : 'Content unavailable', { status, headers: { ...headers, ...(status === 404 ? {
          Link: `<${contentAPIBase}editions>; rel="index"`, 'Content-Type': 'text/plain; charset=utf-8',
        } : {}) } });
    }
  } catch {
    response = new Response(request.method === 'HEAD' ? null : 'Content unavailable', { status: 502, headers });
  }
  // Any well-formed path can miss; counting each one would let a caller add a row per request.
  return recordRead(request, env, response.status === 200 ? path : 'unavailable-document', response);
}

// A slow D1 write must not hold the reader's response. After this long the response goes out unrecorded.
export const RECORD_TIMEOUT_MS = 1000;

export async function recordRead(request, env, path, response) {
  const hour = new Date().toISOString().slice(0, 13) + ':00:00.000Z';
  let timer;
  try {
    await Promise.race([
      env.DB.prepare(`INSERT INTO agent_reads (hour, path, method, client, status, is_test, requests)
        VALUES (?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(hour, path, method, client, status, is_test) DO UPDATE SET requests = requests + 1`)
        .bind(hour, path, request.method, clientCategory(request.headers.get('User-Agent') || ''), response.status,
          new URL(request.url).searchParams.get('analytics_test') === '1' ? 1 : 0).run(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Statistics write timed out')), RECORD_TIMEOUT_MS); }),
    ]);
    response.headers.set('X-AgentHub-Recorded', '1');
  } catch {
    // A statistics failure must not prevent reading; the response makes the gap observable.
    console.error('Agent read statistics write failed');
  } finally {
    clearTimeout(timer);
  }
  return response;
}
