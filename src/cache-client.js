import { anchor, nameInfo } from './protocol.js';
import app from '../config/app.json' with {type:'json'};
export const CACHE_ORIGIN=app.cacheOrigin;
export function cacheBase(){
  if(typeof location==='undefined')return null;
  if(['127.0.0.1','localhost'].includes(location.hostname)&&(location.port==='18740'||import.meta.env?.DEV===true))return '/cache';
  return CACHE_ORIGIN || null;
}
export async function cacheRequest(path, options={}){
  const base=cacheBase();if(!base)throw Error('缓存不可用');
  const timeout=AbortSignal.timeout(6500),signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
  const res=await fetch(base+path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},signal,cache:'no-store'});
  if(!res.ok)throw Error('缓存暂不可用');return res.json();
}
export function notifyTransaction(value){
  let loc;try{loc=anchor({chainId:value.chainId,tx:value.tx});}catch{return;}
  void cacheRequest('/notify',{method:'POST',body:JSON.stringify(loc)}).catch(()=>{});
}
export async function cachedContract(value){
  const loc=anchor({chainId:value.chainId,tx:value.tx});
  return cacheRequest(`/transaction/${loc.chainId}/${loc.tx}`);
}
export async function cachedLatest(value){
  const loc=anchor({chainId:value.chainId,tx:value.tx});
  return cacheRequest(`/latest/${loc.chainId}/${loc.tx}`);
}
export async function cachedHistory(name){
  return cacheRequest('/contracts?container='+encodeURIComponent(nameInfo(name).name));
}
