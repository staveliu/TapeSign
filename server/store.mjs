import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
// Verified evidence is permanent; replaceable RPC objects have bounded retention.
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
  diskSpace(){const s=fs.statfsSync(this.root);return {freeBytes:s.bavail*s.bsize,freeInodes:s.files>0?s.ffree:null};}
  async pruneRpc({now=Date.now(),ttl=3600000,maxFiles=10000,maxBytes=64*1024*1024,minFreeBytes=256*1024*1024,minFreeInodes=4096}={}){
    const dir=path.join(this.root,'rpc'),items=[];let bytes=0,removed=0;
    const space=this.diskSpace(),pressure=space.freeBytes<minFreeBytes||(space.freeInodes!==null&&space.freeInodes<minFreeInodes);
    try{const stat=await fs.promises.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Invalid RPC cache directory');}
    catch(e){if(e.code==='ENOENT')return {files:0,bytes:0,removed:0,...space};throw e;}
    const entries=await fs.promises.readdir(dir,{withFileTypes:true});
    for(const entry of entries){
      if(!entry.isFile()||!(/^[a-f0-9]{64}[.]json(?:[.][a-f0-9-]+[.]tmp)?$/).test(entry.name))continue;
      const file=path.join(dir,entry.name);let stat;try{stat=await fs.promises.lstat(file);}catch(e){if(e.code==='ENOENT')continue;throw e;}
      if(!stat.isFile()||stat.isSymbolicLink())continue;
      if(entry.name.endsWith('.tmp')){if(now-stat.mtimeMs>60000){try{await fs.promises.unlink(file);removed++;}catch(e){if(e.code!=='ENOENT')throw e;}}continue;}
      items.push({file,size:stat.size,mtime:stat.mtimeMs});bytes+=stat.size;
    }
    items.sort((a,b)=>a.mtime-b.mtime);let files=items.length;
    for(const item of items){
      if(!pressure&&now-item.mtime<ttl&&files<=maxFiles&&bytes<=maxBytes)break;
      try{await fs.promises.unlink(item.file);removed++;}catch(e){if(e.code!=='ENOENT')throw e;}
      files--;bytes-=item.size;
    }
    return {files,bytes,removed,...this.diskSpace()};
  }
}
