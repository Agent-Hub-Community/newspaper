import { robots } from '../lib/seo.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {normalizeWeeklyIssue,weeklyRoute} from '../lib/weekly-editions.mjs';
import {renderWeeklyPage,writeWeeklyPages} from '../lib/weekly-render.mjs';
import {AGENTS_PAGE} from '../lib/agent-docs.mjs';
import {site} from '../lib/site.mjs';
import {expectedMessageText,visibleMessageText} from './digest-context.mjs';

const issue=normalizeWeeklyIssue(JSON.parse(await readFile(new URL('../data/weekly-editions/2026-10-05_2026-10-11.json',import.meta.url))));
test('published weekly keeps reviewed paragraphs, highlights, anonymous messages and layout',()=>{
  for(const page of issue.pages){
    const document=parseHTML(renderWeeklyPage(issue,page,{weeklies:[issue]})).document;
    assert.equal(document.querySelectorAll('.story').length,page.stories.length);
    // Indexing follows the site-wide switch in seo.mjs, like every other page.
    assert.equal(document.querySelector('meta[name="robots"]').content,robots('weekly'));
    assert.equal(document.querySelector('link[rel="canonical"]').href,site+weeklyRoute(issue,page.id));
    assert.equal(document.querySelectorAll('.page-links a').length,6);
    for(const [i,story]of page.stories.entries()){
      const article=document.querySelectorAll('.story')[i];
      assert.equal([...article.querySelectorAll('.prose p')].map(p=>p.textContent).join('\n\n'),story.text);
      assert.deepEqual([...article.querySelectorAll('.prose strong')].map(p=>p.textContent),[...story.emphasis].sort((a,b)=>story.text.indexOf(a)-story.text.indexOf(b)));
      const trigger=article.querySelector('.discussion-trigger');
      assert.equal(trigger?.dataset.discussionIndex,story.discussion?.length?String(i):undefined);
      // Static pages carry only the trigger; the shared reader renders messages from the page data.
      assert.equal(article.querySelectorAll('.discussion-text,details.discussion').length,0);
      if(story.discussion?.length){
        const list=parseHTML(`<body>${globalThis.AgentHubDiscussion.renderList(story.discussion,'t')}</body>`).document;
        const rendered=[...list.querySelectorAll('.discussion-text')];
        assert.equal(rendered.length,story.discussion.length);
        for(const [j,m]of story.discussion.entries()){const expected=expectedMessageText(m.text);if(expected!==null)assert.equal(visibleMessageText(rendered[j]),expected);}
        assert.equal(list.querySelectorAll('.discussion-text strong').length,0);
      }
    }
    for (const link of document.querySelectorAll('a[href],script[src],link[href]')) {
      assert.doesNotMatch(link.getAttribute('href') || link.getAttribute('src'),/127\.0\.0\.1|localhost/);
    }
  }
});
test('weekly page shares the daily chrome: one date, three editions, one collapsed directory',()=>{
  const page=issue.pages.find(p=>p.id==='group-3');
  const document=parseHTML(renderWeeklyPage(issue,page,{weeklies:[issue],dailyDate:'2026-10-11'})).document;
  // The week appears once in the page chrome; the archive dialog lists issues separately.
  const chrome=document.querySelector('.shell').textContent;
  assert.equal(chrome.split('10.05–10.11').length-1,1);
  for(const repeated of [issue.label,'2026.10.05'])assert.equal(chrome.includes(repeated),false,repeated);
  assert.deepEqual([...document.querySelectorAll('.edition-nav .tabs a')].map(a=>[a.textContent,a.getAttribute('href')]),[
    ['日报','../../../../daily/2026-10-11/group-3/'],['周报','../../../../'+weeklyRoute(issue,'group-3')],['资料库','../../../../library/'],['活跃榜','../../../../rank/week/'],...(AGENTS_PAGE?[['给 Agent 用','../../../../agents/']]:[]),
  ]);
  assert.ok(document.querySelector('.edition-nav #archive-toggle[aria-controls="weekly-archive"]'));
  assert.ok(document.querySelector('.masthead #period-toggle[aria-controls="weekly-archive"]'), 'the week in the masthead opens the archive');
  assert.ok(document.querySelector('.edition-nav button.appearance-toggle'));
  // Section links carry only the label; the current one is marked.
  assert.deepEqual([...document.querySelectorAll('.page-links a')].map(a=>a.textContent),[...issue.pages.map(p=>p.label),'周榜']);
  assert.equal(document.querySelector('.page-links [aria-current]').textContent,'三群');
  const directories=document.querySelectorAll('details.directory');
  assert.equal(directories.length,1);
  assert.equal(directories[0].hasAttribute('open'),false);
  assert.equal(directories[0].querySelectorAll('a[href^="#topic-"]').length,page.stories.length);
  for(const [i,story]of page.stories.entries()){
    const article=document.querySelector(`#topic-${i+1}`);
    const links=[...article.querySelectorAll('.resources a')];
    assert.deepEqual(links.map(a=>a.getAttribute('href')),(story.resources||[]).map(r=>r.url));
    for(const [j,a]of links.entries()){
      assert.equal(a.querySelector('.resource-label').textContent,story.resources[j].label);
      assert.match(a.querySelector('.resource-address').textContent,new RegExp(new URL(story.resources[j].url).hostname.replace(/^www\./,'').replaceAll('.','\\.')));
    }
    assert.equal(article.querySelector('.comment p')?.textContent,story.review||undefined);
    // The discussion trigger and the way back share the closing row.
    const actions=article.querySelector('.story-actions');
    assert.equal(actions.lastElementChild.getAttribute('href'),'#directory');
    assert.equal(Boolean(actions.querySelector('.discussion-trigger')),Boolean(story.discussion?.length));
  }
});
test('weekly page loads the color scheme up front and the capture library only on export',()=>{
  const document=parseHTML(renderWeeklyPage(issue,issue.pages[0],{assets:{'appearance.js':'a1','color-scheme.css':'c1','screenshot.js':'s1'}})).document;
  const appearance=document.querySelector('head script[src*="appearance.js"]');
  assert.equal(appearance.getAttribute('src'),'../../../../appearance.js?v=a1');
  assert.equal(appearance.hasAttribute('defer')||appearance.hasAttribute('async'),false);
  assert.ok(document.querySelector('head link[rel="stylesheet"][href="../../../../color-scheme.css?v=c1"]'));
  assert.equal(document.querySelector('script[src*="screenshot.js"]'),null);
  assert.equal(document.querySelector('meta[name="agenthub-screenshot"]').content,'../../../../screenshot.js?v=s1');
});
test('weekly validator rejects private metadata and unsafe avatar paths',()=>{
  for(const edit of [x=>x.pages[0].stories[0].author='private',x=>x.rank.groups[0].leaders[0].avatar='../private.jpg',x=>x.pages[0].stories[0].discussion[0].sender='private']){
    const copy=structuredClone(issue);edit(copy);assert.throws(()=>normalizeWeeklyIssue(copy));
  }
});
test('public weekly reuses existing analytics with restricted CSP and same-origin export assets',()=>{
  const document=parseHTML(renderWeeklyPage(issue,issue.pages[0],{publicBuild:true,assets:{'analytics.js':'testhash'}})).document;
  assert.equal(document.querySelector('script[src*="analytics.js"]').src,'../../../../analytics.js?v=testhash');
  const csp=document.querySelector('[http-equiv="Content-Security-Policy"]').content;
  assert.match(csp,/script-src 'self' https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js/);
  assert.match(csp,/connect-src 'self' https:\/\/cloudflareinsights\.com/);
  assert.match(csp,/style-src 'self'/);
  assert.doesNotMatch(csp,/unsafe-inline/);
  const local=parseHTML(renderWeeklyPage(issue,issue.pages[0])).document;
  assert.equal(local.querySelector('script[src*="analytics.js"]'),null);
});
test('historical weekly editions retain every story under both route forms',async t=>{
  const out=await mkdtemp(path.join(tmpdir(),'weekly-pages-'));t.after(()=>rm(out,{recursive:true,force:true}));
  const weeklies=await Promise.all((await readdir(new URL('../data/weekly-editions/',import.meta.url))).map(async file=>normalizeWeeklyIssue(JSON.parse(await readFile(new URL('../data/weekly-editions/'+file,import.meta.url))))));
  for(const file of ['weekly.css','weekly-reader.js','screenshot.js','appearance.js','color-scheme.css','discussion-panel.js','discussion-panel.css',...new Set(weeklies.flatMap(w=>w.rank?.groups.flatMap(g=>g.leaders.map(m=>m.avatar).filter(Boolean))||[]))]){
    await mkdir(path.dirname(path.join(out,file)),{recursive:true});await writeFile(path.join(out,file),'asset');
  }
  await writeWeeklyPages(out,{weeklies,digests:[{date:'2026-10-11'}]});
  for(const weekly of weeklies)for(const page of weekly.pages){
    for(const route of [weeklyRoute(weekly,page.id),`weekly/${weekly.id}/${page.id}/`]){
      const doc=parseHTML(await readFile(path.join(out,route,'index.html'),'utf8')).document;
      assert.equal(doc.querySelectorAll('.story').length,page.stories.length);
      assert.equal(doc.querySelectorAll('.weekly-archive nav a').length,weeklies.length);
    }
  }
  const rank=parseHTML(await readFile(path.join(out,weeklyRoute(issue,'rank'),'index.html'),'utf8')).document;
  assert.equal(rank.querySelectorAll('.rank-card').length,4);
  assert.equal(rank.querySelectorAll('.leaders img').length,10);
  assert.equal(rank.querySelectorAll('.leaders .missing').length,2);
  assert.equal(rank.querySelector('.shell').textContent.includes('2026.10.05'),false);
});

test('weekly editions accept every configured group and reject unknown ones', () => {
  const copy = structuredClone(issue);
  copy.pages.splice(-1, 0, { ...structuredClone(copy.pages[0]), id: 'group-5', label: '五群' });
  if (copy.rank) copy.rank.groups.push({ id: 'group-5', label: '五群', leaders: [] });
  assert.ok(normalizeWeeklyIssue(copy).pages.some(page => page.id === 'group-5'));
  const unknown = structuredClone(issue);
  unknown.pages[0].id = 'group-9';
  assert.throws(() => normalizeWeeklyIssue(unknown));
});
