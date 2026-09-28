import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import config from '../config/networks.json' with {type:'json'};
import {serverTransport} from './transport.mjs';
import {plan,preflight,fileStatus,transactionPlan} from './publication.mjs';
import {releaseId} from './release.mjs';
import {RPC_UNAVAILABLE,safeRpcMessage} from '../src/rpc-http.js';
const root=fileURLToPath(new URL('../',import.meta.url)),port=Number(process.env.TAPESIGN_DEV_PORT||18740),origin=`http://127.0.0.1:${port}`;
const net=await serverTransport();
const allowed=new Set(['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_getStorageAt','eth_call','eth_getLogs','eth_getTransactionReceipt','eth_getTransactionByHash']);
const server=await createServer({configFile:false,root,base:'/',publicDir:false,define:{__RELEASE__:JSON.stringify(releaseId(root))},server:{host:'127.0.0.1',port,strictPort:true,fs:{allow:[root]}},plugins:[{name:'tapesign-local-readonly',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  const url=new URL(req.url,origin);if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/rpc/')&&!url.pathname.startsWith('/cache/')&&url.pathname!=='/release.json')return next();
  function reply(code,value){res.statusCode=code;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));}
  try{
    if(req.headers.host!==`127.0.0.1:${port}`||(req.headers.origin&&req.headers.origin!==origin))return reply(403,{error:'Origin rejected'});
    if(url.pathname.startsWith('/cache/')){
      const route=url.pathname.slice(6);
      if(!['GET','POST'].includes(req.method)||!(/^\/(health|contracts|notify)$/.test(route)||/^\/(transaction|latest)\/(56|196)\/0x[0-9a-f]{64}$/.test(route)||/^\/notary\/(list|notify|check|submit)$/.test(route)||/^\/notary\/transaction\/(56|196)\/0x[0-9a-f]{64}$/.test(route)))return reply(400,{error:'Unknown cache route'});
      if(req.method==='POST'&&(!['/notify','/notary/notify','/notary/submit'].includes(route)||req.headers.origin!==origin))return reply(403,{error:'Same-origin notification required'});
      let body='';if(req.method==='POST')for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>(route==='/notary/submit'?40000:1024))return reply(413,{error:'Too large'});}
      const response=await net.cache(route+url.search,{method:req.method,...(body?{headers:{'Content-Type':'application/json'},data:body}:{})});
      return reply(response.status(),await response.json());
    }
    if(url.pathname.startsWith('/rpc/')){
      if(req.method!=='POST'||req.headers.origin!==origin)return reply(403,{error:'Same-origin POST required'});
      const match=/^\/rpc\/(56|196)\/(0|1)$/.exec(url.pathname);if(!match)throw Error('Unknown RPC route');
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100000)throw Error('Request too large');}
      const body=JSON.parse(raw);if(!allowed.has(body.method)||!Array.isArray(body.params))throw Error('Read-only RPC required');
      const n=config.networks.find(n=>String(n.chainId)===match[1]);return reply(200,await net.transport(n.rpcs[Number(match[2])],body));
    }
    if(req.method!=='GET')return reply(405,{error:'Read-only local API'});
    if(url.pathname==='/release.json')return reply(200,plan(root));
    if(url.pathname==='/api/release')return reply(200,plan(root));
    if(url.pathname==='/api/preflight')return reply(200,await preflight(net.transport));
    if(url.pathname==='/api/plan')return reply(200,await transactionPlan(root,net.transport));
    if(url.pathname==='/api/file-status')return reply(200,await fileStatus(root,net.transport,url.searchParams.get('name'),{finalized:url.searchParams.get('finalized')==='1',after:url.searchParams.get('after')}));
    reply(404,{error:'Unknown route'});
  }catch(e){reply(e.code===RPC_UNAVAILABLE?502:400,{code:e.code||'INVALID_REQUEST',error:safeRpcMessage(e.message)});}
});}}]});
await server.listen();console.log(`TapeSign: ${origin}/\nPublication: ${origin}/publish.html`);
process.on('SIGINT',async()=>{await server.close();await net.close();process.exit(0);});
