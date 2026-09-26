import { CONTRACT_ID } from './contract-id.js';
import { anchor, documentId, validateDocument } from './protocol.js';
const rank = { offer:1, accept:2, seal:3 };
export function historyRow(record, location, doc = record.doc) {
  anchor(location);
  const id = record.contractId || doc?.contractId;
  if (!CONTRACT_ID.test(id) || !rank[record.type]) throw Error('无效的新版本合同记录');
  const hash = doc ? documentId(validateDocument(doc)) : record.documentHash;
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw Error('合同指纹无效');
  return { location, contractId:id, documentHash:hash, type:record.type, label:doc?.title || '', createdAt:doc?.createdAt || 0, parties:doc ? [doc.parties.A.name,doc.parties.B.name] : [], savedAt:Date.now() };
}
export function groupContracts(rows, container = '') {
  const wanted = container.trim().replace(/\.tape$/i,'');
  const groups = new Map();
  for (const row of rows) {
    try { anchor(row.location); } catch { continue; }
    if (!CONTRACT_ID.test(row.contractId) || !rank[row.type] || !/^0x[0-9a-f]{64}$/.test(row.documentHash || '')) continue;
    let g = groups.get(row.contractId);
    if (!g) { g = {...row, transactions:[], parties:[], fingerprints:new Set(), conflict:false}; groups.set(row.contractId,g); }
    g.fingerprints.add(row.documentHash); g.conflict=g.fingerprints.size>1;
    g.parties=[...new Set([...g.parties,...(row.parties || [])])];
    if (row.label) g.label=row.label;
    g.createdAt=Math.max(g.createdAt || 0,row.createdAt || 0);
    if (!g.transactions.some(t=>t.chainId===row.location.chainId && t.tx===row.location.tx)) g.transactions.push(row.location);
    if (rank[row.type]>rank[g.type] || (rank[row.type]===rank[g.type] && (row.savedAt||0)>(g.savedAt||0))) { g.type=row.type; g.location=row.location; g.savedAt=row.savedAt; }
  }
  return [...groups.values()].filter(g=>!wanted || g.parties.some(n=>n.replace(/\.tape$/i,'')===wanted)).sort((a,b)=>b.contractId.localeCompare(a.contractId)).map(({fingerprints,...g})=>g);
}
