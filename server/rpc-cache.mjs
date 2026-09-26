const height=v=>typeof v==='string'&&/^0x[0-9a-f]+$/i.test(v)?BigInt(v):null;
export function pinnedHeight(body,result){
  const p=body.params;
  if(['eth_getTransactionReceipt','eth_getTransactionByHash'].includes(body.method))return height(result?.blockNumber);
  if(body.method==='eth_getCode'||body.method==='eth_call')return height(p[1]);
  if(body.method==='eth_getStorageAt')return height(p[2]);
  if(body.method==='eth_getLogs')return p[0]?.fromBlock===p[0]?.toBlock?height(p[0]?.toBlock):null;
  return null; // Heads and block hashes must always be independently refreshed.
}
export function cacheable(body,result,finalized){
  if(result===null||result===undefined||!finalized)return false;
  const n=pinnedHeight(body,result);return n!==null&&n<=BigInt(finalized.number);
}
export class RpcCache {
  constructor(store,networks,upstream,{now=Date.now}={}){this.store=store;this.networks=networks;this.upstream=upstream;this.now=now;this.finalized=new Map();this.inflight=new Map();this.hits=0;this.misses=0;}
  setFinalized(chain,head){this.finalized.set(String(chain),head);}
  async request(url,body,{fresh=false}={}){
    const n=this.networks.find(n=>n.rpcs.includes(url));if(!n)throw Error('Unknown RPC slot');
    const slot=n.rpcs.indexOf(url),key=JSON.stringify([String(n.chainId),slot,body.method,body.params]),head=this.finalized.get(String(n.chainId));
    const cached=!fresh?this.store.get('rpc',key):null;
    if(cached&&this.now()-cached.checkedAt<3600000&&cacheable(body,cached.result,head)){this.hits++;return {jsonrpc:'2.0',id:body.id,result:cached.result};}
    const pendingKey=key+'/'+fresh;if(this.inflight.has(pendingKey)){const r=await this.inflight.get(pendingKey);return {...r,id:body.id};}
    const task=(async()=>{this.misses++;const answer=await this.upstream(url,body);
      if(answer.error||answer.result===undefined)throw Error(answer.error?.message||'Missing RPC result');
      if(cacheable(body,answer.result,head))this.store.put('rpc',key,{chainId:String(n.chainId),slot,method:body.method,params:body.params,result:answer.result,checkedAt:this.now()});
      return answer;})();
    this.inflight.set(pendingKey,task);try{return await task;}finally{this.inflight.delete(pendingKey);}
  }
}
