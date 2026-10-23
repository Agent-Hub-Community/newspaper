import { readFile, readdir, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { digests } from './lib/digest.mjs';
import { validatePublicActivity } from './lib/public-activity.mjs';
import { mergeDraftEditions } from './lib/draft-editions.mjs';
import { mergeExternalEditions } from './lib/external-editions.mjs';
import { feedbackId } from './lib/feedback-id.mjs';
import { createHash } from 'node:crypto';
import { loadSkins } from './site/skins/build.mjs';
import { writeRoutePages } from './lib/route-pages.mjs';
import { buildIconBundle } from './lib/icons.mjs';
import { readerReport, validateExternalDraft } from './lib/external-workflow.mjs';
import { validateStoryDiscussion } from './lib/story-discussion.mjs';
import { normalizeWeeklyIssue } from './lib/weekly-editions.mjs';
import { normalizeLibrary, readLibrary } from './lib/library.mjs';
import { normalizeOpportunities, readOpportunities } from './lib/opportunities.mjs';
import { writeLibraryPages } from './lib/library-render.mjs';
import { writeAgentFiles } from './lib/agents-render.mjs';
import { atomFeed, jsonFeed } from './lib/feed.mjs';
import { contentCatalog, writeContentFiles } from './lib/agent-content.mjs';
import { AGENTS_PAGE } from './lib/agent-docs.mjs';
import { mergedAliases, normalizeGlossary, readGlossary } from './lib/glossary.mjs';
import { writeGlossaryFiles } from './lib/glossary-render.mjs';
import { searchCounts, searchIndex, writeSearchFiles } from './lib/search-render.mjs';
import { readSynonyms, searchVocabulary } from './lib/synonyms.mjs';
import { weeklyRoute } from './lib/weekly-editions.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
// Browser files and templates copied into the build as they are.
const siteDir = path.join(root, 'site');
// Reviewed reader data: editions, activity snapshots, the library and its vocabularies.
const dataDir = path.join(root, 'data');
const publicBuild = process.argv.includes('--public');
const feedbackEndpoint = publicBuild ? (process.env.FEEDBACK_API_URL || '') : '';
if (feedbackEndpoint) {
  const url = new URL(feedbackEndpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('FEEDBACK_API_URL must be an HTTPS origin without credentials or a path');
  }
}
const localActivity = process.argv.includes('--local-activity');
const draftIndex = process.argv.indexOf('--draft');
const draftFile = draftIndex >= 0 ? process.argv[draftIndex + 1] : null;
const draftActivityIndex = process.argv.indexOf('--draft-activity');
const draftActivityFile = draftActivityIndex >= 0 ? process.argv[draftActivityIndex + 1] : null;
if (draftActivityIndex >= 0 && (!draftFile || !draftActivityFile || draftActivityFile.startsWith('--'))) {
  throw new Error('--draft-activity requires a draft and a projected activity snapshot');
}
if (draftIndex >= 0 && (!draftFile || draftFile.startsWith('--'))) throw new Error('--draft requires a reviewed issue JSON file');
if (draftFile && publicBuild) throw new Error('Draft preview cannot be combined with a public build');
const draft = draftFile ? JSON.parse(await readFile(path.resolve(draftFile), 'utf8')) : null;
// A reviewed external draft joins the preview at build time instead of being patched into built files.
const draftExternalIndex = process.argv.indexOf('--draft-external');
let draftExternal = null;
if (draftExternalIndex >= 0) {
  const [externalFile, selectionFile] = process.argv.slice(draftExternalIndex + 1, draftExternalIndex + 3);
  if (!draftFile || !externalFile || !selectionFile || [externalFile, selectionFile].some(value => value.startsWith('--'))) {
    throw new Error('--draft-external requires --draft plus a reviewed external draft and its selection file');
  }
  const external = JSON.parse(await readFile(path.resolve(externalFile), 'utf8'));
  validateExternalDraft(external, JSON.parse(await readFile(path.resolve(selectionFile), 'utf8')));
  draftExternal = readerReport(external);
}
const externalDirectory = path.join(dataDir, 'external-editions');
const externalReports = await Promise.all((await readdir(externalDirectory))
  .filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()
  .map(async name => JSON.parse(await readFile(path.join(externalDirectory, name), 'utf8'))));
const weeklyDirectory = path.join(dataDir, 'weekly-editions');
const weeklyReports = await Promise.all((await readdir(weeklyDirectory).catch(error => {
  if (error.code === 'ENOENT') return [];
  throw error;
}))
  .filter(name => /^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()
  .map(async name => normalizeWeeklyIssue(JSON.parse(await readFile(path.join(weeklyDirectory, name), 'utf8')))));
const editions = mergeExternalEditions(draft ? mergeDraftEditions(digests, draft) : digests,
  [...externalReports.filter(report => report.date !== draftExternal?.date), ...(draftExternal ? [draftExternal] : [])]);
for (const issue of editions) for (const page of issue.pages) for (const story of page.stories || []) {
  validateStoryDiscussion(story.discussion);
}
// The library is a separate static page; it never enters data.js.
const library = normalizeLibrary(await readLibrary(dataDir), editions, weeklyReports);
// Glossary spellings linked to a library keyword also find that keyword's items.
const glossary = normalizeGlossary(await readGlossary(dataDir), library);
library.aliases = mergedAliases(library, glossary);
if (publicBuild && localActivity) throw new Error('Public builds use the approved snapshot; do not combine --public and --local-activity.');
const out = path.join(root, draft || localActivity ? 'dist-preview' : 'dist');
const skins = await loadSkins();
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'assets'), { recursive: true });
const exists = async file => readFile(file, 'utf8').catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});

function withAnalytics(html, scriptPath) {
  if (!publicBuild) return html;
  const { document } = parseHTML(html);
  const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  const directives = new Map(policy.content.split(';').filter(s => s.trim()).map(s => {
    const [name, ...values] = s.trim().split(/\s+/);
    return [name, values];
  }));
  directives.set('script-src', ["'self'", 'https://static.cloudflareinsights.com/beacon.min.js']);
  directives.set('connect-src', ['https://cloudflareinsights.com', ...(feedbackEndpoint ? [new URL(feedbackEndpoint).origin] : [])]);
  policy.content = [...directives].map(([name, values]) => [name, ...values].join(' ')).join('; ');
  const script = document.createElement('script');
  script.src = scriptPath;
  script.defer = true;
  document.head.append(script);
  return document.toString();
}

const dates = editions.map(issue => issue.date).sort();
const data = { digests: editions.map(({ source, ...issue }) => ({
  ...issue,
  pages: issue.pages.map(page => {
    page = { ...page, ...(page.stories ? { stories: page.stories.map(story => ({
      ...story, feedbackId: feedbackId(issue.date, page.id, story),
    })) } : {}) };
    if (!publicBuild || !page.figure) return page;
    // Keep the citation, but do not redistribute a figure without reuse permission.
    const { src, ...figure } = page.figure;
    return { ...page, figure };
  }),
})), weeklies: weeklyReports, publicBuild, feedbackEndpoint, skins: skins.data, coverage: { first: dates[0], last: dates.at(-1) } };
if ((publicBuild || draft) && !localActivity) {
  const approvedDir = draftActivityFile ? path.dirname(path.resolve(draftActivityFile)) : path.join(dataDir, 'public-activity');
  data.activity = JSON.parse(await readFile(draftActivityFile ? path.resolve(draftActivityFile) : path.join(approvedDir, 'snapshot.json'), 'utf8'));
  validatePublicActivity(data.activity, editions);
  await mkdir(path.join(out, 'avatars'), { recursive: true });
  for (const file of Object.values(data.activity.avatars)) {
    await copyFile(path.join(approvedDir, file), path.join(out, file));
  }
} else if (localActivity) {
  const privateDir = path.join(root, 'scratch/activity');
  const activity = JSON.parse(await readFile(path.join(privateDir, 'activity.local.json'), 'utf8'));
  // Only the ordering is a browser deliverable; scoring inputs stay in the private report.
  const ranking = stats => ({ leaders: stats.leaders.map(({ key, label, rank }) => ({ key, label, rank })) });
  data.activity = {
    generatedAt: activity.generatedAt, windows: activity.windows, avatars: activity.avatars,
    ranks: Object.fromEntries(Object.entries(activity.ranks).map(([id, stats]) => [id, ranking(stats)])),
    groups: activity.groups.map(({ id, first, last, available, ranks, daily }) => ({
      id, first, last, available,
      ranks: Object.fromEntries(Object.entries(ranks || {}).map(([period, stats]) => [period, ranking(stats)])),
      daily: Object.fromEntries(Object.entries(daily).map(([date, stats]) => [date, ranking(stats)])),
    })),
  };
  await mkdir(path.join(out, 'avatars'), { recursive: true });
  for (const file of Object.values(data.activity.avatars)) {
    if (!/^avatars\/[a-f0-9]{12}\.(jpg|png)$/.test(file)) throw new Error('Invalid local avatar path');
    await copyFile(path.join(privateDir, file), path.join(out, file));
  }
}
if (data.activity) {
  const hash = createHash('sha256');
  for (const file of Object.values(data.activity.avatars).sort()) {
    hash.update(file).update(await readFile(path.join(out, file)));
  }
  data.avatarVersion = hash.digest('hex').slice(0, 16);
}
for (const asset of skins.assets) {
  const bytes = await readFile(asset.source);
  const version = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  await mkdir(path.dirname(path.join(out, asset.file)), { recursive: true });
  await writeFile(path.join(out, asset.file), bytes);
  const plugin = data.skins.plugins.find(plugin => plugin.id === asset.plugin);
  plugin[asset.key] += `?v=${version}`;
}
for (const file of new Set(weeklyReports.flatMap(issue => issue.rank?.groups.flatMap(group =>
  group.leaders.map(leader => leader.avatar).filter(Boolean)) || []))) {
  await mkdir(path.dirname(path.join(out, file)), { recursive: true });
  await copyFile(path.join(dataDir, file), path.join(out, file));
}
await writeFile(path.join(out, 'skins.css'), skins.css);
// Loaded only when exporting from file://, where canvas cannot read local images.
const exportFiles = new Set([
  ...skins.assets.map(asset => asset.file),
  ...Object.values(data.activity?.avatars || {}),
  ...weeklyReports.flatMap(issue => issue.rank?.groups.flatMap(group => group.leaders.map(leader => leader.avatar).filter(Boolean)) || []),
  ...data.digests.flatMap(issue => issue.pages.map(page => page.figure?.src).filter(Boolean)),
]);
const exportImages = {};
for (const file of exportFiles) {
  const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(file)];
  if (!type || path.isAbsolute(file) || file.split('/').includes('..')) throw new Error('Invalid export image');
  exportImages[file] = `data:${type};base64,${(await readFile(path.join(out, file))).toString('base64')}`;
}
await writeFile(path.join(out, 'export-images.js'), `window.AGENT_HUB_EXPORT_IMAGES = ${JSON.stringify(exportImages)};\n`);
// Each issue's articles ship in their own script, loaded with its page or on navigation;
// data.js keeps only the index that date and section navigation need, so it stops growing per article.
// hasArticles mirrors digest.js's page check.
const hasArticles = page => [page.stories, page.papers, page.id === 'external' ? page.trends : []]
  .some(items => items?.some(entry => typeof entry.text === 'string' && entry.text.trim()));
// The archive list shows each page's heading, so readers can tell issues apart without loading them.
const outline = pages => pages.map(page => hasArticles(page) && typeof page.heading === 'string' && page.heading.trim()
  ? { id: page.id, label: page.label, hasContent: true, heading: page.heading.trim() }
  : { id: page.id, label: page.label, hasContent: hasArticles(page) });
const issueVersions = {};
await mkdir(path.join(out, 'issues'), { recursive: true });
for (const issue of data.digests) {
  const script = `(window.AGENT_HUB_ISSUES = window.AGENT_HUB_ISSUES || {})[${JSON.stringify(issue.date)}] = ${JSON.stringify({ pages: issue.pages }).replaceAll('<', '\\u003c')};\n`;
  await writeFile(path.join(out, 'issues', `${issue.date}.js`), script);
  issueVersions[issue.date] = createHash('sha256').update(script).digest('hex').slice(0, 16);
}
// Weekly pages are static and embed their own stories.
const index = {
  ...data,
  digests: data.digests.map(({ pages, ...issue }) => ({ ...issue, version: issueVersions[issue.date], pages: outline(pages) })),
  weeklies: data.weeklies.map(({ pages, rank, ...issue }) => ({ ...issue, pages: outline(pages) })),
};
await writeFile(path.join(out, 'data.js'), `window.AGENT_HUB_DATA = ${JSON.stringify(index).replaceAll('<', '\\u003c')};\n`);
for (const file of ['index.html', '404.html', 'app.js', 'routes.js', 'appearance.js', 'digest.js', 'feedback.js', 'ranking.js', 'share-image.js', 'style.css', 'daily.css', 'color-scheme.css', 'skins.js', 'weekly.css', 'weekly-reader.js', 'discussion-panel.js', 'discussion-panel.css', 'library.css', 'library.js', 'copy.js', 'bm25.js', 'query.js', 'search.js']) {
  const content = await exists(path.join(siteDir, file));
  if (content) await writeFile(path.join(out, file), file === 'index.html' ? withAnalytics(content, 'analytics.js') : content);
}
if (publicBuild) {
  await copyFile(path.join(siteDir, 'analytics.js'), path.join(out, 'analytics.js'));
  await copyFile(path.join(siteDir, 'search-tracking.js'), path.join(out, 'search-tracking.js'));
}
await writeFile(path.join(out, '.nojekyll'), '');
await writeFile(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
await writeFile(path.join(out, 'icons.js'), await buildIconBundle(root));
await copyFile(path.join(root, 'node_modules/modern-screenshot/dist/index.js'), path.join(out, 'screenshot.js'));
const { document } = parseHTML(await readFile(path.join(out, 'index.html'), 'utf8'));
// The root page opens the latest readable issue; route pages swap in their own date.
const latest = index.digests.filter(issue => issue.pages.some(page => page.hasContent)).at(-1) || index.digests.at(-1);
const issueScript = document.createElement('script');
issueScript.setAttribute('defer', '');
issueScript.setAttribute('data-issue', '');
issueScript.setAttribute('src', `issues/${latest.date}.js`);
document.querySelector('script[src="data.js"]').after(issueScript);
if (!AGENTS_PAGE) document.querySelector('.tabs .agents-tab')?.remove();
for (const element of document.querySelectorAll('script[src], link[rel="stylesheet"], meta[name="agenthub-screenshot"]')) {
  const attribute = element.tagName === 'SCRIPT' ? 'src' : element.tagName === 'META' ? 'content' : 'href';
  const file = element.getAttribute(attribute);
  const version = createHash('sha256').update(await readFile(path.join(out, file))).digest('hex').slice(0, 16);
  element.setAttribute(attribute, `${file}?v=${version}`);
}
await writeFile(path.join(out, 'index.html'), document.toString());
await writeRoutePages(out, data, { issueVersions });
const vocabulary = searchVocabulary({ aliases: library.aliases, glossary, synonyms: await readSynonyms(dataDir) });
library.vocabulary = vocabulary;
// Opportunities close on a Beijing date; the build date decides which are still open (a daily rebuild moves them).
const opportunities = normalizeOpportunities(await readOpportunities(dataDir), { today: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10) });
await writeLibraryPages(out, { library, dataDir, weeklies: data.weeklies, publicBuild, feedbackEndpoint, vocabulary, opportunities });
await writeAgentFiles(out, { data, library, glossary, publicBuild });
await writeFile(path.join(out, 'feed.json'), jsonFeed(data));
await writeFile(path.join(out, 'feed.xml'), atomFeed(data));
const semanticVectors = await readFile(path.join(dataDir, 'semantic-vectors.json'), 'utf8').then(JSON.parse, error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
await writeContentFiles(out, contentCatalog({ digests: data.digests, weeklies: data.weeklies, library, opportunities, vocabulary }), semanticVectors);
const latestWeekly = data.weeklies.at(-1);
const weeklyHref = latestWeekly
  ? `../${weeklyRoute(latestWeekly, latestWeekly.pages.find(page => page.id === 'group-3')?.id || latestWeekly.pages[0].id)}` : '../';
const entries = searchIndex({ digests: data.digests, weeklies: data.weeklies, library, opportunities });
const counts = await searchCounts(entries, vocabulary, glossary.terms.map(entry => entry.term));
await writeGlossaryFiles(out, { glossary, counts, publicBuild, weeklyHref });
await writeSearchFiles(out, { entries, vocabulary, publicBuild, weeklyHref, feedbackEndpoint });
console.log(JSON.stringify({ digests: editions.length, first: data.coverage.first, last: data.coverage.last }));
