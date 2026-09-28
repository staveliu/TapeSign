import config from '../config/networks.json' with {type:'json'};
import { RpcPair, ABI, header } from './vendor/mainnet.js';
import { withRpcFallback } from './vendor/rpc-fallback.js';
import { nameInfo, HASH, same } from './protocol.js';
import { toQuantity } from 'ethers';
import { readRpcResponse, rpcTimeoutMs, rpcUnavailable } from './rpc-http.js';
export { config, ABI, header };
// Only our development service exposes /rpc. Portable builds on other local
// static servers must keep working by contacting the configured RPCs directly.
export const local = typeof location !== 'undefined' && ['127.0.0.1','localhost'].includes(location.hostname) && (location.port === '18740' || import.meta.env?.DEV === true);
const send = async (url, body) => {
  const network = config.networks.find(n=>n.rpcs.includes(url));
  const target = local && network ? `/rpc/${network.chainId}/${network.rpcs.indexOf(url)}` : url;
  try {
    const r = await fetch(target, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(rpcTimeoutMs(network,url,local))});
    return await readRpcResponse(r,body.method);
  } catch(e) { throw rpcUnavailable(e.message,{method:body.method}); }
};
const transport = local ? send : withRpcFallback(config.networks, send);
export function context(customTransport = transport, onProgress = ()=>{}, {signal} = {}) {
  const clients = new Map(), heads = new Map(), records = new Map();
  function rpc(chain) {
    const n = config.networks.find(n=>String(n.chainId) === String(chain));
    if (!n) throw Error('不支持的区块链');
    if (!clients.has(String(chain))) clients.set(String(chain), new RpcPair(n, async(url,body)=>{signal?.throwIfAborted();const result=await customTransport(url,body);signal?.throwIfAborted();return result;}));
    return clients.get(String(chain));
  }
  function head(chain, tag = 'finalized') {
    chain = String(chain);
    if(!['finalized','latest'].includes(tag))throw Error('Unsupported snapshot tag');
    const key=chain+'/'+tag;
    if (!heads.has(key)) heads.set(key, {chain,task:rpc(chain).pin(tag).catch(error=>{heads.delete(key);throw error;})});
    return heads.get(key).task;
  }
  return {rpc,head,records,onProgress,async assert(){
    for (const {chain,task} of heads.values()) {
      const h = await task;
      if ((await rpc(chain).agree('eth_getBlockByNumber',[toQuantity(h.number),false],header)).hash !== h.hash) throw Error('检测到区块重组，请重新核验');
    }
  }};
}
export async function resolveIdentity(name, ctx = context()) {
  const info = nameInfo(name), rpc = ctx.rpc(info.chainId), h = await ctx.head(info.chainId,'latest'), block = toQuantity(h.number);
  await rpc.attest(block);
  const identity = await rpc.resolve(info.name, block);
  if ((await rpc.agree('eth_getBlockByNumber',[block,false],header)).hash !== h.hash) throw Error('容器查询期间区块变化，请重试');
  return identity;
}
export function provider() {
  const p = globalThis.ethereum || globalThis.okxwallet;
  if (!p?.request) throw Error('请使用安装了 MetaMask 或 OKX 钱包的浏览器');
  return p;
}
export async function connect() {
  const accounts = await provider().request({method:'eth_requestAccounts'});
  if (!accounts?.[0]) throw Error('未选择钱包');
  return accounts[0].toLowerCase();
}
export async function authorize(identity, progress = ()=>{}) {
  const p = provider(), chain = toQuantity(identity.chainId), n = config.networks.find(n=>String(n.chainId) === identity.chainId);
  progress('请在钱包中连接并确认网络…'); await connect();
  try { await p.request({method:'wallet_switchEthereumChain',params:[{chainId:chain}]}); }
  catch(e) {
    if (e.code !== 4902) throw e;
    const x = identity.chainId === '196';
    await p.request({method:'wallet_addEthereumChain',params:[{chainId:chain,chainName:x?'X Layer':'BNB Smart Chain',nativeCurrency:{name:x?'OKB':'BNB',symbol:x?'OKB':'BNB',decimals:18},rpcUrls:[n.rpcs[0]]}]});
    await p.request({method:'wallet_switchEthereumChain',params:[{chainId:chain}]});
  }
  progress('正在核验容器持有人…');
  const current = await resolveIdentity(identity.name);
  const accounts = await p.request({method:'eth_accounts'});
  if (!same(current,identity) || accounts[0]?.toLowerCase() !== identity.holder) throw Error('当前钱包或容器持有人已变化，与合同约定不符');
  if (BigInt(await p.request({method:'eth_chainId'})) !== BigInt(identity.chainId)) throw Error('钱包网络不匹配');
  return p;
}
export async function sendTransaction(identity, transaction, progress, beforeSubmit) {
  const p = await authorize(identity, progress);
  const gas = await p.request({method:'eth_estimateGas',params:[{...transaction,from:identity.holder}]});
  if(beforeSubmit){progress?.('正在复核合同引用交易与短确认进度…');await beforeSubmit();}
  progress?.('请在钱包确认交易和网络费用…');
  const tx = await p.request({method:'eth_sendTransaction',params:[{...transaction,from:identity.holder,chainId:toQuantity(identity.chainId),gas:toQuantity(BigInt(gas)*120n/100n)}]});
  if (!HASH.test(tx?.toLowerCase())) throw Error('钱包没有返回有效交易哈希');
  return {chainId:identity.chainId,tx:tx.toLowerCase()};
}
