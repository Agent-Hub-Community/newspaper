import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { runDigest } from './digest-context.mjs';

function render(discussion) {
  const { window } = parseHTML('<html><body><main id="reading"></main><div id="edition-sections"></div></body></html>');
  window.lucide = { createIcons() {} };
  runDigest({ window, document: window.document, URL });
  window.renderDigest({ date: '2026-10-09', pages: [{ id: 'group-2', stories: [{ title: '话题', text: '摘要', discussion }] }] }, () => {}, {}, 'group-2');
  const list = parseHTML(`<html><body>${window.AgentHubDiscussion.renderList(discussion, 'discussion-1')}</body></html>`).document;
  return { doc: window.document, list };
}
const message = (speaker, time, text, quote) => ({ speaker, time, text, ...(quote ? { quote } : {}) });
test('consecutive messages share a header, preserving every message and separating interruptions', () => {
  const messages = [message(1,'09:30','第一句'), message(1,'09:31','第二句\n仍是原话'), message(2,'09:31','插话'), message(1,'09:32','回来回答'), message(1,'12:00','几个小时后')];
  const { doc, list } = render(messages);
  assert.equal(list.querySelectorAll('.discussion-meta').length, 3);
  assert.deepEqual([...list.querySelectorAll('.discussion-text')].map(el => el.textContent), messages.map(m => m.text));
  // The article carries only the trigger; messages are built when the reader opens.
  const trigger = doc.querySelector('.brief .discussion-trigger');
  assert.equal(trigger.dataset.discussionIndex, '0');
  assert.equal(trigger.getAttribute('aria-label'), '查看原始讨论，5 条消息，2 位群友');
  assert.equal(doc.querySelectorAll('.brief .discussion-text, .brief details').length, 0);
});
test('quotes link only to unique earlier messages from the quoted speaker', () => {
  const long = '一段足够长的原始发言内容，用来判断被截断的引用能否正确定位。';
  const { list: doc } = render([
    message(1,'09:30','我不觉得'), message(2,'09:31','回应', {speaker:1,text:'[引用] 我不觉得'}),
    message(1,'09:32',long), message(2,'09:33','继续',{speaker:1,text:long.slice(0,23)+'...'}),
    message(1,'09:34','我不觉得'), message(2,'09:35','有歧义',{speaker:1,text:'我不觉得'}),
    message(2,'09:36','没有来源',{speaker:3,text:'我不觉得'}),
  ]);
  const quotes = [...doc.querySelectorAll('.discussion-quote')];
  assert.equal(quotes[0].dataset.messageTarget, 'discussion-1-message-1');
  assert.equal(quotes[1].dataset.messageTarget, 'discussion-1-message-3');
  for (const quote of quotes.slice(2)) {
    assert.equal(quote.hasAttribute('data-message-target'), false);
    assert.equal(quote.getAttribute('aria-expanded'), 'false');
  }
});
// The text of a message with each card shown as ▢.
const withCards = node => {
  const copy = node.cloneNode(true);
  for (const card of copy.querySelectorAll('.discussion-card')) card.replaceWith('▢');
  return copy.textContent;
};
test('addresses in running text become short safe links without changing punctuation, line breaks or markup text', () => {
  const text = '资料：https://example.org/a_(b)。\n(https://example.org/path).\n<img src=x onerror="evil()"> javascript:evil() https://user:secret@example.org/ https://example.org/?token=secret';
  const { list: doc } = render([message(1,'09:30',text)]);
  const body = doc.querySelector('.discussion-text');
  // Links show host and path; the full address stays in href and title. Unsafe addresses stay plain text.
  assert.equal(body.textContent, text.replace('https://example.org/a_(b)', 'example.org/a_(b)').replace('https://example.org/path', 'example.org/path'));
  assert.equal(body.querySelectorAll('img, script, .discussion-card').length, 0);
  assert.deepEqual([...body.querySelectorAll('a')].map(a => a.getAttribute('href')), ['https://example.org/a_(b)', 'https://example.org/path']);
  for (const link of body.querySelectorAll('a')) {
    assert.equal(link.getAttribute('title'), link.getAttribute('href'));
    assert.equal(link.getAttribute('target'), '_blank');
    assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  }
});
test('weekly discussions start a new header when the same speaker continues on another day', () => {
  const { list } = render([message(1,'10.07 12:35','周二'), message(1,'10.07 12:40','同一天'), message(1,'10.10 09:00','三天后'), message(2,'10.10 09:01','回应')]);
  // The date appears once as a rule where a new day starts; headers then show only the clock time.
  assert.deepEqual([...list.querySelectorAll('.discussion-day')].map(el => el.textContent), ['10.07', '10.10']);
  assert.deepEqual([...list.querySelectorAll('.discussion-meta time')].map(el => el.textContent), ['12:35', '09:00', '09:01']);
  assert.deepEqual([...list.querySelectorAll('.discussion-entry')].map(el => el.getAttribute('aria-label')),
    ['群友 1，10.07 12:35', '群友 1，10.07 12:40', '群友 1，10.10 09:00', '群友 2，10.10 09:01']);
});
test('only a message that is nothing but links reads as a share card; links in sentences and quotes stay short text links', () => {
  const { list } = render([
    message(1, '19:24', 'https://arxiv.org/abs/2605.19516。'), message(1, '19:25', ' https://github.com/oceanbase/powercontext \nhttps://arxiv.org/pdf/2610.08144'),
    message(2, '19:26', '感觉可以在这基础上做开发：https://github.com/oceanbase/powercontext 这个地基貌似打得挺全的了'),
    message(2, '19:27', 'https://user:secret@example.org/'),
    message(3, '19:28', '同意', { speaker: 2, text: '[引用] 做开发：https://github.com/oceanbase/powercontext 这个地基' }),
  ]);
  const [arxiv, two, sentence, unsafe] = list.querySelectorAll('.discussion-text');
  const cards = node => [...node.querySelectorAll('a.discussion-card')].map(card => [card.getAttribute('href'),
    card.querySelector('.discussion-card-origin').textContent, card.querySelector('.discussion-card-title').textContent]);
  assert.deepEqual(cards(arxiv), [['https://arxiv.org/abs/2605.19516', 'arXiv', 'arXiv 2605.19516']]);
  assert.deepEqual(cards(two), [['https://github.com/oceanbase/powercontext', 'GitHub', 'oceanbase/powercontext'],
    ['https://arxiv.org/pdf/2610.08144', 'arXiv', 'arXiv 2610.08144']]);
  assert.equal(withCards(two), '▢▢');
  assert.equal(sentence.querySelector('.discussion-card'), null);
  assert.equal(sentence.textContent, '感觉可以在这基础上做开发：github.com/oceanbase/powercontext 这个地基貌似打得挺全的了');
  assert.equal(sentence.querySelector('a').getAttribute('href'), 'https://github.com/oceanbase/powercontext');
  assert.equal(unsafe.querySelectorAll('a').length, 0);
  assert.deepEqual([...list.querySelectorAll('.discussion-entry')].map(entry => entry.classList.contains('is-card')), [true, true, false, false, false]);
  assert.equal(list.querySelector('.discussion-quote-text').textContent, '做开发：github.com/oceanbase/powercontext 这个地基');
  const other = render([message(1, '16:19', 'https://www.figma.com/resource-library/design-basics/'), message(1, '16:20', 'https://programgym.github.io/')]).list;
  // A front page has the host as its title, so the line above says it is a website instead of repeating the host.
  assert.deepEqual([...other.querySelectorAll('.discussion-card')].map(card => [card.querySelector('.discussion-card-origin').textContent, card.querySelector('.discussion-card-title').textContent]),
    [['figma.com', 'resource-library/design-basics'], ['网站', 'programgym.github.io']]);
  const zhihu = render([message(1, '20:45', 'https://zhuanlan.zhihu.com/p/135981668')]).list;
  assert.equal(zhihu.querySelector('.discussion-card-origin').textContent, '知乎', 'a subdomain falls back to its site name');
});
test('shared cards, files and media placeholders replace raw export fields without losing their content', () => {
  const card = '[链接] 一篇文章的标题\n  来源: 机器之心\n  摘要: 一句摘要。\n  URL: https://mp.weixin.qq.com/s?__biz=Mz&mid=1#rd';
  const { list } = render([
    message(1,'09:30',card), message(1,'09:31','[文件] spec.md (51.5 KB, md, md5=abc)'), message(2,'09:32','[媒体引用未解析]'),
    message(2,'09:33','[旺柴]好[未知码]'), message(3,'09:34','[链接] 标题\n  多出来的一行'),
    message(3,'09:35','回应', { speaker: 1, text: '[引用] 原话\n  ↳ [链接] 被引用的标题\n  摘要: 不显示\n  URL: https://github.com/x' }),
  ]);
  const [shared, file, media, sticker, unknown] = list.querySelectorAll('.discussion-text');
  const link = shared.querySelector('a.discussion-card');
  assert.equal(link.getAttribute('href'), 'https://mp.weixin.qq.com/s?__biz=Mz&mid=1#rd');
  assert.equal(link.querySelector('.discussion-card-origin').textContent, '公众号 · 机器之心');
  assert.equal(link.querySelector('.discussion-card-title').textContent, '一篇文章的标题');
  assert.equal(link.querySelector('.discussion-card-summary').textContent, '一句摘要。');
  assert.equal(file.textContent, 'spec.md51.5 KB');
  assert.equal(media.textContent, '图片或视频');
  // Known WeChat codes become emoji that keep the code as tooltip and the name for screen readers.
  const face = sticker.querySelector('.discussion-emoji');
  assert.deepEqual([face.getAttribute('role'), face.getAttribute('aria-label'), face.getAttribute('title')], ['img', '旺柴', '[旺柴]']);
  assert.notEqual(face.textContent, '[旺柴]');
  assert.equal(sticker.querySelector('.discussion-sticker').textContent, '[未知码]');
  // An unrecognized layout keeps the original text rather than guessing fields.
  assert.equal(unknown.textContent, '[链接] 标题\n  多出来的一行');
  assert.equal(list.querySelector('.discussion-quote-text').textContent, '原话\n  ↳ [链接] 被引用的标题');
});
