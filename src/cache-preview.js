import { anchor, same, documentId, validateOffer, validateAccept, validateSeal } from './protocol.js';
// Cache is a reading aid, never proof of inclusion, ownership or finality.
export function validatePreview(cached, location, networks) {
  const b=cached?.bundle;if(!b)return null;
  if(!same(anchor(b.selected),anchor(location)))throw Error('缓存交易定位不符');
  const offer=validateOffer(b.offer?.record,networks),doc=offer.doc;
  if(documentId(b.doc)!==documentId(doc))throw Error('缓存正文不符');
  anchor(b.offer.location);const signatures=[offer.consent];
  if(b.acceptance){validateAccept(b.acceptance.record,offer,b.offer.location,networks);anchor(b.acceptance.location);signatures.push(b.acceptance.record.consent);}
  if(b.seal){if(!b.acceptance)throw Error('缓存缺少回签');validateSeal(b.seal.record,offer,b.offer.location,b.acceptance.record,b.acceptance.location,networks);anchor(b.seal.location);}
  if(!same((b.seal||b.acceptance||b.offer).location,location))throw Error('缓存选择的阶段不符');
  return {doc,signatures};
}
