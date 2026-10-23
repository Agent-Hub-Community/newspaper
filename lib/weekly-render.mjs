import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { weeklyRoute } from './weekly-editions.mjs';
import { AGENTS_PAGE, weeklyMarkdownPath } from './agent-docs.mjs';
import { clip, headTags, robots } from './seo.mjs';
import { site } from './site.mjs';
import '../site/discussion-panel.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const marked=s=>{let text=s.text,at=0,html='';for(const range of(s.emphasis||[]).map(t=>({t,index:text.indexOf(t)})).filter(x=>x.index>=0).sort((a,b)=>a.index-b.index)){if(range.index<at)continue;html+=esc(text.slice(at,range.index))+`<strong>${esc(range.t)}</strong>`;at=range.index+range.t.length;}return(html+esc(text.slice(at))).split('\n\n').map(p=>`<p>${p}</p>`).join('');};
const pad = n => String(n).padStart(2, '0');
const shortDate = date => date.slice(5).replace('-', '.');
// Lucide paths, inlined because weekly pages do not load the icon bundle.
const icon = paths => `<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const imageDown = icon('<path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21"/><path d="m14 19 3 3v-5.5"/><path d="m17 22 3-3"/><circle cx="9" cy="9" r="2"/>');
const searchIcon = icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>');
const library = icon('<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>');
const favicon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='4' fill='%23a6322b'/%3E%3Ctext x='20' y='29' text-anchor='middle' font-size='29' font-family='serif' fill='white'%3EH%3C/text%3E%3C/svg%3E";
// The browser reader builds the messages; static pages only need the identical trigger.
const discussion = (story, index) => story.discussion?.length ? globalThis.AgentHubDiscussion.trigger(story.discussion, index) : '';
// Source cards match the daily page and the discussion reader: kind, title, then site.
const resourceIcons = {
  paper: icon('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'),
  article: icon('<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>'),
  code: icon('<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>'),
  demo: icon('<polygon points="6 3 20 12 6 21 6 3"/>'),
  messages: icon('<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>'),
  link: icon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
};
const externalIcon = icon('<path d="M7 7h10v10"/><path d="M7 17 17 7"/>');
const resources = story => story.resources?.length ? `<ul class="resources" aria-label="相关资料">${story.resources.map(r =>
  `<li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer"><span class="resource-icon">${resourceIcons[globalThis.AgentHubDiscussion.resourceKind(r)]}</span><span class="resource-copy"><span class="resource-label">${esc(r.label)}</span> <span class="resource-address">${esc(new URL(r.url).hostname.replace(/^www\./, ''))}</span></span><span class="resource-external">${externalIcon}</span></a></li>`).join('')}</ul>` : '';
const timeline = story => story.timeline?.length ? `<aside class="timeline"><h3>${story.kind === 'related' ? '本周相关讨论' : '本周进展'}</h3><ol>${story.timeline.map(t =>
  `<li><time datetime="${esc(t.date)}">${esc(shortDate(t.date))}</time><p>${esc(t.text)}</p></li>`).join('')}</ol></aside>` : '';
const renderStory = (s, i, feature) => {
  const meta = [...(s.dates || []).map(shortDate), s.kind === 'related' ? '相关议题' : s.kind === 'continuation' ? '跨日延续' : ''].filter(Boolean).join(' · ');
  return `<article class="story${feature ? ' feature' : ''}" id="topic-${i+1}"><div class="story-number"><span>${pad(i+1)}</span>${esc(meta)}</div><h2>${esc(s.title)}</h2>` +
    `<div class="story-body"><div class="prose">${marked(s)}</div>${timeline(s)}</div>${resources(s)}` +
    (s.review ? `<aside class="comment" aria-label="AI 锐评"><span class="comment-label">AI 锐评</span><p>${esc(s.review)}</p></aside>` : '') +
    `<div class="story-actions">${discussion(s, i)}<a class="back-top" href="#directory">回到目录<span aria-hidden="true"> ↑</span></a></div></article>`;
};
export function renderWeeklyPage(issue, p, { prefix = '../../../../', weeklies = [], dailyDate = issue.end, assets = {}, publicBuild = false, feedbackEndpoint = '' } = {}) {
const id=p.id;
const views = publicBuild && Boolean(feedbackEndpoint);
const scripts = publicBuild ? "'self' https://static.cloudflareinsights.com/beacon.min.js" : "'self'";
const connections = publicBuild ? `'self' https://cloudflareinsights.com${views ? ` ${new URL(feedbackEndpoint).origin}` : ''}` : "'self'";
const link = page => prefix + weeklyRoute(issue, page);
const period = shortDate(issue.start)+'–'+shortDate(issue.end);
const weekDate = new Date(issue.start+'T00:00:00Z');
weekDate.setUTCDate(weekDate.getUTCDate()+4-(weekDate.getUTCDay()||7));
const week = Math.ceil((((weekDate-new Date(Date.UTC(weekDate.getUTCFullYear(),0,1)))/86400000)+1)/7);
const asset = file => prefix+file+(assets[file]?'?v='+assets[file]:'');
const allPages = [...issue.pages, ...(issue.rank ? [{id:'rank',label:'周榜'}] : [])];
const rank = id === 'rank';
const archive = weeklies.slice().reverse().map(old => `<a href="${esc(prefix+weeklyRoute(old, rank&&old.rank?'rank':old.pages.some(x=>x.id===id)?id:old.pages[0].id))}" ${old.id===issue.id?'aria-current="page"':''}>${esc(old.label)}</a>`).join('');
const nav = allPages.map(x => `<a href="${esc(link(x.id))}" ${x.id===id?'aria-current="page"':''}>${esc(x.label)}</a>`).join('');
const daily = `${prefix}daily/${dailyDate}/${id==='external'||id.startsWith('group-')?id:'group-3'}/`;
const groupRank = issue.rank?.groups.some(g => g.id === id) ? `<a class="rank-link" href="${esc(link('rank')+'#'+id)}">本群周榜<span aria-hidden="true">↗</span></a>` : '';
// Long stories with a timeline lead the page at full width; only a leading run, so the two-column grid never leaves a hole.
let lead = 0;
while (!rank && lead < 2 && p.stories[lead]?.timeline?.length && p.stories[lead].text.length > 500) lead++;
const content = rank
  ? `<div class="ranks">${issue.rank.groups.map(g=>`<section class="rank-card" id="${esc(g.id)}"><h2>${esc(g.label)}</h2><ol class="leaders">${g.leaders.map(m=>`<li><span class="rank-num">${m.rank}</span>${m.avatar?`<img src="${esc(asset(m.avatar))}" alt="第 ${m.rank} 名成员头像" width="58" height="58">`:'<span class="missing">头像暂不可用</span>'}</li>`).join('')}</ol></section>`).join('')}</div>`
  : `<details class="directory" id="directory"><summary>目录 · ${p.stories.length} 个话题</summary><ol>${p.stories.map((s,i)=>`<li><a href="#topic-${i+1}"><span>${pad(i+1)}</span>${esc(s.title)}</a></li>`).join('')}</ol></details>` +
    `<section class="stories" aria-label="本期讨论">${p.stories.map((s,i)=>renderStory(s,i,i<lead)).join('')}</section>`;
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><meta name="agenthub-root" content="${prefix}"><meta name="agenthub-screenshot" content="${esc(asset('screenshot.js'))}">${headTags({ section: 'weekly', kind: 'article', title: `${p.title} · ${issue.label}`, date: issue.end, url: new URL(weeklyRoute(issue, id), site).href, markdown: prefix + weeklyMarkdownPath(issue), llms: `${prefix}llms.txt`, description: clip(`AgentHub ${p.label}周报 ${issue.start} 至 ${issue.end}：${[p.title, p.intro].filter(Boolean).join('。')}`) })}<meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; script-src ${scripts}; style-src 'self'; img-src 'self' data:; connect-src ${connections}; object-src 'none'; base-uri 'none'"><link rel="canonical" href="${esc(new URL(weeklyRoute(issue,id),site).href)}"><title>${esc(p.label)} · AgentHub 周报 · ${issue.label}</title><link rel="icon" href="${favicon}">` +
  `<script src="${esc(asset('appearance.js'))}"></script><link rel="stylesheet" href="${esc(asset('weekly.css'))}"><link rel="stylesheet" href="${esc(asset('discussion-panel.css'))}"><link rel="stylesheet" href="${esc(asset('color-scheme.css'))}"></head>` +
  `<body data-page="${id}"><a class="skip" href="#content">跳至正文</a><div class="shell">` +
  `<header class="masthead"><div class="masthead-main"><a class="wordmark" href="${esc(link('group-3'))}" translate="no">AgentHub<span>周报</span></a><button type="button" class="issue-date" id="period-toggle" aria-haspopup="dialog" aria-controls="weekly-archive" title="往期目录"><span class="period">${esc(period)}</span><small>${issue.start.slice(0,4)} · 第 ${week} 周</small></button></div></header>` +
  `<nav class="edition-nav" aria-label="栏目"><div class="tabs"><a href="${esc(daily)}">日报</a><a href="${esc(link('group-3'))}" aria-current="true">周报</a><a href="${esc(prefix)}library/">资料库</a><a href="${esc(prefix)}rank/week/">活跃榜</a>${AGENTS_PAGE ? `<a class="agents-tab" href="${esc(prefix)}agents/">给 Agent 用</a>` : ''}</div><div class="edition-tools"><button type="button" class="archive-button" id="archive-toggle" aria-haspopup="dialog" aria-controls="weekly-archive">${library}<span class="archive-label">往期目录</span></button><button type="button" class="icon-button save-image edition-save" aria-label="保存图片" aria-haspopup="dialog" aria-controls="share" title="把这一版保存为图片">${imageDown}</button><a class="icon-button search-entry" href="${esc(prefix)}search/" aria-label="搜索日报、周报和资料库" title="搜索">${searchIcon}</a><button type="button" class="icon-button appearance-toggle" aria-label="明暗切换"></button></div></nav>` +
  `<nav class="group-nav" aria-label="本期版面"><div class="page-links">${nav}</div><div class="group-tools"><button type="button" class="save-image" aria-haspopup="dialog" aria-controls="share" title="把这一版保存为图片">${imageDown}<span>保存图片</span></button></div></nav>` +
  `<main id="content"><header class="heading"><div class="heading-top"><p class="kicker">${rank?'分群活跃成员':id==='external'?'本周资讯':'本周讨论'}</p>${groupRank}</div><h1>${esc(p.title)}</h1>${p.intro?`<p class="intro">${esc(p.intro)}</p>`:''}</header>${content}</main>` +
  `<footer class="footer"><span>AGENT HUB / 周报</span><span>讨论保留不同观点，分享注明各自出处。</span></footer></div>` +
  `<dialog class="share" id="share" aria-labelledby="share-title"><h2 id="share-title">保存${esc(p.label)}图片</h2><p>导览保留看点，全文按话题分图。</p><div class="dialog-actions"><button type="button" id="export-guide">下载导览图</button><button type="button" id="export-full">下载全文图</button><button type="button" id="close-share">关闭</button></div></dialog>` +
  `<dialog class="share weekly-archive" id="weekly-archive" aria-labelledby="archive-title"><h2 id="archive-title">往期目录</h2><nav aria-label="往期周报">${archive}</nav><div class="dialog-actions"><button type="button" id="close-archive">关闭</button></div></dialog>` +
  `<script id="weekly-data" type="application/json">${JSON.stringify(issue).replaceAll('<',String.fromCharCode(92)+'u003c')}</script><script src="${esc(asset('discussion-panel.js'))}"></script><script src="${esc(asset('weekly-reader.js'))}"></script>${views?`<script defer src="${esc(asset('views.js'))}" data-endpoint="${esc(feedbackEndpoint)}"></script>`:''}${publicBuild?`<script defer src="${esc(asset('analytics.js'))}"></script>`:''}</body></html>`;
return html;
}

export async function writeWeeklyPages(out, data) {
  const weeklies = data.weeklies || [];
  if (!weeklies.length) return;
  const assets = {};
  for (const file of ['weekly.css', 'weekly-reader.js', 'screenshot.js', 'appearance.js', 'color-scheme.css', 'discussion-panel.js', 'discussion-panel.css', ...(data.publicBuild ? ['analytics.js'] : []), ...(data.publicBuild && data.feedbackEndpoint ? ['views.js'] : []), ...new Set(weeklies.flatMap(issue => issue.rank?.groups.flatMap(group => group.leaders.map(leader => leader.avatar).filter(Boolean)) || []))]) {
    assets[file] = createHash('sha256').update(await readFile(path.join(out, file))).digest('hex').slice(0,16);
  }
  for (const issue of weeklies) {
    // The masthead already carries the week; the leaderboard needs no date-only intro.
    const pages = [...issue.pages, ...(issue.rank ? [{id:'rank',label:'周榜',title:'本期分群周榜',intro:''}] : [])];
    for (const page of pages) {
      const dailyDate = data.digests.findLast(d => d.date <= issue.end)?.date || data.digests.at(-1)?.date || issue.end;
      for (const [route, prefix] of [[weeklyRoute(issue,page.id),'../../../../'], [`weekly/${issue.id}/${page.id}/`,'../../../']]) {
        await mkdir(path.join(out,route), {recursive:true});
        await writeFile(path.join(out,route,'index.html'),renderWeeklyPage(issue,page,{prefix,weeklies,dailyDate,assets,publicBuild:data.publicBuild,feedbackEndpoint:data.feedbackEndpoint}));
      }
    }
  }
  // A stable /weekly/ entry for links that should always open the newest issue, on the same default page as the site nav.
  const latest = weeklies.at(-1);
  const target = weeklyRoute(latest, latest.pages.find(page => page.id === 'group-3')?.id || latest.pages[0].id).replace(/^weekly\//, '');
  await writeFile(path.join(out,'weekly','index.html'), `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="robots" content="${robots('weekly')}">
<meta http-equiv="refresh" content="0; url=${target}">
<link rel="canonical" href="${new URL(`weekly/${target}`, site).href}">
<title>AgentHub 周报</title>
</head>
<body><p><a href="${target}">打开最新一期周报</a></p></body>
</html>
`);
}
