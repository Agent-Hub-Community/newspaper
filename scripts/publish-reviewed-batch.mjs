import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, readdir, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digests } from '../lib/digest.mjs';
import { mergeDraftEditions } from '../lib/draft-editions.mjs';
import { validatePublicActivity } from '../lib/public-activity.mjs';
import { validateStoryDiscussion } from '../lib/story-discussion.mjs';
import { validateEmphasis } from '../lib/emphasis.mjs';
import { isGroupId, pageGroups } from '../lib/groups.mjs';
import { attachmentFiles, validateAttachments } from '../lib/attachments.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
assert.ok(process.argv[2], 'Provide a batch directory');
const directory = path.resolve(process.argv[2]);
const issues = JSON.parse(await readFile(path.join(directory, 'issues.json'), 'utf8'));
const activityDirectory = path.join(directory, 'activity');
const snapshot = JSON.parse(await readFile(path.join(activityDirectory, 'snapshot.json'), 'utf8'));
const merged = mergeDraftEditions(digests, issues);
validatePublicActivity(snapshot, merged);
const latest = issues.map(issue => issue.date).sort().at(-1);
for (const period of ['week', 'month', 'all']) {
  assert.equal(snapshot.windows[period].through, latest, `Refresh ${period} ranking for the release date`);
}
for (const issue of issues) {
  const requiredDaily = new Set(pageGroups(issue.date).map(group => group.id));
  for (const page of issue.pages.filter(page => isGroupId(page.id) && requiredDaily.has(page.id))) {
    assert.ok(snapshot.groups.find(group => group.id === page.id)?.daily[issue.date],
      `Missing release daily ranking: ${issue.date}/${page.id}`);
  }
}
const allowedKeys = (object, keys) => assert.ok(Object.keys(object).every(key => keys.includes(key)), 'Unexpected reader field');
for (const issue of issues) {
  allowedKeys(issue, ['id', 'date', 'label', 'pages']);
  for (const page of issue.pages) {
    allowedKeys(page, ['id', 'label', 'section', 'heading', 'theme', 'note', 'stories']);
    assert.ok(Array.isArray(page.stories));
    for (const story of page.stories) {
      allowedKeys(story, ['category', 'title', 'tldr', 'points', 'text', 'emphasis', 'aiComment', 'resources', 'discussion', 'attachments']);
      validateStoryDiscussion(story.discussion);
      validateAttachments(story.attachments, 'story attachments');
      for (const message of story.discussion || []) validateAttachments(message.attachments, 'discussion attachments');
      assert.ok(story.aiComment?.trim());
      validateEmphasis(story.text, story.emphasis || []);
      if (Array.isArray(story.resources)) {
        const deduped = [];
        const seen = new Set();
        for (const resource of story.resources) {
          allowedKeys(resource, ['kind', 'label', 'url']);
          const url = new URL(resource.url);
          assert.equal(url.protocol, 'https:');
          const allowQuery = url.hostname === 'mp.weixin.qq.com' && url.pathname === '/s';
          if (!allowQuery && url.search) url.search = '';
          assert.equal(url.username + url.password + (allowQuery ? '' : url.search), '');
          resource.url = url.toString();
          if (!seen.has(resource.url)) {
            seen.add(resource.url);
            deduped.push(resource);
          }
        }
        story.resources = deduped;
      }
    }
  }
  assert.doesNotMatch(JSON.stringify(issue), /evidence_ids|topic_key|"claims"|"audit"|aeskey/);
}
// Read all referenced media before changing release files.
const avatars = Object.values(snapshot.avatars);
await Promise.all(avatars.map(file => readFile(path.join(activityDirectory, file))));
const media = new Set(issues.flatMap(issue => issue.pages.flatMap(page => (page.stories || []).flatMap(story => [
  ...attachmentFiles(story.attachments),
  ...(story.discussion || []).flatMap(message => attachmentFiles(message.attachments)),
]))));
await Promise.all([...media].map(file => readFile(path.join(directory, file))));
const target = path.join(root, 'data/public-activity');
const mediaTarget = path.join(root, 'data');
for (const issue of issues) {
  await writeFile(path.join(root, 'data/editions', `${issue.date}.json`), JSON.stringify(issue, null, 2) + '\n');
}
for (const file of avatars) await copyFile(path.join(activityDirectory, file), path.join(target, file));
for (const file of media) {
  await mkdir(path.dirname(path.join(mediaTarget, file)), { recursive: true });
  await copyFile(path.join(directory, file), path.join(mediaTarget, file));
}
for (const name of await readdir(path.join(target, 'avatars'))) {
  if (!avatars.includes(`avatars/${name}`)) await unlink(path.join(target, 'avatars', name));
}
await writeFile(path.join(target, 'snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Packaged ${issues.length} editions, ${avatars.length} avatars and ${media.size} attachments; private batch files stay local.`);
