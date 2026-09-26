// TapeOut endpoint and message digest helpers, adapted from DeSQL (same project author); see THIRD_PARTY_NOTICES.md.
import { concat, keccak256 } from 'ethers';
export function endpoint(chain, address) {
  address = address.toLowerCase();
  const n = BigInt(chain);
  if (n <= 0n || n >= 2n ** 64n || !/^0x[0-9a-f]{40}$/.test(address) || BigInt(address) === 0n) throw Error('Invalid endpoint');
  return '0x00000000' + n.toString(16).padStart(16, '0') + address.slice(2);
}
export function parseEndpoint(value) {
  if (!/^0x00000000[0-9a-f]{56}$/.test(value)) throw Error('Invalid endpoint');
  const chainId = BigInt('0x' + value.slice(10, 26)).toString(), container = '0x' + value.slice(26);
  if (endpoint(chainId, container) !== value) throw Error('Invalid endpoint');
  return { chainId, container };
}
export const digest = (ref, payload) => keccak256(concat([ref, keccak256(payload)]));
