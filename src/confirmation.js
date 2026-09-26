// Operational confirmation only; this does not claim consensus finality.
export const FAST_DEPTH=Object.freeze({'196':12,'56':24});
export const POLL_MS=10000;
export function confirmationState(chain,transactionBlock,finalizedHead,latestHead,now=Math.floor(Date.now()/1000)){
  const height=BigInt(transactionBlock),finalized=height<=BigInt(finalizedHead.number),required=FAST_DEPTH[chain];
  if(!required)throw Error('不支持的确认网络');
  const latest=latestHead?BigInt(latestHead.number):null;
  const depth=latest===null||latest<height?0n:latest-height;
  const fresh=!!latestHead&&now-Number(latestHead.timestamp)<=60&&Number(latestHead.timestamp)-now<=15;
  const fast=finalized||(fresh&&depth>=BigInt(required));
  return {chainId:chain,transactionBlock:String(height),finalizedBlock:finalizedHead.number,latestBlock:latestHead?.number??null,depth:String(depth),requiredDepth:String(required),remainingBlocks:String(depth>=BigInt(required)?0n:BigInt(required)-depth),finalizedRemainingBlocks:finalized?'0':String(height-BigInt(finalizedHead.number)),fresh,finalized,fast};
}
