import {Interface,toQuantity,encodeBase64} from 'ethers';
import {identity,wallets,hash} from './fixture.mjs';
import {describeContent,contentParts,notaryNumber,notarySigning,encodeNotary,NOTARY_PROTOCOL,NOTARY_ENDPOINT} from '../src/notary-protocol.js';
import {ABI,config} from '../src/rpc.js';
import {digest} from '../src/vendor/protocol.js';
export const paging=new Interface(['function inboxPage(bytes32,uint256,uint256) view returns(tuple(address from,uint56 blockNumber,uint40 timestamp,bytes32 digest)[])']);
export async function notaryFixture({value='我的原创文字\n保留换行与空格 ',kind='text',visibility='public',chain='196',seed=77}={}){
 const owner=identity('A',chain),info=describeContent(value,kind),parts=contentParts(info,visibility),nonce=hash(seed),createdAt=1790409600000;
 const claim={protocol:NOTARY_PROTOCOL,type:'notarize',id:notaryNumber(createdAt,nonce),createdAt,nonce,owner,visibility,kind,mime:info.mime,size:info.size,hash:info.hash,content:visibility==='private'?null:parts.length===1?{inline:parts[0],chunks:[]}:{inline:null,chunks:parts.map((_,i)=>({chainId:chain,tx:hash(i+1)}))}};
 const chunks=parts.length>1?parts.map((data,index)=>({protocol:NOTARY_PROTOCOL,type:'chunk',id:claim.id,owner,hash:claim.hash,index,total:parts.length,data})):[];
 const network=config.networks.find(n=>String(n.chainId)===chain),sign=notarySigning(claim,network.hub),signature=(await wallets.A.signTypedData(sign.domain,sign.types,sign.message)).toLowerCase();
 const record={protocol:NOTARY_PROTOCOL,type:'notarize',claim,signature},records=[...chunks,record];
 const location={chainId:chain,tx:hash(records.length)},bundle={record,location,block:{number:String(100+records.length),timestamp:String(10000+records.length),hash:hash(1000+records.length)},finalized:true,content:visibility==='public'?Array.from(info.bytes):null,inboxIndex:String(records.length-1),verifiedAt:1};
 return {record,claim,owner,info,chunks,records,location,bundle};
}
export function notaryContext(f,{attack='',finalized=1000}={}){
 const n=config.networks.find(n=>String(n.chainId)===f.owner.chainId),counts={receipts:0,pages:[],logs:0},head={number:'1000',hash:hash(1000),timestamp:String(Math.floor(Date.now()/1000))};
 const messages=f.records.map((record,index)=>{const i=index+1,payload=encodeNotary(record),number=100+i,blockHash=hash(1000+i),ref=f.claim.hash,loc={chainId:f.owner.chainId,tx:hash(i)},event=ABI.encodeEventLog(ABI.getEvent('Sent'),[NOTARY_ENDPOINT,f.owner.container,ref,index,index,payload]);
  const log={...event,address:n.hub,blockHash,transactionHash:loc.tx,removed:false};
  return {record,index,payload,number,blockHash,location:loc,log,entry:{from:f.owner.container,blockNumber:BigInt(number),timestamp:BigInt(10000+i),digest:digest(ref,payload)},receipt:{transactionHash:loc.tx,status:'0x1',blockNumber:toQuantity(number),blockHash,from:f.owner.holder,to:n.hub,logs:[log]},tx:{hash:loc.tx,from:f.owner.holder,to:n.hub,input:ABI.encodeFunctionData('send',[f.owner.processor,f.owner.tokenId,NOTARY_ENDPOINT,ref,payload]),blockHash,value:'0x0'}};
 });
 if(attack==='sender')messages.at(-1).receipt.from=messages.at(-1).tx.from=identity('B').holder;
 if(attack==='failed')messages.at(-1).receipt.status='0x0';
 if(attack==='digest')messages[0].entry.digest=hash(999);
 const rpc={net:n,attest:async()=>{if(attack==='code')throw Error('code changed');},resolve:async()=>attack==='owner'?{...f.owner,holder:identity('B').holder}:f.owner,
  async call(to,fn,args,at){if(fn==='inboxCount')return [BigInt(messages.length)];const m=messages.find(m=>m.number===Number(BigInt(at)));if(fn==='inboxAt')return [m.entry];if(fn==='outboxPage')return [[{...m.entry,to:NOTARY_ENDPOINT,inboxIndex:BigInt(m.index)}]];throw Error('Unexpected '+fn);},
  async agree(method,params,normalize=x=>x){let value;
   if(method==='eth_getTransactionReceipt'){counts.receipts++;value=messages.find(m=>m.location.tx===params[0])?.receipt||null;}
   else if(method==='eth_getTransactionByHash')value=messages.find(m=>m.location.tx===params[0])?.tx;
   else if(method==='eth_call'){const [,start,count]=paging.decodeFunctionData('inboxPage',params[0].data);counts.pages.push([Number(start),Number(count)]);let entries=messages.slice(Number(start),Number(start+count)).map(m=>m.entry);if(attack==='page')entries=[];value=paging.encodeFunctionResult('inboxPage',[entries]);}
   else if(method==='eth_getLogs'){counts.logs++;const number=Number(BigInt(params[0].fromBlock));value=attack==='omit'?[]:messages.filter(m=>m.number===number).map(m=>m.log);}
   else if(method==='eth_getBlockByNumber'){const num=Number(BigInt(params[0])),m=messages.find(m=>m.number===num);value={number:toQuantity(num),timestamp:toQuantity(m?10000+m.index+1:head.timestamp),hash:attack==='reorg'?hash(555):m?m.blockHash:head.hash};}
   else throw Error('Unexpected '+method);return normalize(value);
  }};
 const ctx={records:new Map(),onProgress:()=>{},rpc:()=>rpc,head:async(chain,tag)=>({...head,number:tag==='latest'?'1000':String(finalized)}),assert:async()=>{if(attack==='snapshot')throw Error('Snapshot changed');}};
 return {ctx,messages,counts};
}
