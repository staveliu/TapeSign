import './style.css';
import {config,context,sendTransaction} from './rpc.js';
import {readLocal,saveLocal} from './storage.js';
const $=id=>document.getElementById(id);let plan,busy=false;
const status=m=>$('status').textContent=m,log=m=>$('log').textContent+=m+'\n';
async function api(route){const r=await fetch('/api/'+route,{cache:'no-store'}),v=await r.json();if(!r.ok)throw Error(v.error||'本机发布 API 失败');return v;}
function controls(){document.querySelectorAll('button').forEach(b=>b.disabled=busy);$('publish').disabled=busy||!plan;}
async function action(fn){if(busy)return;busy=true;controls();try{await fn();}catch(e){status(e.message);}finally{busy=false;controls();}}
async function inspect(){plan=await api('plan');$('release').textContent=JSON.stringify({release:plan.release,site:plan.site,holder:plan.identity.holder,files:plan.files.map(f=>({path:f.path,bytes:f.size})),transactions:plan.transactions.length},null,2);status('容器与发布包已核验。上传需要钱包逐笔确认并支付网络费用。');}
async function fileState(name,after){for(let i=0;i<20;i++){const state=await api('file-status?name='+encodeURIComponent(name)+(after?'&after='+after:''));if(!state.waiting){if(state.release!==plan.release)throw Error('上传期间构建包发生变化，已停止，请先恢复待确认交易');return state;}status('等待 RPC 同步到刚上传的区块…');await new Promise(r=>setTimeout(r,2000));}throw Error('节点暂未同步，保留上传进度，请稍后继续');}
async function receipt(hash){const rpc=context().rpc('196');for(let i=0;i<50;i++){const r=await rpc.agree('eth_getTransactionReceipt',[hash],r=>r&&({hash:r.transactionHash.toLowerCase(),status:String(BigInt(r.status)),number:String(BigInt(r.blockNumber)),blockHash:r.blockHash.toLowerCase()}));if(r){if(r.hash!==hash)throw Error('上传交易哈希不符');if(r.status!=='1'){saveLocal('pending-upload',null);throw Error('上传交易执行失败。再次继续会从链上实际内容恢复。');}const h=await rpc.agree('eth_getBlockByNumber',['0x'+BigInt(r.number).toString(16),false],b=>b?.hash?.toLowerCase());if(h!==r.blockHash)throw Error('上传交易区块变化，暂不继续');return r;}status('等待上传交易打包，保留哈希，不会重复上传…');await new Promise(r=>setTimeout(r,2000));}throw Error('交易仍未确认。进度已保存，请稍后继续。');}
$('inspect').onclick=()=>action(inspect);
$('publish').onclick=()=>action(async()=>{
  await inspect();if(!confirm(`确认将当前发布包上传到 ${plan.site}？\n最多 ${plan.transactions.length} 次钱包交易，实际已完成分块会跳过。\n现有首页将在最后更新。`))return;
  const pending=readLocal('pending-upload');
  if(pending){if(pending.release!==plan.release)throw Error('另一个版本仍有待确认上传。请先核对交易：'+pending.hash);const r=await receipt(pending.hash),s=await fileState(pending.file,r.number);if(s.conflict||(!s.complete&&s.next<=pending.index))throw Error('上次交易未读到预期分块，请保留哈希人工核对');saveLocal('pending-upload',null);}
  for(const file of plan.files){
    let state=await fileState(file.path);
    if(state.conflict){if(!['index.html','release.json'].includes(file.path))throw Error('版本文件已存在但内容不同，禁止覆盖：'+file.path);if(!confirm('将替换链上现有 '+file.path+'。确认继续？'))throw Error('已取消替换');state={next:0};}
    if(state.complete){log('已验证，跳过 '+file.path);continue;}
    for(const tx of plan.transactions.filter(t=>t.file===file.path&&t.index>=state.next)){
      status(`上传 ${tx.file} / 分块 ${tx.index+1}`);
      const sent=await sendTransaction(plan.identity,{to:tx.to,data:tx.data,value:tx.value},status);
      const pending={release:plan.release,file:tx.file,index:tx.index,hash:sent.tx};saveLocal('pending-upload',pending);$('pending').textContent=JSON.stringify(pending);log(tx.file+' #'+tx.index+' '+sent.tx);
      const r=await receipt(sent.tx);state=await fileState(tx.file,r.number);if(state.conflict||(!state.complete&&state.next<=tx.index))throw Error('链上尚未读到上传内容，保留交易哈希');saveLocal('pending-upload',null);$('pending').textContent='';
    }
  }
  status('文件上传完成。点击“核验最终发布”，等待最终确认后逐文件回读。');
});
$('verify').onclick=()=>action(async()=>{
  const release=await api('release');await api('preflight');
  for(const f of release.files){status('最终回读核验 '+f.path);const s=await api('file-status?finalized=1&name='+encodeURIComponent(f.path));if(!s.complete)throw Error('文件尚未最终确认或内容不一致：'+f.path);}
  saveLocal('published-release',{release:release.release,verifiedAt:Date.now()});status('发布已完成并通过最终回读核验。');$('result').hidden=false;const link=document.createElement('a');link.href='https://4-2-204.tapekit.org/'+release.versionPath;link.textContent='打开已发布版本：4.2.204.tape';link.target='_blank';link.rel='noopener';$('result').replaceChildren(link);
});
await action(async()=>{const r=await api('release');$('release').textContent=JSON.stringify({release:r.release,files:r.files.map(f=>({path:f.path,bytes:f.size}))},null,2);status('构建包已就绪。先核验容器与发布计划。');const p=readLocal('pending-upload');if(p)$('pending').textContent='待恢复上传：'+JSON.stringify(p);});
