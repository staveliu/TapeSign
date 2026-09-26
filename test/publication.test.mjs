import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyFile} from '../scripts/publication.mjs';
import {sha256} from '../scripts/release.mjs';
test('发布断点恢复：空文件、完整前缀、已完成、错误版本、损坏分块',()=>{
  const expected=Buffer.alloc(50000,42),file={size:expected.length,sha256:sha256(expected)};
  const info=(size,chunks,hash=file.sha256)=>({size:BigInt(size),chunkCount:BigInt(chunks),sha256Hash:hash});
  assert.equal(classifyFile(file,info(0,0),Buffer.alloc(0),expected).next,0);
  assert.equal(classifyFile(file,info(24000,1),expected.subarray(0,24000),expected).next,1);
  assert.equal(classifyFile(file,info(50000,3),expected,expected).complete,true);
  assert.equal(classifyFile(file,info(24001,1),expected.subarray(0,24001),expected).conflict,true);
  assert.equal(classifyFile(file,info(24000,1),Buffer.alloc(24000,99),expected).conflict,true);
  assert.equal(classifyFile(file,info(50000,3,'0x'+'11'.repeat(32)),expected,expected).conflict,true);
});
