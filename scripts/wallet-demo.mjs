// Local-only development harness. Never included in build.mjs or a production client.
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parseEther,keccak256} from 'ethers';
import {walletFixture} from '../test/wallet-fixture.mjs';
import artifact from '../src/wallet-artifact.json' with {type:'json'};

// Vite adds ?t=... after hot updates. Match the entry independent of those
// attributes so refresh never drops the demo bootstrap or its session checks.
export function demoIndexHtml(html){return html.replace(/<script\b[^>]*\bsrc=["']\/src\/app[.]js(?:\?[^"']*)?["'][^>]*><\/script>/,'<script type="module" src="/wallet-demo-entry.js"></script><style>#product-contract,#product-notary,#choose-my-container,#connect{display:none!important}</style>');}

export async function startWalletDemo({port=18743}={}){
 const f=await walletFixture({deployWallet:false});
 const root=fileURLToPath(new URL('../',import.meta.url));
 const info={session:crypto.randomUUID(),chainId:'31337',name:'4.2.204.tape',processor:f.circuit.target,tokenId:'4',container:f.container.target,holder:f.keys[1].address,controller:f.keys[0].address,recipient:f.keys[2].address,token:f.token.target,endpoint:'0x'+'00'.repeat(32)};
 const readOnly=new Set(['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_getBalance','eth_getStorageAt','eth_call','eth_getLogs','eth_getTransactionReceipt','eth_getTransactionByHash','eth_estimateGas']);
 const rpcModule=String.raw`
import {toQuantity} from 'ethers';
export {ABI,header} from '/src/vendor/mainnet.js';
const info=await fetch('/demo/info').then(r=>r.json());
export const config={networks:[{chainId:31337,hub:info.container,rpcs:['/demo/rpc','/demo/rpc']}]},local=true;
async function request(route,payload){const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),v=await r.json();if(v.error)throw Object.assign(Error(v.error),{code:v.code});return v.result;}
const wallet={on(){},removeListener(){},request:async args=>{const role=sessionStorage.getItem('demo-role')||'notary';if(args.method==='eth_signTypedData_v4'){const d=JSON.parse(args.params[1]);if(!confirm('本地模拟签名确认（不会打开 MetaMask / OKX）\n角色：'+(role==='transaction'?'交易控制方':'容器持有人')+'\n操作：'+d.primaryType+'\n钱包：'+d.domain.verifyingContract+'\n序号：'+d.message.nonce+'\n确认使用临时测试账户签名？'))throw Object.assign(Error('取消模拟签名'),{code:4001});}return request('/demo/wallet',{role,...args});}};
export const provider=()=>wallet;
export const connect=async()=>(await wallet.request({method:'eth_requestAccounts'}))[0];
export async function resolveIdentity(name){if(name.replace('.tape','')!=='4.2.204')throw Error('模拟环境只提供 4.2.204 容器');return {name:info.name,chainId:info.chainId,processor:info.processor,tokenId:info.tokenId,container:info.container,holder:info.holder,endpoint:info.endpoint};}
export function context(){const heads=new Map();return {records:new Map(),onProgress(){},rpc(chain){if(String(chain)!==info.chainId)throw Error('仅限本地模拟链');return {agree:async(method,params,normalize=x=>x)=>normalize(await request('/demo/rpc',{method,params}))};},async head(chain){if(String(chain)!==info.chainId)throw Error('仅限本地模拟链');if(!heads.has(chain)){const b=await request('/demo/rpc',{method:'eth_getBlockByNumber',params:['latest',false]});heads.set(chain,{number:BigInt(b.number).toString(),hash:b.hash,timestamp:BigInt(b.timestamp).toString()});}return heads.get(chain);},async assert(){for(const h of heads.values()){const b=await request('/demo/rpc',{method:'eth_getBlockByNumber',params:[toQuantity(h.number),false]});if(b.hash!==h.hash)throw Error('模拟区块变化');}}};}
export const authorize=async()=>wallet;
export async function sendTransaction(){throw Error('模拟环境仅支持公证钱包');}
`;
 const init=String.raw`
const info=await fetch('/demo/info').then(r=>r.json());
if(localStorage.getItem('demo-session')!==info.session){for(const key of Object.keys(localStorage))if(key.startsWith('tapesign-wallet-v1:'))localStorage.removeItem(key);localStorage.setItem('demo-session',info.session);}
localStorage.setItem('tapesign-v2:current-container',JSON.stringify(info.name));
if(!location.hash.startsWith('#wallet/'))history.replaceState(null,'','#wallet/create');
const banner=document.createElement('aside');banner.id='wallet-demo-banner';banner.style.cssText='padding:18px;background:#fff4d6;border-bottom:2px solid #b57a00;font:14px/1.8 sans-serif;overflow-wrap:anywhere';
banner.innerHTML='<strong>本地模拟体验 · 链 31337 · 没有真实资产</strong><p>容器身份为测试替身，合约部署、双签和转账在本地 EVM 实际执行。账户由本机临时节点模拟；重新启动会清空链。正式站点不包含此入口。</p><label>当前签名角色 <select id="demo-role"><option value="notary">容器持有人</option><option value="transaction">交易控制方</option></select></label> <button id="demo-fill" type="button">填入测试地址</button> <button id="demo-fund" type="button">给当前钱包充值测试资产</button><p id="demo-addresses"></p><p id="demo-status" role="status"></p>';
document.body.prepend(banner);
const modeHint=document.createElement('p');modeHint.id='demo-sign-hint';modeHint.textContent='模拟模式不会弹出 MetaMask / OKX。部署确认后会自动进入双签激活：先把角色切为“交易控制方”，点击“交易钱包签名”；再切回“容器持有人”签第二次。';banner.insertBefore(modeHint,banner.children[2]);
document.getElementById('demo-addresses').textContent='收款人 '+info.recipient+' ｜ TEST6 代币 '+info.token;
document.getElementById('demo-role').value=sessionStorage.getItem('demo-role')||'notary';
document.getElementById('demo-role').onchange=e=>sessionStorage.setItem('demo-role',e.target.value);
document.getElementById('demo-fill').onclick=()=>{document.getElementById('wallet-controller').value=info.controller;document.getElementById('wallet-recipient').value=info.recipient;document.getElementById('wallet-token').value=info.token;document.getElementById('wallet-amount').value='0.1';};
document.getElementById('demo-fund').onclick=async()=>{const status=document.getElementById('demo-status');try{const wallet=document.getElementById('wallet-select').value.split('/')[1];if(!wallet)throw Error('请先部署并核对钱包结果');const r=await fetch('/demo/fund',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({wallet})}),v=await r.json();if(v.error)throw Error(v.error);status.textContent='已充值 1 TEST 原生币和 10 TEST6。';}catch(e){status.textContent=e.message;}};
await import('/src/app.js');
`;
 const server=await createServer({configFile:false,root,publicDir:false,define:{__RELEASE__:JSON.stringify('local-wallet-demo')},server:{host:'127.0.0.1',port,strictPort:port!==0},plugins:[{name:'wallet-isolated-demo',enforce:'pre',load(id){if(id.split('?')[0].replaceAll('\\','/').endsWith('/src/rpc.js'))return rpcModule;},transformIndexHtml:demoIndexHtml,configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  const origin='http://'+req.headers.host,url=new URL(req.url,origin);
  if(url.pathname==='/wallet-demo-entry.js'){res.setHeader('Content-Type','text/javascript');res.end(init);return;}
  if(!url.pathname.startsWith('/demo/'))return next();
  const reply=(code,value)=>{res.statusCode=code;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));};
  try{
   if(!/^127[.]0[.]0[.]1:[0-9]+$/.test(req.headers.host||'')||(req.headers.origin&&req.headers.origin!==origin))return reply(403,{error:'Loopback origin required'});
   if(url.pathname==='/demo/info'&&req.method==='GET')return reply(200,info);
   if(req.method!=='POST'||req.headers.origin!==origin)return reply(403,{error:'Same-origin POST required'});
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>150000)throw Error('Too large');}const body=JSON.parse(raw);
   if(url.pathname==='/demo/fund'){
    const code=await f.provider.getCode(body.wallet);if(keccak256(code)!==keccak256(artifact.runtime))throw Error('Not a local prototype wallet');
    await(await f.signers[3].sendTransaction({to:body.wallet,value:parseEther('1')})).wait();await(await f.token.transfer(body.wallet,10000000n)).wait();return reply(200,{result:true});
   }
   if(!['/demo/rpc','/demo/wallet'].includes(url.pathname))return reply(404,{error:'Unknown demo route'});
   const {method,params=[]}=body;
   if(url.pathname==='/demo/wallet'){
    if(!['notary','transaction'].includes(body.role))throw Error('Unknown test role');const index=body.role==='transaction'?0:1,address=f.keys[index].address;
    if(method==='eth_accounts'||method==='eth_requestAccounts')return reply(200,{result:[address]});
    if(method==='wallet_switchEthereumChain'){if(BigInt(params[0].chainId)!==31337n)throw Error('Local chain only');return reply(200,{result:null});}
    if(method==='eth_signTypedData_v4'){if(params[0].toLowerCase()!==address.toLowerCase())throw Error('Wrong role');const d=JSON.parse(params[1]);delete d.types.EIP712Domain;return reply(200,{result:await f.keys[index].signTypedData(d.domain,d.types,d.message)});}
    if(method==='eth_sendTransaction'){if(params[0].from.toLowerCase()!==address.toLowerCase())throw Error('Wrong sender');return reply(200,{result:await f.g.request({method,params})});}
   }
   if(!readOnly.has(method))throw Error('Method disabled');return reply(200,{result:await f.g.request({method,params})});
  }catch(e){reply(400,{error:e.shortMessage||e.message,code:e.code});}
 });}}]});
 try{await server.listen();}catch(e){await f.close();throw e;}
 return {url:'http://127.0.0.1:'+server.httpServer.address().port,info,f,close:async()=>{await server.close();await f.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const demo=await startWalletDemo();console.log('Local simulated wallet: '+demo.url+'/#wallet/create');
 for(const event of ['SIGINT','SIGTERM'])process.on(event,async()=>{await demo.close();process.exit(0);});
}
