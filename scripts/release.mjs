import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const sha256=bytes=>'0x'+createHash('sha256').update(bytes).digest('hex');
export function releaseId(root){
  const entries=[];
  function walk(dir){for(const name of fs.readdirSync(path.join(root,dir)).sort()){const relative=path.posix.join(dir,name),file=path.join(root,relative);if(fs.statSync(file).isDirectory())walk(relative);else entries.push([relative,sha256(fs.readFileSync(file))]);}}
  walk('src');walk('config');walk('scripts');
  if(fs.existsSync(path.join(root,'contracts')))walk('contracts');
  for(const file of ['index.html','package.json','package-lock.json'])entries.push([file,sha256(fs.readFileSync(path.join(root,file)))]);
  return sha256(JSON.stringify(entries));
}
