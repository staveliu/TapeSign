import { Interface, toQuantity } from 'ethers';
import { ABI, header, context } from './rpc.js';
import { readLocal, saveLocal } from './storage.js';
import { decode, anchor } from './protocol.js';
import { digest } from './vendor/protocol.js';
import { RPC_UNAVAILABLE } from './rpc-http.js';
import { historyRow } from './history.js';
const paging = new Interface(['function inboxPage(bytes32,uint256,uint256) view returns(tuple(address from,uint56 blockNumber,uint40 timestamp,bytes32 digest)[])']);
export const PAGE_SIZE = 12;
export function windowFor(count, previous, older = false, limit = PAGE_SIZE) {
  if (!Number.isSafeInteger(count) || count<0 || !Number.isSafeInteger(limit) || limit<1) throw Error('Invalid count');
  const valid = previous && Number.isSafeInteger(previous.low) && Number.isSafeInteger(previous.high) && previous.low>=0 && previous.low<=previous.high && previous.high<=count;
  if (!valid) return {start:Math.max(0,count-limit),end:count,low:Math.max(0,count-limit),high:count};
  if (older) {const start=Math.max(0,previous.low-limit);return {start,end:previous.low,low:start,high:previous.high};}
  const end=Math.min(count,previous.high+limit);
  return {start:previous.high,end,low:previous.low,high:end};
}
// Local rows are discovery hints only. Opening always re-verifies chain evidence.
export async function syncIndex(identity, {older=false,ctx=context(),onUpdate=()=>{},chains=['196','56'],inboxOnly=false} = {}) {
  const rows=[], progress=[], errors=[], pending=new Set(chains);
  const snapshot=()=>({rows:[...new Map(rows.map(r=>[r.location.chainId+'/'+r.location.tx,r])).values()],progress:[...progress],errors:[...errors],pending:[...pending],partial:errors.length>0});
  const results=await Promise.allSettled(chains.map(async chain=>{
    let direction='all';
    try {
    // Discovery may use latest: rows are hints and opening performs full checks.
    // Retain/recheck the cursor's block hash so a reorg rebuilds the window.
    const rpc=ctx.rpc(chain), head=await ctx.head(chain,'latest'), at=toQuantity(head.number);
    await rpc.attest(at);
    for (direction of !inboxOnly&&chain===identity.chainId?['in','out']:['in']) {
      const key=`index:${chain}:${identity.endpoint}:${direction}`, saved=readLocal(key);
      let previous=saved;
      if (saved?.block) {
        if(BigInt(saved.block.number)>BigInt(head.number))previous=null;
        else{const old=await rpc.agree('eth_getBlockByNumber',[toQuantity(saved.block.number),false],header);if(old.hash!==saved.block.hash)previous=null;}
      }
      const [rawCount]=await rpc.call(rpc.net.hub,direction==='in'?'inboxCount':'outboxCount',[direction==='in'?identity.endpoint:identity.container],at);
      const count=Number(rawCount), win=windowFor(count,previous,older), fresh=[];
      if (win.end>win.start) {
        let entries;
        if (direction==='out') [entries]=await rpc.call(rpc.net.hub,'outboxPage',[identity.container,win.start,win.end-win.start],at);
        else {
          const data=paging.encodeFunctionData('inboxPage',[identity.endpoint,win.start,win.end-win.start]);
          const bytes=await rpc.agree('eth_call',[{to:rpc.net.hub,data},at]);
          [entries]=paging.decodeFunctionResult('inboxPage',bytes);
        }
        if (entries.length!==win.end-win.start) throw Error('信箱分页不完整，保留旧进度');
        for (const number of new Set(entries.map(e=>String(e.blockNumber)))) {
          const atBlock=toQuantity(number), topic=ABI.getEvent('Sent').topicHash;
          const topics=direction==='in'?[topic,identity.endpoint]:[topic,null,'0x'+identity.container.slice(2).padStart(64,'0')];
          const logs=await rpc.agree('eth_getLogs',[{address:rpc.net.hub,fromBlock:atBlock,toBlock:atBlock,topics}],logs=>logs.map(l=>({address:l.address.toLowerCase(),topics:l.topics.map(t=>t.toLowerCase()),data:l.data.toLowerCase(),hash:l.transactionHash.toLowerCase(),removed:l.removed===true})).sort((a,b)=>a.hash.localeCompare(b.hash)||a.data.localeCompare(b.data)));
          for(let offset=0;offset<entries.length;offset++){
            const entry=entries[offset];if(String(entry.blockNumber)!==number)continue;
            const expectedIndex=win.start+offset;
            const matches=logs.filter(l=>!l.removed&&l.address===rpc.net.hub).map(log=>{try{return {log,event:ABI.parseLog(log)};}catch{return null;}}).filter(x=>{
              if(x?.event?.name!=='Sent')return false;const a=x.event.args;
              return Number(direction==='in'?a.inboxIndex:a.outboxIndex)===expectedIndex && digest(a.ref.toLowerCase(),a.payload.toLowerCase())===entry.digest.toLowerCase() && (direction==='in'?(a.to.toLowerCase()===identity.endpoint&&a.from.toLowerCase()===entry.from.toLowerCase()):(a.from.toLowerCase()===identity.container&&a.to.toLowerCase()===entry.to.toLowerCase()&&a.inboxIndex===entry.inboxIndex));
            });
            if(matches.length!==1)throw Error('信箱日志缺失或重复，未推进索引游标');
            const {log,event}=matches[0];
            try{const r=decode(event.args.payload.toLowerCase());if(!['offer','accept','seal'].includes(r.type))continue;const row=historyRow(r,anchor({chainId:chain,tx:log.hash}));row.createdAt=Number(entry.timestamp)*1000;if(!row.parties.length)row.parties=[identity.name];fresh.push(row);}catch{/* Other apps and V1 messages are not migrated. */}
          }
        }
      }
      if ((await rpc.agree('eth_getBlockByNumber',[at,false],header)).hash!==head.hash) throw Error('索引区块变化，请重试');
      const combined=[...(previous?.rows||[]),...fresh];
      const unique=[...new Map(combined.map(r=>[r.location.chainId+'/'+r.location.tx,r])).values()].slice(-1000);
      saveLocal(key,{low:win.low,high:win.high,block:head,rows:unique}); rows.push(...unique);
      progress.push({chain,direction,loaded:win.high-win.low,total:count,hasOlder:win.low>0,hasNewer:win.high<count});
      onUpdate(snapshot());
    }
    } catch(error) {
      // Availability failures can leave a partial discovery list. Evidence
      // disagreement, code changes, reorgs and incomplete logs still fail.
      if(error.code!==RPC_UNAVAILABLE)throw error;
      errors.push({chain,direction,message:error.message});
    } finally { pending.delete(chain); }
    onUpdate(snapshot());
  }));
  const failed=results.find(r=>r.status==='rejected');
  if(failed)throw failed.reason;
  return snapshot();
}
