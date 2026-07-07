'use client';
import { useState } from 'react';

type Shape = 'square'|'rectangle'|'circle'|'triangle'|'trapezoid';

export default function AreaPerimeter() {
  const [shape, setShape] = useState<Shape>('rectangle');
  const [a, setA] = useState(8); const [b, setB] = useState(5);
  const [r, setR] = useState(5); const [h, setH] = useState(6);
  const [unit, setUnit] = useState<'cm'|'m'>('cm');
  const pi = Math.PI;
  let area = 0; let perim = 0; let aFml = ''; let pFml = '';
  if (shape==='square') { area=a*a; perim=4*a; aFml=`A = a² = ${a}²`; pFml=`P = 4a = 4×${a}`; }
  else if (shape==='rectangle') { area=a*b; perim=2*(a+b); aFml=`A = l×b = ${a}×${b}`; pFml=`P = 2(l+b) = 2(${a}+${b})`; }
  else if (shape==='circle') { area=pi*r*r; perim=2*pi*r; aFml=`A = πr² = π×${r}²`; pFml=`C = 2πr = 2π×${r}`; }
  else if (shape==='triangle') { area=0.5*b*h; perim=b+a+Math.sqrt(b*b/4+h*h)*2; aFml=`A = ½bh = ½×${b}×${h}`; pFml=`P = b + 2×slant`; }
  else { area=0.5*(a+b)*h; perim=a+b+2*Math.sqrt(h*h+((b-a)/2)**2); aFml=`A = ½(a+b)h = ½(${a}+${b})×${h}`; pFml=`P = sum of all sides`; }

  const W = 460; const H = 200; const pad = 40;
  const scale = (v: number) => v * ((W-pad*2) / 24);

  const renderShape = () => {
    const fill = 'rgba(249,115,22,0.18)'; const stroke = 'var(--purple)'; const sw = 2.5;
    if (shape==='square') { const s=scale(a); const x=(W-s)/2; const y=(H-s)/2; return <rect x={x} y={y} width={s} height={s} fill={fill} stroke={stroke} strokeWidth={sw} />; }
    if (shape==='rectangle') { const w=scale(a); const hh=scale(b); const x=(W-w)/2; const y=(H-hh)/2; return <rect x={x} y={y} width={w} height={hh} fill={fill} stroke={stroke} strokeWidth={sw} />; }
    if (shape==='circle') { return <circle cx={W/2} cy={H/2} r={scale(r)/2} fill={fill} stroke={stroke} strokeWidth={sw} />; }
    if (shape==='triangle') { const bw=scale(b); const hh=scale(h); const x1=(W-bw)/2; const x2=x1+bw; const x3=W/2; const y1=H/2+hh/2; const y2=H/2+hh/2; const y3=H/2-hh/2; return <polygon points={`${x1},${y1} ${x2},${y2} ${x3},${y3}`} fill={fill} stroke={stroke} strokeWidth={sw} />; }
    const tw=scale(a); const bw=scale(b); const hh=scale(h); const cx=W/2; const off=(bw-tw)/2; const y1=H/2+hh/2; const y2=H/2-hh/2;
    return <polygon points={`${cx-bw/2},${y1} ${cx+bw/2},${y1} ${cx+bw/2-off},${y2} ${cx-bw/2+off},${y2}`} fill={fill} stroke={stroke} strokeWidth={sw} />;
  };

  const dimLabels = () => {
    if (shape==='square') return <text x={W/2} y={H/2+scale(a)/2+14} textAnchor="middle" fontSize={11} fill="var(--text-2)">{a} {unit}</text>;
    if (shape==='rectangle') return <><text x={W/2} y={H/2+scale(b)/2+14} textAnchor="middle" fontSize={11} fill="var(--text-2)">{a} {unit}</text><text x={(W-scale(a))/2-8} y={H/2} textAnchor="end" fontSize={11} fill="var(--text-2)">{b} {unit}</text></>;
    if (shape==='circle') return <text x={W/2} y={H/2+14} textAnchor="middle" fontSize={11} fill="var(--text-2)">r={r} {unit}</text>;
    if (shape==='triangle') return <text x={W/2} y={H/2+scale(h)/2+14} textAnchor="middle" fontSize={11} fill="var(--text-2)">b={b}, h={h} {unit}</text>;
    return <text x={W/2} y={H/2+scale(h)/2+14} textAnchor="middle" fontSize={11} fill="var(--text-2)">a={a}, b={b}, h={h} {unit}</text>;
  };

  const btnStyle = (active: boolean) => ({ padding:'5px 12px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:600, fontSize:12, background: active?'var(--purple)':'var(--surface-2)', color: active?'#fff':'var(--text-1)' });
  const shapes: Shape[] = ['square','rectangle','circle','triangle','trapezoid'];

  return (
    <div style={{ background:'var(--surface-1)', borderRadius:12, padding:16, maxWidth:600, margin:'0 auto', fontFamily:'inherit' }}>
      <h3 style={{ color:'var(--text-1)', fontSize:16, fontWeight:700, marginBottom:8 }}>Area & Perimeter Explorer</h3>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background:'var(--surface-2)', borderRadius:8, display:'block' }}>
        {renderShape()}{dimLabels()}
      </svg>
      <div style={{ display:'flex', gap:6, marginTop:10, flexWrap:'wrap', justifyContent:'center' }}>
        {shapes.map(s => <button key={s} onClick={()=>setShape(s)} style={btnStyle(shape===s)}>{s.charAt(0).toUpperCase()+s.slice(1)}</button>)}
        <button onClick={()=>setUnit(u=>u==='cm'?'m':'cm')} style={{ ...btnStyle(false), marginLeft:8, color:'var(--orange)', fontWeight:700 }}>Unit: {unit}</button>
      </div>
      {(shape==='square'||shape==='rectangle'||shape==='trapezoid') && (
        <div style={{ marginTop:8 }}>
          <label style={{ color:'var(--text-2)', fontSize:12 }}>{shape==='trapezoid'?'Top (a)':'Length (a)'}: {a} {unit}</label>
          <input type="range" min={2} max={14} value={a} onChange={e=>setA(+e.target.value)} style={{ width:'100%' }} />
        </div>
      )}
      {(shape==='rectangle'||shape==='triangle'||shape==='trapezoid') && (
        <div style={{ marginTop:4 }}>
          <label style={{ color:'var(--text-2)', fontSize:12 }}>{shape==='trapezoid'?'Bottom (b)':shape==='triangle'?'Base (b)':'Width (b)'}: {b} {unit}</label>
          <input type="range" min={2} max={14} value={b} onChange={e=>setB(+e.target.value)} style={{ width:'100%' }} />
        </div>
      )}
      {shape==='circle' && (
        <div style={{ marginTop:8 }}>
          <label style={{ color:'var(--text-2)', fontSize:12 }}>Radius (r): {r} {unit}</label>
          <input type="range" min={1} max={9} value={r} onChange={e=>setR(+e.target.value)} style={{ width:'100%' }} />
        </div>
      )}
      {(shape==='triangle'||shape==='trapezoid') && (
        <div style={{ marginTop:4 }}>
          <label style={{ color:'var(--text-2)', fontSize:12 }}>Height (h): {h} {unit}</label>
          <input type="range" min={2} max={12} value={h} onChange={e=>setH(+e.target.value)} style={{ width:'100%' }} />
        </div>
      )}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:10 }}>
        <div style={{ padding:'8px 12px', background:'var(--surface-2)', borderRadius:8, fontSize:12, color:'var(--text-1)', textAlign:'center' }}>
          {aFml}<br/><b style={{ color:'var(--orange)', fontSize:14 }}>Area = {area.toFixed(2)} {unit}²</b>
        </div>
        <div style={{ padding:'8px 12px', background:'var(--surface-2)', borderRadius:8, fontSize:12, color:'var(--text-1)', textAlign:'center' }}>
          {pFml}<br/><b style={{ color:'var(--purple)', fontSize:14 }}>{shape==='circle'?'Circumference':'Perimeter'} = {perim.toFixed(2)} {unit}</b>
        </div>
      </div>
    </div>
  );
}
