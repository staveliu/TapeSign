import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Contract,parseEther} from 'ethers';
import artifact from '../src/wallet-artifact.json' with {type:'json'};
import {startWalletDemo} from './wallet-demo.mjs';
const demo=await startWalletDemo({port:0});
const channel=process.env.PLAYWRIGHT_CHANNEL||'msedge';
const browser=await chromium.launch({headless:true,...(channel==='chromium'?{}:{channel})});
const errors=[];
async function ready(page){await page.waitForFunction(()=>!document.querySelector('#wallet-workspace button:disabled')||!document.getElementById('wallet-load').disabled);}
async function signBoth(page){for(const [role,id]of [['transaction','a'],['notary','b']]){await page.locator('#demo-role').selectOption(role);await page.locator('#wallet-sign-'+id).click();await page.waitForFunction(r=>JSON.parse(localStorage.getItem('tapesign-wallet-v1:proposal')).signatures[r]!=='0x',role);await ready(page);}}
async function submitted(page){await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tapesign-wallet-v1:pending')||'null')?.hash);await ready(page);}
async function recover(page){await page.locator('#wallet-recover').click();await page.waitForFunction(()=>!localStorage.getItem('tapesign-wallet-v1:pending'));await ready(page);}
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),dialogs=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());return d.accept();});
 let receiptsOffline=true;await page.route('**/demo/rpc',async route=>{if(receiptsOffline&&route.request().postDataJSON().method==='eth_getTransactionReceipt')return route.fulfill({status:503,json:{error:'Simulated receipt delay'}});return route.continue();});
 await page.goto(demo.url+'/#wallet/create');await page.waitForSelector('#wallet-deploy');
 assert.equal(await page.locator('#wallet-controller').inputValue(),'');
 await page.locator('#demo-fill').click();await page.locator('#wallet-risk').check();await page.locator('#wallet-deploy').click();await submitted(page);
 const deployment=await page.evaluate(()=>JSON.parse(localStorage.getItem('tapesign-wallet-v1:pending')));
 await page.reload();await page.waitForSelector('#wallet-recover');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tapesign-wallet-v1:pending')).hash),deployment.hash);receiptsOffline=false;await recover(page);
 const policy=await page.evaluate(()=>JSON.parse(localStorage.getItem('tapesign-wallet-v1:wallets'))[0]),wallet=new Contract(policy.wallet,artifact.abi,demo.f.provider);
 assert.equal(await wallet.active(),false);assert.equal(await page.locator('#wallet-deposit').isVisible(),false);
 await page.waitForSelector('#wallet-proposal-view');await ready(page);assert.equal(new URL(page.url()).hash,'#wallet/sign');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tapesign-wallet-v1:proposal')).action),'Bind');assert.match(await page.locator('#wallet-next-title').textContent(),/双方签署激活/);assert.match(await page.locator('#demo-sign-hint').textContent(),/不会弹出 MetaMask/);
 assert.equal(await page.locator('#wallet-execute').isDisabled(),true);
 // Sign once, then exchange a JSON proposal through a completely separate browser storage.
 await page.locator('#demo-role').selectOption('transaction');await page.locator('#wallet-sign-a').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tapesign-wallet-v1:proposal')).signatures.transaction!=='0x');await ready(page);
 assert.equal(await page.locator('#wallet-execute').isDisabled(),true);
 const outbound=await page.evaluate(()=>localStorage.getItem('tapesign-wallet-v1:proposal'));
 const other=await browser.newPage();other.on('pageerror',e=>errors.push(e.message));other.on('dialog',d=>d.accept());await other.goto(demo.url+'/#wallet/sign');await other.waitForSelector('#wallet-proposal-import');
 await other.locator('#wallet-proposal-json').fill(outbound);await other.locator('#wallet-proposal-import').click();await other.waitForSelector('#wallet-proposal-view');await ready(other);
 await other.locator('#demo-role').selectOption('notary');await other.locator('#wallet-sign-b').click();await other.waitForFunction(()=>JSON.parse(localStorage.getItem('tapesign-wallet-v1:proposal')).signatures.notary!=='0x');await ready(other);
 const inbound=await other.evaluate(()=>localStorage.getItem('tapesign-wallet-v1:proposal'));await other.close();
 await page.locator('#wallet-proposal-json').fill(inbound);await page.locator('#wallet-proposal-import').click();await ready(page);await page.waitForFunction(()=>!document.querySelector('#wallet-execute').disabled);
 await page.locator('#wallet-execute').click();await submitted(page);await recover(page);assert.equal(await wallet.active(),true);assert.equal(await page.locator('#wallet-deposit').isVisible(),true);assert.equal(await page.evaluate(()=>localStorage.getItem('tapesign-wallet-v1:proposal')),null);
 await page.locator('#demo-fund').click();await page.waitForFunction(()=>document.querySelector('#demo-status').textContent.includes('已充值'));
 const before=await demo.f.provider.getBalance(demo.info.recipient);
 await page.locator('#demo-fill').click();await page.locator('#wallet-propose').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tapesign-wallet-v1:proposal'))?.action==='Transfer');await ready(page);await signBoth(page);
 const proposal=await page.evaluate(()=>JSON.parse(localStorage.getItem('tapesign-wallet-v1:proposal')));
 const tampered=structuredClone(proposal);tampered.message.amount='1';await page.locator('#wallet-proposal-json').fill(JSON.stringify(tampered));await page.locator('#wallet-proposal-import').click();await page.waitForFunction(()=>document.querySelector('#wallet-status').classList.contains('error'));await ready(page);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tapesign-wallet-v1:proposal')).message.amount),proposal.message.amount);
 await page.locator('#wallet-execute').click();await submitted(page);await page.reload();await page.waitForSelector('#wallet-recover');await ready(page);await recover(page);
 assert.equal(await demo.f.provider.getBalance(demo.info.recipient)-before,parseEther('0.1'));
 await page.locator('#wallet-asset').selectOption('erc20');await page.locator('#wallet-token').fill(demo.info.token);await page.locator('#wallet-recipient').fill(demo.info.recipient);await page.locator('#wallet-amount').fill('1.234567');await page.locator('#wallet-propose').click();await page.waitForFunction(()=>{const p=JSON.parse(localStorage.getItem('tapesign-wallet-v1:proposal'));return p&&p.message.asset!=='0x0000000000000000000000000000000000000000';});await ready(page);await signBoth(page);
 assert.match(await page.locator('#wallet-review').textContent(),/1[.]234567/);
 await page.locator('#wallet-execute').click();await submitted(page);await recover(page);assert.equal(await demo.f.token.balanceOf(demo.info.recipient),1234567n);
 // Replay through the UI is rejected before wallet submission.
 await page.locator('[data-wallet-tab=sign]').click();assert.equal(await page.locator('#wallet-proposal-view').isVisible(),false);await page.locator('#wallet-proposal-json').fill(JSON.stringify(proposal));await page.locator('#wallet-proposal-import').click();await page.waitForFunction(()=>document.querySelector('#wallet-status').classList.contains('error'));assert.equal(await page.evaluate(()=>localStorage.getItem('tapesign-wallet-v1:pending')),null);
 await page.locator('[data-wallet-tab=transfer]').click();await page.locator('#wallet-pause').click();await submitted(page);await recover(page);assert.equal(await wallet.paused(),true);assert.equal(await page.locator('#wallet-deposit').isVisible(),false);
 await page.locator('#wallet-resume').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tapesign-wallet-v1:proposal'))?.action==='Resume');await ready(page);await signBoth(page);await page.locator('#wallet-execute').click();await submitted(page);await recover(page);assert.equal(await wallet.paused(),false);
 for(const tab of ['create','wallets','transfer','sign']){await page.locator('[data-wallet-tab='+tab+']').click();assert.equal(new URL(page.url()).hash,'#wallet/'+tab);await page.reload();await page.waitForSelector('#wallet-'+tab);await ready(page);}
 await page.locator('[data-wallet-tab=create]').click();await page.locator('#demo-fill').click();await page.locator('#wallet-risk').check();await page.locator('#wallet-deploy').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tapesign-wallet-v1:proposal')||'null')?.action==='Bind'&&!localStorage.getItem('tapesign-wallet-v1:pending'));await ready(page);assert.equal(new URL(page.url()).hash,'#wallet/sign');assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('tapesign-wallet-v1:wallets')))).length,2);assert.ok(dialogs.some(d=>d.includes('本地模拟签名确认')));
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 fs.mkdirSync('.local/wallet-test',{recursive:true});await page.screenshot({path:'.local/wallet-test/mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:1000});await page.screenshot({path:'.local/wallet-test/desktop.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('Wallet browser EVM flow passed: deployment, reload recovery, cross-device activation, single-sign gate, native/ERC20 dual transfers, tamper/replay rejection, pause/resume, four anchors, mobile. Simulated container, local chain 31337 only.');
}finally{await browser.close();await demo.close();}
