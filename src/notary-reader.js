import {toQuantity,decodeBase64,concat,getBytes} from 'ethers';
import {context,config,header} from './rpc.js';
import {readMessage} from './reader.js';
import {same,anchor} from './protocol.js';
import {decodeNotary,validateNotary,validateChunk,verifyContent,NOTARY_ENDPOINT} from './notary-protocol.js';
export async function authenticateNotary(message,identity,ctx){
 if(message.location.chainId!==identity.chainId||message.from!==identity.container||message.sender!==identity.holder||message.processor!==identity.processor||message.tokenId!==identity.tokenId||message.to!==NOTARY_ENDPOINT)throw Error('公证交易身份或公开索引不符');
 const actual=await ctx.rpc(identity.chainId).resolve(identity.name,toQuantity(message.block.number));
 if(!same(actual,identity))throw Error('公证时的容器持有人与声明不符');
}
export async function loadNotarization(location,ctx=context(),{allowPending=false}={}){
 anchor(location);const options={decoder:decodeNotary,allowPending,confirmation:'finalized'};
 const main=await readMessage(location,ctx,options),record=validateNotary(main.record,config.networks),c=record.claim;
 if(main.ref!==c.hash)throw Error('公证索引哈希不符');await authenticateNotary(main,c.owner,ctx);
 const messages=[main];let bytes=null;
 if(c.visibility==='public'){
  if(c.content.inline!==null)bytes=decodeBase64(c.content.inline);
  else {const parts=[];for(let i=0;i<c.content.chunks.length;i++){
    const m=await readMessage(c.content.chunks[i],ctx,options),r=m.record;validateChunk(r);
    if(r.id!==c.id||r.hash!==c.hash||r.index!==i||r.total!==c.content.chunks.length||!same(r.owner,c.owner)||m.ref!==c.hash||BigInt(m.block.number)>BigInt(main.block.number))throw Error('原图分块与公证声明不符');
    await authenticateNotary(m,c.owner,ctx);parts.push(decodeBase64(r.data));messages.push(m);
   }bytes=getBytes(concat(parts));}
  verifyContent(c,bytes);
 }
 await ctx.assert();
 for(const m of messages)if((await ctx.rpc(m.location.chainId).agree('eth_getBlockByNumber',[toQuantity(m.block.number),false],header)).hash!==m.block.hash)throw Error('公证核验期间区块变化');
 return {location,record,block:main.block,finalized:messages.every(m=>m.finalized),inboxIndex:main.inboxIndex,content:bytes===null?null:Array.from(bytes),verifiedAt:Date.now()};
}
