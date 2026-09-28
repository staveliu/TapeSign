import './style.css';
import {toQuantity} from 'ethers';
import {authorize,context} from './rpc.js';
import {readActivation,activationTransaction,assertActivationUnchanged} from './activation.js';
const $=id=>document.getElementById(id),key='tapesign-v2:website-activation';let busy=false,quote,polling=false;
const status=text=>$('status').textContent=text;
function pending(){const s=localStorage.getItem(key);return s?JSON.parse(s):null;}
function save(p){if(p===null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(p));}
function controls(){
  let p;try{p=pending();}catch{p={phase:'unknown'};}
  $('refresh').disabled=busy;for(const id of ['activate','sync'])$(id).disabled=busy||!quote||quote.siteLive||!!p;
  $('sync').disabled ||= !quote?.domain || !quote?.domainLive || BigInt(quote.domainUntil)<=BigInt(quote.block.timestamp);
  $('months').disabled=busy||!!p;$('domain').disabled=busy||!!p;
  $('pending').textContent=p?.hash?'已提交交易：'+p.hash+'；请勿再次发送。':p?'钱包发送状态待核对，请先检查钱包活动记录，勿重复付款。':'';
}
function inputs(){return {months:Number($('months').value),domain:$('domain').value};}
function render(q){quote=q;$('details').textContent=JSON.stringify({site:q.identity.name,chain:'X Layer (196)',container:q.identity.container,holder:q.identity.holder,binding:q.binding,siteLive:q.siteLive,paidUntil:q.paidUntil,monthlyFeeOKB:q.monthlyFee,totalOKB:q.total,months:q.months,oldDomain:q.domain,oldDomainLive:q.domainLive,checkedBlock:q.block.number},null,2);$('open-site').hidden=!q.siteLive;controls();}
async function receiptState(p,q){
  if(!p?.hash)return;
  const rpc=context().rpc('196'),r=await rpc.agree('eth_getTransactionReceipt',[p.hash],v=>v&&({hash:v.transactionHash.toLowerCase(),status:String(BigInt(v.status)),number:String(BigInt(v.blockNumber)),blockHash:v.blockHash.toLowerCase()}));
  if(!r)return;
  if(r.hash!==p.hash)throw Error('交易回执哈希不符');
  const blockHash=await rpc.agree('eth_getBlockByNumber',[toQuantity(r.number),false],b=>b?.hash?.toLowerCase());if(blockHash!==r.blockHash)throw Error('交易区块已变化，请稍后复查');
  const finalized=await rpc.pin('finalized');if(BigInt(finalized.number)<BigInt(r.number))return;
  if(r.status==='0'){save(null);throw Error('开通交易已最终确认失败，未完成订阅；请先检查钱包失败原因');}
  if(q.siteLive&&BigInt(q.block.number)>=BigInt(r.number))save(null);
}
async function refresh(){
  const q=await readActivation(inputs());render(q);await receiptState(pending(),q);
  status(q.siteLive?'网站订阅已生效，可以打开官方网关。无需重新上传文件。':pending()?'交易已提交或发送状态待核对，继续查询；请勿再次付款。':'网站未激活。核对费用后，可由容器持有人钱包开通；若以前付过域名费用，先核对同步。');controls();return q;
}
async function action(fn){if(busy)return;busy=true;controls();try{await fn();}catch(e){quote=undefined;status(e.message);}finally{busy=false;controls();}}
async function submit(kind){
  if(!navigator.locks)throw Error('请用支持 Web Locks 的 Chrome 或 Edge 打开此本地页面');
  await navigator.locks.request(key,{ifAvailable:true},async lock=>{
    if(!lock)throw Error('另一个页面正在处理网站开通，请在那个页面继续');
    if(pending())throw Error('已有待核对交易，请重新查询状态，不要再次付款');
    const q=await readActivation(inputs());render(q);const tx=activationTransaction(q,kind);
    const prompt=kind==='sync'?'同步 '+q.domain+' 的已有付费记录到此容器；订阅费 0 OKB，仅需 gas。':'开通 '+q.months+' 期（每期 30 天），订阅费 '+q.total+' OKB，另加 gas。';
    if(!confirm(q.identity.name+' · X Layer (196)\n'+prompt+'\n付费合约：'+q.binding+'\n请在钱包确认最终交易。'))return;
    const wallet=await authorize(q.identity,status);
    const gas=await wallet.request({method:'eth_estimateGas',params:[{...tx,from:q.identity.holder}]});
    status('再次核对费用、容器身份与订阅状态…');
    const current=await readActivation({months:q.months,domain:q.domain});assertActivationUnchanged(q,current,kind);
    const accounts=await wallet.request({method:'eth_accounts'}),chain=await wallet.request({method:'eth_chainId'});
    if(accounts[0]?.toLowerCase()!==q.identity.holder||BigInt(chain)!==196n)throw Error('钱包账户或网络已变化，请重新核对');
    // Persist intent BEFORE broadcast. Unknown wallet outcomes cannot trigger another payment.
    const intent={phase:'wallet',createdAt:Date.now(),site:q.identity.name,container:q.identity.container,kind};save(intent);
    let hash;try{hash=await wallet.request({method:'eth_sendTransaction',params:[{...tx,from:q.identity.holder,chainId:'0xc4',gas:toQuantity(BigInt(gas)*120n/100n)}]});}
    catch(e){if(Number(e.code)===4001)save(null);else save({...intent,phase:'unknown'});throw e;}
    if(!/^0x[0-9a-f]{64}$/i.test(hash||''))throw Error('钱包未返回可验证交易哈希，请检查钱包活动记录，勿重复付款');
    status('交易已提交：'+hash+'；等待链上状态更新，无需再次发送。');$('pending').textContent=hash;
    save({...intent,phase:'submitted',hash:hash.toLowerCase()});await refresh();
  });
}
$('refresh').onclick=()=>action(refresh);$('activate').onclick=()=>action(()=>submit('bind'));$('sync').onclick=()=>action(()=>submit('sync'));
for(const id of ['months','domain'])$(id).onchange=()=>{quote=undefined;controls();status('参数已变更，请重新核对状态与费用');};
await action(refresh);
const timer=setInterval(()=>{if(busy||polling)return;let p;try{p=pending();}catch{return;}if(!p?.hash)return;polling=true;void action(refresh).finally(()=>{polling=false;});},10000);
window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
window.addEventListener('storage',event=>{if(event.key===key)controls();});
