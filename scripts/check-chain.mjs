import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {serverTransport} from './transport.mjs';
import {preflight} from './publication.mjs';
import {context} from '../src/rpc.js';
import {toQuantity} from 'ethers';
const net=await serverTransport(),start=performance.now();
try{
  const result=await preflight(net.transport,{requireLive:false}),ctx=context(net.transport),r=ctx.rpc('196'),at=toQuantity(result.block.number);
  const [hub]=await r.call(r.net.hub,'isSealed',[],at),[factory]=await r.call(r.net.factory,'isSealed',[],at);
  const report={...result,hubSealed:hub,factorySealed:factory,seconds:Number(((performance.now()-start)/1000).toFixed(2)),checkedAt:new Date().toISOString()};
  fs.mkdirSync('.local',{recursive:true});fs.writeFileSync('.local/chain-preflight.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await net.close();}
