import test from 'node:test';
import assert from 'node:assert/strict';
import {createContainerDiscovery,containerLabel,DISCOVERY_ABI as abi,MULTICALL_ABI as multi} from '../src/containers.js';
import {rpcUnavailable} from '../src/rpc-http.js';
const address=n=>'0x'+n.toString(16).padStart(40,'0'),hash=n=>'0x'+n.toString(16).padStart(64,'0');
const owner=address(1),other=address(2),factory=address(30),opener=address(31),cpus=[address(10),address(11)];
function fixture(){
  const log=[],state={fault:false,reorg:false,unreadable:false,disagree:false,attestFail:false,attests:0};
  const rpc={net:{factory,opener},pin:async()=>({number:'100',hash:hash(100),timestamp:'4660'}),attest:async()=>{state.attests++;if(state.attestFail)throw rpcUnavailable('attest timeout');},agree:async(method,params,normalize=x=>x)=>{
    if(state.disagree)throw Error('Independent RPC disagreement');
    if(method==='eth_getBlockByNumber')return normalize({number:'0x64',timestamp:'0x1234',hash:hash(state.reorg?101:100)});
    assert.equal(method,'eth_call');assert.equal(params[1],'0x64');
    const [calls]=multi.decodeFunctionData('aggregate3',params[0].data);
    const results=calls.map(call=>{const {name,args}=abi.parseTransaction({data:call.callData});log.push({name,to:call.target.toLowerCase(),args:[...args]});let result;
      if(name==='cpuCount')result=2n;if(name==='cpuAt')result=cpus[Number(args[0])];if(name==='nextId')result=3n;
      if(name==='ownerOf'){if(state.fault)throw rpcUnavailable('node unavailable');if(state.unreadable&&args[0]===3n)return [false,'0x'];result=args[0]===2n?other:owner;}
      if(name==='isOpened')result=!(args[0].toLowerCase()===cpus[0]&&args[1]===1n);
      return [true,abi.encodeFunctionResult(name,[result])];
    });return multi.encodeFunctionResult('aggregate3',[results]);
  }};return {log,state,ctx:{head:async()=>({number:'100',hash:hash(100),timestamp:'4660'}),rpc:()=>rpc}};
}
test('短 ID 去除输入后缀，钱包容器只列本人持有且已开通项',async()=>{
  assert.equal(containerLabel(' 1.2.204.tape '),'1.2.204');assert.equal(containerLabel('2.204.TAPE'),'2.204');
  const {ctx}=fixture(),s=createContainerDiscovery(owner,{ctx,chains:['196']});const r=await s.scan();
  assert.deepEqual(r.rows.map(r=>r.name),['3.2.1','1.2.1','3.2.0']);assert.equal(r.hasMore,false);assert.equal(r.progress[0].scanned,6);
});
test('分页继续从游标开始，已经查询过的 ownerOf 不会重扫',async()=>{
  const {ctx,log}=fixture(),s=createContainerDiscovery(owner,{ctx,chains:['56']});
  const first=await s.scan({limit:2});assert.equal(first.hasMore,true);assert.deepEqual(first.rows.map(r=>r.name),['3.1']);
  const last=await s.scan({limit:4});assert.equal(last.hasMore,false);assert.equal(log.filter(c=>c.name==='ownerOf').length,6);
  await s.scan();assert.equal(log.filter(c=>c.name==='ownerOf').length,6);assert.deepEqual(first.rows.map(r=>r.name),['3.1']);
});
test('RPC 失败不推进失败批次；代码核验失败重试必须重新核验',async()=>{
  const {ctx,state}=fixture(),s=createContainerDiscovery(owner,{ctx,chains:['196']});state.attestFail=true;
  let r=await s.scan();assert.equal(r.progress[0].scanned,0);assert.match(r.progress[0].error,/timeout/);
  state.attestFail=false;state.fault=true;r=await s.scan();assert.equal(state.attests,2);assert.equal(r.progress[0].scanned,0);
  state.fault=false;r=await s.scan();assert.equal(r.rows.length,3);assert.equal(r.progress[0].scanned,6);
});
test('子调用未读到不冒充空钱包；重组和节点分歧仍拒绝',async()=>{
  const {ctx,state}=fixture();state.unreadable=true;let s=createContainerDiscovery(owner,{ctx,chains:['196']});
  const r=await s.scan();assert.equal(r.progress[0].unreadable,2);assert.equal(r.rows.length,1);
  state.reorg=true;s=createContainerDiscovery(owner,{ctx,chains:['196']});await assert.rejects(()=>s.scan(),/重组/);assert.equal(s.snapshot().rows.length,0);
  state.reorg=false;state.disagree=true;s=createContainerDiscovery(owner,{ctx,chains:['196']});await assert.rejects(()=>s.scan(),/disagreement/);
});
test('账户变化或关闭后取消查询；不接受无效钱包',async()=>{
  const {ctx,log}=fixture(),controller=new AbortController();controller.abort();
  const s=createContainerDiscovery(owner,{ctx,chains:['196'],signal:controller.signal});await assert.rejects(()=>s.scan(),e=>e.name==='AbortError');assert.equal(log.length,0);
  assert.throws(()=>createContainerDiscovery('bad'),/钱包地址无效/);
});
