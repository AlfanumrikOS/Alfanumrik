'use client';
import { useState, useRef, useEffect } from 'react';

function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }
function lcm(a: number, b: number): number { return (a * b) / gcd(a, b); }

function drawPie(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, num: number, den: number, color: string, label: string) {
  const whole = Math.floor(num / den);
  const rem = num % den;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'var(--surface-1)'; ctx.fill();
  ctx.strokeStyle = 'var(--text-2)'; ctx.lineWidth = 1; ctx.stroke();
  const filled = Math.min(num / den, 1);
  if (filled > 0) {
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + filled * Math.PI * 2);
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  for (let i = 0; i < den; i++) {
    const angle = -Math.PI / 2 + (i / den) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    ctx.strokeStyle = 'var(--surface-2)'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.fillStyle = 'var(--text-1)'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy + r + 16);
  if (whole > 0) {
    ctx.fillStyle = 'var(--text-2)'; ctx.font = '10px sans-serif';
    ctx.fillText(`+${whole} whole`, cx, cy + r + 28);
  }
  if (rem === 0 && num > 0 && num >= den) {
    ctx.fillText(`(${num / den})`, cx, cy - r - 5);
  }
}

export default function FractionOperations() {
  const [n1, setN1] = useState(1); const [d1, setD1] = useState(2);
  const [n2, setN2] = useState(1); const [d2, setD2] = useState(3);
  const [op, setOp] = useState<'add'|'sub'|'mul'|'div'>('add');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const compute = () => {
    if (op === 'add') { const l = lcm(d1, d2); return [n1*(l/d1)+n2*(l/d2), l]; }
    if (op === 'sub') { const l = lcm(d1, d2); return [n1*(l/d1)-n2*(l/d2), l]; }
    if (op === 'mul') { return [n1*n2, d1*d2]; }
    return [n1*d2, d1*n2];
  };
  const [rn, rd] = compute();
  const g = gcd(Math.abs(rn), Math.abs(rd));
  const rns = rn/g; const rds = rd/g;
  const whole = Math.floor(Math.abs(rns)/Math.abs(rds)) * (rns<0?-1:1);
  const rem = Math.abs(rns) % Math.abs(rds);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawPie(ctx, 90, 75, 55, n1, d1, 'var(--orange)', `${n1}/${d1}`);
    drawPie(ctx, 230, 75, 55, n2, d2, 'var(--purple)', `${n2}/${d2}`);
    const absRn = Math.abs(rns); const absRd = Math.abs(rds);
    if (absRd > 0) drawPie(ctx, 370, 75, 55, absRn, absRd, '#22c55e', `${rns}/${rds}`);
    ctx.fillStyle = 'var(--text-2)'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
    const sym = op==='add'?'+':op==='sub'?'−':op==='mul'?'×':'÷';
    ctx.fillText(sym, 160, 80); ctx.fillText('=', 300, 80);
  }, [n1, d1, n2, d2, op, rns, rds]);

  const fmla = op==='add'?'a/b + c/d = (ad+bc)/bd': op==='sub'?'a/b − c/d = (ad−bc)/bd': op==='mul'?'a/b × c/d = ac/bd':'a/b ÷ c/d = ad/bc';
  const btnStyle = (active: boolean) => ({ padding:'6px 14px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, background: active?'var(--orange)':'var(--surface-2)', color: active?'#fff':'var(--text-1)' });

  return (
    <div style={{ background:'var(--surface-1)', borderRadius:12, padding:16, maxWidth:600, margin:'0 auto', fontFamily:'inherit' }}>
      <h3 style={{ color:'var(--text-1)', fontSize:16, fontWeight:700, marginBottom:8 }}>Fraction Operations</h3>
      <canvas ref={canvasRef} width={460} height={160} style={{ width:'100%', borderRadius:8, background:'var(--surface-2)', display:'block' }} />
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:10 }}>
        {[['Fraction A', n1, setN1, d1, setD1],['Fraction B', n2, setN2, d2, setD2]].map(([lbl, n, sn, d, sd], i) => (
          <div key={i} style={{ background:'var(--surface-2)', borderRadius:8, padding:10 }}>
            <div style={{ color:'var(--text-2)', fontSize:12, marginBottom:4 }}>{lbl as string}: {n as number}/{d as number}</div>
            <label style={{ color:'var(--text-2)', fontSize:11 }}>Numerator</label>
            <input type="range" min={1} max={10} value={n as number} onChange={e=>(sn as (v:number)=>void)(+e.target.value)} style={{ width:'100%' }} />
            <label style={{ color:'var(--text-2)', fontSize:11 }}>Denominator</label>
            <input type="range" min={1} max={12} value={d as number} onChange={e=>(sd as (v:number)=>void)(+e.target.value)} style={{ width:'100%' }} />
          </div>
        ))}
      </div>
      <div style={{ display:'flex', gap:8, marginTop:10, justifyContent:'center' }}>
        {(['add','sub','mul','div'] as const).map(o => (
          <button key={o} onClick={()=>setOp(o)} style={btnStyle(op===o)}>{o==='add'?'Add':o==='sub'?'Subtract':o==='mul'?'Multiply':'Divide'}</button>
        ))}
      </div>
      <div style={{ marginTop:8, padding:'8px 12px', background:'var(--surface-2)', borderRadius:8, fontSize:13, color:'var(--text-1)', textAlign:'center' }}>
        Result: <b style={{ color:'var(--orange)' }}>{rns}/{rds}</b>
        {rem !== 0 && <span style={{ color:'var(--purple)', marginLeft:8 }}>= {whole} {rem}/{Math.abs(rds)}</span>}
        {rem === 0 && rds !== 0 && rns%rds===0 && <span style={{ color:'var(--purple)', marginLeft:8 }}>= {rns/rds}</span>}
      </div>
      <div style={{ marginTop:6, padding:'6px 12px', background:'var(--surface-2)', borderRadius:8, fontSize:12, color:'var(--text-2)', textAlign:'center' }}>
        Formula: <b style={{ color:'var(--orange)' }}>{fmla}</b>
      </div>
    </div>
  );
}
