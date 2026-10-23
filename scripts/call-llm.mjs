// Sends one prompt file to the shared model and saves the raw response next to the output.
// Batch-specific steps (weekly chunks, revisions) call this instead of copying scripts that fix a model.
import { readFile, writeFile, rm } from 'node:fs/promises';
import { llmModel, llmFetch, llmMaxOutputTokens } from '../lib/llm.mjs';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args.splice(index, 2)[1] : undefined;
};
const system = option('--system');
const effort = option('--reasoning');
const maxTokens = Number(option('--max-tokens') || 16000);
const [promptFile, output] = args;
if (!promptFile || !output || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > llmMaxOutputTokens) {
  throw new Error('Usage: call-llm.mjs PROMPT_FILE OUTPUT [--system FILE] [--reasoning low|medium|high] [--max-tokens N<=32768]');
}
// A failed call must not leave an earlier answer that looks like this run's result.
await rm(output, { force: true });
await rm(`${output}.response.json`, { force: true });
const started = Date.now();
const response = await llmFetch({
  body: JSON.stringify({
    model: llmModel, ...(effort ? { reasoning_effort: effort } : {}), max_tokens: maxTokens, stream: false,
    messages: [...(system ? [{ role: 'system', content: await readFile(system, 'utf8') }] : []),
      { role: 'user', content: await readFile(promptFile, 'utf8') }],
  }),
  signal: AbortSignal.timeout(900000),
});
const result = await response.json().catch(() => null);
await writeFile(`${output}.response.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
const choice = result?.choices?.[0];
if (!response.ok || result.model !== llmModel || choice?.finish_reason !== 'stop' || !choice.message?.content?.trim()) {
  throw new Error(JSON.stringify({ http: response.status, model: result?.model, finish: choice?.finish_reason, error: result?.error }));
}
await writeFile(output, `${choice.message.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')}\n`, { mode: 0o600 });
console.log(JSON.stringify({ output, model: result.model, elapsedMs: Date.now() - started, usage: result.usage }));
