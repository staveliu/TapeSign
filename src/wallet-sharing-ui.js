import {ZeroAddress} from 'ethers';
import {tokenDetails} from './wallet-client.js';
import {walletProposalLink,walletLinkBase,nextWalletRole,walletExplorerUrl,nativeWalletSymbol,localWalletLink} from './wallet-links.js';
import {safeRpcMessage} from './rpc-http.js';

const $=id=>document.getElementById(id);
export function setupWalletSharing(){
 document.querySelector('#wallet-sign > p.hint').textContent='先核对完整地址、资产、金额和有效期，再连接相应角色的钱包签名。可以用下方提案链接跨设备接力，也保留 JSON 文件导入；打开链接不会自动签名或发送交易。';
 $('wallet-proposal-view').insertAdjacentHTML('afterbegin',`
  <section class="wallet-handoff" aria-label="提案签署接力">
   <h3 id="wallet-handoff-title"></h3><p id="wallet-handoff-text"></p>
   <p id="wallet-incoming-role" class="hint"></p>
   <label for="wallet-share-url">提案接力链接（包含当前已有签名）</label>
   <textarea id="wallet-share-url" readonly rows="3" spellcheck="false"></textarea>
   <button id="wallet-copy-link" class="button primary" type="button">复制签署链接</button>
   <p id="wallet-share-status" class="hint" role="status"></p>
   <p class="hint">链接只交给本次协作方。打开链接会核验并导入，不会自动签名或发送交易。每次签署后请复制新链接交给下一方；链接被聊天软件截断时可改用 JSON 文件。</p>
   <details><summary>设置对方可访问的客户端网址</summary><label for="wallet-share-base">TapeSign 客户端地址</label><input id="wallet-share-base" type="url" placeholder="https://…/index.html"><p class="hint">跨设备使用时填写已发布且支持公证钱包的 TapeSign 客户端地址。</p></details>
  </section>`);
 $('wallet-next-step').insertAdjacentHTML('afterend',`
  <section id="wallet-account-info" class="card wallet-account-info" hidden>
   <div class="section-head"><h2>公证钱包余额</h2><button id="wallet-native-refresh" class="text-button" type="button">刷新余额</button></div>
   <p id="wallet-account-address" class="mono"></p><p id="wallet-native-balance" class="wallet-native-balance"></p>
   <p id="wallet-native-status" class="hint" role="status"></p><div id="wallet-explorer-links" class="wallet-actions"></div>
   <p class="hint">这里显示新公证钱包合约地址的原生币余额。提交交易的手续费由实际发送钱包支付。</p>
  </section>`);
 let current=null,role=null,policy=null,accountKey='',lastRead=0,balanceAbort=null,epoch=0,visible=false,shareReady=false;
 let base=location.href;try{base=localStorage.getItem('tapesign-wallet-v1:share-base')||walletLinkBase(base);}catch{}
 $('wallet-share-base').value=base;
 function renderLink(){
  shareReady=false;$('wallet-share-url').value='';$('wallet-copy-link').disabled=true;if(!current)return;
  try{const url=walletProposalLink($('wallet-share-base').value.trim(),current);$('wallet-share-url').value=url;shareReady=true;$('wallet-copy-link').disabled=false;$('wallet-share-status').textContent=localWalletLink(url)?'当前链接使用本机地址，对方设备无法访问。跨设备请在下方填写已发布的客户端网址。':'签完后复制新链接，已有签名会一并带给下一方。';}
  catch(e){$('wallet-share-status').textContent=e.message;}
 }
 $('wallet-share-base').addEventListener('change',()=>{try{const value=walletLinkBase($('wallet-share-base').value.trim());localStorage.setItem('tapesign-wallet-v1:share-base',value);}catch{}renderLink();});
 $('wallet-copy-link').onclick=async()=>{
  if(!shareReady)return;const url=$('wallet-share-url').value;
  try{await navigator.clipboard.writeText(url);$('wallet-share-status').textContent='已复制，请发送给'+(nextWalletRole(current)==='transaction'?'交易控制钱包使用者':nextWalletRole(current)==='notary'?'公证容器持有人':'负责提交执行的一方')+'。';}
  catch{$('wallet-share-url').focus();$('wallet-share-url').select();$('wallet-share-status').textContent='浏览器未允许自动复制，链接已选中，请手动复制。';}
 };
 function review(proposal,incomingRole=null){
  current=proposal;role=incomingRole;const next=nextWalletRole(proposal),p=proposal.policy;
  const title=next==='transaction'?'下一步：发给交易控制钱包签名':next==='notary'?'下一步：发给公证容器持有人签名':'两方已签署：提交执行或回传';
  const message=next==='transaction'?'把下方链接发给交易控制钱包 '+p.transactionSigner+' 的使用者。对方打开后连接此地址，核对提案，再点击“交易钱包签名”。':next==='notary'?'把下方新链接发给容器 '+p.name.replace('.tape','')+' 的持有人，签名钱包为 '+p.notarySigner+'。对方打开后核对提案，再点击“容器持有人签名”。':'两份签名已保存在提案中，尚未执行。可以点击“钱包确认执行”，或把下方链接发回发起方，由其核对并支付手续费提交。';
  $('wallet-handoff-title').textContent=title;$('wallet-handoff-text').textContent=message;
  $('wallet-incoming-role').textContent=!role?'':role==='execute'?'此链接用于核对并提交执行；必须有两份有效签名。':'此链接邀请'+(role==='transaction'?'交易控制方 '+p.transactionSigner:'容器 '+p.name.replace('.tape','')+' 的持有人 '+p.notarySigner)+'签署。';
  for(const [id,r]of [['a','transaction'],['b','notary']])$('wallet-sign-'+id).closest('div').classList.toggle('wallet-sign-next',next===r);
  $('wallet-copy-link').textContent=next==='execute'?'复制双签执行 / 回传链接':next==='transaction'?'复制链接，发给交易控制钱包':'复制链接，发给公证容器持有人';
  renderLink();showAccount(p);return {title,message};
 }
 function explorerLinks(p){
  const el=$('wallet-explorer-links');el.replaceChildren();
  for(const [label,address]of [['在 OKLink 查看公证钱包',p.wallet],['查询交易控制钱包',p.transactionSigner],['查询容器签名钱包',p.notarySigner]]){
   const href=walletExplorerUrl(p.chainId,address);if(!href)continue;
   const link=document.createElement('a');link.href=href;link.textContent=label;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';el.append(link);
  }
 }
 async function refreshBalance(){
  if(!policy||!visible)return;cancel();const id=epoch,p=policy,controller=new AbortController();balanceAbort=controller;
  $('wallet-native-balance').textContent='— '+nativeWalletSymbol(p.chainId);$('wallet-native-status').textContent='正在查询链上余额…';
  const timer=setTimeout(()=>controller.abort(new DOMException('余额查询超时，请点击刷新重试','TimeoutError')),12000);
  try{const value=await tokenDetails(p,ZeroAddress,{signal:controller.signal});if(id!==epoch||controller.signal.aborted)return;lastRead=Date.now();$('wallet-native-balance').textContent=value.formattedBalance+' '+value.symbol;$('wallet-native-status').textContent='链 '+p.chainId+' · 区块 '+value.blockNumber+' · 读取于 '+new Date(lastRead).toLocaleTimeString();}
  catch(e){if(id===epoch){$('wallet-native-balance').textContent='— '+nativeWalletSymbol(p.chainId);$('wallet-native-status').textContent='余额暂不可用：'+safeRpcMessage(controller.signal.aborted?controller.signal.reason.message:e.message)+'。可点击刷新重试。';}}
  finally{clearTimeout(timer);if(id===epoch)balanceAbort=null;}
 }
 function cancel(){epoch++;balanceAbort?.abort();balanceAbort=null;}
 function showAccount(p,{force=false}={}){
  const key=p.chainId+'/'+p.wallet.toLowerCase();if(accountKey!==key){cancel();lastRead=0;accountKey=key;policy=p;$('wallet-account-address').textContent=p.wallet+' · 链 '+p.chainId;explorerLinks(p);}
  $('wallet-account-info').hidden=!visible;if(visible&&(force||(!balanceAbort&&Date.now()-lastRead>15000)))void refreshBalance();
 }
 $('wallet-native-refresh').onclick=()=>void refreshBalance();
 return {review,showAccount,cancel,get shareReady(){return shareReady;},setVisible(value){visible=value;$('wallet-account-info').hidden=!value||!policy;if(!value)cancel();else if(policy)showAccount(policy);},clearProposal(){current=null;role=null;$('wallet-share-url').value='';shareReady=false;},clear(){cancel();current=null;policy=null;role=null;accountKey='';lastRead=0;$('wallet-account-info').hidden=true;$('wallet-share-url').value='';shareReady=false;}};
}
