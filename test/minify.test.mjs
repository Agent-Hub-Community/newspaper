import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minifyCss, minifyJs } from '../lib/minify.mjs';

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../site');

test('minifyCss strips comments and whitespace while preserving calc, media queries, and descendant selectors', () => {
  const input = `
    /* Comment */
    body :is(a, button) {
      width: calc(100vw - 48px);
      background: color-mix(in srgb, var(--ink) 8%, var(--paper));
      content: "hello /* not comment */ world";
    }
    @media (min-width: 900px) and (hover: hover) {
      .a > .b:hover { color: red; }
    }
  `;
  const result = minifyCss(input);
  assert.ok(!result.includes('/* Comment */'));
  assert.ok(result.includes('body :is(a,button)'));
  assert.ok(result.includes('calc(100vw - 48px)'));
  assert.ok(result.includes('color-mix(in srgb,var(--ink) 8%,var(--paper))'));
  assert.ok(result.includes('"hello /* not comment */ world"'));
  assert.ok(result.includes('@media (min-width:900px) and (hover:hover)'));
  assert.ok(result.includes('.a > .b:hover{color:red}'));
});

test('minifyJs preserves valid JS syntax and template literals across all site scripts', async () => {
  const files = (await readdir(siteDir)).filter(f => f.endsWith('.js'));
  assert.ok(files.length > 10);
  for (const file of files) {
    const raw = await readFile(path.join(siteDir, file), 'utf8');
    const min = minifyJs(raw);
    assert.ok(min.length <= raw.length, `${file} grew`);
    assert.doesNotThrow(() => new Function(min), `${file} failed syntax check after minification`);
  }
});
