import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, cp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import {
  contrastRatio,
  loadThemes,
  resolveThemeRelated,
  validateEditions,
  validateScopedCss,
  validateSvgSafety,
} from '../lib/themes.mjs';

const loaded = await loadThemes();
const runtime = await readFile(new URL('../site/skins.js', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');

test('riemann-proof v2 theme pack loads declaratively with compiled light/dark CSS and home sync metadata', () => {
  const plugin = loaded.data.plugins.find(p => p.id === 'riemann-proof');
  assert.ok(plugin, 'riemann-proof theme exists');
  assert.equal(plugin.version, 2);
  assert.equal(plugin.kind, 'knowledge');
  assert.equal(plugin.image, 'skins/riemann-proof/doodle.svg');
  assert.equal(plugin.artStyle, 'vector');
  assert.equal(plugin.seal?.text, 'ζ(½+it)=0');
  assert.ok(plugin.story?.facts?.length >= 4);
  assert.ok(plugin.knowledge?.banner?.text);
  assert.ok(plugin.knowledge?.highlight?.keywords?.includes('黎曼'));
  assert.ok(plugin.home?.asciiHands?.glyphBands?.length >= 4);
  assert.ok(loaded.assets.some(a => a.file === 'skins/riemann-proof/doodle.svg'));
  assert.match(loaded.css, /body\[data-skin="riemann-proof"\]/);
  assert.match(loaded.css, /:root\[data-color-scheme="dark"\][\s\S]*body\[data-skin="riemann-proof"\]/);
});

test('v2 validator enforces WCAG AA contrast, SVG safety, scoped CSS and edition bindings', async () => {
  assert.ok(contrastRatio('#f5f7fc', '#0f1b35') > 14);
  assert.ok(contrastRatio('#999999', '#aaaaaa') < 2);

  assert.throws(() => validateSvgSafety('<svg><script>alert(1)</script></svg>'), /script/i);
  assert.throws(() => validateSvgSafety('<svg onload="x()"></svg>'), /event handlers/i);
  assert.throws(() => validateSvgSafety('<svg><image href="https://evil.test/x.png"/></svg>'), /external/i);
  assert.throws(() => validateScopedCss('.masthead { color: red; }', 'demo'), /scope selectors/i);
  assert.throws(() => validateEditions({ '2026-11-20': 'unknown' }, loaded.data.plugins), /Unknown skin/);
  assert.throws(() => validateEditions({ 'bad-date': 'riemann-proof' }, loaded.data.plugins), /Invalid edition/);

  const root = await mkdtemp(path.join(tmpdir(), 'agenthub-theme-v2-'));
  try {
    await cp(new URL('../site/skins/', import.meta.url), root, { recursive: true });
    const badDir = path.join(root, 'low-contrast');
    await mkdir(badDir, { recursive: true });
    const good = JSON.parse(await readFile(new URL('../site/skins/riemann-proof/theme.json', import.meta.url), 'utf8'));
    const bad = {
      ...good,
      id: 'low-contrast',
      masthead: { ...good.masthead, art: undefined },
      palette: {
        ...good.palette,
        light: { ...good.palette.light, bandInk: '#1b2640', bandBg: '#0f1b35' },
      },
    };
    await writeFile(path.join(badDir, 'theme.json'), JSON.stringify(bad));
    await assert.rejects(loadThemes(pathToFileURL(root + path.sep)), /contrast/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('selection priority honors ?theme= preview > live campaign > edition archive binding', () => {
  const context = { window: {}, document: { querySelector: () => null } };
  vm.runInNewContext(runtime, context);
  const select = (preview, iso, ctx = {}) =>
    context.window.AgentHubSkins.selectSkin(loaded.data, preview, Date.parse(iso), ctx)?.id || null;

  // Outside any campaign, edition binding activates only on that edition's date
  assert.equal(select(null, '2026-12-10T12:00:00+08:00', { editionDate: '2026-11-20', pageKind: 'daily' }), 'riemann-proof');
  assert.equal(select(null, '2026-12-10T12:00:00+08:00', { editionDate: '2026-11-18', pageKind: 'daily' }), null);
  // Active campaign beats edition binding
  assert.equal(select(null, '2026-10-02T12:00:00+08:00', { editionDate: '2026-11-20', pageKind: 'daily' }), 'national-day');
  // Explicit preview beats everything, including default override
  assert.equal(select('riemann-proof', '2026-10-02T12:00:00+08:00', { pageKind: 'daily' }), 'riemann-proof');
  assert.equal(select('default', '2026-11-22T12:00:00+08:00', { editionDate: '2026-11-20', pageKind: 'daily' }), null);
});

test('runtime renders v2 doodle, seal, knowledge banner, story dialog and keyword badges across SPA and static pages', () => {
  const { document } = parseHTML(indexHtml);
  document.querySelector('#reading').innerHTML =
    '<article class="brief"><div class="brief-category"><span>01</span>数学</div><h2>黎曼猜想与 Lean 形式化验证讨论</h2><p>测试内容</p></article>' +
    '<article class="brief"><div class="brief-category"><span>02</span>工具</div><h2>普通前端构建优化</h2><p>无关内容</p></article>';
  const window = {
    AGENT_HUB_DATA: { skins: loaded.data },
    AgentHubRoutes: { asset: file => `/newspaper/${file}` },
    addEventListener() {},
  };
  vm.runInNewContext(runtime, {
    document,
    window,
    location: { search: '?theme=riemann-proof', pathname: '/newspaper/daily/2026-10-07/overview/', hash: '' },
    URLSearchParams,
    clearTimeout,
    setTimeout() { return 1; },
  });

  assert.equal(document.body.dataset.skin, 'riemann-proof');
  assert.equal(document.querySelector('.masthead').dataset.themeVersion, '2');
  assert.equal(document.querySelector('.masthead-brand').dataset.ambient, 'critical-line');
  assert.equal(document.querySelector('.skin-art').dataset.artStyle, 'vector');
  assert.equal(document.querySelector('.skin-art').getAttribute('src'), '/newspaper/skins/riemann-proof/doodle.svg');
  assert.equal(document.querySelector('.skin-seal').hidden, false);
  assert.equal(document.querySelector('.skin-story-trigger').hidden, false);

  const banner = document.getElementById('theme-knowledge-banner');
  assert.ok(banner && banner.hidden === false, 'knowledge banner rendered on overview');
  assert.match(banner.textContent, /数论 × AI 里程碑/);

  // Switching to a single group page hides the overview-only banner while keeping masthead and badges.
  window.AgentHubSkins.sync({ pageKind: 'daily', pageId: 'group-1' });
  assert.equal(document.getElementById('theme-knowledge-banner').hidden, true, 'banner hidden on single-group page');
  window.AgentHubSkins.sync({ pageKind: 'daily', pageId: 'overview' });
  assert.equal(document.getElementById('theme-knowledge-banner').hidden, false, 'banner restored on overview');

  const badges = document.querySelectorAll('.theme-story-badge');
  assert.equal(badges.length, 1, 'only matching story gets keyword badge');
  assert.equal(badges[0].textContent, '黎曼 / 形式化专题');

  window.AgentHubSkins.openStory();
  const dialog = document.getElementById('theme-story-dialog');
  assert.ok(dialog, 'story dialog created');
  assert.match(dialog.textContent, /175,187/);
  assert.match(dialog.textContent, /Re\(s\) = 1\/2/);
});

test('resolveThemeRelated auto-curates cross-group discussions and respects Latin word boundaries', () => {
  const sample = structuredClone(loaded.data);
  const fakeEditions = [
    {
      date: '2026-11-20',
      pages: [
        { id: 'group-2', label: '二群', stories: [{ title: '黎曼猜想 Lean 证明刷屏群聊', text: '当天群友第一时间复现编译校验。' }] },
      ],
    },
    {
      date: '2026-11-18',
      pages: [
        { id: 'group-8', label: 'AI4S', stories: [{ title: 'MathRSI 与 Lean 形式化新进展', text: '讨论了数学证明和形式化验证。' }] },
        { id: 'group-5', label: '五群', stories: [{ title: 'Clean GPU cluster scheduling', text: 'A clean kernel run without math.' }] },
      ],
    },
    {
      date: '2026-11-10',
      pages: [
        { id: 'group-3', label: '三群', stories: [{ title: '30 小时完成费马大定理形式化', text: '讨论了 Lean 形式化证明。' }] },
        { id: 'group-1', label: '一群', stories: [{ title: '形式化验证博客引发争议', text: 'Lean 形式化定义偏差。' }] },
      ],
    },
  ];
  resolveThemeRelated(sample, fakeEditions);
  const plugin = sample.plugins.find(p => p.id === 'riemann-proof');
  const items = plugin.knowledge.relatedItems;
  assert.equal(items.length, 4, 'matches 4 distinct groups and excludes "clean" false positive');
  assert.equal(items[0].date, '2026-11-20', 'same-day / campaign-window discussion leads first');
  assert.equal(items[0].current, true, 'same-day discussion is flagged as current');
  assert.ok(items.every(item => !item.title.includes('Clean')));
  assert.deepEqual(new Set(items.map(i => i.groupId)).size, 4, 'diversifies across groups');
  assert.equal(items[0].href.startsWith('daily/'), true);
});
