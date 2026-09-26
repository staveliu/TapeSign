import test from 'node:test';
import assert from 'node:assert/strict';
import {hexlify,toUtf8Bytes} from 'ethers';
import * as p from '../src/protocol.js';
import {fixture,document,ink,hash,signed,identity} from './fixture.mjs';
import config from '../config/networks.json' with {type:'json'};

test('完整协议：甲方、乙方均可发起，支持跨链双方与完整单笔归档',async()=>{
  for(const initiator of ['A','B'])for(const crossChain of [false,true]){
    const f=await fixture({initiator,crossChain});p.validateOffer(f.offer,config.networks);p.validateAccept(f.accept,f.offer,f.offerLocation,config.networks);p.validateSeal(f.seal,f.offer,f.offerLocation,f.accept,f.acceptLocation,config.networks);
    assert.deepEqual(p.decode(p.encode(f.seal)),f.seal);assert.ok(p.encode(f.seal).length<32002);
    assert.equal(f.seal.consents.length,2);assert.deepEqual(f.seal.doc.body,f.doc.body);
  }
});
test('修改正文、标题、甲乙方、持有人、客户端版本、nonce 均破坏签名',async()=>{
  const f=await fixture();
  for(const mutate of [d=>d.body[1].runs[0].text+='篡改',d=>d.title+='篡改',d=>d.initiator='B',d=>d.parties.A.holder=d.parties.B.holder,d=>d.client.release=hash(998),d=>d.nonce=hash(997)]){
    const doc=structuredClone(f.doc);mutate(doc);assert.throws(()=>p.verifyConsent(doc,f.offer.consent,p.ZERO,config.networks));
  }
});
test('替换手写笔迹、盗用对方签名、重放到另一发起交易均失败',async()=>{
  const f=await fixture(),c=structuredClone(f.accept.consent);c.ink[0][1][0]++;
  assert.throws(()=>p.verifyConsent(f.doc,c,f.offerLocation.tx,config.networks));
  assert.throws(()=>p.verifyConsent(f.doc,f.accept.consent,hash(77),config.networks));
  assert.throws(()=>p.verifyConsent(f.doc,{...f.accept.consent,signature:f.offer.consent.signature},f.offerLocation.tx,config.networks));
});
test('归档拒绝缺失签名、重复角色、正文替换、错误交易链接',async()=>{
  const f=await fixture();
  for(const mutate of [r=>r.consents.pop(),r=>r.consents[1]=r.consents[0],r=>r.doc.title='替换',r=>r.accept.tx=hash(77),r=>r.offer.tx=hash(77)]){
    const record=structuredClone(f.seal);mutate(record);assert.throws(()=>p.validateSeal(record,f.offer,f.offerLocation,f.accept,f.acceptLocation,config.networks));
  }
});
test('规范编码拒绝多余字段、重复 JSON key 与非规范编码',async()=>{
  const f=await fixture();assert.throws(()=>p.validateOffer({...f.offer,extra:'evil'},config.networks));
  const json=p.canonical(f.offer).replace('"type":"offer"','"type":"offer","type":"offer"');
  assert.throws(()=>p.decode('0x54530200'+hexlify(toUtf8Bytes(json)).slice(2)));
  assert.throws(()=>p.decode('0x54530200'+hexlify(toUtf8Bytes(JSON.stringify(f.offer,null,2))).slice(2)));
});
test('限制正文、笔迹坐标、控制字符；禁止同一容器双方签署',()=>{
  assert.throws(()=>p.validateInk([]));assert.throws(()=>p.validateInk([[[1,1],[2,2]]]));assert.throws(()=>p.validateInk([[[1,1],[2000,2],[1,3],[40,70]]]));
  assert.throws(()=>p.validateInk([Array.from({length:221},(_,i)=>[i,i])]));
  assert.throws(()=>p.validateBody([{type:'p',runs:[{text:'中'.repeat(2200),marks:0}]}]));
  assert.throws(()=>p.validateBody([{type:'p',runs:[{text:'隐藏\u202e文本',marks:0}]}]));
  const doc=document();doc.parties.B=doc.parties.A;assert.throws(()=>p.validateDocument(doc));
});
test('最大正文与双方最大笔迹仍可完整归档到一笔消息',async()=>{
  const doc=document();doc.body=[{type:'p',runs:[{text:'中'.repeat(2140),marks:0}]}];
  const largeInk=[Array.from({length:220},(_,i)=>[i%2?998:999,400-(i%3)])];
  const first=await signed(doc,'A',p.ZERO,largeInk),second=await signed(doc,'B',hash(1),largeInk);
  const record=p.sealRecord(doc,{chainId:'196',tx:hash(1)},{chainId:'196',tx:hash(2)},[first,second]);assert.ok(p.encode(record).length<=32002);
});
test('链接只携带交易定位，拒绝缺失哈希和不支持的链',()=>{
  const location={chainId:'196',tx:hash(1)},link=p.makeLink(location,'https://example.com/client-a.html?old=1#x');
  assert.deepEqual(p.parseLink(link),location);assert.ok(!link.includes('old='));
  assert.throws(()=>p.parseLink('https://example.com/?chain=1&tx='+hash(1)));
  assert.throws(()=>p.parseLink('https://example.com/?chain=196'));
});
