'use client';
import { useState, useRef, useEffect } from 'react';

type ChartType = 'bar'|'pie'|'line'|'histogram';
const COLORS = ['#f97316','#7c3aed','#22c55e','#3b82f6','#ef4444'];

const initData = [
  {label:'Exam 1', value:85},{label:'Exam 2', value:90},
  {label:'Exam 3', value:78},{label:'Exam 4', value:92},{label:'Exam 5', value:88}
];

export default function DataHandling() {
  const [data, setData] = useState(initData);
  const [chart, setChart] = useState<ChartType>('bar');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const values = data.map(d=>d.value).filter(v=>v>0);
  const mean = values.reduce((a,b)=>a+b,0)/values.length;
  const sorted = [...values].sort((a,b)=>a-b);
  const median = sorted.length%2===0?(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2:sorted[Math.floor(sorted.length/2)];
  const freq: Record<number,number> = {};
  values.forEach(v=>{freq[v]=(freq[v]||0)+1;});
  const maxF = Math.max(...Object.values(freq));
  const modes = Object.entries(freq).filter(([,f])=>f===maxF).map(([v])=>Number(v));
  const range = Math.max(...values)-Math.min(...values);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!; const W=canvas.width; const H=canvas.height;
    ctx.clearRect(0, 0, W, H);
    const vals = data.map(d=>d.value).filter(v=>v>0);
    if (!vals.length) return;
    const maxV = Math.max(...vals);
    const pad = {l:40,r:20,t:20,b:40};
    const iW=W-pad.l-pad.r; const iH=H-pad.t-pad.b;

    if (chart==='bar') {
      const bw=iW/data.length*0.7; const gap=iW/data.length;
      data.forEach((d,i)=>{
        const bh=(d.value/maxV)*iH;
        const x=pad.l+i*gap+(gap-bw)/2; const y=pad.t+iH-bh;
        ctx.fillStyle=COLORS[i%COLORS.length]; ctx.fillRect(x,y,bw,bh);
        ctx.fillStyle='var(--text-1)'; ctx.font='10px sans-serif'; ctx.textAlign='center';
        ctx.fillText(String(d.value),x+bw/2,y-4);
        ctx.fillText(d.label,x+bw/2,pad.t+iH+14);
      });
      ctx.strokeStyle='var(--text-2)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(pad.l,pad.t); ctx.lineTo(pad.l,pad.t+iH); ctx.lineTo(pad.l+iW,pad.t+iH); ctx.stroke();
    } else if (chart==='pie') {
      const total=vals.reduce((a,b)=>a+b,0); let start=-Math.PI/2; const cx=W/2; const cy=H/2; const r=Math.min(iW,iH)/2*0.8;
      data.forEach((d,i)=>{
        const sweep=(d.value/total)*Math.PI*2;
        ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,start,start+sweep); ctx.closePath();
        ctx.fillStyle=COLORS[i%COLORS.length]; ctx.fill();
        ctx.strokeStyle='var(--surface-1)'; ctx.lineWidth=2; ctx.stroke();
        const ma=start+sweep/2; const lx=cx+r*0.65*Math.cos(ma); const ly=cy+r*0.65*Math.sin(ma);
        ctx.fillStyle='#fff'; ctx.font='bold 10px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(`${((d.value/total)*100).toFixed(1)}%`,lx,ly);
        start+=sweep;
      });
    } else if (chart==='line') {
      const pts=data.map((d,i)=>({x:pad.l+i*(iW/(data.length-1)),y:pad.t+iH-(d.value/maxV)*iH}));
      ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
      pts.forEach(p=>ctx.lineTo(p.x,p.y));
      ctx.strokeStyle='var(--orange)'; ctx.lineWidth=2.5; ctx.stroke();
      pts.forEach((p,i)=>{
        ctx.beginPath(); ctx.arc(p.x,p.y,4,0,Math.PI*2); ctx.fillStyle=COLORS[i%COLORS.length]; ctx.fill();
        ctx.fillStyle='var(--text-1)'; ctx.font='10px sans-serif'; ctx.textAlign='center'; ctx.fillText(String(data[i].value),p.x,p.y-10);
        ctx.fillText(data[i].label,p.x,pad.t+iH+14);
      });
      ctx.strokeStyle='var(--text-2)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(pad.l,pad.t); ctx.lineTo(pad.l,pad.t+iH); ctx.lineTo(pad.l+iW,pad.t+iH); ctx.stroke();
    } else {
      const bins=5; const mn=Math.min(...vals); const mx=Math.max(...vals); const binW=(mx-mn)/bins||10;
      const counts=Array(bins).fill(0);
      vals.forEach(v=>{const i=Math.min(Math.floor((v-mn)/binW),bins-1); counts[i]++;});
      const maxC=Math.max(...counts); const bw=iW/bins;
      counts.forEach((c,i)=>{
        const bh=(c/maxC)*iH; const x=pad.l+i*bw; const y=pad.t+iH-bh;
        ctx.fillStyle=COLORS[i%COLORS.length]; ctx.fillRect(x,y,bw-2,bh);
        ctx.fillStyle='var(--text-1)'; ctx.font='10px sans-serif'; ctx.textAlign='center';
        ctx.fillText(String(c),x+bw/2,y-4);
        ctx.fillText(`${(mn+i*binW).toFixed(0)}-${(mn+(i+1)*binW).toFixed(0)}`,x+bw/2,pad.t+iH+14);
      });
      ctx.strokeStyle='var(--text-2)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(pad.l,pad.t); ctx.lineTo(pad.l,pad.t+iH); ctx.lineTo(pad.l+iW,pad.t+iH); ctx.stroke();
    }
  }, [data, chart]);

  const btnStyle = (active: boolean) => ({ padding:'5px 12px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:600, fontSize:11, background: active?'var(--orange)':'var(--surface-2)', color: active?'#fff':'var(--text-1)' });

  return (
    <div style={{ background:'var(--surface-1)', borderRadius:12, padding:16, maxWidth:600, margin:'0 auto', fontFamily:'inherit' }}>
      <h3 style={{ color:'var(--text-1)', fontSize:16, fontWeight:700, marginBottom:8 }}>Data Handling & Statistics</h3>
      <canvas ref={canvasRef} width={520} height={200} style={{ width:'100%', borderRadius:8, background:'var(--surface-2)', display:'block' }} />
      <div style={{ display:'flex', gap:6, marginTop:10, justifyContent:'center' }}>
        {(['bar','pie','line','histogram'] as ChartType[]).map(c=><button key={c} onClick={()=>setChart(c)} style={btnStyle(chart===c)}>{c.charAt(0).toUpperCase()+c.slice(1)}</button>)}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:6, marginTop:10 }}>
        {data.map((d,i)=>(
          <div key={i} style={{ background:'var(--surface-2)', borderRadius:6, padding:6 }}>
            <input value={d.label} onChange={e=>setData(prev=>{const n=[...prev]; n[i]={...n[i],label:e.target.value}; return n;})} style={{ width:'100%', background:'transparent', border:'none', color:'var(--text-1)', fontSize:10, marginBottom:4 }} />
            <input type="number" min={0} max={100} value={d.value} onChange={e=>setData(prev=>{const n=[...prev]; n[i]={...n[i],value:+e.target.value}; return n;})} style={{ width:'100%', background:'transparent', border:'1px solid var(--text-2)', borderRadius:4, color:COLORS[i], fontWeight:700, fontSize:13, textAlign:'center', padding:'2px 0' }} />
          </div>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, marginTop:10 }}>
        {[['Mean',mean.toFixed(2),'var(--orange)'],['Median',median,'var(--purple)'],['Mode',modes.join(','),'#22c55e'],['Range',range,'#3b82f6']].map(([l,v,c])=>(
          <div key={String(l)} style={{ background:'var(--surface-2)', borderRadius:8, padding:'6px 4px', textAlign:'center' }}>
            <div style={{ color:'var(--text-2)', fontSize:11 }}>{l}</div>
            <b style={{ color:String(c), fontSize:15 }}>{String(v)}</b>
          </div>
        ))}
      </div>
      <div style={{ marginTop:6, padding:'6px 12px', background:'var(--surface-2)', borderRadius:8, fontSize:11, color:'var(--text-2)', textAlign:'center' }}>
        Formula: <b style={{ color:'var(--orange)' }}>Mean = Σx/n &nbsp;|&nbsp; Median = middle value &nbsp;|&nbsp; Mode = most frequent</b>
      </div>
    </div>
  );
}
