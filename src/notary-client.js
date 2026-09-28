import {hexlify,randomBytes,toQuantity,decodeBase64} from 'ethers';
import {authorize,resolveIdentity,context,config,ABI} from './rpc.js';
import {same} from './protocol.js';
import {NOTARY_PROTOCOL,NOTARY_ENDPOINT,notaryNumber,describeContent,contentParts,notarySigning,encodeNotary,validateNotary,decodeNotary,validateChunk} from './notary-protocol.js';
import {readMessage} from './reader.js';
import {authenticateNotary} from './notary-reader.js';
import {cacheRequest} from './cache-client.js';
const key='tapesign-v2:notary-pending';
export function pendingNotary(){const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null;}
function save(job){if(job===null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(job));globalThis.dispatchEvent(new Event('tapesign:notary-progress'));}
// This path only verifies already-broadcast transactions; it never connects a wallet.
export async function recheckNotary(progress=()=>{}){
 if(!navigator.locks)return null;
 return navigator.locks.request(key,{ifAvailable:true},async lock=>{
  if(!lock)return null;const job=pendingNotary();if(!job?.pending?.hash)return job;
  await checkPending(job,progress);return job;
 });
}
export async function prepareNotary({name,kind,visibility,value}){
 if(pendingNotary())throw Error('已有待完成公证，请先继续或核验，避免重复提交');
 const info=describeContent(value,kind),parts=contentParts(info,visibility),owner=await resolveIdentity(name),nonce=hexlify(randomBytes(32)),createdAt=Date.now();
 const job={claim:{protocol:NOTARY_PROTOCOL,type:'notarize',id:notaryNumber(createdAt,nonce),createdAt,nonce,owner,visibility,kind,mime:info.mime,size:info.size,hash:info.hash,content:visibility==='private'?null:parts.length===1?{inline:parts[0],chunks:[]}:{inline:null,chunks:[]}},parts:parts.length>1?parts:[],chunks:[],pending:null,final:null};
 return job;
}
export const notaryTransactions=job=>job.parts.length+1;
export function retainNotary(job){if(pendingNotary())throw Error('已有待完成公证');save(job);}
export function discardUnsentNotary(){const job=pendingNotary();if(job&&(job.pending||job.chunks.length||job.final))throw Error('已有交易发送记录，不能丢弃后重发');save(null);}
async function checkPending(job,progress){
 const p=job.pending;if(!p)return;if(!p.hash)throw Error('钱包发送结果未知，请从钱包活动复制交易哈希后恢复，勿重复付款');
 const loc={chainId:job.claim.owner.chainId,tx:p.hash},ctx=context(undefined,progress);
 const m=await readMessage(loc,ctx,{decoder:decodeNotary,allowPending:true});await authenticateNotary(m,job.claim.owner,ctx);
 if(encodeNotary(m.record)!==p.payload||m.ref!==job.claim.hash)throw Error('恢复交易与当前公证内容不符');await ctx.assert();
 if(p.kind==='chunk')job.chunks[p.index]=loc;else job.final=loc;job.pending=null;save(job);
}
async function waitPending(job,progress){
 const started=Date.now();
 for(let attempt=0;;attempt++){
  try{await checkPending(job,progress);return;}catch(e){
   if(!['TRANSACTION_PENDING','RPC_SYNC_PENDING','RPC_UNAVAILABLE'].includes(e.code))throw e;
   if(attempt>=14||Date.now()-started>=30000)throw e;
   progress('交易 '+job.pending?.hash+' 已提交；'+(e.code==='RPC_UNAVAILABLE'?'节点暂不可用':'等待两家节点同步')+'，2 秒后自动重查，不会重复发送。');
   await new Promise(r=>setTimeout(r,2000));
  }
 }
}
export async function recoverNotary(hash){const job=pendingNotary();if(!job?.pending||job.pending.hash)throw Error('没有需要恢复哈希的交易');if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('请输入钱包里的完整交易哈希');job.pending.hash=hash.toLowerCase();try{await checkPending(job,()=>{});}catch(e){job.pending.hash=null;throw e;}return job;}
async function verifyUploadedChunks(job,progress){
 if(!job.chunks.length)return;const ctx=context(undefined,progress);
 for(let i=0;i<job.chunks.length;i++){
  const m=await readMessage(job.chunks[i],ctx,{decoder:decodeNotary,allowPending:true});
  const bytes=validateChunk(m.record);await authenticateNotary(m,job.claim.owner,ctx);
  if(m.record.id!==job.claim.id||m.record.hash!==job.claim.hash||m.record.index!==i||m.record.total!==job.parts.length||m.record.data!==job.parts[i]||m.ref!==job.claim.hash||bytes.length!==decodeBase64(job.parts[i]).length)throw Error('已上传分块与当前公证不符，请保留记录核对');
 }
 await ctx.assert();
}
export async function publishNotary(progress=()=>{}){
 if(!navigator.locks)throw Error('请使用支持 Web Locks 的 Chrome 或 Edge');
 return navigator.locks.request(key,{ifAvailable:true},async lock=>{
  if(!lock)throw Error('另一页面正在发送公证，请等待');const job=pendingNotary();if(!job)throw Error('没有待提交公证');
  await waitPending(job,progress);if(job.final)return job.final;const owner=job.claim.owner;
  if(!same(await resolveIdentity(owner.name),owner))throw Error('容器持有人已变化，不能继续原公证');
  async function send(record,kind,index){
   const wallet=await authorize(owner,progress),network=config.networks.find(n=>String(n.chainId)===owner.chainId),payload=encodeNotary(record);
   const tx={from:owner.holder,to:network.hub,value:'0x0',data:ABI.encodeFunctionData('send',[owner.processor,owner.tokenId,NOTARY_ENDPOINT,job.claim.hash,payload]),chainId:toQuantity(owner.chainId)};
   const gas=await wallet.request({method:'eth_estimateGas',params:[tx]});
   if(kind==='final')await verifyUploadedChunks(job,progress);
   const accounts=await wallet.request({method:'eth_accounts'});if(accounts[0]?.toLowerCase()!==owner.holder||BigInt(await wallet.request({method:'eth_chainId'}))!==BigInt(owner.chainId))throw Error('钱包账户或网络已变化');
   job.pending={kind,index,payload,hash:null};save(job);
   let hash;try{hash=await wallet.request({method:'eth_sendTransaction',params:[{...tx,gas:toQuantity(BigInt(gas)*120n/100n)}]});}catch(e){if(Number(e.code)===4001){job.pending=null;save(job);}throw e;}
   if(!/^0x[0-9a-f]{64}$/i.test(hash||''))throw Error('钱包未返回交易哈希，请核对钱包记录');
   job.pending.hash=hash.toLowerCase();save(job);progress('交易已提交：'+hash+'；正在核验，不会重复发送。');
   if(kind==='final')void cacheRequest('/notary/notify',{method:'POST',body:JSON.stringify({chainId:owner.chainId,tx:hash.toLowerCase()})}).catch(()=>{});
   await waitPending(job,progress);
  }
  for(let i=job.chunks.length;i<job.parts.length;i++){progress('上传原图 / 原文分块 '+(i+1)+' / '+job.parts.length);await send({protocol:NOTARY_PROTOCOL,type:'chunk',id:job.claim.id,owner,hash:job.claim.hash,index:i,total:job.parts.length,data:job.parts[i]},'chunk',i);}
  if(job.parts.length)job.claim.content={inline:null,chunks:job.chunks};
  const wallet=await authorize(owner,progress),network=config.networks.find(n=>String(n.chainId)===owner.chainId),data=notarySigning(job.claim,network.hub);
  progress('请在钱包确认内容归属声明，然后确认公证交易…');
  const types={EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}],...data.types};
  const signature=await wallet.request({method:'eth_signTypedData_v4',params:[owner.holder,JSON.stringify({...data,types,primaryType:'Notarization'})]});
  const record=validateNotary({protocol:NOTARY_PROTOCOL,type:'notarize',claim:job.claim,signature:signature.toLowerCase()},config.networks);await send(record,'final',0);return job.final;
 });
}
export function finishNotary(location){const job=pendingNotary();if(job?.final&&same(job.final,location)){const raw=localStorage.getItem('tapesign-v2:notary-recent'),list=raw?JSON.parse(raw):[];localStorage.setItem('tapesign-v2:notary-recent',JSON.stringify([location,...list].slice(0,100)));save(null);}}
