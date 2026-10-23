import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { basePath } from '../lib/site.mjs';
const base=process.env.AGENT_HUB_SITE_URL || `http://127.0.0.1:4175${basePath}`;
const date='2026-09-27';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
await mkdir('output/playwright/path-routing',{recursive:true});
try{
  for(const width of [390,1440]){
    const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce'});
    const errors=[],failed=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.status()>=400)failed.push(r.url());});
    for(const route of [`daily/${date}/group-1/`,`daily/${date}/group-2/`,`daily/${date}/group-3/`,`daily/${date}/external/`,'rank/week/','rank/month/','rank/all/']){
      assert.equal((await page.goto(base+route)).status(),200);
      await page.locator('#reading > *').first().waitFor();
      assert.equal(new URL(page.url()).pathname,new URL(base+route).pathname);
      await page.reload();
      await page.locator('#reading > *').first().waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      await page.locator('img[src]:not([src=""])').evaluateAll(ns=>Promise.all(ns.map(n=>n.decode())));
    }
    await page.goto(`${base}#digest/${date}/group-3`);
    await page.waitForURL(`${base}daily/${date}/group-3/`);
    await page.getByRole('tab',{name:'二群',exact:false}).click();
    await page.waitForURL(`${base}daily/${date}/group-2/`);
    await page.goBack();
    await page.waitForURL(`${base}daily/${date}/group-3/`);
    assert.equal(await page.locator('#reading').getAttribute('data-page'),'group-3');
    await page.goForward();
    await page.waitForURL(`${base}daily/${date}/group-2/`);
    await page.goto(`${base}daily/${date}/group-3/?skin=default#topic-4`);
    await page.locator('#topic-4').waitFor();
    assert.equal(new URL(page.url()).hash,'#topic-4');
    assert.equal(await page.locator('#topic-4').evaluate(n=>n.getBoundingClientRect().top>=-1&&n.getBoundingClientRect().top<innerHeight),true);
    assert.equal(await page.locator('.brief').count(),5);
    await page.screenshot({path:`output/playwright/path-routing/anchor-${width}.png`});
    await page.evaluate(()=>location.hash='#reading');
    assert.equal(await page.locator('#reading').getAttribute('data-page'),'group-3');
    await page.getByRole('tab',{name:'二群',exact:false}).click();
    assert.equal(new URL(page.url()).search,'?skin=default');
    assert.equal(new URL(page.url()).hash,'');
    // Issues step from the archive the masthead date opens.
    const step = async label => { await page.locator('#date-picker').click(); await page.locator('#archive-pagination button', { hasText: label }).click(); };
    await step('上一期');
    await page.waitForURL(`${base}daily/2026-09-26/group-2/?skin=default`);
    await step('下一期');
    await page.waitForURL(`${base}daily/${date}/group-2/?skin=default`);
    await page.goto(`${base}#rank/month`);
    await page.waitForURL(`${base}rank/month/`);
    await page.locator('[data-rank="week"]').click();
    await page.waitForURL(`${base}rank/week/`);
    await page.goBack();
    await page.waitForURL(`${base}rank/month/`);
    await page.goto(`${base}daily/${date}/group-3/`);
    await page.screenshot({path:`output/playwright/path-routing/daily-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'保存图片',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#share-image')?.naturalWidth>0,null,{timeout:60000});
    assert.deepEqual(errors,[]);
    assert.deepEqual(failed,[]);
    assert.equal((await page.goto(`${base}daily/2099-01-01/group-1/`)).status(),404);
    assert.equal(await page.locator('h1').innerText(),'这一页不存在');
    await page.close();
    console.log(`${width}px: direct paths/reload, legacy links, history, date navigation, anchors, queries, assets, export and real 404 passed`);
  }
}finally{await browser.close();}
