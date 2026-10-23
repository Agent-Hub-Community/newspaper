import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { digests } from '../lib/digest.mjs';
import { validateStoryDiscussion } from '../lib/story-discussion.mjs';

test('edited issues retain source evidence and distinguish missing groups from empty activity', async () => {
  for (const issue of digests.filter(issue => issue.source)) {
    const source = await readFile(new URL(issue.source, new URL('../', import.meta.url)), 'utf8');
    assert.ok(source.length > 100);
    const [first, second, third, papers] = issue.pages;
    assert.ok(first.stories.length >= 4 && first.stories.length <= 6);
    assert.equal(second.stories.length, 0);
    assert.equal(third.stories.length, 0);
    for (const paper of papers.papers) assert.ok(source.includes(paper.url), `Paper is not in source: ${paper.url}`);
    const text = JSON.stringify(issue.pages);
    assert.doesNotMatch(text, /@chatroom|local_id|wxid_/);
    assert.match(first.note, /非完整日报/);
  }
});

test('reviewed daily editions contain only reader content and dated coverage', () => {
  for (const issue of digests.filter(issue => !issue.source)) {
    assert.deepEqual(Object.keys(issue).sort(), ['date', 'id', 'label', 'pages']);
    assert.deepEqual(issue.pages.slice(0, 3).map(page => page.id), ['group-1', 'group-2', 'group-3']);
    for (const page of issue.pages.filter(page => page.stories)) {
      assert.ok(Array.isArray(page.stories));
      assert.ok(page.note.length > 0);
      assert.doesNotMatch(page.note, /Gemini|同步加粗|原稿预览/i);
      for (const story of page.stories) {
        assert.ok(Object.keys(story).every(key => ['category', 'text', 'title', 'emphasis', 'aiComment', 'resources', 'discussion'].includes(key)));
        validateStoryDiscussion(story.discussion);
        for (const key of ['category', 'text', 'title', 'aiComment']) assert.ok(story[key]?.trim());
        for (const phrase of story.emphasis || []) assert.ok(story.text.includes(phrase));
        assert.equal(new Set((story.resources || []).map(r => r.url)).size, (story.resources || []).length);
        for (const resource of story.resources || []) {
          assert.deepEqual(Object.keys(resource).sort(), ['kind', 'label', 'url']);
          assert.ok(['paper', 'article', 'code', 'demo', 'discussion'].includes(resource.kind));
          assert.ok(resource.label.trim());
          const url = new URL(resource.url);
          assert.equal(url.protocol, 'https:');
          assert.equal(url.username + url.password + url.search, '');
        }
      }
    }
    assert.doesNotMatch(JSON.stringify(issue), /evidence_ids|topic_key|"claims"|"audit"|aeskey|wxid_|@chatroom/);
  }
});

