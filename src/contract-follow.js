import { anchor, documentId, same } from './protocol.js';
import { validatePreview } from './cache-preview.js';
import { config } from './rpc.js';
export const stageRank = b => b?.seal ? 3 : b?.acceptance ? 2 : 1;
export function assertContains(bundle, location) {
  anchor(location);
  if (![bundle.offer, bundle.acceptance, bundle.seal].filter(Boolean).some(m => same(anchor(m.location), location)))
    throw Error('缓存后续交易没有引用请求的合同交易');
  return bundle;
}
// A server/index supplies locations only. Never adopt its status or finality.
export function assertSuccessor(current, next) {
  if (next.doc.contractId !== current.doc.contractId || documentId(next.doc) !== documentId(current.doc) ||
      !same(anchor(next.offer.location), anchor(current.offer.location)) ||
      (current.acceptance && !same(anchor(next.acceptance?.location), anchor(current.acceptance.location))) ||
      stageRank(next) <= stageRank(current)) throw Error('后续交易与当前合同或签署链不一致');
  return next;
}
export async function followContract(current, {lookup, discover, load, isCurrent = () => true} = {}) {
  if (current.seal) return {bundle:current};
  let error = null;
  const checked = new Set();
  async function verify(location) {
    anchor(location);
    const key = location.chainId + '/' + location.tx;
    if (checked.has(key) || !isCurrent()) return null;
    checked.add(key);
    return assertSuccessor(current, await load(location));
  }
  try {
    const cached = await lookup(current.selected);
    if (cached?.bundle && stageRank(cached.bundle) > stageRank(current)) {
      validatePreview(cached, cached.bundle.selected, config.networks);
      assertSuccessor(current, cached.bundle);
      try { const next = await verify(cached.bundle.selected); if (next) return {bundle:next}; }
      catch (e) { return {bundle:current,error:e}; }
    }
  } catch (e) { error = e; }
  if (discover && isCurrent()) {
    try {
      const result = await discover(current);
      const rows = result.rows.filter(r => r.contractId === current.doc.contractId &&
        r.documentHash === documentId(current.doc) && ({accept:2,seal:3}[r.type] || 0) > stageRank(current))
        .sort((a,b) => ({accept:2,seal:3}[b.type] - {accept:2,seal:3}[a.type]));
      for (const row of rows) {
        try { const next = await verify(row.location); if (next) return {bundle:next}; }
        catch (e) { error = e; }
      }
    } catch (e) { error = e; }
  }
  return {bundle:current,error};
}
