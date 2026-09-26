import { validateInk, MAX_INK_POINTS } from './protocol.js';
function distance(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1], t=dx||dy?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy))):0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
}
function simplify(points,tolerance){
  if(points.length<=2)return points;
  let index=0,max=0;
  for(let i=1;i<points.length-1;i++){const d=distance(points[i],points[0],points.at(-1));if(d>max){max=d;index=i;}}
  return max>tolerance?[...simplify(points.slice(0,index+1),tolerance).slice(0,-1),...simplify(points.slice(index),tolerance)]:[points[0],points.at(-1)];
}
export function drawInk(canvas,ink){
  canvas.width=1000;canvas.height=400;
  const c=canvas.getContext('2d');c.clearRect(0,0,1000,400);c.lineWidth=3;c.strokeStyle='#233b36';c.lineCap='round';c.lineJoin='round';
  for(const stroke of ink){c.beginPath();stroke.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
}
export class SignaturePad {
  constructor(canvas,placeholder){
    this.canvas=canvas;this.placeholder=placeholder;this.strokes=[];this.active=null;
    drawInk(canvas,[]);
    const point=e=>{const r=canvas.getBoundingClientRect();return [Math.round(Math.max(0,Math.min(1000,(e.clientX-r.left)/r.width*1000))),Math.round(Math.max(0,Math.min(400,(e.clientY-r.top)/r.height*400)))];};
    canvas.addEventListener('pointerdown',e=>{if(e.button!==0||this.active!==null||this.strokes.length>=30)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);this.active=e.pointerId;this.strokes.push([point(e)]);this.paint();});
    canvas.addEventListener('pointermove',e=>{if(e.pointerId!==this.active)return;const s=this.strokes.at(-1),p=point(e),last=s.at(-1);if(s.length<1500&&Math.hypot(p[0]-last[0],p[1]-last[1])>=2){s.push(p);this.paint();}});
    const finish=e=>{if(e.pointerId!==this.active)return;const s=this.strokes.at(-1);if(s.length<2)this.strokes.pop();this.active=null;this.paint();};
    canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);canvas.addEventListener('lostpointercapture',finish);
  }
  paint(){drawInk(this.canvas,this.strokes);if(this.placeholder)this.placeholder.hidden=!!this.strokes.length;}
  clear(){this.strokes=[];this.active=null;this.paint();}
  undo(){this.strokes.pop();this.paint();}
  value(){
    let tolerance=1,ink=this.strokes.map(s=>simplify(s,tolerance));
    while(ink.flat().length>MAX_INK_POINTS&&tolerance<30){tolerance+=0.5;ink=this.strokes.map(s=>simplify(s,tolerance));}
    validateInk(ink);this.strokes=ink;this.paint();return structuredClone(ink);
  }
}
