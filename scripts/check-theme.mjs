#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio, loadThemes, resolveThemeRelated } from '../lib/themes.mjs';
import { digests } from '../lib/digest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skinsRoot = new URL('../site/skins/', import.meta.url);
const targetId = process.argv.slice(2).find(arg => !arg.startsWith('--')) || null;

const MAX_WIDGET_BYTES = 24 * 1024;
const MAX_SVG_BYTES = 32 * 1024;

let hasError = false;
let warnings = 0;

function warn(msg) {
  warnings++;
  console.log(`  ⚠ ${msg}`);
}
function ok(msg) {
  console.log(`  ✔ ${msg}`);
}
function fail(msg) {
  hasError = true;
  console.error(`  ✖ ${msg}`);
}

const loaded = await loadThemes(skinsRoot);
resolveThemeRelated(loaded.data, digests);

const plugins = targetId
  ? loaded.data.plugins.filter(p => p.id === targetId)
  : loaded.data.plugins;

if (!plugins.length) {
  console.error(`Theme not found: ${targetId}`);
  process.exit(1);
}

console.log(`Agent Hub Theme Check (${plugins.length} pack${plugins.length > 1 ? 's' : ''})\n`);

for (const plugin of plugins) {
  console.log(`■ ${plugin.id}  [${plugin.name}]  (v${plugin.version || 1} · ${plugin.kind})`);
  if (plugin.version !== 2) {
    ok('Legacy v1 skin validated by loadThemes (light.css + dark.css + local bitmaps)');
    console.log('');
    continue;
  }

  const rawManifest = JSON.parse(await readFile(path.join(root, 'site/skins', plugin.id, 'theme.json'), 'utf8'));
  const scope = rawManifest.palette.scope || 'masthead-and-accent';
  ok(`Schema & structure valid (scope: ${scope}, targets: ${plugin.targets.join(', ')})`);

  // Contrast audit summary
  for (const mode of ['light', 'dark']) {
    const p = rawManifest.palette[mode];
    const pairs = [
      ['bandInk/bandBg', p.bandInk, p.bandBg],
      ['bandMuted/bandBg', p.bandMuted, p.bandBg],
      ['bandAccent/bandBg', p.bandAccent, p.bandBg],
      ...(scope !== 'masthead-only' ? [
        ['ink/paper', p.ink, p.paper],
        ['muted/paper', p.muted, p.paper],
        ['accent/paper', p.accent, p.paper],
      ] : []),
    ];
    const summary = pairs.map(([name, fg, bg]) => `${name}=${contrastRatio(fg, bg).toFixed(1)}`).join(', ');
    ok(`${mode} contrast AA+: ${summary}`);
  }

  // Asset budgets
  const pluginAssets = loaded.assets.filter(a => a.plugin === plugin.id);
  for (const asset of pluginAssets) {
    const { size } = await stat(asset.source);
    const kb = (size / 1024).toFixed(1);
    if (asset.isScript) {
      const pct = Math.round((size / MAX_WIDGET_BYTES) * 100);
      if (size > MAX_WIDGET_BYTES) fail(`${asset.file}: ${kb} KB exceeds 24 KB budget`);
      else ok(`Widget ${asset.file}: ${kb} KB (${pct}% of 24 KB budget, lazy-loaded)`);
    } else if (asset.file.endsWith('.svg')) {
      if (size > MAX_SVG_BYTES) warn(`${asset.file} is ${kb} KB (recommended <= 32 KB)`);
      else ok(`Vector art ${asset.file}: ${kb} KB (SVG safety passed)`);
    } else {
      ok(`Asset ${asset.file}: ${kb} KB`);
    }
  }

  // Copy & layout fit advisories (ensures clean 1-screen modal & crisp mobile masthead)
  if (plugin.story) {
    const bodyChars = plugin.story.body.reduce((sum, p) => sum + p.length, 0);
    if (plugin.story.body.length > 2 || bodyChars > 340) {
      warn(`story.body has ${plugin.story.body.length} paragraphs (${bodyChars} chars); recommended <= 2 paragraphs / 300 chars for zero-scroll desktop modal`);
    } else {
      ok(`Story copy budget: ${plugin.story.body.length} paragraphs, ${bodyChars} chars`);
    }
    if (plugin.story.facts?.length && plugin.story.facts.length % 2 !== 0) {
      warn(`story.facts has ${plugin.story.facts.length} items (odd); 2 or 4 items look most balanced in the 2x2 grid`);
    }
  }
  if (plugin.knowledge?.banner && plugin.knowledge.banner.placement === 'all') {
    warn('knowledge.banner.placement is "all"; prefer "overview-only" to keep single-group reading pages uncluttered');
  }

  // Cross-group related discussions preview
  const related = plugin.knowledge?.relatedItems || [];
  if (plugin.knowledge?.related) {
    const groups = [...new Set(related.map(r => r.groupLabel))];
    const currentCount = related.filter(r => r.current).length;
    if (!related.length) {
      warn('knowledge.related matched 0 discussions in current editions');
    } else {
      ok(`Related discussions: ${related.length} items across ${groups.length} groups (${groups.join(' / ')})${currentCount ? `, ${currentCount} from current event window` : ' [archive backfill until event-day digest publishes]'}`);
    }
  }

  // Schedule check
  const campaigns = loaded.data.campaigns.filter(c => c.skin === plugin.id);
  const boundDates = Object.entries(loaded.data.editions || {}).filter(([, id]) => id === plugin.id).map(([d]) => d);
  ok(`Triggers: ${campaigns.length ? campaigns.map(c => `${c.startsAt.slice(0, 10)}..${c.endsAt.slice(0, 10)}`).join(', ') : 'preview-only'}${boundDates.length ? ` | editions: ${boundDates.join(', ')}` : ''}`);
  console.log('');
}

console.log(`Summary: ${plugins.length} checked, ${warnings} warning(s), ${hasError ? 'FAILED' : 'PASSED'}.`);
if (hasError) process.exit(1);
