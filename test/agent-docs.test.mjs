import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import {
  dailyMarkdown, indexMarkdown, llmsFullTxt, llmsTxt, siteSkill, weeklyMarkdown, weeklyMarkdownPath,
} from '../lib/agent-docs.mjs';
import { normalizeLibrary } from '../lib/library.mjs';
import { searchIndex } from '../lib/search-render.mjs';
import { headTags, robots, sitemap } from '../lib/seo.mjs';
import { site } from '../lib/site.mjs';

const issue = { date: '2026-10-13', pages: [
  { id: 'group-1', label: '一群', heading: '本日群聊版尚未收录', stories: [] },
  { id: 'group-2', label: '二群', heading: 'AI 审稿会怎样变？', theme: '审稿工具变动', stories: [{
    title: 'AI 审稿的注入干扰', text: '第一段。\n\n第二段 *不是强调*。', aiComment: '记下模型版本。',
    resources: [{ kind: 'paper', label: '论文', url: 'https://arxiv.org/abs/2609.39027' }],
    discussion: [{ speaker: 1, time: '21:24', text: '群友的原话不应进入 Markdown' }],
  }] },
] };
const weekly = { id: '2026-10-05_2026-10-11', start: '2026-10-05', end: '2026-10-11', label: '10.05–10.11', pages: [
  { id: 'group-3', label: '三群', title: '自我改进怎样算进步', intro: 'RSI 讨论。', stories: [
    { title: 'RSI 的边界', text: '正文。', review: '锐评。', timeline: [{ date: '2026-10-07', text: '提出问题' }], resources: [] },
  ] },
] };
const library = normalizeLibrary({ version: 1, through: '2026-10-13', items: [{
  id: 'cua-gym', title: 'CUA-Gym', summary: '合成 computer-use 训练环境。', type: 'dataset', topics: ['computer-use'],
  keywords: ['OSWorld', 'RLVR', 'data synthesis'], links: [{ kind: 'paper', url: 'https://arxiv.org/abs/2605.25624' }],
  shares: [{ date: '2026-06-02', group: 'group-1', avatar: '0123456789abcdef.jpg' }],
}] });
const glossary = { through: '2026-10-13', terms: [{ term: 'oai', variants: [], meaning: 'OpenAI 的缩写。', category: '缩写', refersTo: 'OpenAI' }] };
const data = { digests: [issue, { date: '2026-10-12', pages: [{ id: 'group-1', label: '一群', heading: '空', stories: [] }] }], weeklies: [weekly] };

test('daily Markdown keeps summaries, comments and sources but never the raw discussion', () => {
  const markdown = dailyMarkdown(issue);
  assert.match(markdown, /^# AgentHub 日报 2026-10-13/);
  assert.match(markdown, /## 二群：AI 审稿会怎样变？/);
  assert.doesNotMatch(markdown, /一群/, 'pages without copy are left out');
  assert.match(markdown, /第一段。\n\n第二段 \\\*不是强调\\\*。/, 'paragraphs survive and Markdown syntax is escaped');
  assert.match(markdown, /AI 锐评：记下模型版本。/);
  assert.match(markdown, /资料：\[论文\]\(https:\/\/arxiv\.org\/abs\/2609\.39027\)/);
  assert.ok(markdown.includes(`网页：${site}daily/2026-10-13/group-2/#topic-1`));
  assert.doesNotMatch(markdown, /原话|21:24/);
});

test('fifth-group Markdown uses its reader label', () => {
  const fifth = { date: '2026-10-20', pages: [{ ...issue.pages[1], id: 'group-5', label: undefined, heading: undefined }] };
  assert.match(dailyMarkdown(fifth), /五群/);
  assert.doesNotMatch(dailyMarkdown(fifth), /## group-5/);
});

test('approved quotes survive while discussion changes cannot affect Markdown or search', () => {
  const quoted = structuredClone(issue);
  const story = quoted.pages[1].stories[0];
  story.text = '讨论了 less compute to serve 的适用条件。';
  story.discussion = [{ speaker: 1, time: '21:24', text: 'less compute to serve' },
    { speaker: 2, time: '21:25', text: 'PRIVATE_DISCUSSION_ONLY' }];
  const render = value => ({ markdown: dailyMarkdown(value),
    search: searchIndex({ digests: [value], weeklies: [], library: { items: [] } }) });
  const original = render(quoted);
  assert.match(original.markdown, /less compute to serve/);
  assert.match(JSON.stringify(original.search), /less compute to serve/);
  assert.doesNotMatch(JSON.stringify(original), /PRIVATE_DISCUSSION_ONLY/);
  story.discussion = [{ speaker: 3, time: '22:00', text: 'REPLACEMENT_PRIVATE_MESSAGE' }];
  assert.deepEqual(render(quoted), original);
  delete story.discussion;
  assert.deepEqual(render(quoted), original);
});

test('a single page copy carries only that page', () => {
  const markdown = dailyMarkdown(issue, 'group-2');
  assert.match(markdown, /^# AgentHub 日报 2026-10-13 二群/);
  assert.ok(markdown.includes(`网页：${site}daily/2026-10-13/group-2/\n`));
  assert.equal(dailyMarkdown(issue, 'group-1').includes('## '), false, 'a page without copy has no sections');
});

test('weekly Markdown has its own path and keeps the timeline', () => {
  assert.equal(weeklyMarkdownPath(weekly), 'weekly/2026-10-05/2026-10-11/index.md');
  const markdown = weeklyMarkdown(weekly);
  assert.match(markdown, /- 2026-10-07：提出问题/);
  assert.match(markdown, /AI 锐评：锐评。/);
});

test('the index, llms files and skill point only at files the build writes', () => {
  const index = indexMarkdown(data, library, glossary);
  assert.match(index, /- 2026-10-13：.*daily\/2026-10-13\/index\.md\n  - 二群：AI 审稿会怎样变？　.*daily\/2026-10-13\/group-2\/index\.md/);
  assert.doesNotMatch(index, /2026-10-12/, 'issues without readable pages have no Markdown copy');
  assert.match(index, /weekly\/2026-10-05\/2026-10-11\/index\.md/);
  const llms = llmsTxt(data, library, glossary);
  assert.match(llms, /^# AgentHub\n\n> /, 'llms.txt starts with a title and a summary block');
  for (const target of ['index.md', 'agents/SKILL.md', 'library/resources.json', 'glossary/glossary.json', 'llms-full.txt']) assert.ok(llms.includes(target), target);
  const full = llmsFullTxt(data, library, glossary);
  assert.ok(full.includes('# AgentHub 群聊黑话') && full.includes('# AgentHub 资料库') && full.includes('# AgentHub 周报') && full.includes('# AgentHub 日报 2026-10-13'));
  const skill = siteSkill();
  assert.match(skill, /^---\nname: agenthub\ndescription: .+\n---\n/);
  assert.doesNotMatch(skill, /共 \d+ 项|收录到/, "an installed skill must not carry counts that go stale");
  assert.match(skill, /agent skills/);
  assert.match(skill, /glossary\/glossary\.json/);
});

test('head tags keep sections out of search until listed and escape page text', () => {
  assert.equal(robots('library'), 'noindex,nofollow');
  assert.equal(sitemap([{ section: 'library', url: 'https://example.com/' }]), null, 'no sitemap while nothing is indexed');
  const { document } = parseHTML(`<html><head>${headTags({ section: 'daily', kind: 'article', title: '"标题" <b>', description: '描述', url: `${site}daily/2026-10-13/group-2/`, date: '2026-10-13', markdown: '../index.md' })}</head></html>`);
  assert.equal(document.querySelector('meta[property="og:title"]').getAttribute('content'), '"标题" <b>');
  assert.equal(document.querySelector('link[rel="alternate"]').getAttribute('href'), '../index.md');
  const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
  assert.equal(ld['@type'], 'Article');
  assert.equal(ld.datePublished, '2026-10-13');
  assert.equal(ld.isPartOf.url, site);
});
test('the skill section gives agents one install prompt with the skill address and both skill folders', async () => {
  const { renderAgentsPage } = await import('../lib/agents-render.mjs');
  const { document } = parseHTML(renderAgentsPage({ latest: '2026-10-13', libraryCount: 1, dailyHref: '../', weeklyHref: '../' }));
  const prompt = document.querySelector('#install-skill').textContent;
  assert.equal(document.querySelector('.copy[data-copy="install-skill"]').textContent, '复制');
  assert.ok(prompt.includes(`${site}agents/SKILL.md`));
  assert.ok(prompt.includes('~/.claude/skills/agenthub/SKILL.md') && prompt.includes('~/.agents/skills/agenthub/SKILL.md'));
  // The reader hands the agent a request; no shell command to paste into a terminal.
  assert.doesNotMatch(prompt, /curl|mkdir/);
});
