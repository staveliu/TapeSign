import {readLocal,saveLocal} from './storage.js';
import {nameInfo} from './protocol.js';
let current=readLocal('current-container','');
try{current=current?nameInfo(current).name:'';}catch{current='';}
export const currentContainer=()=>current;
export function setCurrentContainer(value){current=value?nameInfo(value).name:'';saveLocal('current-container',current);globalThis.dispatchEvent?.(new Event('tapesign:container'));return current;}
export function requireCurrentContainer(){if(!current)throw Error('请先在页面顶部选择自己的容器');return current;}
