import {chromium} from 'playwright';
import {browserOptions,testBase} from './browser.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixture} from '../test/fixture.mjs';
const f=await fixture(),base=testBase;
const mock=`
import * as protocol from '/src/protocol.js';
import { renderBody } from '/src/editor.js';
const f=${JSON.stringify(f)};
export const release=f.doc.client.release;
export const config={site:'4.2.204.tape'};
export async function connect(){return f.doc.parties.A.holder;}
export async function resolveIdentity(){return f.doc.parties.A;}
export async function createDocument(input,progress){window.creates=(window.creates||0)+1;progress('正在解析双方容器…');return {...f.doc,title:input.title,body:input.body,initiator:input.role,parties:input.role==='A'?f.doc.parties:{A:f.doc.parties.B,B:f.doc.parties.A}};}
export async function publishOffer(doc,ink,progress){window.sent=(window.sent||0)+1;window.lastInk=ink;window.signedDoc=doc;progress('等待钱包确认…');if(window.rejectWallet)throw Object.assign(Error('cancel'),{code:4001});return {...f.offerLocation,stored:!window.storageFails};}
export async function publishAcceptance(location,ink){window.accepts=(window.accepts||0)+1;window.lastInk=ink;return {...f.acceptLocation,stored:true};}
export async function publishSeal(){window.seals=(window.seals||0)+1;return {...f.sealLocation,stored:true};}
export async function loadContract(location,ctx,options){
  window.loads=(window.loads||[]);window.loads.push(location);window.readOptions=options;if(window.badProof)throw Error('钱包签名与合同、笔迹或签署人不符');if(window.unmined)throw Object.assign(Error('交易尚未打包'),{code:'TRANSACTION_PENDING'});
  const doc=f.doc,first={record:f.offer,location:f.offerLocation,block:{number:'101'}},second={record:f.accept,location:f.acceptLocation,block:{number:'102'}},third={record:f.seal,location:f.sealLocation,block:{number:'103'}};
  const sealed=location.tx===f.sealLocation.tx,signed=sealed||location.tx===f.acceptLocation.tx;
  return {id:protocol.documentId(doc),doc,offer:first,acceptance:signed?second:null,seal:sealed?third:null,status:sealed?'sealed':signed?'signed':'invited',selected:location,finalized:!window.pending,ready:!window.pending||!!window.fastReady,confirmationPolicy:options?.confirmation,confirmation:window.pending?[{chainId:'196',transactionBlock:'101',finalizedBlock:'99',depth:'10',requiredDepth:'12',remainingBlocks:'2',fresh:true}]:[]};
}
export async function syncIndex(identity,{onUpdate,inboxOnly}={}){if(inboxOnly)return {rows:[]};window.syncs=(window.syncs||0)+1;const result={rows:[{location:f.acceptLocation,label:'软件开发合作合同'}],progress:[{chain:'196',direction:'in',loaded:12,total:1000000,hasNewer:false}],pending:[],errors:window.historyUnavailable?[{chain:'56',message:'eth_getLogs: HTTP 502 upstream timeout'}]:[]};onUpdate?.({...result,pending:['56']});return result;}
export const exportBundle=b=>JSON.stringify({format:'TapeSign evidence v2',selected:b.selected});
`;
const browser=await chromium.launch(browserOptions());fs.mkdirSync('.local',{recursive:true});
const newPage=browser.newPage.bind(browser);
browser.newPage=async options=>{const p=await newPage(options);await p.route('**/cache/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({bundle:null,rows:[],queued:true})}));return p;};
async function draw(page){await page.locator('#signature').evaluate(c=>c.scrollIntoView({behavior:'instant',block:'center'}));const b=await page.locator('#signature').boundingBox();await page.mouse.move(b.x+b.width*.2,b.y+b.height*.6);await page.mouse.down();for(const [x,y]of [[.28,.3],[.36,.7],[.43,.4],[.55,.7],[.69,.38]])await page.mouse.move(b.x+b.width*x,b.y+b.height*y,{steps:5});await page.mouse.up();}
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route(/\/src\/client\.js(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:mock}));
  await page.goto(base);await page.waitForFunction(()=>document.querySelector('#body-count').textContent.includes('字节'));
  assert.equal(await page.locator('#title').inputValue(),'');assert.equal(await page.locator('#my-container').inputValue(),'');
  await page.screenshot({path:'.local/home-desktop.png',fullPage:true});
  await page.locator('#sample').click();await page.locator('#my-container').fill('1.2.204');await page.locator('#other-container').fill('2.2.204');
  await page.locator('#my-role').selectOption('B');assert.equal(await page.locator('#other-role').textContent(),'甲方');
  await page.locator('#review').click();await page.waitForFunction(()=>!document.querySelector('#sign-panel').hidden).catch(async e=>{console.error(await page.locator('#status').textContent(),errors);throw e;});
  assert.match(await page.locator('#sign-role').textContent(),/乙方/);assert.equal(await page.locator('#submit-sign').isDisabled(),true);
  await page.locator('#agree').check();await page.locator('#submit-sign').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('手写签名'));assert.equal(await page.evaluate(()=>window.sent||0),0);
  await draw(page);await page.locator('#clear-sign').click();assert.equal(await page.locator('#sign-placeholder').isVisible(),true);await draw(page);await page.locator('#undo-sign').click();assert.equal(await page.locator('#sign-placeholder').isVisible(),true);await draw(page);
  await page.evaluate(()=>window.rejectWallet=true);await page.locator('#submit-sign').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已取消'));assert.equal(await page.locator('#sign-panel').isVisible(),true);
  await page.evaluate(()=>window.rejectWallet=false);await page.locator('#submit-sign').click();await page.waitForFunction(()=>!document.querySelector('#share-panel').hidden);
  assert.equal(await page.locator('#sign-panel').isVisible(),false);assert.match(await page.locator('#share-url').inputValue(),/chain=196&tx=0x/);assert.ok((await page.evaluate(()=>window.lastInk)).length>0);
  await page.locator('#check-submitted').click();await page.waitForFunction(()=>document.querySelector('#contract-status').textContent.includes('等待对方签署'));
  await draw(page);await page.locator('#agree').check();await page.locator('#submit-sign').click();await page.waitForFunction(()=>document.querySelector('#share-title').textContent.includes('回签')).catch(async e=>{console.error('accept failed',await page.locator('#status').textContent(),await page.locator('#share-title').textContent(),errors);throw e;});assert.equal(await page.evaluate(()=>window.accepts),1);
  await page.locator('#check-submitted').click();await page.waitForSelector('#seal');await page.locator('#seal').click();await page.waitForFunction(()=>document.querySelector('#share-title').textContent.includes('归档'));assert.equal(await page.evaluate(()=>window.seals),1);
  await page.locator('#check-submitted').click();await page.waitForFunction(()=>document.querySelector('#contract-status').textContent.includes('链上归档'));assert.equal(await page.locator('#existing-signatures canvas').count(),2);assert.equal(await page.locator('#sign-panel').isVisible(),false);
  await page.screenshot({path:'.local/contract-desktop.png',fullPage:true});
  const download=page.waitForEvent('download');await page.locator('#export').click();assert.equal((await download).suggestedFilename(),f.doc.contractId+'.json');
  await page.locator('#tab-history').click();await page.locator('#history-container').fill('1.2.204');await page.locator('#sync').click();await page.waitForFunction(()=>document.querySelector('#index-progress').textContent.includes('1000000'));assert.equal(await page.evaluate(()=>window.syncs),1);
  await page.evaluate(()=>window.historyUnavailable=true);await page.locator('#sync').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('部分查询未完成'));
  assert.ok(await page.locator('#history-list').innerText().then(t=>t.includes('软件开发合作合同')));assert.match(await page.locator('#index-progress').textContent(),/部分信箱未同步/);assert.doesNotMatch(await page.locator('#index-progress').textContent(),/新增记录已同步/);
  await page.evaluate(()=>window.historyUnavailable=false);await page.locator('#sync').click();await page.waitForFunction(()=>document.querySelector('#index-progress').textContent.includes('新增记录已同步'));
  await page.locator('#tab-open').click();await page.locator('#open-value').fill('not-a-transaction');await page.locator('#open-contract').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('交易定位'));assert.equal(await page.locator('#open-contract').isEnabled(),true);
  await page.evaluate(()=>window.badProof=true);await page.locator('#open-value').fill(f.offerLocation.tx);await page.locator('#open-contract').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('签署人不符'));assert.equal(await page.locator('#contract-view').isVisible(),false);assert.equal(await page.locator('#sign-panel').isVisible(),false);
  await page.setViewportSize({width:390,height:844});await page.locator('#tab-create').click();await page.evaluate(()=>scrollTo(0,0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'.local/home-mobile.png',fullPage:true});
  await page.reload();await page.waitForFunction(()=>document.querySelector('#body-count').textContent.includes('字节'));assert.equal(await page.locator('#title').inputValue(),'项目合作协议');assert.equal(await page.locator('#my-role').inputValue(),'B');
  // Paste is plain text, stored AST is rendered exclusively with textContent.
  await page.evaluate(async()=>{const {renderBody}=await import('/src/editor.js');renderBody([{type:'p',runs:[{text:'<img src=x onerror="window.xss=1"><script>window.xss=1</script>',marks:7}]}],document.querySelector('#editor'));});
  assert.equal(await page.locator('#editor img').count(),0);assert.equal(await page.evaluate(()=>window.xss||0),0);
  // Direct invitation link opens without wallet connection or global sync.
  const before=await browser.newPage({viewport:{width:390,height:844}});await before.route(/\/src\/client\.js(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:mock}));
  await before.goto(base+'/?chain=196&tx='+f.offerLocation.tx);await before.waitForFunction(()=>!document.querySelector('#sign-panel').hidden);assert.equal(await before.evaluate(()=>window.syncs||0),0);assert.equal(await before.evaluate(()=>window.loads.length),1);assert.equal(await before.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await before.screenshot({path:'.local/invitation-mobile.png',fullPage:true});
  // Regression: mined-but-pending contracts remain readable and poll themselves;
  // strict signing/archival/export controls stay unavailable until finalized.
  const pending=await browser.newPage({viewport:{width:390,height:844}});
  await pending.clock.install();await pending.addInitScript(()=>window.pending=true);
  await pending.route(/\/src\/client\.js(?:\?.*)?$/,r=>r.fulfill({contentType:'text/javascript',body:mock}));
  await pending.goto(base+'/?chain=196&tx='+f.offerLocation.tx);await pending.waitForFunction(()=>!document.querySelector('#contract-view').hidden);
  assert.equal(await pending.locator('#contract-title').textContent(),f.doc.title);
  assert.match(await pending.locator('#contract-status').textContent(),/等待短确认/);
  assert.match(await pending.locator('#status').textContent(),/短确认 10 \/ 12/);
  assert.equal(await pending.locator('#sign-panel').isVisible(),false);assert.equal(await pending.locator('#export').isVisible(),false);
  assert.equal(await pending.evaluate(()=>window.readOptions.allowPending),true);
  assert.equal(await pending.evaluate(()=>window.readOptions.confirmation),'fast');
  const reads=await pending.evaluate(()=>window.loads.length);await pending.clock.fastForward(15000);await pending.waitForFunction(n=>window.loads.length>n,reads);
  assert.equal(await pending.locator('#contract-view').isVisible(),true);
  await pending.screenshot({path:'.local/pending-confirmation-mobile.png',fullPage:true});
  await pending.evaluate(()=>window.fastReady=true);await pending.clock.fastForward(10000);await pending.waitForFunction(()=>!document.querySelector('#sign-panel').hidden);
  assert.match(await pending.locator('#contract-status').textContent(),/短确认通过/);assert.match(await pending.locator('#status').textContent(),/重组回滚/);
  await draw(pending);await pending.locator('#agree').check();const inkBefore=await pending.locator('#signature').evaluate(c=>c.toDataURL());
  await pending.clock.fastForward(10000);await pending.waitForFunction(()=>window.loads.length>=4);
  assert.equal(await pending.locator('#signature').evaluate(c=>c.toDataURL()),inkBefore);assert.equal(await pending.locator('#agree').isChecked(),true);
  await pending.evaluate(()=>window.pending=false);await pending.clock.fastForward(10000);await pending.waitForFunction(()=>document.querySelector('#contract-status').textContent.includes('等待对方签署'));
  assert.match(await pending.locator('#contract-status').textContent(),/等待对方签署/);
  const stopped=await pending.evaluate(()=>window.loads.length);await pending.clock.fastForward(30000);assert.equal(await pending.evaluate(()=>window.loads.length),stopped);
  // A preview that later fails evidence checks is removed, not kept as verified.
  await pending.evaluate(()=>{window.pending=true;window.fastReady=false;});await pending.locator('#open-contract').click();await pending.waitForFunction(()=>document.querySelector('#contract-status').textContent.includes('等待短确认'));
  await pending.evaluate(()=>window.badProof=true);await pending.clock.fastForward(15000);await pending.waitForFunction(()=>document.querySelector('#status').classList.contains('error'));assert.equal(await pending.locator('#contract-view').isVisible(),false);
  // Pending archive never appears as final and has no seal action.
  await pending.evaluate(()=>{window.badProof=false;window.pending=true;});await pending.locator('#open-value').fill(f.sealLocation.tx);await pending.locator('#open-contract').click();await pending.waitForFunction(()=>!document.querySelector('#contract-view').hidden);assert.match(await pending.locator('#contract-status').textContent(),/等待短确认/);assert.equal(await pending.locator('#seal').count(),0);
  await pending.evaluate(()=>window.fastReady=true);await pending.clock.fastForward(10000);await pending.waitForFunction(()=>document.querySelector('#contract-status').textContent.includes('已归档 · 短确认通过'));assert.equal(await pending.locator('#export').isVisible(),true);
  // Leaving the view cancels automatic polling and cannot jump back later.
  await pending.locator('#tab-create').click();const left=await pending.evaluate(()=>window.loads.length);await pending.clock.fastForward(30000);assert.equal(await pending.evaluate(()=>window.loads.length),left);
  await pending.evaluate(()=>{window.unmined=true;window.pending=false;});await pending.locator('#tab-open').click();await pending.locator('#open-value').fill(f.offerLocation.tx);await pending.locator('#open-contract').click();await pending.waitForFunction(()=>document.querySelector('#status').textContent.includes('尚未打包'));assert.equal(await pending.locator('#contract-view').isVisible(),false);
  await pending.evaluate(()=>window.unmined=false);await pending.clock.fastForward(15000);await pending.waitForFunction(()=>!document.querySelector('#sign-panel').hidden);
  assert.deepEqual(errors,[]);
  console.log('UI passed: rich text, A/B role swap, local draft, mouse ink, clear/undo, empty signature rejection, wallet cancellation, offer/accept/seal, share links, export, history, invalid link, proof rejection, mobile, XSS text, direct invitation without scan. Wallet and chain boundary mocked.');
}finally{await browser.close();}
