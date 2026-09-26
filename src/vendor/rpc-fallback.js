// Each verification slot has its own provider pool. Failover never combines
// both independent votes onto one provider, nor hides a successful disagreement.
import { rpcUnavailable, safeRpcMessage } from '../rpc-http.js';
export function withRpcFallback(networks,send,{cooldownMs=15000,now=Date.now,onFallback=()=>{}}={}){
  const routes=new Map(),cooldowns=new Map();
  for(const n of networks){
    const hosts=new Set();
    for(const primary of n.rpcs){
      const pool=[primary,...(n.rpcFallbacks?.[primary]??[])];
      for(const url of pool){
        const parsed=new URL(url);
        if(parsed.protocol!=='https:'||hosts.has(parsed.hostname))throw Error('RPC fallback providers must be independent');
        hosts.add(parsed.hostname);
      }
      routes.set(primary,{chainId:n.chainId,pool});
    }
    if(Object.keys(n.rpcFallbacks??{}).some(url=>!n.rpcs.includes(url)))throw Error('Unknown RPC fallback slot');
  }
  return async(primary,body)=>{
    const route=routes.get(primary);if(!route)throw Error('Unknown RPC route');
    // Providers may reject range logs while serving receipts and archive state.
    // Keep each capability's retry state independent, including single-block logs.
    const capability=body.method+(body.method==='eth_getLogs'?(body.params?.[0]?.fromBlock===body.params?.[0]?.toBlock?'/single':'/range'):'');
    const key=url=>url+'/'+capability;
    const eligible=route.pool.filter(url=>(cooldowns.get(key(url))??0)<=now());
    // Probe the least recently failed provider, rather than getting stuck on
    // the last provider (which may not support the requested historical state).
    const pool=eligible.length?eligible:[[...route.pool].sort((a,b)=>(cooldowns.get(key(a))||0)-(cooldowns.get(key(b))||0))[0]];let last,missing=null;
    for(const url of pool){
      try{
        const result=await send(url,body);
        if(result?.error||result?.result===undefined)throw Error(result?.error?.message||'Missing RPC result');
        if(result.result===null&&['eth_getTransactionReceipt','eth_getTransactionByHash'].includes(body.method)){missing=result;continue;}
        if(body.method==='eth_getBlockByNumber'&&(!result.result?.hash||!result.result?.number||!result.result?.timestamp))throw Error('Missing block header');
        cooldowns.delete(key(url));return result;
      }catch(error){
        // The endpoint may embed an intentionally public key; don't put it in
        // errors, journal entries or user-facing diagnostics.
        last=`${new URL(url).hostname}: ${safeRpcMessage(error.message)}`;
        cooldowns.set(key(url),now()+cooldownMs);
        onFallback({chainId:route.chainId,provider:new URL(url).hostname,method:body.method});
      }
    }
    if(missing&&!last)return missing;
    throw rpcUnavailable(`链 ${route.chainId} · ${body.method} · ${last||'RPC unavailable'}`,{chainId:String(route.chainId),method:body.method});
  };
}
