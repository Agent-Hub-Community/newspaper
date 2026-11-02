import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReleasePlan, checkCloudflareToken, checkFeedbackSql, formatStep, parseReleaseArgs, resolveExecutable, runSteps,
  summarizeStatus } from '../scripts/release.mjs';

const env = { FEEDBACK_API_URL: 'https://feedback.example', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), WRANGLER_BIN: '/opt/wrangler' };
const plan = (argv, overrides = env) => buildReleasePlan(parseReleaseArgs(argv), overrides);
const names = steps => steps.map(step => step.name);
const tail = ['public build', 'embed catalog', 'public build with vectors', 'unit tests', 'public build check',
  'feedback catalog SQL', 'check SQL'];

test('daily, external and weekly imports run first, then the runbook build chain, then D1', () => {
  const steps = plan(['--daily-batch', 'scratch/b', '--external-draft', 'e/draft.json', '--external-selection', 'e/sel.json',
    '--weekly-reader', 'w', '--sql-out', 'scratch/c.sql']);
  assert.deepEqual(names(steps), ['import daily batch', 'import external report', 'import weekly', ...tail, 'register D1 feedback IDs']);
  assert.deepEqual(steps.map(formatStep), [
    'node scripts/publish-reviewed-batch.mjs scratch/b',
    'node scripts/import-external-report.mjs e/draft.json e/sel.json',
    'node scripts/import-reviewed-weekly.mjs w',
    'npm run build -- --public',
    'node scripts/embed-catalog.mjs',
    'npm run build -- --public',
    'npm test',
    'node test/build.mjs --public',
    'node scripts/feedback-catalog.mjs dist/data.js scratch/c.sql',
    '(check every line of scratch/c.sql starts with INSERT OR IGNORE INTO)',
    '/opt/wrangler d1 execute agenthub-feedback --remote --config feedback/wrangler.jsonc --file scratch/c.sql',
  ]);
});

test('optional imports are omitted and the SQL defaults next to the daily batch', () => {
  const daily = plan(['--daily-batch', 'scratch/b']);
  assert.deepEqual(names(daily), ['import daily batch', ...tail, 'register D1 feedback IDs']);
  assert.equal(daily.at(-2).checkSql, 'scratch/b/feedback-catalog.sql');
  assert.equal(plan([]).at(-2).checkSql, 'scratch/feedback-catalog.sql');
  assert.deepEqual(plan(['--external-draft', 'd.json']).find(step => step.name === 'import external report').argv,
    ['node', 'scripts/import-external-report.mjs', 'd.json']);
});

test('--skip-d1 still writes and checks the SQL but does not need or call Wrangler', () => {
  const { WRANGLER_BIN, ...withoutWrangler } = env;
  const steps = plan(['--weekly-reader', 'w', '--skip-d1'], withoutWrangler);
  assert.deepEqual(names(steps), ['import weekly', ...tail]);
  assert.ok(steps.every(step => !step.argv?.includes(WRANGLER_BIN)));
});

test('missing environment and inconsistent options fail before any step', () => {
  assert.throws(() => plan([], {}), /FEEDBACK_API_URL, CLOUDFLARE_ACCOUNT_ID, WRANGLER_BIN/);
  assert.throws(() => plan(['--skip-d1'], { FEEDBACK_API_URL: 'x' }), /: CLOUDFLARE_ACCOUNT_ID$/);
  assert.throws(() => plan(['--external-selection', 's.json']), /needs --external-draft/);
  assert.throws(() => parseReleaseArgs(['--daily', 'x']), /Unknown option/);
});

test('the SQL guard accepts only INSERT OR IGNORE statements', () => {
  const ok = "INSERT OR IGNORE INTO stories (id) VALUES ('a; b');\nINSERT OR IGNORE INTO stories (id) VALUES ('c');\n";
  assert.equal(checkFeedbackSql(ok), 2);
  assert.throws(() => checkFeedbackSql(`${ok}DELETE FROM stories;\n`), /line 3 is not INSERT OR IGNORE INTO/);
  assert.throws(() => checkFeedbackSql('INSERT INTO stories (id) VALUES (1);'), /line 1/);
  assert.throws(() => checkFeedbackSql('\n'), /empty/);
});

test('git status summary counts changes per directory', () => {
  const porcelain = [
    ' M data/editions/2026-10-25.json', '?? data/editions/2026-10-26.json', ' M data/public-activity/week.json',
    '?? data/public-activity/avatars/', 'R  lib/old.mjs -> lib/new.mjs', ' M package.json', '?? "data/odd name.json"',
  ].join('\n');
  assert.deepEqual(summarizeStatus(`${porcelain}\n`), [
    ['.', 1], ['data', 1], ['data/editions', 2], ['data/public-activity', 2], ['lib', 1],
  ]);
});

// A temporary directory holding an executable `wrangler` (never run) and a non-executable `plain`.
function fakeBinDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-bin-'));
  writeFileSync(path.join(dir, 'wrangler'), '#!/bin/sh\nexit 1\n');
  chmodSync(path.join(dir, 'wrangler'), 0o755);
  writeFileSync(path.join(dir, 'plain'), '');
  chmodSync(path.join(dir, 'plain'), 0o644);
  mkdirSync(path.join(dir, 'sub'));
  return dir;
}

test('--dry-run prints the plan and runs nothing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-plan-'));
  writeFileSync(path.join(dir, 'draft.json'), '{}');
  const bin = fakeBinDir();
  const dryEnv = { ...env, WRANGLER_BIN: path.join(bin, 'wrangler') };
  const script = fileURLToPath(new URL('../scripts/release.mjs', import.meta.url));
  const run = (args, extraEnv, cwd) => spawnSync(process.execPath, [script, ...args],
    { encoding: 'utf8', cwd, env: { PATH: process.env.PATH, ...extraEnv } });
  const result = run(['--daily-batch', dir, '--external-draft', path.join(dir, 'draft.json'), '--dry-run'], dryEnv);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^1\. import daily batch: node scripts\/publish-reviewed-batch\.mjs /);
  assert.ok(result.stdout.includes(`10. register D1 feedback IDs: ${path.join(bin, 'wrangler')} d1 execute`), result.stdout);
  assert.doesNotMatch(result.stdout, /== release step|Changed paths/);
  const missing = run(['--daily-batch', path.join(dir, 'absent'), '--dry-run'], dryEnv);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /Not found: .*absent/);
  assert.match(run(['--dry-run'], {}).stderr, /Missing environment variables/);
  // A relative WRANGLER_BIN means the caller's directory, although the steps later run from the repository root.
  const relative = run(['--dry-run'], { ...env, WRANGLER_BIN: './wrangler' }, bin);
  assert.equal(relative.status, 0, relative.stderr);
  assert.ok(relative.stdout.includes(`${path.join(bin, 'wrangler')} d1 execute`), relative.stdout);
  const absent = run(['--dry-run'], { ...env, WRANGLER_BIN: './no-such-wrangler' }, bin);
  assert.equal(absent.status, 2);
  assert.match(absent.stderr, /WRANGLER_BIN is not an executable file: .*no-such-wrangler/);
  assert.doesNotMatch(absent.stdout, /^1\./m);
  // --skip-d1 never touches Wrangler, so a broken WRANGLER_BIN does not matter.
  assert.equal(run(['--dry-run', '--skip-d1'], { ...env, WRANGLER_BIN: './no-such-wrangler' }, bin).status, 0);
});

test('WRANGLER_BIN with a separator resolves against the caller directory; a bare name is looked up in PATH', () => {
  const bin = fakeBinDir();
  const other = mkdtempSync(path.join(tmpdir(), 'release-path-'));
  assert.equal(resolveExecutable('./wrangler', { cwd: bin }), path.join(bin, 'wrangler'));
  assert.equal(resolveExecutable(path.join(bin, 'wrangler'), { cwd: other }), path.join(bin, 'wrangler'));
  assert.throws(() => resolveExecutable('./plain', { cwd: bin }), /not an executable file/);
  assert.throws(() => resolveExecutable('./sub', { cwd: bin }), /not an executable file/);
  const pathEnv = [other, '', bin].join(path.delimiter);
  assert.equal(resolveExecutable('wrangler', { cwd: other, pathEnv }), path.join(bin, 'wrangler'));
  assert.throws(() => resolveExecutable('plain', { cwd: other, pathEnv }), /not found in PATH: plain/);
  // An empty PATH entry is not taken as the current directory.
  assert.throws(() => resolveExecutable('wrangler', { cwd: bin, pathEnv: `${other}${path.delimiter}` }), /not found in PATH/);
});

test('the embed token preflight accepts CLOUDFLARE_API_TOKEN or a Wrangler login and fails without either', () => {
  let calls = 0;
  const login = token => () => { calls += 1; return token; };
  checkCloudflareToken({ CLOUDFLARE_API_TOKEN: 'set' }, login(''));
  assert.equal(calls, 0);
  checkCloudflareToken({}, login('from-login'));
  assert.equal(calls, 1);
  assert.throws(() => checkCloudflareToken({ CLOUDFLARE_API_TOKEN: '' }, login('')), /No Cloudflare token for embed-catalog/);
});

test('runSteps creates the --sql-out directory before the SQL step and stops at the first failure', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-run-'));
  const sqlOut = path.join(dir, 'new', 'nested', 'c.sql');
  const steps = plan(['--sql-out', sqlOut, '--skip-d1']);
  const spawned = [];
  // Stands in for every command; the SQL step writes its output file the way feedback-catalog.mjs does.
  const spawn = (command, args) => {
    spawned.push(args.at(-1));
    if (args[0] === 'scripts/feedback-catalog.mjs') writeFileSync(args[2], "INSERT OR IGNORE INTO stories (id) VALUES ('a');\n");
    return { status: 0 };
  };
  runSteps(steps, { spawn, log: () => {} });
  assert.equal(readFileSync(sqlOut, 'utf8').split('\n')[0], "INSERT OR IGNORE INTO stories (id) VALUES ('a');");
  assert.equal(spawned.length, steps.length - 1);

  const failing = mkdtempSync(path.join(tmpdir(), 'release-run-'));
  const calls = [];
  assert.throws(() => runSteps(plan(['--sql-out', path.join(failing, 'x', 'c.sql'), '--skip-d1']),
    { spawn: (command, args) => { calls.push(args); return { status: 3 }; }, log: () => {} }),
  /step 1\/7 "public build" failed \(exit 3\)/);
  assert.equal(calls.length, 1);
  assert.equal(existsSync(path.join(failing, 'x')), false);
});
