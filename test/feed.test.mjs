import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atomFeed, jsonFeed } from '../lib/feed.mjs';
import { site } from '../lib/site.mjs';

const page = (id, heading, text = '摘要。') => ({ id, label: id, heading, stories: text ? [{ title: '题', text }] : [], trends: [], papers: [] });
const data = {
  digests: [
    { date: '2026-10-15', pages: [page('group-1', '一群标题'), page('external', '资讯 <标题> & 动态')] },
    { date: '2026-10-16', pages: [page('group-1', '空稿', '  ')] },
    { date: '2026-10-17', pages: [page('group-2', '二群标题')] },
  ],
  weeklies: [{ start: '2026-10-05', end: '2026-10-11', title: '一周', pages: [{ id: 'group-3', label: '三群', title: '三群周报', stories: [{ title: '题', text: '文' }] }] }],
};

test('the JSON feed lists readable editions newest first, with section headings and a Markdown copy', () => {
  const feed = JSON.parse(jsonFeed(data));
  assert.equal(feed.version, 'https://jsonfeed.org/version/1.1');
  assert.deepEqual(feed.items.map(item => item.title), ['AgentHub 日报 2026-10-17', 'AgentHub 日报 2026-10-15', 'AgentHub 周报 2026-10-05 至 2026-10-11：一周'],
    'an edition with no readable page is left out');
  assert.equal(feed.items[0].date_published, '2026-10-17T00:00:00+08:00');
  assert.match(feed.items[1].content_text, /^一群：一群标题\n外部资讯：资讯 <标题> & 动态/);
  assert.equal(feed.items[0].attachments[0].url, `${site}daily/2026-10-17/index.md`);
  assert.equal(feed.items[2].url, `${site}weekly/2026-10-05/2026-10-11/group-3/`);
  // Ids keep the first address after the site moved, so feed readers do not deliver old items again.
  assert.equal(feed.items[0].id, 'tag:hqhq1025.github.io,2026:agent_hub/daily/2026-10-17');
  assert.equal(feed.items[2].id, 'tag:hqhq1025.github.io,2026:agent_hub/weekly/2026-10-05/2026-10-11');
  assert.equal(new Set(feed.items.map(item => item.id)).size, feed.items.length, 'ids are unique and stable');
});

test('the Atom feed carries the same editions and escapes markup', () => {
  const atom = atomFeed(data);
  assert.equal((atom.match(/<entry>/g) || []).length, 3);
  assert.match(atom, /资讯 &lt;标题&gt; &amp; 动态/);
  assert.match(atom, /<updated>2026-10-17T00:00:00\+08:00<\/updated>/);
  assert.doesNotMatch(atom, /<标题>/);
});
