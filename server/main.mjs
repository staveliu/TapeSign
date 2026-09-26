import http from 'node:http';
import {isIP} from 'node:net';
import {Store} from './store.mjs';
import {ContractCache} from './service.mjs';
import {config} from '../src/rpc.js';
import {withRpcFallback} from '../src/vendor/rpc-fallback.js';
import {readRpcResponse} from '../src/rpc-http.js';
const upstream=withRpcFallback(config.networks,async(url,body)=>readRpcResponse(await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(7000)}),body.method));
const service=new ContractCache(new Store(process.env.TAPESIGN_CACHE_DIR||'/var/lib/tapesign-cache'),upstream);
const rate=new Map();
function allowed(ip){const now=Date.now(),r=rate.get(ip);if(!r||now-r.time>60000){rate.set(ip,{time:now,count:1});return true;}return ++r.count<=120;}
const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Private-Network','true');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const reply=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value));};
  if(req.method==='OPTIONS')return reply(204,{});
  const peer=req.socket.remoteAddress,forwarded=String(req.headers['x-forwarded-for']||'').split(',').at(-1).trim();
  const clientIp=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer)&&isIP(forwarded)?forwarded:peer;
  if(!allowed(clientIp))return reply(429,{error:'请求过多，请稍后重试'});
  try{const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&['/','/health'].includes(url.pathname))return reply(200,service.health());
    if(req.method==='GET'&&url.pathname==='/contracts')return reply(200,service.history(url.searchParams.get('container')||''));
    const parts=url.pathname.split('/');
    if(req.method==='GET'&&parts.length===4&&parts[1]==='transaction')return reply(200,service.transaction({chainId:parts[2],tx:parts[3]}));
    if(req.method==='GET'&&parts.length===4&&parts[1]==='latest')return reply(200,service.latest({chainId:parts[2],tx:parts[3]}));
    if(req.method==='POST'&&url.pathname==='/notify'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1024)return reply(413,{error:'请求过大'});}service.enqueue(JSON.parse(raw));return reply(202,{queued:true});}
    return reply(404,{error:'Unknown read-only route'});
  }catch{return reply(400,{error:'请求格式无效或队列已满'});}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(Number(process.env.PORT||18741),process.env.HOST||'127.0.0.1',()=>console.log('TapeSign cache ready'));
const timer=setInterval(()=>void service.tick(),5000);void service.tick();
// Verification of a notified transaction must not wait for long scan/watch RPCs.
const jobsTimer=setInterval(()=>void service.processJobs().catch(()=>{}),1000);
const watchTimer=setInterval(()=>void service.processWatchers().catch(()=>{}),5000);
const cleanup=setInterval(()=>{const now=Date.now();for(const[k,v]of rate)if(now-v.time>60000)rate.delete(k);},60000);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearInterval(timer);clearInterval(jobsTimer);clearInterval(watchTimer);clearInterval(cleanup);service.persist();server.close(()=>process.exit(0));});
