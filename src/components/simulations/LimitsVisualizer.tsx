'use client';
import { useState, useRef, useEffect } from 'react';

type FnKey = 'sinc'|'rational'|'reciprocal'|'sign';

const FNS: {key:FnKey;label:string;approachAt:number;formula:string}[] = [
  {key:'sinc', label:'sin(x)/x', approachAt:0, formula:'lim(x→0) sin(x)/x = 1'},
  {key:'rational', label:'(x²-1)/(x-1)', approachAt:1, formula:'lim(x→1) (x²-1)/(x-1) = 2'},
  {key:'reciprocal', label:'1/x', approachAt:0, formula:'lim(x→0) 1/x = undefined (diverges)'},
  {key:'sign', label:'|x|/x', approachAt:0, formula:'lim(x→0) |x|/x: LHL=-1, RHL=+1 (no limit)'},
];

function evaluate(key:FnKey, x:number): number|null {
  if(key==='sinc'){if(Math.abs(x)<1e-10)return null; return Math.sin(x)/x;}
  if(key==='rational'){if(Math.abs(x-1)<1e-10)return null; return(x*x-1)/(x-1);}
  if(key==='reciprocal'){if(Math.abs(x)<1e-10)return null; return 1/x;}
  if(Math.abs(x)<1e-10)return null; return x<0?-1:1;
}

export default function LimitsVisualizer() {
  const [fn, setFn] = useState<FnKey>('sinc');
  const [approach, setApproach] = useState(50);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const info = FNS.find(f=>f.key===fn)!;
  const a = info.approachAt;
  const t = (approach-50)/50 * 2; // -2 to 2 delta

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d')!; const W=canvas.width; const H=canvas.height;
    ctx.clearRect(0,0,W,H);
    const xRange=fn==='reciprocal'?[-3,3]:fn==='sign'?[-3,3]:[-4,4];
    const yRange=fn==='reciprocal'?[-4,4]:[-0.5,2.5];
    const xS=(W-60)/(xRange[1]-xRange[0]); const yS=(H-40)/(yRange[1]-yRange[0]);
    const toX=(x:number)=>30+(x-xRange[0])*xS;
    const toY=(y:number)=>H-20-(y-yRange[0])*yS;
    // Grid
    ctx.strokeStyle='rgba(128,128,128,0.15)'; ctx.lineWidth=0.5;
    for(let x=Math.ceil(xRange[0]);x<=xRange[1];x++){ctx.beginPath();ctx.moveTo(toX(x),20);ctx.lineTo(toX(x),H-20);ctx.stroke();}
    for(let y=Math.ceil(yRange[0]);y<=yRange[1];y++){ctx.beginPath();ctx.moveTo(30,toY(y));ctx.lineTo(W-30,toY(y));ctx.stroke();}
    // Axes
    if(yRange[0]<0&&yRange[1]>0){ctx.beginPath();ctx.moveTo(30,toY(0));ctx.lineTo(W-30,toY(0));ctx.strokeStyle='var(--text-2)';ctx.lineWidth=1.5;ctx.stroke();}
    ctx.beginPath();ctx.moveTo(toX(0),20);ctx.lineTo(toX(0),H-20);ctx.strokeStyle='var(--text-2)';ctx.lineWidth=1.5;ctx.stroke();
    // Curve
    ctx.beginPath(); let first=true; let prevNull=false;
    for(let px=30;px<W-30;px++){
      const x=xRange[0]+(px-30)/xS; const y=evaluate(fn,x);
      if(y===null||y<yRange[0]-0.1||y>yRange[1]+0.1){first=true;prevNull=true;continue;}
      if(first||prevNull){ctx.moveTo(px,toY(y));first=false;}else{ctx.lineTo(px,toY(y));}
      prevNull=false;
    }
    ctx.strokeStyle='var(--orange)'; ctx.lineWidth=2; ctx.stroke();
    // Hole at approach point
    const holeY=evaluate(fn,a+(a===0?0.1:0));
    if(holeY!==null&&holeY>=yRange[0]&&holeY<=yRange[1]){
      ctx.beginPath(); ctx.arc(toX(a),toY(holeY),6,0,Math.PI*2);
      ctx.fillStyle='var(--surface-2)'; ctx.fill(); ctx.strokeStyle='var(--orange)'; ctx.lineWidth=2; ctx.stroke();
    }
    // Moving point
    const delta=t===0?1e-6:t;
    const ptX=a+delta; const ptY=evaluate(fn,ptX);
    if(ptY!==null&&ptY>=yRange[0]&&ptY<=yRange[1]){
      ctx.beginPath(); ctx.arc(toX(ptX),toY(ptY),5,0,Math.PI*2);
      ctx.fillStyle='var(--purple)'; ctx.fill();
      ctx.fillStyle='var(--text-1)'; ctx.font='10px sans-serif'; ctx.textAlign='center';
      ctx.fillText('x='+ptX.toFixed(3),toX(ptX),toY(ptY)-12);
      ctx.fillText('f='+ptY.toFixed(4),toX(ptX),toY(ptY)+20);
    }
    // Axis labels
    ctx.fillStyle='var(--text-2)'; ctx.font='9px sans-serif'; ctx.textAlign='center';
    for(let x=Math.ceil(xRange[0]);x<=xRange[1];x+=2){if(x!==0)ctx.fillText(String(x),toX(x),H-5);}
  },[fn, approach, t, a]);

  const delta=t===0?1e-6:t;
  const ptX=a+delta; const ptY=evaluate(fn,ptX);
  const lhlX=a-Math.abs(delta); const lhlY=evaluate(fn,lhlX);
  const rhlX=a+Math.abs(delta); const rhlY=evaluate(fn,rhlX);
  const limitExists=lhlY!==null&&rhlY!==null&&Math.abs(lhlY-rhlY)<0.05;

  const btnStyle=(active:boolean)=>({ padding:'5px 10px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:600, fontSize:11, background:active?'var(--orange)':'var(--surface-2)', color:active?'#fff':'var(--text-1)' });

  return (
    <div style={{ background:'var(--surface-1)', borderRadius:12, padding:16, maxWidth:600, margin:'0 auto', fontFamily:'inherit' }}>
      <h3 style={{ color:'var(--text-1)', fontSize:16, fontWeight:700, marginBottom:8 }}>Limits Visualizer</h3>
      <canvas ref={canvasRef} width={520} height={240} style={{ width:'100%', borderRadius:8, background:'var(--surface-2)', display:'block' }} />
      <div style={{ display:'flex', gap:6, marginTop:10, flexWrap:'wrap', justifyContent:'center' }}>
        {FNS.map(f=><button key={f.key} onClick={()=>setFn(f.key)} style={btnStyle(fn===f.key)}>{f.label}</button>)}
      </div>
      <div style={{ marginTop:8 }}>
        <label style={{ color:'var(--text-2)', fontSize:12 }}>Approach x = {a} from: {t<0?'left':'right'} (delta = {t.toFixed(3)})</label>
        <input type="range" min={1} max={99} value={approach} onChange={e=>setApproach(+e.target.value)} style={{ width:'100%' }} />
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, marginTop:8 }}>
        <div style={{ padding:'6px 8px', background:'var(--surface-2)', borderRadius:8, fontSize:11, textAlign:'center' }}>
          <div style={{color:'var(--text-2)'}}>LHL (x→a⁻)</div>
          <b style={{color:'var(--orange)'}}>{lhlY?.toFixed(4)??'∞'}</b>
        </div>
        <div style={{ padding:'6px 8px', background:'var(--surface-2)', borderRadius:8, fontSize:11, textAlign:'center' }}>
          <div style={{color:'var(--text-2)'}}>RHL (x→a⁺)</div>
          <b style={{color:'var(--purple)'}}>{rhlY?.toFixed(4)??'∞'}</b>
        </div>
        <div style={{ padding:'6px 8px', background:'var(--surface-2)', borderRadius:8, fontSize:11, textAlign:'center' }}>
          <div style={{color:'var(--text-2)'}}>Limit exists?</div>
          <b style={{color:limitExists?'#22c55e':'#ef4444'}}>{limitExists?'YES':'NO'}</b>
        </div>
      </div>
      <div style={{ marginTop:6, padding:'6px 12px', background:'var(--surface-2)', borderRadius:8, fontSize:12, color:'var(--text-1)', textAlign:'center' }}>
        <b style={{ color:'var(--orange)' }}>{info.formula}</b>
      </div>
    </div>
  );
}
