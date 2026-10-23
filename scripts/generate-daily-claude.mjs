import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { sanitizeInput, validateDraft } from '../lib/daily-generation.mjs';

const [file, output, promptFile] = process.argv.slice(2);
if (!file || !output || !promptFile) throw new Error('Usage: INPUT OUTPUT PROMPT');
const input = sanitizeInput(JSON.parse(await readFile(file, 'utf8')));
const instructions = await readFile(promptFile, 'utf8');
await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
const model = 'claude-opus-5-5', effort = process.env.DAILY_CLAUDE_EFFORT || 'low', start = Date.now();
const child = spawn('claude', [
  '-p', '--model', model, '--effort', effort, '--safe-mode', '--strict-mcp-config',
  '--tools', '', '--disable-slash-commands', '--no-session-persistence',
  '--output-format', 'json', '--system-prompt', instructions,
], { cwd: '/tmp', stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', data => { stdout += data; });
child.stderr.on('data', data => { stderr += data; });
const timeout = setTimeout(() => child.kill('SIGTERM'), 360000);
let code;
try {
  code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
    child.stdin.end(JSON.stringify(input));
  });
} finally { clearTimeout(timeout); }
if (code !== 0) throw new Error(`Claude exited ${code}: ${stderr.slice(-500)}`);
const result = JSON.parse(stdout);
await writeFile(`${output}.response.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
if (result.is_error || result.subtype !== 'success') throw new Error('Claude generation failed');
if (!result.modelUsage?.[model]) throw new Error('Requested model not present in response metadata');
const text = result.result.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
const draft = validateDraft(JSON.parse(text), input, { requireEmphasis: process.argv.includes('--require-emphasis') });
await writeFile(output, JSON.stringify(draft, null, 2), { mode: 0o600 });
const run = {
  model, effort, route: 'claude-code-no-tools', elapsedMs: Date.now() - start,
  usage: result.usage, modelUsage: result.modelUsage,
  stories: draft.stories.length, factualReview: 'pending',
};
await writeFile(`${output}.run.json`, JSON.stringify(run, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ model, effort, stories: draft.stories.length, elapsedMs: run.elapsedMs, output }));
