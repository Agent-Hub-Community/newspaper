import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { basePath, origin, site } from '../site.mjs';

const source = await readFile(new URL('../site/analytics.js', import.meta.url), 'utf8');
const declaration = /const token = '([^']*)';/;
const withToken = token => source.replace(declaration, `const token = '${token}';`);
const sample = 'a'.repeat(32);
function scriptsAt(url, code) {
  const scripts = [];
  runInNewContext(code, {
    location: new URL(url),
    document: {
      createElement: tag => ({ tag, dataset: {} }),
      head: { append: script => scripts.push(script) },
    },
  });
  return scripts;
}

test('the beacon token is empty or a Cloudflare site token', () => {
  const [, token] = source.match(declaration) || [];
  assert.notEqual(token, undefined, 'analytics.js declares its token');
  assert.match(token, /^(?:[a-f0-9]{32})?$/);
});

test('without a token nothing loads, even on the public site', () => {
  for (const url of [site, `${site}daily/2026-10-22/group-1/`]) assert.equal(scriptsAt(url, withToken('')).length, 0, url);
});

test('analytics is restricted to the public project URL', () => {
  const host = new URL(origin).host;
  for (const url of [
    'file:///tmp/dist/index.html', `http://localhost:3000${basePath}`,
    `http://127.0.0.1:3000${basePath}`, `https://preview.example${basePath}`,
    `${origin}/`, `${origin}${basePath.replace(/\/$/, '-other/')}`,
    `http://${host}${basePath}`, `${origin}/summary_bot/`,
    'https://hqhq1025.github.io/agent_hub/',
  ]) assert.equal(scriptsAt(url, withToken(sample)).length, 0, url);
});

test('with a token, public pages load the official beacon', () => {
  for (const url of [site, `${site}index.html#week/2026-09-14_2026-09-20`, `${site}documents/recap.html`]) {
    const [script] = scriptsAt(url, withToken(sample));
    assert.equal(script.tag, 'script');
    assert.equal(script.type, 'module');
    assert.equal(script.src, 'https://static.cloudflareinsights.com/beacon.min.js');
    assert.equal(JSON.parse(script.dataset.cfBeacon).token, sample);
  }
});
