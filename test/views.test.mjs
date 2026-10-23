import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { basePath, origin, site } from '../lib/site.mjs';

const source = await readFile(new URL('../site/views.js', import.meta.url), 'utf8');
const endpoint = 'https://feedback.example';
const key = 'agenthub:feedback:v1:voter';
const voter = 'c0ffee00-1234-4abc-9def-0123456789ab';

// Runs views.js as a browser would load it at `url`, with history navigation that moves `location`.
function load(url, { script = { dataset: { endpoint } }, storage = new Map(), blocked = false, readOnly = false } = {}) {
  let current = new URL(url);
  const sent = [], listeners = [];
  const move = target => { current = new URL(target, current); };
  const history = { pushState: (_state, _title, target) => move(target), replaceState: (_state, _title, target) => move(target) };
  const localStorage = {
    getItem: name => { if (blocked) throw new Error('SecurityError'); return storage.get(name) ?? null; },
    setItem: (name, value) => { if (blocked || readOnly) throw new Error('QuotaExceededError'); storage.set(name, value); },
  };
  runInNewContext(source, {
    document: { currentScript: script }, history, localStorage, URL, JSON,
    location: { get origin() { return current.origin; }, get pathname() { return current.pathname; } },
    crypto: { randomUUID },
    addEventListener: (type, listener) => { if (type === 'popstate') listeners.push(listener); },
    fetch: (target, init) => { sent.push({ url: target, init, body: JSON.parse(init.body) }); return Promise.resolve(); },
  });
  const back = target => { move(target); for (const listener of listeners) listener(); };
  return { sent, history, back, storage, paths: () => sent.map(request => request.body.path) };
}

test('only the public site with a configured endpoint reports', () => {
  const host = new URL(origin).host;
  for (const url of ['file:///tmp/dist/index.html', `http://localhost:3000${basePath}`, `http://127.0.0.1:3000${basePath}`,
    `https://preview.example${basePath}`, `${origin}/`, `${origin}${basePath.replace(/\/$/, '-other/')}`, `http://${host}${basePath}`,
    'https://hqhq1025.github.io/agent_hub/', 'https://hqhq1025.github.io/newspaper/']) {
    assert.equal(load(url).sent.length, 0, url);
  }
  assert.equal(load(site, { script: { dataset: {} } }).sent.length, 0, 'no endpoint');
  assert.equal(load(site, { script: null }).sent.length, 0, 'no current script');
  assert.equal(load(site).sent.length, 1);
});

test('a page load reports its path and the vote buttons\' browser ID without a preflight or credentials', () => {
  const { sent } = load(`${site}daily/2026-10-22/group-1/?utm=x#discussion-2`, { storage: new Map([[key, voter]]) });
  assert.equal(sent.length, 1);
  const [{ url, init, body }] = sent;
  assert.equal(url, `${endpoint}/views`);
  assert.deepEqual(body, { path: `${basePath}daily/2026-10-22/group-1/`, visitor: voter });
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.keepalive, true);
  assert.deepEqual({ ...init.headers }, { 'Content-Type': 'text/plain;charset=UTF-8' });
});

test('a browser without an ID gets the shared one; without storage only the view is reported', () => {
  const fresh = load(site);
  assert.match(fresh.storage.get(key), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(fresh.sent[0].body.visitor, fresh.storage.get(key));
  assert.notEqual(load(site).sent[0].body.visitor, fresh.sent[0].body.visitor, 'separate browsers differ');
  for (const options of [{ blocked: true }, { readOnly: true }]) {
    assert.deepEqual(load(site, options).sent[0].body, { path: basePath }, JSON.stringify(options));
  }
});

test('in-page navigation reports each new path once', () => {
  const page = load(site, { storage: new Map([[key, voter]]) });
  // app.js resolves the home address with replaceState: the reader is still on the page that was counted.
  page.history.replaceState(null, '', `${site}daily/2026-10-22/group-1/`);
  page.history.pushState(null, '', `${site}daily/2026-10-22/group-2/`);
  // The discussion reader and filters change only the hash or query.
  page.history.pushState({ agentHubDiscussion: 1 }, '', `${site}daily/2026-10-22/group-2/#discussion-1`);
  page.back(`${site}daily/2026-10-22/group-2/`);
  page.history.pushState(null, '', `${site}daily/2026-10-22/group-2/?q=agent`);
  page.history.pushState(null, '', `${site}daily/2026-10-21/group-2/`);
  page.back(`${site}daily/2026-10-22/group-2/`);
  page.back(`${site}daily/2026-10-22/group-1/`);
  assert.deepEqual(page.paths(), [basePath, `${basePath}daily/2026-10-22/group-2/`, `${basePath}daily/2026-10-21/group-2/`,
    `${basePath}daily/2026-10-22/group-2/`, `${basePath}daily/2026-10-22/group-1/`]);
  assert.ok(page.sent.every(request => request.body.visitor === voter));
});

test('the 404 page loads no script, so missing paths never report', async () => {
  assert.doesNotMatch(await readFile(new URL('../site/404.html', import.meta.url), 'utf8'), /<script|views\.js/);
});
