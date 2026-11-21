// Runs the approved-release chain in one command: import reviewed batches into data/, public build, and
// optional semantic vector embedding. Voting/D1 feedback catalog registration has been removed; GitHub Actions
// runs the final public build with vectors and full verification on push.
//
//   node scripts/release.mjs --daily-batch scratch/day-2026-10-25-run1 \
//     --external-draft scratch/external-2026-10-25-run1/reviewed-final.json \
//     --external-selection scratch/external-2026-10-25-run1/selection.json \
//     [--weekly-reader DIR] [--skip-embed] [--dry-run]
import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const USAGE = 'Usage: node scripts/release.mjs [--daily-batch DIR] [--external-draft FILE [--external-selection FILE]] '
  + '[--weekly-reader DIR] [--skip-build] [--skip-embed] [--dry-run]';

export function parseReleaseArgs(argv) {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    'daily-batch': { type: 'string' }, 'external-draft': { type: 'string' }, 'external-selection': { type: 'string' },
    'weekly-reader': { type: 'string' }, 'sql-out': { type: 'string' },
    'skip-d1': { type: 'boolean', default: false }, 'skip-embed': { type: 'boolean', default: false },
    'skip-build': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  } });
  return {
    dailyBatch: values['daily-batch'], externalDraft: values['external-draft'],
    externalSelection: values['external-selection'], weeklyReader: values['weekly-reader'],
    sqlOut: values['sql-out'], skipD1: values['skip-d1'], skipEmbed: values['skip-embed'],
    skipBuild: values['skip-build'],
    dryRun: values['dry-run'],
  };
}

// Builds the ordered step list; throws before anything runs when options or environment are incomplete.
export function buildReleasePlan(options, env = {}) {
  const { dailyBatch, externalDraft, externalSelection, weeklyReader, skipD1, skipEmbed, skipBuild } = options;
  if (externalSelection && !externalDraft) throw new Error('--external-selection needs --external-draft');
  const shouldEmbed = !skipEmbed && Boolean(env.CLOUDFLARE_ACCOUNT_ID);
  const shouldRegisterStories = !skipBuild && !skipD1 && Boolean(env.WRANGLER_BIN);
  const required = skipBuild ? [] : ['FEEDBACK_API_URL'];
  const missing = required.filter(name => !env[name]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  const sqlOut = options.sqlOut || path.join(dailyBatch || 'scratch', 'feedback-catalog.sql');
  const build = { name: 'public build', argv: ['npm', 'run', 'build', '--', '--public'] };
  const steps = [];
  if (dailyBatch) steps.push({ name: 'import daily batch', argv: ['node', 'scripts/publish-reviewed-batch.mjs', dailyBatch] });
  if (externalDraft) steps.push({ name: 'import external report',
    argv: ['node', 'scripts/import-external-report.mjs', externalDraft, ...(externalSelection ? [externalSelection] : [])] });
  if (weeklyReader) steps.push({ name: 'import weekly', argv: ['node', 'scripts/import-reviewed-weekly.mjs', weeklyReader] });
  if (!skipBuild) steps.push(build);
  if (shouldEmbed) steps.push({ name: 'embed catalog', argv: ['node', 'scripts/embed-catalog.mjs'] });
  // Keep registering story IDs in D1 so POST /opens (per-topic discussion open telemetry) continues to record new stories.
  if (shouldRegisterStories) {
    steps.push(
      { name: 'story catalog SQL', argv: ['node', 'scripts/feedback-catalog.mjs', 'dist/data.js', sqlOut], outputDir: path.dirname(sqlOut) },
      { name: 'check SQL', checkSql: sqlOut },
      { name: 'register D1 story IDs', argv: [env.WRANGLER_BIN, 'd1', 'execute', 'agenthub-feedback',
        '--remote', '--config', 'feedback/wrangler.jsonc', '--file', sqlOut] },
    );
  }
  return steps;
}

function isExecutableFile(file) {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

// Returns the absolute path of WRANGLER_BIN. A value with a path separator is resolved against `cwd` (the caller's
// directory, before main() moves to the repository root); a bare name is looked up in PATH, as a shell would.
export function resolveExecutable(value, { cwd = process.cwd(), pathEnv = process.env.PATH } = {}) {
  if (value.includes('/') || value.includes(path.sep)) {
    const file = path.resolve(cwd, value);
    if (!isExecutableFile(file)) throw new Error(`WRANGLER_BIN is not an executable file: ${file}`);
    return file;
  }
  // Empty PATH entries would mean the current directory; they are skipped so that the result is stable.
  for (const dir of (pathEnv || '').split(path.delimiter).filter(Boolean)) {
    const file = path.resolve(cwd, dir, value);
    if (isExecutableFile(file)) return file;
  }
  throw new Error(`WRANGLER_BIN not found in PATH: ${value}`);
}

// The local Wrangler login, read from newspaper/feedback. WRANGLER_BIN is used when set: `npx -y wrangler@4` first
// resolves the version online and can hang past the timeout, which then looks like a missing login.
function wranglerLoginToken(bin = process.env.WRANGLER_BIN) {
  try {
    const [command, ...prefix] = bin ? [bin] : ['npx', '-y', 'wrangler@4'];
    const output = execFileSync(command, [...prefix, 'auth', 'token', '--json'],
      { cwd: path.join(root, 'feedback'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 });
    return JSON.parse(output).token || '';
  } catch {
    return '';
  }
}

// The embed step runs after the imports and a build; getting its token first keeps a missing login from
// stopping the release halfway, with data/ already changed. Returns the token for the embed step.
export function checkCloudflareToken(env, getToken = () => wranglerLoginToken(env.WRANGLER_BIN)) {
  const token = env.CLOUDFLARE_API_TOKEN || getToken();
  if (token) return token;
  throw new Error('No Cloudflare token for embed-catalog: run `npx wrangler login` in newspaper/feedback, '
    + 'or set CLOUDFLARE_API_TOKEN.');
}

// Runs the steps in order and throws at the first failure. `spawn` is spawnSync's signature, replaceable in tests.
export function runSteps(steps, { spawn = spawnSync, log = console.log } = {}) {
  for (const [i, step] of steps.entries()) {
    const label = `step ${i + 1}/${steps.length} "${step.name}"`;
    log(`\n== release ${label}`);
    if (step.checkSql) {
      try {
        log(`${checkFeedbackSql(readFileSync(step.checkSql, 'utf8'))} statements OK`);
      } catch (error) {
        throw new Error(`${label} failed: ${error.message}`);
      }
      continue;
    }
    if (step.outputDir) mkdirSync(step.outputDir, { recursive: true });
    const [command, ...args] = step.argv;
    const result = spawn(command === 'node' ? process.execPath : command, args, { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`${label} failed (${result.error?.message || `exit ${result.status ?? result.signal}`})`);
    }
  }
}

// D1 keeps vote counts only if every statement is an idempotent insert; anything else is refused.
export function checkFeedbackSql(text) {
  const lines = text.split('\n').filter(line => line.trim());
  if (!lines.length) throw new Error('Feedback SQL is empty');
  const bad = lines.findIndex(line => !line.startsWith('INSERT OR IGNORE INTO '));
  if (bad !== -1) throw new Error(`Feedback SQL line ${bad + 1} is not INSERT OR IGNORE INTO: ${lines[bad].slice(0, 80)}`);
  return lines.length;
}

// Counts `git status --short` entries per directory (two levels deep, so data/editions and data/public-activity
// stay apart) for a quick check that only the authorized data/ folders changed.
export function summarizeStatus(porcelain) {
  const counts = new Map();
  for (const line of porcelain.split('\n').filter(Boolean)) {
    const file = line.slice(3).split(' -> ').at(-1).replace(/^"|"$/g, '');
    // Untracked directories end in "/" and count as one entry in that directory itself.
    const parts = file.split('/');
    const key = parts.slice(0, Math.min(2, parts.length - 1)).join('/') || '.';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b));
}

export const formatStep = step => step.checkSql ? `(check every line of ${step.checkSql} starts with INSERT OR IGNORE INTO)`
  : step.argv.map(arg => /^[\w./=@:-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`).join(' ');

function main() {
  let options, steps;
  try {
    // Steps run from the repository root, so paths given relative to the caller's directory become absolute.
    const parsed = parseReleaseArgs(process.argv.slice(2));
    options = Object.fromEntries(Object.entries(parsed).map(([key, value]) =>
      [key, typeof value === 'string' ? path.resolve(value) : value]));
    for (const input of [options.dailyBatch, options.externalDraft, options.externalSelection, options.weeklyReader]) {
      if (input && !existsSync(input)) throw new Error(`Not found: ${input}`);
    }
    const env = { ...process.env };
    if (env.WRANGLER_BIN && existsSync(path.resolve(env.WRANGLER_BIN))) env.WRANGLER_BIN = resolveExecutable(env.WRANGLER_BIN);
    steps = buildReleasePlan(options, env);
    if (!options.dryRun && steps.some(step => step.name === 'embed catalog')) {
      process.env.CLOUDFLARE_API_TOKEN = checkCloudflareToken(env);
    }
    // A local NODE_OPTIONS loader for model requests has no place in the build steps.
    delete process.env.NODE_OPTIONS;
    // The default SQL path (scratch/feedback-catalog.sql) and every step are relative to the repository root.
    process.chdir(root);
  } catch (error) {
    console.error(`release: ${error.message}\n${USAGE}`);
    process.exit(2);
  }
  steps.forEach((step, i) => console.log(`${i + 1}. ${step.name}: ${formatStep(step)}`));
  if (options.dryRun) return;
  try {
    runSteps(steps);
  } catch (error) {
    console.error(`release: ${error.message}`);
    process.exit(1);
  }
  const status = spawnSync('git', ['status', '--short'], { encoding: 'utf8' });
  console.log('\nChanged paths (git status --short), not committed:');
  for (const [dir, count] of summarizeStatus(status.stdout || '')) console.log(`  ${String(count).padStart(4)}  ${dir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
