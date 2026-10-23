import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { loadSkins } from '../skins/build.mjs';

const skins = await loadSkins();
const source = await readFile(new URL('../skins.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function preview(search) {
  const { document } = parseHTML(html);
  const window = {
    AGENT_HUB_DATA: { skins: { ...skins.data, campaigns: [] } },
    AgentHubRoutes: { asset: file => `/preview/${file}` },
    addEventListener() {},
  };
  vm.runInNewContext(source, {
    document, window, location: { search }, URLSearchParams, clearTimeout,
    setTimeout() { assert.fail('Disabled campaigns must not start timers'); },
  });
  return { document, selectSkin: window.AgentHubSkins.selectSkin };
}

test('National Day explicit preview works independently of campaigns', () => {
  const { document, selectSkin } = preview('?skin=national-day');
  assert.equal(document.body.dataset.skin, 'national-day');
  assert.equal(document.querySelector('.masthead').dataset.skin, 'national-day');
  assert.equal(document.querySelector('.skin-note').hidden, false);
  assert.equal(document.querySelector('.skin-art').getAttribute('src'), '/preview/skins/national-day/fireworks.png');
  assert.equal(document.querySelector('.skin-flora').hidden, true);
  assert.equal(document.querySelector('.skin-flora').hasAttribute('src'), false);
  const unscheduled = { ...skins.data, campaigns: [] };
  for (const date of ['2026-09-30T12:00:00+08:00', '2026-10-01T00:00:00+08:00', '2026-10-07T23:59:59+08:00']) {
    for (const name of [null, 'default', 'unknown']) {
      assert.equal(selectSkin(unscheduled, name, Date.parse(date)), null);
    }
    assert.equal(selectSkin(skins.data, 'national-day', Date.parse(date)).id, 'national-day');
  }
});

test('removing preview restores the masthead and hides decorative images', () => {
  for (const query of ['', '?skin=default', '?skin=unknown']) {
    const { document } = preview(query);
    assert.equal(document.body.dataset.skin, 'default');
    for (const selector of ['.skin-note', '.skin-art', '.skin-flora']) {
      assert.equal(document.querySelector(selector).hidden, true);
    }
    assert.equal(document.querySelector('.skin-art').hasAttribute('src'), false);
    assert.equal(document.querySelector('.masthead-top > span').textContent, '', 'the eyebrow strip only carries a skin');
  }
});

test('capture-stage clones retain the local image and themed masthead', () => {
  const { document } = preview('?skin=national-day');
  const clone = document.querySelector('.paper-shell').cloneNode(true);
  assert.equal(clone.querySelector('.masthead').dataset.skin, 'national-day');
  assert.equal(clone.querySelector('.skin-art').getAttribute('src'), '/preview/skins/national-day/fireworks.png');
  assert.equal(clone.querySelector('.skin-note').hidden, false);
});

test('National Day asset is a small decodable RGBA PNG in the export asset inventory', async () => {
  const plugin = skins.data.plugins.find(plugin => plugin.id === 'national-day');
  const asset = skins.assets.find(asset => asset.plugin === plugin.id && asset.key === 'image');
  assert.equal(asset.file, plugin.image);
  const png = await readFile(asset.source);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.ok(width > 0 && width <= 128 && height > 0 && height <= 128);
  assert.equal(png[24], 8);
  assert.equal(png[25], 6);
  const compressed = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      compressed.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(compressed));
  assert.equal(rows.length, height * (width * 4 + 1));
  const alpha = [];
  for (let y = 0; y < height; y++) {
    assert.equal(rows[y * (width * 4 + 1)], 0);
    for (let x = 0; x < width; x++) alpha.push(rows[y * (width * 4 + 1) + 4 + x * 4]);
  }
  assert.ok(alpha.includes(0) && alpha.includes(255), 'transparent background and painted pixels');
  assert.ok(png.length < 8192);
});
