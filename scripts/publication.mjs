import fs from 'node:fs';
import path from 'node:path';
import {hexlify,toQuantity,keccak256,toUtf8Bytes} from 'ethers';
import config from '../config/networks.json' with {type:'json'};
import {ABI,RpcPair,header} from '../src/vendor/mainnet.js';
import {sha256} from './release.mjs';
export function plan(root){
  const dist=path.join(root,'dist'),manifest=JSON.parse(fs.readFileSync(path.join(dist,'release.json'),'utf8'));
  const files=[...manifest.files,{path:'release.json',contentType:'application/json; charset=utf-8',size:fs.statSync(path.join(dist,'release.json')).size,sha256:sha256(fs.readFileSync(path.join(dist,'release.json')))}];
  const priority=p=>p==='index.html'?2:p==='release.json'?1:0;
  files.sort((a,b)=>priority(a.path)-priority(b.path)||a.path.localeCompare(b.path));
  for(const f of files){if(!/^(?:assets\/[a-zA-Z0-9_.-]+|client-[a-f0-9]{64}\.html|index\.html|release\.json)$/.test(f.path))throw Error('Unsafe release path');const bytes=fs.readFileSync(path.join(dist,f.path));if(bytes.length!==f.size||sha256(bytes)!==f.sha256)throw Error('Build files changed; rebuild before publication');}
  return {...manifest,files};
}
export async function preflight(transport,{requireLive=true}={}){
  const n=config.networks.find(n=>n.chainId===196),r=new RpcPair(n,transport),h=await r.pin('latest'),at=toQuantity(h.number);
  await r.attest(at,{publication:true});
  const identity=await r.resolve(config.site,at);
  const [[containerLive],[nameLive],[containerUntil],[nameUntil]]=await Promise.all([
    r.call(n.binding,'isContainerLive',[identity.container],at),r.call(n.binding,'isLive',[config.site,identity.container],at),
    r.call(n.binding,'containerPaidUntil',[identity.container],at),r.call(n.binding,'paidUntil',[keccak256(toUtf8Bytes(config.site)),identity.container],at),
  ]);
  const siteLive=containerLive||nameLive;
  if((await r.agree('eth_getBlockByNumber',[at,false],header)).hash!==h.hash)throw Error('Publication preflight snapshot changed');
  if(requireLive&&!siteLive)throw Error('4.2.204 容器网站订阅未生效，请先在 TapeOut 开通或续期网站');
  return {identity,siteLive,containerLive,nameLive,paidUntil:String(containerUntil>nameUntil?containerUntil:nameUntil),block:h};
}
export function classifyFile(file,info,bytes,expected){
  if(bytes.length!==Number(info.size)||bytes.length>file.size) return {conflict:true,reason:'链上文件大小不符'};
  if(Number(info.size)===0&&Number(info.chunkCount)===0)return {next:0,complete:false};
  if(file.contentType && info.contentType!==file.contentType)return {conflict:true,reason:'链上文件 MIME 类型不符'};
  if(info.sha256Hash.toLowerCase()!==file.sha256 || !bytes.equals(expected.subarray(0,bytes.length)))return {conflict:true,reason:'链上文件与此构建内容不同'};
  if(bytes.length===file.size)return Number(info.chunkCount)===Math.ceil(file.size/24000)?{next:Number(info.chunkCount),complete:true}:{conflict:true,reason:'链上完整文件分块数量不符'};
  if(bytes.length%24000!==0 || Number(info.chunkCount)!==bytes.length/24000) return {conflict:true,reason:'链上分块边界异常'};
  return {next:Number(info.chunkCount),complete:false};
}
export async function fileStatus(root,transport,name,{finalized=false,after=null}={}){
  const release=plan(root),file=release.files.find(f=>f.path===name);if(!file)throw Error('Unknown release file');
  const n=config.networks.find(n=>n.chainId===196),r=new RpcPair(n,transport),h=await r.pin(finalized?'finalized':'latest');
  if(after&&BigInt(h.number)<BigInt(after))return {waiting:true};
  const at=toQuantity(h.number);await r.attest(at,{publication:true});
  const identity=await r.resolve(config.site,at),info=await r.call(n.siteRegistry,'fileInfo',[identity.container,name],at);
  if(info.size>1000000n)throw Error('Existing file exceeds publication review limit');
  const chunks=[];for(let offset=0;offset<Number(info.size);offset+=48000){const [bytes]=await r.call(n.siteRegistry,'readRange',[identity.container,name,offset,Math.min(48000,Number(info.size)-offset)],at);chunks.push(Buffer.from(bytes.slice(2),'hex'));}
  const expected=fs.readFileSync(path.join(root,'dist',name));
  if((await r.agree('eth_getBlockByNumber',[at,false],header)).hash!==h.hash)throw Error('Publication snapshot changed');
  return {...classifyFile(file,info,Buffer.concat(chunks),expected),block:h,release:release.release};
}
export async function transactionPlan(root,transport){
  const release=plan(root),pre=await preflight(transport),n=config.networks.find(n=>n.chainId===196),transactions=[];
  for(const file of release.files){const bytes=fs.readFileSync(path.join(root,'dist',file.path));for(let offset=0,index=0;offset<bytes.length;offset+=24000,index++)transactions.push({file:file.path,index,to:n.siteRegistry,value:'0x0',data:index===0?ABI.encodeFunctionData('putFile',[pre.identity.container,file.path,file.contentType,file.sha256,hexlify(bytes.subarray(offset,offset+24000))]):ABI.encodeFunctionData('appendChunk',[pre.identity.container,file.path,index,hexlify(bytes.subarray(offset,offset+24000))])});}
  return {...release,...pre,transactions};
}
