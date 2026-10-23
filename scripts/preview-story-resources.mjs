import { mkdir, writeFile } from 'node:fs/promises';
import { digests } from '../lib/digest.mjs';

const issues = structuredClone(digests);
function attach(date, group, title, resources) {
  const story = issues.find(i => i.date === date)?.pages.find(p => p.id === group)?.stories.find(s => s.title === title);
  if (!story) throw new Error(`Story not found: ${date}/${group}/${title}`);
  story.resources = resources;
}
attach('2026-09-18', 'group-1', 'System 1 模型走红背后：靠结构化 Schema 与训练内化压缩 CoT', [
  { kind: 'article', label: '官方介绍 · System One Models & Jev', url: 'https://typesafe.ai/blog/introducing-system-one-models-and-jev' },
]);
attach('2026-09-21', 'group-1', '监控自主智能体的硬瓶颈：无法扩展的人类验证带宽', [
  { kind: 'paper', label: '论文 · Some Simple Economics of AGI', url: 'https://arxiv.org/abs/2602.20946' },
]);
attach('2026-09-23', 'group-1', 'Opus 5.5 一句话生成 3D 游戏：真实泛化还是预训练背诵？', [
  { kind: 'demo', label: '试玩 · CF 运输船', url: 'https://claude-opus-5-5-cf-transport-ship.pages.dev/' },
]);
attach('2026-09-23', 'group-1', 'HALO 的架构与评测引发争议', [
  { kind: 'discussion', label: '原始讨论 · HALO Issue #44', url: 'https://github.com/whitecircle/halo/issues/44' },
]);
attach('2026-09-23', 'group-3', 'Dsec 设计引发兴趣，群友交流模型融合资料', [
  { kind: 'paper', label: '论文 · DSec 智能体训练沙盒', url: 'https://arxiv.org/abs/2609.22978' },
]);
const out = new URL('../scratch/resource-links-preview/', import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(new URL('issues.json', out), JSON.stringify(issues, null, 2) + '\n');
console.log('Prepared five optional resource entries. Release editions are unchanged.');
