import {createContainerDiscovery,containerLabel} from './containers.js';
import {provider} from './rpc.js';

export function setupContainerPicker({connect,resolveIdentity,onChoose,onWallet,onChanged,discover=createContainerDiscovery,getProvider=provider}){
  const $=id=>document.getElementById(id),dialog=$('container-picker');
  let session=null,controller=null,epoch=0,target='my-container',wallet=null,scanning=false,selecting=false,observedProvider=null;
  const chainName=c=>c==='196'?'X Layer':'BSC';
  function note(text,error=false){$('container-picker-status').textContent=text;$('container-picker-status').classList.toggle('invalid',error);}
  function controls(){
    $('container-refresh').disabled=scanning||selecting;
    $('container-more').disabled=scanning||selecting||!session?.snapshot().hasMore;
    $('container-close').disabled=false;
    dialog.querySelectorAll('[data-container]').forEach(b=>b.disabled=selecting);
  }
  function cancel(){epoch++;controller?.abort();controller=null;session=null;scanning=false;selecting=false;}
  function changed(){
    cancel();wallet=null;$('container-options').replaceChildren();$('container-wallet').textContent='钱包账户已变化';
    note('钱包账户已变化，请重新点击“选择我的容器”。',true);onChanged?.();controls();
  }
  function observe(p){
    if(observedProvider===p)return;
    observedProvider?.removeListener?.('accountsChanged',changed);observedProvider?.removeListener?.('disconnect',changed);
    observedProvider=p;p.on?.('accountsChanged',changed);p.on?.('disconnect',changed);
  }
  async function currentWallet(){const accounts=await getProvider().request({method:'eth_accounts'});return String(accounts?.[0]||'').toLowerCase();}
  async function choose(row){
    if(selecting||!wallet)return;const run=epoch,expected=wallet;selecting=true;controls();note('正在核验所选容器的当前持有人…');
    try{
      if(await currentWallet()!==expected)throw Error('钱包账户已变化，请重新选择容器');
      const identity=await resolveIdentity(row.name);
      if(run!==epoch)return;
      if(await currentWallet()!==expected||identity.holder.toLowerCase()!==expected)throw Error('当前钱包已不持有此容器，请重新查找');
      if(run!==epoch)return;
      onChoose(identity,target);dialog.close();
    }catch(e){if(run===epoch)note(e.message,true);}finally{if(run===epoch){selecting=false;controls();}}
  }
  function render(result){
    const options=$('container-options');options.replaceChildren();
    for(const row of result.rows){
      const button=document.createElement('button'),title=document.createElement('strong'),label=document.createElement('span');
      button.type='button';button.className='container-option';button.dataset.container=containerLabel(row.name);
      title.textContent=containerLabel(row.name);label.textContent=chainName(row.chainId)+' · 已开通';
      button.append(title,label);button.onclick=()=>choose(row);options.append(button);
    }
    const failed=result.progress.filter(p=>p.error),incomplete=result.hasMore||result.progress.some(p=>p.unreadable);
    $('container-progress').textContent=result.progress.map(p=>`${chainName(p.chain)}：已检查 ${p.scanned} 个电路${p.unreadable?'，'+p.unreadable+' 项未读到':''}${p.error?'，暂未完成':''}`).join(' · ');
    if(!selecting){
      if(failed.length)note('部分节点暂不可用，已列出查到的容器；可重试或手动输入。'+failed.map(p=>chainName(p.chain)+'：'+p.error).join('；'),true);
      else if(result.rows.length)note(`找到 ${result.rows.length} 个已开通容器，点击即可选择。`+(scanning?'仍在继续查找…':incomplete?'列表尚未覆盖全部，可继续查找或手动输入。':''));
      else note(scanning?'正在从链上查找钱包名下的容器…':incomplete?'当前批次未找到已开通容器，可继续查找或手动输入。':'未找到当前钱包直接持有的已开通容器。');
    }
    $('container-more').hidden=!result.hasMore;controls();
  }
  async function scan(){
    if(!session||scanning)return;const run=epoch;scanning=true;controls();
    try{
      const result=await session.scan({onUpdate:r=>{if(run===epoch&&dialog.open)render(r);}});
      if(run===epoch){scanning=false;render(result);}
    }catch(e){if(run===epoch&&e.name!=='AbortError'){controller?.abort();session=null;$('container-options').replaceChildren();note(e.message+'。请重新查找或手动输入。',true);}}
    finally{if(run===epoch){scanning=false;controls();}}
  }
  async function open(forInput='my-container'){
    cancel();const run=epoch;target=forInput;$('container-options').replaceChildren();$('container-progress').textContent='';$('container-wallet').textContent='';$('container-more').hidden=true;
    if(!dialog.open)dialog.showModal();note('请在钱包中连接账户…');scanning=true;controls();
    try{
      const connected=(await connect()).toLowerCase();if(run!==epoch)return;
      observe(getProvider());if(await currentWallet()!==connected)throw Error('钱包账户已变化，请重新连接');
      wallet=connected;onWallet?.(wallet);$('container-wallet').textContent=wallet;
      controller=new AbortController();session=discover(wallet,{signal:controller.signal});scanning=false;await scan();
    }catch(e){if(run===epoch)note(e.code===4001?'已取消连接，可手动输入容器 ID。':e.message,true);}
    finally{if(run===epoch){scanning=false;controls();}}
  }
  $('choose-my-container').onclick=()=>open('my-container');$('choose-history-container').onclick=()=>open('history-container');
  $('container-close').onclick=()=>dialog.close();dialog.addEventListener('close',cancel);
  $('container-more').onclick=()=>scan();$('container-refresh').onclick=()=>open(target);
  return {open};
}
