import fs from 'node:fs';
import {serverTransport} from './transport.mjs';
import {context} from '../src/rpc.js';
import {loadContract} from '../src/reader.js';
import {parseLink,anchor,canonical} from '../src/protocol.js';
const args=process.argv.slice(2).filter(a=>a!=='--proxy'),[value,chain]=args;
if(!value)throw Error('Usage: node scripts/verify.mjs <link | evidence.json | transactionHash> [196|56] [--proxy]');
let location;if(fs.existsSync(value)){const evidence=JSON.parse(fs.readFileSync(value,'utf8'));location=anchor(evidence.selected);}else if(value.startsWith('0x'))location=anchor({chainId:chain||'196',tx:value.toLowerCase()});else location=parseLink(value);
const net=await serverTransport();try{const result=await loadContract(location,context(net.transport,m=>console.error(m)));console.log(canonical({verified:true,id:result.id,title:result.doc.title,status:result.status,parties:result.doc.parties,selected:result.selected}));}finally{await net.close();}
