import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const mode = process.argv[2] || 'baseline';
if (!['baseline', 'candidate', 'candidate-baseline-ranker'].includes(mode)) throw new Error('Use baseline, candidate or candidate-baseline-ranker');
const read = file => readFile(path.join(here, file), 'utf8');
const lock = JSON.parse(await read('freeze.json'));
const hash = value => createHash('sha256').update(value).digest('hex');
for (const [file, expected] of Object.entries(lock.hashes)) {
  if (hash(await readFile(path.join(here, file))) !== expected) throw new Error(`Frozen file changed: ${file}`);
}
for (const [file, expected] of Object.entries(lock.source_hashes || {})) {
  if (hash(await readFile(path.join(root, file))) !== expected) throw new Error(`Content changed; not comparable: ${file}`);
}
const corpus = JSON.parse(await read('corpus.json'));
const cases = JSON.parse(await read('cases.json')).cases;
let catalog;
const moduleRoot = mode === 'baseline' ? './baseline-src/' : '../../';
const { createLibrarySearch } = await import(moduleRoot + 'feedback/library-search.mjs');
const { agentReads } = await import(moduleRoot + 'feedback/agent-reads.mjs');
const library = mode === 'baseline' ? corpus.library
  : JSON.parse(await readFile(path.join(root, 'dist/library/resources.json'), 'utf8'));
if (library.items.length !== corpus.library.items.length || library.items.some(x => !corpus.library.items.some(y => x.id === y.id))) {
  throw new Error('Candidate library item set differs from frozen corpus');
}
if (mode !== 'baseline') {
  catalog = JSON.parse(await readFile(path.join(root, 'dist/search/catalog.json'), 'utf8'));
  const baselineUrls = corpus.search.entries.map(x => 'https://hqhq1025.github.io/agent_hub/' + x.u).sort();
  const candidateUrls = catalog.entries.map(x => x.url).sort();
  if (JSON.stringify(baselineUrls) !== JSON.stringify(candidateUrls)) throw new Error('Candidate search coverage differs from frozen corpus');
}
const requests = [];
const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) } };
async function fetchFixture(url) {
  const key = url.slice('https://hqhq1025.github.io/agent_hub/'.length);
  if (key === 'library/resources.json') return Response.json(library);
  if (key === 'search/catalog.json' && catalog) return Response.json(catalog);
  let content = corpus.documents[key];
  if (mode !== 'baseline' && content === undefined && key.startsWith('agents/topics/')) {
    try { content = await readFile(path.join(root, 'dist', key), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (content === undefined) return new Response('Not found', { status: 404 });
  return new Response(content, { headers: { 'Content-Type': key.endsWith('.json') ? 'application/json' : 'text/markdown' } });
}
const createContent = mode !== 'baseline' ? (await import('../../feedback/content-api.mjs')).createContentAPI : null;
if (mode === 'candidate-baseline-ranker') {
  // Query.createSearcher resolves the global index at construction and variants on each query.
  // Import after all candidate modules, before handlers construct their indexes.
  await import('./baseline-src/bm25.js');
}
const libraryHandler = createLibrarySearch(fetchFixture, () => 0);
const contentHandler = createContent ? createContent(fetchFixture, () => 0) : null;
const origin = 'https://agenthub-feedback.haoqingeric.workers.dev';
async function call(relative) {
  const url = relative.startsWith('https://') ? relative : origin + relative;
  const request = new Request(url, { headers: { 'User-Agent': 'AgentHub-TinyBench/1' } });
  const pathname = new URL(url).pathname;
  const begin = performance.now();
  let response;
  if (pathname === '/library/search') response = await libraryHandler(request, env);
  else if (pathname.startsWith('/read/')) response = await agentReads(request, env, fetchFixture);
  else if (contentHandler) response = await contentHandler(request, env);
  else { requests.push({ url, unsupported: true, bytes: 0, local_ms: 0 }); return { status: null, unsupported: true }; }
  const text = await response.text();
  requests.push({ url, category: pathname.startsWith('/read/') ? 'read' : pathname.endsWith('/item') ? 'detail' : pathname.endsWith('/editions') ? 'discovery' : 'search',
    status: response.status, bytes: Buffer.byteLength(text), local_ms: performance.now() - begin });
  let json; try { json = JSON.parse(text); } catch {}
  return { status: response.status, text, json };
}
const query = value => new URLSearchParams(value).toString();
const id = item => item.id.replace(/^library:/, '');
function relevance(items, c) {
  const top = items.slice(0, 5);
  const gains = top.map(x => c.strong?.includes(id(x)) || c.strong_url?.some(u => x.url?.endsWith(u)) ? 2
    : c.adjacent?.includes(id(x)) ? 1 : 0);
  const rank = gains.indexOf(2) + 1;
  const dcg = gains.reduce((n, g, i) => n + (2 ** g - 1) / Math.log2(i + 2), 0);
  const ideal = [...(c.strong || c.strong_url || []).map(() => 2), ...(c.adjacent || []).map(() => 1)].sort((a,b)=>b-a).slice(0,5);
  const denominator = ideal.reduce((n,g,i)=>n+(2**g-1)/Math.log2(i+2),0);
  return { hit_at_5: rank > 0, mrr_at_5: rank ? 1 / rank : 0, ndcg_at_5: denominator ? dcg / denominator : 0,
    top_ids: top.map(id), top_titles: top.map(x => x.title), gains };
}
const results = [];
for (const c of cases) {
  const firstRequest = requests.length;
  let success = false, detail = {}, response;
  if (['library', 'content'].includes(c.mode)) {
    response = await call(c.mode === 'library' ? '/library/search?' + query({ q: c.q, limit: 5 })
      : '/content/search?' + query(Object.fromEntries(Object.entries({ q:c.q, kind:c.kind, group:c.group, from:c.from, to:c.to, limit:5 }).filter(([,v])=>v))));
    detail = relevance(response.json?.items || [], c);
    success = response.status === 200 && detail.hit_at_5;
    if (success && c.mode === 'library') success = response.json.items.slice(0,5).some(x => c.strong.includes(id(x)) && x.links?.length && x.url);
    if (success && c.mode === 'content') {
      const hit = response.json.items.find(x => c.strong_url.some(u => x.url.endsWith(u)));
      const read = await call(hit.read_url);
      success = read.status === 200 && read.text.includes(hit.title);
    }
  } else if (c.mode === 'keyword' || c.mode === 'filter' || c.mode === 'pagination') {
    const params = c.mode === 'keyword' ? { keyword:c.keyword } : c.mode === 'filter' ? { type:c.type,topic:c.topic } : {};
    const seen=[]; let offset=0, guard=0;
    do {
      response=await call('/library/search?'+query({...params,limit:20,offset}));
      if(response.status!==200)break;
      seen.push(...response.json.items.map(id));offset=response.json.next_offset;
    } while(offset!==null&&++guard<20);
    const expected=corpus.library.items.filter(x => c.mode==='keyword' ? x.keywords.includes(c.canonical)
      : c.mode==='filter' ? x.type===c.type && x.topics.includes(c.topic) : true).map(x=>x.id);
    success=response.status===200 && seen.length===expected.length && new Set(seen).size===expected.length && expected.every(x=>seen.includes(x));
    detail={returned:seen.length,expected:expected.length,duplicates:seen.length-new Set(seen).size};
  } else if(c.mode==='empty') {
    response=await call('/library/search?'+query({q:c.q,limit:5}));success=response.status===200&&response.json.total===0;
    detail={false_positive_items:response.json?.total??null};
  } else if(c.mode==='association') {
    response=mode==='baseline' ? await call('/library/search?'+query({q:'与大模型合写论文',limit:5}))
      : await call('/content/item?'+query({id:'library:'+c.resource}));
    const item=mode==='baseline' ? response.json?.items.find(x=>id(x)===c.resource) : response.json?.item;
    const discussion=item?.discussions?.find(x=>x.url?.endsWith(c.expected_url));
    if(discussion){const read=await call(discussion.read_url);success=read.status===200&&read.text.includes('科研方向与领域数据');}
    detail={discussion_found:!!discussion,returned_discussions:item?.discussions?.length??0};
  } else if(c.mode==='topic-read') {
    let read;
    if(mode==='baseline') read=await call('/read/'+c.baseline_path);
    else {
      response=await call('/content/search?'+query({q:'科研绘图',kind:'daily',group:'group-4',from:'2026-10-14',to:'2026-10-14',limit:5}));
      const hit=response.json?.items.find(x=>x.url.endsWith(c.expected_url));
      if(hit)read=await call(hit.read_url);
    }
    success=read?.status===200 && c.expected_text.every(x=>read.text.includes(x)) && !read.text.includes(c.forbidden_text);
    detail={contains_required:c.expected_text.every(x=>read?.text?.includes(x)),contains_unrelated:!!read?.text?.includes(c.forbidden_text)};
  } else if(c.mode==='editions') {
    response=await call('/content/editions?kind=daily&limit=3');
    const latest=response.json?.latest?.daily;
    detail={latest:typeof latest==='string'?latest:latest?.date};success=response.status===200&&detail.latest===c.expected_latest;
  } else if(c.mode==='detail') {
    response=await call('/content/item?'+query({id:'library:'+c.resource}));
    success=response.status===200&&response.json?.item.links?.some(x=>x.url===c.expected_link);
    detail={original_link_found:success};
  }
  const taskRequests=requests.slice(firstRequest);
  const actual=taskRequests.filter(x=>!x.unsupported);
  results.push({id:c.id,mode:c.mode,task:c.task,success,unsupported:taskRequests.some(x=>x.unsupported),...detail,
    unsupported_attempts:taskRequests.filter(x=>x.unsupported).length,requests:actual.length,
    payload_bytes:Object.fromEntries(['search','read','detail','discovery'].map(k=>[k,actual.filter(x=>x.category===k).reduce((n,x)=>n+x.bytes,0)])),
    response_bytes:actual.reduce((n,x)=>n+x.bytes,0),local_ms:actual.reduce((n,x)=>n+x.local_ms,0),http:taskRequests});
}
const retrieval=results.filter(x=>x.hit_at_5!==undefined);
const mean=(rows,key)=>rows.reduce((n,x)=>n+Number(x[key]),0)/rows.length;
const libraryQueries=retrieval.filter(x=>x.mode==='library'), contentQueries=retrieval.filter(x=>x.mode==='content');
const capability=results.filter(x=>['association','content','topic-read','editions','detail'].includes(x.mode));
const report={protocol_version:'1.1',mode,source_sha:lock.source_sha,corpus_hash:lock.hashes['corpus.json'],cases_hash:lock.hashes['cases.json'],
  metrics:{fixed_api_flow_pass_rate:results.filter(x=>x.success).length/results.length,successful_tasks:results.filter(x=>x.success).length,total_tasks:results.length,
    retrieval_queries:retrieval.length,hit_at_5:mean(retrieval,'hit_at_5'),mrr_at_5:mean(retrieval,'mrr_at_5'),ndcg_at_5:mean(retrieval,'ndcg_at_5'),
    library_quality:{queries:libraryQueries.length,hit_at_5:mean(libraryQueries,'hit_at_5'),mrr_at_5:mean(libraryQueries,'mrr_at_5'),ndcg_at_5:mean(libraryQueries,'ndcg_at_5')},
    content_quality:{queries:contentQueries.length,hit_at_5:mean(contentQueries,'hit_at_5'),mrr_at_5:mean(contentQueries,'mrr_at_5'),ndcg_at_5:mean(contentQueries,'ndcg_at_5')},
    capability_cases:capability.length,capability_passed:capability.filter(x=>x.success).length,unsupported_tasks:results.filter(x=>x.unsupported).length,
    total_response_bytes:results.reduce((n,x)=>n+x.response_bytes,0),local_ms:results.reduce((n,x)=>n+x.local_ms,0)},results};
await writeFile(path.join(here,mode+'.json'),JSON.stringify(report,null,2)+'\n');
const md=`# ${mode} tiny bench\n\nSource ${lock.source_sha}; corpus ${report.corpus_hash}; cases ${report.cases_hash}.\n\n`
  +`Fixed API flow pass rate ${report.metrics.successful_tasks}/${results.length}; known-answer Hit@5 ${(100*report.metrics.hit_at_5).toFixed(1)}%; MRR@5 ${report.metrics.mrr_at_5.toFixed(3)}; nDCG@5 ${report.metrics.ndcg_at_5.toFixed(3)}.\n\n`
  +`Existing library quality (${libraryQueries.length} queries): Hit@5 ${(100*report.metrics.library_quality.hit_at_5).toFixed(1)}%; MRR@5 ${report.metrics.library_quality.mrr_at_5.toFixed(3)}; nDCG@5 ${report.metrics.library_quality.ndcg_at_5.toFixed(3)}. Capability cases ${report.metrics.capability_passed}/${capability.length}.\n\n`
  +'| Case | Success | Unsupported | Requests | Bytes | Local ms |\n|---|---:|---:|---:|---:|---:|\n'
  +results.map(x=>`| ${x.id} | ${x.success} | ${x.unsupported} | ${x.requests} | ${x.response_bytes} | ${x.local_ms.toFixed(2)} |`).join('\n')+'\n\nQuality uses known gold, not exhaustive relevance judgments. Local ms excludes network and is diagnostic only. The deterministic API flow pass rate is not open-ended user or agent task success: legacy whole-file reads can sometimes complete the same user task. Unsupported attempts are not HTTP requests. Per-case JSON separates search, read, detail and discovery bytes.\n';
await writeFile(path.join(here,mode+'.md'),md);
console.log(JSON.stringify(report.metrics,null,2));
