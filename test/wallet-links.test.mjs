import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet} from 'ethers';
import {newWalletProposal,walletTypedData,walletDigest,verifyWalletEOA} from '../src/wallet-protocol.js';
import {encodeWalletProposal,decodeWalletProposal,walletProposalLink,readWalletProposalLink,nextWalletRole,walletExplorerUrl,nativeWalletSymbol,MAX_WALLET_LINK_DATA} from '../src/wallet-links.js';
import {readTabRoute,writeTabRoute} from '../src/navigation.js';
const keys=Array.from({length:6},()=>Wallet.createRandom());
const policy={chainId:'196',wallet:keys[2].address,name:'4.2.204.tape',circuit:keys[3].address,circuitTokenId:'4',container:keys[4].address,transactionSigner:keys[0].address,notarySigner:keys[1].address};
const proposal=()=>newWalletProposal(policy,'Transfer','7',{recipient:keys[5].address,amount:'1234567890123456789'});

test('URL handoff preserves exact signed values, both signatures and next signer',async()=>{
 const p=proposal(),d=walletTypedData(p);assert.equal(nextWalletRole(p),'transaction');
 p.signatures.notary=await keys[1].signTypedData(d.domain,d.types,d.message);assert.equal(nextWalletRole(p),'transaction');
 p.signatures.transaction=await keys[0].signTypedData(d.domain,d.types,d.message);assert.equal(nextWalletRole(p),'execute');
 const encoded=encodeWalletProposal(p);assert.match(encoded,/^[A-Za-z0-9_-]+$/);const decoded=decodeWalletProposal(encoded);
 assert.deepEqual(decoded,p);assert.equal(walletDigest(decoded),walletDigest(p));for(const r of ['transaction','notary'])verifyWalletEOA(decoded,r,decoded.signatures[r]);
 const url=new URL(walletProposalLink('https://example.org/client.html?container=4.2.204&tx=old&token=SECRET#contract/open',p));
 assert.equal(url.search,'?container=4.2.204');assert.ok(url.hash.startsWith('#wallet/sign?proposal='));assert.deepEqual(readWalletProposalLink(url.href),{proposal:p,role:'execute'});
 assert.deepEqual(readTabRoute(url.href),{product:'wallet',tab:'sign'});
 p.signatures.notary='0x';assert.equal(nextWalletRole(p),'notary');assert.equal(readWalletProposalLink(walletProposalLink(url.href,p)).role,'notary');
});
test('untrusted URLs reject malformed, oversized, duplicate and unknown payloads',()=>{
 for(const encoded of ['', 'A', '%%%','e30=', 'a'.repeat(MAX_WALLET_LINK_DATA+1),btoa('{}')])assert.throws(()=>decodeWalletProposal(encoded));
 const base=walletProposalLink('https://example.org/',proposal());
 assert.throws(()=>readWalletProposalLink(base+'&proposal=abcd'));assert.throws(()=>readWalletProposalLink(base+'&role=notary'));assert.throws(()=>readWalletProposalLink(base.replace('role=transaction','role=admin')));
 const credentials=new URL('https://example.org/');credentials.username='example';credentials.password='test';
 for(const base of ['javascript:alert(1)','data:text/html,hi',credentials.href,'file:///client.html'])assert.throws(()=>walletProposalLink(base,proposal()));
 assert.equal(readWalletProposalLink('https://example.org/#wallet/sign'),null);
});
test('transport encoding cannot legitimize tampered signed transfer details',async()=>{
 const p=proposal(),d=walletTypedData(p);p.signatures.transaction=await keys[0].signTypedData(d.domain,d.types,d.message);p.message.amount='1';
 const decoded=readWalletProposalLink(walletProposalLink('https://example.org/',p)).proposal;assert.throws(()=>verifyWalletEOA(decoded,'transaction',decoded.signatures.transaction));
});
test('hash navigation preserves an incoming proposal until leaving the signing tab',()=>{
 const original=globalThis.window,href=walletProposalLink('https://example.org/?container=4.2.204',proposal());let writes=0;
 globalThis.window={location:{href},history:{replaceState(_a,_b,next){writes++;globalThis.window.location.href=next;},pushState(_a,_b,next){writes++;globalThis.window.location.href=next;}}};
 try{writeTabRoute('wallet','sign',{replace:true});assert.equal(writes,0);writeTabRoute('wallet','transfer');assert.equal(new URL(window.location.href).hash,'#wallet/transfer');assert.equal(new URL(window.location.href).search,'?container=4.2.204');}finally{globalThis.window=original;}
});
test('OKLink destinations bind the selected chain and validated address',()=>{
 assert.equal(walletExplorerUrl('56',policy.wallet),'https://www.oklink.com/bsc/address/'+policy.wallet);
 assert.equal(walletExplorerUrl('196',policy.wallet),'https://www.oklink.com/x-layer/address/'+policy.wallet);
 assert.equal(walletExplorerUrl('31337',policy.wallet),null);assert.throws(()=>walletExplorerUrl('56','javascript:alert(1)'));
 assert.equal(nativeWalletSymbol('56'),'BNB');assert.equal(nativeWalletSymbol('196'),'OKB');
});
