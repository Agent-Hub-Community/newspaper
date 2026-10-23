import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryDiscussion } from '../lib/story-discussion.mjs';

const message = () => ({ speaker: 1, time: '09:33', text: '我用学校的邮箱注册账号，没有被封。', quote: { speaker: 2, text: '这个写了基本没用吧' } });
test('discussion keeps verbatim bodies and anonymous reply participants', () => {
  const data = [message(), { speaker: 2, time: '10:00', text: '<img onerror="alert(1)"> 原文示例', quote: { speaker: null, text: '更早的原话' } }];
  const before = structuredClone(data);
  validateStoryDiscussion(data);
  validateStoryDiscussion(undefined);
  assert.deepEqual(data, before);
});
test('discussion rejects identity metadata and invalid display fields', () => {
  for (const entry of [
    { ...message(), sender: '原始昵称' },
    { ...message(), sourceId: 'private-source' },
    { ...message(), speaker: '原始昵称' },
    { ...message(), time: '25:00' },
    { ...message(), text: '' },
    { ...message(), quote: { speaker: 2, text: '引用', sender: '原始昵称' } },
    { ...message(), quote: { speaker: '原始昵称', text: '引用' } },
  ]) assert.throws(() => validateStoryDiscussion([entry]));
  assert.throws(() => validateStoryDiscussion([]));
});
