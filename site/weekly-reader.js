const issue=JSON.parse(document.getElementById('weekly-data').textContent);
window.WEEKLY_READER=issue;
const archive=document.getElementById('weekly-archive');
const archiveOpener=document.getElementById('archive-toggle');
// The week in the masthead opens the archive too, as the daily date does; phones only have that one.
let opener=archiveOpener;
for(const button of [archiveOpener,document.getElementById('period-toggle')])button.onclick=()=>{opener=button;archive.showModal();};
document.getElementById('close-archive').onclick=()=>archive.close();
archive.addEventListener('close',()=>opener.focus({preventScroll:true}));
for(const modal of document.querySelectorAll('dialog.share'))modal.addEventListener('click',event=>{
  if(event.target!==modal)return;
  const rect=modal.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)modal.close();
});
const dialog=document.querySelector('#share');
// The toolbar button and the compact header's icon open the same dialog.
for(const button of document.querySelectorAll('.save-image'))button.onclick=()=>dialog.showModal();
document.querySelector('#close-share').onclick=()=>dialog.close();
// Section switcher modal: one-tap jump across all sections on phones and desktop.
const switcher=document.getElementById('section-switcher');
const switcherOpener=document.getElementById('switcher-toggle');
if(switcher&&switcherOpener){
  switcherOpener.onclick=()=>switcher.showModal();
  document.getElementById('close-switcher')?.addEventListener('click',()=>switcher.close());
  switcher.addEventListener('close',()=>switcherOpener.focus({preventScroll:true}));
}
// Keyboard ArrowLeft / ArrowRight navigate between adjacent sections when no dialog or input is active.
document.addEventListener('keydown',event=>{
  if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
  if(document.querySelector('dialog[open]'))return;
  const tag=document.activeElement?.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||document.activeElement?.isContentEditable)return;
  if(event.key==='ArrowLeft'){
    const prev=document.querySelector('.relay-card[data-relay="prev"]');
    if(prev){event.preventDefault();prev.click();}
  }else if(event.key==='ArrowRight'){
    const next=document.querySelector('.relay-card[data-relay="next"]');
    if(next){event.preventDefault();next.click();}
  }
});
// "回到目录" lands on the collapsed list; open it so the reader can pick the next topic.
const directory=document.getElementById('directory');
for(const link of document.querySelectorAll('.back-top'))link.addEventListener('click',()=>{if(directory)directory.open=true;});
// Keep the active section tab centered inside the horizontal scroll bar on narrow viewports.
const activeTab=document.querySelector('.page-links [aria-current="page"]');
if(activeTab&&activeTab.parentElement.scrollWidth>activeTab.parentElement.clientWidth){
  const bar=activeTab.parentElement;
  bar.scrollLeft=Math.max(0,activeTab.offsetLeft-(bar.clientWidth-activeTab.offsetWidth)/2);
}
const esc=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const page=issue.pages.find(p=>p.id===document.body.dataset.page);
AgentHubDiscussion.configure(page?.stories?.some(story=>story.discussion?.length)?{
  section:page.label,back:'周报',total:page.stories.length,
  topic:index=>{const s=page.stories[index];return s?.discussion?.length?{title:s.title,messages:s.discussion,text:s.text,emphasis:s.emphasis,comment:s.review,resources:s.resources}:null;},
}:null);
// The capture library is only needed after a reader asks for an image.
let screenshotLibrary;
function loadScreenshot(){
  if(window.modernScreenshot)return Promise.resolve(window.modernScreenshot);
  return screenshotLibrary??=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=document.querySelector('meta[name="agenthub-screenshot"]').content;
    script.onload=()=>resolve(window.modernScreenshot);
    script.onerror=()=>{screenshotLibrary=null;script.remove();reject(new Error('Screenshot library unavailable'));};
    document.head.append(script);
  });
}
const guideParagraphs=[...document.querySelectorAll('.story .prose > p:first-child')];
async function download(blobs){for(const [i,blob]of blobs.entries()){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`AgentHub周报-${issue.id}-${page?.label||'周榜'}-${i+1}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);await new Promise(r=>setTimeout(r,200));}}
document.querySelector('#export-guide').onclick=async function(){this.disabled=true;this.textContent='生成中…';try{const capture=await loadScreenshot();const stories=page?.stories||[];const groups=[];for(let i=0;i<stories.length;i+=8)groups.push(stories.slice(i,i+8));if(!groups.length)groups.push([]);const blobs=[];for(const [i,chunk]of groups.entries()){const sheet=document.createElement('section');sheet.className='export-sheet';sheet.innerHTML=`<div class="sheet-top">AgentHub 周报 · ${issue.label} · ${page?.label||'周榜'} · 导览 ${i+1}/${groups.length}</div><h1>${esc(page?.title||'本期分群周榜')}</h1>${chunk.map((story,j)=>`<article class="export-story"><h2>${esc(story.title)}</h2>${guideParagraphs[i*8+j].outerHTML}</article>`).join('')}<p class="sheet-footer">完整正文、原话与资料见网页</p>`;if(!page)sheet.innerHTML+=document.querySelector('.ranks').outerHTML;document.body.append(sheet);try{blobs.push(await capture.domToBlob(sheet,{width:1080,scale:1,backgroundColor:'#fdfdfb',font:false}));}finally{sheet.remove();}}await download(blobs);this.textContent=`已下载 ${blobs.length} 张导览图`;}catch(e){this.textContent='生成失败，可重试';console.error(e);}finally{this.disabled=false;}};
document.querySelector('#export-full').onclick=async function(){this.disabled=true;this.textContent='生成中…';try{const capture=await loadScreenshot();const articles=[...document.querySelectorAll('.story,.rank-card,.overview-card')];const blobs=[];for(const [i,article]of articles.entries()){const sheet=document.createElement('section');sheet.className='export-sheet';sheet.innerHTML=`<div class="sheet-top">AgentHub 周报 · ${issue.label} · ${page?.label||(document.body.dataset.page==='overview'?'总览':'周榜')} · 全文 ${i+1}/${articles.length}</div>`;const clone=article.cloneNode(true);clone.classList.remove('is-compact');clone.querySelector('.story-toggle')?.remove();clone.querySelector('.story-actions')?.remove();const story=page?.stories?.[Number(article.id.replace('topic-',''))-1];if(story?.discussion?.length){const source=document.createElement('section');source.className='export-discussion';source.innerHTML=`<h3>原始讨论 · ${story.discussion.length} 条</h3>${AgentHubDiscussion.renderList(story.discussion,`export-${article.id}`)}`;clone.append(source);}sheet.append(clone);document.body.append(sheet);try{blobs.push(await capture.domToBlob(sheet,{width:1080,scale:1,backgroundColor:'#fdfdfb',font:false}));}finally{sheet.remove();}}await download(blobs);this.textContent=`已下载 ${blobs.length} 张全文图`;}catch(e){this.textContent='生成失败，可重试';console.error(e);}finally{this.disabled=false;}};
