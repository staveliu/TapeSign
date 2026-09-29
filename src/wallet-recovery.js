// A read-only recovery attempt may expire, but must never clear or resend an
// uncertain transaction. The signal also guards all delayed local writes.
export async function withRecoveryDeadline(work,{timeoutMs=30000,onProgress=()=>{}}={}){
 const controller=new AbortController();let stage='连接核验节点',timer;
 const report=value=>{controller.signal.throwIfAborted();stage=value;onProgress(value);};
 const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{
  const error=Object.assign(new Error('本次核对已超过 '+Math.round(timeoutMs/1000)+' 秒，停在“'+stage+'”。原交易记录已保留，尚未确认成功'),{name:'AbortError',code:'WALLET_RECOVERY_TIMEOUT',stage});
  controller.abort(error);reject(error);
 },timeoutMs);});
 try{return await Promise.race([Promise.resolve().then(()=>work({signal:controller.signal,report})),expired]);}
 finally{clearTimeout(timer);}
}
