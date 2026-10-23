import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { modelInput } from '../lib/image-messages.mjs';
import { sanitizeInput, validateDraft } from '../lib/daily-generation.mjs';
import { llmModel, llmFetch, llmMaxOutputTokens } from '../lib/llm.mjs';

const [file, output, promptFile] = process.argv.slice(2);
if (!file || !output || !promptFile) throw new Error('Usage: INPUT OUTPUT PROMPT');
const input = sanitizeInput(JSON.parse(await readFile(file, 'utf8')));
const instructions = await readFile(promptFile, 'utf8');
const model = llmModel;
const started = Date.now();
await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
const messages = [
  { role: 'system', content: instructions },
  // Image descriptions replace "[图片]" only here; validation and later steps keep the members' own text.
  { role: 'user', content: JSON.stringify(sanitizeInput(modelInput(input))) },
];
const repair = process.argv.includes('--repair-emphasis');
const repairValidation = process.argv.includes('--repair-validation');
let original;
// A fresh generation drops the previous raw response first, so a failed call cannot leave
// stale content for --repair-emphasis to pass off as this run's draft.
if (!repair && !repairValidation) await rm(`${output}.response.json`, { force: true });
if (repair || repairValidation) {
  const previous = JSON.parse(await readFile(`${output}.response.json`, 'utf8'));
  const content = previous.choices[0].message.content;
  original = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  let problems = original.stories.flatMap(story => {
    try { validateDraft({ ...original, stories: [story] }, input, { requireEmphasis: true }); return []; }
    catch (error) {
      return [{ title: story.title, error: error.message,
        spans: story.emphasis?.map(phrase => ({ phrase, first: story.text.indexOf(phrase), last: story.text.lastIndexOf(phrase) })),
        maxCharacters: Math.floor(story.text.length * 0.3) }];
    }
  });
  if (repairValidation) {
    try { validateDraft(original, input, { requireEmphasis: true }); problems = []; }
    catch (error) { problems = [{ error: error.message }]; }
  }
  if (!problems.length || (!repairValidation && problems.some(problem => !/emphasis/i.test(problem.error)))) {
    throw new Error('Only emphasis validation failures can use emphasis repair');
  }
  messages.push({ role: 'assistant', content }, { role: 'user', content:
    `只修正 emphasis${repairValidation ? ' 和 resources 中的出处字段。每个 resource 必须有 evidence_ids 数组，使用输入中包含该 URL 的真实消息 id' : ''}，所有其他字段（包括正文、标题、选题、claims）必须逐字保持不变。返回完整 JSON。以下校验未通过：${JSON.stringify(problems)}。重点选择表达完整意思且只出现一次的原文片段，长文通常每个实质自然段一处，短文一到两处，不机械标注背景。不设数量或单片段字数上限；所有片段互不重叠，无首尾空白，至少两个字符，单片段不跨自然段，总长度不超过正文30%，找不到则返回 []。` });
}
const response = await llmFetch({
  // Without thinking, argon merged unrelated topics into one story; with high effort a large group
  // takes about 4–5 minutes and up to ~30k output tokens, most of them reasoning.
  body: JSON.stringify({
    model,
    messages,
    reasoning_effort: 'high',
    max_tokens: llmMaxOutputTokens,
    stream: false,
  }),
  signal: AbortSignal.timeout(900000),
});
if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
const result = await response.json();
await writeFile(`${output}${repair || repairValidation ? '.repair' : ''}.response.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
if (result.model !== model) throw new Error(`Unexpected response model: ${result.model}`);
const choice = result.choices?.[0];
if (choice?.finish_reason !== 'stop' || !choice.message?.content?.trim()) {
  throw new Error(`Incomplete Gemini output: ${choice?.finish_reason}`);
}
const text = choice.message.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
const draft = validateDraft(JSON.parse(text), input, { requireEmphasis: process.argv.includes('--require-emphasis') });
if (original) {
  const withoutEmphasis = value => ({
    ...value,
    ...(repairValidation ? { resources: (value.resources || []).map(({ evidence_ids, source_ids, ...resource }) => resource) } : {}),
    stories: value.stories.map(({ emphasis, ...story }) => story),
  });
  const { isDeepStrictEqual } = await import('node:util');
  if (!isDeepStrictEqual(withoutEmphasis(original), withoutEmphasis(draft))) throw new Error('Emphasis repair changed content');
}
await writeFile(output, JSON.stringify(draft, null, 2), { mode: 0o600 });
const run = {
  model: result.model, route: repairValidation ? 'schema-validation-repair-no-tools' : repair ? 'emphasis-validation-repair-no-tools' : 'single-chat-completion-no-tools',
  elapsedMs: Date.now() - started, usage: result.usage,
  stories: draft.stories.length, factualReview: 'pending',
};
await writeFile(`${output}.run.json`, JSON.stringify(run, null, 2), { mode: 0o600 });
console.log(JSON.stringify(run));
