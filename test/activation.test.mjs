import test from 'node:test';
import assert from 'node:assert/strict';
import {keccak256,toUtf8Bytes} from 'ethers';
import {activationDomain,activationTransaction,assertActivationUnchanged,readActivation,bindingABI} from '../src/activation.js';
import {RpcPair} from '../src/vendor/mainnet.js';

const identity={name:'4.2.204.tape',chainId:'196',container:'0x'+'11'.repeat(20),holder:'0x'+'22'.repeat(20)};
const base=()=>({identity:{...identity},binding:'0x'+'33'.repeat(20),block:{number:'100',timestamp:'1000',hash:'0x'+'ab'.repeat(32)},siteLive:false,months:1,monthlyFeeWei:'26000000000000000',domain:'example.com',domainLive:true,domainUntil:'2000'});

test('activation encodes the canonical name, container and exact live fee for each period',()=>{
  for(const months of [1,3,12,120]){const q={...base(),months},tx=activationTransaction(q,'bind');
    assert.equal(tx.to,q.binding);assert.equal(BigInt(tx.value),26000000000000000n*BigInt(months));
    assert.deepEqual([...bindingABI.decodeFunctionData('bind',tx.data)],[identity.name,identity.container,BigInt(months)]);}
});
test('activation rejects invalid periods, fees and already active subscriptions',()=>{
  for(const months of [0,121,1.5,NaN,'1'])assert.throws(()=>activationTransaction({...base(),months},'bind'));
  assert.throws(()=>activationTransaction({...base(),monthlyFeeWei:'-1'},'bind'));
  for(const kind of ['bind','sync'])assert.throws(()=>activationTransaction({...base(),siteLive:true},kind),/已生效/);
});
test('old-domain sync encodes zero value and requires unexpired payment for the same container',()=>{
  const tx=activationTransaction(base(),'sync');assert.equal(tx.value,'0x0');
  assert.deepEqual([...bindingABI.decodeFunctionData('syncContainer',tx.data)],['example.com',identity.container]);
  for(const change of [{domain:''},{domainLive:false},{domainUntil:'999'},{domainUntil:'1000'}])assert.throws(()=>activationTransaction({...base(),...change},'sync'),/有效付费记录/);
});
test('confirmation rejects changed fee, holder, destination, periods and new activation',()=>{
  const q=base();assert.doesNotThrow(()=>assertActivationUnchanged(q,structuredClone(q),'bind'));
  for(const change of [{monthlyFeeWei:'1'},{months:3},{binding:'0x'+'44'.repeat(20)},{identity:{...identity,holder:'0x'+'55'.repeat(20)}},{siteLive:true}])assert.throws(()=>assertActivationUnchanged(q,{...q,...change},'bind'));
});
test('old domain accepts normalized names and rejects URLs and paths',()=>{
  assert.equal(activationDomain(' EXAMPLE.com '),'example.com');assert.equal(activationDomain('4.2.204.tape'),'4.2.204.tape');
  for(const value of ['https://example.com','example.com/a','x','-a.com','a..com','a.com?x=1'])assert.throws(()=>activationDomain(value));
});
function mockRead(t,{containerLive=false,nameLive=false,age=0,reorg=false,failAt}={}){
  const q=base(),calls=[];t.mock.method(Date,'now',()=>1000000);
  t.mock.method(RpcPair.prototype,'pin',async tag=>{assert.equal(tag,'latest');return {...q.block,timestamp:String(1000-age)};});
  t.mock.method(RpcPair.prototype,'attest',async(at,options)=>{assert.equal(at,'0x64');assert.equal(options.publication,true);if(failAt==='attest')throw Error('Code changed');});
  t.mock.method(RpcPair.prototype,'resolve',async()=>{if(failAt==='resolve')throw Error('Invalid container');return identity;});
  t.mock.method(RpcPair.prototype,'call',async(to,fn,args,at)=>{
    assert.equal(at,'0x64');calls.push({fn,args});if(failAt==='rpc')throw Error('Independent RPC disagreement');
    if(fn==='isLive')return [args[0]==='example.com'||nameLive];
    if(fn==='paidUntil')return [args[0]===keccak256(toUtf8Bytes('example.com'))?2000n:nameLive?3000n:0n];
    return [{isContainerLive:containerLive,containerPaidUntil:containerLive?4000n:0n,monthlyFee:26000000000000000n}[fn]];
  });
  t.mock.method(RpcPair.prototype,'agree',async()=>({...q.block,hash:reorg?'0x'+'cd'.repeat(32):q.block.hash}));return calls;
}
test('quote reads fees and old payment from one authenticated chain snapshot',async t=>{
  const calls=mockRead(t),q=await readActivation({months:3,domain:' EXAMPLE.COM '});
  assert.equal(q.total,'0.078');assert.equal(q.monthlyFee,'0.026');assert.equal(q.siteLive,false);assert.equal(q.domainUntil,'2000');
  assert.ok(calls.filter(c=>c.fn==='paidUntil').every(c=>c.args[1]===identity.container));
});
for(const state of [{containerLive:true},{nameLive:true}])test('quote recognizes active state '+JSON.stringify(state),async t=>{mockRead(t,state);assert.equal((await readActivation()).siteLive,true);});
for(const change of [{age:91},{age:-16},{reorg:true},{failAt:'attest'},{failAt:'resolve'},{failAt:'rpc'}])test('quote fails closed '+JSON.stringify(change),async t=>{mockRead(t,change);await assert.rejects(readActivation());});
