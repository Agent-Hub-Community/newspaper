import test from 'node:test';
import assert from 'node:assert/strict';
import { imageCoverage, imageMessageText, modelInput } from '../lib/image-messages.mjs';
import { sanitizeInput } from '../lib/daily-generation.mjs';
import { validateStoryDiscussion } from '../lib/story-discussion.mjs';

const input = {
  group: { id: 'group-1' }, date: '2026-10-15', coverage: { count: 4 },
  messages: [
    { id: 'm0001', time: '2026-10-15 15:44', speaker: 'p1', type: '文本', content: '看这个' },
    { id: 'm0002', time: '2026-10-15 15:45', speaker: 'p1', type: '图片', content: '[图片]',
      image: { quality: 'thumbnail', description: 'OpenCode 推文截图，写着「V4.1 Flash is now free」' } },
    { id: 'm0003', time: '2026-10-15 15:46', speaker: 'p2', type: '图片', content: '[图片]', image: { quality: 'original' } },
    { id: 'm0004', time: '2026-10-15 15:47', speaker: 'p3', type: '图片', content: '[图片]', image: { quality: 'missing' } },
  ],
};

test('the draft model sees descriptions with their quality; the stored input does not change', () => {
  const before = structuredClone(input);
  const view = modelInput(input);
  assert.deepEqual(input, before);
  assert.deepEqual(view.messages.map(m => m.content), [
    '看这个',
    '[图片（缩略图）：OpenCode 推文截图，写着「V4.1 Flash is now free」]',
    '[图片（原图，未能识别）]',
    '[图片（未取到）]',
  ]);
  assert.ok(view.messages.every(m => !('image' in m)));
  // The generator sanitizes the model view again, which must keep the description.
  assert.equal(sanitizeInput(view).messages[1].content, view.messages[1].content);
  assert.throws(() => imageMessageText({ quality: 'blurry' }), /Unknown image quality/);
});

test('discussion excerpts built from message content show the [图片] tag, never the description', () => {
  // Batch discussion scripts copy message.content into the excerpt text.
  const excerpt = input.messages.slice(0, 2).map((m, i) => ({ speaker: i + 1, time: m.time.slice(11), text: m.content }));
  assert.equal(excerpt[1].text, '[图片]');
  validateStoryDiscussion(excerpt);

  const leaked = modelInput(input).messages[1].content;
  assert.throws(() => validateStoryDiscussion([{ speaker: 1, time: '15:45', text: leaked }]), /Generated image description/);
  assert.throws(() => validateStoryDiscussion([{ speaker: 1, time: '15:46', text: '对', quote: { speaker: 2, text: leaked } }]),
    /Generated image description/);
});

test('coverage counts every image message by quality', () => {
  assert.deepEqual(imageCoverage([
    { quality: 'original', description: 'a' }, { quality: 'thumbnail', description: 'b' },
    { quality: 'thumbnail', description: '' }, { quality: 'missing' },
  ]), { total: 4, original: 1, thumbnail: 2, missing: 1, described: 2 });
});
