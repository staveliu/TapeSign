// Deterministic synthetic wallets for tests only. Never fund these addresses.
import {Wallet} from 'ethers';
import {endpoint} from '../src/vendor/protocol.js';
import {PROTOCOL,ZERO,signingData,offerRecord,acceptRecord,sealRecord} from '../src/protocol.js';
import config from '../config/networks.json' with {type:'json'};
import {contractNumber} from '../src/contract-id.js';
export const hash=n=>'0x'+n.toString(16).padStart(64,'0');
export const wallets={A:new Wallet(hash(11)),B:new Wallet(hash(12))};
export const ink=[[[100,200],[150,100],[200,230],[260,120],[350,210],[440,130]]];
export function identity(role,chain='196'){
  const n=role==='A'?1:2,container='0x'+String(n).repeat(40);
  return {name:`${n}.${chain==='196'?'2.':''}204.tape`,chainId:chain,processor:'0x'+'33'.repeat(20),tokenId:String(n),container,holder:wallets[role].address.toLowerCase(),endpoint:endpoint(chain,container)};
}
export function document({initiator='A',crossChain=false}={}){
  return {protocol:PROTOCOL,contractId:contractNumber(1790409600000,hash(99)),title:'软件开发合作合同',body:[{type:'h2',runs:[{text:'交付约定',marks:1}]},{type:'p',runs:[{text:'双方约定完成一个公开、可独立核验的电子合同系统。',marks:0}]}],parties:{A:identity('A'),B:identity('B',crossChain?'56':'196')},initiator,nonce:hash(99),createdAt:1790409600000,client:{site:'4.2.204.tape',release:hash(123)}};
}
export async function signed(doc,role,tx=ZERO,strokes=ink){const n=config.networks.find(n=>String(n.chainId)===doc.parties[role].chainId),data=signingData(doc,role,strokes,tx,n.hub);return {role,ink:structuredClone(strokes),signature:await wallets[role].signTypedData(data.domain,data.types,data.message)};}
export async function fixture(options){const doc=document(options),role=doc.initiator,other=role==='A'?'B':'A',offerLocation={chainId:doc.parties[role].chainId,tx:hash(1)},acceptLocation={chainId:doc.parties[other].chainId,tx:hash(2)},sealLocation={chainId:doc.parties[role].chainId,tx:hash(3)};
  const first=await signed(doc,role),second=await signed(doc,other,offerLocation.tx),offer=offerRecord(doc,first),accept=acceptRecord(doc,offerLocation,second),seal=sealRecord(doc,offerLocation,acceptLocation,[first,second].sort((a,b)=>a.role.localeCompare(b.role)));
  return {doc,offer,accept,seal,offerLocation,acceptLocation,sealLocation};
}
