import {chromium} from 'playwright';
import {browserOptions,testBase} from './browser.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch(browserOptions()),base=testBase;
try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>document.querySelector('#body-count').textContent.includes('字节'));
  await page.screenshot({path:'.local/preview-desktop.png',fullPage:true});
  await page.locator('#sample').click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.local/preview-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.argv.includes('--chain')){
    if(!process.env.TAPESIGN_TEST_OTHER)throw Error('Set TAPESIGN_TEST_OTHER for the read-only container check');
    await page.setViewportSize({width:1440,height:1050});await page.locator('#my-container').fill('4.2.204');await page.locator('#other-container').fill(process.env.TAPESIGN_TEST_OTHER);
    const start=Date.now();await page.locator('#review').click();
    await page.waitForFunction(()=>!document.querySelector('#sign-panel').hidden||document.querySelector('#status').classList.contains('error'),{},{timeout:180000});
    const status=await page.locator('#status').textContent();assert.equal(await page.locator('#sign-panel').isVisible(),true,status);
    const parties=await page.locator('#contract-parties').innerText();assert.match(parties,/4\.2\.204/);assert.match(parties,/1\.2\.210/);
    const report={realChainReadOnly:true,source:'browser through local read-only RPC proxy',seconds:(Date.now()-start)/1000,parties,status,checkedAt:new Date().toISOString()};
    fs.writeFileSync('.local/browser-chain-preflight.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }
  await page.goto(base+'/publish.html');await page.waitForFunction(()=>document.querySelector('#release').textContent.includes('release'));
  assert.match(await page.locator('#release').textContent(),/client-/);assert.equal(await page.locator('#publish').isDisabled(),true);
  assert.deepEqual(errors,[]);console.log('Unmocked app and publication page loaded. No wallet signing or chain mutation performed.');
}finally{await browser.close();}
