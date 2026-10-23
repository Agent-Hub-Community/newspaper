import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [mode, date, variant] = process.argv.slice(2);
const dRound = mode === 'render-d' || /^d[1-3]$/.test(variant || '');
const out = path.join(root, dRound ? 'scratch/d-refinement-trial' : 'scratch/autonomous-trial');

if (mode === 'run') {
  if (!['2026-09-21', '2026-09-23'].includes(date) || !/^(?:[a-d]|d[1-3])$/.test(variant || '')) {
    throw new Error('Usage: run 2026-09-{21,23} {a,b,c,d,d1,d2,d3}');
  }
  const dir = path.join(out, date);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const common = await readFile(path.join(root, 'prompts/trials/autonomous/common.md'), 'utf8');
  const direction = await readFile(path.join(root, `prompts/trials/autonomous/${variant}.md`), 'utf8');
  const baseline = dRound
    ? await readFile(path.join(root, 'prompts/trials/autonomous/d.md'), 'utf8') : '';
  const prompt = path.join(dir, `${variant}.prompt.md`);
  const output = path.join(dir, `${variant}.json`);
  await writeFile(prompt, dRound ? `${common}\n\n${baseline}\n\n${direction}` : `${common}\n\n${direction}`, { mode: 0o600, flag: 'wx' });
  const result = spawnSync(process.execPath, [
    path.join(root, 'scripts/generate-daily-gemini.mjs'),
    path.join(root, `scratch/prompt-trial/${date}/group-1.input.json`), output, prompt,
  ], { stdio: 'inherit', timeout: 320000 });
  await writeFile(`${output}.status.json`, JSON.stringify({
    date, variant, exitCode: result.status, error: result.error?.message || null,
    editorialChanges: false, factualReview: 'not-performed',
  }, null, 2), { mode: 0o600 });
  process.exitCode = result.status ?? 1;
} else if (mode === 'render' || mode === 'render-d') {
  const labels = dRound
    ? { d: '原版 D（复用上一轮原稿）', d1: '信息密度', d2: '技术理由', d3: '短标题与短段落' }
    : { a: '最少干预', b: '资讯编辑', c: '技术同行', d: '阅读吸引力' };
  let text = dRound ? '# Gemini D 系列 · 原稿对照\n\n' : '# Gemini 自主选题 · 四组对照\n\n';
  text += dRound
    ? '同一天的四组使用完全相同的完整本地聊天输入。Gemini 3.8 Flash 自己选题、排序和写作；以下标题和正文直接提取模型响应，未经 Codex 改写或删选。Codex 的比较与来源抽查另见《本轮结论》，不构成全部内容的事实核验。每组目标六条，实际数量如实显示。\n\n'
    : '同一天的四组使用完全相同的完整本地聊天输入。Gemini 3.8 Flash 自己选题、排序和写作；以下标题和正文直接提取模型响应，未经 Codex 改写、删选或事实复核。只加了目录与段落排版。每组目标六条，实际数量如实显示。\n\n';
  text += '这是一组 prompt 对照，每个日期/版本只采样一次，不是质量排名。9 月 23 日材料截至北京时间 21:13。仅本地预览，未发布。\n\n';
  const results = [];
  for (const day of (await readdir(out)).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort()) {
    text += `## ${day}\n\n`;
    for (const key of Object.keys(labels)) {
      const dir = dRound && key === 'd' ? path.join(root, 'scratch/autonomous-trial', day) : path.join(out, day);
      const output = path.join(dir, `${key}.json`);
      const response = JSON.parse(await readFile(`${output}.response.json`, 'utf8'));
      const status = JSON.parse(await readFile(`${output}.status.json`, 'utf8'));
      const content = response.choices?.[0]?.message?.content || '';
      let draft;
      try {
        draft = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      } catch {
        draft = null;
      }
      text += `### ${key.toUpperCase()} · ${labels[key]}\n\n`;
      text += `模型输出 ${draft?.stories?.length ?? '未知'} 条；结构校验${status.exitCode === 0 ? '通过' : '未通过'}，${dRound ? '未做完整事实核验' : '均未做事实复核'}。\n\n`;
      text += `[完整原始响应](<${output}.response.json>) · [实际提示词](<${path.join(dir, `${key}.prompt.md`)}>)\n\n`;
      if (draft && Array.isArray(draft.stories)) {
        text += `${draft.heading}\n\n${draft.theme}\n\n`;
        for (const [i, story] of draft.stories.entries()) {
          text += `#### ${i + 1}. ${story.title}\n\n${story.text}\n\n`;
        }
      } else {
        text += `原始输出无法解析，未修复：\n\n${content}\n\n`;
      }
      results.push({ ...status, model: response.model, count: draft?.stories?.length ?? null });
    }
  }
  await writeFile(path.join(out, dRound ? 'D系列原稿对照.md' : '四组原稿对照.md'), text, { mode: 0o600 });
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(results, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(results, null, 2));
} else {
  throw new Error('Usage: run DATE VARIANT | render | render-d');
}
