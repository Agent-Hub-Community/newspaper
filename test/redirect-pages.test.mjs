import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { redirectPage, redirectRoutes, writeRedirectPages } from '../lib/redirect-pages.mjs';
import { site } from '../lib/site.mjs';

const page = (id, text = '摘要。') => ({ id, stories: text ? [{ title: '题', text }] : [] });
const data = {
  digests: [{ date: '2026-10-15', pages: [page('group-1')] }, { date: '2026-10-16', pages: [page('group-1', ' ')] }],
  weeklies: [{ start: '2026-10-05', end: '2026-10-11', pages: [] }],
};

test('shortened URLs forward to the page they stand for', () => {
  assert.deepEqual(redirectRoutes(data).map(({ route, target }) => [route, target]), [
    ['daily/', '2026-10-15/group-1/'],
    ['daily/2026-10-15/', 'group-1/'],
    ['daily/2026-10-16/', 'overview/'],
    ['rank/', 'week/'],
    ['weekly/2026-10-05/2026-10-11/', 'overview/'],
    ['weekly/2026-10-05/', '2026-10-11/overview/'],
  ], 'daily/ skips an issue without readable pages; one readable section opens directly, as in the reader');
  const busy = { digests: [{ date: '2026-10-17', pages: [page('group-1'), page('group-2')] }], weeklies: [] };
  assert.deepEqual(redirectRoutes(busy).slice(0, 2).map(({ target }) => target), ['2026-10-17/overview/', 'overview/'], 'several sections open on the overview');
});

test('a forwarding page works without scripts, keeps anchors with them, and stays out of indexes', () => {
  const { document } = parseHTML(redirectPage({ route: 'daily/', target: '2026-10-15/overview/', label: '2026-10-15 日报' }));
  assert.equal(document.querySelector('meta[http-equiv="refresh"]').getAttribute('content'), '0; url=2026-10-15/overview/');
  assert.equal(document.querySelector('link[rel="canonical"]').getAttribute('href'), new URL('daily/2026-10-15/overview/', site).href);
  assert.match(document.querySelector('script').textContent, /location\.hash/);
  assert.match(document.querySelector('meta[name="robots"]').getAttribute('content'), /^noindex/);
  assert.equal(document.querySelector('body a').getAttribute('href'), '2026-10-15/overview/');
});

test('forwarding pages never replace a page the build already wrote', async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), 'redirects-'));
  try {
    await mkdir(path.join(out, 'rank'), { recursive: true });
    await writeFile(path.join(out, 'rank/index.html'), 'existing');
    const written = await writeRedirectPages(out, data);
    assert.ok(!written.includes('rank/'));
    assert.equal(await readFile(path.join(out, 'rank/index.html'), 'utf8'), 'existing');
    assert.match(await readFile(path.join(out, 'daily/index.html'), 'utf8'), /url=2026-10-15\/group-1\//);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
