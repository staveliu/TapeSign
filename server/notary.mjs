import {toUtf8String,encodeBase64} from 'ethers';
import {anchor,nameInfo,HASH} from '../src/protocol.js';
import {loadNotarization} from '../src/notary-reader.js';
import {notaryRow} from '../src/notary-protocol.js';
import {scanNotaryChain,notaryKey,queryNotaries} from '../src/notary-index.js';
import {safeRpcMessage} from '../src/rpc-http.js';
export class NotaryCache {
 constructor(store,makeContext,{loader=loadNotarization,scanner=scanNotaryChain,now=Date.now}={}){
  this.store=store;this.makeContext=makeContext;this.loader=loader;this.scanner=scanner;this.now=now;
  this.records=new Map(store.all('notaries').map(r=>[notaryKey(r.location),r]));this.jobs=new Map(store.get('state','notary-jobs')?.items||[]);this.scans=store.get('state','notary-scans')||{};this.running=false;this.processing=false;
  for(const job of this.jobs.values())job.nextAt=0;
 }
 persist(){this.store.put('state','notary-jobs',{items:[...this.jobs]});this.store.put('state','notary-scans',this.scans);}
 enqueue(location){anchor(location);const k=notaryKey(location);if(this.records.get(k)?.bundle.finalized||this.jobs.has(k))return;if(this.jobs.size>=500)throw Error('公证队列已满');this.jobs.set(k,{location,attempts:0,nextAt:0});this.persist();}
 remember(bundle){const row=notaryRow(bundle);if(bundle.content&&row.kind==='text')row.preview=toUtf8String(Uint8Array.from(bundle.content));const r={location:bundle.location,row,bundle,checkedAt:this.now(),invalid:false};this.records.set(notaryKey(r.location),r);this.store.put('notaries',notaryKey(r.location),r);return r;}
 list(params={}){
  if(params.hash&&!HASH.test(params.hash))throw Error('无效哈希');if(params.owner)params={...params,owner:nameInfo(params.owner).name};
  if(String(params.q||'').length>256)throw Error('搜索条件过长');
  const result=queryNotaries([...this.records.values()].filter(r=>!r.invalid).map(r=>r.row),params);
  return {...result,items:result.rows.map(r=>{const item=this.records.get(notaryKey(r.location));return {...item,bundle:{...item.bundle,content:item.bundle.content?encodeBase64(Uint8Array.from(item.bundle.content)):null,contentEncoding:'base64'}};}),source:'cache',scans:this.scans,refreshing:true};
 }
 transaction(location){anchor(location);const r=this.records.get(notaryKey(location));if(r&&!r.invalid)return {bundle:r.bundle,checkedAt:r.checkedAt,source:'cache'};this.enqueue(location);return {bundle:null,refreshing:true};}
 async processJobs(){if(this.processing)return;this.processing=true;try{await Promise.all([...this.jobs].filter(([,j])=>j.nextAt<=this.now()).slice(0,2).map(async([k,j])=>{
   try{const b=await this.loader(j.location,this.makeContext(),{allowPending:true});this.remember(b);if(b.finalized)this.jobs.delete(k);else j.nextAt=this.now()+10000;}
   catch(e){j.attempts++;j.error=safeRpcMessage(e.message);j.nextAt=this.now()+Math.min(60000,5000*2**Math.min(4,j.attempts));}this.persist();
  }));}finally{this.processing=false;}}
 async tick(){if(this.running)return;this.running=true;try{await Promise.all(['196','56'].map(async chain=>{
   try{const result=await this.scanner(chain,{ctx:this.makeContext(),onUpdate:s=>{this.scans[chain]={total:s.total,checked:s.checked,complete:false};}});
    const seen=new Set();for(const b of result.bundles){this.remember(b);seen.add(notaryKey(b.location));}
    for(const[k,r]of this.records)if(r.location.chainId===chain&&!seen.has(k)&&BigInt(r.bundle.block.number)<=BigInt(result.head.number)){r.invalid=true;this.store.put('notaries',k,r);}
    this.scans[chain]={head:result.head,total:result.total,checked:result.checked,invalid:result.invalid.length,complete:true,checkedAt:this.now()};
   }catch(e){this.scans[chain]={...this.scans[chain],complete:false,error:safeRpcMessage(e.message)};}this.persist();
  }));}finally{this.running=false;}}
 health(){return {records:[...this.records.values()].filter(r=>!r.invalid).length,queued:this.jobs.size,scans:this.scans};}
}
