import {hexlify,randomBytes,toQuantity} from 'ethers';
import {authorize,resolveIdentity,context,config,ABI} from './rpc.js';
import {same} from './protocol.js';
import {NOTARY_PROTOCOL,NOTARY_ENDPOINT,notaryNumber,describeContent,contentParts,notarySigning,encodeNotary,validateNotary,decodeNotary} from './notary-protocol.js';
import {readMessage} from './reader.js';
import {authenticateNotary} from './notary-reader.js';
import {cacheRequest} from './cache-client.js';
const key='tapesign-v2:notary-pending',outboxKey='tapesign-v2:notary-submissions';
export function pendingNotary(){const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null;}
export function recentNotaries(){return JSON.parse(localStorage.getItem(outboxKey)||'[]');}
function save(job){if(job===null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(job));globalThis.dispatchEvent(new Event('tapesign:notary-progress'));}
function acceptBroadcast(job){
 const p=job.pending;if(!p)return;
 if(!p.hash)throw Error('钱包发送结果未知，请从钱包活动复制交易哈希后恢复，勿重复付款');
 if(!/^0x[0-9a-f]{64}$/i.test(p.hash))throw Error('已保存的交易哈希无效，请核对钱包活动');
 const loc={chainId:job.claim.owner.chainId,tx:p.hash.toLowerCase()};
 if(p.kind==='chunk')job.chunks[p.index]=loc;else{job.final=loc;job.finalRecord=decodeNotary(p.payload);}
 job.pending=null;save(job);
}
// Read-only recovery of persisted wallet responses, with no RPC scan or wallet prompt.
export async function recheckNotary(){
 if(!navigator.locks)return null;
 return navigator.locks.request(key,{ifAvailable:true},async lock=>{if(!lock)return null;const job=pendingNotary();if(job?.pending?.hash)acceptBroadcast(job);return job;});
}
export async function prepareNotary({name,kind,visibility,value}){
 if(pendingNotary())throw Error('已有待完成公证，请先继续或核验，避免重复提交');
 const info=describeContent(value,kind),parts=contentParts(info,visibility),owner=await resolveIdentity(name),nonce=hexlify(randomBytes(32)),createdAt=Date.now();
 return {claim:{protocol:NOTARY_PROTOCOL,type:'notarize',id:notaryNumber(createdAt,nonce),createdAt,nonce,owner,visibility,kind,mime:info.mime,size:info.size,hash:info.hash,content:visibility==='private'?null:parts.length===1?{inline:parts[0],chunks:[]}:{inline:null,chunks:[]}},parts:parts.length>1?parts:[],chunks:[],pending:null,final:null};
}
export const notaryTransactions=job=>job.parts.length+1;
export function retainNotary(job){if(pendingNotary())throw Error('已有待完成公证');save(job);}
export function discardUnsentNotary(){const job=pendingNotary();if(job&&(job.pending||job.chunks.length||job.final))throw Error('已有交易发送记录，不能丢弃后重发');save(null);}
// A manually entered hash is untrusted and still needs one targeted match before reuse.
export async function recoverNotary(hash){
 if(!navigator.locks)throw Error('请使用支持 Web Locks 的浏览器');
 return navigator.locks.request(key,{ifAvailable:true},async lock=>{
  if(!lock)throw Error('另一页面正在处理公证');const job=pendingNotary();if(!job?.pending||job.pending.hash)throw Error('没有需要恢复哈希的交易');
  if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('请输入钱包里的完整交易哈希');
  const loc={chainId:job.claim.owner.chainId,tx:hash.toLowerCase()},ctx=context(),m=await readMessage(loc,ctx,{decoder:decodeNotary,allowPending:true});
  await authenticateNotary(m,job.claim.owner,ctx);if(encodeNotary(m.record)!==job.pending.payload||m.ref!==job.claim.hash)throw Error('恢复交易与当前公证内容不符');await ctx.assert();
  job.pending.hash=loc.tx;save(job);acceptBroadcast(job);return job;
 });
}
export async function checkNotaryCache(job){
 let result;try{result=await cacheRequest('/notary/check?'+new URLSearchParams({hash:job.claim.hash,id:job.claim.id,owner:job.claim.owner.name}));}catch{throw Error('RPC 缓存查重暂不可用，尚未发送新交易；请稍后继续原公证。');}
 if(result.hash!==job.claim.hash||result.id!==job.claim.id||result.scope!=='indexed-records'||!Number.isSafeInteger(result.checkedAt)||Math.abs(Date.now()-result.checkedAt)>120000||!['passed','duplicate','pending_conflict'].includes(result.status))throw Error('缓存查重响应无效或过期，尚未发送新交易');
 job.cacheCheck=result;save(job);
 if(result.status==='duplicate')throw Error('缓存发现相同内容的已核验公证，请先通过内容公开查询核对，未发送新交易。');
 if(result.status==='pending_conflict')throw Error('相同内容已有待核验公证，请等待服务器核验后再继续，未发送新交易。');
 return result;
}
export async function publishNotary(progress=()=>{}){
 if(!navigator.locks)throw Error('请使用支持 Web Locks 的 Chrome 或 Edge');
 return navigator.locks.request(key,{ifAvailable:true},async lock=>{
  if(!lock)throw Error('另一页面正在发送公证，请等待');const job=pendingNotary();if(!job)throw Error('没有待提交公证');
  if(job.pending)acceptBroadcast(job);if(job.final)return job.final;
  progress('正在通过 RPC 缓存查重…');await checkNotaryCache(job);
  const owner=job.claim.owner,wallet=await authorize(owner,progress),network=config.networks.find(n=>String(n.chainId)===owner.chainId);
  async function walletUnchanged(){const accounts=await wallet.request({method:'eth_accounts'});if(accounts[0]?.toLowerCase()!==owner.holder||BigInt(await wallet.request({method:'eth_chainId'}))!==BigInt(owner.chainId))throw Error('钱包账户或网络已变化');}
  async function send(record,kind,index){
   await walletUnchanged();const payload=encodeNotary(record),tx={from:owner.holder,to:network.hub,value:'0x0',data:ABI.encodeFunctionData('send',[owner.processor,owner.tokenId,NOTARY_ENDPOINT,job.claim.hash,payload]),chainId:toQuantity(owner.chainId)};
   const gas=await wallet.request({method:'eth_estimateGas',params:[tx]});await walletUnchanged();
   job.pending={kind,index,payload,hash:null};save(job);
   let hash;try{hash=await wallet.request({method:'eth_sendTransaction',params:[{...tx,gas:toQuantity(BigInt(gas)*120n/100n)}]});}catch(e){if(Number(e.code)===4001){job.pending=null;save(job);}throw e;}
   if(!/^0x[0-9a-f]{64}$/i.test(hash||''))throw Error('钱包未返回交易哈希，请核对钱包记录');
   // Persist the returned hash before any further operation; never rebroadcast it.
   job.pending.hash=hash.toLowerCase();save(job);acceptBroadcast(job);
   progress('交易已提交：'+hash+'；链上核验交由服务器后台完成。');
  }
  for(let i=job.chunks.length;i<job.parts.length;i++){progress('提交原图 / 原文分块 '+(i+1)+' / '+job.parts.length);await send({protocol:NOTARY_PROTOCOL,type:'chunk',id:job.claim.id,owner,hash:job.claim.hash,index:i,total:job.parts.length,data:job.parts[i]},'chunk',i);}
  if(job.parts.length)job.claim.content={inline:null,chunks:job.chunks};
  // Recheck after a long series of wallet confirmations, without scanning either chain.
  if(Date.now()-job.cacheCheck.checkedAt>30000)await checkNotaryCache(job);
  const data=notarySigning(job.claim,network.hub),types={EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}],...data.types};
  progress('请在钱包确认内容归属声明，然后确认公证交易…');await walletUnchanged();
  const signature=await wallet.request({method:'eth_signTypedData_v4',params:[owner.holder,JSON.stringify({...data,types,primaryType:'Notarization'})]});
  const record=validateNotary({protocol:NOTARY_PROTOCOL,type:'notarize',claim:job.claim,signature:signature.toLowerCase()},config.networks);await send(record,'final',0);return job.final;
 });
}
export function finishNotary(location){
 const job=pendingNotary();if(!job?.final||!same(job.final,location))return;
 const list=recentNotaries(),prior=list.find(s=>same(s.location,location));
 if(!prior){const submission={location,record:job.finalRecord||null,cacheCheck:job.cacheCheck||null,submittedAt:Date.now(),acknowledged:false};const kept=[...list.filter(s=>!s.acknowledged),...list.filter(s=>s.acknowledged).slice(0,99)];localStorage.setItem(outboxKey,JSON.stringify([submission,...kept]));}
 const recent=JSON.parse(localStorage.getItem('tapesign-v2:notary-recent')||'[]');localStorage.setItem('tapesign-v2:notary-recent',JSON.stringify([location,...recent.filter(l=>!same(l,location))].slice(0,100)));save(null);
}
let syncing=false;
export async function syncNotarySubmissions({signal}={}){
 if(syncing)return;syncing=true;
 try{for(const item of recentNotaries().filter(s=>!s.acknowledged).slice(0,3)){
  signal?.throwIfAborted();
  await cacheRequest(item.record?'/notary/submit':'/notary/notify',{method:'POST',signal,body:JSON.stringify(item.record?{location:item.location,record:item.record}:item.location)});
  // Read the latest storage value so a concurrent tab's new submissions are retained.
  const latest=recentNotaries();for(const s of latest)if(same(s.location,item.location))s.acknowledged=true;localStorage.setItem(outboxKey,JSON.stringify(latest));
 }}finally{syncing=false;}
}
