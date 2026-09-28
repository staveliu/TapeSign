import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:18740',channel=process.env.PLAYWRIGHT_CHANNEL||'msedge';
const browser=await chromium.launch({headless:true,...(channel==='chromium'?{}:{channel})});
const routes=[['contract','create','#tab-create','#panel-create'],['contract','open','#tab-open','#panel-open'],['contract','history','#tab-history','#panel-history'],['notary','create','[data-notary-tab=create]','#notary-create'],['notary','search','[data-notary-tab=search]','#notary-search'],['notary','public','[data-notary-tab=public]','#notary-public']];
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],rpc=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/rpc/'))rpc.push(r.url());});
 await page.route('**/cache/**',r=>r.fulfill({json:{total:0,items:[],rows:[],scans:{},verification:{chain:'pending'},bundle:null}}));
 await page.goto(base+'/');await page.waitForSelector('#notary-submit',{state:'attached'});
 assert.equal(new URL(page.url()).hash,'#contract/create');
 assert.equal(await page.locator('#current-container-label').textContent(),'请先选择容器');
 assert.equal(await page.locator('#current-container-label').evaluate(el=>getComputedStyle(el).color),'rgb(192, 0, 0)');
 for(const [product,tab,selector,panel] of routes){
  await page.locator('#product-'+product).click();await page.locator(selector).click();assert.equal(new URL(page.url()).hash,'#'+product+'/'+tab);
  await page.reload();await page.waitForSelector(panel,{state:'visible'});assert.equal(await page.locator(selector).evaluate(el=>el.classList.contains('active')),true);assert.equal(new URL(page.url()).hash,'#'+product+'/'+tab);
 }
 await page.locator('[data-notary-tab=search]').click();await page.locator('[data-notary-tab=create]').click();await page.goBack();await page.waitForSelector('#notary-search',{state:'visible'});await page.goBack();await page.waitForSelector('#notary-public',{state:'visible'});await page.goForward();await page.waitForSelector('#notary-search',{state:'visible'});
 await page.locator('#product-contract').click();await page.locator('#tab-open').click();await page.locator('#product-notary').click();assert.equal(new URL(page.url()).hash,'#notary/search');await page.locator('#product-contract').click();assert.equal(new URL(page.url()).hash,'#contract/open');
 await page.evaluate(()=>location.hash='notary/public');await page.waitForSelector('#notary-public',{state:'visible'});await page.reload();await page.waitForSelector('#notary-public',{state:'visible'});
 const query='?chain=196&tx=0x'+'01'.repeat(32)+'&view=notary';await page.goto(base+'/'+query+'#notary/public');await page.waitForSelector('#notary-public',{state:'visible'});await page.locator('[data-notary-tab=search]').click();assert.equal(new URL(page.url()).search,query);await page.reload();await page.waitForSelector('#notary-search',{state:'visible'});
 await page.goto(base+'/?view=notary');await page.waitForSelector('#notary-create',{state:'visible'});assert.equal(new URL(page.url()).hash,'#notary/create');
 await page.goto(base+'/#notary/invalid');await page.waitForSelector('#panel-create',{state:'visible'});assert.equal(new URL(page.url()).hash,'#contract/create');
 await page.setViewportSize({width:390,height:844});
 const box=await page.locator('#current-container-label').boundingBox();assert.ok(box.x+box.width>350&&box.y<70,'Missing container warning belongs in upper right');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.evaluate(()=>localStorage.setItem('tapesign-v2:current-container',JSON.stringify('4.2.204.tape')));await page.reload();await page.waitForSelector('#notary-submit',{state:'attached'});assert.equal(await page.locator('#current-container-label').textContent(),'当前容器 4.2.204');assert.equal(await page.locator('#current-container-label').evaluate(el=>el.classList.contains('missing')),false);
 await page.evaluate(()=>localStorage.removeItem('tapesign-v2:current-container'));await page.reload();await page.waitForSelector('#notary-submit',{state:'attached'});assert.equal(await page.locator('#current-container-label').textContent(),'请先选择容器');assert.equal(await page.locator('#current-container-label').evaluate(el=>getComputedStyle(el).color),'rgb(192, 0, 0)');
 assert.deepEqual(errors,[]);assert.equal(rpc.length,0);console.log('Navigation browser checks passed: all six tab hashes and refresh, history back/forward, direct anchors, legacy view query, query preservation, selected/unselected container warning and mobile upper-right layout. No chain or wallet requests.');
}finally{await browser.close();}
