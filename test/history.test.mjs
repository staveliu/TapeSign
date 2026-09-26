import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,hexlify} from 'ethers';
import {contractNumber,CONTRACT_ID} from '../src/contract-id.js';
import {groupContracts,historyRow} from '../src/history.js';
import {fixture,hash,document} from './fixture.mjs';
import {validateDocument,validateAccept,validateSeal,documentId,verifyConsent,ZERO} from '../src/protocol.js';
import config from '../config/networks.json' with {type:'json'};
test('同一毫秒跨客户端生成不同合同号，UTC 时间可回读且签名覆盖编号',async()=>{
  const time=1790409600000,ids=new Set(Array.from({length:1000},()=>contractNumber(time,hexlify(randomBytes(32)))));
  assert.equal(ids.size,1000);assert.ok([...ids].every(id=>CONTRACT_ID.test(id)&&id.startsWith('TS-20260926080000000-')));
  const f=await fixture(),doc=structuredClone(f.doc);doc.contractId=contractNumber(doc.createdAt,hexlify(randomBytes(32)));assert.throws(()=>validateDocument(doc));
  doc.nonce=hexlify(randomBytes(32));doc.contractId=contractNumber(doc.createdAt,doc.nonce);assert.notEqual(documentId(doc),documentId(f.doc));assert.throws(()=>verifyConsent(doc,f.offer.consent,ZERO,config.networks));
});
test('offer、accept、seal 跨链与重复回放只显示一份，优先打开归档',async()=>{
  const f=await fixture({crossChain:true});
  const rows=[historyRow(f.offer,f.offerLocation),historyRow(f.accept,f.acceptLocation,f.doc),historyRow(f.seal,f.sealLocation)];
  for(const input of [rows,[...rows].reverse(),[...rows,...rows]]){const grouped=groupContracts(input);assert.equal(grouped.length,1);assert.equal(grouped[0].type,'seal');assert.equal(grouped[0].transactions.length,3);assert.deepEqual(grouped[0].location,f.sealLocation);assert.equal(grouped[0].contractId,f.doc.contractId);}
  assert.equal(groupContracts(rows,f.doc.parties.A.name).length,1);assert.equal(groupContracts(rows,f.doc.parties.B.name.replace('.tape','')).length,1);assert.equal(groupContracts(rows,'999.2.204').length,0);
});
test('无标题的回签不覆盖正文标题，编号冲突明显标记，不混入旧版本行',async()=>{
  const f=await fixture(),offer=historyRow(f.offer,f.offerLocation),accept=historyRow(f.accept,f.acceptLocation);
  const rows=groupContracts([offer,accept,{...accept,documentHash:hash(800),location:{chainId:'56',tx:hash(888)}},{location:f.offerLocation,label:'旧合同'}]);
  assert.equal(rows.length,1);assert.equal(rows[0].label,f.doc.title);assert.equal(rows[0].conflict,true);
});
test('回签和归档的外层编号必须匹配正文；不同正文不可冒用同一编号',async()=>{
  const f=await fixture(),a=structuredClone(f.accept),s=structuredClone(f.seal);
  a.contractId=contractNumber(f.doc.createdAt+1,f.doc.nonce);assert.throws(()=>validateAccept(a,f.offer,f.offerLocation,config.networks));
  s.contractId=a.contractId;assert.throws(()=>validateSeal(s,f.offer,f.offerLocation,f.accept,f.acceptLocation,config.networks));
  a.contractId=f.doc.contractId;a.documentHash=hash(700);assert.throws(()=>validateAccept(a,f.offer,f.offerLocation,config.networks));
});
