import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import solc from 'solc';
import {keccak256} from 'ethers';
const root=fileURLToPath(new URL('../',import.meta.url));
export function compileWallet(extra={}) {
 const name='contracts/TapeNotaryWallet.sol';
 const input={language:'Solidity',sources:{[name]:{content:fs.readFileSync(path.join(root,name),'utf8')},...extra},settings:{optimizer:{enabled:true,runs:200},evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']}}}};
 const output=JSON.parse(solc.compile(JSON.stringify(input),{import:p=>{try{return {contents:fs.readFileSync(path.join(root,'node_modules',p),'utf8')};}catch{return {error:'Missing import: '+p};}}}));
 const errors=(output.errors||[]).filter(e=>e.severity==='error');if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
 return output.contracts;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const c=compileWallet()['contracts/TapeNotaryWallet.sol'].TapeNotaryWallet;
 const artifact={contractName:'TapeNotaryWallet',compiler:solc.version(),evmVersion:'shanghai',abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,runtime:'0x'+c.evm.deployedBytecode.object,immutableReferences:c.evm.deployedBytecode.immutableReferences};
 artifact.bytecodeHash=keccak256(artifact.bytecode);fs.writeFileSync(path.join(root,'src/wallet-artifact.json'),JSON.stringify(artifact,null,2)+'\n');console.log('Wallet compiled:',artifact.compiler,'creation bytes:',(artifact.bytecode.length-2)/2);
}
