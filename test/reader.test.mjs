import test from 'node:test';
import assert from 'node:assert/strict';
import {toQuantity} from 'ethers';
import {ABI} from '../src/rpc.js';
import {digest} from '../src/vendor/protocol.js';
import {loadContract,assertBundleCurrent} from '../src/reader.js';
import {documentId,encode,ZERO,otherRole} from '../src/protocol.js';
import config from '../config/networks.json' with {type:'json'};
import {fixture,hash} from './fixture.mjs';

async function setup(options={},attack=''){
  const f=await fixture(options),records=new Map(),counts={receipts:0,logs:0},messages=[];
  for(const [i,record,location]of [[1,f.offer,f.offerLocation],[2,f.accept,f.acceptLocation],[3,f.seal,f.sealLocation]]){
    const role=i===2?otherRole(f.doc.initiator):f.doc.initiator,identity=f.doc.parties[role],to=f.doc.parties[otherRole(role)].endpoint,ref=i===1?ZERO:documentId(f.doc),payload=encode(record),number=100+i,blockHash=hash(1000+i),hub=config.networks.find(n=>String(n.chainId)===location.chainId).hub;
    const event=ABI.encodeEventLog(ABI.getEvent('Sent'),[to,identity.container,ref,i,i,payload]);
    const receipt={transactionHash:location.tx,status:'0x1',blockNumber:toQuantity(number),blockHash,from:identity.holder,to:hub,logs:[{address:hub,topics:event.topics,data:event.data,blockHash,transactionHash:location.tx,removed:false}]};
    const tx={hash:location.tx,from:identity.holder,to:hub,input:ABI.encodeFunctionData('send',[identity.processor,identity.tokenId,to,ref,payload]),blockHash,value:'0x0'};
    messages.push({record,location,identity,to,ref,payload,receipt,tx,number,blockHash,i,hub});
  }
  if(attack==='sender')messages[1].receipt.from=messages[1].tx.from=f.doc.parties[f.doc.initiator].holder;
  if(attack==='destination')messages[0].tx.input=ABI.encodeFunctionData('send',[messages[0].identity.processor,messages[0].identity.tokenId,f.doc.parties[f.doc.initiator].endpoint,ZERO,messages[0].payload]);
  if(attack==='failed')messages[2].receipt.status='0x0';
  if(attack==='duplicate')messages[0].receipt.logs.push(messages[0].receipt.logs[0]);
  if(attack==='removed')messages[0].receipt.logs[0].removed=true;
  let blockReads=0;
  const ctx={records,onProgress:()=>{},head:async(chain,tag='finalized')=>({number:tag==='latest'?String(options.latestHeight??200):String(options.finalizedHeight??(attack==='pending'?100:200)),hash:hash(9999),timestamp:String(Math.floor(Date.now()/1000)-(options.stale?120:0))}),assert:async()=>{if(attack==='snapshot')throw Error('Snapshot reorg');},rpc(chain){
    const net=config.networks.find(n=>String(n.chainId)===String(chain));
    return {net,attest:async()=>{if(attack==='implementation')throw Error('implementation changed');},resolve:async(name)=>{const p=Object.values(f.doc.parties).find(p=>p.name===name);return attack==='holder'?{...p,holder:'0x'+'99'.repeat(20)}:p;},
      async agree(method,params,normalize=x=>x){let value;
        if(method==='eth_getTransactionReceipt'){counts.receipts++;value=messages.find(m=>m.location.chainId===String(chain)&&m.location.tx===params[0])?.receipt;}
        else if(method==='eth_getTransactionByHash')value=messages.find(m=>m.location.tx===params[0])?.tx;
        else if(method==='eth_getBlockByNumber'){const m=messages.find(m=>m.number===Number(BigInt(params[0])));blockReads++;value={number:toQuantity(m.number),hash:attack==='reorg'||(attack==='late-reorg'&&blockReads>3)?hash(8888):m.blockHash,timestamp:toQuantity(10000+m.i)};}
        else if(method==='eth_getLogs'){counts.logs++;throw Error('unexpected history scan');}
        else throw Error('Unexpected RPC '+method);
        return normalize(value);
      },async call(to,fn,args,at){
        const m=messages.find(m=>m.number===Number(BigInt(at))),digestValue=attack==='digest'?hash(7777):digest(m.ref,m.payload);
        if(fn==='inboxAt')return [{from:m.identity.container,blockNumber:BigInt(m.number),timestamp:BigInt(10000+m.i),digest:digestValue}];
        if(fn==='outboxPage')return [[{to:m.to,inboxIndex:BigInt(m.i),blockNumber:BigInt(m.number),timestamp:BigInt(10000+m.i),digest:digestValue}]];
        throw Error('Unexpected contract call '+fn);
      }
    };
  }};
  return {f,ctx,counts};
}
test('打开最终归档只读三笔交易，不调用历史日志扫描；跨链双方独立核验',async()=>{
  for(const crossChain of [false,true])for(const initiator of ['A','B']){const {f,ctx,counts}=await setup({crossChain,initiator});const r=await loadContract(f.sealLocation,ctx);assert.equal(r.status,'sealed');assert.equal(r.id,documentId(f.doc));assert.equal(counts.receipts,3);assert.equal(counts.logs,0);}
});
test('邀请链接只核验一笔；回签链接核验两笔',async()=>{
  const first=await setup();assert.equal((await loadContract(first.f.offerLocation,first.ctx)).status,'invited');assert.equal(first.counts.receipts,1);
  const second=await setup();assert.equal((await loadContract(second.f.acceptLocation,second.ctx)).status,'signed');assert.equal(second.counts.receipts,2);
});
for(const attack of ['sender','destination','failed','duplicate','removed','pending','snapshot','implementation','holder','reorg','late-reorg','digest'])test('拒绝错误链上证据：'+attack,async()=>{const {f,ctx}=await setup({},attack);await assert.rejects(()=>loadContract(f.sealLocation,ctx));});
test('已打包但未最终确认：显式预览返回正文和进度，默认写入路径仍拒绝',async()=>{
  const {f,ctx,counts}=await setup({},'pending');
  const bundle=await loadContract(f.offerLocation,ctx,{allowPending:true});
  assert.equal(bundle.doc.title,f.doc.title);assert.equal(bundle.finalized,false);
  assert.equal(bundle.confirmation[0].transactionBlock,'101');assert.equal(bundle.confirmation[0].finalizedBlock,'100');assert.equal(bundle.confirmation[0].finalizedRemainingBlocks,'1');assert.equal(bundle.ready,false);
  assert.equal(counts.receipts,1);assert.equal(counts.logs,0);
  // Same context cannot reuse preview cache to bypass strict finality.
  await assert.rejects(()=>loadContract(f.offerLocation,ctx),e=>e.code==='FINALITY_PENDING');
});
test('短确认边界：X Layer 必须满 12 个后续区块，BSC 满 24 个',async()=>{
  for(const [crossChain,initiator,required] of [[false,'A',12],[true,'B',24]]){
    const early=await setup({crossChain,initiator,finalizedHeight:100,latestHeight:101+required-1});
    const preview=await loadContract(early.f.offerLocation,early.ctx,{confirmation:'fast',allowPending:true});assert.equal(preview.ready,false);assert.equal(preview.confirmation[0].remainingBlocks,'1');
    await assert.rejects(()=>loadContract(early.f.offerLocation,early.ctx,{confirmation:'fast'}),e=>e.code==='CONFIRMATION_PENDING');
    const enough=await setup({crossChain,initiator,finalizedHeight:100,latestHeight:101+required});
    const ready=await loadContract(enough.f.offerLocation,enough.ctx,{confirmation:'fast'});assert.equal(ready.ready,true);assert.equal(ready.finalized,false);assert.equal(ready.confirmation[0].remainingBlocks,'0');
    await assert.rejects(()=>loadContract(enough.f.offerLocation,enough.ctx),e=>e.code==='FINALITY_PENDING');
  }
});
test('节点落后拒绝短确认写入，但允许显示正文；归档中每个引用均需足够确认',async()=>{
  const stale=await setup({finalizedHeight:100,stale:true});await assert.rejects(()=>loadContract(stale.f.offerLocation,stale.ctx,{confirmation:'fast'}),e=>e.code==='CONFIRMATION_PENDING');
  const preview=await loadContract(stale.f.offerLocation,stale.ctx,{confirmation:'fast',allowPending:true});assert.equal(preview.ready,false);assert.equal(preview.confirmation[0].fresh,false);
  const cross=await setup({crossChain:true,finalizedHeight:100,latestHeight:115});
  const partial=await loadContract(cross.f.sealLocation,cross.ctx,{confirmation:'fast',allowPending:true});assert.equal(partial.ready,false);assert.equal(partial.offer.ready,true);assert.equal(partial.acceptance.ready,false);
});
test('发送前复查：钱包等待期间重组、回执消失、确认减少或节点落后都会阻止发送',async()=>{
  const initial=await setup({finalizedHeight:100}),bundle=await loadContract(initial.f.acceptLocation,initial.ctx,{confirmation:'fast'});
  const valid=await setup({finalizedHeight:100});await assertBundleCurrent(bundle,valid.ctx);
  for(const options of [{latestHeight:103,finalizedHeight:100},{stale:true,finalizedHeight:100}]){const changed=await setup(options);await assert.rejects(()=>assertBundleCurrent(bundle,changed.ctx));}
  const reorg=await setup({},'reorg');await assert.rejects(()=>assertBundleCurrent(bundle,reorg.ctx));
  const missing=await setup(),rpc=missing.ctx.rpc;missing.ctx.rpc=chain=>{const r=rpc(chain),agree=r.agree;r.agree=(method,...args)=>method==='eth_getTransactionReceipt'?Promise.resolve(null):agree(method,...args);return r;};await assert.rejects(()=>assertBundleCurrent(bundle,missing.ctx));
});
test('最终确认后重新核验恢复正式状态；预览仍检查所有签名和链上证据',async()=>{
  const before=await setup({},'pending'),pending=await loadContract(before.f.sealLocation,before.ctx,{allowPending:true});assert.equal(pending.finalized,false);assert.equal(pending.confirmation.length,3);
  const after=await setup(),done=await loadContract(after.f.sealLocation,after.ctx,{allowPending:true});assert.equal(done.finalized,true);assert.deepEqual(done.confirmation,[]);
  for(const attack of ['sender','destination','failed','duplicate','removed','snapshot','implementation','holder','reorg','late-reorg','digest']){
    const {f,ctx}=await setup({},attack);await assert.rejects(()=>loadContract(f.sealLocation,ctx,{allowPending:true}));
  }
});
