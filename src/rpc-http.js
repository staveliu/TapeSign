// A local request may visit multiple providers in one independent slot.
export const RPC_ENDPOINT_TIMEOUT_MS = 6500;
export const RPC_UNAVAILABLE = 'RPC_UNAVAILABLE';
export function safeRpcMessage(value) {
  return String(value ?? 'RPC unavailable').replace(/https?:\/\/[^\s"'<>]+/gi, url => {
    try { return new URL(url).hostname; } catch { return '[RPC]'; }
  }).replace(/[\r\n\t]+/g, ' ').slice(0, 500);
}
export function rpcUnavailable(message, details = {}) {
  return Object.assign(new Error(safeRpcMessage(message)), {code: RPC_UNAVAILABLE, ...details});
}
export function rpcTimeoutMs(network, primary, local = false) {
  return local ? (1 + (network?.rpcFallbacks?.[primary]?.length ?? 0)) * RPC_ENDPOINT_TIMEOUT_MS + 3000 : RPC_ENDPOINT_TIMEOUT_MS;
}
// Fetch and Playwright both expose text(), but status/ok differ.
export async function readRpcResponse(response, method) {
  const status = typeof response.status === 'function' ? response.status() : response.status;
  const ok = typeof response.ok === 'function' ? response.ok() : response.ok;
  let payload;
  try { payload = JSON.parse(await response.text()); } catch {
    throw rpcUnavailable(`${method}: RPC HTTP ${status} (invalid JSON response)`, {method});
  }
  if (!ok) {
    const error = payload?.error;
    const detail = (typeof error === 'string' ? error : error?.message) || payload?.message;
    throw rpcUnavailable(`${method}: RPC HTTP ${status}${detail ? ' · ' + detail : ''}`, {method});
  }
  return payload;
}
