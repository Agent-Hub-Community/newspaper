import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEmphasis } from '../emphasis.mjs';

test('allows one exact highlight per natural paragraph without a count or fragment-length cap', () => {
  const phrases = ['保留原文的完整判断以及它成立的前提条件', '第二段呈现机制', '第三段说明限制'];
  const text = phrases.map(phrase => `${phrase}。${'其余信息交代观察条件和依据。'.repeat(4)}`).join('\n\n');
  assert.ok(phrases[0].length > 16);
  assert.doesNotThrow(() => validateEmphasis(text, [...phrases].reverse()));
  assert.doesNotThrow(() => validateEmphasis(text, []));
});

test('checks every span for overlap, including a third nested highlight', () => {
  const text = `alpha beta gamma delta ${'.'.repeat(100)}`;
  assert.doesNotThrow(() => validateEmphasis(text, ['gamma', 'alpha', 'beta']));
  assert.throws(() => validateEmphasis(text, ['gamma', 'alpha', 'beta gamma']), /Overlapping emphasis/);
  assert.throws(() => validateEmphasis(text, ['alpha beta', 'beta', 'delta']), /Overlapping emphasis/);
});

test('rejects duplicates, repeated occurrences, trimmed or short spans and paragraph crossings', () => {
  const text = `alpha alpha beta\n\n gamma delta ${'.'.repeat(100)}`;
  for (const phrases of [null, ['beta', 'beta'], ['alpha'], [' beta'], ['beta '], ['g'], [4],
    ['missing'], ['beta\n\n gamma']]) {
    assert.throws(() => validateEmphasis(text, phrases), /Invalid emphasis/);
  }
  assert.throws(() => validateEmphasis(`first\r\n \r\nsecond ${'.'.repeat(100)}`, ['first\r\n \r\nsecond']), /Invalid emphasis/);
  assert.doesNotThrow(() => validateEmphasis(`first\nsecond ${'.'.repeat(100)}`, ['first\nsecond']));
});

test('accepts exactly 30 percent and rejects even one extra highlighted character', () => {
  const unique = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const text = unique + '.'.repeat(100 - unique.length);
  assert.equal(text.length, 100);
  assert.doesNotThrow(() => validateEmphasis(text, [unique.slice(0, 10), unique.slice(10, 20), unique.slice(20, 30)]));
  assert.doesNotThrow(() => validateEmphasis(text, [unique.slice(0, 30)]));
  assert.throws(() => validateEmphasis(text, [unique.slice(0, 31)]), /Invalid emphasis/);
});
