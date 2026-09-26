import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {RpcCache,cacheable} from '../server/rpc-cache.mjs';
import {ContractCache} from '../server/service.mjs';
import {fixture,hash} from './fixture.mjs';
function makeStore(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'tapesign-cache-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return new Store(root);}
test('永久对象原子保存，重启后恢复且路径参数不能逃出数据目录',t=>{
  const store=makeStore(t);store.put('contracts','../../untrusted',{a:1});store.put('contracts','../../untrusted',{a:2});assert.deepEqual(new Store(store.root).get('contracts','../../untrusted'),{a:2});assert.equal(store.all('contracts').length,1);
});
test('仅缓存最终确认固定区块，不缓存空回执、最新状态与区块头',()=>{
  const head={number:'100'};assert.equal(cacheable({method:'eth_call',params:[{},'0x40']},'0x1234',head),true);
  assert.equal(cacheable({method:'eth_call',params:[{},'latest']},'0x1234',head),false);
  assert.equal(cacheable({method:'eth_getTransactionReceipt',params:[hash(1)]},null,head),false);
  assert.equal(cacheable({method:'eth_getTransactionReceipt',params:[hash(1)]},{blockNumber:'0x65'},head),false);
  assert.equal(cacheable({method:'eth_getBlockByNumber',params:['0x40',false]},{number:'0x40'},head),false);
});
test('两个 RPC 槽位分开缓存，JSON-RPC id 正确回填；实时复核不读缓存',async t=>{
  const store=makeStore(t),nets=[{chainId:196,rpcs:['https://a','https://b']}];let calls=0,now=10000;
  const rpc=new RpcCache(store,nets,async(url,b)=>({id:b.id,jsonrpc:'2.0',result:url==='https://a'?'0xaa':'0xbb'}),{now:()=>now});
  const original=rpc.upstream;rpc.upstream=async(...args)=>{calls++;return original(...args);};rpc.setFinalized('196',{number:'100'});
  const b={method:'eth_call',params:[{to:'x'},'0x40'],id:1};assert.equal((await rpc.request('https://a',b)).result,'0xaa');assert.equal((await rpc.request('https://b',b)).result,'0xbb');
  assert.equal((await rpc.request('https://a',{...b,id:99})).id,99);assert.equal(calls,2);
  await rpc.request('https://a',b,{fresh:true});assert.equal(calls,3);now+=3600001;await rpc.request('https://a',b);assert.equal(calls,4);
});
test('永久合同索引按双方可查，服务重启保留队列与合同归并',async t=>{
  const store=makeStore(t),f=await fixture({crossChain:true});
  const offer={record:f.offer,location:f.offerLocation,block:{number:'1'}},accept={record:f.accept,location:f.acceptLocation,block:{number:'2'}},seal={record:f.seal,location:f.sealLocation,block:{number:'3'}};
  const loader=async location=>({doc:f.doc,offer,acceptance:location.tx===f.offerLocation.tx?null:accept,seal:location.tx===f.sealLocation.tx?seal:null,selected:location,finalized:true,ready:true});
  const service=new ContractCache(store,()=>{throw Error('not used');},{loader});
  service.enqueue(f.sealLocation);await service.processJobs();await service.processJobs();
  assert.equal(service.history(f.doc.parties.A.name).contracts.length,1);assert.equal(service.history(f.doc.parties.B.name).contracts[0].type,'seal');
  const restored=new ContractCache(new Store(store.root),()=>{throw Error('offline');},{loader});assert.equal(restored.transaction(f.sealLocation).bundle.doc.contractId,f.doc.contractId);assert.equal(restored.history(f.doc.parties.A.name).contracts[0].transactions.length,3);
  assert.equal(restored.latest(f.offerLocation).bundle.selected.tx,f.sealLocation.tx);
  assert.equal(restored.latest(f.acceptLocation).bundle.selected.tx,f.sealLocation.tx);
  assert.equal(restored.transaction(f.offerLocation).bundle.acceptance,null);
  restored.records.get(f.sealLocation.chainId+'/'+f.sealLocation.tx).invalid=true;
  assert.equal(restored.latest(f.offerLocation).bundle.selected.tx,f.acceptLocation.tx);
  restored.enqueue({chainId:'56',tx:hash(900)});assert.equal(new ContractCache(store,()=>{}).jobs.size,1);
});
test('伪造或待处理交易不进入已验证列表，刷新失败保留待重试队列',async t=>{
  const store=makeStore(t),service=new ContractCache(store,()=>{},{loader:async()=>{throw Error('bad evidence');}});
  const loc={chainId:'196',tx:hash(99)};service.enqueue(loc);service.enqueue(loc);assert.equal(service.jobs.size,1);await service.processJobs();assert.equal(service.records.size,0);assert.equal(service.jobs.size,1);assert.equal(service.transaction(loc).bundle,null);
  assert.throws(()=>service.enqueue({chainId:'1',tx:hash(1)}));assert.throws(()=>service.enqueue({...loc,payload:'trust me'}));
});

test('单节点范围日志仅提供线索，伪造交易不能进入可查询合同',async t=>{
  const {ABI}=await import('../src/rpc.js'),{encode}=await import('../src/protocol.js');
  const f=await fixture(),store=makeStore(t),service=new ContractCache(store,()=>{},{loader:async()=>{throw Error('independent evidence rejected');}});
  const head={number:'200',hash:hash(200)},event=ABI.encodeEventLog(ABI.getEvent('Sent'),[f.doc.parties.B.endpoint,f.doc.parties.A.container,hash(0),0,0,encode(f.offer)]);
  service.scan['196']={number:'100',hash:hash(100),start:'100'};
  service.ctx=()=>({rpc:()=>({net:{hub:'0x'+'ee'.repeat(20),rpcs:['https://slot-a','https://slot-b']},
    agree:async(method,params)=>{assert.equal(method,'eth_getBlockByNumber');const n=Number(BigInt(params[0]));return {number:String(n),hash:hash(n)};},
    one:async(url,method)=>{assert.equal(url,'https://slot-b');assert.equal(method,'eth_getLogs');return [{...event,transactionHash:hash(901),removed:false}];}})});
  await service.scanChain('196',head);assert.equal(service.jobs.size,1);assert.equal(service.records.size,0);
  await service.processJobs();assert.equal(service.records.size,0);assert.equal(service.history(f.doc.parties.A.name).contracts.length,0);
});
