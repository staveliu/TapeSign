import {Interface,ContractFactory,ZeroAddress,keccak256,toQuantity,formatUnits} from 'ethers';
import artifact from './wallet-artifact.json' with {type:'json'};
import {context,resolveIdentity,provider} from './rpc.js';
import {validateWalletPolicy,validateWalletProposal,walletAddress,walletTypedData,walletDigest,verifyWalletEOA} from './wallet-protocol.js';
import {withRecoveryDeadline} from './wallet-recovery.js';
const ABI=new Interface(artifact.abi),ERC20=new Interface(['function decimals() view returns(uint8)','function symbol() view returns(string)','function balanceOf(address) view returns(uint256)']),SIG=new Interface(['function isValidSignature(bytes32,bytes) view returns(bytes4)']);
const prefix='tapesign-wallet-v1:',pendingKey=prefix+'pending';
function readArray(key){try{const a=JSON.parse(localStorage.getItem(prefix+key)||'[]');return Array.isArray(a)?a:[];}catch{return [];}}
export const getWallets=()=>readArray('wallets').filter(p=>{try{validateWalletPolicy(p);return true;}catch{return false;}});
export const pendingWalletTx=()=>{try{const p=JSON.parse(localStorage.getItem(pendingKey)||'null');if(p&&(!p.details?.kind||!p.request||!p.chainId))return {invalid:true};return p;}catch{return {invalid:true};}};
function store(key,value){localStorage.setItem(prefix+key,JSON.stringify(value));}
export function rememberWallet(p){validateWalletPolicy(p);store('wallets',[p,...getWallets().filter(x=>x.wallet.toLowerCase()!==p.wallet.toLowerCase()||x.chainId!==p.chainId)]);return p;}
export async function walletSession(chainId,expected){
 const p=provider();await p.request({method:'eth_requestAccounts'});
 if(BigInt(await p.request({method:'eth_chainId'}))!==BigInt(chainId))await p.request({method:'wallet_switchEthereumChain',params:[{chainId:toQuantity(chainId)}]});
 const accounts=await p.request({method:'eth_accounts'});
 if(!accounts[0]||BigInt(await p.request({method:'eth_chainId'}))!==BigInt(chainId))throw Error('钱包网络或账户不符');
 if(expected&&accounts[0].toLowerCase()!==expected.toLowerCase())throw Error('请在浏览器钱包切换到 '+expected+'，再重试此步骤');
 return {p,from:accounts[0].toLowerCase()};
}
async function assertSession(p,chainId,from){const a=await p.request({method:'eth_accounts'});if(a[0]?.toLowerCase()!==from||BigInt(await p.request({method:'eth_chainId'}))!==BigInt(chainId))throw Error('签名期间账户或网络变化，请重新核验');}
async function reader(chainId,{signal}={}){const ctx=context(undefined,undefined,{signal}),h=await ctx.head(chainId,'latest'),rpc=ctx.rpc(chainId),block=toQuantity(h.number);
 return {ctx,block,read:(method,params)=>rpc.agree(method,params,v=>typeof v==='string'?v.toLowerCase():v),call:async(address,abi,method,args=[])=>abi.decodeFunctionResult(method,await rpc.agree('eth_call',[{to:address,data:abi.encodeFunctionData(method,args)},block],v=>v.toLowerCase()))};
}
export async function inspectWallet({chainId,wallet,name},{signal,readContext,onProgress=()=>{}}={}){
 wallet=walletAddress(wallet);const r=readContext||await reader(chainId,{signal});onProgress('核验新钱包合约代码');
 const code=await r.read('eth_getCode',[wallet,r.block]);if(keccak256(code)!==keccak256(artifact.runtime))throw Error('钱包合约代码与本版不符，禁止签名和转账');
 const fields=['circuit','circuitTokenId','container','transactionSigner','notarySigner','nonce','policyVersion','active','paused'];
 const values=await r.call(wallet,ABI,'walletState'),s=Object.fromEntries(fields.map((f,i)=>[f,typeof values[i]==='bigint'?values[i].toString():values[i]]));
 if(s.policyVersion!=='1')throw Error('钱包权限版本不符');onProgress('核验 TapeOut 容器与电路持有人');const identity=await resolveIdentity(name,r.ctx);
 if(identity.chainId!==String(chainId)||identity.processor.toLowerCase()!==s.circuit.toLowerCase()||identity.tokenId!==s.circuitTokenId||identity.container.toLowerCase()!==s.container.toLowerCase())throw Error('钱包绑定与当前容器身份不符');
 const policy=validateWalletPolicy({chainId:String(chainId),wallet,name:identity.name,circuit:s.circuit,circuitTokenId:s.circuitTokenId,container:s.container,transactionSigner:s.transactionSigner,notarySigner:s.notarySigner});
 await r.ctx.assert();return {policy,nonce:s.nonce,active:s.active,paused:s.paused,ownerChanged:identity.holder.toLowerCase()!==s.notarySigner.toLowerCase(),currentHolder:identity.holder};
}
export async function tokenDetails(policy,asset=ZeroAddress,{signal}={}){
 const r=await reader(policy.chainId,{signal});asset=walletAddress(asset,{zero:true});let result;
 if(asset===ZeroAddress){result={asset,decimals:18,symbol:policy.chainId==='196'?'OKB':policy.chainId==='56'?'BNB':'TEST',balance:BigInt(await r.read('eth_getBalance',[policy.wallet,r.block])).toString()};}
 else {if((await r.read('eth_getCode',[asset,r.block]))==='0x')throw Error('代币地址没有合约');const [d,b]=await Promise.all([r.call(asset,ERC20,'decimals'),r.call(asset,ERC20,'balanceOf',[policy.wallet])]);let symbol='ERC20';try{symbol=String((await r.call(asset,ERC20,'symbol'))[0]).slice(0,32);}catch{}const decimals=Number(d[0]);if(decimals>36)throw Error('不支持的代币精度');result={asset,decimals,symbol,balance:b[0].toString()};}
 await r.ctx.assert();signal?.throwIfAborted();return {...result,formattedBalance:formatUnits(result.balance,result.decimals),blockNumber:BigInt(r.block).toString()};
}
export async function verifyProposalState(p){
 validateWalletProposal(p);const s=await inspectWallet(p.policy);
 for(const k of Object.keys(p.policy))if(String(p.policy[k]).toLowerCase()!==String(s.policy[k]).toLowerCase())throw Error('提案授权关系与链上钱包不一致');
 if(s.ownerChanged)throw Error('电路 NFT 当前持有人已变化，本版不会自动转移授权');
 const now=Math.floor(Date.now()/1000);if(BigInt(p.message.deadline)<BigInt(now)||BigInt(p.message.deadline)>BigInt(now+7*86400)||p.message.nonce!==s.nonce)throw Error('提案已过期、被撤销或已经执行，请读取最新序号');
 if((p.action==='Bind'&&s.active)||(p.action==='Transfer'&&(!s.active||s.paused))||(p.action==='Resume'&&(!s.active||!s.paused)))throw Error('当前钱包状态不允许此操作');return s;
}
export async function checkWalletSignature(p,role,signature){
 if(signature==='0x')throw Error('缺少'+(role==='transaction'?'交易方':'容器方')+'签名');
 const address=p.policy[role==='transaction'?'transactionSigner':'notarySigner'],r=await reader(p.policy.chainId);
 if(await r.read('eth_getCode',[address,r.block])==='0x')verifyWalletEOA(p,role,signature);
 else if((await r.call(address,SIG,'isValidSignature',[walletDigest(p),signature]))[0]!=='0x1626ba7e')throw Error('合约签名校验失败');
 await r.ctx.assert();return signature;
}
export async function signWalletProposal(input,role){
 const p=structuredClone(validateWalletProposal(input));await verifyProposalState(p);const expected=p.policy[role==='transaction'?'transactionSigner':'notarySigner'];
 const {p:wallet,from}=await walletSession(p.policy.chainId,expected);const data=walletTypedData(p);
 const signature=await wallet.request({method:'eth_signTypedData_v4',params:[from,JSON.stringify({...data,types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}],...data.types},primaryType:p.action})]});
 await assertSession(wallet,p.policy.chainId,from);await verifyProposalState(p);await checkWalletSignature(p,role,signature);p.signatures[role]=signature;return p;
}
async function broadcast(chainId,expected,tx,details,preflight){
 if(!navigator.locks)throw Error('请使用支持 Web Locks 的 Chrome 或 Edge');
 return navigator.locks.request(prefix+'send',{ifAvailable:true},async lock=>{
  if(!lock)throw Object.assign(Error('另一页面正在发送或核对交易，请稍后再试'),{code:'WALLET_SEND_IN_PROGRESS'});
  if(pendingWalletTx())throw Object.assign(Error('上一笔交易正在等待核对，请查看上方“待确认的链上操作”；无需再次发送'),{code:'WALLET_TX_PENDING'});
  const {p,from}=await walletSession(chainId,expected);await preflight?.();
  const request={...tx,from,chainId:toQuantity(chainId)};const gas=await p.request({method:'eth_estimateGas',params:[request]});await assertSession(p,chainId,from);await preflight?.();
  await assertSession(p,chainId,from);
  const intent={chainId:String(chainId),request:{...request,gas:toQuantity(BigInt(gas)*120n/100n)},details,hash:null,createdAt:Date.now()};store('pending',intent);
  try{const hash=await p.request({method:'eth_sendTransaction',params:[intent.request]});if(!/^0x[a-fA-F0-9]{64}$/.test(hash||''))throw Error('钱包未返回有效交易哈希');intent.hash=hash.toLowerCase();store('pending',intent);return intent;}
  catch(e){if(Number(e.code)===4001)localStorage.removeItem(pendingKey);throw e;}
 });
}
export async function deployNotaryWallet(name,transactionSigner){
 const identity=await resolveIdentity(name);transactionSigner=walletAddress(transactionSigner);if(transactionSigner.toLowerCase()===identity.holder.toLowerCase()||transactionSigner.toLowerCase()===identity.container.toLowerCase())throw Error('交易控制钱包必须独立于容器签名方');
 const policy={chainId:identity.chainId,name:identity.name,circuit:identity.processor,circuitTokenId:identity.tokenId,container:identity.container,transactionSigner,notarySigner:identity.holder};
 const tx=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(policy.circuit,policy.circuitTokenId,policy.container,policy.transactionSigner,policy.notarySigner);
 return broadcast(policy.chainId,policy.notarySigner,{data:tx.data,value:'0x0'},{kind:'deploy',policy},async()=>{const current=await resolveIdentity(name);if(JSON.stringify(current)!==JSON.stringify(identity))throw Error('容器身份已变化，请重新创建');});
}
export async function executeWalletProposal(p){
 await verifyProposalState(p);await Promise.all(['transaction','notary'].map(role=>checkWalletSignature(p,role,p.signatures[role])));
 const args=p.action==='Transfer'?[p.message,p.signatures.transaction,p.signatures.notary]:[p.message.nonce,p.message.deadline,p.signatures.transaction,p.signatures.notary];
 const method={Bind:'activate',Transfer:'execute',Resume:'resume'}[p.action];
 return broadcast(p.policy.chainId,null,{to:p.policy.wallet,data:ABI.encodeFunctionData(method,args),value:'0x0'},{kind:p.action,policy:p.policy,digest:walletDigest(p)},()=>verifyProposalState(p));
}
export async function walletSafety(policy,action){
 const s=await inspectWallet(policy);if(!['pause','cancel'].includes(action))throw Error('操作无效');
 const {from}=await walletSession(policy.chainId);if(![s.policy.transactionSigner,s.policy.notarySigner].some(x=>x.toLowerCase()===from))throw Error('只有原签名方可暂停或撤销');
 return broadcast(policy.chainId,from,{to:policy.wallet,data:ABI.encodeFunctionData(action,action==='cancel'?[s.nonce]:[]),value:'0x0'},{kind:action,policy},()=>inspectWallet(policy));
}
export async function recoverWalletTransaction(hash,options={}){
 if(!navigator.locks)throw Error('浏览器不支持安全恢复');
 return withRecoveryDeadline(async({signal,report})=>navigator.locks.request(prefix+'send',{ifAvailable:true},async lock=>{
  if(!lock)throw Error('另一页面正在处理');signal.throwIfAborted();const pending=pendingWalletTx();if(!pending)throw Error('没有待确认交易');if(pending.invalid)throw Error('待确认记录损坏，请保留原始浏览器数据并核对钱包活动，禁止重复发送');
  hash=hash||pending.hash;if(!/^0x[a-fA-F0-9]{64}$/.test(hash||''))throw Error('请从钱包活动复制完整交易哈希');
  report('读取链 '+pending.chainId+' 的核验区块');const r=await reader(pending.chainId,{signal});report('查询部署 / 执行交易');
  const tx=await r.ctx.rpc(pending.chainId).agree('eth_getTransactionByHash',[hash],v=>v?{hash:v.hash?.toLowerCase(),from:v.from?.toLowerCase(),to:v.to?.toLowerCase()||null,input:(v.input||v.data)?.toLowerCase(),value:toQuantity(v.value),blockHash:v.blockHash?.toLowerCase()||null}:null);if(!tx)throw Error('节点尚未找到交易，请保留记录稍后核对');
  const q=pending.request;if(tx.from.toLowerCase()!==q.from.toLowerCase()||(tx.to||'').toLowerCase()!==(q.to||'').toLowerCase()||(tx.input||tx.data||'0x').toLowerCase()!==q.data.toLowerCase()||BigInt(tx.value)!==BigInt(q.value||0))throw Error('交易与本机待确认操作不匹配');
  signal.throwIfAborted();pending.hash=hash.toLowerCase();store('pending',pending);report('查询交易回执与执行结果');const receipt=await r.ctx.rpc(pending.chainId).agree('eth_getTransactionReceipt',[hash],v=>v?{transactionHash:v.transactionHash?.toLowerCase(),status:toQuantity(v.status),blockHash:v.blockHash?.toLowerCase(),blockNumber:toQuantity(v.blockNumber),contractAddress:v.contractAddress?.toLowerCase()||null,logs:(v.logs||[]).map(l=>({address:l.address.toLowerCase(),topics:l.topics.map(x=>x.toLowerCase()),data:l.data.toLowerCase(),removed:!!l.removed}))}:null);if(!receipt)throw Error('交易已提交，尚未打包；无需重新发送');
  if(receipt.transactionHash.toLowerCase()!==hash.toLowerCase()||receipt.blockHash!==tx.blockHash)throw Error('交易回执不一致');
  if(BigInt(receipt.blockNumber)>BigInt(r.block))throw Error('独立节点尚未同步到交易区块，请稍后核对；无需重发');
  report('核对交易所在区块');const block=await r.ctx.rpc(pending.chainId).agree('eth_getBlockByNumber',[receipt.blockNumber,false],v=>v?{hash:v.hash.toLowerCase(),number:toQuantity(v.number)}:null);
  if(!block||block.hash!==receipt.blockHash)throw Error('交易区块已变化，请稍后重新核验');await r.ctx.assert();
  signal.throwIfAborted();if(BigInt(receipt.status)===0n){store('history',[{...pending,failed:true},...readArray('history')].slice(0,100));localStorage.removeItem(pendingKey);throw Object.assign(Error('交易已在链上失败，可重新读取状态后再操作'),{code:'WALLET_TX_FAILED'});}
  if(BigInt(receipt.status)!==1n)throw Error('交易状态无效');
  if(pending.details.kind!=='deploy'){
   const expected={Bind:'WalletActivated',Transfer:'TransferExecuted',Resume:'WalletResumed',cancel:'NonceCancelled',pause:'WalletPaused'}[pending.details.kind];
   const events=receipt.logs.filter(l=>!l.removed&&l.address.toLowerCase()===pending.details.policy.wallet.toLowerCase()).map(l=>{try{return ABI.parseLog(l);}catch{return null;}});
   const event=events.find(e=>e?.name===expected);if(!event)throw Error('未找到与操作一致的链上钱包事件');
   if(pending.details.kind==='Transfer'&&event.args.digest!==pending.details.digest)throw Error('链上执行事件与签署提案不一致');
  }
  let policy=pending.details.policy;if(pending.details.kind==='deploy')policy={...policy,wallet:walletAddress(receipt.contractAddress)};
  const state=await inspectWallet(policy,{signal,readContext:r,onProgress:report});signal.throwIfAborted();rememberWallet(state.policy);
  store('history',[{...pending,policy:state.policy,blockNumber:receipt.blockNumber},...readArray('history')].slice(0,100));localStorage.removeItem(pendingKey);return {policy:state.policy,state,hash,kind:pending.details.kind,digest:pending.details.digest};
 }),options);
}
export function walletHistory(){return readArray('history');}
