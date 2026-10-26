import { basePath } from '../lib/site.mjs';

// Route shapes the site publishes, relative to basePath: home, daily sections, weekly sections (by start/end
// directories or by issue id), rank boards, and the library, glossary and search pages. The 404 page never reports.
const route = /^(?:|daily\/\d{4}-\d{2}-\d{2}\/(?:group-[1-9]\d?|external|overview)\/|weekly\/\d{4}-\d{2}-\d{2}[/_]\d{4}-\d{2}-\d{2}\/(?:group-[1-9]\d?|external|rank|overview)\/|rank\/(?:week|month|all)\/(?:group-[1-9]\d?\/)?|(?:library|glossary|search)\/)$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

// Returns the stored form of a reported page path, or null when the path is not a site page.
// The query and hash are dropped; `index.html` names the same page as its directory.
export function viewPath(value) {
  if (typeof value !== 'string') return null;
  const path = value.split(/[?#]/)[0];
  if (path.length > 200 || !path.startsWith(basePath)) return null;
  const rest = path.slice(basePath.length).replace(/(^|\/)index\.html$/, '$1');
  return route.test(rest) ? basePath + rest : null;
}

// POST /views counts one page view. The browser sends {path, visitor} as text/plain JSON, which needs no preflight.
// Stored: Beijing date, page path, wechat/other, the view count, and a date-salted hash of the browser's random ID.
export async function pageViews(request, env, headers) {
  const json = (value, status) => Response.json(value, { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    if (env.RATE_LIMITER && !(await env.RATE_LIMITER.limit({ key: `views:${request.headers.get('CF-Connecting-IP') || 'unknown'}` })).success) {
      return json({ error: 'Too many requests' }, 429);
    }
    if (!/^(text\/plain|application\/json)(;|$)/i.test(request.headers.get('Content-Type') || '')) return json({ error: 'Unsupported content type' }, 415);
    // Bound the stream rather than trusting a caller-supplied Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'Missing body' }, 400);
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) { await reader.cancel(); return json({ error: 'Body too large' }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let input;
    try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const path = viewPath(input?.path);
    if (!path) return json({ error: 'Invalid path' }, 400);
    const source = /MicroMessenger/i.test(request.headers.get('User-Agent') || '') ? 'wechat' : 'other';
    const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const statements = [env.DB.prepare(`INSERT INTO page_views (day, path, source, views) VALUES (?, ?, ?, 1)
      ON CONFLICT(day, path, source) DO UPDATE SET views = views + 1`).bind(day, path, source)];
    // A malformed visitor ID still counts as a view; it only stays out of the visitor count.
    if (uuid.test(input.visitor || '')) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${day}:${input.visitor}`)));
      const hash = [...digest.slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      statements.push(env.DB.prepare('INSERT OR IGNORE INTO daily_visitors (day, visitor_hash) VALUES (?, ?)').bind(day, hash));
    }
    await env.DB.batch(statements);
    return new Response(null, { status: 204, headers });
  } catch {
    return json({ error: 'Page views unavailable' }, 503);
  }
}
