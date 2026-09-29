import {validateWalletProposal,walletAddress} from './wallet-protocol.js';

export const MAX_WALLET_LINK_DATA=65536;
const roles=['transaction','notary','execute'];
export function nextWalletRole(proposal){
 validateWalletProposal(proposal);
 return proposal.signatures.transaction==='0x'?'transaction':proposal.signatures.notary==='0x'?'notary':'execute';
}
export function encodeWalletProposal(proposal){
 const bytes=new TextEncoder().encode(JSON.stringify(validateWalletProposal(proposal)));
 if(bytes.length>MAX_WALLET_LINK_DATA*3/4)throw Error('提案过大，请使用 JSON 文件交接');
 let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
 return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export function decodeWalletProposal(encoded){
 if(typeof encoded!=='string'||!encoded.length||encoded.length>MAX_WALLET_LINK_DATA||!/^[A-Za-z0-9_-]+$/.test(encoded)||encoded.length%4===1)throw Error('提案链接编码无效或过长，请重新复制完整链接');
 let proposal;
 try{const binary=atob(encoded.replaceAll('-','+').replaceAll('_','/'));proposal=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0))));}
 catch{throw Error('提案链接无法解析，请重新复制完整链接');}
 return validateWalletProposal(proposal);
}
export function walletLinkBase(value){
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('请输入对方可访问的 HTTP / HTTPS 客户端网址');
 // Preserve gateway routing parameters, but never inherit another action.
 for(const key of ['tx','chain','view','notary','proposal','role','token','api_key','apikey','secret','password'])url.searchParams.delete(key);
 url.hash='';return url.href;
}
export function walletProposalLink(base,proposal,role=nextWalletRole(proposal)){
 if(!roles.includes(role))throw Error('无效的签署角色');
 const url=new URL(walletLinkBase(base));
 // Fragments keep signatures out of HTTP requests and ordinary referrers.
 url.hash='wallet/sign?'+new URLSearchParams({proposal:encodeWalletProposal(proposal),role});return url.href;
}
export function readWalletProposalLink(value){
 const url=new URL(value),[route,...rest]=url.hash.split('?');
 if(route!=='#wallet/sign'||!rest.length)return null;
 const data=rest.join('?');if(data.length>MAX_WALLET_LINK_DATA+100)throw Error('提案链接过长，请使用 JSON 文件交接');
 const params=new URLSearchParams(data);
 if(!params.has('proposal'))return null;
 if(params.getAll('proposal').length!==1||params.getAll('role').length>1)throw Error('提案链接包含重复参数');
 const proposal=decodeWalletProposal(params.get('proposal')),role=params.get('role')||nextWalletRole(proposal);
 if(!roles.includes(role))throw Error('提案链接中的签署角色无效');
 return {proposal,role};
}
export function walletExplorerUrl(chainId,address){
 const network={'56':'bsc','196':'x-layer'}[String(chainId)];
 return network?'https://www.oklink.com/'+network+'/address/'+walletAddress(address):null;
}
export const nativeWalletSymbol=chainId=>({'56':'BNB','196':'OKB','31337':'TEST'}[String(chainId)]||'原生币');
export function localWalletLink(value){const host=new URL(value).hostname;return host==='localhost'||host.endsWith('.localhost')||host==='[::1]'||/^127\./.test(host);}
