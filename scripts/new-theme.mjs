#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const id = args.find(arg => !arg.startsWith('--'));
const flag = (name, fallback) => {
  const hit = args.find(arg => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

if (!id || !/^[a-z][a-z0-9-]*$/.test(id) || ['default', 'auto'].includes(id)) {
  console.error('Usage: npm run theme:new -- <theme-id> [--kind=holiday|milestone|knowledge|community] [--tier=1|2|3]');
  process.exit(1);
}

const kind = flag('kind', 'milestone');
const tier = Number(flag('tier', '2'));
if (!['holiday', 'milestone', 'knowledge', 'community'].includes(kind)) {
  console.error(`Invalid --kind=${kind}`);
  process.exit(1);
}
if (![1, 2, 3].includes(tier)) {
  console.error(`Invalid --tier=${tier} (expected 1, 2, or 3)`);
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'site/skins', id);
if (existsSync(dir)) {
  console.error(`Theme directory already exists: ${dir}`);
  process.exit(1);
}

const manifest = {
  $schema: '../theme.schema.json',
  version: 2,
  id,
  kind,
  name: `${id} 特别主题`,
  summary: '一句话概括这个节日、里程碑或社区专题的背景与意义。',
  targets: ['daily', 'weekly', 'library', 'glossary', 'rank', 'search', 'agents', ...(tier >= 2 ? ['home'] : [])],
  masthead: {
    eyebrow: `SPECIAL EDITION · ${id.toUpperCase()}`,
    label: '特别主题',
    message: '一句克制、有辨识度的刊头寄语（建议 16–30 字）。',
    art: {
      file: 'doodle.svg',
      alt: `${id} 主题刊头插画`,
    },
    ...(tier >= 2 ? {
      seal: { text: id.toUpperCase().slice(0, 12), caption: '特刊' },
      footerNote: '贴合本主题的一句页脚与长图定制尾注。',
      ...(tier === 3 ? {
        widget: {
          file: 'widget.js',
          title: '互动微彩蛋',
          hint: '简短说明如何与这个小彩蛋交互。',
        },
      } : {}),
      story: {
        kicker: '为什么今天有这个主题？',
        title: '用一句标题交代今日事件或节日故事',
        body: [
          '第一段（80–120 字）：交代时间、核心事件或节日背景。',
          '第二段（80–120 字）：说明它与 Agent Hub 社区讨论或研究方向的联系。',
        ],
        facts: [
          { label: '关键指标 A', value: '示例值' },
          { label: '关键指标 B', value: '示例值' },
          { label: '关键指标 C', value: '示例值' },
          { label: '关键指标 D', value: '示例值' },
        ],
        links: [
          { label: '站内搜相关讨论', href: 'search/?q=Agent' },
        ],
      },
    } : {}),
  },
  palette: {
    scope: tier === 1 ? 'masthead-only' : 'masthead-and-accent',
    light: {
      paper: '#f9f8f4',
      surface: '#f0eee6',
      ink: '#182032',
      muted: '#4e586e',
      rule: '#d4d8e2',
      accent: '#1d4d8f',
      link: '#1d4d8f',
      emphasis: '#dce7fa',
      bandBg: '#12223d',
      bandInk: '#f5f7fc',
      bandMuted: '#c4d1ea',
      bandAccent: '#f3ca6d',
      bandRule: '#3b507d',
      bannerBg: '#f1f4fa',
      bannerBorder: '#cfd8ea',
    },
    dark: {
      paper: '#090e1a',
      surface: '#11192c',
      ink: '#eef2fb',
      muted: '#a4b2cc',
      rule: '#24314c',
      accent: '#8bb8ff',
      link: '#9ac1ff',
      emphasis: '#1e3360',
      bandBg: '#101b36',
      bandInk: '#f5f7fc',
      bandMuted: '#bfd0ec',
      bandAccent: '#f5cf7a',
      bandRule: '#42598a',
      bannerBg: '#111a2e',
      bannerBorder: '#29395b',
    },
  },
  ambient: {
    preset: 'stardust',
    region: 'masthead',
  },
  ...(tier >= 2 ? {
    knowledge: {
      banner: {
        dismissible: true,
        placement: 'overview-only',
        kicker: '今日专题',
        text: '仅在日报与周报总览页展示的一句话专题导读。',
        links: [
          { label: '阅读事件速览', action: 'open-story' },
          { label: '站内搜全部相关讨论', href: 'search/?q=Agent' },
        ],
      },
      related: {
        heading: '各群历史相关讨论',
        keywords: ['Agent'],
        limit: 6,
        maxPerGroup: 2,
      },
      highlight: {
        badge: '专题讨论',
        keywords: ['Agent'],
      },
      searchExamples: ['Agent', 'RSI'],
    },
    home: {
      eyebrow: `SPECIAL EDITION · ${id.toUpperCase()}`,
      badge: '特别主题',
      summary: '在官网首页展示的一句话特刊简介。',
      href: `/newspaper/?theme=${id}`,
      accent: '#f5cf7a',
      bandBg: '#101b36',
      galaxyCore: '#fff2cc',
      galaxyArm: '#8bb8ff',
      starKeywords: ['Agent'],
      asciiHands: {
        humanColor: '#f5cf7a',
        machineColor: '#8bb8ff',
      },
    },
  } : {}),
};

const starterSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 96" width="180" height="96" fill="none" role="img" aria-label="${id} 主题插画">
  <style>
    .pulse { animation: th-pulse 3.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
    @keyframes th-pulse { 0%, 100% { opacity: 0.35; transform: scale(1); } 50% { opacity: 0.9; transform: scale(1.2); } }
    @media (prefers-reduced-motion: reduce) { .pulse { animation: none; opacity: 0.6; } }
  </style>
  <rect x="20" y="10" width="140" height="76" rx="8" stroke="#8bb8ff" stroke-opacity="0.35" stroke-dasharray="3 3"/>
  <circle class="pulse" cx="90" cy="48" r="18" stroke="#f3ca6d" stroke-width="1.5"/>
  <circle cx="90" cy="48" r="5" fill="#f3ca6d"/>
</svg>\n`;

const starterWidget = `/* Lazy-loaded Theme Pack v2 Mini-Widget (<= 24 KB, 0 idle FPS, no external network). */
(() => {
  function mount(container, { skin, reducedMotion }) {
    let clicks = 0;
    container.innerHTML =
      '<div class="rh-widget">' +
        '<div class="rh-head"><div class="rh-title"><strong>' + skin.widget.title + '</strong><span>' + skin.id + '</span></div>' +
        '<div class="rh-readout"><span data-count>点击 0 次</span></div></div>' +
        '<button type="button" class="rh-play" data-trigger>触发彩蛋</button>' +
      '</div>';
    const countEl = container.querySelector('[data-count]');
    const trigger = container.querySelector('[data-trigger]');
    const onClick = () => {
      clicks += 1;
      countEl.textContent = reducedMotion ? '静态触发 ' + clicks + ' 次' : '点击 ' + clicks + ' 次';
    };
    trigger.addEventListener('click', onClick);
    return () => {
      trigger.removeEventListener('click', onClick);
      container.innerHTML = '';
    };
  }
  (window.AgentHubThemeWidgets = window.AgentHubThemeWidgets || {})[${JSON.stringify(id)}] = { mount };
})();\n`;

await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'theme.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(dir, 'doodle.svg'), starterSvg);
if (tier === 3) await writeFile(path.join(dir, 'widget.js'), starterWidget);

console.log(`Created Tier ${tier} theme pack at site/skins/${id}/`);
console.log(`Next steps:`);
console.log(`  1. Customize site/skins/${id}/theme.json and doodle.svg`);
console.log(`  2. Run: npm run theme:check -- ${id}`);
console.log(`  3. Build & preview: npm run build -> ?theme=${id}`);
