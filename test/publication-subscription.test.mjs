import test from 'node:test';
import assert from 'node:assert/strict';
import {preflight} from '../scripts/publication.mjs';
import {RpcPair} from '../src/vendor/mainnet.js';

const block={number:'100',timestamp:'1790409600',hash:'0x'+'ab'.repeat(32)};
const identity={name:'4.2.204.tape',chainId:'196',container:'0x'+'11'.repeat(20),holder:'0x'+'22'.repeat(20)};
function setup(t,{containerLive=false,nameLive=false,failAt=null,reorg=false}={}){
  const calls=[];
  t.mock.method(RpcPair.prototype,'pin',async()=>block);
  t.mock.method(RpcPair.prototype,'attest',async()=>{calls.push('attest');if(failAt==='attest')throw Error('implementation changed');});
  t.mock.method(RpcPair.prototype,'resolve',async()=>{calls.push('resolve');if(failAt==='resolve')throw Error('Container is not opened');return identity;});
  t.mock.method(RpcPair.prototype,'call',async(to,fn)=>{calls.push(fn);if(failAt==='rpc')throw Error('Independent RPC disagreement');return [{isContainerLive:containerLive,isLive:nameLive,containerPaidUntil:containerLive?1793001600n:0n,paidUntil:nameLive?1795593600n:0n}[fn]];});
  t.mock.method(RpcPair.prototype,'agree',async()=>({...block,hash:reorg?'0x'+'cd'.repeat(32):block.hash}));
  return calls;
}
test('publication allows a verified opened container without gateway subscription',async t=>{
  const calls=setup(t);const p=await preflight(()=>{});
  assert.equal(p.opened,true);assert.equal(p.siteLive,false);assert.equal(p.paidUntil,'0');
  assert.deepEqual(p.identity,identity);assert.ok(calls.includes('attest'));assert.ok(calls.includes('resolve'));
});
for(const status of [{containerLive:true,nameLive:false},{containerLive:false,nameLive:true},{containerLive:true,nameLive:true}]){
  test('gateway accepts either paid container or paid name: '+JSON.stringify(status),async t=>{
    setup(t,status);const p=await preflight(()=>{},{requireLive:true});assert.equal(p.siteLive,true);
    assert.equal(p.paidUntil,status.nameLive?'1795593600':'1793001600');
  });
}
test('explicit gateway check still rejects unpaid subscription',async t=>{
  setup(t);await assert.rejects(preflight(()=>{},{requireLive:true}),/官方网关/);
});
for(const failAt of ['attest','resolve','rpc'])test('unpaid upload never bypasses '+failAt,async t=>{
  setup(t,{failAt});await assert.rejects(preflight(()=>{}),/implementation changed|not opened|disagreement/);
});
test('publication rejects a changed chain snapshot',async t=>{
  setup(t,{reorg:true});await assert.rejects(preflight(()=>{}),/snapshot changed/);
});
