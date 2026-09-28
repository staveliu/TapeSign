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
