import { toQuantity } from 'ethers';
import { ABI, header, config, context } from './rpc.js';
import { digest, endpoint } from './vendor/protocol.js';
import { anchor, decode, documentId, validateOffer, validateAccept, validateSeal, ZERO, same, otherRole } from './protocol.js';
import { confirmationState } from './confirmation.js';

function receiptValue(r) {
  return r && {hash:r.transactionHash.toLowerCase(),status:BigInt(r.status).toString(),blockNumber:BigInt(r.blockNumber).toString(),blockHash:r.blockHash.toLowerCase(),from:r.from.toLowerCase(),to:r.to?.toLowerCase(),logs:r.logs.map(l=>({address:l.address.toLowerCase(),topics:l.topics.map(t=>t.toLowerCase()),data:l.data.toLowerCase(),blockHash:l.blockHash.toLowerCase(),transactionHash:l.transactionHash.toLowerCase(),removed:l.removed === true}))};
}
function waiting(message,code,details={}){return Object.assign(Error(message),{code,...details});}
export async function readMessage(location, ctx, {allowPending=false,confirmation='finalized'} = {}) {
  if(!['finalized','fast'].includes(confirmation))throw Error('Unknown confirmation policy');
  anchor(location); const key = location.chainId + '/' + location.tx + '/' + confirmation + '/' + allowPending;
  if (ctx.records.has(key)) return ctx.records.get(key);
  const promise = (async()=>{
    ctx.onProgress('按交易哈希核验链上消息…');
    const rpc = ctx.rpc(location.chainId), n = rpc.net;
    const [receipt, head] = await Promise.all([rpc.agree('eth_getTransactionReceipt',[location.tx],receiptValue),ctx.head(location.chainId)]);
    if (!receipt) throw waiting('交易尚未打包或未找到，将自动重查；无需再次发送','TRANSACTION_PENDING');
    if (receipt.hash !== location.tx || receipt.status !== '1' || receipt.to !== n.hub) throw Error('交易失败或不是 TapeOut 消息交易');
    const finalized=BigInt(receipt.blockNumber)<=BigInt(head.number);
    let latest=null;
    if(!finalized){
      if(!allowPending&&confirmation==='finalized')throw waiting('交易已提交，等待链最终确认；无需再次发送','FINALITY_PENDING');
      latest=await ctx.head(location.chainId,'latest');
      if(BigInt(receipt.blockNumber)>BigInt(latest.number))throw waiting('交易回执已返回，等待两家 RPC 同步到该区块','RPC_SYNC_PENDING');
      ctx.onProgress('交易已打包，正在核验正文、签名与短确认进度…');
    }
    const progress=confirmationState(location.chainId,receipt.blockNumber,head,latest);
    const ready=confirmation==='fast'?progress.fast:finalized;
    if(!ready&&!allowPending)throw waiting(progress.fresh?'交易仍在积累短确认，请稍后重试；无需再次发送':'节点进度落后，暂停签署，请稍后重试','CONFIRMATION_PENDING',{confirmation:progress});
    const at = toQuantity(receipt.blockNumber);
    const block = await rpc.agree('eth_getBlockByNumber',[at,false],header);
    if (block.hash !== receipt.blockHash) throw Error('交易所在区块已变化');
    await rpc.attest(at);
    const matches = receipt.logs.filter(l=>l.address===n.hub && !l.removed && l.blockHash===block.hash && l.transactionHash===location.tx).map(l=>{try {const event=ABI.parseLog(l); return event?.name==='Sent'?event:null;} catch {return null;}}).filter(Boolean);
    if (matches.length !== 1) throw Error('必须包含唯一的 TapeOut Sent 消息');
    const args = matches[0].args, from = args.from.toLowerCase(), to = args.to.toLowerCase(), ref = args.ref.toLowerCase(), payload = args.payload.toLowerCase();
    const [entry] = await rpc.call(n.hub,'inboxAt',[to,args.inboxIndex],at);
    const [out] = await rpc.call(n.hub,'outboxPage',[from,args.outboxIndex,1],at);
    const expectedDigest = digest(ref,payload);
    if (entry.from.toLowerCase()!==from || String(entry.blockNumber)!==block.number || String(entry.timestamp)!==block.timestamp || entry.digest.toLowerCase()!==expectedDigest || out.length!==1 || out[0].to.toLowerCase()!==to || out[0].inboxIndex!==args.inboxIndex || out[0].digest.toLowerCase()!==expectedDigest || String(out[0].blockNumber)!==block.number || String(out[0].timestamp)!==block.timestamp) throw Error('消息事件与链上信箱不一致');
    const transaction = await rpc.agree('eth_getTransactionByHash',[location.tx],t=>t&&({hash:t.hash.toLowerCase(),from:t.from.toLowerCase(),to:t.to?.toLowerCase(),input:t.input.toLowerCase(),blockHash:t.blockHash?.toLowerCase(),value:BigInt(t.value).toString()}));
    const parsed = transaction && ABI.parseTransaction({data:transaction.input});
    if (!transaction || transaction.hash!==location.tx || transaction.from!==receipt.from || transaction.to!==n.hub || transaction.blockHash!==block.hash || transaction.value!=='0' || parsed?.name!=='send' || parsed.args[2].toLowerCase()!==to || parsed.args[3].toLowerCase()!==ref || parsed.args[4].toLowerCase()!==payload) throw Error('交易输入与事件不匹配');
    return {location,block,from,to,ref,payload,record:decode(payload),sender:transaction.from,processor:parsed.args[0].toLowerCase(),tokenId:String(parsed.args[1]),inboxIndex:String(args.inboxIndex),outboxIndex:String(args.outboxIndex),finalized,ready,confirmation:progress};
  })();
  ctx.records.set(key,promise);
  try { return await promise; } catch(e) { ctx.records.delete(key); throw e; }
}
async function authenticate(message, identity, destination, ref, ctx) {
  if (message.location.chainId!==identity.chainId || message.from!==identity.container || message.to!==destination || message.ref!==ref || message.sender!==identity.holder || message.processor!==identity.processor || message.tokenId!==identity.tokenId) throw Error('交易发送人、容器或收件对象与合同不符');
  const actual = await ctx.rpc(identity.chainId).resolve(identity.name,toQuantity(message.block.number));
  if (!same(actual,identity)) throw Error('签署时的链上容器身份与合同不符');
}
export async function loadContract(location, ctx = context(), {allowPending=false,confirmation='finalized'} = {}) {
  const options={allowPending,confirmation};
  const selected = await readMessage(location,ctx,options), kind = selected.record.type;
  if (!['offer','accept','seal'].includes(kind)) throw Error('不是支持的合同交易');
  const offerMessage = kind==='offer'?selected:await readMessage(anchor(selected.record.offer),ctx,options);
  const offer = validateOffer(offerMessage.record,config.networks), doc = offer.doc, id = documentId(doc);
  await authenticate(offerMessage,doc.parties[doc.initiator],doc.parties[otherRole(doc.initiator)].endpoint,ZERO,ctx);
  let acceptance = null, seal = null;
  if (kind!=='offer') {
    acceptance = kind==='accept'?selected:await readMessage(anchor(selected.record.accept),ctx,options);
    validateAccept(acceptance.record,offer,offerMessage.location,config.networks);
    await authenticate(acceptance,doc.parties[otherRole(doc.initiator)],doc.parties[doc.initiator].endpoint,id,ctx);
    if (Number(acceptance.block.timestamp)<Number(offerMessage.block.timestamp) || (acceptance.location.chainId===offerMessage.location.chainId && BigInt(acceptance.block.number)<=BigInt(offerMessage.block.number))) throw Error('对方签署时间早于合同发布');
  }
  if (kind==='seal') {
    seal=selected; validateSeal(seal.record,offer,offerMessage.location,acceptance.record,acceptance.location,config.networks);
    await authenticate(seal,doc.parties[doc.initiator],doc.parties[otherRole(doc.initiator)].endpoint,id,ctx);
    if (Number(seal.block.timestamp)<Number(acceptance.block.timestamp) || (seal.location.chainId===acceptance.location.chainId && BigInt(seal.block.number)<=BigInt(acceptance.block.number))) throw Error('归档早于对方签署');
  }
  await ctx.assert();
  const messages=[offerMessage,acceptance,seal].filter(Boolean);
  // Recheck each transaction block after all historical identity/signature reads.
  // Pinning a newer head alone must not conceal a reorg during preview loading.
  for(const m of messages){const now=await ctx.rpc(m.location.chainId).agree('eth_getBlockByNumber',[toQuantity(m.block.number),false],header);if(now.hash!==m.block.hash)throw Error('合同交易区块已变化，请重新核验');}
  // A slow RPC verification must not authorize from a head that aged out.
  for(const m of messages)if(!m.finalized){
    const progress=confirmationState(m.location.chainId,m.block.number,await ctx.head(m.location.chainId),await ctx.head(m.location.chainId,'latest'));
    m.confirmation=progress;m.ready=confirmation==='fast'&&progress.fast;
  }
  const finalized=messages.every(m=>m.finalized===true),ready=messages.every(m=>m.ready===true);
  if(!ready&&!allowPending)throw waiting('确认进度不足或节点进度落后，请重新核验','CONFIRMATION_PENDING');
  return {id,doc,offer:offerMessage,acceptance,seal,selected:location,status:seal?'sealed':acceptance?'signed':'invited',finalized,ready,confirmationPolicy:confirmation,confirmation:messages.filter(m=>!m.finalized).map(m=>m.confirmation),verifiedAt:Date.now()};
}
// Wallet prompts may remain open for minutes. Before sending, independently
// recheck the exact ancestors, receipts and confirmation progress, never a flag.
export async function assertBundleCurrent(bundle,ctx=context()){
  for(const m of [bundle.offer,bundle.acceptance,bundle.seal].filter(Boolean)){
    const rpc=ctx.rpc(m.location.chainId);
    const [receipt,block,finalizedHead,latest]=await Promise.all([
      rpc.agree('eth_getTransactionReceipt',[m.location.tx],receiptValue),rpc.agree('eth_getBlockByNumber',[toQuantity(m.block.number),false],header),ctx.head(m.location.chainId),ctx.head(m.location.chainId,'latest'),
    ]);
    if(!receipt||receipt.status!=='1'||receipt.hash!==m.location.tx||receipt.blockHash!==m.block.hash||receipt.blockNumber!==m.block.number||block.hash!==m.block.hash)throw Error('合同引用交易发生变化，已停止发送，请重新打开合同');
    if(!confirmationState(m.location.chainId,m.block.number,finalizedHead,latest).fast)throw Error('短确认不足或节点落后，已停止发送，请重新核验');
  }
  await ctx.assert();
}
export const toEndpoint = endpoint;
