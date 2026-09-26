import {chromium} from 'playwright';
import {browserOptions,testBase} from './browser.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const tx=process.argv.find(x=>/^0x[0-9a-f]{64}$/.test(x));
if(!tx)throw Error('Usage: node scripts/check-cache-live.mjs <offerTx> [--bsc]');
const chain=process.argv.includes('--bsc')?'56':'196';
fs.mkdirSync('.local',{recursive:true});
const url=testBase+'/dist/index.html?chain='+chain+'&tx='+tx;
const browser=await chromium.launch(browserOptions());
try{
  const page=await browser.newPage({viewport:{width:1360,height:1000}}),errors=[],failures=[],start=Date.now();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',async r=>{if(r.url().includes('/rpc/')&&!r.ok()){try{failures.push({status:r.status(),error:(await r.json()).error});}catch{}}});
  await page.goto(url);
  let previewMs=null;
  try{await page.waitForFunction(()=>!document.querySelector('#contract-view').hidden,null,{timeout:30000});previewMs=Date.now()-start;}catch{}
  let verified=false;
  try{await page.waitForFunction(()=>!!document.querySelector('#seal')&&!document.querySelector('#seal').disabled||document.querySelector('#contract-status').textContent.includes('链上归档'),null,{timeout:150000});verified=true;}catch{}
  const report={url,checkedAt:new Date().toISOString(),previewMs,verifiedMs:Date.now()-start,verified,title:await page.locator('#contract-title').textContent(),badge:await page.locator('#contract-status').textContent(),status:await page.locator('#status').textContent(),signatures:await page.locator('#existing-signatures canvas').count(),release:await page.locator('#release-label').textContent(),errors,failures};
  await page.screenshot({path:'.local/live-automatic-acceptance.png',fullPage:true});
  fs.writeFileSync('.local/live-automatic-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  fs.writeFileSync('.local/live-'+tx.slice(2,14)+'.json',JSON.stringify(report,null,2));
  assert.equal(verified,true,'Original offer must independently verify acceptance and enable archival');assert.equal(report.signatures,2);assert.deepEqual(errors,[]);
}finally{await browser.close();}
