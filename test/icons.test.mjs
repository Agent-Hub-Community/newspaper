import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { buildIconBundle, iconSources } from '../icons.mjs';

const root = new URL('..', import.meta.url).pathname;
const bundle = await buildIconBundle(root);

test('the icon bundle carries every literal placeholder and stays small', async () => {
  const { window } = parseHTML('<html><body></body></html>');
  runInNewContext(bundle, { window, document: window.document });
  for (const source of iconSources) {
    for (const [, name] of (await readFile(new URL(`../${source}`, import.meta.url), 'utf8')).matchAll(/data-lucide="([^"$]+)"/g)) {
      assert.ok(window.lucide.icons[name], `${source} uses ${name}`);
    }
  }
  // Names chosen at runtime from lookup tables.
  for (const name of ['file-text', 'book-open', 'code-xml', 'play', 'messages-square', 'user-round', 'arrow-up-right']) assert.ok(window.lucide.icons[name], name);
  assert.ok(Buffer.byteLength(bundle) < 60_000, `${Buffer.byteLength(bundle)} bytes`);
});

test('replacement keeps Lucide markup: merged classes, element attributes and requested defaults', () => {
  const { window } = parseHTML('<html><body><button><i data-lucide="chevron-left" class="pager-icon"></i></button><i data-lucide="no-such-icon"></i></body></html>');
  const warnings = [];
  runInNewContext(bundle, { window, document: window.document, console: { warn: message => warnings.push(message) } });
  window.lucide.createIcons({ attrs: { 'aria-hidden': 'true', 'stroke-width': 1.6 } });
  const svg = window.document.querySelector('button svg');
  assert.equal(svg.getAttribute('class'), 'lucide lucide-chevron-left pager-icon');
  assert.equal(svg.getAttribute('aria-hidden'), 'true');
  assert.equal(svg.getAttribute('stroke-width'), '1.6');
  assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
  assert.ok(svg.querySelector('path'));
  assert.equal(warnings.length, 1);
});
