import {Interface,formatEther,keccak256,toUtf8Bytes,toQuantity} from 'ethers';
import {config,context} from './rpc.js';
import {header} from './vendor/mainnet.js';
export const bindingABI=new Interface(['function bind(string,address,uint256) payable','function syncContainer(string,address)']);
export function activationDomain(value=''){
  const domain=String(value).trim().toLowerCase();
  if(domain&&(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)||domain.length>253))throw Error('请输入原来付费的完整域名，不带 https:// 或路径');
  return domain;
}
export function activationTransaction(q,kind){
  if(q.siteLive)throw Error('网站订阅已生效，无需再次付费');
  if(kind==='sync'){
    if(!q.domain||!q.domainLive||BigInt(q.domainUntil)<=BigInt(q.block.timestamp))throw Error('该域名在此容器下没有可同步的有效付费记录');
    return {to:q.binding,data:bindingABI.encodeFunctionData('syncContainer',[q.domain,q.identity.container]),value:'0x0'};
  }
  if(kind!=='bind'||!Number.isInteger(q.months)||q.months<1||q.months>120)throw Error('开通时长须为 1 至 120 个 30 天周期');
  const fee=BigInt(q.monthlyFeeWei);if(fee<0n)throw Error('费用无效');
  return {to:q.binding,data:bindingABI.encodeFunctionData('bind',[q.identity.name,q.identity.container,q.months]),value:toQuantity(fee*BigInt(q.months))};
}
export function assertActivationUnchanged(before,after,kind){
  if(JSON.stringify(before.identity)!==JSON.stringify(after.identity)||before.binding!==after.binding)throw Error('容器身份或付费合约已变化，请重新核对');
  if(JSON.stringify(activationTransaction(before,kind))!==JSON.stringify(activationTransaction(after,kind)))throw Error('费用或交易内容变化，请重新核对');
}
export async function readActivation({months=1,domain=''}={}){
  if(!Number.isInteger(months)||months<1||months>120)throw Error('开通时长须为 1 至 120 个 30 天周期');
  domain=activationDomain(domain);const n=config.networks.find(n=>n.chainId===196),r=context().rpc('196'),block=await r.pin('latest'),at=toQuantity(block.number);
  const age=Date.now()/1000-Number(block.timestamp);if(age>90||age< -15)throw Error('RPC 区块头不够新，请稍后重试');
  await r.attest(at,{publication:true});const identity=await r.resolve(config.site,at);
  const [[containerLive],[nameLive],[containerUntil],[nameUntil],[monthlyFee]]=await Promise.all([
    r.call(n.binding,'isContainerLive',[identity.container],at),r.call(n.binding,'isLive',[identity.name,identity.container],at),
    r.call(n.binding,'containerPaidUntil',[identity.container],at),r.call(n.binding,'paidUntil',[keccak256(toUtf8Bytes(identity.name)),identity.container],at),r.call(n.binding,'monthlyFee',[],at),
  ]);
  let domainLive=false,domainUntil=0n;
  if(domain){const [[live],[until]]=await Promise.all([r.call(n.binding,'isLive',[domain,identity.container],at),r.call(n.binding,'paidUntil',[keccak256(toUtf8Bytes(domain)),identity.container],at)]);domainLive=live;domainUntil=until;}
  if((await r.agree('eth_getBlockByNumber',[at,false],header)).hash!==block.hash)throw Error('查询区块已变化，请重试');
  return {identity,binding:n.binding,block,siteLive:containerLive||nameLive,containerLive,nameLive,paidUntil:String(containerUntil>nameUntil?containerUntil:nameUntil),months,monthlyFeeWei:String(monthlyFee),monthlyFee:formatEther(monthlyFee),total:formatEther(monthlyFee*BigInt(months)),domain,domainLive,domainUntil:String(domainUntil)};
}
