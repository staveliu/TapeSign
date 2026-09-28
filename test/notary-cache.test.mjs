import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {NotaryCache} from '../server/notary.mjs';
import {notaryFixture} from './notary-fixture.mjs';
import {hash} from './fixture.mjs';
function makeStore(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'notary-cache-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return new Store(root);}
test('notary cache persists verified records and supports owner/hash/search/page filters',async t=>{
 const f=await notaryFixture(),store=makeStore(t),cache=new NotaryCache(store,()=>({}),{loader:async()=>f.bundle});cache.enqueue(f.location);await cache.processJobs();
 assert.equal(cache.list({hash:f.claim.hash}).total,1);assert.equal(cache.list({owner:'1.2.204'}).total,1);assert.equal(cache.list({q:'原创'}).total,1);assert.equal(cache.list({hash:hash(900)}).total,0);
 assert.equal(new NotaryCache(store,()=>({})).transaction(f.location).bundle.record.claim.id,f.claim.id);assert.equal(cache.jobs.size,0);
 assert.throws(()=>cache.list({page:0}));assert.throws(()=>cache.enqueue({...f.location,content:'secret'}));
});
test('private cache never receives or persists originals and pending records are not final',async t=>{
 const f=await notaryFixture({visibility:'private'}),store=makeStore(t),cache=new NotaryCache(store,()=>({}),{loader:async()=>({...f.bundle,finalized:false})});
 cache.enqueue(f.location);await cache.processJobs();const item=cache.list().items[0];assert.equal(item.bundle.content,null);assert.equal(item.bundle.record.claim.content,null);assert.equal(item.row.preview,undefined);assert.equal(item.bundle.finalized,false);assert.equal(cache.jobs.size,1);
});
test('invalid evidence never enters cache while unavailable chains keep incomplete scan status',async t=>{
 const f=await notaryFixture(),store=makeStore(t),cache=new NotaryCache(store,()=>({}),{loader:async()=>{throw Error('invalid signature');},scanner:async()=>{throw Error('RPC unavailable');}});
 cache.enqueue(f.location);await cache.processJobs();await cache.tick();assert.equal(cache.list().total,0);assert.equal(cache.jobs.size,1);assert.ok(Object.values(cache.scans).every(s=>!s.complete));
});
test('complete rescan removes reorged cache candidates; partial rescans retain marked candidates',async t=>{
 const f=await notaryFixture(),store=makeStore(t);let fail=true;const cache=new NotaryCache(store,()=>({}),{scanner:async()=>{if(fail)throw Error('RPC unavailable');return {bundles:[],head:{number:'200',hash:hash(200)},total:0,checked:0,invalid:[]};}});
 cache.remember(f.bundle);await cache.tick();assert.equal(cache.list().total,1);fail=false;await cache.tick();assert.equal(cache.list().total,0);
});

test('cache-first submission appears immediately without any chain RPC and survives restart',async t=>{
 const f=await notaryFixture(),store=makeStore(t);let calls=0;
 const cache=new NotaryCache(store,()=>{calls++;throw Error('Must not touch RPC');});
 const check=cache.check({hash:f.claim.hash,id:f.claim.id,owner:f.owner.name});assert.equal(check.status,'passed');assert.equal(check.scope,'indexed-records');
 const result=cache.submit({location:f.location,record:f.record});assert.equal(calls,0);assert.equal(result.bundle,null);assert.equal(result.verification.chain,'pending');assert.equal(result.verification.cache,'passed');
 assert.equal(cache.list().total,1);assert.equal(cache.list().items[0].row.timeSource,'declaration');assert.equal(store.all('notaries').length,0);
 const reloaded=new NotaryCache(store,()=>({}),{loader:async()=>f.bundle});assert.equal(reloaded.transaction(f.location).verification.chain,'pending');await reloaded.processJobs();
 assert.equal(reloaded.transaction(f.location).verification.chain,'finalized');assert.equal(reloaded.transaction(f.location).verification.uniqueness,'pending');assert.equal(reloaded.list().total,1);
});
test('only a signed schema is accepted and private originals cannot enter submissions',async t=>{
 const f=await notaryFixture({visibility:'private'}),store=makeStore(t),cache=new NotaryCache(store,()=>({}));
 const input={location:f.location,record:f.record};cache.submit(input);
 assert.equal(cache.list().items[0].submission.record.claim.content,null);assert.equal(JSON.stringify(store.all('notary-submissions')).includes('我的原创文字'),false);
 assert.throws(()=>cache.submit({...input,original:'secret'}));assert.throws(()=>cache.submit({...input,record:{...f.record,signature:'0x'+'00'.repeat(65)}}));
 assert.throws(()=>cache.submit({...input,location:{...f.location,chainId:'56'}}));
});
test('cache duplicate check distinguishes verified duplicates from concurrent pending declarations',async t=>{
 const {notaryNumber,notarySigning}=await import('../src/notary-protocol.js'),{wallets}=await import('./fixture.mjs'),{config}=await import('../src/rpc.js');
 const first=await notaryFixture(),second=await notaryFixture();second.claim.createdAt+=1;second.claim.id=notaryNumber(second.claim.createdAt,second.claim.nonce);const d=notarySigning(second.claim,config.networks.find(n=>String(n.chainId)==='196').hub);second.record.signature=await wallets.A.signTypedData(d.domain,d.types,d.message);second.location.tx=hash(998);second.bundle.location=second.location;
 const cache=new NotaryCache(makeStore(t),()=>({}));assert.equal(cache.check({hash:first.claim.hash}).status,'passed');
 cache.submit({location:first.location,record:first.record});assert.equal(cache.check({hash:second.claim.hash,id:second.claim.id}).status,'pending_conflict');
 const r=cache.submit({location:second.location,record:second.record});assert.equal(r.verification.cache,'pending_conflict');assert.equal(r.verification.chain,'pending');
 cache.remember(first.bundle);assert.equal(cache.check({hash:second.claim.hash,id:second.claim.id}).status,'duplicate');assert.equal(cache.transaction(second.location).verification.uniqueness,'conflict');
 cache.remember(second.bundle);assert.equal(cache.transaction(first.location).verification.uniqueness,'conflict');assert.equal(cache.transaction(second.location).verification.uniqueness,'conflict');
});
test('index freshness and both chain snapshots are required before marking a clear scan',async t=>{
 const f=await notaryFixture();let now=200000;
 const cache=new NotaryCache(makeStore(t),()=>({}),{now:()=>now});cache.remember(f.bundle);
 cache.scans['196']={complete:true,checkedAt:now,head:{number:'200'}};assert.equal(cache.transaction(f.location).verification.uniqueness,'pending');
 cache.scans['56']={complete:true,checkedAt:now,head:{number:'200'}};assert.equal(cache.transaction(f.location).verification.uniqueness,'clear');
 now+=120001;assert.equal(cache.transaction(f.location).verification.uniqueness,'pending');assert.equal(cache.check({hash:hash(222)}).scope,'indexed-records');
});
test('hung background job times out, releases workers and never creates verified evidence',async t=>{
 const f=await notaryFixture();let now=0;
 const cache=new NotaryCache(makeStore(t),()=>({}),{now:()=>now,jobTimeout:15,loader:()=>new Promise(()=>{})});cache.submit({location:f.location,record:f.record});
 await cache.processJobs();assert.equal(cache.processing,false);assert.equal(cache.transaction(f.location).verification.chain,'retry');assert.equal(cache.records.size,0);assert.equal(cache.jobs.size,1);
 now=20000;cache.loader=async()=>f.bundle;await cache.processJobs();assert.equal(cache.transaction(f.location).verification.chain,'finalized');
});
test('failed or missing chain evidence remains an explicit preview with retry diagnostics',async t=>{
 const f=await notaryFixture(),cache=new NotaryCache(makeStore(t),()=>({}),{loader:async()=>{throw Object.assign(Error('No receipt yet'),{code:'TRANSACTION_PENDING'});}});
 cache.submit({location:f.location,record:f.record});await cache.processJobs();const r=cache.transaction(f.location);assert.equal(r.bundle,null);assert.equal(r.verification.chain,'retry');assert.equal(r.verification.attempts,1);assert.match(r.verification.error,/receipt/);assert.equal(cache.list().total,1);
});
test('chain evidence replaces mismatched submitted metadata with an explicit anomaly',async t=>{
 const f=await notaryFixture(),other=await notaryFixture({value:'different body'}),cache=new NotaryCache(makeStore(t),()=>({}),{loader:async()=>other.bundle});
 cache.submit({location:f.location,record:f.record});await cache.processJobs();const r=cache.transaction(f.location);assert.equal(r.verification.chain,'finalized');assert.equal(r.verification.metadataMismatch,true);assert.equal(r.bundle.record.claim.hash,other.claim.hash);
});
test('reorg removes prior success but retains its detail as invalid',async t=>{
 const f=await notaryFixture(),cache=new NotaryCache(makeStore(t),()=>({}),{scanner:async()=>({bundles:[],head:{number:'200',hash:hash(200)},total:0,checked:0,invalid:[]})});cache.submit({location:f.location,record:f.record});cache.remember(f.bundle);await cache.tick();assert.equal(cache.transaction(f.location).verification.chain,'invalid');assert.equal(cache.list().total,0);
});
