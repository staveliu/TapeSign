import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
// Atomic files retain immutable RPC objects and verified evidence indefinitely.
export class Store {
  constructor(root){this.root=root;fs.mkdirSync(root,{recursive:true});}
  file(kind,key){return path.join(this.root,kind,createHash('sha256').update(key).digest('hex')+'.json');}
  get(kind,key){try{return JSON.parse(fs.readFileSync(this.file(kind,key),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  put(kind,key,value){
    const file=this.file(kind,key),dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true});
    const temp=file+'.'+randomUUID()+'.tmp';let fd;
    try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,file);
      if(process.platform!=='win32'){const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
    }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
  }
  all(kind){const dir=path.join(this.root,kind);if(!fs.existsSync(dir))return [];return fs.readdirSync(dir).filter(n=>/^[a-f0-9]{64}[.]json$/.test(n)).map(n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8')));}
}
