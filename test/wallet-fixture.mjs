import ganache from 'ganache';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {BrowserProvider,ContractFactory,Wallet} from 'ethers';
import {compileWallet} from '../scripts/compile-wallet.mjs';
export const mocks=String.raw`
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
contract TestCircuit {
 address public holder;
 constructor(address h){holder=h;}
 function ownerOf(uint256 id) external view returns(address){require(id==4);return holder;}
 function changeHolder(address h) external {holder=h;}
}
contract TestContainer {
 address private nft; uint256 private id; uint256 private chain;
 constructor(address n,uint256 i,uint256 c){nft=n;id=i;chain=c;}
 function token() external view returns(uint256,address,uint256){return(chain,nft,id);}
}
contract TestToken is ERC20 {
 constructor() ERC20("Local Test Token","TEST6"){_mint(msg.sender,1000000*10**6);}
 function decimals() public pure override returns(uint8){return 6;}
}
contract FalseToken {function transfer(address,uint256) external pure returns(bool){return false;}}
contract RejectEther {receive() external payable{revert();}}
contract Test1271 {
 address private signer; bool public enabled=true;
 constructor(address s){signer=s;}
 function setEnabled(bool e) external {enabled=e;}
 function isValidSignature(bytes32 h,bytes calldata sig) external view returns(bytes4){
  return enabled&&ECDSA.recover(h,sig)==signer?bytes4(0x1626ba7e):bytes4(0xffffffff);
 }
}
`;
let compiled;
export function walletCompilation(){return compiled||=compileWallet({'test/WalletMocks.sol':{content:mocks}});}
export async function walletFixture({chainId=31337,deployWallet=true}={}){
 const dbPath=fs.mkdtempSync(path.join(os.tmpdir(),'tapesign-wallet-test-'));
 const g=ganache.provider({database:{dbPath},chain:{chainId,hardfork:'shanghai'},wallet:{totalAccounts:6},logging:{quiet:true}});
 const provider=new BrowserProvider(g,undefined,{cacheTimeout:-1});provider.pollingInterval=25;
 const signers=await Promise.all(Array.from({length:6},(_,i)=>provider.getSigner(i)));
 const keys=Object.values(g.getInitialAccounts()).map(a=>new Wallet(a.secretKey));
 const compiled=walletCompilation(),source=compiled['test/WalletMocks.sol'];
 async function deploy(name,args=[],definition=source[name]){const c=await new ContractFactory(definition.abi,'0x'+definition.evm.bytecode.object,signers[0]).deploy(...args);await c.waitForDeployment();return c;}
 const circuit=await deploy('TestCircuit',[keys[1].address]);
 const container=await deploy('TestContainer',[circuit.target,4,chainId]);
 const token=await deploy('TestToken');
 const definition=compiled['contracts/TapeNotaryWallet.sol'].TapeNotaryWallet;
 const wallet=deployWallet?await deploy('TapeNotaryWallet',[circuit.target,4,container.target,keys[0].address,keys[1].address],definition):null;
 const policy={chainId:String(chainId),wallet:wallet?.target,name:'4.2.204.tape',circuit:circuit.target,circuitTokenId:'4',container:container.target,transactionSigner:keys[0].address,notarySigner:keys[1].address};
 return {g,provider,signers,keys,circuit,container,token,wallet,policy,definition,deploy,close:async()=>{provider.destroy();await g.disconnect();await fs.promises.rm(dbPath,{recursive:true,force:true,maxRetries:10,retryDelay:100});}};
}
