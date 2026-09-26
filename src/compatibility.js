// V2 starts fresh. V1 evidence remains on chain and uses its original client.
export const COMPATIBLE_RELEASES=Object.freeze([
  '0x3f6618b80f83557042d1cb3da54030dbeaaac7d1126c682b553df9bd74f885ab',
  '0xc01023e427024256481780fa0ea6c25ae9d37c82c638b3ea12dee6e82f46e825',
  '0x204dcc416fcd9a2f01713e4b9a10c43f4fce1c748448357be7265e613e245f9d',
  '0x0abd2ec2e85813ac60953961a7cdbc5c366b78608bb96c823986022dbfc5985a',
]);
export function canContinue(doc,currentRelease){
  return doc?.protocol==='TAPESIGN-2'&&doc?.client?.site==='4.2.204.tape'&&(doc.client.release===currentRelease||COMPATIBLE_RELEASES.includes(doc.client.release));
}
