import test from 'node:test';
import assert from 'node:assert/strict';
import {ZeroAddress,parseEther,TypedDataEncoder,Wallet,Interface} from 'ethers';
import {walletFixture,walletCompilation} from './wallet-fixture.mjs';
import artifact from '../src/wallet-artifact.json' with {type:'json'};
import {newWalletProposal,walletTypedData,walletDigest,exactAmount,validateWalletProposal,verifyWalletEOA,mergeWalletProposals} from '../src/wallet-protocol.js';

test('wallet proposal protocol: exact amounts, strict fields, independent domains and merge',async()=>{
 const addresses=Array.from({length:6},()=>Wallet.createRandom());
 const policy={chainId:'196',wallet:addresses[2].address,name:'4.2.204.tape',circuit:addresses[3].address,circuitTokenId:'4',container:addresses[4].address,transactionSigner:addresses[0].address,notarySigner:addresses[1].address};
 assert.equal(exactAmount('9007199254740993.123456',6),'9007199254740993123456');
 assert.equal(exactAmount('0.000000000000000001',18),'1');
 for(const value of ['1e3','-1','0','1,000','NaN','1.0000001','1a2'])assert.throws(()=>exactAmount(value,6));
 const p=newWalletProposal(policy,'Transfer','1',{recipient:addresses[5].address,amount:'5'});
 const d=walletTypedData(p),sig=await addresses[0].signTypedData(d.domain,d.types,d.message);
 verifyWalletEOA(p,'transaction',sig);assert.throws(()=>verifyWalletEOA(p,'notary',sig));
 for(const changed of [{...p,message:{...p.message,amount:'6'}},{...p,message:{...p.message,recipient:addresses[0].address}},{...p,policy:{...policy,wallet:addresses[0].address}},{...p,policy:{...policy,chainId:'31337'}}])assert.throws(()=>verifyWalletEOA(changed,'transaction',sig));
 for(const changed of [{...p,extra:true},{...p,message:{...p.message,nonce:1}},{...p,message:{...p.message,nonce:'01'}},{...p,message:{...p.message,amount:'0'}},{...p,policy:{...policy,name:'4.2.205.tape',circuitTokenId:'5'}},{...p,policy:{...policy,transactionSigner:policy.notarySigner}},{...p,policy:{...policy,chainId:'56'}},{...p,signatures:{...p.signatures,notary:'0xz'}}])assert.throws(()=>validateWalletProposal(changed));
 const a={...p,signatures:{...p.signatures,transaction:sig}},b={...p,policy:Object.fromEntries(Object.entries(policy).reverse()),signatures:{...p.signatures,notary:await addresses[1].signTypedData(d.domain,d.types,d.message)}};
 const merged=mergeWalletProposals(a,b);verifyWalletEOA(merged,'transaction',merged.signatures.transaction);verifyWalletEOA(merged,'notary',merged.signatures.notary);
 assert.throws(()=>mergeWalletProposals(a,{...b,message:{...b.message,amount:'7'}}));
});

test('real EVM wallet lifecycle and authorization attacks',{timeout:120000},async t=>{
 const f=await walletFixture(),{wallet:w,policy,keys,signers,provider}=f;
 const make=async(action,options={})=>newWalletProposal(policy,action,(await w.nonce()).toString(),{now:Number((await provider.getBlock('latest')).timestamp),...options});
 const sign=async(p,first=keys[0],second=keys[1])=>{const d=walletTypedData(p);return [await first.signTypedData(d.domain,d.types,d.message),await second.signTypedData(d.domain,d.types,d.message)];};
 const execute=async p=>{const [a,b]=await sign(p);return (await w.execute(p.message,a,b)).wait();};
 try{
  await t.test('artifact rebuild exactly matches deployment and runtime',async()=>{
   const c=walletCompilation()['contracts/TapeNotaryWallet.sol'].TapeNotaryWallet;
   assert.equal(artifact.bytecode,'0x'+c.evm.bytecode.object);assert.equal(artifact.runtime,await provider.getCode(w.target));assert.deepEqual(c.evm.deployedBytecode.immutableReferences,{});
  });
  await t.test('constructor rejects same signer and mismatched container token',async()=>{
   await assert.rejects(f.deploy('TapeNotaryWallet',[f.circuit.target,4,f.container.target,keys[1].address,keys[1].address],f.definition));
   const wrong=await f.deploy('TestContainer',[f.circuit.target,4,56]);
   await assert.rejects(f.deploy('TapeNotaryWallet',[f.circuit.target,4,wrong.target,keys[0].address,keys[1].address],f.definition));
  });
  await t.test('activation requires two distinct signatures and signed binding matches Solidity',async()=>{
   const p=await make('Bind'),[a,b]=await sign(p);assert.equal(walletDigest(p),await w.bindingDigest(p.message.nonce,p.message.deadline));
   await assert.rejects(w.activate.staticCall(p.message.nonce,p.message.deadline,a,'0x'));
   await assert.rejects(w.activate.staticCall(p.message.nonce,p.message.deadline,a,a));
   const transfer=await make('Transfer',{recipient:keys[2].address,amount:'1'}),s=await sign(transfer);
   await assert.rejects(w.execute.staticCall(transfer.message,...s));
   await (await w.activate(p.message.nonce,p.message.deadline,a,b)).wait();assert.equal(await w.active(),true);assert.equal(await w.nonce(),1n);
   await assert.rejects(w.activate.staticCall(p.message.nonce,p.message.deadline,a,b));
  });
  await (await signers[0].sendTransaction({to:w.target,value:parseEther('2')})).wait();
  await t.test('missing signatures, tampered recipient/amount, wrong domain and swapped roles fail',async()=>{
   const p=await make('Transfer',{recipient:keys[2].address,amount:parseEther('0.2').toString()}),[a,b]=await sign(p);
   assert.equal(walletDigest(p),await w.transferDigest(p.message));
   for(const signatures of [[a,'0x'],['0x',b],[a,a],[b,a]])await assert.rejects(w.execute.staticCall(p.message,...signatures));
   for(const patch of [{amount:'1'},{recipient:keys[3].address},{asset:f.token.target},{nonce:'99'},{policyVersion:'2'},{deadline:'1'}])await assert.rejects(w.execute.staticCall({...p.message,...patch},a,b));
   for(const domain of [{chainId:'56'},{verifyingContract:f.container.target}]){const d=walletTypedData(p),wrong={...d.domain,...domain};await assert.rejects(w.execute.staticCall(p.message,await keys[0].signTypedData(wrong,d.types,d.message),await keys[1].signTypedData(wrong,d.types,d.message)));}
  });
  await t.test('native transfer changes balance once and emits signed digest; replay rejected',async()=>{
   const p=await make('Transfer',{recipient:keys[2].address,amount:parseEther('0.2').toString()}),before=await provider.getBalance(keys[2].address),receipt=await execute(p);
   assert.equal(await provider.getBalance(keys[2].address)-before,parseEther('0.2'));
   const event=receipt.logs.map(l=>{try{return w.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='TransferExecuted');assert.equal(event.args.digest,walletDigest(p));
   await assert.rejects(w.execute.staticCall(p.message,...await sign(p)));
  });
  await t.test('ERC20 exact units transfer requires both signers',async()=>{
   await (await f.token.transfer(w.target,10000000n)).wait();const p=await make('Transfer',{asset:f.token.target,recipient:keys[2].address,amount:exactAmount('1.234567',6)});
   await execute(p);assert.equal(await f.token.balanceOf(keys[2].address),1234567n);assert.equal(await f.token.allowance(w.target,keys[0].address),0n);
  });
  await t.test('expiry, far-future expiry, false-return token and rejecting receiver cannot spend nonce',async()=>{
   const before=await w.nonce();for(const deadline of ['1',String(Number((await provider.getBlock('latest')).timestamp)+8*86400)]){const p=await make('Transfer',{recipient:keys[2].address,amount:'1'});p.message.deadline=deadline;await assert.rejects(w.execute.staticCall(p.message,...await sign(p)));}
   const bad=await f.deploy('FalseToken'),reject=await f.deploy('RejectEther');
   for(const options of [{asset:bad.target,recipient:keys[2].address},{recipient:reject.target},{asset:keys[3].address,recipient:keys[2].address}]){const p=await make('Transfer',{...options,amount:'1'});await assert.rejects(w.execute.staticCall(p.message,...await sign(p)));}
   assert.equal(await w.nonce(),before);
  });
  await t.test('cancel invalidates outstanding signatures; outsiders cannot cancel or pause',async()=>{
   const p=await make('Transfer',{recipient:keys[2].address,amount:'1'});await assert.rejects(w.connect(signers[2]).cancel.staticCall(await w.nonce()));await assert.rejects(w.connect(signers[2]).pause.staticCall());
   await (await w.connect(signers[1]).cancel(await w.nonce())).wait();await assert.rejects(w.execute.staticCall(p.message,...await sign(p)));
  });
  await t.test('pause blocks transfers and resume requires dual signatures',async()=>{
   await (await w.pause()).wait();assert.equal(await w.paused(),true);const p=await make('Transfer',{recipient:keys[2].address,amount:'1'});await assert.rejects(w.execute.staticCall(p.message,...await sign(p)));
   const resume=await make('Resume'),[a,b]=await sign(resume);await assert.rejects(w.resume.staticCall(resume.message.nonce,resume.message.deadline,a,'0x'));await (await w.resume(resume.message.nonce,resume.message.deadline,a,b)).wait();assert.equal(await w.paused(),false);
  });
  await t.test('NFT transfer cannot replace signer; return restores original eligibility',async()=>{
   const p=await make('Transfer',{recipient:keys[2].address,amount:'1'}),s=await sign(p);await (await f.circuit.changeHolder(keys[3].address)).wait();await assert.rejects(w.execute.staticCall(p.message,...s));await assert.rejects(w.execute.staticCall(p.message,...await sign(p,keys[0],keys[3])));await (await f.circuit.changeHolder(keys[1].address)).wait();await execute(p);
  });
  await t.test('only fixed transfer methods exist; unsigned arbitrary calls cannot execute',async()=>{
   assert.equal(w.interface.getFunction('approve'),null);assert.equal(w.interface.getFunction('executeBatch'),null);assert.equal(w.interface.getFunction('upgradeTo'),null);
   const raw=new Interface(['function approve(address,uint256)']);await assert.rejects(provider.call({to:w.target,data:raw.encodeFunctionData('approve',[keys[2].address,100])}));
  });
  await t.test('ERC1271 contract signer checked at execution time, revocation blocks signature',async()=>{
   const owner=await f.deploy('Test1271',[keys[1].address]);await (await f.circuit.changeHolder(owner.target)).wait();const other=await f.deploy('TapeNotaryWallet',[f.circuit.target,4,f.container.target,keys[0].address,owner.target],f.definition);
   const p=newWalletProposal({...policy,wallet:other.target,notarySigner:owner.target},'Bind','0'),[a,b]=await sign(p);
   await (await owner.setEnabled(false)).wait();await assert.rejects(other.activate.staticCall('0',p.message.deadline,a,b));await (await owner.setEnabled(true)).wait();await (await other.activate('0',p.message.deadline,a,b)).wait();assert.equal(await other.active(),true);
  });
 }finally{await f.close();}
});
