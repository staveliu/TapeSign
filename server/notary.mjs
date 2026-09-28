import {toUtf8String,encodeBase64} from 'ethers';
import {anchor,nameInfo,HASH,exact,same} from '../src/protocol.js';
import {config} from '../src/rpc.js';
import {loadNotarization} from '../src/notary-reader.js';
import {notaryRow,validateNotary} from '../src/notary-protocol.js';
import {submissionRow} from '../src/notary-status.js';
import {scanNotaryChain,notaryKey,queryNotaries} from '../src/notary-index.js';
import {safeRpcMessage} from '../src/rpc-http.js';
const sameDeclaration=(a,b)=>a.id===b.id&&a.owner===b.owner&&a.hash===b.hash;
export class NotaryCache {
 constructor(store,makeContext,{loader=loadNotarization,scanner=scanNotaryChain,now=Date.now,jobTimeout=90000,scanTimeout=180000}={}){
  Object.assign(this,{store,makeContext,loader,scanner,now,jobTimeout,scanTimeout});
  this.records=new Map(store.all('notaries').map(r=>[notaryKey(r.location),r]));
  this.submissions=new Map(store.all('notary-submissions').map(r=>[notaryKey(r.location),r]));
  this.jobs=new Map(store.get('state','notary-jobs')?.items||[]);this.scans=store.get('state','notary-scans')||{};this.running=false;this.processing=false;
  for(const job of this.jobs.values())job.nextAt=0;
 }
 persist(){this.store.put('state','notary-jobs',{items:[...this.jobs]});this.store.put('state','notary-scans',this.scans);}
 enqueue(location){anchor(location);const k=notaryKey(location);if((this.records.get(k)?.bundle.finalized&&!this.records.get(k).invalid)||this.jobs.has(k))return;if(this.jobs.size>=500)throw Error('公证队列已满');this.jobs.set(k,{location,attempts:0,nextAt:0,createdAt:this.now()});this.persist();}
 activeSubmissions(){return [...this.submissions.values()].filter(s=>!this.records.has(notaryKey(s.location))&&this.now()-s.submittedAt<86400000);}
 check({hash,id='',owner=''}){
  if(!HASH.test(hash)||typeof id!=='string'||(id&&!/^TN-\d{17}-[0-9a-f]{32}$/.test(id)))throw Error('无效公证查重参数');
  if(owner)owner=nameInfo(owner).name;
  const matches=[...this.records.values()].filter(r=>!r.invalid&&r.row.hash===hash&&!(r.row.id===id&&r.row.owner===owner));
  const pending=this.activeSubmissions().filter(s=>s.record.claim.hash===hash&&!(s.record.claim.id===id&&s.record.claim.owner.name===owner));
  return {hash,id,status:matches.length?'duplicate':pending.length?'pending_conflict':'passed',checkedAt:this.now(),scope:'indexed-records',matches:matches.slice(0,20).map(r=>r.row),pending:pending.slice(0,20).map(submissionRow),scans:this.scans};
 }
 submit(input){
  exact(input,'location,record');anchor(input.location);validateNotary(input.record,config.networks);
  if(input.location.chainId!==input.record.claim.owner.chainId)throw Error('公证链与容器不符');
  const k=notaryKey(input.location),old=this.submissions.get(k);
  const verified=this.records.get(k);if(verified&&!same(verified.bundle.record,input.record))throw Error('声明与已核验链上交易不符');
  if(old&&!same(old.record,input.record))throw Error('同一交易已登记不同声明');
  // Signed previews live separately; only the independent loader creates chain evidence.
  this.enqueue(input.location);
  if(!old){const cacheCheck=this.check({hash:input.record.claim.hash,id:input.record.claim.id,owner:input.record.claim.owner.name});const s={location:input.location,record:input.record,submittedAt:this.now(),cacheCheck};this.store.put('notary-submissions',k,s);this.submissions.set(k,s);}
  return this.transaction(input.location);
 }
 remember(bundle){
  const row=notaryRow(bundle);if(bundle.content&&row.kind==='text')row.preview=toUtf8String(Uint8Array.from(bundle.content));
  const r={location:bundle.location,row,bundle,checkedAt:this.now(),invalid:false},k=notaryKey(r.location),s=this.submissions.get(k);
  if(s&&!same(s.record,bundle.record)){s.error='缓存声明与链上交易不一致';this.store.put('notary-submissions',k,s);}
  this.store.put('notaries',k,r);this.records.set(k,r);return r;
 }
 verification(location){
  const k=notaryKey(location),r=this.records.get(k),s=this.submissions.get(k),j=this.jobs.get(k),row=r?.row||(s&&submissionRow(s));
  const conflicts=row?[...this.records.values()].filter(x=>!x.invalid&&x.row.hash===row.hash&&!sameDeclaration(x.row,row)).map(x=>x.row):[];
  const covered=r&&!r.invalid&&['196','56'].every(c=>{const scan=this.scans[c];return scan?.complete&&this.now()-scan.checkedAt<120000&&(c!==location.chainId||BigInt(scan.head.number)>=BigInt(r.bundle.block.number));});
  return {source:'server',chain:r?.invalid?'invalid':r?(r.bundle.finalized?'finalized':'verified'):j?.validationError?'invalid':j?.error?'retry':'pending',cache:s?.cacheCheck.status||'unchecked',uniqueness:conflicts.length?'conflict':covered?'clear':'pending',conflicts:conflicts.slice(0,20),metadataMismatch:!!s?.error,checkedAt:r?.checkedAt||null,attempts:j?.attempts||0,nextAt:j?.nextAt||null,error:s?.error||j?.error||null,scans:this.scans};
 }
 pack(location){
  const k=notaryKey(location),r=this.records.get(k),s=this.submissions.get(k);
  return {location,row:r?.row||(s&&submissionRow(s)),bundle:r&&!r.invalid?{...r.bundle,content:r.bundle.content?encodeBase64(Uint8Array.from(r.bundle.content)):null,contentEncoding:'base64'}:null,submission:s||null,verification:this.verification(location),source:'cache',checkedAt:r?.checkedAt||null,refreshing:!r?.bundle.finalized||!!r?.invalid};
 }
 list(params={}){
  if(params.hash&&!HASH.test(params.hash))throw Error('无效哈希');if(params.owner)params={...params,owner:nameInfo(params.owner).name};if(String(params.q||'').length>256)throw Error('搜索条件过长');
  const rows=[...this.records.values()].filter(r=>!r.invalid).map(r=>r.row);
  for(const s of this.activeSubmissions()){const row=submissionRow(s);if(s.record.claim.visibility==='public'&&s.record.claim.kind==='text'&&s.record.claim.content.inline)row.preview=Buffer.from(s.record.claim.content.inline,'base64').toString('utf8');rows.push(row);}
  const result=queryNotaries(rows,params);return {...result,items:result.rows.map(r=>this.pack(r.location)),source:'cache',scans:this.scans,refreshing:true};
 }
 transaction(location){anchor(location);if(!this.records.has(notaryKey(location)))this.enqueue(location);return this.pack(location);}
 async bounded(work,ms){
  const controller=new AbortController();let timer;
  try{return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{const e=Object.assign(Error('后台核验超时，已保留任务并自动重试'),{code:'RPC_TIMEOUT'});controller.abort(e);reject(e);},ms);})]);}finally{clearTimeout(timer);controller.abort();}
 }
 async processJobs(){if(this.processing)return;this.processing=true;try{await Promise.all([...this.jobs].filter(([,j])=>j.nextAt<=this.now()).slice(0,2).map(async([k,j])=>{
  try{const b=await this.bounded(signal=>this.loader(j.location,this.makeContext({signal}),{allowPending:true}),this.jobTimeout);this.remember(b);j.error=null;if(b.finalized)this.jobs.delete(k);else j.nextAt=this.now()+10000;}
  catch(e){j.attempts++;j.error=safeRpcMessage(e.message);j.validationError=!e.code&&/交易失败|签名无效|不符|不一致|不是 Tape|超过大小|分块重复|无效公证/.test(e.message);j.nextAt=this.now()+Math.min(60000,5000*2**Math.min(4,j.attempts));}this.persist();
 }));}finally{this.processing=false;}}
 async tick(){if(this.running)return;this.running=true;try{await Promise.all(['196','56'].map(async chain=>{
  try{const result=await this.bounded(signal=>this.scanner(chain,{ctx:this.makeContext({signal}),signal,onUpdate:s=>{if(!signal.aborted)this.scans[chain]={...this.scans[chain],total:s.total,checked:s.checked,complete:false};}}),this.scanTimeout);
   const seen=new Set();for(const b of result.bundles){this.remember(b);seen.add(notaryKey(b.location));}
   for(const[k,r]of this.records)if(r.location.chainId===chain&&!seen.has(k)&&BigInt(r.bundle.block.number)<=BigInt(result.head.number)){r.invalid=true;this.store.put('notaries',k,r);}
   this.scans[chain]={head:result.head,total:result.total,checked:result.checked,invalid:result.invalid.length,complete:true,checkedAt:this.now()};
  }catch(e){this.scans[chain]={...this.scans[chain],complete:false,error:safeRpcMessage(e.message)};}this.persist();
 }));}finally{this.running=false;}}
 health(){return {mode:'cache-first-background-verification',records:[...this.records.values()].filter(r=>!r.invalid).length,pending:this.activeSubmissions().length,queued:this.jobs.size,scans:this.scans};}
}
