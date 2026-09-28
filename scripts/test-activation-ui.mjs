import {browserOptions,testBase} from './browser.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {bindingABI} from '../src/activation.js';
const channel=process.env.PLAYWRIGHT_CHANNEL||'msedge',base=process.env.TEST_BASE_URL||'http://127.0.0.1:18740';
const browser=await chromium.launch({headless:true,...(channel==='chromium'?{}:{channel})});
const key='tapesign-v2:website-activation',hash='0x'+'ab'.repeat(32);
const mock=`
export const config={site:'4.2.204.tape',networks:[{chainId:196,binding:'0x'+'33'.repeat(20)}]};
const identity={name:'4.2.204.tape',chainId:'196',container:'0x'+'11'.repeat(20),holder:'0x'+'22'.repeat(20)};
const block=()=>({number:'100',timestamp:String(Math.floor(Date.now()/1000)),hash:'0x'+'cd'.repeat(32)});
const s=globalThis.fixture;
const rpc={pin:async()=>block(),attest:async()=>{if(s.readError)throw Error('RPC unavailable');},resolve:async()=>({...identity}),call:async(to,fn,args)=>{
 if(fn==='isLive')return [args[0]==='example.com'?s.oldPaid:s.active];
 return [{isContainerLive:s.active,containerPaidUntil:s.active?9999999999n:0n,paidUntil:s.oldPaid?9999999999n:0n,monthlyFee:BigInt(s.fee)}[fn]];
},agree:async(method)=>method==='eth_getTransactionReceipt'?(s.receipt?{hash:'${hash}',status:s.receipt,number:'100',blockHash:block().hash}:null):block()};
// Receipt block checks use a hash normalizer, while quote checks use a header normalizer.
const agree=rpc.agree;rpc.agree=async(method,params,normalize)=>{if(method==='eth_getBlockByNumber'){const b=block();return normalize?normalize({...b,number:'0x64',timestamp:'0x'+BigInt(b.timestamp).toString(16)}):b;}return agree(method);};
export const context=()=>({rpc:()=>rpc});
export async function authorize(){return {request:async({method,params})=>{
 if(method==='eth_estimateGas'){if(s.feeChanges)s.fee='52000000000000000';return '0x186a0';}
 if(method==='eth_accounts')return [s.wrongAccount?'0x'+'99'.repeat(20):identity.holder];
 if(method==='eth_chainId')return s.wrongChain?'0x38':'0xc4';
 if(method==='eth_sendTransaction'){s.sent.push(params[0]);if(s.reject)throw Object.assign(Error('Wallet rejected'),{code:4001});if(s.unknown)throw Error('Wallet disconnected');return '${hash}';}
 throw Error('Unexpected wallet call '+method);
}};}
`;
const errors=[];
async function pageFor(options={}){
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({options,key,hash})=>{globalThis.fixture={active:false,oldPaid:false,fee:'26000000000000000',sent:[],...options};if(options.pending)localStorage.setItem(key,JSON.stringify({phase:'submitted',hash}));if(options.corrupt)localStorage.setItem(key,'{broken');},{options,key,hash});
 await page.route('**/src/rpc.js*',r=>r.fulfill({contentType:'text/javascript',body:mock}));
 await page.goto(base+'/activate.html');await page.waitForFunction(()=>!document.querySelector('#refresh').disabled&&!document.querySelector('#status').textContent.includes('正在核对容器'));return page;
}
async function click(page,id){page.once('dialog',d=>d.accept());await page.locator('#'+id).click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled&&!document.querySelector('#status').textContent.includes('正在核对容器'));}
try{
 const p=await pageFor();assert.match(await p.locator('#details').textContent(),/0.026/);assert.equal(await p.locator('#sync').isDisabled(),true);
 await click(p,'activate');assert.equal(await p.locator('#activate').isDisabled(),true);assert.match(await p.locator('#pending').textContent(),new RegExp(hash));
 const sent=await p.evaluate(()=>fixture.sent);assert.equal(sent.length,1);assert.equal(BigInt(sent[0].value),26000000000000000n);assert.equal(bindingABI.parseTransaction(sent[0]).name,'bind');
 await p.reload();await p.waitForFunction(()=>!document.querySelector('#refresh').disabled);assert.equal(await p.locator('#activate').isDisabled(),true);
 await p.evaluate(()=>{fixture.active=true;fixture.receipt='1';});await p.locator('#refresh').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('已生效'));assert.equal(await p.locator('#open-site').isVisible(),true);assert.equal(await p.evaluate(k=>localStorage.getItem(k),key),null);await p.close();
 for(const option of [{reject:true},{unknown:true},{feeChanges:true},{wrongAccount:true},{wrongChain:true}]){
  const page=await pageFor(option);await click(page,'activate');const state=await page.evaluate(k=>({sent:fixture.sent.length,pending:localStorage.getItem(k)}),key);
  assert.equal(state.sent,option.reject||option.unknown?1:0);assert.equal(!!state.pending,!!option.unknown);
  await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled&&!document.querySelector('#status').textContent.includes('正在核对容器'));assert.equal(await page.locator('#activate').isDisabled(),!!option.unknown);await page.close();
 }
 const sync=await pageFor({oldPaid:true});await sync.locator('#domain').fill('example.com');await sync.locator('#domain').blur();await sync.locator('#refresh').click();await sync.waitForFunction(()=>!document.querySelector('#sync').disabled);await click(sync,'sync');
 const stx=await sync.evaluate(()=>fixture.sent[0]);assert.equal(stx.value,'0x0');assert.equal(bindingABI.parseTransaction(stx).name,'syncContainer');await sync.close();
 for(const options of [{active:true},{pending:true},{corrupt:true},{readError:true}]){const page=await pageFor(options);assert.equal(await page.locator('#activate').isDisabled(),true);assert.equal(await page.evaluate(()=>fixture.sent.length),0);await page.close();}
 const failed=await pageFor({pending:true,receipt:'0'});assert.match(await failed.locator('#status').textContent(),/最终确认失败/);assert.equal(await failed.evaluate(k=>localStorage.getItem(k),key),null);await failed.close();
 assert.deepEqual(errors,[]);console.log('Activation UI passed: fee, bind, sync, rejection, changed inputs, pending reload, unknown send, finality, failure and inactive RPC. Synthetic wallet only.');
}finally{await browser.close();}
