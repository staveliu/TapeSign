// Submission metadata is a signed preview, never proof of inclusion on chain.
export function submissionRow(submission){
 const c=submission.record.claim;
 return {id:c.id,location:submission.location,owner:c.owner.name,holder:c.owner.holder,hash:c.hash,kind:c.kind,visibility:c.visibility,mime:c.mime,size:c.size,timestamp:c.createdAt,createdAt:c.createdAt,finalized:false,timeSource:'declaration'};
}
export function notaryStatusText(status={},independent=false){
 const prefix=independent?'客户端独立核验':'服务器链上核验';
 if(status.chain==='invalid')return '链上核验异常 · 请核对交易';
 if(status.metadataMismatch)return '链上交易与最初缓存声明不一致 · 请核对原件';
 if(status.uniqueness==='conflict')return '发现相同内容的其他公证 · 唯一性冲突';
 if(status.chain==='finalized'||status.chain==='verified')return prefix+'通过 · '+(status.chain==='finalized'?'最终确认':'待最终确认')+(status.uniqueness==='clear'?' · 已扫描范围未发现重复':' · 全链查重进行中');
 const cache=status.cache==='passed'?'RPC 缓存已核验（已收录范围查重通过）':status.cache==='duplicate'?'RPC 缓存发现重复内容':status.cache==='pending_conflict'?'RPC 缓存有相同内容待核验':'RPC 缓存尚未核验';
 return cache+' · 链上未核验'+(status.chain==='retry'?' · 后台重试中':'');
}
