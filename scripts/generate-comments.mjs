import { readFile, writeFile } from 'node:fs/promises';
import { commentStories, validateComments } from '../story-comments.mjs';
import { llmModel, llmUrl, llmHeaders } from '../llm.mjs';

const [file, output, promptFile, reviewFile] = process.argv.slice(2);
if (!file || !output) throw new Error('Usage: generate-comments.mjs ISSUES_JSON OUTPUT_JSON [PROMPT_FILE] [REVIEW_FILE]');
const stories = commentStories(JSON.parse(await readFile(file, 'utf8')));
const prompt = await readFile(promptFile || new URL('../prompts/daily-comment.md', import.meta.url), 'utf8');
// The model sees 1-based numbers instead of 32-character feedback ids, which it sometimes miscopies;
// ids cited in review notes are translated the same way and replies are mapped back below.
const numbered = stories.map((story, index) => ({ ...story, id: String(index + 1) }));
const review = reviewFile ? stories.reduce((text, story, index) => text.replaceAll(story.id, String(index + 1)),
  await readFile(reviewFile, 'utf8')) : null;
const model = llmModel;
const started = Date.now();
const response = await fetch(llmUrl, {
  method: 'POST',
  headers: llmHeaders(),
  body: JSON.stringify({ model, messages: [
    { role: 'system', content: prompt },
    { role: 'user', content: JSON.stringify(numbered) },
    ...(review ? [{ role: 'user', content: `编辑复核意见，请据此修订评论：\n${review}` }] : []),
  ], max_tokens: 12000, stream: false }),
  signal: AbortSignal.timeout(300000),
});
if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
const result = await response.json();
await writeFile(`${output}.response.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
const choice = result.choices?.[0];
if (result.model !== model || choice?.finish_reason !== 'stop' || !choice.message?.content?.trim()) {
  throw new Error('Unexpected model or incomplete response');
}
const originalIds = new Map(stories.map((story, index) => [String(index + 1), story.id]));
const returned = JSON.parse(choice.message.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
const entries = validateComments(Array.isArray(returned)
  ? returned.map(entry => ({ ...entry, id: originalIds.get(String(entry?.id)) ?? entry?.id }))
  : returned, stories);
await writeFile(output, JSON.stringify(entries, null, 2), { mode: 0o600 });
const run = { model, elapsedMs: Date.now() - started, usage: result.usage,
  comments: entries.length, review: 'pending' };
await writeFile(`${output}.run.json`, JSON.stringify(run, null, 2), { mode: 0o600 });
console.log(JSON.stringify(run));
