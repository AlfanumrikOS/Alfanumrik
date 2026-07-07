'use client';
import { useState, useRef, useEffect } from 'react';

export default function NumberLine() {
  const [a, setA] = useState(3); const [b, setB] = useState(4);
  const [op, setOp] = useState<'add'|'sub'|'mul'|'div'>('add');
  const [absMode, setAbsMode] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const result = () => {
    const av = absMode ? Math.abs(a) : a; const bv = absMode ? Math.abs(b) : b;
    if (op==='add') return av+bv;
    if (op==='sub') return av-bv;
    if (op==='mul') return av*bv;
    if (bv===0) return NaN;
    return av/bv;
  };

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!; const W=canvas.width; const H=canvas.height;
    ctx.clearRect(0, 0, W, H);
    const av = absMode ? Math.abs(a) : a; const bv = absMode ? Math.abs(b) : b;
    const res = op==='div' ? (bv===0?NaN:av/bv) : op==='add'?av+bv : op==='sub'?av-bv : av*bv;
    const cx = W/2; const cy = H/2; const unit = W/44; // -22 to +22 range
    const toX = (v: number) => cx + v*unit;

    // Grid lines
    for (let i=-20; i<=20; i++) {
      const x=toX(i); ctx.beginPath(); ctx.moveTo(x,cy-4); ctx.lineTo(x,cy+4);
      ctx.strokeStyle='var(--text-2)'; ctx.lineWidth=1; ctx.stroke();
      if (i%5===0) { ctx.fillStyle='var(--text-2)'; ctx.font='10px sans-serif'; ctx.textAlign='center'; ctx.fillText(String(i),x,cy+18); }
    }
    // Main axis
    ctx.beginPath(); ctx.moveTo(toX(-21),cy); ctx.lineTo(toX(21),cy);
    ctx.strokeStyle='var(--text-1)'; ctx.lineWidth=2; ctx.stroke();

    // A position
    const ax=toX(av);
    ctx.beginPath(); ctx.arc(ax, cy, 7, 0, Math.PI*2);
    ctx.fillStyle='var(--orange)'; ctx.fill();
    ctx.fillStyle='var(--text-1)'; ctx.font='bold 10px sans-serif'; ctx.textAlign='center';
    ctx.fillText(absMode?`|A|=${Math.abs(a)}`:`A=${a}`, ax, cy-14);

    // Jumps for B
    if (op==='mul') {
      const steps = Math.abs(Math.round(bv));
      const dir = av>=0?1:-1;
      for (let s=0; s<steps && s<15; s++) {
        const sx = toX(dir*s); const ex = toX(dir*(s+1));
        ctx.beginPath(); ctx.moveTo(sx,cy-15); ctx.bezierCurveTo(sx+dir*8,cy-35,ex-dir*8,cy-35,ex,cy-15);
        ctx.strokeStyle='var(--purple)'; ctx.lineWidth=1.5; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex,cy-15); ctx.lineTo(ex-dir*4,cy-22); ctx.lineTo(ex+dir*2,cy-18); ctx.fillStyle='var(--purple)'; ctx.fill();
      }
    } else if (!isNaN(res) && Math.abs(res)<=20) {
      const rx=toX(res);
      ctx.beginPath(); ctx.moveTo(ax,cy-20); ctx.lineTo(rx,cy-20); ctx.lineTo(rx,cy-10);
      ctx.strokeStyle='var(--purple)'; ctx.lineWidth=2; ctx.setLineDash([4,3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(rx,cy-10); ctx.lineTo(rx-5,cy-18); ctx.lineTo(rx+5,cy-18); ctx.closePath();
      ctx.fillStyle='var(--purple)'; ctx.fill();
    }

    // Result
    if (!isNaN(res) && Math.abs(res)<=20) {
      const rx=toX(res);
      ctx.beginPath(); ctx.arc(rx,cy,7,0,Math.PI*2);
      ctx.fillStyle='#22c55e'; ctx.fill();
      ctx.fillStyle='var(--text-1)'; ctx.font='bold 10px sans-serif'; ctx.textAlign='center';
      ctx.fillText(`=${res%1===0?res:res.toFixed(2)}`,rx,cy+30);
    }
  }, [a, b, op, absMode]);

  const btnStyle = (active: boolean) => ({ padding:'5px 12px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:700, fontSize:12, background: active?'var(--orange)':'var(--surface-2)', color: active?'#fff':'var(--text-1)' });
  const res = result();
  const sym = op==='add'?'+':op==='sub'?'−':op==='mul'?'×':'÷';

  return (
    <div style={{ background:'var(--surface-1)', borderRadius:12, padding:16, maxWidth:600, margin:'0 auto', fontFamily:'inherit' }}>
      <h3 style={{ color:'var(--text-1)', fontSize:16, fontWeight:700, marginBottom:8 }}>Integer Number Line</h3>
      <canvas ref={canvasRef} width={560} height={120} style={{ width:'100%', borderRadius:8, background:'var(--surface-2)', display:'block' }} />
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:10 }}>
        <div>
          <label style={{ color:'var(--text-2)', fontSize:12 }}>A = {absMode?`|${a}|=${Math.abs(a)}`:a}</label>
          <input type="range" min={-10} max={10} value={a} onChange={e=>setA(+e.target.value)} style={{ width:'100%' }} />
        </div>
        <div>
          <label style={{ color:'var(--text-2)', fontSize:12 }}>B = {absMode?`|${b}|=${Math.abs(b)}`:b}</label>
          <input type="range" min={-10} max={10} value={b} onChange={e=>setB(+e.target.value)} style={{ width:'100%' }} />
        </div>
      </div>
      <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap', justifyContent:'center' }}>
        {(['add','sub','mul','div'] as const).map(o=>(
          <button key={o} onClick={()=>setOp(o)} style={btnStyle(op===o)}>{o==='add'?'Add':o==='sub'?'Subtract':o==='mul'?'Multiply':'Divide'}</button>
        ))}
        <button onClick={()=>setAbsMode(v=>!v)} style={{ ...btnStyle(absMode), background: absMode?'var(--purple)':'var(--surface-2)', color: absMode?'#fff':'var(--text-1)' }}>|Absolute|</button>
      </div>
      <div style={{ marginTop:8, padding:'8px 12px', background:'var(--surface-2)', borderRadius:8, fontSize:13, color:'var(--text-1)', textAlign:'center' }}>
        {absMode?`|${a}|`:`(${a})`} {sym} {absMode?`|${b}|`:`(${b})`} = <b style={{ color:'var(--orange)', fontSize:15 }}>{isNaN(res)?'undefined':res%1===0?res:res.toFixed(3)}</b>
        {op==='mul'&&<span style={{ color:'var(--text-2)', fontSize:11, display:'block' }}>Shown as {Math.abs(b)} repeated jumps of {a}</span>}
      </div>
    </div>
  );
}
