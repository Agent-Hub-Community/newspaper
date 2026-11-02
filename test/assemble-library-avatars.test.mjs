import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const placeholder = await readFile(new URL('./fixtures/placeholder-avatar.png', import.meta.url));
const photo = Buffer.from([255, 216, 255, 0, 1, 2, 3]);
const hashName = (bytes, ext) => `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ext}`;

// The script writes data/ next to itself, so it runs from a copy whose lib/ points at the real modules.
test('library sharers with the WeChat placeholder avatar are rejected without review', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'assemble-library-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'scripts'));
  await copyFile(path.join(repo, 'scripts/assemble-library.mjs'), path.join(root, 'scripts/assemble-library.mjs'));
  await symlink(path.join(repo, 'lib'), path.join(root, 'lib'));
  const dir = path.join(root, 'scratch/library');
  const save = async (name, value) => {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), Buffer.isBuffer(value) ? value : JSON.stringify(value));
  };
  await save('candidates.json', {
    since: '2026-10-01', generatedFrom: { through: '2026-10-31' },
    members: { ghost: { avatarUrl: 'https://wx.qlogo.cn/ghost' } },
    candidates: [{ key: 'k1', url: 'https://github.com/example/agent-kit', urls: [], shares: [
      { date: '2026-10-20', group: 'group-1', sender: 'alice' },
      { date: '2026-10-21', group: 'group-2', sender: 'ghost' },
      { date: '2026-10-22', group: 'group-3', sender: 'bob' },
    ] }],
  });
  await save('curated/batch-1.json', { items: [{ keys: ['k1'], title: 'AgentKit: example toolkit', summary: '示例条目。', type: 'code',
    topics: ['coding-agents'], keywords: ['agent', 'toolkit', 'example'], links: [{ key: 'k1', kind: 'code' }] }] });
  // An earlier approval of the placeholder must not let it through.
  await save('avatar-review.json', { approved: [hashName(photo, 'jpg'), hashName(placeholder, 'png')], rejected: [] });
  await save('avatar-cache/alice.jpg', photo);
  await save('avatar-cache/bob.png', placeholder);
  // ghost has no cache entry, so the script downloads it; the stub serves the placeholder instead of the network.
  const stub = path.join(root, 'stub-fetch.mjs');
  await writeFile(stub, `import { readFileSync } from 'node:fs';
globalThis.fetch = async () => new Response(readFileSync(${JSON.stringify(fileURLToPath(new URL('./fixtures/placeholder-avatar.png', import.meta.url)))}));\n`);

  const { stdout } = await promisify(execFile)(process.execPath,
    ['--import', pathToFileURL(stub).href, path.join(root, 'scripts/assemble-library.mjs'), '--dir', dir]);
  const summary = JSON.parse(stdout.slice(0, stdout.lastIndexOf('}') + 1));
  assert.equal(summary.placeholderAvatars, 2);
  assert.equal(summary.pendingAvatars, 0);
  const library = JSON.parse(await readFile(path.join(root, 'data/library.json'), 'utf8'));
  assert.deepEqual(library.items[0].shares.map(share => [share.group, share.avatar]),
    [['group-1', hashName(photo, 'jpg')], ['group-2', null], ['group-3', null]]);
  assert.deepEqual(await readdir(path.join(root, 'data/library-avatars')), [hashName(photo, 'jpg')]);
  assert.deepEqual(await readdir(path.join(dir, 'avatars-pending')), []);
  assert.deepEqual(await readdir(path.join(dir, 'avatar-cache')), ['alice.jpg'], 'placeholders leave the cache so a later run refetches');
});
