import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,hash} from './fixture.mjs';
import {documentId} from '../src/protocol.js';
import {assertContains,assertSuccessor,followContract} from '../src/contract-follow.js';
async function bundles(){
  const f=await fixture({crossChain:true});
  const offer={record:f.offer,location:f.offerLocation},acceptance={record:f.accept,location:f.acceptLocation},seal={record:f.seal,location:f.sealLocation};
  const first={doc:f.doc,offer,selected:f.offerLocation,status:'invited',ready:true};
  const second={...first,acceptance,selected:f.acceptLocation,status:'signed'};
  return {f,first,second,third:{...second,seal,selected:f.sealLocation,status:'sealed'}};
}
test('原发起链接通过缓存定位回签，状态必须来自独立链上核验',async()=>{
  const {first,second}=await bundles();let calls=0;
  const result=await followContract(first,{lookup:async()=>({bundle:{...second,ready:true}}),load:async loc=>{calls++;assert.deepEqual(loc,second.selected);return {...second,ready:false};}});
  assert.equal(calls,1);assert.equal(result.bundle.status,'signed');assert.equal(result.bundle.ready,false);assertContains(result.bundle,first.selected);
});
test('缓存暂未发现回签或不可用时从增量收件箱定位；失败不伪造签署状态',async()=>{
  const {first,second}=await bundles(),rows=[{contractId:first.doc.contractId,documentHash:documentId(first.doc),type:'accept',location:second.selected}];
  for(const lookup of [async()=>({bundle:first}),async()=>{throw Error('offline');}]){
    const r=await followContract(first,{lookup,discover:async()=>({rows}),load:async()=>second});assert.equal(r.bundle.status,'signed');
  }
  const r=await followContract(first,{lookup:async()=>({bundle:second}),load:async()=>{throw Error('bad evidence');}});assert.equal(r.bundle,first);assert.match(r.error.message,/bad evidence/);
});
test('拒绝不同正文、不同发起交易、不同回签分支和伪造缓存签名',async()=>{
  const {first,second,third}=await bundles();
  for(const mutate of [b=>b.doc.title+='伪造',b=>b.offer.location.tx=hash(999),b=>b.acceptance.record.consent.signature='0x'+'00'.repeat(65)]){
    const bad=structuredClone(second);mutate(bad);let reads=0;
    const r=await followContract(first,{lookup:async()=>({bundle:bad}),load:async()=>{reads++;return bad;}});assert.equal(r.bundle,first);assert.equal(reads,0);
  }
  const wrong=structuredClone(third);wrong.acceptance.location.tx=hash(888);assert.throws(()=>assertSuccessor(second,wrong));
  assert.throws(()=>assertContains(second,{chainId:'56',tx:hash(888)}));
});
test('原回签自动发现归档，切换页面后不继续发出链上读取',async()=>{
  const {second,third}=await bundles();let calls=0;
  const result=await followContract(second,{lookup:async()=>({bundle:third}),load:async()=>{calls++;return third;}});assert.equal(result.bundle.status,'sealed');
  await followContract(second,{lookup:async()=>({bundle:third}),isCurrent:()=>false,load:async()=>{calls++;return third;}});assert.equal(calls,1);
});
