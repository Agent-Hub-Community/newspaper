import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessages, sanitizeFragment, safeUrl, extractReport } from '../content.mjs';

test('multiline messages, quoted replies and same-minute repeats remain intact', () => {
  const data = parseMessages('=== group ===\n[2026-09-21 16:27] 张三: 提问\n第二行\n[2026-09-21 16:27] A: [引用] 回答\n  ↳ 张三: 提问\n[2026-09-21 16:27] A: [引用] 回答\n', 'week');
  assert.equal(data.length, 3);
  assert.equal(data[0].text, '提问\n第二行');
  assert.match(data[1].text, /↳ 张三/);
});

test('message presentation strips metadata and secrets, keeps a media marker', () => {
  const data = parseMessages('[2026-09-21 16:27] A: [图片] local_id=23\n[2026-09-21 16:28] B: aeskey="123secret" tel 13812345678 https://example.com/p?xsec_token=secret&id=1', 'week');
  assert.equal(data[0].media, true);
  assert.equal(data[0].text, '[图片]');
  assert.doesNotMatch(data[1].text, /123secret|13812345678|xsec_token|=secret/);
  assert.match(data[1].text, /id=1/);
});

test('archive HTML cannot execute code or load remote resources', () => {
  const html = sanitizeFragment('<article onclick="evil()"><h3>研究</h3><script>evil()</script><iframe src="https://bad.com"></iframe><img src="https://bad.com/track"><a href="javascript:evil()">坏链接</a><a href="https://example.com/?token=secret&id=5">论文</a></article>');
  assert.doesNotMatch(html, /script|onclick|iframe|<img|javascript:|secret/);
  assert.match(html, /id=5/);
  assert.match(html, /noopener/);
  assert.equal(safeUrl('file:///private/data'), null);
});

test('report extraction uses actual headings and all article entries', () => {
  const result = extractReport('<html><body><main><h1>Agent Hub Weekly Signal</h1><section><h2>实际标题</h2><p class="lead">导语</p></section><section><article><h3>A</h3><p>甲</p></article><article><h3>B</h3><p>乙</p></article></section></main></body></html>');
  assert.equal(result.headline, '实际标题');
  assert.equal(result.lead, '导语');
  assert.equal(result.articles.length, 2);
});
