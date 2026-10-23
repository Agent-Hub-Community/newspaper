import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readerPage, validateDraft } from '../daily-generation.mjs';
import { applyComments } from '../story-comments.mjs';
import { isGroupId, pageGroups } from '../groups.mjs';

// Drafts and packages a batch whose DIRECTORY/<date>/group-N.input.json files were written by the chat collector,
// which lives in the separate private pipeline (collect-batch.mjs FROM THROUGH DIRECTORY).
const root = fileURLToPath(new URL('../', import.meta.url));
const [mode, from, through, directory] = process.argv.slice(2);
if (!['generate', 'package'].includes(mode) || !directory ||
    ![from, through].every(date => /^\d{4}-\d{2}-\d{2}$/.test(date))) {
  throw new Error('Usage: prepare-week-d.mjs generate|package FROM THROUGH DIRECTORY');
}
const dates = [];
for (let day = Date.parse(`${from}T00:00:00Z`); day <= Date.parse(`${through}T00:00:00Z`); day += 86400000) {
  dates.push(new Date(day).toISOString().slice(0, 10));
}
if (!dates.length || dates.length > 31) throw new Error('Expected at most 31 dates');
const out = path.resolve(directory);
await mkdir(out, { recursive: true, mode: 0o700 });
const emphasisMode = process.argv.includes('--emphasis');
const part = name => readFile(path.join(root, 'prompts', name), 'utf8');
const prompt = [await part('daily-group.md'), ...(emphasisMode ? [await part('daily-emphasis.md')] : [])].join('\n\n');
await writeFile(path.join(out, 'prompt.md'), prompt, { mode: 0o600 });
function run(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], {
      cwd: root, stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${script}: exit ${code}`)));
  });
}
async function collectedGroups(date) {
  const files = await readdir(path.join(out, date));
  const ids = files.filter(file => isGroupId(file.replace('.input.json', '')) && file.endsWith('.input.json'))
    .map(file => file.replace('.input.json', '')).sort();
  if (!ids.length) throw new Error(`No collected groups for ${date}`);
  return ids;
}
if (mode === 'generate') {
  const jobs = (await Promise.all(dates.map(async date =>
    (await collectedGroups(date)).map(id => ({ date, id }))))).flat();
  const failures = [];
  await Promise.all([0, 1, 2].map(async () => {
    while (jobs.length) {
      const { date, id } = jobs.shift();
      const dir = path.join(out, date);
      const file = path.join(dir, `${id}.input.json`);
      const input = JSON.parse(await readFile(file, 'utf8'));
      const output = path.join(dir, `${id}.draft.json`);
      if (process.argv.includes('--resume')) {
        try {
          const prior = JSON.parse(await readFile(output, 'utf8'));
          validateDraft(prior, input, { requireEmphasis: emphasisMode });
          console.log(`Reused ${date}/${id}`);
          continue;
        } catch (error) {
          if (error.code !== 'ENOENT') console.warn(`Regenerating ${date}/${id}: ${error.message}`);
        }
      }
      if (!input.coverage.count) {
        await writeFile(output, JSON.stringify({
          heading: '本日暂无可读记录', theme: '本地档案未覆盖，不生成摘要', stories: [],
          audit: { omitted: [], uncertainties: ['no_local_records'] },
        }, null, 2), { mode: 0o600 });
        continue;
      }
      const args = [file, output, path.join(out, 'prompt.md'), ...(emphasisMode ? ['--require-emphasis'] : [])];
      // A failed draft first gets an emphasis-only repair; the script refuses any other failure before
      // calling the model. If that fails, the draft is regenerated once and a second failure is reported.
      try {
        await run('generate-daily-gemini.mjs', args);
      } catch {
        try { await run('generate-daily-gemini.mjs', [...args, '--repair-emphasis']); }
        catch {
          try { await run('generate-daily-gemini.mjs', args); }
          catch (error) { failures.push({ date, id, error: error.message }); }
        }
      }
    }
  }));
  await writeFile(path.join(out, 'failures.json'), JSON.stringify(failures, null, 2), { mode: 0o600 });
  if (failures.length) throw new Error(`${failures.length} generations failed; see failures.json`);
} else {
  const issues = [], manifest = [];
  for (const date of dates) {
    const pages = [];
    // Groups without a reader section are still collected and drafted, but stay out of the edition.
    const sectioned = new Set(pageGroups(date).map(group => group.id));
    for (const id of (await collectedGroups(date)).filter(id => sectioned.has(id))) {
      const input = JSON.parse(await readFile(path.join(out, date, `${id}.input.json`), 'utf8'));
      const draft = JSON.parse(await readFile(path.join(out, date, `${id}.draft.json`), 'utf8'));
      const page = readerPage(draft, input);
      const runInfo = input.coverage.count
        ? JSON.parse(await readFile(path.join(out, date, `${id}.draft.json.run.json`), 'utf8')) : null;
      const time = new Date(input.cutoff).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }).slice(0, 5);
      page.note = `${date} · ${input.coverage.completeDay ? '当日本地记录' : `截至北京时间 ${time}`}`;
      if (!input.coverage.count) page.note += ' · 无本地可读记录';
      pages.push(page);
      manifest.push({ date, group: id, records: input.coverage.count, stories: page.stories.length,
        cutoff: input.cutoff, model: runInfo?.model ?? null, effort: runInfo?.effort ?? null,
        emphasisSource: emphasisMode && input.coverage.count ? 'same-generation' : null,
        factualReview: 'pending', editorialChanges: false });
    }
    issues.push({ id: date, date, label: `${date} 日报`, pages });
  }
  await writeFile(path.join(out, 'issues.json'), JSON.stringify(issues, null, 2), { mode: 0o600 });
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  const text = issues.map(issue => `## ${issue.date}\n\n` + issue.pages.map(page =>
    `### ${page.label} · ${page.heading}\n\n${page.theme}\n\n${page.note}\n\n` +
    page.stories.map((story, i) => `#### ${i + 1}. ${story.title}\n\n${story.text}\n`).join('\n')).join('\n')).join('\n');
  const models = [...new Set(manifest.map(entry => entry.model).filter(Boolean))];
  const generationNote = models.length
    ? `正文为 ${models.join('、')} ${emphasisMode ? 'D1 + 同步加粗' : 'D1'} 产物`
    : '本批次无本地可读记录，未调用模型';
  await writeFile(path.join(out, '一周原稿.md'), `# AgentHub 一周原稿\n\n${from} 至 ${through}，按已采集群聊分别选编。${generationNote}，未逐条事实核验，仅本地预览。\n\n${text}`, { mode: 0o600 });
  const optional = async name => readFile(path.join(out, name), 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const headlines = await optional('headlines.json');
  if (headlines) {
    const expected = new Set(issues.flatMap(issue => issue.pages.map(page => `${issue.date}/${page.id}`)));
    if (headlines.length !== expected.size) throw new Error('Headline coverage mismatch');
    for (const entry of headlines) {
      if (!expected.delete(entry.id)) throw new Error('Unknown or duplicate headline');
      const [date, id] = entry.id.split('/');
      const page = issues.find(issue => issue.date === date).pages.find(page => page.id === id);
      page.heading = entry.heading;
      page.theme = entry.theme;
    }
  }
  const comments = await optional('comments.json');
  if (comments) applyComments(issues, comments);
  await writeFile(path.join(out, 'issues.json'), JSON.stringify(issues, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(manifest));
}
