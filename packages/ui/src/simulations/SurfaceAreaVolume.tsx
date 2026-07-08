'use client';
import { useState } from 'react';

type Shape3D = 'cube'|'cuboid'|'cylinder'|'cone'|'sphere';
const PI = Math.PI;

export default function SurfaceAreaVolume() {
  const [shape, setShape] = useState<Shape3D>('cylinder');
  const [a, setA] = useState(5); const [r, setR] = useState(4);
  const [h, setH] = useState(7); const [b, setB] = useState(6);
  const [showNet, setShowNet] = useState(false);

  let sa=0; let vol=0; let saFml=''; let vFml='';
  const l=Math.sqrt(r**2+h**2);
  if(shape==='cube'){sa=6*a*a;vol=a**3;saFml=`6a² = 6×${a}²`;vFml=`a³ = ${a}³`;}
  else if(shape==='cuboid'){sa=2*(a*b+b*h+h*a);vol=a*b*h;saFml=`2(lb+bh+hl)`;vFml=`l×b×h = ${a}×${b}×${h}`;}
  else if(shape==='cylinder'){sa=2*PI*r*(r+h);vol=PI*r*r*h;saFml=`2πr(r+h) = 2π×${r}×(${r}+${h})`;vFml=`πr²h = π×${r}²×${h}`;}
  else if(shape==='cone'){const sl=l.toFixed(2);sa=PI*r*(r+l);vol=(1/3)*PI*r*r*h;saFml=`πr(r+l) = π×${r}×(${r}+${sl})`;vFml=`⅓πr²h = ⅓π×${r}²×${h}`;}
  else{sa=4*PI*r*r;vol=(4/3)*PI*r**3;saFml=`4πr² = 4π×${r}²`;vFml=`⁴⁄₃πr³ = ⁴⁄₃π×${r}³`;}

  const W=460; const H=220;
  const renderShapeView=()=>{
    const cx=W/2; const cy=H/2;
    if(shape==='cube'||shape==='cuboid'){
      const fw=shape==='cube'?a*14:a*12; const fh=shape==='cube'?a*14:b*12;
      const off=h*(shape==='cube'?6:5); const ox=off*0.8; const oy=off*0.5;
      const x=cx-fw/2; const y=cy-fh/2;
      return(<>
        <polygon points={`${x+ox},${y-oy} ${x+ox+fw},${y-oy} ${x+fw},${y} ${x},${y}`} fill="rgba(249,115,22,0.25)" stroke="var(--purple)" strokeWidth="2"/>
        <rect x={x} y={y} width={fw} height={fh} fill="rgba(249,115,22,0.18)" stroke="var(--orange)" strokeWidth="2"/>
        <polygon points={`${x+fw},${y} ${x+fw+ox},${y-oy} ${x+fw+ox},${y+fh-oy} ${x+fw},${y+fh}`} fill="rgba(249,115,22,0.1)" stroke="var(--purple)" strokeWidth="2"/>
        <line x1={x} y1={y+fh} x2={x+ox} y2={y+fh-oy} stroke="var(--text-2)" strokeWidth="1" strokeDasharray="4,3"/>
        <line x1={x+ox} y1={y+fh-oy} x2={x+fw+ox} y2={y+fh-oy} stroke="var(--text-2)" strokeWidth="1" strokeDasharray="4,3"/>
        <line x1={x+ox} y1={y-oy} x2={x+ox} y2={y+fh-oy} stroke="var(--text-2)" strokeWidth="1" strokeDasharray="4,3"/>
        <text x={cx} y={y+fh+20} textAnchor="middle" fontSize="10" fill="var(--text-2)">{shape==='cube'?`a=${a}`:`l=${a}, b=${b}, h=${h}`}</text>
      </>);
    }
    if(shape==='cylinder'){
      const rr=Math.min(r*10,70); const hh=Math.min(h*12,140); const ey=hh*0.18;
      const x=cx; const y=cy-hh/2;
      return(<>
        <ellipse cx={x} cy={y+hh} rx={rr} ry={ey} fill="rgba(249,115,22,0.2)" stroke="var(--orange)" strokeWidth="2"/>
        <rect x={x-rr} y={y} width={rr*2} height={hh} fill="rgba(249,115,22,0.15)" stroke="none"/>
        <line x1={x-rr} y1={y} x2={x-rr} y2={y+hh} stroke="var(--orange)" strokeWidth="2"/>
        <line x1={x+rr} y1={y} x2={x+rr} y2={y+hh} stroke="var(--orange)" strokeWidth="2"/>
        <ellipse cx={x} cy={y} rx={rr} ry={ey} fill="rgba(249,115,22,0.3)" stroke="var(--purple)" strokeWidth="2"/>
        <text x={x+rr+8} y={y+hh/2} fontSize="10" fill="var(--text-2)">h={h}</text>
        <text x={x} y={y-ey-6} textAnchor="middle" fontSize="10" fill="var(--text-2)">r={r}</text>
      </>);
    }
    if(shape==='cone'){
      const rr=Math.min(r*10,80); const hh=Math.min(h*14,160); const ey=rr*0.25;
      const y1=cy-hh/2; const y2=cy+hh/2;
      return(<>
        <ellipse cx={cx} cy={y2} rx={rr} ry={ey} fill="rgba(249,115,22,0.25)" stroke="var(--orange)" strokeWidth="2"/>
        <line x1={cx-rr} y1={y2} x2={cx} y2={y1} stroke="var(--purple)" strokeWidth="2"/>
        <line x1={cx+rr} y1={y2} x2={cx} y2={y1} stroke="var(--purple)" strokeWidth="2"/>
        <line x1={cx} y1={y1} x2={cx} y2={y2} stroke="var(--text-2)" strokeWidth="1" strokeDasharray="4,3"/>
        <text x={cx+8} y={(y1+y2)/2} fontSize="10" fill="var(--text-2)">h={h}</text>
        <text x={cx} y={y2+ey+14} textAnchor="middle" fontSize="10" fill="var(--text-2)">r={r}</text>
      </>);
    }
    const rr=Math.min(r*16,100);
    return(<>
      <circle cx={cx} cy={cy} r={rr} fill="rgba(249,115,22,0.2)" stroke="var(--orange)" strokeWidth="2.5"/>
      <ellipse cx={cx} cy={cy} rx={rr} ry={rr*0.25} fill="none" stroke="var(--purple)" strokeWidth="1.5" strokeDasharray="5,4"/>
      <line x1={cx} y1={cy} x2={cx+rr} y2={cy} stroke="var(--text-2)" strokeWidth="1" strokeDasharray="3,3"/>
      <text x={cx+rr/2} y={cy-6} textAnchor="middle" fontSize="10" fill="var(--text-2)">r={r}</text>
    </>);
  };

  const btnStyle=(active:boolean)=>({ padding:'5px 12px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:600, fontSize:11, background:active?'var(--purple)':'var(--surface-2)', color:active?'#fff':'var(--text-1)' });
  const shapes:Shape3D[]=['cube','cuboid','cylinder','cone','sphere'];

  return (
    <div style={{ background:'var(--surface-1)', borderRadius:12, padding:16, maxWidth:600, margin:'0 auto', fontFamily:'inherit' }}>
      <h3 style={{ color:'var(--text-1)', fontSize:16, fontWeight:700, marginBottom:8 }}>Surface Area & Volume</h3>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background:'var(--surface-2)', borderRadius:8, display:'block' }}>
        {renderShapeView()}
      </svg>
      <div style={{ display:'flex', gap:6, marginTop:10, flexWrap:'wrap', justifyContent:'center' }}>
        {shapes.map(s=><button key={s} onClick={()=>setShape(s)} style={btnStyle(shape===s)}>{s.charAt(0).toUpperCase()+s.slice(1)}</button>)}
        <button onClick={()=>setShowNet(n=>!n)} style={{ ...btnStyle(showNet), background:showNet?'var(--orange)':'var(--surface-2)', color:showNet?'#fff':'var(--text-1)' }}>Show Net</button>
      </div>
      {(shape==='cube'||shape==='cuboid')&&<div style={{marginTop:8}}><label style={{color:'var(--text-2)',fontSize:12}}>Side a: {a}</label><input type="range" min={2} max={10} value={a} onChange={e=>setA(+e.target.value)} style={{width:'100%'}}/></div>}
      {shape==='cuboid'&&<><div style={{marginTop:4}}><label style={{color:'var(--text-2)',fontSize:12}}>Width b: {b}</label><input type="range" min={2} max={10} value={b} onChange={e=>setB(+e.target.value)} style={{width:'100%'}}/></div><div style={{marginTop:4}}><label style={{color:'var(--text-2)',fontSize:12}}>Height h: {h}</label><input type="range" min={2} max={10} value={h} onChange={e=>setH(+e.target.value)} style={{width:'100%'}}/></div></>}
      {(shape==='cylinder'||shape==='cone'||shape==='sphere')&&<div style={{marginTop:8}}><label style={{color:'var(--text-2)',fontSize:12}}>Radius r: {r}</label><input type="range" min={1} max={9} value={r} onChange={e=>setR(+e.target.value)} style={{width:'100%'}}/></div>}
      {(shape==='cylinder'||shape==='cone')&&<div style={{marginTop:4}}><label style={{color:'var(--text-2)',fontSize:12}}>Height h: {h}</label><input type="range" min={2} max={14} value={h} onChange={e=>setH(+e.target.value)} style={{width:'100%'}}/></div>}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:10 }}>
        <div style={{ padding:'8px 12px', background:'var(--surface-2)', borderRadius:8, fontSize:12, textAlign:'center' }}>
          <div style={{color:'var(--text-2)'}}>SA = {saFml}</div>
          <b style={{color:'var(--orange)',fontSize:15}}>{sa.toFixed(2)} units²</b>
        </div>
        <div style={{ padding:'8px 12px', background:'var(--surface-2)', borderRadius:8, fontSize:12, textAlign:'center' }}>
          <div style={{color:'var(--text-2)'}}>V = {vFml}</div>
          <b style={{color:'var(--purple)',fontSize:15}}>{vol.toFixed(2)} units³</b>
        </div>
      </div>
      {showNet&&<div style={{marginTop:8,padding:'8px',background:'var(--surface-2)',borderRadius:8,fontSize:11,color:'var(--text-2)',textAlign:'center'}}>Net view: unfolded surfaces of {shape} showing all {shape==='cube'?6:shape==='cuboid'?6:shape==='cylinder'?3:2} faces</div>}
    </div>
  );
}
