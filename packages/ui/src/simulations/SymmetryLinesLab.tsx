'use client';
import { useState, useRef, useEffect } from 'react';

const LETTERS: Record<string,{lines:string[],rot:boolean}> = {
  A:{lines:['vertical'],rot:false}, M:{lines:['vertical'],rot:false}, T:{lines:['vertical'],rot:false},
  U:{lines:['vertical'],rot:false}, V:{lines:['vertical'],rot:false}, W:{lines:['vertical'],rot:false},
  Y:{lines:['vertical'],rot:false}, B:{lines:['horizontal'],rot:false}, C:{lines:['horizontal'],rot:false},
  D:{lines:['horizontal'],rot:false}, E:{lines:['horizontal'],rot:false}, K:{lines:['horizontal'],rot:false},
  H:{lines:['vertical','horizontal'],rot:false}, I:{lines:['vertical','horizontal'],rot:false},
  O:{lines:['vertical','horizontal'],rot:true}, X:{lines:['vertical','horizontal'],rot:true},
  S:{lines:[],rot:true}, N:{lines:[],rot:true}, Z:{lines:[],rot:true},
};

export default function SymmetryLinesLab() {
  const [mode, setMode] = useState<'alphabet'|'polygon'>('alphabet');
  const [letter, setLetter] = useState('A');
  const [sides, setSides] = useState(5);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!; const W=canvas.width; const H=canvas.height;
    ctx.clearRect(0, 0, W, H);
    const cx=W/2; const cy=H/2;

    if (mode==='alphabet') {
      const info = LETTERS[letter] || {lines:[],rot:false};
      ctx.font='bold 110px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillStyle='var(--orange)'; ctx.fillText(letter, cx, cy);
      ctx.setLineDash([8,5]); ctx.lineWidth=2.5;
      if (info.lines.includes('vertical')) {
        ctx.beginPath(); ctx.moveTo(cx,20); ctx.lineTo(cx,H-20);
        ctx.strokeStyle='#ef4444'; ctx.stroke();
      }
      if (info.lines.includes('horizontal')) {
        ctx.beginPath(); ctx.moveTo(40,cy); ctx.lineTo(W-40,cy);
        ctx.strokeStyle='#3b82f6'; ctx.stroke();
      }
      ctx.setLineDash([]);
      if (info.rot) {
        ctx.font='12px sans-serif'; ctx.fillStyle='var(--purple)'; ctx.textBaseline='alphabetic';
        ctx.fillText('↻ Rotational symmetry (order 2)', cx, H-15);
      }
    } else {
      const n = sides; const r=100;
      const pts = Array.from({length:n},(_,i)=>({ x:cx+r*Math.cos(i*2*Math.PI/n-Math.PI/2), y:cy+r*Math.sin(i*2*Math.PI/n-Math.PI/2) }));
      ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
      pts.forEach(p=>ctx.lineTo(p.x,p.y)); ctx.closePath();
      ctx.fillStyle='rgba(249,115,22,0.18)'; ctx.fill();
      ctx.strokeStyle='var(--orange)'; ctx.lineWidth=2.5; ctx.stroke();
      ctx.setLineDash([6,4]); ctx.lineWidth=1.5; ctx.strokeStyle='#ef4444';
      for (let i=0; i<n; i++) {
        const angle = i*2*Math.PI/n - Math.PI/2;
        if (n%2===0) {
          const opp = i+n/2;
          if (i<n/2) { ctx.beginPath(); ctx.moveTo(pts[i].x,pts[i].y); ctx.lineTo(pts[opp].x,pts[opp].y); ctx.stroke(); }
        } else {
          const mx=(pts[i].x+pts[(i+1)%n].x)/2; const my=(pts[i].y+pts[(i+1)%n].y)/2;
          const sx=cx; const sy=cy;
          const ex=cx+(pts[i].x-sx)*2.1; const ey=cy+(pts[i].y-sy)*2.1;
          ctx.beginPath(); ctx.moveTo(cx+(mx-sx)*(-0.3),cy+(my-sy)*(-0.3)); ctx.lineTo(ex,ey); ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }
  }, [mode, letter, sides]);

  const btnStyle = (active: boolean) => ({ padding:'5px 14px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:700, fontSize:12, background: active?'var(--purple)':'var(--surface-2)', color: active?'#fff':'var(--text-1)' });
  const info = LETTERS[letter] || {lines:[],rot:false};
  const lcount = info.lines.length + (info.rot?0:0);

  return (
    <div style={{ background:'var(--surface-1)', borderRadius:12, padding:16, maxWidth:600, margin:'0 auto', fontFamily:'inherit' }}>
      <h3 style={{ color:'var(--text-1)', fontSize:16, fontWeight:700, marginBottom:8 }}>Symmetry Lines Lab</h3>
      <canvas ref={canvasRef} width={460} height={280} style={{ width:'100%', borderRadius:8, background:'var(--surface-2)', display:'block' }} />
      <div style={{ display:'flex', gap:8, marginTop:10, justifyContent:'center' }}>
        <button onClick={()=>setMode('alphabet')} style={btnStyle(mode==='alphabet')}>Alphabet Mode</button>
        <button onClick={()=>setMode('polygon')} style={btnStyle(mode==='polygon')}>Polygon Mode</button>
      </div>
      {mode==='alphabet' && (
        <div style={{ marginTop:10 }}>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, justifyContent:'center' }}>
            {Object.keys(LETTERS).map(l=>(
              <button key={l} onClick={()=>setLetter(l)} style={{ width:34, height:34, borderRadius:6, border:'none', cursor:'pointer', fontWeight:700, fontSize:14, background:letter===l?'var(--orange)':'var(--surface-2)', color:letter===l?'#fff':'var(--text-1)' }}>{l}</button>
            ))}
          </div>
          <div style={{ marginTop:8, padding:'6px 12px', background:'var(--surface-2)', borderRadius:8, fontSize:12, color:'var(--text-1)', textAlign:'center' }}>
            Letter <b style={{color:'var(--orange)'}}>{letter}</b>:
            {info.lines.length>0 && <span style={{color:'#ef4444'}}> {info.lines.join(' + ')} symmetry</span>}
            {info.rot && <span style={{color:'var(--purple)'}}> rotational symmetry</span>}
            {info.lines.length===0&&!info.rot && <span style={{color:'var(--text-2)'}}> no line symmetry</span>}
          </div>
        </div>
      )}
      {mode==='polygon' && (
        <div style={{ marginTop:10 }}>
          <label style={{ color:'var(--text-2)', fontSize:12 }}>Sides (n): {sides}</label>
          <input type="range" min={3} max={8} value={sides} onChange={e=>setSides(+e.target.value)} style={{ width:'100%' }} />
        </div>
      )}
      <div style={{ marginTop:8, padding:'6px 12px', background:'var(--surface-2)', borderRadius:8, fontSize:12, color:'var(--text-2)', textAlign:'center' }}>
        Formula: <b style={{ color:'var(--orange)' }}>{mode==='polygon'?`Regular ${sides}-gon has ${sides} lines of symmetry and rotational order ${sides}`:`${letter} has ${lcount} line(s) of symmetry`}</b>
      </div>
    </div>
  );
}
