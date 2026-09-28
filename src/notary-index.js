import {Interface,toQuantity} from 'ethers';
import {context,ABI,header} from './rpc.js';
import {digest} from './vendor/protocol.js';
import {NOTARY_ENDPOINT,decodeNotary,notaryRow,validateNotary} from './notary-protocol.js';
import {config} from './rpc.js';
import {loadNotarization} from './notary-reader.js';
const paging=new Interface(['function inboxPage(bytes32,uint256,uint256) view returns(tuple(address from,uint56 blockNumber,uint40 timestamp,bytes32 digest)[])']);
export const notaryKey=l=>l.chainId+'/'+l.tx;
const normalizeLogs=logs=>logs.map(l=>({address:l.address.toLowerCase(),topics:l.topics.map(x=>x.toLowerCase()),data:l.data.toLowerCase(),transactionHash:l.transactionHash.toLowerCase(),blockHash:l.blockHash.toLowerCase(),removed:l.removed===true})).sort((a,b)=>a.transactionHash.localeCompare(b.transactionHash)||a.data.localeCompare(b.data));
export async function scanNotaryChain(chain,{ctx=context(),onUpdate=()=>{},signal,load=loadNotarization}={}){
 const check=()=>{if(signal?.aborted)throw new DOMException('查询已取消','AbortError');};check();
 const rpc=ctx.rpc(chain),head=await ctx.head(chain,'latest'),at=toQuantity(head.number);await rpc.attest(at);
 const [raw]=await rpc.call(rpc.net.hub,'inboxCount',[NOTARY_ENDPOINT],at),total=Number(raw);if(!Number.isSafeInteger(total)||total<0)throw Error('公证索引数量无效');
 const rows=[],bundles=[],invalid=[],logsByBlock=new Map();let checked=0;
 onUpdate({chain,total,checked,rows:[],complete:false,head});
 // Enumerate EVERY mailbox entry. The cache cannot choose which hashes we inspect.
 for(let start=0;start<total;start+=40){
  check();const count=Math.min(40,total-start),data=paging.encodeFunctionData('inboxPage',[NOTARY_ENDPOINT,start,count]);
  const [entries]=paging.decodeFunctionResult('inboxPage',await rpc.agree('eth_call',[{to:rpc.net.hub,data},at]));
  if(entries.length!==count)throw Error('公证分页不完整，不能声明全量核验完成');
  for(let j=0;j<entries.length;j++){
   check();const entry=entries[j],number=String(entry.blockNumber);
   if(!logsByBlock.has(number)){const h=await rpc.agree('eth_getBlockByNumber',[toQuantity(number),false],header);
    const logs=await rpc.agree('eth_getLogs',[{address:rpc.net.hub,fromBlock:toQuantity(number),toBlock:toQuantity(number),topics:[ABI.getEvent('Sent').topicHash,NOTARY_ENDPOINT]}],normalizeLogs);
    if(logs.some(l=>l.removed||l.blockHash!==h.hash||l.address!==rpc.net.hub))throw Error('公证日志区块不一致');logsByBlock.set(number,{logs,head:h});}
   const {logs,head:block}=logsByBlock.get(number);
   const hits=logs.map(l=>{try{return {log:l,event:ABI.parseLog(l)};}catch{return null;}}).filter(x=>x?.event?.name==='Sent'&&x.event.args.to.toLowerCase()===NOTARY_ENDPOINT&&x.event.args.inboxIndex===BigInt(start+j));
   if(hits.length!==1)throw Error('公证信箱存在缺失或重复日志');const {log,event}=hits[0],a=event.args;
   if(a.from.toLowerCase()!==entry.from.toLowerCase()||digest(a.ref.toLowerCase(),a.payload.toLowerCase())!==entry.digest.toLowerCase()||block.timestamp!==String(entry.timestamp))throw Error('公证事件与信箱摘要不符');
   let record;try{record=decodeNotary(a.payload.toLowerCase());}catch{/* Foreign/malformed messages occupy indices but are not notarizations. */}
   if(record?.type==='notarize'){
    const location={chainId:chain,tx:log.transactionHash};
    let valid=true;try{validateNotary(record,config.networks);}catch{valid=false;invalid.push({location,error:'INVALID_NOTARIZATION'});}
    if(valid){const bundle=await load(location,ctx,{allowPending:true});bundles.push(bundle);rows.push(notaryRow(bundle));}
   }
   checked++;
  }
  onUpdate({chain,total,checked,rows:[...rows],bundles:[...bundles],invalid:[...invalid],complete:false,head});
 }
 check();if((await rpc.agree('eth_getBlockByNumber',[at,false],header)).hash!==head.hash)throw Error('公证全量查询期间区块变化');await ctx.assert();
 const result={chain,total,checked,rows,bundles,invalid,complete:true,head,checkedAt:Date.now()};onUpdate(result);return result;
}
export async function auditNotary({makeContext=()=>context(),onUpdate=()=>{},signal,chains=['196','56']}={}){
 const states=new Map(),emit=()=>onUpdate({states:[...states.values()],complete:false});
 const results=await Promise.allSettled(chains.map(async chain=>{try{return await scanNotaryChain(chain,{ctx:makeContext(),signal,onUpdate:s=>{states.set(chain,s);emit();}});}catch(e){states.set(chain,{...(states.get(chain)||{chain,total:0,checked:0,rows:[]}),complete:false,error:e.message});emit();throw e;}}));
 if(signal?.aborted)throw new DOMException('查询已取消','AbortError');
 const result={states:[...states.values()],complete:results.every(r=>r.status==='fulfilled'),checkedAt:Date.now()};onUpdate(result);return result;
}
export function queryNotaries(rows,{hash='',owner='',q='',sort='desc',page=1,pageSize=12}={}){
 if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>50||!['asc','desc'].includes(sort))throw Error('分页参数无效');
 const term=String(q).trim().toLowerCase();
 const all=[...new Map(rows.map(r=>[notaryKey(r.location),r])).values()].filter(r=>(!hash||r.hash===hash)&&(!owner||r.owner===owner)&&(!term||[r.id,r.owner,r.hash,r.preview||''].some(v=>v.toLowerCase().includes(term))));
 const groups=new Map();for(const r of all){const k=r.id+'|'+r.owner+'|'+r.hash;const old=groups.get(k);if(!old||r.timestamp<old.timestamp)groups.set(k,r);}
 const sorted=[...groups.values()].sort((a,b)=>(sort==='asc'?1:-1)*(a.timestamp-b.timestamp)||notaryKey(a.location).localeCompare(notaryKey(b.location)));
 return {rows:sorted.slice((page-1)*pageSize,page*pageSize),total:sorted.length,page,pageSize,pages:Math.max(1,Math.ceil(sorted.length/pageSize))};
}
