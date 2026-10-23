import { searchEvents } from './search-events.mjs';
import { pageViews } from './page-views.mjs';
import { agentReads } from './agent-reads.mjs';
import { librarySearch } from './library-search.mjs';
import { contentAPI } from './content-api.mjs';
import { readerHeaders } from './agent-reads.mjs';
import { contentAPIBase, contentBase, librarySearchUrl, readingBase } from '../lib/agent-reading.mjs';

const rootGuide = `AgentHub public reader API: published daily and weekly digests and the resource library of the AgentHub
WeChat groups for AI agent researchers. No login. Percent-encode Chinese and spaces in query strings.

Search topics and resources: ${contentAPIBase}search?q=%E7%A7%91%E7%A0%94%E7%BB%8F%E9%AA%8C&limit=5
Latest daily edition:        ${contentAPIBase}edition
Published editions:          ${contentAPIBase}editions
Filter the library:          ${librarySearchUrl}?type=benchmark&limit=5
Full guide (llms.txt):       ${readingBase}llms.txt
Agent skill:                 ${readingBase}agents/SKILL.md
Website:                     ${contentBase}
`;

const storyPattern = /^[a-f0-9]{32}$/;
// Registered rows whose group_id names a collection rather than a chat group.
const collections = new Set(['library']);
const voterPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export default {
  async scheduled(_event, env) {
    // Search details expire after 30 days; vote and discussion data are unaffected.
    const cutoff = new Date(Date.now() - 30 * 86400e3).toISOString();
    await env.DB.prepare('DELETE FROM search_events WHERE created_at < ?').bind(cutoff).run();
    await env.DB.prepare('DELETE FROM agent_reads WHERE hour < ?').bind(cutoff).run();
    await env.DB.prepare('DELETE FROM api_searches WHERE created_at < ?').bind(cutoff).run();
  },
  async fetch(request, env, ctx) {
    // An agent given only this origin finds the published guide at the root and the conventional llms.txt path.
    if (['/', '/llms.txt'].includes(new URL(request.url).pathname) && ['GET', 'HEAD'].includes(request.method)) {
      return new Response(request.method === 'HEAD' ? null : rootGuide, { headers: { ...readerHeaders,
        'Content-Type': 'text/plain; charset=utf-8', Link: `<${readingBase}llms.txt>; rel="describedby"` } });
    }
    if (new URL(request.url).pathname.startsWith('/content/')) return contentAPI(request, env, ctx);
    if (new URL(request.url).pathname === '/library/search') return librarySearch(request, env, ctx);
    // Public documents must also work for HTTP clients that send no browser Origin.
    if (new URL(request.url).pathname.startsWith('/read/')) return agentReads(request, env);
    // ALLOWED_ORIGIN is a comma-separated list of site origins; a request must name one of them exactly.
    const origin = request.headers.get('Origin');
    if (!origin || !String(env.ALLOWED_ORIGIN || '').split(',').some(allowed => allowed.trim() === origin)) {
      return new Response('Forbidden', { status: 403 });
    }
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'Vary': 'Origin',
    };
    const json = (value, status = 200) => Response.json(value, { status, headers });
    const url = new URL(request.url);
    if (url.pathname === '/search-events') return searchEvents(request, env, headers);
    if (url.pathname === '/views') return pageViews(request, env, headers);
    // POST /opens?story= counts one opening of a registered story's discussion for the Beijing date.
    // Only the story and the count are stored; the reader stays anonymous.
    if (url.pathname === '/opens') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const story = url.searchParams.get('story');
      if (!storyPattern.test(story || '')) return json({ error: 'Invalid story' }, 400);
      try {
        if (env.RATE_LIMITER) {
          const { success } = await env.RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
          if (!success) return json({ error: 'Too many requests' }, 429);
        }
        const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
        const result = await env.DB.prepare(`INSERT INTO discussion_opens (story_id, day, opens)
          SELECT id, ?, 1 FROM stories WHERE id = ?
          ON CONFLICT(story_id, day) DO UPDATE SET opens = opens + 1`).bind(day, story).run();
        if (!result.meta?.changes) return json({ error: 'Unknown story' }, 404);
        return new Response(null, { status: 204, headers });
      } catch {
        return json({ error: 'Feedback unavailable' }, 503);
      }
    }
    if (url.pathname !== '/votes') return json({ error: 'Not found' }, 404);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!['GET', 'PUT'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
    try {
      if (env.RATE_LIMITER) {
        const { success } = await env.RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
        if (!success) return json({ error: 'Too many requests' }, 429);
      }
      let input;
      if (request.method === 'PUT') {
        if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'JSON required' }, 415);
        // Bound the stream too, rather than trusting a caller-supplied Content-Length.
        const reader = request.body?.getReader();
        if (!reader) return json({ error: 'Missing body' }, 400);
        const chunks = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1024) { await reader.cancel(); return json({ error: 'Body too large' }, 413); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ error: 'Invalid JSON' }, 400); }
      } else {
        input = Object.fromEntries(new URL(request.url).searchParams);
      }
      // One request returns every registered item in a collection, so a page of library cards stays within the rate limit.
      if (request.method === 'GET' && 'collection' in input) {
        if (!collections.has(input.collection) || !voterPattern.test(input.voter)) return json({ error: 'Invalid feedback' }, 400);
        const { results } = await env.DB.prepare(`SELECT s.id AS story,
          COALESCE(SUM(v.vote = 'up'), 0) AS up,
          COALESCE(SUM(v.vote = 'down'), 0) AS down,
          MAX(CASE WHEN v.voter = ? THEN v.vote END) AS vote
          FROM stories s LEFT JOIN votes v ON v.story_id = s.id
          WHERE s.group_id = ? GROUP BY s.id`).bind(input.voter, input.collection).all();
        return json({ items: Object.fromEntries(results.map(({ story, ...counts }) => [story, counts])) });
      }
      if (!input || !storyPattern.test(input.story) || !voterPattern.test(input.voter)
          || (request.method === 'PUT' && ![null, 'up', 'down'].includes(input.vote))) {
        return json({ error: 'Invalid feedback' }, 400);
      }
      const { story, voter, vote } = input;
      if (!await env.DB.prepare('SELECT id FROM stories WHERE id = ?').bind(story).first()) {
        return json({ error: 'Unknown story' }, 404);
      }
      const statements = [];
      if (request.method === 'PUT') {
        statements.push(vote === null
          ? env.DB.prepare('DELETE FROM votes WHERE story_id = ? AND voter = ?').bind(story, voter)
          : env.DB.prepare(`INSERT INTO votes (story_id, voter, vote) VALUES (?, ?, ?)
              ON CONFLICT(story_id, voter) DO UPDATE SET vote = excluded.vote, updated_at = CURRENT_TIMESTAMP`).bind(story, voter, vote));
      }
      statements.push(env.DB.prepare(`SELECT
        COALESCE(SUM(vote = 'up'), 0) AS up,
        COALESCE(SUM(vote = 'down'), 0) AS down,
        MAX(CASE WHEN voter = ? THEN vote END) AS vote
        FROM votes WHERE story_id = ?`).bind(voter, story));
      const result = await env.DB.batch(statements);
      return json(result.at(-1).results[0]);
    } catch {
      return json({ error: 'Feedback unavailable' }, 503);
    }
  },
};
