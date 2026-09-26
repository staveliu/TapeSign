import {chromium} from 'playwright';
import {browserOptions,testBase} from './browser.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {fixture,hash} from '../test/fixture.mjs';
import {documentId} from '../src/protocol.js';
import {historyRow} from '../src/history.js';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const f=await fixture({crossChain:true}),base=testBase;
const offer={record:f.offer,location:f.offerLocation,block:{number:'101'}},acceptance={record:f.accept,location:f.acceptLocation,block:{number:'102'}},seal={record:f.seal,location:f.sealLocation,block:{number:'103'}};
const first={id:documentId(f.doc),doc:f.doc,offer,selected:f.offerLocation,status:'invited',ready:true,finalized:true};
const second={...first,acceptance,selected:f.acceptLocation,status:'signed'},third={...second,seal,selected:f.sealLocation,status:'sealed'};
const rows=[historyRow(f.offer,f.offerLocation),historyRow(f.accept,f.acceptLocation,f.doc),historyRow(f.seal,f.sealLocation)];
const mock=`
const data=${JSON.stringify({f,first,second,third,rows})};
export const release=data.f.doc.client.release;
export async function connect(){throw Error('Wallet must not be opened');}
export async function createDocument(){throw Error('Not used');}
export async function publishOffer(){throw Error('No transactions allowed');}
export const publishAcceptance=publishOffer,publishSeal=publishOffer;
export async function resolveIdentity(){return data.f.doc.parties.A;}
export const exportBundle=JSON.stringify;
export async function loadContract(loc){
  window.reads=(window.reads||[]);window.reads.push(loc.tx);
  if(window.deferReads)await new Promise(r=>window.finishRead=r);
  if(window.failReads)throw Object.assign(Error('RPC offline'),{code:'RPC_UNAVAILABLE'});
  return loc.tx===data.f.sealLocation.tx?data.third:loc.tx===data.f.acceptLocation.tx?data.second:data.first;
}
export async function syncIndex(identity,options){
  window.scoped=options?.inboxOnly;window.scanChains=options?.chains;
  return {rows:window.directSigned?[data.rows[1]]:[],progress:[],pending:[],errors:[]};
}
`;
const browser=await chromium.launch(browserOptions());
const errors=[];
async function setup({stage=1,offline=false}={}){
  const page=await browser.newPage(),state={stage,offline};
  page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
  await page.route(/\/src\/client\.js(?:\?.*)?$/,r=>r.fulfill({contentType:'text/javascript',body:mock}));
  await page.route('**/cache/**',async r=>{
    if(state.offline)return r.abort('failed');
    const url=new URL(r.request().url());
    let body={queued:true};
    if(url.pathname.includes('/latest/')||url.pathname.includes('/transaction/'))body={bundle:state.bad||[null,first,second,third][state.stage]};
    if(url.pathname.endsWith('/contracts'))body={rows:rows.slice(0,state.stage)};
    await r.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  return {page,state};
}
const link=base+'/?chain=196&tx='+f.offerLocation.tx;
try{
  // Original offer opens its already-existing acceptance; no returned link.
  const initial=await setup({stage:2});await initial.page.goto(link);await initial.page.waitForSelector('#seal');
  assert.equal(await initial.page.locator('#existing-signatures canvas').count(),2);
  assert.equal(await initial.page.locator('#sign-panel').isVisible(),false);
  assert.deepEqual(await initial.page.evaluate(()=>window.reads),[f.acceptLocation.tx]);
  // Unchanged polling preserves hand drawing and agreement. New acceptance replaces it.
  const {page,state}=await setup();await page.goto(link);await page.waitForSelector('#sign-panel');
  await page.locator('#signature').scrollIntoViewIfNeeded();const box=await page.locator('#signature').boundingBox();
  await page.mouse.move(box.x+30,box.y+40);await page.mouse.down();await page.mouse.move(box.x+110,box.y+75,{steps:5});await page.mouse.up();await page.locator('#agree').check();
  const ink=await page.locator('#signature').evaluate(c=>c.toDataURL());
  await page.clock.fastForward(10000);assert.equal(await page.locator('#signature').evaluate(c=>c.toDataURL()),ink);assert.equal(await page.locator('#agree').isChecked(),true);
  state.stage=2;await page.clock.fastForward(10000);await page.waitForSelector('#seal');
  assert.equal(await page.locator('#existing-signatures canvas').count(),2);assert.equal(await page.locator('#sign-panel').isVisible(),false);
  state.stage=3;await page.clock.fastForward(10000);await page.waitForFunction(()=>document.querySelector('#contract-status').textContent.includes('链上归档'));
  await page.locator('#tab-history').click();await page.locator('#history-container').fill(f.doc.parties.A.name);await page.locator('#sync').click();
  await page.waitForFunction(()=>document.querySelector('#history-list').textContent.includes('已归档'));assert.equal(await page.locator('.history-row').count(),1);
  // Original invitation remains open while cache gains acceptance, history updates without click.
  const history=await setup();await history.page.goto(base);await history.page.locator('#tab-history').click();await history.page.locator('#history-container').fill(f.doc.parties.A.name);await history.page.locator('#sync').click();
  await history.page.waitForFunction(()=>document.querySelector('#history-list').textContent.includes('待对方签署'));history.state.stage=2;await history.page.clock.fastForward(10000);
  await history.page.waitForFunction(()=>document.querySelector('#history-list').textContent.includes('双方已签署'));assert.equal(await history.page.locator('.history-row').count(),1);
  // Cache outage still discovers the cross-chain acceptance via scoped inbox.
  const fallback=await setup({offline:true});await fallback.page.addInitScript(()=>window.directSigned=true);await fallback.page.goto(link);await fallback.page.clock.fastForward(1);await fallback.page.waitForSelector('#seal');
  assert.equal(await fallback.page.evaluate(()=>window.scoped),true);assert.deepEqual(await fallback.page.evaluate(()=>window.scanChains),['56']);
  // Cache can neither substitute another offer nor claim verification succeeded.
  const forged=await setup();forged.state.bad=structuredClone(second);forged.state.bad.offer.location.tx=hash(999);
  await forged.page.goto(link);await forged.page.waitForSelector('#sign-panel');assert.equal(await forged.page.locator('#seal').count(),0);assert.equal(await forged.page.locator('#existing-signatures canvas').count(),1);
  const waiting=await setup({stage:2});await waiting.page.addInitScript(()=>window.deferReads=true);await waiting.page.goto(link);await waiting.page.waitForFunction(()=>typeof window.finishRead==='function');
  assert.equal(await waiting.page.locator('#seal').count(),0);assert.equal(await waiting.page.locator('#export').isVisible(),false);
  await waiting.page.evaluate(()=>window.finishRead());await waiting.page.waitForSelector('#seal');
  // Navigating away during background verification must not restore the open tab.
  const stale=await setup();await stale.page.goto(link);await stale.page.waitForSelector('#sign-panel');await stale.page.clock.fastForward(1);
  await stale.page.evaluate(()=>window.deferReads=true);stale.state.stage=2;await stale.page.clock.fastForward(10000);await stale.page.waitForFunction(()=>typeof window.finishRead==='function');
  await stale.page.locator('#tab-create').click();await stale.page.evaluate(()=>window.finishRead());await stale.page.clock.fastForward(10000);assert.equal(await stale.page.locator('#panel-create').isVisible(),true);
  assert.deepEqual(errors,[]);fs.mkdirSync('.local',{recursive:true});await initial.page.screenshot({path:'.local/automatic-acceptance.png',fullPage:true});
  console.log('Cache UI passed: original link, automatic acceptance/seal/history, one contract row, ink preservation, cache outage, malicious ancestry, independent verification, stale navigation. No wallet transactions.');
}finally{await browser.close();}
