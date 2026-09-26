import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmationState} from '../src/confirmation.js';
const final={number:'90',timestamp:'1'},latest=(number,timestamp='1000')=>({number:String(number),timestamp});
test('仅 11 个后续区块不放行；12 个放行但不可标成最终确认',()=>{
  const before=confirmationState('196','100',final,latest(111),1000),after=confirmationState('196','100',final,latest(112),1000);
  assert.equal(before.fast,false);assert.equal(before.remainingBlocks,'1');assert.equal(after.fast,true);assert.equal(after.finalized,false);
});
test('陈旧和未来时间的 latest 均不能授权短确认；finalized 不依赖 latest',()=>{
  assert.equal(confirmationState('196','100',final,latest(200,'939'),1000).fast,false);
  assert.equal(confirmationState('196','100',final,latest(200,'1016'),1000).fast,false);
  assert.equal(confirmationState('196','100',{number:'100'},null,1000).finalized,true);
  assert.equal(confirmationState('196','100',{number:'100'},null,1000).fast,true);
});
