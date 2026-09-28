import {toUtf8String,decodeBase64} from 'ethers';
import {currentContainer,requireCurrentContainer} from './current-container.js';
import {prepareNotary,retainNotary,notaryTransactions,pendingNotary,publishNotary,finishNotary,recoverNotary,discardUnsentNotary,recheckNotary} from './notary-client.js';
import {describeContent,validateNotary,verifyContent,notaryRow} from './notary-protocol.js';
import {auditNotary,queryNotaries,notaryKey} from './notary-index.js';
import {loadNotarization} from './notary-reader.js';
import {cacheRequest} from './cache-client.js';
import {config} from './rpc.js';
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
 '<button id="notary-submit" class="button primary">核对内容并公证</button><pre id="notary-plan" class="mono"></pre>',
 '<div id="notary-resume" hidden><p id="notary-pending" class="hint"></p><button id="notary-continue" class="button primary">继续 / 核验已提交公证</button><button id="notary-discard" class="button secondary">取消未发送草稿</button><div class="input-row"><input id="notary-recover-hash" placeholder="钱包未返回结果时，粘贴钱包活动中的交易哈希"><button id="notary-recover" class="button secondary">核对并恢复</button></div></div></section>',
 '<section id="notary-search" class="card" hidden><h2>查找相同内容的公证</h2><p class="hint">在本机计算原文 / 原图的 SHA-256，只用哈希查询；不会把查询原件发给缓存。</p><label for="notary-query-kind">查询类型</label><select id="notary-query-kind"><option value="text">文字</option><option value="image">图片</option></select><textarea id="notary-query-text" rows="5" placeholder="粘贴需要查询的原文"></textarea><input id="notary-query-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden><button id="notary-query" class="button primary">计算哈希并查询</button><p id="notary-query-hash" class="mono"></p><p id="notary-query-result" role="status"></p></section>',
 '<section id="notary-public" class="card" hidden><div class="section-head"><h2>链上公证公开</h2><button id="notary-refresh" class="button secondary">立即全量比对</button></div><div class="notary-filters"><input id="notary-filter" placeholder="搜索公证编号、容器 ID、哈希或公开文字"><select id="notary-sort" aria-label="时间排序"><option value="desc">最新在前</option><option value="asc">最早在前</option></select><label class="consent-check"><input id="notary-mine" type="checkbox">只看我的公证</label></div></section>',
 '<section id="notary-results" hidden><p id="notary-audit" class="hint" role="status"></p><div id="notary-cards" class="notary-grid"></div><div class="notary-pagination"><button id="notary-prev" class="button secondary">上一页</button><span id="notary-page"></span><button id="notary-next" class="button secondary">下一页</button></div></section>',
 '<section id="notary-detail" class="card" hidden><div class="section-head"><h2>公证详情</h2><button id="notary-detail-close" class="text-button">关闭</button></div><div id="notary-detail-content"></div></section>'
 ].join('');
 let active=false,tab='create',busy=false,page=1,searchHash='',audit=null,auditing=false,controller=null,timer,cacheEpoch=0,cachedPage=[],cachedTotal=0,cachedView='',cacheError='',lastLocation=null;
 const entries=new Map(),cardUrls=[],detailUrls=[];
 let pendingTimer=null,pendingChecking=false;
 const note=(m,error=false)=>{$('notary-status').textContent=m;$('notary-status').classList.toggle('error',error);};
 function own(){document.querySelectorAll('[data-current-container]').forEach(el=>el.textContent=currentContainer().replace(/\.tape$/,'')||'请在顶部选择容器');}
 function controls(){
  for(const id of ['notary-submit','notary-continue','notary-query','notary-refresh','notary-recover','notary-discard'])$(id).disabled=busy;
  let p;try{p=pendingNotary();}catch{p={pending:{}};}
  $('notary-submit').disabled=busy||!!p;$('notary-resume').hidden=!p;
  $('notary-pending').textContent=p?(p.claim?.id||'待恢复记录')+' · 已核验 '+(p.chunks?.length||0)+' / '+(p.parts?.length||0)+' 个分块'+(p.pending?.hash?' · '+(p.pending.kind==='chunk'?'第 '+(p.pending.index+1)+' 块':'公证声明')+'交易已提交，待核验 '+p.pending.hash:'')+(p.pending&&!p.pending.hash?' · 钱包结果未知，请核对交易哈希':''):'';
  $('notary-discard').disabled=busy||!!(p?.pending||p?.chunks?.length||p?.final);
  for(const id of ['notary-kind','notary-visibility','notary-text','notary-file','notary-agree'])$(id).disabled=busy||!!p;
  globalThis.dispatchEvent(new CustomEvent('tapesign:notary-busy',{detail:busy}));
 }
 async function action(fn){if(busy)return;busy=true;controls();try{await fn();}catch(e){note(Number(e.code)===4001?'已取消钱包操作，可继续当前公证。':e.code==='RPC_DISAGREEMENT'?'两家 RPC 返回了不同的链上证据，已暂停核验并保留交易进度。稍后自动复查，无需重发。':e.message,true);}finally{busy=false;controls();schedulePending();}}
 function schedulePending(delay=10000){
  clearTimeout(pendingTimer);pendingTimer=null;
  if(!active)return;let job;try{job=pendingNotary();}catch{return;}
  if(!job?.pending?.hash&&!job?.final)return;
  pendingTimer=setTimeout(async()=>{
   if(!active)return;if(busy||pendingChecking){schedulePending();return;}
   pendingChecking=true;
   try{
    const result=await recheckNotary();
    if(!active||!result||busy)return;controls();
    if(result.final)await action(async()=>{await showDetail(result.final);finishNotary(result.final);void refreshCache();});
    else if(!result.pending)note('已核验 '+result.chunks.length+' / '+result.parts.length+' 个分块。点击“继续 / 核验已提交公证”完成剩余步骤；已提交分块不会重发。');
   }catch(e){if(active&&!busy)note(e.code==='RPC_DISAGREEMENT'?'节点证据暂不一致，保留交易并继续只读复查，不会重发。':'已提交交易仍在核验，10 秒后自动复查，无需重发。'+e.message);}
   finally{pendingChecking=false;if(active){controls();schedulePending();}}
  },delay);
 }
 function options(){return {hash:tab==='search'?searchHash:'',owner:tab==='public'&&$('notary-mine').checked?currentContainer():'',q:tab==='public'?$('notary-filter').value:'',sort:$('notary-sort').value,page,pageSize:12};}
 function fromBundle(bundle,verified=false){
  anchor(bundle.location);validateNotary(bundle.record,config.networks);const c=bundle.record.claim;let bytes=null;
  if(bundle.location.chainId!==c.owner.chainId||!/^\d+$/.test(bundle.block?.timestamp)||!Number.isSafeInteger(Number(bundle.block.timestamp)*1000))throw Error('缓存交易位置或时间无效');
  let cachedBytes=null;
  if(bundle.content){if(bundle.contentEncoding==='base64'){if(typeof bundle.content!=='string'||bundle.content.length>Math.ceil(c.size/3)*4)throw Error('缓存原件编码无效');cachedBytes=decodeBase64(bundle.content);}else{if(!Array.isArray(bundle.content)||bundle.content.length!==c.size||bundle.content.some(b=>!Number.isInteger(b)||b<0||b>255))throw Error('缓存原件编码无效');cachedBytes=Uint8Array.from(bundle.content);}}
  if(c.visibility==='public'){bytes=c.content.inline!==null?decodeBase64(c.content.inline):cachedBytes;if(bytes)verifyContent(c,bytes);}
  const row=notaryRow(bundle);if(bytes&&c.kind==='text')row.preview=toUtf8String(bytes);
  return {row,bundle,bytes,verified};
 }
 function releaseImages(list){for(const u of list)URL.revokeObjectURL(u);list.length=0;}
 function preview(el,entry,detail=false){const {row,bytes}=entry;
  if(row.visibility==='private'){const p=document.createElement('p');p.className='notary-private';p.textContent='非透明公证 · 仅存内容哈希';el.append(p);return;}
  if(!bytes){const p=document.createElement('p');p.textContent='透明内容 · 打开详情核验原件';el.append(p);return;}
  if(row.kind==='image'){const img=document.createElement('img'),url=URL.createObjectURL(new Blob([bytes],{type:row.mime}));(detail?detailUrls:cardUrls).push(url);img.src=url;img.alt='公证原图';img.loading='lazy';img.className=detail?'notary-original':'notary-thumbnail';el.append(img);}
  else{const p=document.createElement('p');p.className='notary-text-preview';const text=toUtf8String(bytes);p.textContent=detail?text:Array.from(text).slice(0,100).join('')+(Array.from(text).length>100?'…':'');el.append(p);}
 }
 function render(){
  if(tab==='create')return;releaseImages(cardUrls);own();
  const opts=options(),local=queryNotaries([...entries.values()].filter(e=>!audit?.complete||e.verified).map(e=>e.row),opts);
  const cacheMatches=cachedView===JSON.stringify(opts);
  // A server page has a global rank; mixing a partial local page into it breaks ordering.
  const useCache=!audit?.complete&&cacheMatches&&cachedTotal>0;
  const selected=useCache?cachedPage:local.rows;
  const total=useCache?cachedTotal:local.total,pages=Math.max(1,Math.ceil(total/12));
  if(page>pages&&(audit?.complete||cacheMatches)){page=pages;void refreshCache();return;}
  $('notary-cards').replaceChildren();
  for(const row of selected){const entry=entries.get(notaryKey(row.location));if(!entry)continue;const card=document.createElement('article');card.className='card notary-record';card.dataset.notaryId=row.id;
   const badge=document.createElement('span');badge.className='badge';badge.textContent=entry.verified?(entry.bundle.finalized?'链上核验通过 · 最终确认':'链上核验通过 · 待最终确认'):'缓存预览 · 待链上核验';
   const title=document.createElement('h3');title.textContent=row.id;const owner=document.createElement('p');owner.textContent='声明容器 '+row.owner.replace(/\.tape$/,'');const date=document.createElement('p');date.className='hint';date.textContent='链上时间 '+new Date(row.timestamp).toLocaleString()+' · 链 '+row.location.chainId;
   card.append(badge,title,owner,date);preview(card,entry);const hash=document.createElement('p');hash.className='mono';hash.textContent='SHA-256 '+row.hash;const button=document.createElement('button');button.className='button secondary';button.textContent='核验并查看详情';button.onclick=()=>action(()=>showDetail(row.location));card.append(hash,button);$('notary-cards').append(card);}
  $('notary-page').textContent='第 '+page+' / '+pages+' 页 · '+(audit?.complete?'已核验':'目前可见')+' '+total+' 条';$('notary-prev').disabled=page<=1;$('notary-next').disabled=page>=pages;
  if(tab==='search')$('notary-query-result').textContent=!searchHash?'请先输入内容并查询。':total?'找到 '+total+' 条相同内容的归属声明；可能有不同容器声明同一内容。':audit?.complete?'截至已核验区块，未发现相同 SHA-256 的有效公证。':'目前未查到，链上全量比对尚未完成，不能据此断言没有公证。';
  $('notary-audit').textContent=(audit?.states||[]).map(s=>'链 '+s.chain+'：'+(s.checked||0)+'/'+(s.total||0)+' 条信箱记录'+(s.complete?' · 已全量比对至区块 '+s.head.number:s.error?' · 未完成：'+s.error:' · 正在核验')).join('；')||'缓存先展示，客户端正在查询两条链的完整公证索引…';
  if(cacheError)$('notary-audit').textContent+='；缓存暂不可用，继续直接核验链上记录。';
 }
 async function refreshCache(){
  const epoch=++cacheEpoch,opts=options();try{const params=new URLSearchParams(Object.entries(opts).map(([k,v])=>[k,String(v)]));const result=await cacheRequest('/notary/list?'+params);if(epoch!==cacheEpoch)return;
   const candidates=[];for(const item of result.items||[]){try{const e=fromBundle(item.bundle);const k=notaryKey(e.row.location);if(!entries.get(k)?.verified)entries.set(k,e);candidates.push(e.row);}catch{}}
   cachedPage=queryNotaries(candidates,{...opts,page:1}).rows;cachedTotal=Number.isSafeInteger(result.total)&&result.total>=0?result.total:candidates.length;cachedView=JSON.stringify(opts);cacheError='';
  }catch(e){if(epoch===cacheEpoch){cachedPage=[];cachedTotal=0;cachedView=JSON.stringify(opts);cacheError=e.message;}}if(epoch===cacheEpoch)render();
 }
 async function runAudit(){
  if(auditing||!active)return;auditing=true;controller=new AbortController();const signal=controller.signal;
  try{await auditNotary({signal,onUpdate:r=>{if(signal.aborted)return;audit=r;for(const s of r.states)for(const b of s.bundles||[]){const e=fromBundle(b,true);entries.set(notaryKey(e.row.location),e);}if(r.complete){const keys=new Set(r.states.flatMap(s=>(s.rows||[]).map(row=>notaryKey(row.location))));for(const k of entries.keys())if(!keys.has(k))entries.delete(k);}render();}});}
  catch(e){if(e.name!=='AbortError')note('全量比对未完成：'+e.message,true);}finally{auditing=false;if(active){clearTimeout(timer);timer=setTimeout(()=>{void refreshCache();void runAudit();},30000);}}
 }
 async function showDetail(location){
  note('正在独立核验公证交易、容器身份、钱包签名与原件哈希…');const bundle=await loadNotarization(location,undefined,{allowPending:true}),entry=fromBundle(bundle,true);entries.set(notaryKey(location),entry);lastLocation=location;
  releaseImages(detailUrls);$('notary-detail').hidden=false;$('notary-detail-content').replaceChildren();preview($('notary-detail-content'),entry,true);const pre=document.createElement('pre');pre.className='mono';pre.textContent=JSON.stringify({...entry.row,verification:bundle.finalized?'最终确认':'已打包，待最终确认'},null,2);$('notary-detail-content').append(pre);
  if(entry.bytes){const button=document.createElement('button');button.className='button secondary';button.textContent='保存已核验原件';button.onclick=()=>{const url=URL.createObjectURL(new Blob([entry.bytes],{type:entry.row.mime})),a=document.createElement('a');a.href=url;a.download=entry.row.id+(entry.row.kind==='text'?'.txt':{'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif'}[entry.row.mime]);a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};$('notary-detail-content').append(button);}
  note(bundle.finalized?'公证已通过独立链上核验并最终确认。':'公证内容已核验；链最终确认仍在进行。');$('notary-detail').scrollIntoView({behavior:'smooth'});
  const url=new URL(window.location.href);url.search='';url.searchParams.set('view','notary');url.searchParams.set('chain',location.chainId);url.searchParams.set('notary',location.tx);const a=document.createElement('a');a.href=url.href;a.textContent='公证查询链接';$('notary-detail-content').append(a);
 }
 async function input(kindId,textId,fileId){const kind=$(kindId).value;if(kind==='text')return {kind,value:$(textId).value};const file=$(fileId).files[0];if(!file)throw Error('请选择图片');if(file.size>20971520)throw Error('文件最大 20 MiB');return {kind,value:new Uint8Array(await file.arrayBuffer())};}
 async function continuePublish(){const job=pendingNotary();if(job?.claim.owner.name!==requireCurrentContainer())throw Error('请在顶部选择该公证的原容器');const location=await publishNotary(note);await showDetail(location);finishNotary(location);void refreshCache();void runAudit();}
 $('notary-submit').onclick=()=>action(async()=>{if(!$('notary-agree').checked)throw Error('请勾选内容归属声明');const name=requireCurrentContainer(),job=await prepareNotary({name,visibility:$('notary-visibility').value,...await input('notary-kind','notary-text','notary-file')});
  $('notary-plan').textContent=JSON.stringify({id:job.claim.id,container:name,visibility:job.claim.visibility,hash:job.claim.hash,size:job.claim.size,transactions:notaryTransactions(job)},null,2);
  if(!confirm('公证编号 '+job.claim.id+'\n容器 '+name.replace(/\.tape$/,'')+'\n'+(job.claim.visibility==='public'?'原件及哈希公开上链':'仅内容哈希上链，原件留在本机')+'\n需 '+notaryTransactions(job)+' 笔交易，逐笔由钱包确认 gas。'))return;retainNotary(job);await continuePublish();});
 $('notary-continue').onclick=()=>action(continuePublish);$('notary-recover').onclick=()=>action(async()=>{await recoverNotary($('notary-recover-hash').value.trim());note('交易已匹配原公证，可继续。');});$('notary-discard').onclick=()=>action(async()=>{discardUnsentNotary();note('未发送草稿已取消。');});
 $('notary-kind').onchange=()=>{$('notary-text-label').hidden=$('notary-text').hidden=$('notary-kind').value!=='text';$('notary-file-label').hidden=$('notary-kind').value!=='image';};
 $('notary-query-kind').onchange=()=>{$('notary-query-text').hidden=$('notary-query-kind').value!=='text';$('notary-query-file').hidden=$('notary-query-kind').value!=='image';};
 $('notary-query').onclick=()=>action(async()=>{const v=await input('notary-query-kind','notary-query-text','notary-query-file');searchHash=describeContent(v.value,v.kind).hash;page=1;$('notary-query-hash').textContent=searchHash;await refreshCache();void runAudit();});
 function setTab(name){tab=name;page=1;for(const id of ['create','search','public'])$('notary-'+id).hidden=id!==name;document.querySelectorAll('[data-notary-tab]').forEach(b=>b.classList.toggle('active',b.dataset.notaryTab===name));$('notary-results').hidden=name==='create';if(name!=='create'){void refreshCache();void runAudit();}render();}
 document.querySelectorAll('[data-notary-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.notaryTab));
 for(const id of ['notary-filter','notary-sort','notary-mine'])$(id).onchange=()=>{if(id==='notary-mine'&&$('notary-mine').checked&&!currentContainer()){$('notary-mine').checked=false;note('请先在顶部选择容器',true);return;}page=1;void refreshCache();render();};
 $('notary-prev').onclick=()=>{page=Math.max(1,page-1);void refreshCache();render();};$('notary-next').onclick=()=>{page++;void refreshCache();render();};$('notary-refresh').onclick=()=>{void refreshCache();void runAudit();};$('notary-detail-close').onclick=()=>{$('notary-detail').hidden=true;};
 window.addEventListener('tapesign:container',()=>{own();page=1;if(active)void refreshCache();});
 window.addEventListener('tapesign:notary-progress',controls);
 window.addEventListener('storage',event=>{if(event.key==='tapesign-v2:notary-pending'){controls();schedulePending();}});
 try{const restored=pendingNotary();if(restored?.claim){$('notary-kind').value=restored.claim.kind;$('notary-visibility').value=restored.claim.visibility;$('notary-kind').onchange();$('notary-plan').textContent=JSON.stringify({id:restored.claim.id,container:restored.claim.owner.name,visibility:restored.claim.visibility,hash:restored.claim.hash,size:restored.claim.size,transactions:notaryTransactions(restored)},null,2);}}catch{/* Existing corrupted drafts remain blocked for recovery. */}
 own();controls();
 return {get busy(){return busy;},activate(value){active=value;if(active){own();controls();schedulePending(0);void refreshCache();void runAudit();const q=new URLSearchParams(location.search);if(q.has('notary')&&!lastLocation)void action(()=>showDetail({chainId:q.get('chain'),tx:q.get('notary')}));}else{controller?.abort();clearTimeout(timer);clearTimeout(pendingTimer);}}};
}
