import { Interface, AbiCoder, ZeroHash, concat, keccak256, toQuantity } from 'ethers';
import { digest, endpoint, parseEndpoint } from './protocol.js';
import { RPC_UNAVAILABLE, safeRpcMessage } from '../rpc-http.js';

export const SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
export const ABI = new Interface([
  'function send(address,uint256,bytes32,bytes32,bytes) returns(uint256)',
  'function inboxCount(bytes32) view returns(uint256)',
  'function outboxCount(address) view returns(uint256)',
  'function inboxAt(bytes32,uint256) view returns(tuple(address from,uint56 blockNumber,uint40 timestamp,bytes32 digest))',
  'function outboxPage(address,uint256,uint256) view returns(tuple(bytes32 to,uint32 inboxIndex,uint56 blockNumber,uint40 timestamp,bytes32 digest)[])',
  'event Sent(bytes32 indexed to,address indexed from,bytes32 indexed ref,uint256 inboxIndex,uint256 outboxIndex,bytes payload)',
  'function cpuAt(uint256) view returns(address)', 'function isCPU(address) view returns(bool)',
  'function ownerOf(uint256) view returns(address)', 'function owner() view returns(address)',
  'function accountOf(address,uint256) view returns(address)', 'function isOpened(address,uint256) view returns(bool)',
  'function implementation() view returns(address)', 'function isSealed() view returns(bool)',
  'function factory() view returns(address)', 'function registry() view returns(address)',
  'function accountImplementation() view returns(address)', 'function payments() view returns(address)',
  'function circuitBeacon() view returns(address)', 'function circuitImplementation() view returns(address)',
  'function circuitCodehash() view returns(bytes32)', 'function token() view returns(uint256,address,uint256)',
  'function putFile(address,string,string,bytes32,bytes)', 'function appendChunk(address,string,uint256,bytes)',
  'function fileInfo(address,string) view returns(uint32 size,string contentType,bytes32 sha256Hash,uint40 updatedAt,uint256 chunkCount)',
  'function pathCount(address) view returns(uint256)', 'function chunkCount(address,string) view returns(uint256)',
  'function read(address,string) view returns(bytes)', 'function readRange(address,string,uint256,uint256) view returns(bytes)',
  'function isContainerLive(address) view returns(bool)', 'function monthlyFee() view returns(uint256)',
  'function isLive(string,address) view returns(bool)', 'function paidUntil(bytes32,address) view returns(uint256)',
  'function containerPaidUntil(address) view returns(uint256)',
  'function bind(string,address,uint256) payable',
]);
const lower = x => typeof x === 'string' ? x.toLowerCase() : x;
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function pacedTransport(send,interval=220){
  const queues=new Map();
  return async(url,body)=>{
    const before=queues.get(url)??Promise.resolve();
    const slot=before.catch(()=>{}).then(()=>new Promise(resolve=>setTimeout(resolve,interval)));
    queues.set(url,slot);await before.catch(()=>{});return send(url,body);
  };
}
export const header = b => {
  if (!b?.hash || !b?.number || !b?.timestamp) throw Error('Missing block header');
  return { hash: lower(b.hash), number: BigInt(b.number).toString(), timestamp: BigInt(b.timestamp).toString() };
};

export class RpcPair {
  constructor(network, transport) { this.net = network; this.transport = transport; this.id = 0; this.reads = new Map(); this.attestations = new Map(); }
  cached(key,read){
    if(this.reads.has(key))return this.reads.get(key);
    const promise=read().catch(error=>{this.reads.delete(key);throw error;});
    this.reads.set(key,promise);return promise;
  }
  async one(url, method, params) {
    let last;
    for (let attempt=0; attempt<3; attempt++) {
      try {
        const body = { jsonrpc: '2.0', id: ++this.id, method, params };
        const j = this.transport ? await this.transport(url, body) : await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
        }).then(async r => { if (!r.ok) throw Error(`HTTP ${r.status}`); return r.json(); });
        if (j.error || j.result === undefined) throw Error(j.error?.message || 'Missing RPC result');
        // Some providers briefly return null even after reporting this height.
        // Validate inside the retry boundary; never accept an absent header.
        if(method==='eth_getBlockByNumber'){
          try{header(j.result);}catch{throw Error('区块暂不可读：'+params[0]);}
        }
        return j.result;
      } catch (e) { last=e; if(attempt<2) await new Promise(resolve=>setTimeout(resolve,500*2**attempt)); }
    }
    if(last.code===RPC_UNAVAILABLE)throw last;
    throw Error(`${new URL(url).hostname} · ${method}: ${safeRpcMessage(last.message)}`);
  }
  async agree(method, params, normalize = lower) {
    const results = await Promise.allSettled(this.net.rpcs.map(url => this.one(url, method, params).then(normalize)));
    const failure = results.find(r => r.status === 'rejected');
    if (failure) throw failure.reason;
    const values = results.map(r => r.value);
    if (values.length < 2 || values.some(v => !same(v, values[0]))) throw Error(`Independent RPC disagreement: ${method}`);
    return values[0];
  }
  async pin(tag = 'finalized') {
    if (BigInt(await this.agree('eth_chainId', [])) !== BigInt(this.net.chainId)) throw Error('Wrong RPC chain');
    const heads = await Promise.all(this.net.rpcs.map(url => this.one(url, 'eth_getBlockByNumber', [tag, false]).then(header)));
    const height = heads.map(h => BigInt(h.number)).reduce((a,b) => a < b ? a : b);
    return this.agree('eth_getBlockByNumber', [toQuantity(height), false], header);
  }
  async call(to, fn, args = [], block) {
    if (!/^0x[0-9a-f]+$/i.test(block)) throw Error('Unpinned read forbidden');
    const data=ABI.encodeFunctionData(fn,args);
    const value = await this.cached(JSON.stringify(['call',to.toLowerCase(),data,block]),()=>this.agree('eth_call', [{ to, data }, block]));
    return ABI.decodeFunctionResult(fn, value);
  }
  async code(address, block) { if(!/^0x[0-9a-f]+$/i.test(block))throw Error('Unpinned read forbidden');return this.cached(JSON.stringify(['code',address.toLowerCase(),block]),()=>this.agree('eth_getCode', [address,block])); }
  async impl(address, block) {
    if(!/^0x[0-9a-f]+$/i.test(block))throw Error('Unpinned read forbidden');
    const slot = await this.cached(JSON.stringify(['impl',address.toLowerCase(),block]),()=>this.agree('eth_getStorageAt', [address, SLOT, block]));
    if (!/^0x0{24}[0-9a-f]{40}$/.test(slot)) throw Error('Invalid implementation slot');
    return '0x' + slot.slice(-40);
  }
  async attest(block, { publication = false } = {}) {
    const key=block+'/'+publication;
    if(this.attestations.has(key))return this.attestations.get(key);
    const result=this.attestOnce(block,{publication}).catch(e=>{this.attestations.delete(key);throw e;});
    this.attestations.set(key,result);return result;
  }
  async attestOnce(block, { publication = false } = {}) {
    const n = this.net;
    const proxies = publication ? n.proxies : n.proxies.filter(p => p.role === 'hub' || p.role === 'factory');
    for (const p of proxies) {
      if (await this.impl(p.address, block) !== p.implementation) throw Error(`${p.role} implementation changed`);
      await allChecked([[p.address,p.proxyHash],[p.implementation,p.codeHash]].map(async ([address, expected]) => {
        if (!expected || keccak256(await this.code(address,block)) !== expected) throw Error(`${p.role} code changed`);
      }));
    }
    const [impl] = await this.call(n.beacon,'implementation',[],block);
    if (lower(impl) !== n.circuitImplementation) throw Error('Circuit implementation changed');
    const pins=Object.entries(n.codePins);
    for (let i=0;i<pins.length;i+=2) {
      await allChecked(pins.slice(i,i+2).map(async ([address, hash])=>{
        if (keccak256(await this.code(address,block)) !== hash) throw Error('TapeOut identity code changed');
      }));
    }
  }
  async resolve(name, block) {
    const match = /^(0|[1-9]\d*)\.(?:(2)\.)?(0|[1-9]\d*)(?:\.tape)?$/.exec(name.trim());
    if (!match || (match[2] ? '196' : '56') !== String(this.net.chainId)) throw Error('Use a complete TapeOut name on the selected chain');
    const tokenId = match[1], processorIndex = match[3];
    const n = this.net;
    const [cpu] = await this.call(n.factory,'cpuAt',[processorIndex],block);
    const processor = lower(cpu);
    const [genuine] = await this.call(n.factory,'isCPU',[processor],block);
    if (!genuine || keccak256(await this.code(processor,block)) !== n.circuitCodeHash) throw Error('Invalid TapeOut processor');
    const [holder] = await this.call(processor,'ownerOf',[tokenId],block);
    const [container] = await this.call(n.opener,'accountOf',[processor,tokenId],block);
    const [opened] = await this.call(n.opener,'isOpened',[processor,tokenId],block);
    const [hubContainer] = await this.call(n.hub,'accountOf',[processor,tokenId],block);
    if (!opened || lower(hubContainer) !== lower(container)) throw Error('Container is not opened or Hub disagrees');
    const code = await this.code(container,block);
    const runtime = concat(['0x363d3d373d3d3d363d73',n.accountImplementation,'0x5af43d82803e903d91602b57fd5bf3',AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','address','uint256'],[ZeroHash,n.chainId,processor,tokenId])]);
    if (keccak256(code) !== keccak256(runtime)) throw Error('Container runtime mismatch');
    const token = await this.call(container,'token',[],block);
    if (token[0] !== BigInt(n.chainId) || lower(token[1]) !== processor || token[2] !== BigInt(tokenId)) throw Error('NFT binding mismatch');
    return { name: name.endsWith('.tape') ? name : name+'.tape', chainId: String(n.chainId), processor, tokenId,
      container: lower(container), holder: lower(holder), endpoint: endpoint(n.chainId,container) };
  }
}

/** Snapshot-based verifier. Two independent RPC operators are an explicit trust
 * dependency, not a consensus light client. Never accepts server-supplied flags. */
export async function createMainnetReader(config, transport, tag = 'finalized', previous = null, options = {}) {
  if(!['finalized','safe','latest'].includes(tag))throw Error('Unsupported confirmation tag');
  const clients = new Map(), snapshots = new Map(), cache = new Map(), checked = new Map();
  await allChecked(config.networks.map(async n => {
    if (config.manifest.chains[String(n.chainId)] !== n.hub) throw Error('Manifest / network mismatch');
    const rpc = new RpcPair(n, transport);
    let snapshot = await rpc.pin(tag);
    const requested=options.snapshots?.[String(n.chainId)];
    if(requested){
      if(tag!=='finalized'||BigInt(requested.number)>BigInt(snapshot.number))throw Error('Checkpoint is not finalized');
      snapshot=await rpc.agree('eth_getBlockByNumber',[toQuantity(requested.number),false],header);
      if(!same(snapshot,requested))throw Error('Checkpoint block changed');
    }else if(options.depthByChain){
      if(tag!=='latest')throw Error('Depth requires latest heads');
      const depth=BigInt(options.depthByChain[String(n.chainId)]??'-1');
      if(depth<1n||BigInt(snapshot.number)<depth)throw Error('Invalid confirmation depth');
      snapshot=await rpc.agree('eth_getBlockByNumber',[toQuantity(BigInt(snapshot.number)-depth),false],header);
    }
    const chain=String(n.chainId),prior=previous?.clients.get(chain);
    const reuse=previous?.tag===tag&&prior&&same(prior.net,n)&&same(previous.snapshots.get(chain),snapshot);
    if(!reuse&&previous?.tag===tag&&prior&&same(prior.net,n)){
      const old=previous.snapshots.get(chain);
      if(BigInt(snapshot.number)>=BigInt(old.number)){
        const ancestor=await rpc.agree('eth_getBlockByNumber',[toQuantity(old.number),false],header);
        if(same(ancestor,old)){
          rpc.reads=new Map(prior.reads);rpc.attestations=new Map(prior.attestations);
          for(const [key,m] of previous.messages??[])if(m.chainId===chain)cache.set(key,m);
        }
      }
    }
    if(reuse)for(const [key,m] of previous.messages??[])if(m.chainId===chain)cache.set(key,m);
    if(!reuse)await rpc.attest(toQuantity(snapshot.number));
    clients.set(chain,reuse?prior:rpc); snapshots.set(chain,snapshot);
  }));
  const client = chain => { const r=clients.get(String(chain)); if (!r) throw Error('Unsupported chain'); return r; };
  const block = chain => toQuantity(snapshots.get(String(chain)).number);
  async function count(chain, fn, who) { return (await client(chain).call(client(chain).net.hub,fn,[who],block(chain)))[0].toString(); }
  async function readInbox(chain, to, index) {
    chain=String(chain); index=BigInt(index).toString();
    const key = [chain,to,index].join('/');
    if (cache.has(key)) return cache.get(key);
    const r=client(chain), n=r.net;
    const [e] = await r.call(n.hub,'inboxAt',[to,index],block(chain));
    if (e.blockNumber > BigInt(snapshots.get(chain).number)) throw Error('Message is not finalized');
    const at = toQuantity(e.blockNumber);
    const h = await r.cached('header/'+at,()=>r.agree('eth_getBlockByNumber',[at,false],header));
    if (h.timestamp !== e.timestamp.toString()) throw Error('Message timestamp mismatch');
    const checkKey=chain+'/'+at;
    if (!checked.has(checkKey)) { await r.attest(at); checked.set(checkKey,true); }
    const [historical] = await r.call(n.hub,'inboxAt',[to,index],at);
    if (String(historical) !== String(e)) throw Error('Historical inbox differs');
    const norm = logs => logs.map(l => ({ address:lower(l.address), topics:l.topics.map(lower), data:lower(l.data),
      blockHash:lower(l.blockHash), blockNumber:BigInt(l.blockNumber).toString(), transactionHash:lower(l.transactionHash),
      logIndex:BigInt(l.logIndex).toString(), removed:l.removed === true })).sort((a,b)=>Number(BigInt(a.logIndex)-BigInt(b.logIndex)));
    const logs = await r.cached('logs/'+at+'/'+to,()=>r.agree('eth_getLogs',[{address:n.hub,fromBlock:at,toBlock:at,topics:[ABI.getEvent('Sent').topicHash,to]}],norm));
    const matches = logs.filter(l => {
      if (l.removed || l.blockHash !== h.hash || l.blockNumber !== h.number || l.address !== n.hub) return false;
      const a = ABI.parseLog(l)?.args;
      return a && lower(a.to)===to && a.inboxIndex===BigInt(index) && lower(a.from)===lower(e.from) && digest(a.ref,a.payload)===lower(e.digest);
    });
    if(matches.length!==1) throw Error('Expected exactly one authenticated Sent event');
    const log=matches[0], a=ABI.parseLog(log).args;
    const [out] = await r.call(n.hub,'outboxPage',[e.from,a.outboxIndex,1],block(chain));
    if(out.length!==1 || lower(out[0].to)!==to || out[0].inboxIndex!==BigInt(index) || lower(out[0].digest)!==lower(e.digest)) throw Error('Outbox/inbox mismatch');
    const m = { chainId:chain,hub:n.hub,from:lower(e.from),to,ref:lower(a.ref),payload:lower(a.payload),digest:lower(e.digest),
      inboxIndex:index,outboxIndex:a.outboxIndex.toString(),blockNumber:h.number,blockHash:h.hash,timestamp:h.timestamp,
      finalized:tag==='finalized',transactionHash:log.transactionHash };
    cache.set(key,m); return m;
  }
  async function readOutbox(chain, from, index) {
    const r=client(chain);
    const [out] = await r.call(r.net.hub,'outboxPage',[from,index,1],block(chain));
    if(out.length!==1) throw Error('Missing outbox entry');
    const m=await readInbox(chain,lower(out[0].to),out[0].inboxIndex.toString());
    if(m.from!==lower(from) || m.outboxIndex!==String(index)) throw Error('Outbox cursor mismatch');
    return m;
  }
  return { clients, snapshots, messages:cache, tag, readInbox, readOutbox,
    outboxCount:(c,a)=>count(c,'outboxCount',a),inboxCount:(c,a)=>count(c,'inboxCount',a),
    async assertSnapshots() { for (const [c,h] of snapshots) {
      if ((await client(c).agree('eth_getBlockByNumber',[toQuantity(h.number),false],header)).hash!==h.hash) throw Error('Snapshot reorg');
    } },
  };
}
async function allChecked(promises){
  const results=await Promise.allSettled(promises);
  const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;
  return results.map(r=>r.value);
}
