'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

type Pt = {x:number;y:number};
const LABELS = ['A','B','C'];
const PTCOLORS = ['var(--orange)','var(--purple)','#22c55e'];

export default function CoordinateGeometry() {
  const [pts, setPts] = useState<Pt[]>([{x:2,y:3},{x:6,y:7}]);
  const [dragging, setDragging] = useState<number|null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const W=520; const H=300; const pad=30; const cells=20;
  const cw=(W-pad*2)/cells; const ch=(H-pad*2)/cells;
  const toCanvas=(p:Pt)=>({x:pad+(p.x+10)*cw, y:pad+(10-p.y)*ch});
  const toGrid=(cx:number,cy:number)=>({x:Math.round((cx-pad)/cw-10), y:Math.round(10-(cy-pad)/ch)});

  const dist=(a:Pt,b:Pt)=>Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2);
  const midPt=(a:Pt,b:Pt)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const slopeFn=(a:Pt,b:Pt)=>a.x===b.x?Infinity:(b.y-a.y)/(b.x-a.x);
  const triArea=(a:Pt,b:Pt,c:Pt)=>Math.abs((b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y))/2;

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d')!; ctx.clearRect(0,0,W,H);
    // Grid
    ctx.strokeStyle='rgba(128,128,128,0.2)'; ctx.lineWidth=0.5;
    for(let i=0;i<=cells;i++){
      const x=pad+i*cw; ctx.beginPath(); ctx.moveTo(x,pad); ctx.lineTo(x,H-pad); ctx.stroke();
      const y=pad+i*ch; ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(W-pad,y); ctx.stroke();
    }
    // Axes
    const ox=pad+10*cw; const oy=pad+10*ch;
    ctx.strokeStyle='var(--text-2)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(pad,oy); ctx.lineTo(W-pad,oy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox,pad); ctx.lineTo(ox,H-pad); ctx.stroke();
    ctx.fillStyle='var(--text-2)'; ctx.font='9px sans-serif'; ctx.textAlign='center';
    for(let i=-9;i<=10;i+=2){if(i!==0){
      ctx.fillText(String(i),pad+(i+10)*cw,oy+12);
      ctx.fillText(String(-i),ox-12,pad+(i+10)*ch+3);
    }}
    // Line AB
    if(pts.length>=2){
      const ca=toCanvas(pts[0]); const cb=toCanvas(pts[1]);
      ctx.beginPath(); ctx.moveTo(ca.x,ca.y); ctx.lineTo(cb.x,cb.y);
      ctx.strokeStyle='var(--orange)'; ctx.lineWidth=2; ctx.setLineDash([6,3]); ctx.stroke(); ctx.setLineDash([]);
      const M=midPt(pts[0],pts[1]); const cm=toCanvas(M);
      ctx.beginPath(); ctx.arc(cm.x,cm.y,4,0,Math.PI*2); ctx.fillStyle='#facc15'; ctx.fill();
      ctx.fillStyle='var(--text-1)'; ctx.font='9px sans-serif'; ctx.textAlign='left';
      ctx.fillText('M('+M.x.toFixed(1)+','+M.y.toFixed(1)+')',cm.x+5,cm.y-5);
    }
    // Triangle
    if(pts.length===3){
      const [ca,cb,cc]=[toCanvas(pts[0]),toCanvas(pts[1]),toCanvas(pts[2])];
      ctx.beginPath(); ctx.moveTo(ca.x,ca.y); ctx.lineTo(cb.x,cb.y); ctx.lineTo(cc.x,cc.y); ctx.closePath();
      ctx.fillStyle='rgba(124,58,237,0.12)'; ctx.fill();
      ctx.strokeStyle='var(--purple)'; ctx.lineWidth=1.5; ctx.stroke();
    }
    // Points
    pts.forEach((p,i)=>{
      const c=toCanvas(p);
      ctx.beginPath(); ctx.arc(c.x,c.y,7,0,Math.PI*2);
      ctx.fillStyle=PTCOLORS[i]; ctx.fill();
      ctx.fillStyle='var(--text-1)'; ctx.font='bold 11px sans-serif'; ctx.textAlign='center';
      ctx.fillText(LABELS[i],c.x,c.y-11);
      ctx.fillText('('+p.x+','+p.y+')',c.x,c.y+18);
    });
  },[pts]);

  const getPos=(e:React.MouseEvent<HTMLCanvasElement>)=>{
    const rect=canvasRef.current!.getBoundingClientRect();
    const sx=W/rect.width; const sy=H/rect.height;
    return {cx:(e.clientX-rect.left)*sx, cy:(e.clientY-rect.top)*sy};
  };
  const onMouseDown=useCallback((e:React.MouseEvent<HTMLCanvasElement>)=>{
    const {cx,cy}=getPos(e);
    const idx=pts.findIndex(p=>{const c=toCanvas(p); return Math.hypot(c.x-cx,c.y-cy)<12;});
    if(idx>=0) setDragging(idx);
    else if(pts.length<3){
      const g=toGrid(cx,cy);
      const clamped={x:Math.max(-10,Math.min(10,g.x)),y:Math.max(-10,Math.min(10,g.y))};
      setPts(prev=>[...prev,clamped]);
    }
  },[pts]);
  const onMouseMove=useCallback((e:React.MouseEvent<HTMLCanvasElement>)=>{
    if(dragging===null) return;
    const {cx,cy}=getPos(e); const g=toGrid(cx,cy);
    const clamped={x:Math.max(-10,Math.min(10,g.x)),y:Math.max(-10,Math.min(10,g.y))};
    setPts(prev=>{const n=[...prev]; n[dragging]=clamped; return n;});
  },[dragging]);
  const onMouseUp=useCallback(()=>setDragging(null),[]);

  const [A,B,C]=[pts[0],pts[1],pts[2]];
  const dAB=A&&B?dist(A,B):null;
  const M=A&&B?midPt(A,B):null;
  const sl=A&&B?slopeFn(A,B):null;
  const bInt=A&&B&&sl!==null&&isFinite(sl)?A.y-sl*A.x:null;
  const perimeter=A&&B&&C?dist(A,B)+dist(B,C)+dist(C,A):null;
  const area=A&&B&&C?triArea(A,B,C):null;

  return (
    <div style={{ background:'var(--surface-1)', borderRadius:12, padding:16, maxWidth:600, margin:'0 auto', fontFamily:'inherit' }}>
      <h3 style={{ color:'var(--text-1)', fontSize:16, fontWeight:700, marginBottom:4 }}>Coordinate Geometry</h3>
      <p style={{ color:'var(--text-2)', fontSize:11, marginBottom:8 }}>Click to place points (max 3). Drag to move.</p>
      <canvas ref={canvasRef} width={W} height={H} style={{ width:'100%', borderRadius:8, background:'var(--surface-2)', display:'block', cursor:'crosshair' }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} />
      <button onClick={()=>setPts([{x:2,y:3},{x:6,y:7}])} style={{ marginTop:8, padding:'5px 14px', borderRadius:6, border:'none', cursor:'pointer', background:'var(--surface-2)', color:'var(--text-1)', fontSize:12 }}>Reset</button>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginTop:8 }}>
        {dAB!==null&&<div style={{ padding:'6px 10px', background:'var(--surface-2)', borderRadius:8, fontSize:12 }}><span style={{color:'var(--text-2)'}}>|AB| = </span><b style={{color:'var(--orange)'}}>{dAB.toFixed(3)}</b></div>}
        {M&&<div style={{ padding:'6px 10px', background:'var(--surface-2)', borderRadius:8, fontSize:12 }}><span style={{color:'var(--text-2)'}}>Midpoint M = </span><b style={{color:'#facc15'}}>({M.x.toFixed(1)}, {M.y.toFixed(1)})</b></div>}
        {sl!==null&&isFinite(sl)&&<div style={{ padding:'6px 10px', background:'var(--surface-2)', borderRadius:8, fontSize:12 }}><span style={{color:'var(--text-2)'}}>Slope = </span><b style={{color:'var(--purple)'}}>{sl.toFixed(3)}</b></div>}
        {bInt!==null&&<div style={{ padding:'6px 10px', background:'var(--surface-2)', borderRadius:8, fontSize:12 }}><span style={{color:'var(--text-2)'}}>Line AB: </span><b style={{color:'var(--orange)'}}>y = {sl!.toFixed(2)}x + {bInt.toFixed(2)}</b></div>}
        {perimeter!==null&&<div style={{ padding:'6px 10px', background:'var(--surface-2)', borderRadius:8, fontSize:12 }}><span style={{color:'var(--text-2)'}}>Perimeter = </span><b style={{color:'var(--purple)'}}>{perimeter.toFixed(3)}</b></div>}
        {area!==null&&<div style={{ padding:'6px 10px', background:'var(--surface-2)', borderRadius:8, fontSize:12 }}><span style={{color:'var(--text-2)'}}>Area = </span><b style={{color:'#22c55e'}}>{area.toFixed(3)}</b></div>}
      </div>
      <div style={{ marginTop:6, padding:'6px 12px', background:'var(--surface-2)', borderRadius:8, fontSize:11, color:'var(--text-2)', textAlign:'center' }}>
        Formula: <b style={{ color:'var(--orange)' }}>d = sqrt[(dx)^2 + (dy)^2] | M = ((x1+x2)/2, (y1+y2)/2)</b>
      </div>
    </div>
  );
}
