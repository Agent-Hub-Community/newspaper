import { readFile, readdir } from 'node:fs/promises';

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const BITMAP_PATTERN = /^[a-z0-9-]+\.(png|jpg|webp)$/;
const ASSET_PATTERN = /^[a-z0-9-]+\.(png|jpg|webp|svg)$/;
const VALID_KINDS = new Set(['holiday', 'milestone', 'knowledge', 'community']);
const VALID_SCOPES = new Set(['masthead-only', 'masthead-and-accent', 'full-paper']);
const VALID_TARGETS = new Set(['daily', 'weekly', 'library', 'glossary', 'rank', 'search', 'agents', 'home']);
const VALID_AMBIENTS = new Set(['none', 'critical-line', 'stardust', 'snow', 'lantern']);
const VALID_ACTIONS = new Set(['open-story']);

export function parseHexColor(hex) {
  if (typeof hex !== 'string' || !HEX_COLOR_PATTERN.test(hex)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const raw = hex.slice(1);
  const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
}

export function relativeLuminance(hex) {
  const [r, g, b] = parseHexColor(hex)
    .map(v => v / 255)
    .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

export function contrastRatio(fgHex, bgHex) {
  const l1 = relativeLuminance(fgHex);
  const l2 = relativeLuminance(bgHex);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function validateSvgSafety(svg, label = 'SVG asset') {
  if (!/<svg[\s>]/i.test(svg)) throw new Error(`${label} must contain an <svg> root element`);
  if (/<script\b/i.test(svg)) throw new Error(`${label} must not contain <script>`);
  if (/<foreignObject\b/i.test(svg)) throw new Error(`${label} must not contain <foreignObject>`);
  if (/\son[a-z]+\s*=/i.test(svg)) throw new Error(`${label} must not contain inline event handlers`);
  if (/javascript\s*:/i.test(svg)) throw new Error(`${label} must not contain javascript: URLs`);
  if (/url\(\s*['"]?\s*https?:/i.test(svg) || /\b(?:href|xlink:href)\s*=\s*['"]\s*https?:/i.test(svg)) {
    throw new Error(`${label} must not reference external http(s) URLs`);
  }
}

export function validateScopedCss(css, id, label = 'extra.css') {
  if (/@import\b/i.test(css)) throw new Error(`${label} must not use @import`);
  if (/url\(\s*['"]?\s*(?:https?:|\/\/)/i.test(css)) throw new Error(`${label} must not reference external URLs`);
  if (!css.includes(`data-skin="${id}"`) && !css.includes(`data-skin='${id}'`)) {
    throw new Error(`${label} must scope selectors to data-skin="${id}"`);
  }
}

function assertShortString(value, field, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`${field} must be a non-empty string (<= ${max} chars)`);
  }
  return value.trim();
}

function validateSafeHref(href, field) {
  if (typeof href !== 'string' || !href.trim()) throw new Error(`${field} must be a non-empty href`);
  const trimmed = href.trim();
  if (/^(?:javascript|data|vbscript):/i.test(trimmed) || /^\/\//.test(trimmed)) {
    throw new Error(`${field} uses an unsafe URL scheme`);
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error(`${field} external URL must be clean https://`);
    }
    return parsed.href;
  }
  return trimmed;
}

function validatePaletteMode(modeTokens, scope, label) {
  if (!modeTokens || typeof modeTokens !== 'object') {
    throw new Error(`${label} palette must be an object`);
  }
  const requiredBand = ['bandBg', 'bandInk', 'bandMuted', 'bandAccent', 'bandRule'];
  const requiredReading = scope === 'masthead-only' ? [] : ['paper', 'ink', 'muted', 'rule', 'accent'];
  for (const key of [...requiredBand, ...requiredReading]) {
    parseHexColor(modeTokens[key]);
  }
  for (const optionalKey of ['surface', 'link', 'emphasis', 'bandHover', 'bannerBg', 'bannerBorder']) {
    if (modeTokens[optionalKey] !== undefined) parseHexColor(modeTokens[optionalKey]);
  }
  const checkContrast = (fgKey, bgKey, min = 4.5) => {
    const ratio = contrastRatio(modeTokens[fgKey], modeTokens[bgKey]);
    if (ratio < min) {
      throw new Error(`${label} contrast ${fgKey} (${modeTokens[fgKey]}) on ${bgKey} (${modeTokens[bgKey]}) is ${ratio.toFixed(2)}, requires >= ${min}`);
    }
  };
  checkContrast('bandInk', 'bandBg', 4.5);
  checkContrast('bandMuted', 'bandBg', 4.5);
  checkContrast('bandAccent', 'bandBg', 4.5);
  if (scope !== 'masthead-only') {
    checkContrast('ink', 'paper', 4.5);
    checkContrast('muted', 'paper', 4.5);
    checkContrast('accent', 'paper', 4.5);
    if (modeTokens.link) checkContrast('link', 'paper', 4.5);
  }
}

export function compileThemeCss(manifest) {
  const id = manifest.id;
  const scope = manifest.palette.scope || 'masthead-and-accent';
  const sel = `body[data-skin="${id}"]`;
  const renderMode = (tokens, isDark) => {
    const lines = [];
    const bandVars = [
      `--skin-paper: ${tokens.bandBg};`,
      `--skin-ink: ${tokens.bandInk};`,
      `--skin-muted: ${tokens.bandMuted};`,
      `--skin-accent: ${tokens.bandAccent};`,
      `--skin-rule: ${tokens.bandRule};`,
      `--skin-band-hover: ${tokens.bandHover || (isDark ? 'rgb(255 255 255 / 10%)' : 'rgb(255 255 255 / 12%)')};`,
      `--theme-banner-bg: ${tokens.bannerBg || tokens.surface || (isDark ? '#121a2d' : '#f1f3f8')};`,
      `--theme-banner-border: ${tokens.bannerBorder || tokens.rule || tokens.bandRule};`,
    ];
    const readingVars = [];
    if (scope === 'full-paper') {
      readingVars.push(
        `color-scheme: ${isDark ? 'dark' : 'light'};`,
        `--paper: ${tokens.paper};`,
        `--ink: ${tokens.ink};`,
        `--muted: ${tokens.muted};`,
        `--rule: ${tokens.rule};`,
        `--accent: ${tokens.accent};`,
      );
      if (tokens.emphasis) readingVars.push(`--emphasis-marker: ${tokens.emphasis};`);
      if (tokens.surface) readingVars.push(`--scheme-hover: ${tokens.surface};`);
    } else if (scope === 'masthead-and-accent') {
      readingVars.push(`--accent: ${tokens.accent};`);
      if (tokens.emphasis) readingVars.push(`--emphasis-marker: ${tokens.emphasis};`);
    }
    lines.push(`${sel}, ${sel}[data-view], ${sel}[data-page] { ${[...bandVars, ...readingVars].join(' ')} }`);
    lines.push(
      `${sel} .masthead-brand { --ink: var(--skin-ink); --muted: var(--skin-muted); --accent: var(--skin-accent); --rule: var(--skin-rule); border-bottom: 1px solid var(--skin-rule); }`,
      `${sel} .masthead-brand .icon-button:hover:not(:disabled), ${sel} .masthead-brand .skin-story-trigger:hover { color: var(--skin-ink); background-color: var(--skin-band-hover); }`,
      `${sel} .masthead-brand :focus-visible { outline-color: var(--skin-accent); }`,
      `${sel} .masthead-brand ::selection { color: var(--skin-paper); background-color: var(--skin-accent); }`,
    );
    if (scope !== 'masthead-only') {
      const linkColor = tokens.link || tokens.accent;
      lines.push(
        `${sel} .edition-nav { border-bottom-color: var(--rule); }`,
        `${sel} .tabs :is(a, button).active, ${sel} .tabs :is(a, button)[aria-current="page"] { color: var(--accent); border-bottom-color: var(--accent); }`,
        `${sel} .brief-comment-label, ${sel} .comment-label, ${sel} .brief-takeaway > span, ${sel} .digest-kicker { color: var(--accent); }`,
        `${sel} .brief-comment, ${sel} .comment { border-left-color: var(--accent); }`,
        `${sel} .archive-content a, ${sel} .brief-resources a:hover, ${sel} .resources a:hover, ${sel} .inline-link { color: ${linkColor}; }`,
      );
    }
    return lines.join('\n');
  };
  const lightCss = renderMode(manifest.palette.light, false);
  const darkCss = `:root[data-color-scheme="dark"] {\n${renderMode(manifest.palette.dark, true)}\n}`;
  return `${lightCss}\n${darkCss}\n`;
}

export function validateCampaigns(campaigns, plugins) {
  if (!Array.isArray(campaigns)) throw new Error('Skin campaigns must be an array');
  const windows = campaigns.map(campaign => {
    if (!plugins.some(plugin => plugin.id === campaign.skin)) throw new Error(`Unknown skin: ${campaign.skin}`);
    for (const key of ['startsAt', 'endsAt']) {
      if (!INSTANT_PATTERN.test(campaign[key]) || !Number.isFinite(Date.parse(campaign[key]))) {
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

export function validateEditions(editions, plugins) {
  if (editions === undefined) return {};
  if (!editions || typeof editions !== 'object' || Array.isArray(editions)) {
    throw new Error('Theme editions map must be an object of YYYY-MM-DD -> theme id');
  }
  const normalized = {};
  for (const [date, skinId] of Object.entries(editions)) {
    if (!DATE_PATTERN.test(date)) throw new Error(`Invalid edition binding date: ${date}`);
    if (!plugins.some(plugin => plugin.id === skinId)) throw new Error(`Unknown skin in edition binding: ${skinId}`);
    normalized[date] = skinId;
  }
  return normalized;
}

async function loadV1Plugin(directory, folder) {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', folder), 'utf8'));
  if (manifest.id !== directory.name) throw new Error('Skin id must match its directory');
  for (const field of ['name', 'eyebrow', 'label', 'message']) {
    if (typeof manifest[field] !== 'string' || !manifest[field].trim() || manifest[field].length > 80) {
      throw new Error(`Skin ${manifest.id} needs a short ${field}`);
    }
  }
  const plugin = {
    version: 1,
    kind: 'holiday',
    ...Object.fromEntries(['id', 'name', 'eyebrow', 'label', 'message'].map(key => [key, manifest[key]])),
  };
  const assets = [];
  for (const key of ['image', 'ornament']) {
    if (key === 'ornament' && manifest[key] === undefined) continue;
    if (!BITMAP_PATTERN.test(manifest[key])) throw new Error('Skin image must be a local bitmap filename');
    const file = `skins/${manifest.id}/${manifest[key]}`;
    assets.push({ source: new URL(manifest[key], folder), file, plugin: manifest.id, key });
    plugin[key] = file;
  }
  let css = '';
  // A v1 plugin is incomplete unless both appearances are supplied.
  for (const mode of ['light', 'dark']) {
    const styles = await readFile(new URL(`${mode}.css`, folder), 'utf8');
    if (!styles.trim()) throw new Error(`Skin ${manifest.id} needs ${mode}.css`);
    css += mode === 'light' ? `\n${styles}` : `\n:root[data-color-scheme="dark"] {\n${styles}\n}\n`;
  }
  return { plugin, assets, css };
}

async function loadV2Plugin(directory, folder) {
  const manifest = JSON.parse(await readFile(new URL('theme.json', folder), 'utf8'));
  if (manifest.version !== 2) throw new Error(`Theme ${directory.name} must declare version: 2`);
  if (manifest.id !== directory.name) throw new Error('Skin id must match its directory');
  if (!VALID_KINDS.has(manifest.kind)) throw new Error(`Theme ${manifest.id} has invalid kind: ${manifest.kind}`);
  const name = assertShortString(manifest.name, `Theme ${manifest.id} name`, 60);
  const summary = assertShortString(manifest.summary || name, `Theme ${manifest.id} summary`, 220);

  const targets = Array.isArray(manifest.targets) && manifest.targets.length
    ? manifest.targets.map(target => {
      if (!VALID_TARGETS.has(target)) throw new Error(`Theme ${manifest.id} has invalid target: ${target}`);
      return target;
    })
    : ['daily', 'weekly', 'library', 'glossary', 'rank', 'search', 'agents'];

  const masthead = manifest.masthead;
  if (!masthead || typeof masthead !== 'object') throw new Error(`Theme ${manifest.id} needs masthead`);
  const eyebrow = assertShortString(masthead.eyebrow, `Theme ${manifest.id} masthead.eyebrow`, 80);
  const label = assertShortString(masthead.label, `Theme ${manifest.id} masthead.label`, 40);
  const message = assertShortString(masthead.message, `Theme ${manifest.id} masthead.message`, 100);

  const palette = manifest.palette;
  if (!palette || typeof palette !== 'object') throw new Error(`Theme ${manifest.id} needs palette`);
  const scope = palette.scope || 'masthead-and-accent';
  if (!VALID_SCOPES.has(scope)) throw new Error(`Theme ${manifest.id} has invalid palette.scope: ${scope}`);
  validatePaletteMode(palette.light, scope, `Theme ${manifest.id} light`);
  validatePaletteMode(palette.dark, scope, `Theme ${manifest.id} dark`);

  const assets = [];
  const registerAsset = async (filename, key) => {
    if (!ASSET_PATTERN.test(filename)) throw new Error(`Theme ${manifest.id} ${key} must be a local png/jpg/webp/svg filename`);
    const source = new URL(filename, folder);
    const bytes = await readFile(source);
    if (filename.endsWith('.svg')) validateSvgSafety(bytes.toString('utf8'), `Theme ${manifest.id} ${filename}`);
    const file = `skins/${manifest.id}/${filename}`;
    assets.push({ source, file, plugin: manifest.id, key });
    return file;
  };

  let image;
  let artAlt = '';
  let artStyle = 'vector';
  if (masthead.art?.file) {
    image = await registerAsset(masthead.art.file, 'image');
    artAlt = typeof masthead.art.alt === 'string' ? masthead.art.alt.trim().slice(0, 120) : '';
    artStyle = masthead.art.pixelated ? 'pixel' : masthead.art.file.endsWith('.svg') ? 'vector' : 'bitmap';
  }
  let ornament;
  if (masthead.ornament?.file) {
    ornament = await registerAsset(masthead.ornament.file, 'ornament');
  }

  let seal = null;
  if (masthead.seal) {
    seal = {
      text: assertShortString(masthead.seal.text, `Theme ${manifest.id} masthead.seal.text`, 24),
      ...(masthead.seal.caption ? { caption: assertShortString(masthead.seal.caption, `Theme ${manifest.id} masthead.seal.caption`, 24) } : {}),
    };
  }
  const footerNote = masthead.footerNote
    ? assertShortString(masthead.footerNote, `Theme ${manifest.id} masthead.footerNote`, 100)
    : null;

  let story = null;
  if (masthead.story) {
    const s = masthead.story;
    const body = Array.isArray(s.body) ? s.body.map((p, i) => assertShortString(p, `Theme ${manifest.id} story.body[${i}]`, 400)) : [];
    if (!body.length) throw new Error(`Theme ${manifest.id} story.body must be a non-empty array`);
    story = {
      kicker: assertShortString(s.kicker || label, `Theme ${manifest.id} story.kicker`, 40),
      title: assertShortString(s.title, `Theme ${manifest.id} story.title`, 100),
      body,
      facts: Array.isArray(s.facts) ? s.facts.slice(0, 6).map((fact, i) => ({
        label: assertShortString(fact.label, `Theme ${manifest.id} story.facts[${i}].label`, 24),
        value: assertShortString(fact.value, `Theme ${manifest.id} story.facts[${i}].value`, 32),
      })) : [],
      links: Array.isArray(s.links) ? s.links.slice(0, 4).map((link, i) => ({
        label: assertShortString(link.label, `Theme ${manifest.id} story.links[${i}].label`, 40),
        href: validateSafeHref(link.href, `Theme ${manifest.id} story.links[${i}].href`),
      })) : [],
    };
  }

  let ambient = null;
  if (manifest.ambient?.preset && manifest.ambient.preset !== 'none') {
    if (!VALID_AMBIENTS.has(manifest.ambient.preset)) {
      throw new Error(`Theme ${manifest.id} has unknown ambient preset: ${manifest.ambient.preset}`);
    }
    ambient = { preset: manifest.ambient.preset, region: 'masthead' };
  }

  let knowledge = null;
  if (manifest.knowledge) {
    knowledge = {};
    if (manifest.knowledge.banner) {
      const b = manifest.knowledge.banner;
      const placement = b.placement === 'all' ? 'all' : 'overview-only';
      knowledge.banner = {
        dismissible: b.dismissible !== false,
        placement,
        kicker: assertShortString(b.kicker || label, `Theme ${manifest.id} knowledge.banner.kicker`, 32),
        text: assertShortString(b.text, `Theme ${manifest.id} knowledge.banner.text`, 200),
        links: Array.isArray(b.links) ? b.links.slice(0, 4).map((link, i) => {
          const entry = { label: assertShortString(link.label, `Theme ${manifest.id} banner.links[${i}].label`, 36) };
          if (link.action) {
            if (!VALID_ACTIONS.has(link.action)) throw new Error(`Unknown theme banner action: ${link.action}`);
            entry.action = link.action;
          } else {
            entry.href = validateSafeHref(link.href, `Theme ${manifest.id} banner.links[${i}].href`);
          }
          return entry;
        }) : [],
      };
    }
    if (manifest.knowledge.highlight) {
      const h = manifest.knowledge.highlight;
      const keywords = Array.isArray(h.keywords) ? h.keywords.map(k => assertShortString(k, `Theme ${manifest.id} highlight keyword`, 40)) : [];
      if (keywords.length) {
        knowledge.highlight = {
          badge: assertShortString(h.badge || label, `Theme ${manifest.id} highlight.badge`, 32),
          keywords,
        };
      }
    }
    if (manifest.knowledge.related) {
      const r = manifest.knowledge.related;
      const keywords = Array.isArray(r.keywords) ? r.keywords.map(k => assertShortString(k, `Theme ${manifest.id} related keyword`, 40)) : [];
      if (keywords.length) {
        knowledge.related = {
          heading: assertShortString(r.heading || '各群相关讨论', `Theme ${manifest.id} related.heading`, 32),
          keywords,
          limit: Math.max(1, Math.min(12, Number(r.limit) || 6)),
          maxPerGroup: Math.max(1, Math.min(4, Number(r.maxPerGroup) || 2)),
        };
      }
    }
    if (Array.isArray(manifest.knowledge.searchExamples) && manifest.knowledge.searchExamples.length) {
      knowledge.searchExamples = manifest.knowledge.searchExamples
        .slice(0, 5)
        .map(k => assertShortString(k, `Theme ${manifest.id} searchExample`, 24));
    }
  }

  let home = null;
  if (manifest.home && typeof manifest.home === 'object') {
    const h = manifest.home;
    home = {
      eyebrow: assertShortString(h.eyebrow || eyebrow, `Theme ${manifest.id} home.eyebrow`, 80),
      badge: assertShortString(h.badge || label, `Theme ${manifest.id} home.badge`, 40),
      summary: assertShortString(h.summary || message, `Theme ${manifest.id} home.summary`, 160),
      href: validateSafeHref(h.href || `/newspaper/?theme=${manifest.id}`, `Theme ${manifest.id} home.href`),
      ...(h.galaxyCore ? { galaxyCore: (parseHexColor(h.galaxyCore), h.galaxyCore) } : {}),
      ...(h.galaxyArm ? { galaxyArm: (parseHexColor(h.galaxyArm), h.galaxyArm) } : {}),
      ...(h.accent ? { accent: (parseHexColor(h.accent), h.accent) } : { accent: palette.dark.bandAccent }),
      ...(h.bandBg ? { bandBg: (parseHexColor(h.bandBg), h.bandBg) } : { bandBg: palette.dark.bandBg }),
      ...(h.asciiHands ? {
        asciiHands: {
          ...(h.asciiHands.humanColor ? { humanColor: (parseHexColor(h.asciiHands.humanColor), h.asciiHands.humanColor) } : {}),
          ...(h.asciiHands.machineColor ? { machineColor: (parseHexColor(h.asciiHands.machineColor), h.asciiHands.machineColor) } : {}),
          ...(Array.isArray(h.asciiHands.glyphBands) && h.asciiHands.glyphBands.length >= 4
            ? { glyphBands: h.asciiHands.glyphBands.map(band => assertShortString(band, `Theme ${manifest.id} glyphBand`, 24)) }
            : {}),
        },
      } : {}),
    };
  }

  let css = `\n${compileThemeCss(manifest)}`;
  const extraCss = await readFile(new URL('extra.css', folder), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  if (extraCss.trim()) {
    validateScopedCss(extraCss, manifest.id, `Theme ${manifest.id} extra.css`);
    css += `\n${extraCss}\n`;
  }

  const plugin = {
    version: 2,
    id: manifest.id,
    kind: manifest.kind,
    name,
    summary,
    targets,
    scope,
    eyebrow,
    label,
    message,
    ...(image ? { image, artAlt, artStyle } : {}),
    ...(ornament ? { ornament } : {}),
    ...(seal ? { seal } : {}),
    ...(footerNote ? { footerNote } : {}),
    ...(story ? { story } : {}),
    ...(ambient ? { ambient } : {}),
    ...(knowledge ? { knowledge } : {}),
    ...(home ? { home } : {}),
  };
  return { plugin, assets, css };
}

function buildKeywordMatcher(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/^[a-z0-9._-]+$/i.test(keyword)) {
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
  }
  return new RegExp(escaped, 'i');
}

function toBeijingDate(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
}

function eventDateMatcher(pluginId, campaigns = [], editions = {}) {
  const boundDates = new Set(Object.entries(editions).filter(([, id]) => id === pluginId).map(([d]) => d));
  const windows = campaigns
    .filter(c => c.skin === pluginId)
    .map(c => ({ start: toBeijingDate(c.startsAt), end: toBeijingDate(c.endsAt) }))
    .filter(w => w.start && w.end);
  return date => boundDates.has(date) || windows.some(w => date >= w.start && date <= w.end);
}

export function resolveThemeRelated(themesData, editions = []) {
  if (!themesData?.plugins?.length || !Array.isArray(editions)) return themesData;
  const sortedEditions = [...editions].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  for (const plugin of themesData.plugins) {
    const spec = plugin.knowledge?.related;
    if (!spec?.keywords?.length) continue;
    const matchers = spec.keywords.map(k => ({ keyword: k, regex: buildKeywordMatcher(k) }));
    const isEventDate = eventDateMatcher(plugin.id, themesData.campaigns, themesData.editions);
    const candidates = [];
    for (const issue of sortedEditions) {
      const inEventWindow = isEventDate(issue.date);
      for (const page of issue.pages || []) {
        if (!String(page.id || '').startsWith('group-')) continue;
        const readable = (page.stories || []).filter(s => typeof s.text === 'string' && s.text.trim());
        readable.forEach((story, index) => {
          const title = String(story.title || '');
          const body = `${story.text || ''} ${story.takeaway || ''}`;
          const titleHits = matchers.filter(m => m.regex.test(title)).length;
          const bodyHits = matchers.filter(m => m.regex.test(body)).length;
          // During the event window itself, even 1 keyword hit in the body qualifies so same-day discussions surface immediately.
          if (titleHits === 0 && bodyHits < (inEventWindow ? 1 : 2)) return;
          const score = titleHits * 8 + bodyHits * 2;
          candidates.push({
            date: issue.date,
            groupId: page.id,
            groupLabel: page.label || page.id,
            topic: index + 1,
            title,
            href: `daily/${issue.date}/${page.id}/#topic-${index + 1}`,
            inEventWindow,
            score,
          });
        });
      }
    }
    // Same-day / campaign-window discussions ALWAYS lead; within each tier sort by relevance then recency.
    candidates.sort((a, b) => Number(b.inEventWindow) - Number(a.inEventWindow) || b.score - a.score || b.date.localeCompare(a.date));
    const picked = [];
    const seenTitle = new Set();
    const groupCount = new Map();
    const tryPick = (pool, cap) => {
      for (const item of pool) {
        if (picked.length >= spec.limit) break;
        const normTitle = item.title.replace(/\s+/g, '').slice(0, 18);
        if (seenTitle.has(normTitle)) continue;
        const count = groupCount.get(item.groupId) || 0;
        if (count >= cap) continue;
        seenTitle.add(normTitle);
        groupCount.set(item.groupId, count + 1);
        picked.push({
          date: item.date,
          groupId: item.groupId,
          groupLabel: item.groupLabel,
          topic: item.topic,
          title: item.title,
          href: item.href,
          ...(item.inEventWindow ? { current: true } : {}),
        });
      }
    };
    const eventPool = candidates.filter(c => c.inEventWindow);
    const archivePool = candidates.filter(c => !c.inEventWindow);
    // Pass 1: prioritize same-day / campaign-window group discussions first (1 per group, then up to maxPerGroup).
    tryPick(eventPool, 1);
    if (picked.length < spec.limit && spec.maxPerGroup > 1) tryPick(eventPool, spec.maxPerGroup);
    // Pass 2: backfill remaining slots with historical cross-group discussions.
    if (picked.length < spec.limit) tryPick(archivePool, 1);
    if (picked.length < spec.limit && spec.maxPerGroup > 1) tryPick(archivePool, spec.maxPerGroup);
    plugin.knowledge.relatedItems = picked;
  }
  return themesData;
}

export async function loadThemes(root = new URL('../site/skins/', import.meta.url)) {
  const plugins = [], assets = [];
  let css = await readFile(new URL('base.css', root), 'utf8');
  const directories = (await readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const directory of directories) {
    if (!ID_PATTERN.test(directory.name) || ['default', 'auto'].includes(directory.name)) {
      throw new Error('Invalid skin directory');
    }
    const folder = new URL(`${directory.name}/`, root);
    const entries = new Set((await readdir(folder)).map(String));
    const loaded = entries.has('theme.json')
      ? await loadV2Plugin(directory, folder)
      : await loadV1Plugin(directory, folder);
    plugins.push(loaded.plugin);
    assets.push(...loaded.assets);
    css += loaded.css;
  }
  const config = JSON.parse(await readFile(new URL('config.json', root), 'utf8'));
  const campaigns = config.campaigns || [];
  validateCampaigns(campaigns, plugins);
  const editions = validateEditions(config.editions, plugins);
  return { data: { version: 2, plugins, campaigns, editions }, assets, css };
}
