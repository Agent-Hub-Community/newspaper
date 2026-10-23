import { readFile, writeFile, rm } from 'node:fs/promises';
import { validateSelection, validateExternalDraft } from '../external-workflow.mjs';
import { validateEmphasis } from '../emphasis.mjs';
import { llmModel, llmUrl, llmHeaders, llmMaxOutputTokens } from '../llm.mjs';

const [inputFile, output, reviewFile] = process.argv.slice(2);
if (!inputFile || !output) throw new Error('Usage: node scripts/generate-external.mjs SELECTION_JSON OUTPUT_JSON [REVIEW_MD]');
const selection = validateSelection(JSON.parse(await readFile(inputFile, 'utf8')));
const prompt = await readFile(new URL('../prompts/external-editor.md', import.meta.url), 'utf8');
const messages = [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(selection) }];
if (reviewFile) {
  const previous = JSON.parse(await readFile(output, 'utf8'));
  await writeFile(`${output}.before-review.json`, JSON.stringify(previous, null, 2), { mode: 0o600 });
  messages.push({ role: 'assistant', content: JSON.stringify(previous) },
    { role: 'user', content: await readFile(reviewFile, 'utf8') });
}
// Do not leave a stale successful draft at the requested output on failure.
await rm(output, { force: true });
await rm(`${output}.run.json`, { force: true });
const started = Date.now();
const response = await fetch(llmUrl, {
  method: 'POST',
  headers: llmHeaders(),
  // No reasoning here: candidateIds already keep events apart, and high effort used 30k of the 32k cap
  // on 2026-10-13. The plain draft needed about 9.5k tokens, more than the old 10k limit allowed for.
  body: JSON.stringify({ model: llmModel, messages, max_tokens: llmMaxOutputTokens, stream: false }),
  signal: AbortSignal.timeout(900000),
});
if (!response.ok) throw new Error(`External generation HTTP ${response.status}`);
const result = await response.json();
await writeFile(`${output}.response.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
if (result.model !== llmModel || result.choices?.[0]?.finish_reason !== 'stop') {
  throw new Error('Incomplete or unexpected model response');
}
const draft = JSON.parse(result.choices[0].message.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
// The model sometimes paraphrases a span or overshoots the 30% budget, and asking it again fixed only half
// of such stories on 2026-10-13. Spans that fail are dropped, longest first while over budget; the raw
// response keeps the model's choice and run.json lists the stories whose emphasis the editor should redo.
const fits = (text, phrases) => {
  try { validateEmphasis(text, phrases); return true; } catch { return false; }
};
const emphasisTrimmed = [];
for (const story of Array.isArray(draft.stories) ? draft.stories : []) {
  if (!Array.isArray(story.emphasis) || fits(story.text, story.emphasis)) continue;
  let kept = story.emphasis.filter(phrase => fits(story.text, [phrase]));
  while (!fits(story.text, kept)) {
    const longest = kept.reduce((a, b) => (b.length > a.length ? b : a));
    kept = kept.filter(phrase => phrase !== longest);
  }
  story.emphasis = kept;
  emphasisTrimmed.push(story.title);
}
validateExternalDraft(draft, selection);
await writeFile(output, JSON.stringify(draft, null, 2) + '\n', { mode: 0o600 });
await writeFile(`${output}.run.json`, JSON.stringify({
  model: result.model, elapsedMs: Date.now() - started, usage: result.usage, review: 'pending',
  ...(emphasisTrimmed.length ? { emphasisTrimmed } : {}),
}, null, 2), { mode: 0o600 });
console.log(`Generated ${draft.stories.length} external stories for ${draft.date}; editorial review required.`);
