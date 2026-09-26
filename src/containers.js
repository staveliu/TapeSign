import {Interface,toQuantity} from 'ethers';
import {context,header} from './rpc.js';
import {RPC_UNAVAILABLE} from './rpc-http.js';

// TapeOut's official container page uses cpuCount/cpuAt/nextId/ownerOf
// through Multicall3, then isOpened. See docs/CONTAINER-DISCOVERY.md.
// These are discovery hints. Selecting and signing re-resolve the identity.
export const MULTICALL='0xca11bde05977b3631167028862be2a173976ca11';
export const DISCOVERY_BATCH=128, DISCOVERY_LIMIT=2000;
export const DISCOVERY_ABI=new Interface([
  'function cpuCount() view returns(uint256)',
  'function cpuAt(uint256) view returns(address)',
  'function nextId() view returns(uint256)',
  'function ownerOf(uint256) view returns(address)',
  'function isOpened(address,uint256) view returns(bool)',
]);
export const MULTICALL_ABI=new Interface(['function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) payable returns(tuple(bool success,bytes returnData)[] returnData)']);
export const containerLabel=value=>String(value||'').trim().replace(/[.]tape$/i,'');
const address=/^0x[0-9a-f]{40}$/i;
function integer(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw Error('容器查询计数无效');return n;}

export async function discoveryBatch(rpc,calls,at){
  const values=[];
  for(let offset=0;offset<calls.length;offset+=DISCOVERY_BATCH){
    const group=calls.slice(offset,offset+DISCOVERY_BATCH);
    const head=typeof at==='function'?await at():null,block=head?toQuantity(head.number):at;
    const data=MULTICALL_ABI.encodeFunctionData('aggregate3',[group.map(c=>({target:c.to,allowFailure:true,callData:DISCOVERY_ABI.encodeFunctionData(c.fn,c.args||[])}))]);
    const bytes=await rpc.agree('eth_call',[{to:MULTICALL,data},block]);
    if(head&&(await rpc.agree('eth_getBlockByNumber',[block,false],header)).hash!==head.hash)throw Error('容器查询期间区块重组，请重新查找');
    const [result]=MULTICALL_ABI.decodeFunctionResult('aggregate3',bytes);
    if(result.length!==group.length)throw Error('容器批量查询结果不完整');
    result.forEach((r,i)=>values.push(r.success?DISCOVERY_ABI.decodeFunctionResult(group[i].fn,r.returnData)[0]:null));
  }
  return values;
}

export function createContainerDiscovery(wallet,{ctx=context(),chains=['196','56'],signal}={}){
  if(!address.test(wallet))throw Error('钱包地址无效');
  const owner=wallet.toLowerCase(),states=new Map(chains.map(chain=>[String(chain),{chain:String(chain),rows:[],scanned:0,unreadable:0,done:false}]));
  let running=false;
  const active=()=>{if(signal?.aborted)throw new DOMException('容器查询已取消','AbortError');};
  const snapshot=()=>({wallet:owner,rows:[...states.values()].flatMap(s=>s.rows),progress:[...states.values()].map(s=>({chain:s.chain,scanned:s.scanned,unreadable:s.unreadable,done:s.done,error:s.error||null})),hasMore:[...states.values()].some(s=>!s.done)});
  async function scanChain(state,limit,onUpdate){
    const chain=state.chain,rpc=ctx.rpc(chain);state.error=null;
    try{
      active();
      if(!state.head){const head=await ctx.head(chain,'latest');await rpc.attest(toQuantity(head.number));state.head=head;}
      // Discovery is a paginated set of hints, not an atomic ownership proof.
      // Refresh the agreed height while scanning to avoid public-node archive
      // restrictions. Each batch rechecks its block; selection proves ownership.
      const at=async()=>{active();if(!state.liveHead||Date.now()-state.liveAt>3000){state.liveHead=await rpc.pin('latest');state.liveAt=Date.now();}return state.liveHead;};
      if(!state.processors){
        const [rawCount]=await discoveryBatch(rpc,[{to:rpc.net.factory,fn:'cpuCount'}],at);
        if(rawCount===null)throw Error('读不到处理器数量');
        const count=integer(rawCount);if(count>20000)throw Error('处理器数量过多，请手动输入容器 ID');
        const cpus=await discoveryBatch(rpc,Array.from({length:count},(_,i)=>({to:rpc.net.factory,fn:'cpuAt',args:[i]})),at);
        if(cpus.some(cpu=>!address.test(cpu)))throw Error('处理器列表不完整');
        const maxIds=await discoveryBatch(rpc,cpus.map(cpu=>({to:cpu,fn:'nextId'})),at);
        const processors=cpus.map((cpu,i)=>({cpu:cpu.toLowerCase(),index:i,max:maxIds[i]===null?null:integer(maxIds[i])})).reverse();
        state.unreadable=processors.filter(p=>p.max===null).length;
        state.processors=processors.filter(p=>p.max!==null&&p.max>0);state.cpu=0;state.token=state.processors[0]?.max||0;
      }
      let remaining=limit;
      while(state.cpu<state.processors.length&&remaining>0){
        active();
        let cpu=state.cpu,token=state.token;const slots=[];
        while(cpu<state.processors.length&&slots.length<Math.min(DISCOVERY_BATCH,remaining)){
          const p=state.processors[cpu];slots.push({cpu:p.cpu,index:p.index,token});
          if(--token<1){cpu++;token=state.processors[cpu]?.max||0;}
        }
        const owners=await discoveryBatch(rpc,slots.map(s=>({to:s.cpu,fn:'ownerOf',args:[s.token]})),at);
        const owned=slots.filter((_,i)=>typeof owners[i]==='string'&&owners[i].toLowerCase()===owner);
        const opened=await discoveryBatch(rpc,owned.map(s=>({to:rpc.net.opener,fn:'isOpened',args:[s.cpu,s.token]})),at);
        active();
        // Each batch was checked before publishing hints or advancing a page.
        const additions=owned.filter((_,i)=>opened[i]===true).map(s=>({name:`${s.token}.${chain==='196'?'2.':''}${s.index}`,chainId:chain,processor:s.cpu,tokenId:String(s.token)}));
        state.rows.push(...additions);state.scanned+=slots.length;state.unreadable+=owners.filter(x=>x===null).length+opened.filter(x=>x===null).length;
        state.cpu=cpu;state.token=token;remaining-=slots.length;state.done=cpu>=state.processors.length;onUpdate(snapshot());
      }
      state.done=state.cpu>=state.processors.length;
    }catch(e){
      if(e.name==='AbortError')throw e;
      if(e.code!==RPC_UNAVAILABLE){state.rows=[];state.done=false;state.error=e.message;throw e;}
      state.error=e.message;
    }
    onUpdate(snapshot());
  }
  return {wallet:owner,snapshot,async scan({limit=DISCOVERY_LIMIT,onUpdate=()=>{}}={}){
    if(running)throw Error('容器查询正在进行');
    if(!Number.isSafeInteger(limit)||limit<1||limit>10000)throw Error('容器查询批次无效');
    running=true;
    try{const results=await Promise.allSettled([...states.values()].filter(s=>!s.done).map(s=>scanChain(s,limit,onUpdate)));const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;return snapshot();}finally{running=false;}
  }};
}
