const KEY = 'tapesign-v2';
const memory = new Map();
export function readLocal(key, fallback = null) {
  if (memory.has(key)) return memory.get(key);
  try { const raw=localStorage.getItem(KEY+':'+key);return raw?JSON.parse(raw):fallback; } catch { return memory.get(key)??fallback; }
}
export function saveLocal(key,value) {
  memory.set(key,value);
  try {localStorage.setItem(KEY+':'+key,JSON.stringify(value));return true;} catch {return false;}
}
export function remember(location, label = '待核验交易', metadata = {}) {
  const all=readLocal('recent',[]).filter(x=>x.location?.tx!==location.tx || x.location?.chainId!==location.chainId);
  all.unshift({...metadata,location,label,savedAt:Date.now()}); return saveLocal('recent',all.slice(0,300));
}
