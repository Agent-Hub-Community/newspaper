#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digests } from '../lib/digest.mjs';
import { readLibrary, GROUPS, TYPES } from '../lib/library.mjs';
import {
  diagnoseLibrary,
  fetchUrlMetadata,
  inferMetadataFromUrl,
  parseSubmissionIssue,
  suggestTopicsAndKeywords,
  syncFromEditions,
  upsertLibraryItem,
} from '../lib/library-ingest.mjs';
import { normalizeWeeklyIssue } from '../lib/weekly-editions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');

const USAGE = `Agent Hub 资料库 CLI (scripts/library-cli.mjs)

用法 / Usage:
  node scripts/library-cli.mjs add <url> [--title ...] [--summary ...] [--type ...]
                                   [--topics a,b] [--keywords a,b,c] [--group group-3]
                                   [--date YYYY-MM-DD] [--extra-link kind=url ...]
                                   [--fetch] [--merge] [--dry-run] [--json]
  node scripts/library-cli.mjs sync-editions [--since YYYY-MM-DD] [--out FILE] [--json]
  node scripts/library-cli.mjs import <file.json> [--merge] [--dry-run] [--json]
  node scripts/library-cli.mjs parse-issue <file.md|-> [--apply] [--merge] [--dry-run]
  node scripts/library-cli.mjs doctor [--json]
`;

async function readWeeklies() {
  const dir = path.join(dataDir, 'weekly-editions');
  const names = await readdir(dir).catch(() => []);
  return Promise.all(
    names.filter(n => /^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()
      .map(async n => normalizeWeeklyIssue(JSON.parse(await readFile(path.join(dir, n), 'utf8')))),
  );
}

async function readLinkPreviews() {
  return JSON.parse(await readFile(path.join(dataDir, 'link-previews.json'), 'utf8').catch(() => '{}'));
}

function parseFlags(args) {
  const flags = { _: [], extraLinks: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) { flags._.push(arg); continue; }
    const key = arg.slice(2);
    if (['fetch', 'merge', 'dry-run', 'json', 'apply', 'help'].includes(key)) {
      flags[key] = true;
    } else if (key === 'extra-link') {
      flags.extraLinks.push(args[++i]);
    } else {
      flags[key] = args[++i];
    }
  }
  return flags;
}

async function saveLibrary(library) {
  const { aliases, ...clean } = library;
  await writeFile(path.join(dataDir, 'library.json'), `${JSON.stringify({ version: 1, through: clean.through, items: clean.items }, null, 2)}\n`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  if (!command || command === '--help' || flags.help) {
    console.log(USAGE);
    return;
  }

  const library = await readLibrary(dataDir);
  const aliases = library.aliases || {};
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

  if (command === 'doctor') {
    const weeklies = await readWeeklies();
    const linkPreviews = await readLinkPreviews();
    const report = diagnoseLibrary(library, digests, weeklies, { aliases, linkPreviews });
    if (flags.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`Agent Hub 资料库诊断报告`);
    console.log(`- 收录条目：${report.totalItems} 项（覆盖至 ${report.through}，最新日报 ${report.latestEditionDate}，差 ${report.coverageGapDays} 天）`);
    console.log(`- 尚未入库的日报/周报链接：${report.unindexedEditionResources.count} 条`);
    for (const ex of report.unindexedEditionResources.examples.slice(0, 5)) {
      console.log(`  · [${ex.date}] ${ex.title} (${ex.url})`);
    }
    console.log(`- 关键词健康度：共 ${report.keywordStats.unique} 个，仅出现 1 次占 ${report.keywordStats.singleUse} (${(report.keywordStats.singleUseRatio * 100).toFixed(1)}%)`);
    console.log(`- 未规范化别名：${report.keywordStats.uncanonicalized.length} 处；近似拼写词组：${report.nearDuplicateKeywords.length} 组`);
    console.log(`- 关联讨论：${report.itemsWithDiscussions} 项；跨群分享：${report.multiGroupItems} 项；多链接：${report.multiLinkItems} 项；缺代码的论文：${report.itemsMissingCodeOrPaper} 项`);
    return;
  }

  if (command === 'sync-editions') {
    const weeklies = await readWeeklies();
    const linkPreviews = await readLinkPreviews();
    const candidates = syncFromEditions(digests, weeklies, library, { linkPreviews, aliases, since: flags.since || '' });
    if (flags.out) {
      await writeFile(path.resolve(flags.out), `${JSON.stringify({ count: candidates.length, items: candidates.map(c => c.draft) }, null, 2)}\n`);
    }
    if (flags.json) {
      console.log(JSON.stringify({ count: candidates.length, candidates }, null, 2));
      return;
    }
    console.log(`发现 ${candidates.length} 条日报/周报中尚未入库的资料${flags.since ? `（自 ${flags.since} 起）` : ''}：`);
    for (const c of candidates.slice(0, 20)) {
      console.log(`- [${c.shares[0].date} ${GROUPS[c.shares[0].group]}] (${TYPES[c.inferred.type]}) ${c.draft.title} -> ${c.url}`);
    }
    if (flags.out) console.log(`已写入可直接导入的草稿：${flags.out}`);
    return;
  }

  if (command === 'add') {
    const rawUrl = flags._[0];
    if (!rawUrl) throw new Error('Missing <url>');
    const inferred = inferMetadataFromUrl(rawUrl);
    let fetched = null;
    if (flags.fetch) fetched = await fetchUrlMetadata(rawUrl);
    const title = flags.title || fetched?.title || inferred.suggestedTitle || inferred.host;
    const summary = flags.summary || (fetched?.description ? fetched.description.slice(0, 150) : `收录自 ${inferred.host} 的${TYPES[inferred.type]}。`);
    const suggested = suggestTopicsAndKeywords(`${title} ${summary} ${(fetched?.tags || []).join(' ')}`, { aliases, existingItems: library.items });
    const topics = flags.topics ? flags.topics.split(',').map(s => s.trim()).filter(Boolean) : suggested.topics;
    const keywords = flags.keywords ? flags.keywords.split(',').map(s => s.trim()).filter(Boolean) : suggested.keywords;
    const extraLinks = (flags.extraLinks || []).map(pair => {
      const eq = pair.indexOf('=');
      if (eq < 0) return { kind: inferMetadataFromUrl(pair).linkKind, url: pair };
      return { kind: pair.slice(0, eq), url: pair.slice(eq + 1) };
    });
    const links = [{ kind: inferred.linkKind, url: inferred.url }, ...(fetched?.extraLinks || []), ...extraLinks];
    const draft = {
      title,
      summary,
      type: flags.type || inferred.type,
      topics,
      keywords,
      links,
      group: flags.group || 'group-3',
      date: flags.date || today,
    };
    const res = upsertLibraryItem(library, draft, { merge: Boolean(flags.merge), aliases, today });
    if (!flags['dry-run']) await saveLibrary(res.library);
    if (flags.json) {
      console.log(JSON.stringify({ action: res.action, dryRun: Boolean(flags['dry-run']), item: res.item, warnings: res.warnings }, null, 2));
    } else {
      console.log(`${flags['dry-run'] ? '[dry-run] ' : ''}${res.action}: ${res.item.id} (${res.item.title})`);
      for (const w of res.warnings) console.log(`  warning: ${w}`);
    }
    return;
  }

  if (command === 'import') {
    const file = flags._[0];
    if (!file) throw new Error('Missing <file.json>');
    const raw = JSON.parse(await readFile(path.resolve(file), 'utf8'));
    const list = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : [raw];
    let current = library;
    const results = [];
    for (const draft of list) {
      const res = upsertLibraryItem(current, draft, { merge: Boolean(flags.merge), aliases, today });
      current = res.library;
      results.push({ action: res.action, id: res.item.id, title: res.item.title, warnings: res.warnings });
    }
    if (!flags['dry-run']) await saveLibrary(current);
    if (flags.json) {
      console.log(JSON.stringify({ total: results.length, dryRun: Boolean(flags['dry-run']), results }, null, 2));
    } else {
      console.log(`${flags['dry-run'] ? '[dry-run] ' : ''}处理完成 ${results.length} 条（新增 ${results.filter(r => r.action === 'added').length}，合并 ${results.filter(r => r.action === 'merged').length}）`);
    }
    return;
  }

  if (command === 'parse-issue') {
    const target = flags._[0];
    if (!target) throw new Error('Missing <file.md|->');
    const content = target === '-' ? await readFile(0, 'utf8') : await readFile(path.resolve(target), 'utf8');
    const draft = parseSubmissionIssue(content);
    if (!flags.apply) {
      console.log(JSON.stringify(draft, null, 2));
      return;
    }
    const res = upsertLibraryItem(library, draft, { merge: Boolean(flags.merge), aliases, today });
    if (!flags['dry-run']) await saveLibrary(res.library);
    console.log(JSON.stringify({ action: res.action, dryRun: Boolean(flags['dry-run']), item: res.item, warnings: res.warnings }, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
