import { readFile, writeFile } from 'node:fs/promises';
import { llmModel, llmUrl, llmHeaders } from '../lib/llm.mjs';
const [file, output] = process.argv.slice(2);
if (!file || !output) throw new Error('Usage: generate-headlines.mjs ISSUES OUTPUT');
const issues = JSON.parse(await readFile(file, 'utf8'));
const input = issues.flatMap(issue => issue.pages.map(page => ({
  id: `${issue.date}/${page.id}`, heading: page.heading, note: page.note,
  stories: page.stories.map(({ title, text }) => ({ title, text })),
})));
const model = llmModel;
const response = await fetch(llmUrl, {
  method: 'POST',
  headers: llmHeaders(),
  body: JSON.stringify({ model, messages: [
    { role: 'system', content: await readFile(new URL('../prompts/daily-headline.md', import.meta.url), 'utf8') },
    { role: 'user', content: JSON.stringify(input) },
  ], max_tokens: 6000, stream: false }),
  signal: AbortSignal.timeout(300000),
});
if (!response.ok) throw new Error(`Headlines HTTP ${response.status}`);
const result = await response.json();
await writeFile(`${output}.response.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
if (result.model !== model || result.choices?.[0]?.finish_reason !== 'stop') throw new Error('Incomplete response');
const entries = JSON.parse(result.choices[0].message.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
const ids = new Set(input.map(page => page.id));
if (!Array.isArray(entries) || entries.length !== ids.size) throw new Error('Headline coverage mismatch');
for (const entry of entries) {
  if (!ids.delete(entry.id) || !entry.heading?.trim() || entry.heading.length > 60 ||
      typeof entry.theme !== 'string' || /[<>\n]/.test(entry.heading + entry.theme)) throw new Error('Invalid headline');
}
await writeFile(output, JSON.stringify(entries, null, 2), { mode: 0o600 });
console.log(`Generated ${entries.length} page headlines`);
