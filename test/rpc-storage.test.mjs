import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {RpcCache} from '../server/rpc-cache.mjs';
function makeStore(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'rpc-storage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root);store.diskSpace=()=>({freeBytes:1024**3,freeInodes:100000});return store;}
function rpcFor(store,answer={result:'0xaa'}){const rpc=new RpcCache(store,[{chainId:196,rpcs:['https://a','https://b']}],async()=>answer);rpc.setFinalized('196',{number:'100'});return rpc;}
const body={method:'eth_call',params:[{to:'x'},'0x40'],id:1};
test('expired RPC files are pruned without touching evidence, queues or previews',async t=>{
 const store=makeStore(t),now=Date.now();
 for(const kind of ['rpc','contracts','notaries','notary-submissions','state']){store.put(kind,'old',{value:kind});fs.utimesSync(store.file(kind,'old'),new Date(now-7200000),new Date(now-7200000));}
 store.put('rpc','new',{value:'new'});
 const result=await store.pruneRpc({now});assert.equal(result.removed,1);assert.equal(store.get('rpc','old'),null);assert.ok(store.get('rpc','new'));
 for(const kind of ['contracts','notaries','notary-submissions','state'])assert.equal(store.get(kind,'old').value,kind);
});
test('RPC retention enforces both file and byte limits by oldest first',async t=>{
 const store=makeStore(t),now=Date.now();
 for(let i=0;i<5;i++){store.put('rpc',String(i),{value:'a'.repeat(50)});fs.utimesSync(store.file('rpc',String(i)),new Date(now-10000+i*1000),new Date(now-10000+i*1000));}
 let result=await store.pruneRpc({now,maxFiles:2,maxBytes:10000});assert.equal(result.files,2);assert.equal(store.get('rpc','2'),null);assert.ok(store.get('rpc','4'));
 result=await store.pruneRpc({now,maxBytes:70});assert.equal(result.files,1);assert.ok(result.bytes<=70);assert.ok(store.get('rpc','4'));
});
test('low space removes only disposable RPC objects and skips further RPC writes',async t=>{
 const store=makeStore(t);store.put('rpc','cached',{a:1});store.put('notaries','permanent',{a:2});store.diskSpace=()=>({freeBytes:1,freeInodes:1});
 await store.pruneRpc();assert.equal(store.all('rpc').length,0);assert.equal(store.all('notaries').length,1);
 const rpc=rpcFor(store);assert.equal((await rpc.request('https://a',body)).result,'0xaa');assert.equal(rpc.skippedWrites,1);assert.equal(store.all('rpc').length,0);
});
test('RPC disk write failure cannot invalidate a successful upstream response',async t=>{
 const store=makeStore(t),put=store.put.bind(store);store.put=(kind,key,value)=>{if(kind==='rpc')throw Object.assign(Error('full'),{code:'ENOSPC'});return put(kind,key,value);};
 const rpc=rpcFor(store);assert.equal((await rpc.request('https://a',body)).result,'0xaa');assert.equal(rpc.health().lastError,'ENOSPC');assert.equal(rpc.health().errors,1);
 assert.equal(rpc.inflight.size,0);
});
test('corrupt disposable cache falls back to upstream without hiding upstream errors',async t=>{
 const store=makeStore(t);store.get=()=>{throw SyntaxError('corrupt cache');};
 const rpc=rpcFor(store);assert.equal((await rpc.request('https://a',body)).result,'0xaa');assert.equal(rpc.storageErrors,1);
 const bad=rpcFor(store,{error:{message:'upstream rejected'}});await assert.rejects(bad.request('https://a',body),/upstream rejected/);
});
test('maintenance failures remain observable and retryable',async t=>{
 const store=makeStore(t),rpc=rpcFor(store);store.pruneRpc=async()=>{throw Object.assign(Error('io'),{code:'EIO'});};
 await rpc.maintain();assert.equal(rpc.health().lastError,'EIO');assert.equal(rpc.maintenance,null);
 store.pruneRpc=async()=>({files:0,bytes:0,removed:2,freeBytes:1024**3,freeInodes:10000});await rpc.maintain();assert.equal(rpc.health().lastError,null);assert.equal(rpc.health().removed,2);
});
