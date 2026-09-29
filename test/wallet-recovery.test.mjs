import test from 'node:test';
import assert from 'node:assert/strict';
import {withRecoveryDeadline} from '../src/wallet-recovery.js';
import {RpcPair} from '../src/vendor/mainnet.js';
import {withRpcFallback} from '../src/vendor/rpc-fallback.js';
import {context,config} from '../src/rpc.js';

test('recovery timeout reports its stage and prevents a late local write',async()=>{
 let release,writes=0,signal;
 const gate=new Promise(resolve=>release=resolve);
 const result=withRecoveryDeadline(async scope=>{signal=scope.signal;scope.report('读取交易回执');await gate;scope.signal.throwIfAborted();writes++;},{timeoutMs:20});
 await assert.rejects(result,e=>e.code==='WALLET_RECOVERY_TIMEOUT'&&e.stage==='读取交易回执');
 assert.equal(signal.aborted,true);release();await new Promise(r=>setTimeout(r,5));assert.equal(writes,0);
});
test('normal recovery returns normally and does not later abort',async()=>{
 let signal;const progress=[];assert.equal(await withRecoveryDeadline(async scope=>{signal=scope.signal;scope.report('核验完成');return 7;},{timeoutMs:20,onProgress:s=>progress.push(s)}),7);
 await new Promise(r=>setTimeout(r,25));assert.equal(signal.aborted,false);assert.deepEqual(progress,['核验完成']);
});
test('cancelled RPC does not retry or probe more fallback endpoints',async()=>{
 const abort=new DOMException('Cancelled recovery','AbortError'),net={chainId:196,rpcs:['https://a.example','https://b.example'],rpcFallbacks:{'https://a.example':['https://c.example']}};
 let sends=0;const transport=withRpcFallback([net],async()=>{sends++;throw abort;}),pair=new RpcPair(net,transport);
 await assert.rejects(pair.agree('eth_chainId',[]),e=>e===abort);assert.equal(sends,2);
});
test('production RPC context forwards operation cancellation to fetch',async()=>{
 const original=globalThis.fetch;let started,fetchSignal;
 const waiting=new Promise(r=>started=r),abort=new AbortController();
 globalThis.fetch=async(_url,options)=>{fetchSignal=options.signal;started();return new Promise((_,reject)=>{if(options.signal.aborted)reject(options.signal.reason);else options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});};
 try{
  const ctx=context(undefined,undefined,{signal:abort.signal});const task=ctx.rpc(config.networks[0].chainId).agree('eth_chainId',[]);
  await waiting;abort.abort(new DOMException('Stop recovery','AbortError'));await assert.rejects(task,e=>e.name==='AbortError');assert.equal(fetchSignal.aborted,true);
 }finally{globalThis.fetch=original;}
});
