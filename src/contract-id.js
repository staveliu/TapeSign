// UTC millisecond timestamp plus 128 random bits; no central issuer required.
export const CONTRACT_ID = /^TS-\d{17}-[0-9a-f]{32}$/;
export function contractNumber(createdAt, nonce) {
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0 || !/^0x[0-9a-f]{64}$/.test(nonce)) throw Error('合同编号参数无效');
  const stamp = new Date(createdAt).toISOString().replace(/[-:TZ.]/g, '');
  if (stamp.length !== 17) throw Error('合同编号时间无效');
  return `TS-${stamp}-${nonce.slice(2,34)}`;
}
