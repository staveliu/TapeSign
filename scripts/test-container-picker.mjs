import {chromium} from 'playwright';
import {browserOptions,testBase} from './browser.mjs';
import assert from 'node:assert/strict';
import {fixture} from '../test/fixture.mjs';
const f=await fixture(),browser=await chromium.launch(browserOptions()),errors=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({owner,other})=>{window.wallet=owner;window.walletCalls=[];window.handlers={};window.ethereum={request:async({method})=>{window.walletCalls.push(method);if(method==='eth_accounts'||method==='eth_requestAccounts'){if(window.rejectConnect&&method==='eth_requestAccounts')throw Object.assign(Error('cancel'),{code:4001});return [window.wallet];}throw Error('Unexpected wallet request '+method);},on:(name,fn)=>window.handlers[name]=fn,removeListener:()=>{}};localStorage.setItem('tapesign-v2:history-container',JSON.stringify('1.2.204.tape'));window.otherWallet=other;},{owner:f.doc.parties.A.holder,other:f.doc.parties.B.holder});
 const client=`
 const f=${JSON.stringify(f)};export const release=f.doc.client.release;
 export async function connect(){return (await window.ethereum.request({method:'eth_requestAccounts'}))[0];}
 export async function resolveIdentity(name){return {...f.doc.parties.A,name:name+'.tape',holder:window.transferred?f.doc.parties.B.holder:window.wallet};}
 export async function createDocument(){return f.doc;}export async function publishOffer(){}export async function publishAcceptance(){}export async function publishSeal(){}export async function loadContract(){}export function exportBundle(){}
 export async function syncIndex(){return {rows:[],progress:[{chain:'196',direction:'in',loaded:0,total:0}],errors:[],pending:[]};}
 `;
 await page.route(/[/]src[/]client[.]js(?:[?].*)?$/,route=>route.fulfill({contentType:'text/javascript',body:client}));
 const discovery=`
 export const containerLabel=v=>String(v||'').trim().replace(/[.]tape$/i,'');
 export function createContainerDiscovery(wallet,{signal}={}){window.discoveryCalls=(window.discoveryCalls||0)+1;let result={wallet,rows:[],progress:[{chain:'196',scanned:0,unreadable:0,done:false}],hasMore:true};return {wallet,snapshot:()=>result,async scan({onUpdate}={}){
 if(window.emptyWallet){result={wallet,rows:[],progress:[{chain:'196',scanned:100,unreadable:0,done:true}],hasMore:false};onUpdate?.(result);return result;}
 result={wallet,rows:[{name:'1.2.204',chainId:'196'}],progress:[{chain:'196',scanned:128,unreadable:0,done:false}],hasMore:true};onUpdate?.(result);
 if(window.delayScan)await new Promise(resolve=>window.finishScan=resolve);
 if(signal?.aborted)throw new DOMException('cancel','AbortError');
 result={...result,rows:[...result.rows,{name:'2.204',chainId:'56'}],progress:[{chain:'196',scanned:2000,unreadable:0,done:false},{chain:'56',scanned:2000,unreadable:0,done:false}]};onUpdate?.(result);return result;}};}
 `;
 await page.route(/[/]src[/]containers[.]js(?:[?].*)?$/,route=>route.fulfill({contentType:'text/javascript',body:discovery}));
 await page.goto(testBase+'/');await page.waitForFunction(()=>document.querySelector('#body-count').textContent.includes('字节'));
 assert.equal(await page.locator('#history-container').inputValue(),'1.2.204');assert.equal(await page.evaluate(()=>window.discoveryCalls||0),0);
 await page.locator('#other-container').fill('2.204.tape');await page.locator('#other-container').blur();assert.equal(await page.locator('#other-container').inputValue(),'2.204');
 await page.locator('#choose-my-container').click();await page.waitForSelector('[data-container]');
 assert.equal(await page.locator('#container-picker').evaluate(el=>el.open),true);assert.doesNotMatch(await page.locator('#container-options').innerText(),/[.]tape/);
 await page.locator('[data-container]').filter({hasText:'1.2.204'}).click();await page.waitForFunction(()=>!document.querySelector('#container-picker').open);assert.equal(await page.locator('#my-container').inputValue(),'1.2.204');
 await page.locator('#tab-history').click();await page.locator('#choose-history-container').click();await page.locator('[data-container="2.204"]').click();await page.waitForFunction(()=>!document.querySelector('#container-picker').open);assert.equal(await page.locator('#history-container').inputValue(),'2.204');
 await page.evaluate(()=>window.transferred=true);await page.locator('#choose-history-container').click();await page.locator('[data-container="2.204"]').click();await page.waitForFunction(()=>document.querySelector('#container-picker-status').textContent.includes('不持有'));assert.equal(await page.locator('#container-picker').evaluate(el=>el.open),true);await page.locator('#container-close').click();
 await page.evaluate(()=>{window.transferred=false;window.delayScan=true;});await page.locator('#choose-history-container').click();await page.waitForSelector('[data-container]');
 await page.evaluate(()=>{window.wallet=window.otherWallet;window.handlers.accountsChanged([window.wallet]);window.finishScan?.();});await page.waitForFunction(()=>document.querySelector('#container-picker-status').textContent.includes('钱包账户已变化'));assert.equal(await page.locator('#container-options button').count(),0);assert.equal(await page.locator('#my-container').inputValue(),'');await page.locator('#container-close').click();
 await page.evaluate(()=>{window.delayScan=false;window.emptyWallet=true;});await page.locator('#choose-history-container').click();await page.waitForFunction(()=>document.querySelector('#container-picker-status').textContent.includes('未找到当前钱包'));assert.equal(await page.locator('#container-options button').count(),0);await page.locator('#container-close').click();
 await page.evaluate(()=>window.rejectConnect=true);await page.locator('#choose-history-container').click();await page.waitForFunction(()=>document.querySelector('#container-picker-status').textContent.includes('已取消'));await page.locator('#container-close').click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.ok((await page.evaluate(()=>window.walletCalls)).every(m=>['eth_accounts','eth_requestAccounts'].includes(m)));assert.deepEqual(errors,[]);
 console.log('Container picker passed: short IDs, create/history choice, transferred holder rejection, account switching, stale result cancellation, empty wallet, wallet cancellation, mobile, read-only requests. Wallet and discovery mocked.');
}finally{await browser.close();}
