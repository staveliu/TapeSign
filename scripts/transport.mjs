import {request} from 'playwright';
import app from '../config/app.json' with {type:'json'};
import {withRpcFallback} from '../src/vendor/rpc-fallback.js';
import config from '../config/networks.json' with {type:'json'};
import { readRpcResponse, RPC_ENDPOINT_TIMEOUT_MS } from '../src/rpc-http.js';
export async function serverTransport(){
  const proxy=process.env.TAPE_RPC_PROXY||(process.argv.includes('--proxy')?'socks5://127.0.0.1:10808':null);
  const client=await request.newContext({...(proxy?{proxy:{server:proxy}}:{}),timeout:RPC_ENDPOINT_TIMEOUT_MS});
  const transport=withRpcFallback(config.networks,async(url,body)=>readRpcResponse(await client.post(url,{data:body}),body.method));
  const cacheOrigin=process.env.TAPESIGN_CACHE_ORIGIN || app.cacheOrigin;
  const cache=async(path,options={})=>{
    if(!cacheOrigin)throw Error('Optional cache is disabled; configure cacheOrigin in config/app.json');
    return client.fetch(cacheOrigin+path,{...options,timeout:5500});
  };
  return {transport,cache,close:()=>client.dispose()};
}
