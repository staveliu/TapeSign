// A read-only recovery attempt may expire, but must never clear or resend an
// uncertain transaction. The signal also guards all delayed local writes.
export async function withRecoveryDeadline(work,{timeoutMs=30000,onProgress=()=>{},signal:externalSignal}={}){
 const controller=new AbortController();let stage='连接核验节点',timer;
 let abort;
 const cancelled=new Promise((_,reject)=>{abort=()=>{const error=externalSignal.reason||new DOMException('已停止本轮核验','AbortError');controller.abort(error);reject(error);};if(externalSignal?.aborted)abort();else externalSignal?.addEventListener('abort',abort,{once:true});});
 const report=value=>{controller.signal.throwIfAborted();stage=value;onProgress(value);};
 const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{
  const error=Object.assign(new Error('本次核对已超过 '+Math.round(timeoutMs/1000)+' 秒，停在“'+stage+'”。原交易记录已保留，尚未确认成功'),{name:'AbortError',code:'WALLET_RECOVERY_TIMEOUT',stage});
  controller.abort(error);reject(error);
 },timeoutMs);});
 try{return await Promise.race([Promise.resolve().then(()=>{controller.signal.throwIfAborted();return work({signal:controller.signal,report});}),expired,cancelled]);}
 finally{clearTimeout(timer);externalSignal?.removeEventListener('abort',abort);}
}
