import test from 'node:test';
import assert from 'node:assert/strict';
import {clearWalletProposal,walletProposalGeneration,assertWalletProposalCurrent,walletProposalKey,walletProposalClearKey,walletProposalClearedAfter} from '../src/wallet-storage.js';

test('clearing a proposal preserves wallet data and rejects late saves without blocking new proposals',()=>{
 const previous=globalThis.localStorage,data=new Map([
  [walletProposalKey,'signed proposal'],['tapesign-wallet-v1:wallets','wallet addresses'],
  ['tapesign-wallet-v1:pending','unknown transaction'],['tapesign-wallet-v1:history','history'],
  ['tapesign-wallet-v1:share-base','https://example.org/'],['tapesign-v2:current-container','container'],['unrelated','keep']
 ]);
 globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};
 try{
  const generation=walletProposalGeneration(),before=Date.now(),original=new Map(data);assertWalletProposalCurrent(generation);
  clearWalletProposal();assert.equal(data.has(walletProposalKey),false);
  for(const [key,value]of original)if(key!==walletProposalKey)assert.equal(data.get(key),value);
  assert.equal(data.size,original.size);assert.ok(data.has(walletProposalClearKey));
  assert.throws(()=>assertWalletProposalCurrent(generation),e=>e.code==='WALLET_PROPOSAL_CLEARED');
  assertWalletProposalCurrent(walletProposalGeneration());
  assert.equal(walletProposalClearedAfter(before),true);assert.equal(walletProposalClearedAfter(Date.now()+10000),false);assert.equal(walletProposalClearedAfter(undefined),false);
 }finally{globalThis.localStorage=previous;}
});
