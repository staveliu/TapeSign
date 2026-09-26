import { hexlify, randomBytes } from 'ethers';
import { config, context, resolveIdentity, connect, authorize, sendTransaction, ABI } from './rpc.js';
import { PROTOCOL, ZERO, canonical, documentId, signingData, verifyConsent, offerRecord, acceptRecord, sealRecord, encode, validateDocument, otherRole, validateInk, hashObject, same } from './protocol.js';
import { loadContract, assertBundleCurrent } from './reader.js';
import { remember,readLocal,saveLocal } from './storage.js';
import { syncIndex } from './indexer.js';
import { canContinue } from './compatibility.js';
import { contractNumber } from './contract-id.js';
import { historyRow } from './history.js';
import { notifyTransaction } from './cache-client.js';
export { config, connect, resolveIdentity, loadContract, syncIndex };
export const release = typeof __RELEASE__ === 'string' ? __RELEASE__ : '0x'+'00'.repeat(32);
export async function createDocument({title,body,myName,otherName,role},progress=()=>{}) {
  progress('正在解析双方容器…');
  const ctx=context(), [me,them]=await Promise.all([resolveIdentity(myName,ctx),resolveIdentity(otherName,ctx)]);
  const fields={protocol:PROTOCOL,title:title.trim(),body,parties:role==='A'?{A:me,B:them}:{A:them,B:me},initiator:role,client:{site:config.site,release}};
  const key='prepared:'+hashObject(fields),previous=readLocal(key);
  if(previous){try{validateDocument(previous);const {nonce,createdAt,contractId,...oldFields}=previous;if(same(oldFields,fields))return previous;}catch{}}
  const nonce=hexlify(randomBytes(32)),createdAt=Date.now();
  const doc=validateDocument({...fields,nonce,createdAt,contractId:contractNumber(createdAt,nonce)});saveLocal(key,doc);return doc;
}
async function consent(doc,role,ink,offerTx,progress) {
  validateInk(ink);const identity=doc.parties[role], p=await authorize(identity,progress);
  const n=config.networks.find(n=>String(n.chainId)===identity.chainId), data=signingData(doc,role,ink,offerTx,n.hub);
  progress('请在钱包确认合同摘要与手写签名…');
  const types={EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}],...data.types};
  const signature=await p.request({method:'eth_signTypedData_v4',params:[identity.holder,JSON.stringify({...data,types,primaryType:'Consent'})]});
  const result={role,ink,signature:signature.toLowerCase()};verifyConsent(doc,result,offerTx,config.networks);return result;
}
async function send(record,identity,to,ref,progress,bundle) {
  const data=ABI.encodeFunctionData('send',[identity.processor,identity.tokenId,to,ref,encode(record)]);
  const n=config.networks.find(n=>String(n.chainId)===identity.chainId);
  const location=await sendTransaction(identity,{to:n.hub,value:'0x0',data},progress,bundle?()=>assertBundleCurrent(bundle):undefined);
  const row=historyRow(record,location,record.doc||bundle?.doc);
  const stored=remember(location,row.label,row);
  notifyTransaction(location);
  return {...location,stored};
}
export async function publishOffer(doc,ink,progress) {
  validateDocument(doc);const signed=await consent(doc,doc.initiator,ink,ZERO,progress);
  return send(offerRecord(doc,signed),doc.parties[doc.initiator],doc.parties[otherRole(doc.initiator)].endpoint,ZERO,progress);
}
export async function publishAcceptance(location,ink,progress) {
  const bundle=await loadContract(location,context(undefined,progress),{confirmation:'fast'});
  if(bundle.status!=='invited')throw Error('请选择尚未回签的发起交易');
  if(!canContinue(bundle.doc,release))throw Error('此合同的客户端版本尚未确认兼容，当前版本仅可核验');
  const doc=bundle.doc,role=otherRole(doc.initiator), signed=await consent(doc,role,ink,bundle.offer.location.tx,progress);
  // Check the complete final packet before sending a signature that cannot fit.
  encode(sealRecord(doc,bundle.offer.location,{chainId:doc.parties[role].chainId,tx:'0x'+'ff'.repeat(32)},[bundle.offer.record.consent,signed].sort((a,b)=>a.role.localeCompare(b.role))));
  return send(acceptRecord(doc,bundle.offer.location,signed),doc.parties[role],doc.parties[doc.initiator].endpoint,bundle.id,progress,bundle);
}
export async function publishSeal(location,progress) {
  const bundle=await loadContract(location,context(undefined,progress),{confirmation:'fast'});
  if(bundle.status!=='signed')throw Error('尚未核验到双方签署，请在原合同或“我的合同”中刷新状态');
  if(!canContinue(bundle.doc,release))throw Error('此合同的客户端版本尚未确认兼容，当前版本仅可核验');
  const doc=bundle.doc,consents=[bundle.offer.record.consent,bundle.acceptance.record.consent].sort((a,b)=>a.role.localeCompare(b.role));
  const record=sealRecord(doc,bundle.offer.location,bundle.acceptance.location,consents);
  return send(record,doc.parties[doc.initiator],doc.parties[otherRole(doc.initiator)].endpoint,bundle.id,progress,bundle);
}
export const exportBundle = bundle => canonical({format:'TapeSign evidence v2',contractId:bundle.doc.contractId,selected:bundle.selected,doc:bundle.doc,offer:bundle.offer,acceptance:bundle.acceptance,seal:bundle.seal,confirmation:{finalized:bundle.finalized,policy:bundle.confirmationPolicy,checkedAt:bundle.verifiedAt},notice:'Offline data is a backup. Short confirmations are reversible, not finality. Reverify transaction locations against chain before relying on it.'});
