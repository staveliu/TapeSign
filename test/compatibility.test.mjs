import test from 'node:test';
import assert from 'node:assert/strict';
import {canContinue,COMPATIBLE_RELEASES} from '../src/compatibility.js';
import {document,hash} from './fixture.mjs';
test('V2 仅继续同版本合同；不迁移 V1，不改写历史合同',()=>{
  const doc=document(),current=hash(999);doc.client.release=COMPATIBLE_RELEASES[0];
  const original=JSON.stringify(doc);assert.equal(canContinue(doc,current),true);assert.equal(JSON.stringify(doc),original);
  for(const release of COMPATIBLE_RELEASES){doc.client.release=release;assert.equal(canContinue(doc,current),true);}
  doc.client.release=hash(333);assert.equal(canContinue(doc,current),false);
  doc.client.release=current;assert.equal(canContinue(doc,current),true);
  doc.protocol='TAPESIGN-1';assert.equal(canContinue(doc,current),false);
});
