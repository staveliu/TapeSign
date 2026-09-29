import {getAddress,ZeroAddress,TypedDataEncoder,verifyTypedData,parseUnits} from 'ethers';
import {nameInfo} from './protocol.js';
export const WALLET_FORMAT='TapeSign wallet proposal v1';
export const DOMAIN_NAME='TapeSign Notary Wallet';
const policyKeys=['chainId','wallet','name','circuit','circuitTokenId','container','transactionSigner','notarySigner'];
const uint=(x)=>{if(typeof x!=='string'||!(/^(0|[1-9][0-9]*)$/).test(x)||BigInt(x)>=(1n<<256n))throw Error('无效整数');return x;};
function exact(x,keys){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join()!==[...keys].sort().join())throw Error('提案字段不符合协议');}
export function walletAddress(value,{zero=false}={}){const a=getAddress(value);if(!zero&&a===ZeroAddress)throw Error('地址不能为零');return a;}
export function validateWalletPolicy(p){
 exact(p,policyKeys);uint(p.chainId);uint(p.circuitTokenId);if(!['56','196','31337'].includes(p.chainId))throw Error('不支持的公证钱包链');
 for(const k of ['wallet','circuit','container','transactionSigner','notarySigner'])walletAddress(p[k]);
 const info=nameInfo(p.name);if(info.name!==p.name||info.tokenId!==p.circuitTokenId||(p.chainId!=='31337'&&info.chainId!==p.chainId))throw Error('容器名称、链或电路编号不符');
 if(p.transactionSigner.toLowerCase()===p.notarySigner.toLowerCase())throw Error('请使用两个不同的签名钱包');return p;
}
export const walletTypes={
 Bind:[{name:'circuit',type:'address'},{name:'circuitTokenId',type:'uint256'},{name:'container',type:'address'},{name:'transactionSigner',type:'address'},{name:'notarySigner',type:'address'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'},{name:'policyVersion',type:'uint256'}],
 Transfer:[{name:'asset',type:'address'},{name:'recipient',type:'address'},{name:'amount',type:'uint256'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'},{name:'policyVersion',type:'uint256'}],
 Resume:[{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'},{name:'policyVersion',type:'uint256'}]
};
export function validateWalletProposal(p){
 exact(p,['format','action','policy','message','signatures']);if(p.format!==WALLET_FORMAT||!Object.hasOwn(walletTypes,p.action))throw Error('不是支持的公证钱包提案');
 validateWalletPolicy(p.policy);exact(p.message,walletTypes[p.action].map(f=>f.name));
 for(const f of walletTypes[p.action]){if(f.type==='address')walletAddress(p.message[f.name],{zero:f.name==='asset'});else uint(p.message[f.name]);}
 if(p.message.policyVersion!=='1')throw Error('不支持的权限版本');
 if(p.action==='Bind')for(const k of ['circuit','circuitTokenId','container','transactionSigner','notarySigner'])if(p.message[k].toLowerCase()!==p.policy[k].toLowerCase())throw Error('绑定数据与提案身份不符');
 if(p.action==='Transfer'&&(BigInt(p.message.amount)===0n||p.message.recipient.toLowerCase()===p.policy.wallet.toLowerCase()||p.message.asset.toLowerCase()===p.policy.wallet.toLowerCase()))throw Error('转账金额或目标无效');
 exact(p.signatures,['transaction','notary']);for(const s of Object.values(p.signatures))if(typeof s!=='string'||!/^0x(?:[a-fA-F0-9]{2})*$/.test(s)||s.length>16386)throw Error('签名编码无效');return p;
}
export function walletTypedData(p){validateWalletProposal(p);return {domain:{name:DOMAIN_NAME,version:'1',chainId:p.policy.chainId,verifyingContract:p.policy.wallet},types:{[p.action]:walletTypes[p.action]},message:p.message};}
export const walletDigest=p=>{const d=walletTypedData(p);return TypedDataEncoder.hash(d.domain,d.types,d.message);};
export function newWalletProposal(policy,action,nonce,{minutes=10,asset=ZeroAddress,recipient,amount,now=Math.floor(Date.now()/1000)}={}){
 if(!Number.isInteger(minutes)||minutes<1||minutes>1440)throw Error('有效期需为 1 至 1440 分钟');
 const message={nonce:String(nonce),deadline:String(now+minutes*60),policyVersion:'1'};
 if(action==='Bind')for(const k of ['circuit','circuitTokenId','container','transactionSigner','notarySigner'])message[k]=policy[k];
 if(action==='Transfer')Object.assign(message,{asset:walletAddress(asset,{zero:true}),recipient:walletAddress(recipient),amount:uint(String(amount))});
 return validateWalletProposal({format:WALLET_FORMAT,action,policy:{...policy},message,signatures:{transaction:'0x',notary:'0x'}});
}
export function exactAmount(text,decimals){if(typeof text!=='string'||! /^[0-9]+(?:[.][0-9]+)?$/.test(text.trim())||!Number.isInteger(decimals)||decimals<0||decimals>36)throw Error('金额或代币精度无效');const n=parseUnits(text.trim(),decimals);if(n<=0n||n>=(1n<<256n))throw Error('请输入有效正金额');return n.toString();}
export function verifyWalletEOA(p,role,signature){if(!['transaction','notary'].includes(role))throw Error('签名角色无效');const d=walletTypedData(p),expected=p.policy[role==='transaction'?'transactionSigner':'notarySigner'];if(verifyTypedData(d.domain,d.types,d.message,signature).toLowerCase()!==expected.toLowerCase())throw Error('签名与当前提案或角色不符');return signature;}
export function mergeWalletProposals(a,b){validateWalletProposal(a);validateWalletProposal(b);if(walletDigest(a)!==walletDigest(b)||policyKeys.some(k=>a.policy[k].toLowerCase()!==b.policy[k].toLowerCase()))throw Error('不能合并不同提案');return {...a,signatures:Object.fromEntries(['transaction','notary'].map(k=>{if(a.signatures[k]!=='0x'&&b.signatures[k]!=='0x'&&a.signatures[k]!==b.signatures[k])throw Error('同一角色存在不同签名');return [k,b.signatures[k]!=='0x'?b.signatures[k]:a.signatures[k]];}))};}
