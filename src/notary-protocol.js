import {sha256,keccak256,toUtf8Bytes,toUtf8String,hexlify,getBytes,encodeBase64,decodeBase64,verifyTypedData} from 'ethers';
import {canonical,exact,validateIdentity,HASH,anchor,hashObject} from './protocol.js';
import {endpoint} from './vendor/protocol.js';
import {contractNumber} from './contract-id.js';
export const NOTARY_PROTOCOL='TAPESIGN-NOTARY-1',PREFIX='0x544e0100';
export const NOTARY_ENDPOINT=endpoint('196','0x'+keccak256(toUtf8Bytes(NOTARY_PROTOCOL+':public-index')).slice(-40));
export const CHUNK_BYTES=9000,MAX_PUBLIC_BYTES=1048576,MAX_PRIVATE_BYTES=20971520,MAX_NOTARY_PAYLOAD=16000;
export const notaryNumber=(time,nonce)=>contractNumber(time,nonce).replace(/^TS-/,'TN-');
const fail=m=>{throw Error(m);};
export function imageMime(bytes){
 const b=getBytes(bytes),has=a=>a.every((v,i)=>b[i]===v);
 if(has([137,80,78,71,13,10,26,10]))return 'image/png';
 if(has([255,216,255]))return 'image/jpeg';
 if(has([71,73,70,56])&&[55,57].includes(b[4])&&b[5]===97)return 'image/gif';
 if(has([82,73,70,70])&&b.length>=12&&String.fromCharCode(...b.slice(8,12))==='WEBP')return 'image/webp';
 fail('支持 PNG、JPEG、GIF、WebP 原图；不支持 SVG 或伪装文件');
}
export function describeContent(value,kind){
 const bytes=kind==='text'?toUtf8Bytes(value):getBytes(value);
 if(!['text','image'].includes(kind)||!bytes.length||bytes.length>MAX_PRIVATE_BYTES)fail('内容不能为空，文件最大 20 MiB');
 if(kind==='text'&&!value.trim())fail('请填写需要公证的文字');
 return {kind,mime:kind==='text'?'text/plain;charset=utf-8':imageMime(bytes),size:bytes.length,hash:sha256(bytes),bytes};
}
export function contentParts(content,visibility){
 if(!['public','private'].includes(visibility))fail('公开方式无效');
 if(visibility==='private')return [];
 if(content.size>MAX_PUBLIC_BYTES)fail('透明内容最多 1 MiB；原文件不压缩，可选择非透明公证');
 return Array.from({length:Math.ceil(content.size/CHUNK_BYTES)},(_,i)=>encodeBase64(content.bytes.slice(i*CHUNK_BYTES,(i+1)*CHUNK_BYTES)));
}
export function encodeNotary(record){const bytes=toUtf8Bytes(canonical(record));if(bytes.length+4>MAX_NOTARY_PAYLOAD)fail('公证消息超过链上单笔大小上限');return PREFIX+hexlify(bytes).slice(2);}
export function decodeNotary(data){
 if(typeof data!=='string'||!data.startsWith(PREFIX)||data.length>2+MAX_NOTARY_PAYLOAD*2)fail('不是 TapeSign 公证消息');
 const record=JSON.parse(toUtf8String(getBytes(data).slice(4)));
 if(record.protocol!==NOTARY_PROTOCOL||encodeNotary(record)!==data)fail('公证消息编码不规范');return record;
}
export function validateClaim(c){
 exact(c,'protocol,type,id,createdAt,nonce,owner,visibility,kind,mime,size,hash,content');
 validateIdentity(c.owner);
 if(c.protocol!==NOTARY_PROTOCOL||c.type!=='notarize'||c.id!==notaryNumber(c.createdAt,c.nonce)||!HASH.test(c.hash)||!['public','private'].includes(c.visibility)||!['text','image'].includes(c.kind)||!Number.isSafeInteger(c.size)||c.size<1||c.size>MAX_PRIVATE_BYTES)fail('公证声明无效');
 if(c.kind==='text'?c.mime!=='text/plain;charset=utf-8':!['image/png','image/jpeg','image/gif','image/webp'].includes(c.mime))fail('公证内容类型无效');
 if(c.visibility==='private'){if(c.content!==null)fail('非透明公证不得包含原文、原图或分块');}
 else {
  if(c.size>MAX_PUBLIC_BYTES)fail('透明公证超过大小上限');exact(c.content,'inline,chunks');
  if(!Array.isArray(c.content.chunks))fail('分块列表无效');
  if(c.content.inline!==null){if(typeof c.content.inline!=='string'||c.content.chunks.length)fail('原文与分块互斥');const b=decodeBase64(c.content.inline);if(encodeBase64(b)!==c.content.inline||b.length>CHUNK_BYTES)fail('内容编码无效');verifyContent(c,b);}
  else {if(c.content.chunks.length!==Math.ceil(c.size/CHUNK_BYTES))fail('分块数量不符');const seen=new Set();for(const l of c.content.chunks){anchor(l);if(l.chainId!==c.owner.chainId||seen.has(l.tx))fail('分块重复或跨链');seen.add(l.tx);}}
 }return c;
}
export function verifyContent(c,bytes){
 if(bytes.length!==c.size||sha256(bytes)!==c.hash)fail('原文或原图与公证哈希不一致');
 if(c.kind==='text'){if(!toUtf8String(bytes).trim())fail('公证文字为空');}else if(imageMime(bytes)!==c.mime)fail('图片格式不一致');return bytes;
}
export function notarySigning(c,hub){validateClaim(c);return {domain:{name:'TapeSign Notary',version:'1',chainId:Number(c.owner.chainId),verifyingContract:hub},types:{Notarization:[{name:'claimHash',type:'bytes32'},{name:'contentHash',type:'bytes32'},{name:'container',type:'bytes32'},{name:'declaration',type:'string'}]},message:{claimHash:hashObject(c),contentHash:c.hash,container:c.owner.endpoint,declaration:'I declare that this content belongs to my TapeOut container.'}};}
export function validateNotary(record,networks){
 exact(record,'protocol,type,claim,signature');if(record.protocol!==NOTARY_PROTOCOL||record.type!=='notarize'||!/^0x[0-9a-f]{130}$/.test(record.signature))fail('公证签名无效');
 const c=validateClaim(record.claim),n=networks.find(n=>String(n.chainId)===c.owner.chainId);if(!n)fail('不支持的公证链');
 const d=notarySigning(c,n.hub);if(verifyTypedData(d.domain,d.types,d.message,record.signature).toLowerCase()!==c.owner.holder)fail('公证签名与内容或容器不符');encodeNotary(record);return record;
}
export function validateChunk(r){
 exact(r,'protocol,type,id,owner,hash,index,total,data');validateIdentity(r.owner);
 if(r.protocol!==NOTARY_PROTOCOL||r.type!=='chunk'||!/^TN-\d{17}-[0-9a-f]{32}$/.test(r.id)||!HASH.test(r.hash)||!Number.isInteger(r.index)||!Number.isInteger(r.total)||r.total<2||r.total>Math.ceil(MAX_PUBLIC_BYTES/CHUNK_BYTES)||r.index<0||r.index>=r.total||typeof r.data!=='string')fail('公证分块无效');
 const bytes=decodeBase64(r.data);if(!bytes.length||bytes.length>CHUNK_BYTES||encodeBase64(bytes)!==r.data||(r.index<r.total-1&&bytes.length!==CHUNK_BYTES))fail('公证分块大小或编码无效');encodeNotary(r);return bytes;
}
export function notaryRow(bundle){const c=bundle.record.claim;return {id:c.id,location:bundle.location,owner:c.owner.name,holder:c.owner.holder,hash:c.hash,kind:c.kind,visibility:c.visibility,mime:c.mime,size:c.size,timestamp:Number(bundle.block.timestamp)*1000,createdAt:c.createdAt,finalized:bundle.finalized};}
