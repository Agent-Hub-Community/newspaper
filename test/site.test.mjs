import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { contentBase } from '../agent-reading.mjs';
import { basePath, origin, site } from '../site.mjs';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const hostname = new URL(origin).hostname;
// Browser files load without a build step, so each keeps a literal copy of the address.
const browserFiles = ['app.js', 'analytics.js', 'search-tracking.js', 'views.js', '404.html'];

test('the site address is an HTTPS origin plus a base path', () => {
  const url = new URL(site);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, basePath);
  assert.equal(url.href, site, 'site is already in canonical form');
  assert.match(basePath, /^\/(?:[\w.-]+\/)+$/, 'basePath starts and ends with a slash');
  assert.equal(contentBase, site, 'the Worker reads documents from the same site');
});

test('app.js builds canonical links from the configured site', async () => {
  assert.ok((await read('app.js')).includes(`'${site}'`));
});

test('404.html links back to the configured base path', async () => {
  const { document } = parseHTML(await read('404.html'));
  const links = [...document.querySelectorAll('a[href]')].map(link => link.getAttribute('href'));
  assert.ok(links.length > 0);
  assert.deepEqual([...new Set(links)], [basePath]);
});

test('search tracking starts only on the configured site', async () => {
  const source = await read('search-tracking.js');
  const startsAt = url => {
    const window = {};
    runInNewContext(source, { window, location: new URL(url), URLSearchParams, document: {
      querySelector: () => ({ content: 'https://feedback.example' }), addEventListener() {},
    } });
    return Boolean(window.AgentHubSearchTracking);
  };
  assert.ok(startsAt(`${site}search/?q=agent`));
  for (const url of [`${origin}/`, `http://${hostname}${basePath}search/`, `https://preview.example${basePath}search/`,
    'https://hqhq1025.github.io/agent_hub/search/']) assert.equal(startsAt(url), false, url);
});

test('browser files name no other github.io site', async () => {
  for (const file of browserFiles) {
    for (const [host] of (await read(file)).matchAll(/[\w-]+\.github\.io/g)) assert.equal(host, hostname, file);
  }
});
