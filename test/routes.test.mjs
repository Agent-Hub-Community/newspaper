import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../site/routes.js', import.meta.url), 'utf8');
function harness(href, prefix='./') {
  let url = new URL(href);
  const context = {
    URL, window:{}, document:{querySelector:()=>({content:prefix}),querySelectorAll:()=>[]},
    history:Object.fromEntries(['pushState','replaceState'].map(method=>[method,(_,__,next)=>{url=new URL(next,url);}])),
  };
  Object.defineProperty(context,'location',{get:()=>url});
  vm.runInNewContext(source,context);
  return { routes:context.window.AgentHubRoutes, url:()=>url };
}
test('path routes use the project prefix and keep filters and anchors separate',()=>{
  const {routes,url}=harness('https://example.com/agent_hub/daily/2026-09-27/group-2/?skin=default#topic-3','../../../');
  assert.equal(routes.read().page,'group-2');
  assert.equal(routes.read().anchor,'#topic-3');
  routes.write('rank','month');
  assert.equal(url().href,'https://example.com/agent_hub/rank/month/?skin=default');
  assert.equal(routes.asset('avatars/member-001.jpg'),'https://example.com/agent_hub/avatars/member-001.jpg');
});
test('legacy routes accept both historical forms without treating normal anchors as routes',()=>{
  for(const hash of ['#digest/2026-09-27/group-3','#/digest/2026-09-27/group-3']){
    const {routes,url}=harness(`https://example.com/agent_hub/${hash}`);
    const route=routes.read();
    assert.equal(route.id,'2026-09-27');
    routes.write(route.mode,route.id,route.page,{replace:true});
    assert.equal(url().pathname,'/agent_hub/daily/2026-09-27/group-3/');
    assert.equal(url().hash,'');
  }
  assert.equal(harness('https://example.com/#reading').routes.read().legacy,false);
  assert.equal(harness('https://example.com/#digest/%E0%A4%A').routes.read().id,'');
});
test('file preview keeps hash navigation and resolves assets against its fixed root',()=>{
  const {routes,url}=harness('file:///tmp/site/daily/2026-09-27/group-3/index.html','../../../');
  routes.write('rank','week');
  assert.equal(url().hash,'#rank/week');
  assert.equal(routes.asset('export-images.js'),'file:///tmp/site/export-images.js');
});
test('fourth-group path, legacy and offline routes retain the skin preview', () => {
  for (const href of [
    'https://example.com/agent_hub/?skin=national-day#digest/2026-09-30/group-4',
    'file:///tmp/site/index.html?skin=national-day#digest/2026-09-30/group-4',
  ]) {
    const { routes, url } = harness(href);
    const route = routes.read();
    assert.equal(route.page, 'group-4');
    routes.write(route.mode, route.id, route.page, { replace: true });
    assert.equal(url().search, '?skin=national-day');
    assert.equal(routes.read().page, 'group-4');
  }
  const { routes } = harness('https://example.com/agent_hub/daily/2026-09-30/group-4/', '../../../');
  assert.equal(routes.read().page, 'group-4');
  assert.equal(routes.asset('skins/national-day/fireworks.png'), 'https://example.com/agent_hub/skins/national-day/fireworks.png');
});
test('weekly routes use separate dates and preserve historical IDs', () => {
  const {routes,url}=harness('https://example.com/agent_hub/weekly/2026-10-05/2026-10-11/group-4/#topic-2','../../../../');
  assert.equal(routes.read().id,'2026-10-05_2026-10-11');
  assert.equal(routes.read().page,'group-4');
  assert.equal(routes.read().anchor,'#topic-2');
  assert.equal(routes.href('weekly','2026-10-05_2026-10-11','rank'),'https://example.com/agent_hub/weekly/2026-10-05/2026-10-11/rank/');
  routes.write('digest','2026-10-11','group-4');
  assert.equal(url().pathname,'/agent_hub/daily/2026-10-11/group-4/');
  const old=harness('https://example.com/agent_hub/weekly/2026-09-28_2026-10-04/group-3/','../../../');
  assert.equal(old.routes.read().id,'2026-09-28_2026-10-04');
});
