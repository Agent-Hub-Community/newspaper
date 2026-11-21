import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReleasePlan, checkCloudflareToken, checkFeedbackSql, formatStep, parseReleaseArgs, resolveExecutable, runSteps,
  summarizeStatus } from '../scripts/release.mjs';

const env = { FEEDBACK_API_URL: 'https://feedback.example', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) };
const plan = (argv, overrides = env) => buildReleasePlan(parseReleaseArgs(argv), overrides);
const names = steps => steps.map(step => step.name);

test('daily, external and weekly imports run first, followed by single public build, embed and optional D1 story registration', () => {
  const withWrangler = { ...env, WRANGLER_BIN: '/opt/wrangler' };
  const steps = plan(['--daily-batch', 'scratch/b', '--external-draft', 'e/draft.json', '--external-selection', 'e/sel.json',
    '--weekly-reader', 'w', '--sql-out', 'scratch/c.sql'], withWrangler);
  assert.deepEqual(names(steps), ['import daily batch', 'import external report', 'import weekly', 'public build', 'embed catalog', 'story catalog SQL', 'check SQL', 'register D1 story IDs']);
  assert.deepEqual(steps.map(formatStep), [
    'node scripts/publish-reviewed-batch.mjs scratch/b',
    'node scripts/import-external-report.mjs e/draft.json e/sel.json',
    'node scripts/import-reviewed-weekly.mjs w',
    'npm run build -- --public',
    'node scripts/embed-catalog.mjs',
    'node scripts/feedback-catalog.mjs dist/data.js scratch/c.sql',
    '(check every line of scratch/c.sql starts with INSERT OR IGNORE INTO)',
    '/opt/wrangler d1 execute agenthub-feedback --remote --config feedback/wrangler.jsonc --file scratch/c.sql',
  ]);
});

test('embed catalog is skipped when CLOUDFLARE_ACCOUNT_ID is absent or --skip-embed is set', () => {
  assert.deepEqual(names(plan(['--daily-batch', 'scratch/b'], { FEEDBACK_API_URL: 'https://feedback.example' })),
    ['import daily batch', 'public build']);
  assert.deepEqual(names(plan(['--weekly-reader', 'w', '--skip-embed'])),
    ['import weekly', 'public build']);
  assert.deepEqual(plan(['--external-draft', 'd.json']).find(step => step.name === 'import external report').argv,
    ['node', 'scripts/import-external-report.mjs', 'd.json']);
});

test('missing environment and inconsistent options fail before any step', () => {
  assert.throws(() => plan([], {}), /FEEDBACK_API_URL/);
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

function fakeBinDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-bin-'));
  writeFileSync(path.join(dir, 'wrangler'), '#!/bin/sh\nexit 1\n');
  chmodSync(path.join(dir, 'wrangler'), 0o755);
  writeFileSync(path.join(dir, 'plain'), '');
  chmodSync(path.join(dir, 'plain'), 0o644);
  mkdirSync(path.join(dir, 'sub'));
  return dir;
}

test('--dry-run prints the streamlined plan and runs nothing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-plan-'));
  writeFileSync(path.join(dir, 'draft.json'), '{}');
  const script = fileURLToPath(new URL('../scripts/release.mjs', import.meta.url));
  const run = (args, extraEnv, cwd) => spawnSync(process.execPath, [script, ...args],
    { encoding: 'utf8', cwd, env: { PATH: process.env.PATH, ...extraEnv } });
  const result = run(['--daily-batch', dir, '--external-draft', path.join(dir, 'draft.json'), '--dry-run'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^1\. import daily batch: node scripts\/publish-reviewed-batch\.mjs /);
  assert.ok(result.stdout.includes('4. embed catalog: node scripts/embed-catalog.mjs'), result.stdout);
  assert.doesNotMatch(result.stdout, /== release step|Changed paths|d1 execute/);
  const missing = run(['--daily-batch', path.join(dir, 'absent'), '--dry-run'], env);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /Not found: .*absent/);
  assert.match(run(['--dry-run'], {}).stderr, /Missing environment variables/);
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

test('runSteps executes in order and stops at the first failure', () => {
  const steps = plan(['--skip-embed']);
  const spawned = [];
  const spawn = (command, args) => {
    spawned.push(args);
    return { status: 0 };
  };
  runSteps(steps, { spawn, log: () => {} });
  assert.equal(spawned.length, 1);

  const calls = [];
  assert.throws(() => runSteps(plan([]),
    { spawn: (command, args) => { calls.push(args); return { status: 3 }; }, log: () => {} }),
  /step 1\/2 "public build" failed \(exit 3\)/);
  assert.equal(calls.length, 1);
});
