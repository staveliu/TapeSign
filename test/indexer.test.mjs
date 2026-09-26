import test from 'node:test';
import assert from 'node:assert/strict';
import {windowFor,syncIndex} from '../src/indexer.js';
import {Interface} from 'ethers';
import {ABI} from '../src/rpc.js';
import {digest} from '../src/vendor/protocol.js';
import {identity,hash} from './fixture.mjs';
import {saveLocal,readLocal} from '../src/storage.js';
import {rpcUnavailable} from '../src/rpc-http.js';
test('百万条历史首次只取最新 12 条，随后只取新增记录',()=>{
  const first=windowFor(1000000,null);assert.equal(first.end-first.start,12);
  const next=windowFor(1000003,first);assert.equal(next.start,1000000);assert.equal(next.end,1000003);
  const noNew=windowFor(1000003,next);assert.equal(noNew.start,noNew.end);
});
test('大量新增分批推进，向前翻页不跳过新增或遗漏旧页',()=>{
  const first=windowFor(200,null),next=windowFor(400,first);assert.equal(next.start,200);assert.equal(next.end,212);
  const older=windowFor(400,next,true);assert.equal(older.start,176);assert.equal(older.end,188);assert.equal(older.high,212);
  const newer=windowFor(400,older);assert.equal(newer.start,212);assert.equal(newer.end,224);
});
test('重组造成计数减少时重新建立尾部窗口；拒绝损坏游标',()=>{
  assert.deepEqual(windowFor(5,{low:50,high:60}),{start:0,end:5,low:0,high:5});
  assert.deepEqual(windowFor(100,{low:-1,high:10}),windowFor(100,null));
  assert.throws(()=>windowFor(NaN,null));assert.throws(()=>windowFor(-1,null));
});
const paging=new Interface(['function inboxPage(bytes32,uint256,uint256) view returns(tuple(address from,uint56 blockNumber,uint40 timestamp,bytes32 digest)[])']);
function mockContext({omit=false}={}){
  const me=identity('A'),from=identity('B').container,payload='0x010203',ref=hash(0),hub='0x'+'ee'.repeat(20),event=ABI.encodeEventLog(ABI.getEvent('Sent'),[me.endpoint,from,ref,0,0,payload]);
  const entry={from,blockNumber:100n,timestamp:10000n,digest:digest(ref,payload)};
  const calls=[];
  return {me,calls,ctx:{onProgress:()=>{},head:async()=>({number:'200',hash:hash(200),timestamp:'20000'}),rpc(chain){return {net:{hub},attest:async()=>{},call:async(to,fn)=>[fn==='inboxCount'&&chain==='196'?1n:0n],agree:async(method,params,normalize=x=>x)=>{
    calls.push(method);
    if(method==='eth_call')return normalize(paging.encodeFunctionResult('inboxPage',[[entry]]));
    if(method==='eth_getLogs')return normalize(omit?[]:[{address:hub,topics:event.topics,data:event.data,transactionHash:hash(10),removed:false}]);
    if(method==='eth_getBlockByNumber')return normalize({number:'0xc8',hash:hash(200),timestamp:'0x4e20'});
    throw Error('Unexpected '+method);
  }};}}};
}
test('RPC 漏日志时不推进游标，即使是其他应用消息也必须核对完整性',async()=>{
  const key=`index:196:${identity('A').endpoint}:in`;saveLocal(key,null);
  const {me,ctx}=mockContext({omit:true});await assert.rejects(()=>syncIndex(me,{ctx}),/日志缺失/);assert.equal(readLocal(key),null);
});
test('其他应用消息验证存在后跳过；再次刷新无新增不读取历史页面和日志',async()=>{
  const key=`index:196:${identity('A').endpoint}:in`;saveLocal(key,null);
  const first=mockContext(),result=await syncIndex(first.me,{ctx:first.ctx});assert.equal(result.rows.length,0);assert.equal(readLocal(key).high,1);assert.ok(first.calls.includes('eth_getLogs'));
  const second=mockContext();await syncIndex(second.me,{ctx:second.ctx});assert.ok(!second.calls.includes('eth_getLogs'));assert.ok(!second.calls.includes('eth_call'));
});

test('一条链故障仍返回另一条链的记录，失败链游标不被推进',async()=>{
  const {me,ctx}=mockContext(),row={location:{chainId:'196',tx:hash(999)},label:'已找到的合同'};
  const goodKey=`index:196:${me.endpoint}:in`,badKey=`index:56:${me.endpoint}:in`;
  saveLocal(goodKey,{low:0,high:1,rows:[row]});const old={low:0,high:0,rows:[]};saveLocal(badKey,old);
  const head=ctx.head;ctx.head=async chain=>{if(chain==='56')throw rpcUnavailable('eth_getLogs: HTTP 400');return head(chain);};
  const updates=[],result=await syncIndex(me,{ctx,onUpdate:r=>updates.push(r)});
  assert.equal(result.partial,true);assert.equal(result.errors[0].chain,'56');assert.deepEqual(result.pending,[]);assert.deepEqual(result.rows,[row]);
  assert.ok(result.progress.some(p=>p.chain==='196'));assert.equal(readLocal(badKey),old);assert.ok(updates.some(r=>r.rows.length===1));
});

test('慢链尚未结束时先展示已经完成的信箱，两个链均失败时明确为未同步',async()=>{
  const {me,ctx}=mockContext();let releaseSlow,received;
  const slow=new Promise(resolve=>releaseSlow=resolve),visible=new Promise(resolve=>received=resolve),head=ctx.head;
  ctx.head=async chain=>{if(chain==='56')await slow;return head(chain);};
  const task=syncIndex(me,{ctx,onUpdate:r=>{if(r.progress.some(p=>p.chain==='196'))received(r);}});
  const early=await visible;assert.ok(early.pending.includes('56'));releaseSlow();assert.deepEqual((await task).pending,[]);
  ctx.head=async()=>{throw rpcUnavailable('RPC timeout');};
  const failed=await syncIndex(me,{ctx});assert.equal(failed.partial,true);assert.equal(failed.errors.length,2);assert.equal(failed.progress.length,0);
});

test('节点成功返回的证据分歧不能降级为可忽略的部分查询',async()=>{
  const {me,ctx}=mockContext();ctx.head=async()=>{throw Error('Independent RPC disagreement: eth_getBlockByNumber');};
  await assert.rejects(()=>syncIndex(me,{ctx}),/Independent RPC disagreement/);
});
