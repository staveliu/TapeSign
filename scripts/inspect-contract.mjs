import fs from 'node:fs';
import {toQuantity} from 'ethers';
import {serverTransport} from './transport.mjs';
import {context,config} from '../src/rpc.js';
import {header,ABI} from '../src/vendor/mainnet.js';
import {decode,HASH} from '../src/protocol.js';
import {loadContract} from '../src/reader.js';
const args=process.argv.slice(2).filter(a=>!a.startsWith('--')),tx=args[0],chain=args[1]||'196';
if(!HASH.test(tx)||!['196','56'].includes(chain))throw Error('Usage: node scripts/inspect-contract.mjs <hash> [196|56] [--proxy]');
const net=await serverTransport(),ctx=context(net.transport),rpc=ctx.rpc(chain);
const result={chain,tx,checkedAt:new Date().toISOString(),providers:[]};
try{
  const reports=await Promise.all(rpc.net.rpcs.map(async(url)=>{
    const reads=await Promise.allSettled(['latest','safe','finalized'].map(tag=>rpc.one(url,'eth_getBlockByNumber',[tag,false]).then(header)));
    const r=await rpc.one(url,'eth_getTransactionReceipt',[tx]);
    return {provider:new URL(url).hostname,heads:Object.fromEntries(reads.map((r,i)=>[['latest','safe','finalized'][i],r.status==='fulfilled'?r.value:{error:r.reason.message}])),receipt:r?{hash:r.transactionHash,status:r.status,number:String(BigInt(r.blockNumber)),blockHash:r.blockHash,from:r.from,to:r.to,events:r.logs.filter(l=>l.address.toLowerCase()===rpc.net.hub).map(l=>{try{const e=ABI.parseLog(l),r=decode(e.args.payload.toLowerCase());return {event:e.name,type:r.type,protocol:r.protocol,client:r.doc?.client,from:e.args.from,to:e.args.to};}catch{return {event:'unrecognized'};}})}:null};
  }));result.providers=reports;console.log(JSON.stringify({stage:'RPC',...result},null,2));
  const started=Date.now();
  try{const bundle=await loadContract({chainId:chain,tx},ctx,{allowPending:process.argv.includes('--preview'),confirmation:process.argv.includes('--fast')?'fast':'finalized'});result.verification={status:bundle.status,finalized:bundle.finalized,ready:bundle.ready,title:bundle.doc.title,release:bundle.doc.client.release,confirmation:bundle.confirmation,elapsedSeconds:(Date.now()-started)/1000};}
  catch(e){result.verification={error:e.message,code:e.code,elapsedSeconds:(Date.now()-started)/1000};}
  fs.mkdirSync('.local',{recursive:true});fs.writeFileSync(`.local/contract-${tx.slice(2,14)}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({stage:'verification',...result.verification},null,2));
}finally{await net.close();}
