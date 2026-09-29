import './style.css';
import { createDocument, publishOffer, publishAcceptance, publishSeal, resolveIdentity, connect, loadContract, syncIndex, exportBundle, release } from './client.js';
import { documentId, makeLink, parseLink, anchor, otherRole, HASH, nameInfo } from './protocol.js';
import { context, local } from './rpc.js';
import { setupEditor, readEditor, renderBody } from './editor.js';
import { SignaturePad, drawInk } from './signature.js';
import { readLocal, saveLocal, remember } from './storage.js';
import { canContinue } from './compatibility.js';
import { POLL_MS } from './confirmation.js';
import { setupContainerPicker } from './container-picker.js';
import { groupContracts, historyRow } from './history.js';
import { cachedContract, cachedLatest, cachedHistory, notifyTransaction } from './cache-client.js';
import { assertContains, followContract } from './contract-follow.js';
import { validatePreview } from './cache-preview.js';
import { config } from './rpc.js';
import {currentContainer,setCurrentContainer,requireCurrentContainer} from './current-container.js';
import {setupNotary} from './notary-ui.js';
import {setupWallet} from './wallet-ui.js';
import {readTabRoute,writeTabRoute} from './navigation.js';
const $=id=>document.getElementById(id), roleLabel=r=>r==='A'?'甲方':'乙方', short=n=>String(n||'').trim().replace(/\.tape$/i,'');
let busy=false,doc=null,bundle=null,mode=null,submitted=null,indexRows=[],draftTimer,confirmationTimer,refreshing=false,viewEpoch=0,historyTimer,historySyncing=false;
let following=false;
let activeProduct='contract',contractTab='create';
let notary=null,wallet=null;
function headerControls(){for(const id of ['choose-my-container','connect','product-contract','product-notary','product-wallet'])$(id).disabled=busy||Boolean(notary?.busy)||Boolean(wallet?.busy);}
const activeTab=()=>activeProduct==='notary'?notary.tab:activeProduct==='wallet'?wallet.tab:contractTab;
const directChecks=new Map(),historyChecks=new Map();
const pad=new SignaturePad($('signature'),$('sign-placeholder'));
function status(message,error=false){$('status').hidden=false;$('status').textContent=message;$('status').classList.toggle('error',error);$('status').classList.toggle('busy',busy&&!error);}
function controls(){
  document.querySelectorAll('#contract-workspace button').forEach(b=>b.disabled=busy);
  headerControls();
  for(const id of ['title','my-container','my-role','other-container','agree','open-value','open-chain','history-container'])$(id).disabled=busy;
  $('editor').contentEditable=busy?'false':'true';
  $('signature').style.pointerEvents=busy?'none':'auto';
  $('submit-sign').disabled=busy||!$('agree').checked;
}
async function action(fn){if(busy)return;viewEpoch++;busy=true;controls();try{await fn();}catch(e){status(e.code===4001?'已取消钱包操作。':e.message,true);}finally{busy=false;$('status').classList.remove('busy');controls();if(bundle&&!$('panel-open').hidden&&$('share-panel').hidden&&(!bundle.finalized||!bundle.seal))scheduleConfirmation(bundle.selected);}}
function stopConfirmation(){clearTimeout(confirmationTimer);confirmationTimer=null;}
function scheduleConfirmation(location){
  stopConfirmation();const epoch=viewEpoch;
  confirmationTimer=setTimeout(async()=>{
    confirmationTimer=null;if(epoch!==viewEpoch||$('panel-open').hidden)return;
    if(busy||refreshing||following){scheduleConfirmation(location);return;}
    refreshing=true;
    try{if(bundle?.finalized)await followCurrent(epoch);else await openContract(location,{refresh:true});}
    catch(e){if(epoch===viewEpoch)status(e.message+'。已暂停签署，请重新核验。',true);}
    finally{refreshing=false;if(epoch===viewEpoch){controls();if(bundle&&!$('panel-open').hidden&&(!bundle.finalized||!bundle.seal)&&!confirmationTimer)scheduleConfirmation(bundle.selected);}}
  },POLL_MS);
}
async function followCurrent(epoch){
  const current=bundle;if(!current||current.seal||following)return;following=true;
  const active=()=>epoch===viewEpoch&&bundle===current&&!busy&&!$('panel-open').hidden;
  try{
    const next=await followContract(current,{lookup:cachedLatest,isCurrent:active,
      load:location=>loadContract(location,context(),{allowPending:true,confirmation:'fast'}),
      discover:async b=>{
        const key=b.doc.contractId+'/'+b.status,last=directChecks.get(key)||0;
        if(Date.now()-last<60000)return {rows:[]};directChecks.set(key,Date.now());
        const sender=b.doc.parties[b.acceptance?b.doc.initiator:otherRole(b.doc.initiator)];
        const recipient=b.doc.parties[b.acceptance?otherRole(b.doc.initiator):b.doc.initiator];
        return syncIndex(recipient,{ctx:context(),chains:[sender.chainId],inboxOnly:true});
      }});
    if(!active())return;
    if(next.bundle!==current)renderContract(next.bundle,next.bundle.selected,{refresh:true,previous:current,oldMode:mode,preserve:true});
    else if(next.error)status('当前合同可阅读，后续签署状态尚未核验，后台继续重试。\n'+next.error.message);
  }finally{following=false;}
}
function pendingMessage(result){const progress=(result.confirmation||[]).map(c=>`链 ${c.chainId}：短确认 ${c.depth} / ${c.requiredDepth} 个后续区块${c.fresh?'':'，节点进度落后'}`).join('；');return '合同内容已核验并可阅读；正在等待短确认，暂不能签署或归档。\n'+progress+'\n每 10 秒自动复查，无需重新发送交易。';}
function tab(name,{write=true}={}){contractTab=name;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));for(const key of ['create','open','history'])$('panel-'+key).hidden=key!==name;if(write&&activeProduct==='contract')writeTabRoute('contract',name);}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{viewEpoch++;stopConfirmation();clearTimeout(historyTimer);tab(b.dataset.tab);if(b.dataset.tab==='history'){renderHistory();if($('history-container').value)void sync();}});
function draft(){clearTimeout(draftTimer);draftTimer=setTimeout(()=>{const ok=saveLocal('draft',{title:$('title').value,myName:$('my-container').value,otherName:$('other-container').value,role:$('my-role').value,body:readEditor($('editor'))});$('draft-state').textContent=ok?'草稿已保存到本机':'本机存储不可用，请保留正文';},400);invalidate();}
function invalidate(){if(mode==='create'){doc=null;mode=null;$('contract-view').hidden=true;$('sign-panel').hidden=true;}}
const editorValue=setupEditor($('editor'),$('toolbar'),$('body-count'),draft);
for(const id of ['my-container','other-container','history-container'])$(id).addEventListener('change',()=>{$(id).value=short($(id).value);});
for(const id of ['title','my-container','other-container','my-role'])$(id).addEventListener('input',draft);
$('my-role').addEventListener('change',()=>{$('other-role').textContent=roleLabel(otherRole($('my-role').value));});
const storedDraft=readLocal('draft');if(storedDraft){try{for(const [id,key]of [['title','title'],['my-container','myName'],['other-container','otherName'],['my-role','role']])$(id).value=storedDraft[key]||'';if(Array.isArray(storedDraft.body))renderBody(storedDraft.body,$('editor'));$('other-role').textContent=roleLabel(otherRole($('my-role').value));$('editor').dispatchEvent(new Event('input'));}catch{}}
$('sample').onclick=()=>{if($('editor').innerText.trim()&&!confirm('用示例替换当前正文？'))return;$('title').value='项目合作协议';renderBody([{type:'p',runs:[{text:'甲乙双方经友好协商，就以下合作事项达成一致：',marks:0}]},{type:'h2',runs:[{text:'一、合作内容',marks:1}]},{type:'p',runs:[{text:'请在此填写双方约定的工作内容、交付标准与履行期限。',marks:0}]},{type:'h2',runs:[{text:'二、费用与支付',marks:1}]},{type:'p',runs:[{text:'请填写合同金额、结算方式和支付时间。',marks:0}]},{type:'h2',runs:[{text:'三、其他约定',marks:1}]},{type:'p',runs:[{text:'本合同由双方签署。双方应按照约定履行各自义务。',marks:0}]}],$('editor'));$('editor').dispatchEvent(new Event('input'));};
let pickedOwn=null;
const picker=setupContainerPicker({connect,resolveIdentity,
  onWallet:address=>{$('connect').textContent=address.slice(0,6)+'…'+address.slice(-4);},
  onChoose:(identity,target)=>{const name=short(identity.name);pickedOwn=name;setCurrentContainer(identity.name);draft();
    status('已选择容器 '+name+'，当前持有人已核验。');},
  onChanged:()=>{$('connect').textContent='连接钱包';setCurrentContainer('');draft();pickedOwn=null;},
});
$('connect').onclick=()=>picker.open('my-container');
function sharedContainer(){
  const name=short(currentContainer());$('my-container').value=name;$('history-container').value=name;
  $('current-container-label').textContent=name?'当前容器 '+name:'请先选择容器';$('current-container-label').classList.toggle('missing',!name);
  document.querySelectorAll('[data-current-container]').forEach(el=>el.textContent=name||'请在顶部选择容器');
  saveLocal('history-container',name);indexRows=[];viewEpoch++;clearTimeout(historyTimer);invalidate();renderHistory();
}
window.addEventListener('tapesign:container',sharedContainer);
notary=setupNotary({onTabChange:name=>writeTabRoute('notary',name)});
wallet=setupWallet({onTabChange:name=>writeTabRoute('wallet',name)});
for(const event of ['tapesign:notary-busy','tapesign:wallet-busy'])window.addEventListener(event,headerControls);
function product(name,targetTab=null,{write=true}={}){
 if(busy||notary.busy||wallet.busy)return;activeProduct=name;
 for(const p of ['contract','notary','wallet']){$(p+'-workspace').hidden=p!==name;$('product-'+p).classList.toggle('active',p===name);}
 viewEpoch++;stopConfirmation();clearTimeout(historyTimer);
 if(targetTab){if(name==='notary')notary.setTab(targetTab,{notify:false});else if(name==='wallet')wallet.setTab(targetTab,{notify:false});else tab(targetTab,{write:false});}
 notary.activate(name==='notary');wallet.activate(name==='wallet');if(write)writeTabRoute(name,activeTab());
 if(name==='contract'&&bundle&&!$('panel-open').hidden)scheduleConfirmation(bundle.selected);
 if(name==='contract'&&contractTab==='history'){renderHistory();if($('history-container').value)void sync();}
}
for(const name of ['contract','notary','wallet'])$('product-'+name).onclick=()=>product(name);
function selectedParty(role){if(requireCurrentContainer()!==doc.parties[role].name)throw Error('请在顶部选择本次操作对应的容器 '+short(doc.parties[role].name));}
function paper(contract,signatures=[],state='发起前预览'){
  $('contract-view').hidden=false;$('contract-title').textContent=contract.title;$('contract-status').textContent=state;$('contract-id').textContent='合同编号 '+contract.contractId;renderBody(contract.body,$('contract-body'));
  $('contract-parties').replaceChildren();
  for(const role of ['A','B']){const p=contract.parties[role],el=document.createElement('div'),title=document.createElement('strong'),name=document.createElement('span'),holder=document.createElement('small');title.textContent=roleLabel(role)+(role===contract.initiator?' · 发起方':' · 签署方');name.textContent=short(p.name);holder.textContent='签署钱包 '+p.holder;el.append(title,name,holder);$('contract-parties').append(el);}
  $('existing-signatures').replaceChildren();
  for(const c of signatures){const box=document.createElement('div'),title=document.createElement('strong'),canvas=document.createElement('canvas'),info=document.createElement('small');box.className='signed-box';title.textContent=roleLabel(c.role)+' · 已签署';drawInk(canvas,c.ink);info.textContent='钱包签名 '+c.signature.slice(0,18)+'…';box.append(title,canvas,info);$('existing-signatures').append(box);}
}
function signing(role){pad.clear();$('agree').checked=false;$('sign-panel').hidden=false;$('sign-role').textContent=`你将作为${roleLabel(role)}签署：${short(doc.parties[role].name)}。请核对上方完整正文。`;$('submit-sign').textContent=mode==='create'?'确认签署并发起':'确认签署并回传';controls();}
$('review').onclick=()=>action(async()=>{
  stopConfirmation();
  const input={title:$('title').value,body:editorValue(),myName:requireCurrentContainer(),otherName:$('other-container').value,role:$('my-role').value};
  nameInfo(input.myName);nameInfo(input.otherName);if(!input.title.trim())throw Error('请填写合同名称');
  doc=await createDocument(input,status);bundle=null;mode='create';paper(doc);$('export').hidden=true;$('proof').hidden=true;$('next-step').hidden=true;$('share-panel').hidden=true;signing(doc.initiator);status('请核对合同正文、双方容器与签署钱包，然后在下方手写签名。');$('contract-view').scrollIntoView({behavior:'smooth',block:'start'});
});
$('undo-sign').onclick=()=>pad.undo();$('clear-sign').onclick=()=>pad.clear();$('agree').onchange=controls;
function download(name,text){const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function showShare(location,stage){
  stopConfirmation();
  const shareBase=local?window.location.href:new URL(`./client-${release.slice(2)}.html`,window.location.href).href;
  submitted=anchor({chainId:location.chainId,tx:location.tx});$('share-panel').hidden=false;$('share-url').value=makeLink(submitted,shareBase);$('share-hash').textContent=`${submitted.chainId==='196'?'X Layer':'BSC'} · ${submitted.tx}`;
  const words={offer:['把合同链接发给对方','发起交易已提交。打包后即可阅读，达到短确认后可签署，正常网络下以一分钟内可用为目标。'],accept:['回签已提交，双方自动同步','发起方打开原合同或“我的合同”即可自动查询回签。下方链接仅供备用，无需再主动回传。'],seal:['保存归档链接，双方随时核验','归档交易已提交。短确认后可查询完整正文和双方签名；最终确认状态单独跟踪。']};
  [$('share-title').textContent,$('share-description').textContent]=words[stage];$('persistence-warning').hidden=location.stored!==false;if(location.stored===false)$('persistence-warning').textContent='浏览器未能持久保存记录，请立即复制链接。';
  $('sign-panel').hidden=true;$('next-step').hidden=true;status('交易已提交。请保存下方链接，打开后自动跟踪短确认，不要重复发送。');$('share-panel').scrollIntoView({behavior:'smooth'});
}
$('submit-sign').onclick=()=>action(async()=>{
  if(!$('agree').checked||!doc)throw Error('请先阅读合同并勾选确认');
  selectedParty(mode==='create'?doc.initiator:otherRole(doc.initiator));
  if(mode==='accept'&&bundle?.ready!==true)throw Error('短确认尚未完成，暂不能签署');
  const ink=pad.value(),key=mode==='create'?'offer:'+documentId(doc):'accept:'+bundle.offer.location.tx;
  const previous=readLocal('action:'+key);if(previous){showShare(previous,mode==='create'?'offer':'accept');return;}
  const location=mode==='create'?await publishOffer(doc,ink,status):await publishAcceptance(bundle.offer.location,ink,status);
  saveLocal('action:'+key,location);showShare(location,mode==='create'?'offer':'accept');mode=null;renderHistory();
});
async function openContract(location,{refresh=false}={}){
  stopConfirmation();
  const epoch=viewEpoch,previous=bundle,oldMode=mode;
  const preserve=refresh&&previous?.selected?.tx===location.tx&&previous?.selected?.chainId===location.chainId;
  if(!preserve){mode=null;bundle=null;doc=null;$('sign-panel').hidden=true;$('contract-view').hidden=true;$('next-step').hidden=true;$('share-panel').hidden=true;}
  if(!refresh)status('正在读取合同并在后台核验链上证据…');
  let completed=false,previewShown=false;
  let target=location;
  const previewTask=cachedLatest(location).catch(()=>cachedContract(location)).then(cached=>{
    if(completed||epoch!==viewEpoch||!cached?.bundle?.doc)return;
    assertContains(cached.bundle,location);
    const preview=validatePreview(cached,cached.bundle.selected,config.networks);if(!preview)return;
    target=anchor(cached.bundle.selected);if(preserve)return;
    paper(preview.doc,preview.signatures,'缓存预览 · 正在链上核验');previewShown=true;$('sign-panel').hidden=true;$('export').hidden=true;$('proof').hidden=true;
    $('next-step').hidden=false;$('next-step').textContent='合同已从永久缓存加载。后台核验完成后自动开放签署操作。';tab('open');
  }).catch(()=>{});
  let result;
  await previewTask;if(epoch!==viewEpoch)return;
  try{result=assertContains(await loadContract(target,context(undefined,m=>{if(epoch===viewEpoch&&!refresh)status(m);}),{allowPending:true,confirmation:'fast'}),location);}
  catch(e){
    if(e.code==='RPC_UNAVAILABLE')await previewTask;
    completed=true;if(epoch!==viewEpoch)return;
    if(e.code==='RPC_UNAVAILABLE'&&previewShown){mode=null;bundle=null;doc=null;$('sign-panel').hidden=true;$('export').hidden=true;$('contract-status').textContent='缓存预览 · 链上复核重试中';status('已显示签名校验通过的缓存正文；链上 RPC 暂不可用，后台自动重试。\n'+e.message);scheduleConfirmation(location);return;}
    mode=null;bundle=null;doc=null;$('contract-view').hidden=true;$('sign-panel').hidden=true;$('proof').hidden=true;$('export').hidden=true;$('next-step').hidden=true;
    if(['TRANSACTION_PENDING','RPC_SYNC_PENDING'].includes(e.code)){tab('open');$('open-value').value=makeLink(location,window.location.href);status(e.message+'。每 10 秒自动复查。');scheduleConfirmation(location);return;}
    throw e;
  }
  completed=true;if(epoch!==viewEpoch)return;
  renderContract(result,result.selected,{refresh,previous,oldMode,preserve});
  if(!result.seal)setTimeout(()=>{if(epoch===viewEpoch&&!busy)void followCurrent(epoch).catch(()=>{});},0);
}
function renderContract(result,location,{refresh=false,previous=null,oldMode=null,preserve=false}={}){
  bundle=result;doc=result.doc;const finalized=result.finalized===true,ready=result.ready===true,compatible=canContinue(doc,release);
  const keepSignature=preserve&&previous?.ready&&ready&&previous.id===result.id&&oldMode==='accept'&&result.status==='invited';
  mode=null;if(!keepSignature)$('sign-panel').hidden=true;$('next-step').hidden=true;
  for(const m of [bundle.offer,bundle.acceptance,bundle.seal].filter(Boolean)){const row=historyRow(m.record,m.location,doc);remember(m.location,doc.title,row);}
  notifyTransaction(location);const signatures=[bundle.offer.record.consent,...(bundle.acceptance?[bundle.acceptance.record.consent]:[])];
  const badge=finalized?{invited:'已核验 · 等待对方签署',signed:'已核验 · 双方已签',sealed:'已核验 · 链上归档'}[bundle.status]:ready?{invited:'短确认通过 · 可以签署',signed:'短确认通过 · 可以归档',sealed:'已归档 · 短确认通过'}[bundle.status]:'已打包 · 等待短确认';
  paper(doc,signatures,badge);$('export').hidden=!ready;$('proof').hidden=false;$('proof').replaceChildren();
  if(!finalized){const note=document.createElement('p');note.textContent=ready?'短确认已通过，链最终确认仍在进行。可以继续签约；链重组可能撤销当前确认及依赖它的签署、归档结果。':'合同内容可阅读，短确认尚未完成。';$('proof').append(note);}
  for(const [label,m]of [['发起交易',bundle.offer],['回签交易',bundle.acceptance],['归档交易',bundle.seal]])if(m){const p=document.createElement('p');p.textContent=`${label} · 链 ${m.location.chainId} · ${m.location.tx} · 区块 ${m.block.number}`;$('proof').append(p);}
  const version=document.createElement('p');version.textContent=`合同指纹 ${documentId(doc)} · 签署客户端 ${short(doc.client.site)} / ${doc.client.release} · 正文、笔迹、钱包签名、容器身份和交易已核验`;$('proof').append(version);
  if(!ready){$('next-step').hidden=false;$('next-step').textContent=pendingMessage(result);const check=document.createElement('button');check.id='retry-confirmation';check.className='button secondary';check.textContent='重新检查确认';check.onclick=()=>action(()=>openContract(location,{refresh:true}));$('next-step').append(check);}
  else if(bundle.status!=='sealed'&&!compatible){$('next-step').hidden=false;$('next-step').textContent='这份合同的客户端版本尚未确认兼容。请使用原邀请链接中的版本页面继续签署；当前页面仅核验。';}
  if(ready&&bundle.status==='invited'&&compatible){mode='accept';if(!keepSignature)signing(otherRole(doc.initiator));$('next-step').hidden=false;$('next-step').textContent='等待签署方签署。此页面每 10 秒查询回签状态；发起方无需等待或打开回传链接。';}
  if(ready&&bundle.status==='signed'&&compatible){
    $('next-step').hidden=false;$('next-step').textContent='双方签署已核验。由发起方将完整正文与双签名归档到一笔交易。';const button=document.createElement('button');button.id='seal';button.className='button primary';button.textContent='发起最终归档';button.onclick=()=>action(async()=>{selectedParty(doc.initiator);const key='action:seal:'+bundle.acceptance.location.tx;const previous=readLocal(key);if(previous){showShare(previous,'seal');return;}const result=await publishSeal(bundle.acceptance.location,status);saveLocal(key,result);showShare(result,'seal');});$('next-step').append(button);
  }
  if(!finalized||!bundle.seal)scheduleConfirmation(location);
  $('open-value').value=makeLink(location,window.location.href);status(finalized?'核验完成。合同交易已最终确认，链上内容已通过两家 RPC 一致性校验。':ready?'短确认已通过，可以继续签署或归档。链最终确认仍在进行，期间可能因重组回滚；后台每 10 秒复查。':pendingMessage(result));tab('open');controls();if(!refresh)$('contract-view').scrollIntoView({behavior:'smooth'});
}
$('open-contract').onclick=()=>action(async()=>{const value=$('open-value').value.trim(),location=HASH.test(value.toLowerCase())?anchor({chainId:$('open-chain').value,tx:value.toLowerCase()}):parseLink(value,window.location.href);await openContract(location);});
$('check-submitted').onclick=()=>action(()=>openContract(submitted));
$('copy').onclick=()=>action(async()=>{try{await navigator.clipboard.writeText($('share-url').value);status('链接已复制。');}catch{$('share-url').select();status('请复制已选中的链接。');}});
$('export').onclick=()=>{if(bundle)download(bundle.doc.contractId+'.json',exportBundle(bundle));};$('print').onclick=()=>window.print();
$('import').onchange=()=>action(async()=>{const file=$('import').files[0];if(!file)return;if(file.size>1000000)throw Error('证据文件过大');const data=JSON.parse(await file.text());if(data.format!=='TapeSign evidence v2')throw Error('请使用 V2 合同证据文件；旧合同请使用原版本客户端');await openContract(anchor(data.selected));});
function renderHistory(){
  const recent=readLocal('recent',[]),rows=groupContracts([...indexRows,...recent],$('history-container').value);$('history-list').replaceChildren();
  if(!rows.length){const p=document.createElement('p');p.className='empty';p.textContent='还没有该容器的合同记录。选择顶部容器后可查询链上信箱。';$('history-list').append(p);return;}
  for(const r of rows){const row=document.createElement('div'),info=document.createElement('div'),title=document.createElement('strong'),hash=document.createElement('small'),button=document.createElement('button');row.className='history-row';row.dataset.contractId=r.contractId;title.textContent=String(r.label||'合同');hash.className='mono';hash.textContent=`${r.contractId} · ${{offer:'待对方签署',accept:'双方已签署',seal:'已归档'}[r.type]} · ${r.transactions.length} 笔链上记录${r.conflict?' · 编号冲突，请核对指纹':' · 打开后核验'}`;button.className='button secondary small';button.textContent='打开';button.onclick=()=>action(()=>openContract(r.location));info.append(title,hash);row.append(info,button);$('history-list').append(row);}
}
function showIndex(result){
  indexRows=[...new Map([...indexRows,...result.rows].map(r=>[r.location.chainId+'/'+r.location.tx,r])).values()];renderHistory();
  const chainName=c=>c==='196'?'X Layer':'BSC',errors=result.errors||[],pending=result.pending||[];
  const counts=result.progress.map(p=>`${chainName(p.chain)}${p.direction==='in'?'收件':'发件'} ${p.loaded}/${p.total} 条`).join(' · ');
  $('index-progress').textContent=counts+(pending.length?'；正在查询 '+pending.map(chainName).join('、')+'…':errors.length?'；部分信箱未同步，请重试。':result.progress.some(p=>p.hasNewer)?'；还有新增记录，再点查询最新。':'；新增记录已同步。');
  if(errors.length)status('部分查询未完成，已显示可用记录；请点击“查询最新”重试。\n'+errors.map(e=>`${chainName(e.chain)}：${e.message}`).join('\n'),true);
  else if(pending.length)status('已显示查到的记录，正在查询其余信箱…');
  else status('合同定位列表已更新，打开具体交易后进行完整核验。');
}
async function sync(older=false){
  if(historySyncing)return;clearTimeout(historyTimer);historySyncing=true;
  try{
  status('正在读取合同列表，后台同步链上最新状态…');$('index-progress').textContent='查询中…';
  const epoch=viewEpoch,name=short($('history-container').value);nameInfo(name);
  if(!older){try{const cached=await cachedHistory(name);if(epoch!==viewEpoch||name!==short($('history-container').value))return;if(Array.isArray(cached.rows)){indexRows=[...new Map([...indexRows,...cached.rows].map(r=>[r.location.chainId+'/'+r.location.tx,r])).values()];renderHistory();saveLocal('history-container',name);$('index-progress').textContent='永久缓存已加载；后台自动同步链上记录，每 10 秒更新列表。';status('合同列表已按编号归并；打开合同后独立核验。');scheduleHistory(name,epoch);if(cached.rows.length)return;}}catch{}}
  // Reuse the pinned snapshot and attestation used to resolve this identity.
  const ctx=context(undefined,m=>{if(epoch===viewEpoch)status(m);}),identity=await resolveIdentity(name,ctx);
  if(epoch!==viewEpoch||name!==short($('history-container').value))return;
  $('history-container').value=short(identity.name);saveLocal('history-container',short(identity.name));
  const update=r=>{if(epoch===viewEpoch&&name===short($('history-container').value))showIndex(r);};
  const result=await syncIndex(identity,{older,ctx,onUpdate:update});update(result);
  }catch(e){if(!$('panel-history').hidden)status(e.message,true);}finally{historySyncing=false;if(!$('panel-history').hidden&&$('history-container').value)scheduleHistory(short($('history-container').value),viewEpoch);}
}
function scheduleHistory(name,epoch){
  clearTimeout(historyTimer);
  historyTimer=setTimeout(async()=>{
    const active=()=>epoch===viewEpoch&&!$('panel-history').hidden&&name===short($('history-container').value);
    if(!active())return;
    try{const r=await cachedHistory(name);if(!active())return;indexRows=[...new Map([...indexRows,...r.rows].map(r=>[r.location.chainId+'/'+r.location.tx,r])).values()];renderHistory();}catch{}
    if(active()&&!historySyncing&&Date.now()-(historyChecks.get(name)||0)>=60000){
      historyChecks.set(name,Date.now());historySyncing=true;
      try{const ctx=context(),identity=await resolveIdentity(name,ctx);if(active()){const r=await syncIndex(identity,{ctx});if(active())showIndex(r);}}catch{}finally{historySyncing=false;}
    }
    if(active())scheduleHistory(name,epoch);
  },10000);
}
$('sync').onclick=()=>void sync();$('older').onclick=()=>void sync(true);$('history-container').value=short(readLocal('history-container',''));
$('history-container').addEventListener('change',()=>{viewEpoch++;clearTimeout(historyTimer);indexRows=[];renderHistory();});
for(const id of ['my-container','other-container'])$(id).value=short($(id).value);
$('release-label').textContent='客户端 '+release.slice(0,10)+' · 独立校验';
sharedContainer();renderHistory();controls();
const initialRoute=readTabRoute(window.location);product(initialRoute.product,initialRoute.tab,{write:false});writeTabRoute(initialRoute.product,initialRoute.tab,{replace:true});
if(initialRoute.product==='contract'&&initialRoute.tab==='open'&&new URLSearchParams(location.search).has('tx'))action(()=>openContract(parseLink(location.href)));
function restoreRoute(){
 const route=readTabRoute(window.location);
 if(busy||notary.busy||wallet.busy){writeTabRoute(activeProduct,activeTab(),{replace:true});return;}
 if(route.product===activeProduct&&route.tab===activeTab())return;
 product(route.product,route.tab,{write:false});writeTabRoute(route.product,route.tab,{replace:true});
 if(route.product==='contract'&&route.tab==='open'&&!bundle&&new URLSearchParams(location.search).has('tx'))void action(()=>openContract(parseLink(location.href)));
}
window.addEventListener('hashchange',restoreRoute);window.addEventListener('popstate',restoreRoute);
