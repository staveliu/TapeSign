const tabs={contract:['create','open','history'],notary:['create','search','public'],wallet:['create','wallets','transfer','sign']};
export function tabHash(product,tab){
 if(!tabs[product]?.includes(tab))throw Error('Unknown tab route');
 return '#'+product+'/'+tab;
}
export function readTabRoute(value){
 const url=new URL(typeof value==='string'?value:value.href);
 const match=/^#([a-z]+)\/([a-z]+)$/.exec(url.hash);
 if(match&&tabs[match[1]]?.includes(match[2]))return {product:match[1],tab:match[2]};
 if(url.searchParams.get('view')==='notary'||url.searchParams.has('notary'))return {product:'notary',tab:'create'};
 return {product:'contract',tab:url.searchParams.has('tx')?'open':'create'};
}
export function writeTabRoute(product,tab,{replace=false}={}){
 const url=new URL(window.location.href),hash=tabHash(product,tab);
 if(url.hash===hash)return;
 url.hash=hash;window.history[replace?'replaceState':'pushState'](null,'',url.href);
}
