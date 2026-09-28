import {toUtf8String,decodeBase64} from 'ethers';
import {currentContainer,requireCurrentContainer} from './current-container.js';
import {prepareNotary,retainNotary,notaryTransactions,pendingNotary,publishNotary,finishNotary,recoverNotary,discardUnsentNotary,recheckNotary,recentNotaries,syncNotarySubmissions} from './notary-client.js';
import {describeContent,validateNotary,verifyContent,notaryRow} from './notary-protocol.js';
import {auditNotary,queryNotaries,notaryKey} from './notary-index.js';
import {loadNotarization} from './notary-reader.js';
import {cacheRequest} from './cache-client.js';
import {config,context} from './rpc.js';
import {submissionRow,notaryStatusText} from './notary-status.js';
import {anchor} from './protocol.js';
const $=id=>document.getElementById(id);
export function setupNotary(){
 $('notary-workspace').innerHTML=[
 '<section class="hero"><div><div class="eyebrow">YOUR CONTENT. YOUR ON-CHAIN DECLARATION.</div><h1>为你的内容，<br><em>留下链上凭据。</em></h1><p>一段文字，一张原图。用容器身份宣誓归属，公开或仅存哈希。</p></div><div class="hero-note"><span class="note-number">TAPESIGN / NOTARY</span><div>唯一编号 · 原件指纹 · 独立核验</div><small>记录容器持有人的归属声明与链上时间。</small></div></section>',
 '<nav class="tabs notary-tabs" aria-label="链上公证"><button data-notary-tab="create" class="active">内容公证</button><button data-notary-tab="search">内容公开查询</button><button data-notary-tab="public">公证公开</button></nav>',
 '<p id="notary-status" class="status" role="status">选择透明或非透明方式，签署内容归属声明。</p>',
 '<section id="notary-create" class="card"><div class="section-head"><h2>公证你的内容</h2><span class="badge" data-current-container></span></div>',
 '<div class="notary-form-row"><div><label for="notary-kind">内容类型</label><select id="notary-kind"><option value="text">一段文字</option><option value="image">一张图片</option></select></div><div><label for="notary-visibility">公开方式</label><select id="notary-visibility"><option value="public">透明公证 · 原件与哈希公开上链</option><option value="private">非透明公证 · 仅内容哈希上链</option></select></div></div>',
 '<label id="notary-text-label" for="notary-text">公证文字</label><textarea id="notary-text" rows="8" placeholder="文字按原样计算 SHA-256，空格和换行也属于内容。"></textarea>',
 '<label id="notary-file-label" hidden>选择原图<input id="notary-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp"></label>',
 '<p class="hint">透明内容最大 1 MiB，分块保存原始字节，不压缩改图；大图可能需要多笔交易。非透明内容最大 20 MiB，原件不传缓存、不上链，请自行保管。</p>',
 '<label class="consent-check"><input id="notary-agree" type="checkbox"><span>我宣誓此内容属于顶部所选容器，并确认所选公开方式。编号、容器、哈希、类型和链上时间均公开；透明模式还公开完整原件。</span></label>',
 '<p class="hint">先由 RPC 缓存查重，提交后标记“链上未核验”，服务器后台核验链上内容和重复声明。缓存查重仅覆盖已收录记录。</p><button id="notary-submit" class="button primary">核对内容并公证</button><pre id="notary-plan" class="mono"></pre>',
 '<div id="notary-resume" hidden><p id="notary-pending" class="hint"></p><button id="notary-continue" class="button primary">继续提交公证</button><button id="notary-discard" class="button secondary">取消未发送草稿</button><div class="input-row"><input id="notary-recover-hash" placeholder="钱包未返回结果时，粘贴钱包活动中的交易哈希"><button id="notary-recover" class="button secondary">核对并恢复</button></div></div></section>',
 '<section id="notary-search" class="card" hidden><h2>查找相同内容的公证</h2><p class="hint">在本机计算原文 / 原图的 SHA-256，只用哈希查询；不会把查询原件发给缓存。</p><label for="notary-query-kind">查询类型</label><select id="notary-query-kind"><option value="text">文字</option><option value="image">图片</option></select><textarea id="notary-query-text" rows="5" placeholder="粘贴需要查询的原文"></textarea><input id="notary-query-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden><button id="notary-query" class="button primary">计算哈希并查询</button><p id="notary-query-hash" class="mono"></p><p id="notary-query-result" role="status"></p></section>',
 '<section id="notary-public" class="card" hidden><div class="section-head"><h2>链上公证公开</h2><button id="notary-refresh" class="button secondary">刷新缓存</button></div><div class="notary-filters"><input id="notary-filter" placeholder="搜索公证编号、容器 ID、哈希或公开文字"><select id="notary-sort" aria-label="时间排序"><option value="desc">最新在前</option><option value="asc">最早在前</option></select><label class="consent-check"><input id="notary-mine" type="checkbox">只看我的公证</label></div></section>',
 '<section id="notary-results" hidden><p id="notary-audit" class="hint" role="status"></p><button id="notary-independent" class="button secondary">手动独立全链核验</button><div id="notary-cards" class="notary-grid"></div><div class="notary-pagination"><button id="notary-prev" class="button secondary">上一页</button><span id="notary-page"></span><button id="notary-next" class="button secondary">下一页</button></div></section>',
 '<section id="notary-detail" class="card" hidden><div class="section-head"><h2>公证详情</h2><button id="notary-detail-close" class="text-button">关闭</button></div><div id="notary-detail-content"></div></section>'
 ].join('');
 let active=false,tab='create',busy=false,page=1,searchHash='',audit=null,auditing=false,controller=null,timer,cacheEpoch=0,cachedPage=[],cachedTotal=0,cachedView='',cacheError='',lastLocation=null,cacheScans={};
 let pollController=null,polling=false,viewController=null,viewEpoch=0;
 const entries=new Map(),cardUrls=[],detailUrls=[];
 const note=(m,error=false)=>{$('notary-status').textContent=m;$('notary-status').classList.toggle('error',error);};
 function own(){document.querySelectorAll('[data-current-container]').forEach(el=>el.textContent=currentContainer().replace(/\.tape$/,'')||'请在顶部选择容器');}
 function controls(){
  for(const id of ['notary-submit','notary-continue','notary-query','notary-refresh','notary-recover','notary-discard'])$(id).disabled=busy;
  let p;try{p=pendingNotary();}catch{p={pending:{}};}
  $('notary-submit').disabled=busy||!!p;$('notary-resume').hidden=!p;
  $('notary-pending').textContent=p?(p.claim?.id||'待恢复记录')+' · 已提交 '+(p.chunks?.length||0)+' / '+(p.parts?.length||0)+' 个分块（链上待核验）'+(p.pending?.hash?' · 已保存交易 '+p.pending.hash:'')+(p.pending&&!p.pending.hash?' · 钱包结果未知，请核对交易哈希':''):'';
  $('notary-discard').disabled=busy||!!(p?.pending||p?.chunks?.length||p?.final);
  for(const id of ['notary-kind','notary-visibility','notary-text','notary-file','notary-agree'])$(id).disabled=busy||!!p;
  globalThis.dispatchEvent(new CustomEvent('tapesign:notary-busy',{detail:busy}));
 }
 async function action(fn){if(busy)return;busy=true;controls();try{await fn();}catch(e){note(Number(e.code)===4001?'已取消钱包操作，可继续当前公证。':e.message,true);}finally{busy=false;controls();}}
 function options(){return {hash:tab==='search'?searchHash:'',owner:tab==='public'&&$('notary-mine').checked?currentContainer():'',q:tab==='public'?$('notary-filter').value:'',sort:$('notary-sort').value,page,pageSize:12};}
 function fromBundle(bundle,verified=false,status={}){
  anchor(bundle.location);validateNotary(bundle.record,config.networks);const c=bundle.record.claim;let bytes=null;
  if(bundle.location.chainId!==c.owner.chainId||!/^\d+$/.test(bundle.block?.timestamp)||!Number.isSafeInteger(Number(bundle.block.timestamp)*1000))throw Error('缓存交易位置或时间无效');
  let cachedBytes=null;
  if(bundle.content){if(bundle.contentEncoding==='base64'){if(typeof bundle.content!=='string'||bundle.content.length>Math.ceil(c.size/3)*4)throw Error('缓存原件编码无效');cachedBytes=decodeBase64(bundle.content);}else{if(!Array.isArray(bundle.content)||bundle.content.length!==c.size||bundle.content.some(b=>!Number.isInteger(b)||b<0||b>255))throw Error('缓存原件编码无效');cachedBytes=Uint8Array.from(bundle.content);}}
  if(c.visibility==='public'){bytes=c.content.inline!==null?decodeBase64(c.content.inline):cachedBytes;if(bytes)verifyContent(c,bytes);}
  const row=notaryRow(bundle);if(bytes&&c.kind==='text')row.preview=toUtf8String(bytes);
  return {row,bundle,bytes,verified,status:verified?{...status,chain:bundle.finalized?'finalized':'verified'}:status};
 }
 function fromSubmission(submission,status={}){
  anchor(submission.location);validateNotary(submission.record,config.networks);const c=submission.record.claim;
  if(c.owner.chainId!==submission.location.chainId)throw Error('待核验公证链不符');
  const row=submissionRow(submission),bytes=c.visibility==='public'&&c.content.inline!==null?decodeBase64(c.content.inline):null;
  if(bytes){verifyContent(c,bytes);if(c.kind==='text')row.preview=toUtf8String(bytes);}
  return {row,submission,bytes,verified:false,status:{chain:'pending',cache:submission.cacheCheck?.status||'unchecked',...status}};
 }
 function fromItem(item){return item.bundle?fromBundle(item.bundle,false,item.verification):item.submission?fromSubmission(item.submission,item.verification):null;}
 function statusText(entry){return notaryStatusText(entry.status,entry.verified);}
 function remember(entry){if(!entry)return;const k=notaryKey(entry.row.location),old=entries.get(k);if(old?.verified&&entry.status.chain!=='invalid'){old.status={...old.status,uniqueness:entry.status.uniqueness,conflicts:entry.status.conflicts};return;}if(!entry.bytes&&old?.bytes&&old.row.hash===entry.row.hash)entry.bytes=old.bytes;entries.set(k,entry);}
 function restoreLocal(){for(const s of recentNotaries()){if(s.record)try{const entry=fromSubmission(s);if(!entries.has(notaryKey(s.location)))entries.set(notaryKey(s.location),entry);}catch{}}}
 function releaseImages(list){for(const u of list)URL.revokeObjectURL(u);list.length=0;}
 function preview(el,entry,detail=false){const {row,bytes}=entry;
  if(row.visibility==='private'){const p=document.createElement('p');p.className='notary-private';p.textContent='非透明公证 · 仅存内容哈希';el.append(p);return;}
  if(!bytes){const p=document.createElement('p');p.textContent='透明原件正在由服务器回读，核验完成后自动展示';el.append(p);return;}
  if(row.kind==='image'){const img=document.createElement('img'),url=URL.createObjectURL(new Blob([bytes],{type:row.mime}));(detail?detailUrls:cardUrls).push(url);img.src=url;img.alt='公证原图';img.loading='lazy';img.className=detail?'notary-original':'notary-thumbnail';el.append(img);}
  else{const p=document.createElement('p');p.className='notary-text-preview';const text=toUtf8String(bytes);p.textContent=detail?text:Array.from(text).slice(0,100).join('')+(Array.from(text).length>100?'…':'');el.append(p);}
 }
 function render(){
  if(tab==='create')return;releaseImages(cardUrls);own();
  const opts=options(),local=queryNotaries([...entries.values()].filter(e=>!audit?.complete||e.verified).map(e=>e.row),opts),cacheMatches=cachedView===JSON.stringify(opts);
  const useCache=!audit?.complete&&cacheMatches&&!cacheError;
  const selected=useCache?cachedPage:local.rows,total=useCache?cachedTotal:local.total,pages=Math.max(1,Math.ceil(total/12));
  if(page>pages&&(audit?.complete||cacheMatches)){page=pages;void refreshCache();return;}
  $('notary-cards').replaceChildren();
  for(const row of selected){const entry=entries.get(notaryKey(row.location));if(!entry)continue;const card=document.createElement('article');card.className='card notary-record';card.dataset.notaryId=row.id;
   const badge=document.createElement('span');badge.className='badge';badge.textContent=statusText(entry);
   const title=document.createElement('h3');title.textContent=row.id;const owner=document.createElement('p');owner.textContent='声明容器 '+row.owner.replace(/\.tape$/,'');const date=document.createElement('p');date.className='hint';date.textContent=(entry.bundle?'链上时间 ':'声明时间（尚未链上核验） ')+new Date(row.timestamp).toLocaleString()+' · 链 '+row.location.chainId;
   card.append(badge,title,owner,date);preview(card,entry);const hash=document.createElement('p');hash.className='mono';hash.textContent='SHA-256 '+row.hash;const button=document.createElement('button');button.className='button secondary';button.textContent='查看公证详情';button.onclick=()=>{void showDetail(row.location);};card.append(hash,button);$('notary-cards').append(card);
  }
  $('notary-page').textContent='第 '+page+' / '+pages+' 页 · '+(audit?.complete?'独立核验快照':'目前可见')+' '+total+' 条';$('notary-prev').disabled=page<=1;$('notary-next').disabled=page>=pages;
  if(tab==='search')$('notary-query-result').textContent=!searchHash?'请先输入内容并查询。':total?'找到 '+total+' 条相同内容的归属声明，请查看各条链上核验状态。':audit?.complete?'截至手动核验快照，未发现相同 SHA-256 的有效公证。':'缓存尚未收录相同内容；服务器继续核验，不能据此断言全链没有公证。';
  const states=audit?.states||Object.entries(cacheScans).map(([chain,s])=>({chain,...s}));
  $('notary-audit').textContent=(audit?'手动独立核验快照。':'缓存优先展示，服务器后台核验。')+states.map(s=>' 链 '+s.chain+'：'+(s.checked||0)+'/'+(s.total||0)+(s.complete?'，已比对至区块 '+s.head.number:s.error?'，后台重试中':'，处理中')).join('；');
  if(cacheError)$('notary-audit').textContent+=' 缓存暂不可用，保留本机记录；可手动独立核验。';
 }
 async function refreshCache(){
  const epoch=++cacheEpoch,opts=options();viewController?.abort();viewController=new AbortController();
  try{const params=new URLSearchParams(Object.entries(opts).map(([k,v])=>[k,String(v)]));const result=await cacheRequest('/notary/list?'+params,{signal:viewController.signal});if(epoch!==cacheEpoch||!active)return;
   const candidates=[];for(const item of result.items||[]){try{const e=fromItem(item);if(e){remember(e);candidates.push(e.row);}}catch{}}
   cachedPage=queryNotaries(candidates,{...opts,page:1}).rows;cachedTotal=Number.isSafeInteger(result.total)&&result.total>=0?result.total:candidates.length;cachedView=JSON.stringify(opts);cacheError='';cacheScans=result.scans||{};
  }catch(e){if(epoch===cacheEpoch&&active){cachedPage=[];cachedTotal=0;cachedView=JSON.stringify(opts);cacheError=e.message;}}
  if(epoch===cacheEpoch&&active)render();
 }
 async function runAudit(){
  if(auditing){controller?.abort();return;}if(!active)return;auditing=true;controller=new AbortController();const signal=controller.signal;$('notary-independent').textContent='停止独立全链核验';
  const deadline=setTimeout(()=>controller?.abort(),120000);
  try{await auditNotary({signal,onUpdate:r=>{if(signal.aborted)return;audit=r;for(const s of r.states)for(const b of s.bundles||[])remember(fromBundle(b,true));render();}});}
  catch(e){if(e.name!=='AbortError')note('手动全链核验未完成：'+e.message,true);}finally{clearTimeout(deadline);auditing=false;$('notary-independent').textContent='手动独立全链核验';}
 }
 function drawDetail(entry){
  releaseImages(detailUrls);$('notary-detail').hidden=false;$('notary-detail-content').replaceChildren();
  if(!entry){const p=document.createElement('p');p.textContent='交易已提交，服务器正在后台读取；链上未核验。';$('notary-detail-content').append(p);}
  else{const badge=document.createElement('p');badge.className='badge';badge.textContent=statusText(entry);$('notary-detail-content').append(badge);preview($('notary-detail-content'),entry,true);
   const pre=document.createElement('pre');pre.className='mono';pre.textContent=JSON.stringify({...entry.row,verification:statusText(entry),verificationSource:entry.verified?'客户端独立核验':entry.bundle?'服务器报告':'签名声明预览',conflicts:entry.status.conflicts||[],retry:entry.status.chain==='retry'?'后台自动重试':undefined},null,2);$('notary-detail-content').append(pre);
   if(entry.bytes){const button=document.createElement('button');button.className='button secondary';button.textContent='保存哈希匹配的原件';button.onclick=()=>{const url=URL.createObjectURL(new Blob([entry.bytes],{type:entry.row.mime})),a=document.createElement('a');a.href=url;a.download=entry.row.id+(entry.row.kind==='text'?'.txt':{'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif'}[entry.row.mime]);a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};$('notary-detail-content').append(button);}
  }
  if(!lastLocation)return;const loc={...lastLocation},button=document.createElement('button');button.className='button secondary';button.textContent='手动独立核验这笔公证';button.onclick=()=>{void independentDetail(loc,button);};$('notary-detail-content').append(button);
  const url=new URL(window.location.href);url.search='';url.searchParams.set('view','notary');url.searchParams.set('chain',loc.chainId);url.searchParams.set('notary',loc.tx);const a=document.createElement('a');a.href=url.href;a.textContent='公证查询链接';$('notary-detail-content').append(a);
 }
 async function independentDetail(loc,button){
  button.disabled=true;button.textContent='正在独立核验…';const stop=new AbortController(),ctx=context(undefined,()=>{}, {signal:stop.signal});let deadline;
  try{const bundle=await Promise.race([loadNotarization(loc,ctx,{allowPending:true}),new Promise((_,reject)=>{deadline=setTimeout(()=>{stop.abort();reject(Error('独立核验超时，服务器仍在后台处理，可稍后重试。'));},60000);})]);remember(fromBundle(bundle,true));if(lastLocation&&notaryKey(lastLocation)===notaryKey(loc))drawDetail(entries.get(notaryKey(loc)));render();}
  catch(e){note(e.message,true);}finally{clearTimeout(deadline);stop.abort();button.disabled=false;button.textContent='手动独立核验这笔公证';}
 }
 async function loadDetailStatus(loc,signal){
  const result=await cacheRequest('/notary/transaction/'+loc.chainId+'/'+loc.tx,{signal});if(signal?.aborted||!active)return;
  const entry=fromItem(result);if(entry&&notaryKey(entry.row.location)!==notaryKey(loc))throw Error('缓存返回了其他公证交易');if(entry)remember(entry);
  else{const existing=entries.get(notaryKey(loc));if(existing)existing.status={...existing.status,...result.verification};}
  if(lastLocation&&notaryKey(lastLocation)===notaryKey(loc)&&!$('notary-detail').hidden){const current=entries.get(notaryKey(loc));drawDetail(current);if(current&&!busy&&!pendingNotary())note(statusText(current),current.status.chain==='invalid'||current.status.uniqueness==='conflict');}
 }
 async function showDetail(loc){
  try{anchor(loc);}catch(e){note(e.message,true);return;}lastLocation=loc;const epoch=++viewEpoch;drawDetail(entries.get(notaryKey(loc)));$('notary-detail').scrollIntoView({behavior:'smooth'});
  try{await loadDetailStatus(loc,pollController?.signal);}catch{if(epoch===viewEpoch)note('已显示本地预览；缓存暂不可用，稍后自动重试，链上状态尚未核验。');}
 }
 async function poll(){
  clearTimeout(timer);if(!active||polling)return;polling=true;pollController=new AbortController();
  try{if(!busy){const job=await recheckNotary();if(job?.final){finishNotary(job.final);restoreLocal();lastLocation=job.final;drawDetail(entries.get(notaryKey(job.final)));}controls();}
   await syncNotarySubmissions({signal:pollController.signal}).catch(()=>{});
   if(!active)return;await Promise.allSettled([tab==='create'?Promise.resolve():refreshCache(),lastLocation&&!$('notary-detail').hidden?loadDetailStatus(lastLocation,pollController.signal):Promise.resolve()]);
  }finally{polling=false;if(active)timer=setTimeout(()=>void poll(),10000);}
 }
 async function input(kindId,textId,fileId){const kind=$(kindId).value;if(kind==='text')return {kind,value:$(textId).value};const file=$(fileId).files[0];if(!file)throw Error('请选择图片');if(file.size>20971520)throw Error('文件最大 20 MiB');return {kind,value:new Uint8Array(await file.arrayBuffer())};}
 async function continuePublish(){
  const job=pendingNotary();if(job?.claim.owner.name!==requireCurrentContainer())throw Error('请在顶部选择该公证的原容器');
  const loc=await publishNotary(note),submitted=pendingNotary();finishNotary(loc);restoreLocal();
  const entry=entries.get(notaryKey(loc));if(entry&&submitted?.parts.length){const bytes=new Uint8Array(submitted.claim.size);let at=0;for(const part of submitted.parts){const b=decodeBase64(part);bytes.set(b,at);at+=b.length;}verifyContent(submitted.claim,bytes);entry.bytes=bytes;}
  lastLocation=loc;drawDetail(entry);note((entry?statusText(entry):'链上未核验')+'。交易已提交，无需重复发送；服务器在后台继续核验。');
  void syncNotarySubmissions().then(()=>{if(active){void loadDetailStatus(loc,pollController?.signal).catch(()=>{});void refreshCache();}}).catch(()=>{if(active&&!busy)note('交易已提交，通知缓存暂时失败；本机已保存任务并自动重试，链上未核验。');});
 }
 $('notary-submit').onclick=()=>action(async()=>{if(!$('notary-agree').checked)throw Error('请勾选内容归属声明');const name=requireCurrentContainer(),job=await prepareNotary({name,visibility:$('notary-visibility').value,...await input('notary-kind','notary-text','notary-file')});
  $('notary-plan').textContent=JSON.stringify({id:job.claim.id,container:name,visibility:job.claim.visibility,hash:job.claim.hash,size:job.claim.size,transactions:notaryTransactions(job)},null,2);
  if(!confirm('公证编号 '+job.claim.id+'\n容器 '+name.replace(/\.tape$/,'')+'\n'+(job.claim.visibility==='public'?'原件及哈希公开上链':'仅内容哈希上链，原件留在本机')+'\n需 '+notaryTransactions(job)+' 笔交易，逐笔由钱包确认 gas；链上核验在服务器后台进行。'))return;retainNotary(job);await continuePublish();});
 $('notary-continue').onclick=()=>action(continuePublish);$('notary-recover').onclick=()=>action(async()=>{await recoverNotary($('notary-recover-hash').value.trim());note('交易已匹配原公证，可继续。');});$('notary-discard').onclick=()=>action(async()=>{discardUnsentNotary();note('未发送草稿已取消。');});
 $('notary-kind').onchange=()=>{$('notary-text-label').hidden=$('notary-text').hidden=$('notary-kind').value!=='text';$('notary-file-label').hidden=$('notary-kind').value!=='image';};
 $('notary-query-kind').onchange=()=>{$('notary-query-text').hidden=$('notary-query-kind').value!=='text';$('notary-query-file').hidden=$('notary-query-kind').value!=='image';};
 $('notary-query').onclick=()=>action(async()=>{const v=await input('notary-query-kind','notary-query-text','notary-query-file');searchHash=describeContent(v.value,v.kind).hash;page=1;$('notary-query-hash').textContent=searchHash;await refreshCache();});
 function setTab(name){tab=name;page=1;for(const id of ['create','search','public'])$('notary-'+id).hidden=id!==name;document.querySelectorAll('[data-notary-tab]').forEach(b=>b.classList.toggle('active',b.dataset.notaryTab===name));$('notary-results').hidden=name==='create';if(name!=='create')void refreshCache();render();}
 document.querySelectorAll('[data-notary-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.notaryTab));
 for(const id of ['notary-filter','notary-sort','notary-mine'])$(id).onchange=()=>{if(id==='notary-mine'&&$('notary-mine').checked&&!currentContainer()){$('notary-mine').checked=false;note('请先在顶部选择容器',true);return;}page=1;void refreshCache();render();};
 $('notary-prev').onclick=()=>{page=Math.max(1,page-1);void refreshCache();render();};$('notary-next').onclick=()=>{page++;void refreshCache();render();};$('notary-refresh').onclick=()=>{audit=null;void refreshCache();};$('notary-independent').onclick=()=>void runAudit();$('notary-detail-close').onclick=()=>{$('notary-detail').hidden=true;lastLocation=null;viewEpoch++;};
 window.addEventListener('tapesign:container',()=>{own();page=1;if(active)void refreshCache();});window.addEventListener('tapesign:notary-progress',controls);
 window.addEventListener('storage',event=>{if(event.key?.startsWith('tapesign-v2:notary-')){controls();restoreLocal();if(active)void poll();}});
 try{const restored=pendingNotary();if(restored?.claim){$('notary-kind').value=restored.claim.kind;$('notary-visibility').value=restored.claim.visibility;$('notary-kind').onchange();$('notary-plan').textContent=JSON.stringify({id:restored.claim.id,container:restored.claim.owner.name,visibility:restored.claim.visibility,hash:restored.claim.hash,size:restored.claim.size,transactions:notaryTransactions(restored)},null,2);}restoreLocal();}catch{/* Preserve corrupted drafts for explicit recovery. */}
 own();controls();
 return {get busy(){return busy;},activate(value){active=value;if(active){own();controls();void poll();const q=new URLSearchParams(location.search);if(q.has('notary')&&!lastLocation)void showDetail({chainId:q.get('chain'),tx:q.get('notary')});}else{controller?.abort();pollController?.abort();viewController?.abort();cacheEpoch++;clearTimeout(timer);}}};
}
