import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, cp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { loadSkins, validateCampaigns } from '../skins/build.mjs';

const loaded = await loadSkins();
const campaign = {
  skin: 'mid-autumn',
  startsAt: '2026-09-25T00:00:00+08:00',
  endsAt: '2026-09-28T00:00:00+08:00',
};
validateCampaigns([campaign], loaded.data.plugins);
const scheduled = { ...loaded.data, campaigns: [campaign] };
const context = { window: {}, document: { querySelector: () => null } };
vm.runInNewContext(await readFile(new URL('../skins.js', import.meta.url), 'utf8'), context);
const select = (preview, now, data = scheduled) => context.window.AgentHubSkins.selectSkin(data, preview, Date.parse(now))?.id || null;

test('production schedule restores the normal theme outside National Day', () => {
  for (const date of ['2026-09-25T12:00:00Z', '2026-09-28T00:00:00+08:00']) {
    assert.equal(select(null, date, loaded.data), null);
    assert.equal(select('unknown', date, loaded.data), null);
  }
  assert.equal(select('mid-autumn', '2026-09-28T00:00:00+08:00', loaded.data), 'mid-autumn');
  assert.equal(select(null, '2026-09-30T23:59:59+08:00', loaded.data), null);
  assert.equal(select(null, '2026-10-01T00:00:00+08:00', loaded.data), 'national-day');
  assert.equal(select(null, '2026-10-07T23:59:59+08:00', loaded.data), 'national-day');
  assert.equal(select(null, '2026-10-08T00:00:00+08:00', loaded.data), null);
  assert.equal(select('default', '2026-10-01T12:00:00+08:00', loaded.data), null);
});

test('campaign uses actual instants, inclusive start and exclusive end', () => {
  assert.equal(select(null, '2026-09-24T15:59:59Z'), null);
  assert.equal(select(null, '2026-09-24T16:00:00Z'), 'mid-autumn');
  assert.equal(select(null, '2026-09-27T15:59:59Z'), 'mid-autumn');
  assert.equal(select(null, '2026-09-27T16:00:00Z'), null);
  assert.equal(select(null, '2027-09-25T12:00:00+08:00'), null);
});

test('preview supports explicit plugin, default, and unknown-id automatic behavior', () => {
  assert.equal(select('mid-autumn', '2027-01-01T00:00:00Z'), 'mid-autumn');
  assert.equal(select('default', '2026-09-25T12:00:00Z'), null);
  assert.equal(select('../../unknown', '2026-09-25T12:00:00Z'), 'mid-autumn');
  assert.equal(select('unknown', '2027-01-01T00:00:00Z'), null);
});

test('rejects ambiguous schedules and unknown plugins', () => {
  const check = campaigns => validateCampaigns(campaigns, loaded.data.plugins);
  assert.throws(() => check([{ ...campaign, skin: 'unknown' }]), /Unknown skin/);
  assert.throws(() => check([{ ...campaign, startsAt: '2026-09-25' }]), /timezone/);
  assert.throws(() => check([{ ...campaign, endsAt: campaign.startsAt }]), /end after/);
  assert.throws(() => check([campaign, campaign]), /overlap/);
  assert.doesNotThrow(() => check([campaign, { ...campaign, startsAt: campaign.endsAt, endsAt: '2026-10-01T00:00:00+08:00' }]));
  assert.doesNotThrow(() => check([]));
});

test('every plugin ships both appearances and local assets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agenthub-skins-'));
  try {
    await cp(new URL('../skins/', import.meta.url), root, { recursive: true });
    const url = pathToFileURL(root + path.sep);
    const theme = await loadSkins(url);
    for (const plugin of theme.data.plugins) {
      for (const key of ['image', 'ornament'].filter(key => plugin[key])) {
        assert.ok(theme.assets.some(asset => asset.file === plugin[key]));
      }
    }
    assert.match(theme.css, /data-color-scheme="dark"/);
    await rm(path.join(root, 'mid-autumn/dark.css'));
    await assert.rejects(loadSkins(url), /dark.css/);
    await writeFile(path.join(root, 'mid-autumn/dark.css'), '');
    await assert.rejects(loadSkins(url), /needs dark.css/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
