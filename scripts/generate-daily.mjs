import { readFile, writeFile } from 'node:fs/promises';
import { sanitizeInput, validateDraft } from '../lib/daily-generation.mjs';

const [file, output] = process.argv.slice(2);
if (!file || !output) throw new Error('Usage: node scripts/generate-daily.mjs INPUT OUTPUT');
const input = sanitizeInput(JSON.parse(await readFile(file, 'utf8')));
const instructions = `${await readFile(new URL('../prompts/daily-editor.md', import.meta.url), 'utf8')}\n\n${await readFile(new URL('../prompts/daily-reader-copy.md', import.meta.url), 'utf8')}`;
const base = process.env.DAILY_LLM_BASE_URL || 'http://127.0.0.1:8549/v1';
const model = process.env.DAILY_LLM_MODEL || 'gpt-6-astra';
const started = Date.now();
const response = await fetch(`${base.replace(/\/$/, '')}/responses`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json',
    ...(process.env.COPROXY_API_KEY ? { Authorization: `Bearer ${process.env.COPROXY_API_KEY}` } : {}) },
  body: JSON.stringify({
    model, instructions, input: JSON.stringify(input), max_output_tokens: 14000,
    reasoning: { effort: 'high' }, store: false,
  }),
  signal: AbortSignal.timeout(300000),
});
if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);
const result = await response.json();
await writeFile(`${output}.response.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
if (result.status !== 'completed') throw new Error(`Incomplete generation: ${result.status}`);
const text = result.output?.filter(o => o.type === 'message').flatMap(o => o.content || [])
  .filter(c => c.type === 'output_text').map(c => c.text).join('') || result.output_text;
const draft = validateDraft(JSON.parse(text), input);
await writeFile(output, JSON.stringify(draft, null, 2), { mode: 0o600 });
const run = {
  route: 'single-llm-call', model: result.model || model, elapsedMs: Date.now() - started,
  usage: result.usage,
  stories: draft.stories.length, tools: [], factualReview: 'pending',
};
await writeFile(`${output}.run.json`, JSON.stringify(run, null, 2), { mode: 0o600 });
console.log(JSON.stringify(run));
