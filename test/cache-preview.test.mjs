import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePreview} from '../src/cache-preview.js';
import {fixture,hash} from './fixture.mjs';
import config from '../config/networks.json' with {type:'json'};
test('缓存预览绑定所选交易和完整签名链，不信任服务端 ready 标志',async()=>{
  const f=await fixture({crossChain:true}),bundle={doc:f.doc,selected:f.sealLocation,offer:{location:f.offerLocation,record:f.offer},acceptance:{location:f.acceptLocation,record:f.accept},seal:{location:f.sealLocation,record:f.seal},ready:true};
  const p=validatePreview({bundle},f.sealLocation,config.networks);assert.equal(p.doc.contractId,f.doc.contractId);assert.equal(p.signatures.length,2);assert.equal(p.ready,undefined);
  for(const mutate of [b=>b.doc.title+='伪造',b=>b.selected.tx=hash(999),b=>b.acceptance.record.offer.tx=hash(998),b=>b.seal.record.consents.pop(),b=>b.offer.location.tx=hash(888),b=>b.seal.location.chainId='56']){const bad=structuredClone(bundle);mutate(bad);assert.throws(()=>validatePreview({bundle:bad},f.sealLocation,config.networks));}
  assert.equal(validatePreview({bundle:null},f.sealLocation,config.networks),null);
});
