import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const channel=process.env.PLAYWRIGHT_CHANNEL||'msedge';
const browser=await chromium.launch({headless:true,...(channel==='chromium'?{}:{channel})});
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:18740';
const release={release:'0x'+'ab'.repeat(32),site:'4.2.204.tape',versionPath:'client-test.html',files:[{path:'index.html',size:10}],transactions:[]};
const pre={identity:{container:'0x'+'11'.repeat(20),holder:'0x'+'22'.repeat(20),chainId:'196'},opened:true,siteLive:false,containerLive:false,nameLive:false,paidUntil:'0',block:{number:'100'}};
let planFails=false,planCalls=0;
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/src/rpc.js*',r=>r.fulfill({contentType:'text/javascript',body:"export const config={};export const context=()=>{throw Error('Unexpected chain read');};export const sendTransaction=()=>{throw Error('No live transactions allowed');};"}));
  await page.route('**/api/**',r=>{
    const route=new URL(r.request().url()).pathname;
    if(route==='/api/plan'){planCalls++;if(planFails)return r.fulfill({status:400,json:{error:'Independent RPC disagreement'}});return r.fulfill({json:{...release,...pre}});}
    if(route==='/api/release')return r.fulfill({json:release});
    if(route==='/api/preflight')return r.fulfill({json:pre});
    if(route==='/api/file-status')return r.fulfill({json:{complete:true,release:release.release}});
    throw Error('Unexpected local route '+route);
  });
  await page.goto(base+'/publish.html');await page.waitForFunction(()=>!document.querySelector('#inspect').disabled);
  await page.locator('#inspect').click();await page.waitForFunction(()=>!document.querySelector('#publish').disabled);
  assert.match(await page.locator('#subscription').textContent(),/可上传文件/);
  assert.match(await page.locator('#subscription').textContent(),/官方网关暂不能展示/);
  assert.equal(JSON.parse(await page.locator('#release').textContent()).siteLive,false);
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#publish').click();await page.waitForFunction(()=>!document.querySelector('#inspect').disabled);assert.equal(planCalls,2);
  await page.locator('#verify').click();await page.waitForFunction(()=>!document.querySelector('#result').hidden);
  assert.match(await page.locator('#status').textContent(),/链上文件已通过最终回读核验/);
  assert.match(await page.locator('#status').textContent(),/官方网关暂不能展示/);
  pre.siteLive=true;pre.containerLive=true;
  await page.locator('#verify').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('网站订阅有效'));
  planFails=true;await page.locator('#inspect').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Independent RPC disagreement'));
  assert.equal(await page.locator('#publish').isDisabled(),true);assert.deepEqual(errors,[]);
  console.log('Publication UI passed: unpaid uploads allowed, explicit gateway status, paid state, invalidated stale plan. No wallet transactions.');
}finally{await browser.close();}
