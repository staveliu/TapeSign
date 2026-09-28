import test from 'node:test';
import assert from 'node:assert/strict';
import {toUtf8Bytes,sha256,getBytes,encodeBase64} from 'ethers';
import {notaryFixture,notaryContext} from './notary-fixture.mjs';
import {hash} from './fixture.mjs';
import {describeContent,contentParts,encodeNotary,decodeNotary,validateNotary,validateClaim,validateChunk,notaryNumber,CHUNK_BYTES,MAX_PUBLIC_BYTES} from '../src/notary-protocol.js';
import {loadNotarization} from '../src/notary-reader.js';
import {scanNotaryChain,auditNotary,queryNotaries} from '../src/notary-index.js';
import {config} from '../src/rpc.js';
const png=()=>{const bytes=new Uint8Array(20000);bytes.set([137,80,78,71,13,10,26,10]);return bytes;};
test('private notary excludes original text and image bytes; SHA-256 is byte-exact',async()=>{
 for(const [kind,value]of [['text','private unique original\n'],['image',png()]]){const f=await notaryFixture({kind,value,visibility:'private'});assert.equal(f.claim.content,null);assert.equal(f.chunks.length,0);assert.equal(f.claim.hash,sha256(f.info.bytes));assert.equal(contentParts(f.info,'private').length,0);assert.equal(validateNotary(decodeNotary(encodeNotary(f.record)),config.networks).claim.visibility,'private');}
 assert.notEqual(describeContent('a\n','text').hash,describeContent('a','text').hash);
});
test('public content stays byte-exact; large image is chunked within hub limits',async()=>{
 const f=await notaryFixture({kind:'image',value:png()});assert.equal(f.chunks.length,3);for(const c of f.chunks){validateChunk(c);assert.ok(getBytes(encodeNotary(c)).length<=16000);}assert.equal(f.claim.content.chunks.length,3);
 const {ctx}=notaryContext(f),b=await loadNotarization(f.location,ctx);assert.deepEqual(Uint8Array.from(b.content),png());assert.equal(b.finalized,true);
});
test('notary IDs include time plus random uniqueness and signature covers privacy, owner, hash and ID',async()=>{
 assert.notEqual(notaryNumber(1790409600000,hash(1).replace(/.$/,'2').replace(/^0x0/,'0x1')),notaryNumber(1790409600000,hash(2)));
 const f=await notaryFixture();for(const edit of [c=>c.hash=hash(500),c=>c.visibility='private',c=>c.owner.holder='0x'+'22'.repeat(20),c=>c.id+='x',c=>c.content.inline=encodeBase64(toUtf8Bytes('changed'))]){const r=structuredClone(f.record);edit(r.claim);assert.throws(()=>validateNotary(r,config.networks));}
});
test('rejects private originals, SVG, invalid MIME, oversize public images and duplicate chunks',async()=>{
 const f=await notaryFixture({visibility:'private'});assert.throws(()=>validateClaim({...f.claim,content:{inline:'YQ==',chunks:[]}}));assert.throws(()=>describeContent(toUtf8Bytes('<svg/>'),'image'));
 const huge=new Uint8Array(MAX_PUBLIC_BYTES+1);huge.set(png().slice(0,8));assert.throws(()=>contentParts(describeContent(huge,'image'),'public'));
 const chunked=await notaryFixture({kind:'image',value:png()});chunked.claim.content.chunks[1]=chunked.claim.content.chunks[0];assert.throws(()=>validateClaim(chunked.claim));
});
for(const attack of ['sender','failed','digest','owner','code','snapshot','reorg'])test('notary rejects chain evidence attack: '+attack,async()=>{const f=await notaryFixture(),{ctx}=notaryContext(f,{attack});await assert.rejects(loadNotarization(f.location,ctx,{allowPending:true}));});
test('pending notary may be shown but never labeled finalized',async()=>{const f=await notaryFixture(),{ctx}=notaryContext(f,{finalized:100});await assert.rejects(loadNotarization(f.location,ctx));const b=await loadNotarization(f.location,ctx,{allowPending:true});assert.equal(b.finalized,false);});
test('full public index enumerates every chunk and includes only completed notarizations',async()=>{const f=await notaryFixture({kind:'image',value:png()}),{ctx,counts}=notaryContext(f),r=await scanNotaryChain('196',{ctx});assert.equal(r.total,4);assert.equal(r.checked,4);assert.equal(r.rows.length,1);assert.equal(r.complete,true);assert.deepEqual(counts.pages,[[0,4]]);assert.equal(counts.logs,4);});
for(const attack of ['omit','page','digest','reorg'])test('full-index omission and mismatch cannot report complete: '+attack,async()=>{const f=await notaryFixture(),{ctx}=notaryContext(f,{attack});await assert.rejects(scanNotaryChain('196',{ctx}));});
test('one unavailable chain leaves global audit incomplete',async()=>{const r=await auditNotary({makeContext:()=>({head:async()=>{throw Error('RPC offline');},rpc:()=>({})})});assert.equal(r.complete,false);assert.equal(r.states.length,2);assert.ok(r.states.every(s=>s.error));});
test('public querying supports exact hash, owner, search, pagination and both time directions',()=>{
 const rows=Array.from({length:27},(_,i)=>({id:'TN-'+i,location:{chainId:'196',tx:hash(i+1)},owner:i%2?'1.2.204.tape':'2.2.204.tape',hash:i%2?hash(100):hash(200),timestamp:i,preview:'text '+i}));
 assert.equal(queryNotaries(rows,{page:2}).rows.length,12);assert.equal(queryNotaries(rows,{page:3}).rows.length,3);assert.equal(queryNotaries(rows,{sort:'asc'}).rows[0].timestamp,0);assert.equal(queryNotaries(rows).rows[0].timestamp,26);assert.equal(queryNotaries(rows,{hash:hash(100)}).total,13);assert.equal(queryNotaries(rows,{owner:'2.2.204.tape'}).total,14);assert.equal(queryNotaries(rows,{q:'text 26'}).total,1);assert.throws(()=>queryNotaries(rows,{page:0}));
});
