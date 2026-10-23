import { readFile, readdir } from 'node:fs/promises';

const idPattern = /^[a-z][a-z0-9-]*$/;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

export function validateCampaigns(campaigns, plugins) {
  if (!Array.isArray(campaigns)) throw new Error('Skin campaigns must be an array');
  const windows = campaigns.map(campaign => {
    if (!plugins.some(plugin => plugin.id === campaign.skin)) throw new Error(`Unknown skin: ${campaign.skin}`);
    for (const key of ['startsAt', 'endsAt']) {
      if (!instantPattern.test(campaign[key]) || !Number.isFinite(Date.parse(campaign[key]))) {
        throw new Error(`Skin ${key} must be an ISO timestamp with a timezone`);
      }
    }
    if (Date.parse(campaign.startsAt) >= Date.parse(campaign.endsAt)) throw new Error('Skin campaign must end after it starts');
    return campaign;
  }).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  for (let i = 1; i < windows.length; i++) {
    if (Date.parse(windows[i].startsAt) < Date.parse(windows[i - 1].endsAt)) {
      throw new Error('Skin campaigns must not overlap');
    }
  }
}

export async function loadSkins(root = new URL('./', import.meta.url)) {
  const plugins = [], assets = [];
  let css = await readFile(new URL('base.css', root), 'utf8');
  const directories = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const directory of directories) {
    if (!idPattern.test(directory.name) || ['default', 'auto'].includes(directory.name)) throw new Error('Invalid skin directory');
    const folder = new URL(`${directory.name}/`, root);
    const manifest = JSON.parse(await readFile(new URL('manifest.json', folder), 'utf8'));
    if (manifest.id !== directory.name) throw new Error('Skin id must match its directory');
    for (const field of ['name', 'eyebrow', 'label', 'message']) {
      if (typeof manifest[field] !== 'string' || !manifest[field].trim() || manifest[field].length > 80) {
        throw new Error(`Skin ${manifest.id} needs a short ${field}`);
      }
    }
    const plugin = Object.fromEntries(['id', 'name', 'eyebrow', 'label', 'message'].map(key => [key, manifest[key]]));
    for (const key of ['image', 'ornament']) {
      if (key === 'ornament' && manifest[key] === undefined) continue;
      if (!/^[a-z0-9-]+\.(png|jpg|webp)$/.test(manifest[key])) throw new Error('Skin image must be a local bitmap filename');
      const file = `skins/${manifest.id}/${manifest[key]}`;
      assets.push({ source: new URL(manifest[key], folder), file, plugin: manifest.id, key });
      plugin[key] = file;
    }
    plugins.push(plugin);
    // A plugin is incomplete unless both appearances are supplied.
    for (const mode of ['light', 'dark']) {
      const styles = await readFile(new URL(`${mode}.css`, folder), 'utf8');
      if (!styles.trim()) throw new Error(`Skin ${manifest.id} needs ${mode}.css`);
      css += mode === 'light' ? `\n${styles}` : `\n:root[data-color-scheme="dark"] {\n${styles}\n}\n`;
    }
  }
  const { campaigns } = JSON.parse(await readFile(new URL('config.json', root), 'utf8'));
  validateCampaigns(campaigns, plugins);
  return { data: { plugins, campaigns }, assets, css };
}
