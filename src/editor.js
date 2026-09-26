import { validateBody, byteLength, MAX_BODY } from './protocol.js';
export function readEditor(root) {
  const blocks=[]; let current=null;
  const newBlock=type=>{current={type,runs:[]};blocks.push(current);};
  const append=(text,marks)=>{
    if(!current)newBlock('p');
    const last=current.runs.at(-1);
    if(last?.marks===marks)last.text+=text;else current.runs.push({text,marks});
  };
  function walk(node,marks=0) {
    if(node.nodeType===3){append(node.textContent,marks);return;}
    if(node.nodeType!==1)return;
    const tag=node.tagName.toLowerCase();
    if(['script','style','iframe','object','img','svg','math','input','button'].includes(tag))return;
    if(['p','div','h1','h2','h3','li','blockquote'].includes(tag))newBlock(tag.startsWith('h')?'h2':tag==='li'?'li':'p');
    if(tag==='br'){append('\n',marks);return;}
    if(['strong','b'].includes(tag)||['bold','700','800','900'].includes(node.style.fontWeight))marks|=1;
    if(['em','i'].includes(tag)||node.style.fontStyle==='italic')marks|=2;
    if(tag==='u'||node.style.textDecoration.includes('underline'))marks|=4;
    for(const child of node.childNodes)walk(child,marks);
    if(['p','div','h1','h2','h3','li','blockquote'].includes(tag))current=null;
  }
  for(const node of root.childNodes)walk(node);
  return blocks.filter(b=>b.runs.some(r=>r.text.trim()));
}
export function renderBody(body,root) {
  root.replaceChildren();
  for(const block of body){
    const el=document.createElement(block.type==='h2'?'h2':'p');
    if(block.type==='li')el.className='list-line';
    for(const run of block.runs){
      const span=document.createElement('span');span.textContent=run.text;
      if(run.marks&1)span.style.fontWeight='700';if(run.marks&2)span.style.fontStyle='italic';if(run.marks&4)span.style.textDecoration='underline';
      el.append(span);
    }
    root.append(el);
  }
}
export function setupEditor(root,toolbar,counter,onChange) {
  toolbar.querySelectorAll('[data-command]').forEach(button=>{
    button.onmousedown=e=>e.preventDefault();
    button.onclick=()=>{root.focus();document.execCommand(button.dataset.command,false,button.dataset.value||null);update();};
  });
  root.addEventListener('paste',e=>{e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));update();});
  root.addEventListener('drop',e=>e.preventDefault());
  function update(){const body=readEditor(root);counter.textContent=`${byteLength(body).toLocaleString()} / ${MAX_BODY.toLocaleString()} 字节`;counter.classList.toggle('invalid',byteLength(body)>MAX_BODY);onChange?.();}
  root.addEventListener('input',update);update();
  return ()=>validateBody(readEditor(root));
}
