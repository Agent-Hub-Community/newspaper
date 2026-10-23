import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digests } from '../digest.mjs';
import { mergeDraftEditions } from '../draft-editions.mjs';
import { validatePublicActivity } from '../public-activity.mjs';
import { validateStoryDiscussion } from '../story-discussion.mjs';
import { validateEmphasis } from '../emphasis.mjs';
import { isGroupId } from '../groups.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
assert.ok(process.argv[2], 'Provide an explicitly approved batch directory');
const directory = path.resolve(process.argv[2]);
const issues = JSON.parse(await readFile(path.join(directory, 'issues.json'), 'utf8'));
const activityDirectory = path.join(directory, 'activity');
const snapshot = JSON.parse(await readFile(path.join(activityDirectory, 'snapshot.json'), 'utf8'));
const review = JSON.parse(await readFile(path.join(activityDirectory, 'avatar-review.json'), 'utf8'));
assert.deepEqual(review.pending, [], 'Finish avatar review before publication');
const merged = mergeDraftEditions(digests, issues);
validatePublicActivity(snapshot, merged);
const latest = issues.map(issue => issue.date).sort().at(-1);
for (const period of ['week', 'month', 'all']) {
  assert.equal(snapshot.windows[period].through, latest, `Refresh ${period} ranking for the release date`);
}
for (const issue of issues) {
  for (const page of issue.pages.filter(page => isGroupId(page.id))) {
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
      allowedKeys(story, ['category', 'title', 'text', 'emphasis', 'aiComment', 'resources', 'discussion']);
      validateStoryDiscussion(story.discussion);
      assert.ok(story.aiComment?.trim());
      validateEmphasis(story.text, story.emphasis || []);
      for (const resource of story.resources || []) {
        allowedKeys(resource, ['kind', 'label', 'url']);
        const url = new URL(resource.url);
        assert.equal(url.protocol, 'https:');
        assert.equal(url.username + url.password + url.search, '');
      }
    }
  }
  assert.doesNotMatch(JSON.stringify(issue), /evidence_ids|topic_key|"claims"|"audit"|aeskey|wxid_|@chatroom/);
}
// Read all approved images before changing release files.
const avatars = Object.values(snapshot.avatars);
await Promise.all(avatars.map(file => readFile(path.join(activityDirectory, file))));
const target = path.join(root, 'public-activity');
// A batch refreshes only its own dates; every other published daily rank keeps its ranks and avatar bytes.
const published = JSON.parse(await readFile(path.join(target, 'snapshot.json'), 'utf8'));
const batchDates = new Set(issues.map(issue => issue.date));
const avatarHash = async (snap, dir, key) => snap.avatars[key]
  ? createHash('sha256').update(await readFile(path.join(dir, snap.avatars[key]))).digest('hex') : null;
for (const group of published.groups) {
  const next = snapshot.groups.find(g => g.id === group.id);
  for (const [date, stats] of Object.entries(group.daily)) {
    if (batchDates.has(date)) continue;
    const after = next?.daily[date]?.leaders || [];
    assert.deepEqual(after.map(m => m.rank), stats.leaders.map(m => m.rank), `Daily rank changed outside the batch: ${group.id} ${date}`);
    for (const [i, member] of stats.leaders.entries()) {
      assert.equal(await avatarHash(snapshot, activityDirectory, after[i].key), await avatarHash(published, target, member.key),
        `Daily rank avatar changed outside the batch: ${group.id} ${date}`);
    }
  }
}
for (const issue of issues) {
  await writeFile(path.join(root, 'editions', `${issue.date}.json`), JSON.stringify(issue, null, 2) + '\n');
}
for (const file of avatars) await copyFile(path.join(activityDirectory, file), path.join(target, file));
for (const name of await readdir(path.join(target, 'avatars'))) {
  if (!avatars.includes(`avatars/${name}`)) await unlink(path.join(target, 'avatars', name));
}
await writeFile(path.join(target, 'snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Packaged ${issues.length} approved editions and ${avatars.length} avatars; private batch files stay local.`);
