import {context,config,ABI,header,resolveIdentity} from '../src/rpc.js';
import {loadContract} from '../src/reader.js';
import {anchor,decode,nameInfo} from '../src/protocol.js';
import {historyRow,groupContracts} from '../src/history.js';
import {syncIndex} from '../src/indexer.js';
import {readLocal,saveLocal} from '../src/storage.js';
import {RpcCache} from './rpc-cache.mjs';
import {toQuantity} from 'ethers';
import {safeRpcMessage} from '../src/rpc-http.js';
import {assertSuccessor,stageRank} from '../src/contract-follow.js';
const key=loc=>loc.chainId+'/'+loc.tx;
export class ContractCache {
  constructor(store,upstream,{now=Date.now,loader=loadContract}={}){
    this.store=store;this.now=now;this.loader=loader;this.rpc=new RpcCache(store,config.networks,upstream,{now});
    this.jobs=new Map(store.get('state','jobs')?.items||[]);this.watchers=new Map(store.get('state','watchers')?.items||[]);
    for(const job of this.jobs.values())job.nextAt=Math.min(job.nextAt,this.now()+5000);
    this.records=new Map(store.all('contracts').map(r=>[key(r.location),r]));
    this.scan=store.get('state','scan')||{};this.running=false;this.lastTick=0;this.lastError=null;
  }
  persist(){this.store.put('state','jobs',{items:[...this.jobs]});this.store.put('state','watchers',{items:[...this.watchers]});this.store.put('state','scan',this.scan);}
  enqueue(location){anchor(location);const k=key(location);if((this.records.has(k)&&!this.records.get(k).invalid)||this.jobs.has(k))return;if(this.jobs.size>=500)throw Error('队列繁忙，请稍后重试');this.jobs.set(k,{location,attempts:0,nextAt:0,createdAt:this.now()});this.persist();}
  watch(name){const normalized=nameInfo(name).name;if(!this.watchers.has(normalized)){if(this.watchers.size>=1000)throw Error('查询队列繁忙');this.watchers.set(normalized,{name:normalized,nextAt:0,cursors:{}});this.persist();}return normalized;}
  history(name){const n=this.watch(name),rows=[...this.records.values()].filter(r=>!r.invalid).map(r=>r.row).filter(r=>r.parties.includes(n));return {rows,contracts:groupContracts(rows,n),refreshing:true,checkedAt:this.lastTick};}
  transaction(loc){anchor(loc);const r=this.records.get(key(loc));if(r&&!r.invalid)return {bundle:r.bundle,checkedAt:r.checkedAt,source:'cache',refreshing:true};this.enqueue(loc);return {bundle:null,refreshing:true};}
  latest(loc){
    const exact=this.transaction(loc);if(!exact.bundle)return exact;
    let best=exact;
    for(const r of this.records.values()){
      if(r.invalid||stageRank(r.bundle)<=stageRank(best.bundle))continue;
      try{assertSuccessor(exact.bundle,r.bundle);best={bundle:r.bundle,checkedAt:r.checkedAt,source:'cache',refreshing:true};}catch{}
    }
    return best;
  }
  ctx(fresh=false){return context((url,body)=>this.rpc.request(url,body,{fresh}));}
  async verify(loc,{fresh=false}={}){
    const bundle=await this.loader(loc,this.ctx(fresh),{allowPending:true,confirmation:'fast'});
    const message=bundle.seal||bundle.acceptance||bundle.offer;
    const r={location:loc,row:historyRow(message.record,loc,bundle.doc),bundle,checkedAt:this.now(),invalid:false};
    this.store.put('contracts',key(loc),r);this.records.set(key(loc),r);
    for(const role of ['A','B'])this.watch(bundle.doc.parties[role].name);
    for(const m of [bundle.offer,bundle.acceptance].filter(Boolean))if(key(m.location)!==key(loc))this.enqueue(m.location);
    return r;
  }
  async heads(){
    const results=await Promise.allSettled(config.networks.map(async n=>{const chain=String(n.chainId),ctx=this.ctx(true),head=await ctx.head(chain);this.rpc.setFinalized(chain,head);return {chain,head};}));
    this.headErrors=results.filter(r=>r.status==='rejected').length;
    this.headDetails=results.map((r,i)=>r.status==='rejected'?{chain:String(config.networks[i].chainId),message:safeRpcMessage(r.reason?.message)}:null).filter(Boolean);
    return results.filter(r=>r.status==='fulfilled').map(r=>r.value);
  }
  async scanChain(chain,head){
    const rpc=this.ctx(true).rpc(chain),topic=ABI.getEvent('Sent').topicHash;let cursor=this.scan[chain];
    if(!cursor){this.scan[chain]={number:head.number,hash:head.hash,start:head.number};this.persist();return;}
    const known=await rpc.agree('eth_getBlockByNumber',[toQuantity(cursor.number),false],header);
    if(known.hash!==cursor.hash){
      for(const r of this.records.values())if([r.bundle.offer,r.bundle.acceptance,r.bundle.seal].filter(Boolean).some(m=>m.location.chainId===chain&&BigInt(m.block.number)>BigInt(cursor.number)-128n)){r.invalid=true;this.store.put('contracts',key(r.location),r);this.enqueue(r.location);}
      cursor={...cursor,number:String(BigInt(cursor.number)>128n?BigInt(cursor.number)-128n:0n)};
    }
    const from=BigInt(cursor.number)+1n,end=BigInt(head.number)<from+99n?BigInt(head.number):from+99n;if(from>end)return;
    // Range logs only discover untrusted transaction hashes. Every queued
    // transaction still requires both independent RPCs in verify() before
    // it can appear in the cache. Omitted hints are covered by inbox watchers.
    const logs=await rpc.one(rpc.net.rpcs[1],'eth_getLogs',[{address:rpc.net.hub,fromBlock:toQuantity(from),toBlock:toQuantity(end),topics:[topic]}]);
    for(const log of logs)if(!log.removed){try{const event=ABI.parseLog(log);decode(event.args.payload.toLowerCase());this.enqueue({chainId:chain,tx:log.transactionHash});}catch(e){if(this.jobs.size>=500)throw e;}}
    const endBlock=await rpc.agree('eth_getBlockByNumber',[toQuantity(end),false],header);
    if((await rpc.agree('eth_getBlockByNumber',[toQuantity(head.number),false],header)).hash!==head.hash)throw Error('Scan head changed');
    this.scan[chain]={number:String(end),hash:endBlock.hash,start:cursor.start};this.persist();
  }
  async syncWatcher(w){
    const ctx=this.ctx(),identity=await resolveIdentity(w.name,ctx);
    for(const [k,v]of Object.entries(w.cursors||{}))saveLocal(k,v);
    const result=await syncIndex(identity,{ctx});
    for(const row of result.rows)this.enqueue(row.location);
    for(const chain of ['196','56'])for(const d of chain===identity.chainId?['in','out']:['in']){const k='index:'+chain+':'+identity.endpoint+':'+d;w.cursors[k]=readLocal(k);}
    w.nextAt=this.now()+30000;this.persist();
  }
  async processJobs(){
    if(this.jobsRunning)return;this.jobsRunning=true;
    try{await Promise.all([...this.jobs].filter(([,j])=>j.nextAt<=this.now()).slice(0,2).map(async([k,j])=>{
      try{await this.verify(j.location);this.jobs.delete(k);}catch(e){j.attempts++;j.nextAt=this.now()+Math.min(60000,5000*2**Math.min(j.attempts,4));j.error=e.code||'VERIFY_RETRY';j.message=safeRpcMessage(e.message);if(this.now()-j.createdAt>86400000)this.jobs.delete(k);}
      this.persist();
    }));}finally{this.jobsRunning=false;}
  }
  async processWatchers(){
    if(this.watchersRunning)return;this.watchersRunning=true;
    try{
      const watcher=[...this.watchers.values()].filter(w=>w.nextAt<=this.now()).sort((a,b)=>a.nextAt-b.nextAt)[0];
      if(watcher){try{await this.syncWatcher(watcher);watcher.error=null;}catch(e){watcher.error=safeRpcMessage(e.message);watcher.nextAt=this.now()+60000;}this.persist();}
    }finally{this.watchersRunning=false;}
  }
  async tick(){
    if(this.running)return;this.running=true;
    try{
      const heads=await this.heads();
      const scans=await Promise.allSettled(heads.map(({chain,head})=>this.scanChain(chain,head)));
      this.scanErrors=scans.filter(r=>r.status==='rejected').length;
      this.scanDetails=scans.map((r,i)=>r.status==='rejected'?{chain:heads[i].chain,message:safeRpcMessage(r.reason?.message)}:null).filter(Boolean);
      void this.processJobs().catch(()=>{this.lastError='QUEUE_RETRY';});
      const stale=[...this.records.values()].filter(r=>!r.invalid&&this.now()-r.checkedAt>(r.bundle.finalized?86400000:10000)).sort((a,b)=>a.checkedAt-b.checkedAt).slice(0,2);
      for(const r of stale){try{await this.verify(r.location,{fresh:true});}catch(e){if(!['RPC_UNAVAILABLE','TRANSACTION_PENDING','RPC_SYNC_PENDING','CONFIRMATION_PENDING'].includes(e.code)){r.invalid=true;}r.checkedAt=this.now();this.store.put('contracts',key(r.location),r);}}
      this.lastTick=this.now();this.lastError=this.headErrors||this.scanErrors?'PARTIAL_RPC_RETRY':null;
    }catch(e){this.lastError=e.code||'BACKGROUND_RETRY';}finally{this.running=false;}
  }
  health(){return {service:'tapesign-cache',protocol:'TAPESIGN-2',contracts:this.records.size,queued:this.jobs.size,watched:this.watchers.size,rpcHits:this.rpc.hits,rpcMisses:this.rpc.misses,lastTick:this.lastTick,lastError:this.lastError,details:[...(this.headDetails||[]),...(this.scanDetails||[])],jobs:[...this.jobs.values()].filter(j=>j.error).slice(0,10).map(j=>({location:j.location,attempts:j.attempts,nextAt:j.nextAt,error:j.error,message:j.message})),scans:this.scan};}
}
