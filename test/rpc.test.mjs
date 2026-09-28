import test from 'node:test';
import assert from 'node:assert/strict';
import {readRpcResponse,rpcTimeoutMs,RPC_ENDPOINT_TIMEOUT_MS,RPC_UNAVAILABLE} from '../src/rpc-http.js';
import {withRpcFallback} from '../src/vendor/rpc-fallback.js';
import {RpcPair} from '../src/vendor/mainnet.js';
const primary='https://primary.example/public-key',backup='https://backup.example',independent='https://independent.example';
const network={chainId:196,rpcs:[primary,independent],rpcFallbacks:{[primary]:[backup]}};

test('保留本地代理错误详情、RPC 方法和上游域名，隐藏 URL 密钥',async()=>{
  const response=new Response(JSON.stringify({error:'upstream '+primary+' timeout'}),{status:502});
  await assert.rejects(()=>readRpcResponse(response,'eth_getLogs'),e=>{
    assert.equal(e.code,RPC_UNAVAILABLE);assert.match(e.message,/eth_getLogs.*HTTP 502.*primary.example.*timeout/);assert.ok(!e.message.includes('public-key'));return true;
  });
  await assert.rejects(()=>readRpcResponse({status:()=>429,ok:()=>false,text:async()=>JSON.stringify({error:{message:'rate limited'}})},'eth_call'),/HTTP 429.*rate limited/);
  await assert.rejects(()=>readRpcResponse(new Response(JSON.stringify({code:15,message:'You reached free plan rate limit'}),{status:429}),'eth_getLogs'),/HTTP 429.*free plan rate limit/);
  await assert.rejects(()=>readRpcResponse(new Response('<html>proxy error</html>',{status:400}),'eth_call'),/HTTP 400.*invalid JSON/);
});

test('本地请求超时覆盖整个独立节点回退池，成功 JSON 响应保持原样',async()=>{
  assert.ok(rpcTimeoutMs(network,primary,true)>2*RPC_ENDPOINT_TIMEOUT_MS);
  assert.ok(rpcTimeoutMs(network,independent,true)>RPC_ENDPOINT_TIMEOUT_MS);
  assert.equal(rpcTimeoutMs(network,primary,false),RPC_ENDPOINT_TIMEOUT_MS);
  const data={jsonrpc:'2.0',id:1,result:'0xc4'};
  assert.deepEqual(await readRpcResponse(new Response(JSON.stringify(data)),'eth_chainId'),data);
});

test('故障节点切换独立池中的备选节点，后续请求避开冷却中的节点',async()=>{
  const calls=[],transport=withRpcFallback([network],async(url,body)=>{calls.push(url);if(url===primary)throw Error('HTTP 400');return {jsonrpc:'2.0',id:body.id,result:'0xc4'};});
  const rpc=new RpcPair(network,transport);assert.equal(await rpc.agree('eth_chainId',[]),'0xc4');
  assert.ok(calls.includes(primary));assert.ok(calls.includes(backup));assert.ok(calls.includes(independent));
  calls.length=0;await rpc.agree('eth_chainId',[]);assert.ok(!calls.includes(primary));assert.ok(calls.includes(backup));assert.ok(calls.includes(independent));
});

test('最后失败的备选节点被准确标注，不再错误冠以主节点域名',async()=>{
  const transport=withRpcFallback([network],async()=>{throw Error('HTTP 400');});
  await assert.rejects(()=>new RpcPair(network,transport).one(primary,'eth_getLogs',[]),e=>{
    assert.equal(e.code,RPC_UNAVAILABLE);assert.match(e.message,/196.*eth_getLogs.*(?:backup|primary).example.*HTTP 400/);assert.ok(!e.message.includes('public-key'));return true;
  });
});

test('空回执尝试同槽位备用节点；全部查无交易才返回空，非空分歧仍拒绝',async()=>{
  const receipt={transactionHash:'0x123',status:'0x1'},calls=[];
  const transport=withRpcFallback([network],async(url,body)=>{calls.push(url);return {id:body.id,result:url===primary?null:receipt};});
  assert.deepEqual(await new RpcPair(network,transport).agree('eth_getTransactionReceipt',['0x123'],x=>x),receipt);assert.ok(calls.includes(backup));
  const empty=withRpcFallback([network],async()=>({result:null}));assert.equal((await empty(primary,{method:'eth_getTransactionReceipt',params:['0x123']})).result,null);
  const failed=withRpcFallback([network],async url=>{if(url===backup)throw Error('offline');return {result:null};});
  await assert.rejects(()=>failed(primary,{method:'eth_getTransactionReceipt',params:['0x123']}),/offline/);
});

test('全部节点冷却时轮换重试，短暂故障不会锁死在最后一个节点',async()=>{
  let now=0,recovered=false;const calls=[];
  const send=withRpcFallback([network],async url=>{calls.push(url);now++;if(recovered&&url===primary)return {result:'0xaa'};throw Error('timeout');},{now:()=>now});
  await assert.rejects(()=>send(primary,{method:'eth_getCode',params:[]}));recovered=true;calls.length=0;
  assert.equal((await send(primary,{method:'eth_getCode',params:[]})).result,'0xaa');assert.deepEqual(calls,[primary]);
});

test('两个成功响应不一致时仍拒绝，不以第三节点覆盖分歧',async()=>{
  const calls=[],transport=withRpcFallback([network],async url=>{calls.push(url);return {result:url===primary?'0x1':'0x2'};});
  await assert.rejects(()=>new RpcPair(network,transport).agree('eth_chainId',[]),/Independent RPC disagreement/);
  assert.ok(!calls.includes(backup));
  assert.throws(()=>withRpcFallback([{...network,rpcFallbacks:{[primary]:[independent]}}],()=>{}),/independent/);
});

test('a missing receipt in one independent slot waits without accepting the other vote',async()=>{
 const receipt={transactionHash:'0x123',blockHash:'0xabc',status:'0x1'};let synced=false;
 const rpc=new RpcPair(network,async url=>({result:url===independent&&!synced?null:receipt}));
 for(const method of ['eth_getTransactionReceipt','eth_getTransactionByHash'])await assert.rejects(()=>rpc.agree(method,['0x123'],x=>x),e=>e.code==='RPC_SYNC_PENDING'&&e.method===method);
 synced=true;assert.deepEqual(await rpc.agree('eth_getTransactionReceipt',['0x123'],x=>x),receipt);
});

test('conflicting nonempty receipts remain evidence disagreements, not sync waits',async()=>{
 const rpc=new RpcPair(network,async url=>({result:{transactionHash:'0x123',blockHash:url===primary?'0xaaa':'0xbbb',status:'0x1'}}));
 await assert.rejects(()=>rpc.agree('eth_getTransactionReceipt',['0x123'],x=>x),e=>e.code==='RPC_DISAGREEMENT');
 const empty=new RpcPair(network,async()=>({result:null}));assert.equal(await empty.agree('eth_getTransactionReceipt',['0x123'],x=>x),null);
 const call=new RpcPair(network,async url=>({result:url===primary?null:'0x01'}));await assert.rejects(()=>call.agree('eth_call',[],x=>x),e=>e.code==='RPC_DISAGREEMENT');
});

test('范围日志限流不禁用回执、历史状态及单区块日志能力',async()=>{
  const calls=[],transport=withRpcFallback([network],async(url,body)=>{
    calls.push([url,body.method]);
    if(body.method==='eth_getLogs'&&body.params[0].fromBlock!==body.params[0].toBlock)throw Error('limit exceeded');
    return {result:'0xaa'};
  });
  await assert.rejects(()=>transport(primary,{method:'eth_getLogs',params:[{fromBlock:'0x1',toBlock:'0x64'}]}));
  for(const body of [{method:'eth_getTransactionReceipt',params:['0x123']},{method:'eth_getCode',params:['0x123','0x1']},{method:'eth_getLogs',params:[{fromBlock:'0x1',toBlock:'0x1'}]}]){
    calls.length=0;await transport(primary,body);assert.equal(calls[0][0],primary);
  }
});
