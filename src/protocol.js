import { hexlify, toUtf8Bytes, toUtf8String, getBytes, keccak256, verifyTypedData } from 'ethers';
import { endpoint } from './vendor/protocol.js';
import { contractNumber } from './contract-id.js';

export const PROTOCOL = 'TAPESIGN-2';
export const ZERO = '0x' + '00'.repeat(32);
export const MAX_PAYLOAD = 16000;
export const MAX_BODY = 6500;
export const MAX_INK_POINTS = 220;
export const HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const PREFIX = '0x54530200';
const fail = text => { throw Error(text); };
export function exact(value, fields) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).sort().join() !== fields.split(',').sort().join()) fail('数据字段不符合 TapeSign v2');
}
export function canonical(value) {
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  fail('不支持的数据类型');
}
export const hashObject = value => keccak256(toUtf8Bytes(canonical(value)));
export const byteLength = value => toUtf8Bytes(typeof value === 'string' ? value : canonical(value)).length;
export function nameInfo(value) {
  const match = /^(0|[1-9]\d*)\.(?:(2)\.)?(0|[1-9]\d*)(?:\.tape)?$/.exec(String(value).trim());
  if (!match || match[1].length > 20 || match[3].length > 20 || match[1] === '0') fail('请输入完整容器 ID，例如 4.2.204');
  return { name: `${match[1]}.${match[2] ? '2.' : ''}${match[3]}.tape`, chainId: match[2] ? '196' : '56', tokenId: match[1] };
}
export function validateIdentity(p) {
  exact(p, 'name,chainId,processor,tokenId,container,holder,endpoint');
  const info = nameInfo(p.name);
  if (p.name !== info.name || p.chainId !== info.chainId || p.tokenId !== info.tokenId || !ADDRESS.test(p.processor) || !ADDRESS.test(p.container) || !ADDRESS.test(p.holder) || BigInt(p.holder) === 0n || p.endpoint !== endpoint(p.chainId, p.container)) fail('容器身份无效');
  return p;
}
export function validateBody(body) {
  if (!Array.isArray(body) || !body.length || body.length > 120 || byteLength(body) > MAX_BODY) fail('合同正文过长（最多 6,500 字节）或为空');
  let text = '';
  for (const block of body) {
    exact(block, 'type,runs');
    if (!['p','h2','li'].includes(block.type) || !Array.isArray(block.runs) || block.runs.length > 160) fail('不支持的正文格式');
    for (const run of block.runs) {
      exact(run, 'text,marks');
      if (typeof run.text !== 'string' || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/.test(run.text) || !Number.isInteger(run.marks) || run.marks < 0 || run.marks > 7) fail('正文字符或样式无效');
      text += run.text;
    }
  }
  if (!text.trim()) fail('请填写合同正文');
  return body;
}
// Integer coordinates, 0..1000 by 0..400; stored directly, never SVG/HTML.
export function validateInk(ink) {
  if (!Array.isArray(ink) || !ink.length || ink.length > 30) fail('请在签名框手写签名');
  let count = 0, distance = 0;
  for (const stroke of ink) {
    if (!Array.isArray(stroke) || stroke.length < 2) fail('签名笔迹无效');
    for (let i = 0; i < stroke.length; i++) {
      const p = stroke[i];
      if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isInteger) || p[0] < 0 || p[0] > 1000 || p[1] < 0 || p[1] > 400) fail('签名坐标无效');
      if (i) distance += Math.hypot(p[0]-stroke[i-1][0], p[1]-stroke[i-1][1]);
      count++;
    }
  }
  if (count < 4 || count > MAX_INK_POINTS || distance < 30 || byteLength(ink) > 2300) fail('签名过短或过于复杂，请清空后重新签署');
  return ink;
}
export function validateDocument(doc) {
  exact(doc, 'protocol,contractId,title,body,parties,initiator,nonce,createdAt,client');
  if (doc.contractId !== contractNumber(doc.createdAt,doc.nonce)) fail('合同编号与创建时间或随机码不符');
  if (doc.protocol !== PROTOCOL || typeof doc.title !== 'string' || !doc.title.trim() || byteLength(doc.title) > 160 || /[\x00-\x1f\u202a-\u202e\u2066-\u2069]/.test(doc.title) || !HASH.test(doc.nonce) || !Number.isSafeInteger(doc.createdAt) || doc.createdAt <= 0 || !['A','B'].includes(doc.initiator)) fail('合同基本信息无效');
  exact(doc.parties, 'A,B'); validateIdentity(doc.parties.A); validateIdentity(doc.parties.B);
  if (doc.parties.A.endpoint === doc.parties.B.endpoint) fail('双方必须使用不同容器');
  exact(doc.client, 'site,release');
  if (doc.client.site !== '4.2.204.tape' || !HASH.test(doc.client.release)) fail('客户端版本标识无效');
  validateBody(doc.body); return doc;
}
export const documentId = doc => hashObject(validateDocument(doc));
export const otherRole = role => role === 'A' ? 'B' : 'A';
export function anchor(value) {
  exact(value, 'chainId,tx');
  if (!['56','196'].includes(value.chainId) || !HASH.test(value.tx) || value.tx === ZERO) fail('交易定位信息无效');
  return value;
}
export const same = (a,b) => canonical(a) === canonical(b);
export function signingData(doc, role, ink, offerTx, hub) {
  const contractId = documentId(doc); validateInk(ink);
  if (!['A','B'].includes(role) || !HASH.test(offerTx) || !ADDRESS.test(hub) || ((role === doc.initiator) !== (offerTx === ZERO))) fail('签署阶段不匹配');
  return {
    domain: { name: 'TapeSign', version: '2', chainId: Number(doc.parties[role].chainId), verifyingContract: hub },
    types: { Consent: [
      {name:'contractId',type:'bytes32'}, {name:'role',type:'string'},
      {name:'container',type:'bytes32'}, {name:'handwritingHash',type:'bytes32'}, {name:'offerTransaction',type:'bytes32'},
    ] },
    message: { contractId, role, container: doc.parties[role].endpoint, handwritingHash: hashObject(ink), offerTransaction: offerTx },
  };
}
export function verifyConsent(doc, consent, offerTx, networks) {
  exact(consent, 'role,ink,signature');
  if (!['A','B'].includes(consent.role) || !/^0x[0-9a-f]{130}$/.test(consent.signature)) fail('钱包签名无效');
  const p = doc.parties[consent.role], n = networks.find(n => String(n.chainId) === p.chainId);
  if (!n) fail('不支持的链');
  const data = signingData(doc, consent.role, consent.ink, offerTx, n.hub);
  if (verifyTypedData(data.domain, data.types, data.message, consent.signature).toLowerCase() !== p.holder) fail('钱包签名与合同、笔迹或签署人不符');
  return consent;
}
export function encode(record) {
  const data = PREFIX + hexlify(toUtf8Bytes(canonical(record))).slice(2);
  if (getBytes(data).length > MAX_PAYLOAD) fail('完整归档超过链上 16,000 字节上限，请缩短正文或签名');
  return data;
}
export function decode(data) {
  if (typeof data !== 'string' || !data.startsWith(PREFIX) || data.length > 2 + MAX_PAYLOAD * 2) fail('不是 TapeSign 消息');
  const record = JSON.parse(toUtf8String(getBytes(data).slice(4)));
  if(record.protocol==='TAPESIGN-1')fail('这是旧版合同，请使用原客户端打开；V2 不迁移旧合同');
  if (encode(record) !== data || record.protocol !== PROTOCOL) fail('消息编码不规范');
  return record;
}
export const offerRecord = (doc, consent) => ({protocol:PROTOCOL,type:'offer',contractId:doc.contractId,doc,consent});
export const acceptRecord = (doc, offer, consent) => ({protocol:PROTOCOL,type:'accept',contractId:doc.contractId,documentHash:documentId(doc),offer:anchor(offer),consent});
export const sealRecord = (doc, offer, accept, consents) => ({protocol:PROTOCOL,type:'seal',contractId:doc.contractId,doc,offer:anchor(offer),accept:anchor(accept),consents});

export function validateOffer(record, networks) {
  exact(record, 'protocol,type,contractId,doc,consent');
  if (record.contractId !== record.doc?.contractId) fail('合同编号不一致');
  if (record.protocol !== PROTOCOL || record.type !== 'offer' || record.consent?.role !== record.doc?.initiator) fail('发起消息无效');
  validateDocument(record.doc); verifyConsent(record.doc, record.consent, ZERO, networks); encode(record);
  return record;
}
export function validateAccept(record, offer, location, networks) {
  exact(record, 'protocol,type,contractId,documentHash,offer,consent');
  if (record.protocol !== PROTOCOL || record.type !== 'accept' || record.contractId !== offer.doc.contractId || record.documentHash !== documentId(offer.doc) || !same(anchor(record.offer), anchor(location)) || record.consent?.role !== otherRole(offer.doc.initiator)) fail('签署消息引用了不同合同');
  verifyConsent(offer.doc, record.consent, location.tx, networks); encode(record); return record;
}
export function validateSeal(record, offer, offerLocation, accept, acceptLocation, networks) {
  exact(record, 'protocol,type,contractId,doc,offer,accept,consents');
  if (record.contractId !== record.doc?.contractId) fail('归档合同编号不一致');
  if (record.protocol !== PROTOCOL || record.type !== 'seal' || !same(record.doc, offer.doc) || !same(anchor(record.offer), anchor(offerLocation)) || !same(anchor(record.accept), anchor(acceptLocation)) || !Array.isArray(record.consents) || record.consents.length !== 2) fail('归档合同或交易引用不一致');
  validateAccept(accept, offer, offerLocation, networks);
  const expected = [offer.consent, accept.consent].sort((a,b)=>a.role.localeCompare(b.role));
  if (!same(record.consents, expected)) fail('归档未包含双方原始签名');
  encode(record); return record;
}

export function parseLink(value, base = 'http://localhost/') {
  const url = new URL(value, base);
  return anchor({chainId:url.searchParams.get('chain'),tx:(url.searchParams.get('tx') || '').toLowerCase()});
}
export function makeLink(location, base) {
  anchor(location); const url = new URL(base); url.search = ''; url.hash = '';
  url.searchParams.set('chain',location.chainId); url.searchParams.set('tx',location.tx); return url.href;
}
