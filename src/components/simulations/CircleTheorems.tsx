'use client';
import { useState, useRef, useEffect } from 'react';

type Theorem = 'tangent'|'inscribed'|'cyclic'|'alternate'|'chord';

const THEOREMS: {key:Theorem;label:string;formula:string}[] = [
  {key:'tangent', label:'Tangent-Radius', formula:'Tangent ⊥ Radius at point of contact (angle = 90°)'},
  {key:'inscribed', label:'Inscribed Angle', formula:'Inscribed angle = ½ × Central angle (same arc)'},
  {key:'cyclic', label:'Cyclic Quad', formula:'Opposite angles of cyclic quadrilateral sum to 180°'},
  {key:'alternate', label:'Alternate Segment', formula:'Tangent-chord angle = Inscribed angle in alternate segment'},
  {key:'chord', label:'Chord Bisector', formula:'Perpendicular from centre bisects the chord'},
];

export default function CircleTheorems() {
  const [theorem, setTheorem] = useState<Theorem>('inscribed');
  const [angle, setAngle] = useState(60);
  const svgRef = useRef<SVGSVGElement>(null);
  const W=460; const H=280; const cx=W/2; const cy=H/2+10; const R=100;

  const toRad = (d:number)=>d*Math.PI/180;
  const ptOn = (a:number,r:number=R)=>({x:cx+r*Math.cos(toRad(a)), y:cy+r*Math.sin(toRad(a))});
  const fmtAng=(v:number)=>v.toFixed(1)+'°';

  const renderTheorem=()=>{
    if(theorem==='tangent'){
      const tp=ptOn(-30); const tpOut={x:cx+(R+60)*Math.cos(toRad(-30)), y:cy+(R+60)*Math.sin(toRad(-30))};
      const tang1={x:tp.x+70*Math.cos(toRad(-30+90)), y:tp.y+70*Math.sin(toRad(-30+90))};
      const tang2={x:tp.x-70*Math.cos(toRad(-30+90)), y:tp.y-70*Math.sin(toRad(-30+90))};
      return(<><line x1={cx} y1={cy} x2={tp.x} y2={tp.y} stroke="var(--orange)" strokeWidth="2"/>
        <line x1={tang1.x} y1={tang1.y} x2={tang2.x} y2={tang2.y} stroke="var(--purple)" strokeWidth="2.5"/>
        <rect x={tp.x-10} y={tp.y-10} width={10} height={10} fill="none" stroke="#ef4444" strokeWidth="1.5" transform={`rotate(-30,${tp.x},${tp.y})`}/>
        <circle cx={tp.x} cy={tp.y} r={4} fill="#ef4444"/>
        <text x={tp.x+14} y={tp.y-14} fontSize="11" fill="#ef4444">90°</text>
        <text x={cx-30} y={cy+20} fontSize="10" fill="var(--orange)">r</text>
      </>);
    }
    if(theorem==='inscribed'){
      const A=ptOn(-90+angle); const B=ptOn(-90); const C=ptOn(90);
      const OA=ptOn(-90+angle*2,0); // central angle from O
      const arcPts=[B,C].map(p=>p);
      const centralAngle=angle*2;
      return(<>
        <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="var(--orange)" strokeWidth="1.5"/>
        <line x1={A.x} y1={A.y} x2={C.x} y2={C.y} stroke="var(--orange)" strokeWidth="1.5"/>
        <line x1={cx} y1={cy} x2={B.x} y2={B.y} stroke="var(--purple)" strokeWidth="1.5"/>
        <line x1={cx} y1={cy} x2={C.x} y2={C.y} stroke="var(--purple)" strokeWidth="1.5"/>
        {[A,B,C].map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={4} fill={['var(--orange)','#22c55e','#22c55e'][i]}/>)}
        <circle cx={cx} cy={cy} r={4} fill="var(--purple)"/>
        <text x={A.x+8} y={A.y} fontSize="11" fill="var(--orange)">A ({fmtAng(angle)})</text>
        <text x={B.x-30} y={B.y+14} fontSize="10" fill="#22c55e">B</text>
        <text x={C.x+6} y={C.y+14} fontSize="10" fill="#22c55e">C</text>
        <text x={cx+6} y={cy-6} fontSize="11" fill="var(--purple)">O ({fmtAng(centralAngle)})</text>
      </>);
    }
    if(theorem==='cyclic'){
      const a1=angle; const a2=180-angle;
      const [P,Q,S,T]=[ptOn(-80),ptOn(10),ptOn(120),ptOn(200)];
      return(<>
        <polygon points={`${P.x},${P.y} ${Q.x},${Q.y} ${S.x},${S.y} ${T.x},${T.y}`} fill="rgba(249,115,22,0.12)" stroke="var(--orange)" strokeWidth="1.5"/>
        {[P,Q,S,T].map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={4} fill="var(--orange)"/>)}
        <text x={P.x+8} y={P.y+4} fontSize="10" fill="var(--orange)">{fmtAng(a1)}</text>
        <text x={S.x+8} y={S.y+4} fontSize="10" fill="var(--purple)">{fmtAng(a2)}</text>
        <text x={Q.x+8} y={Q.y+4} fontSize="10" fill="var(--purple)">{fmtAng(a1+10)}</text>
        <text x={T.x-50} y={T.y+4} fontSize="10" fill="var(--orange)">{fmtAng(170-a1)}</text>
      </>);
    }
    if(theorem==='alternate'){
      const P=ptOn(0); const tangUp={x:P.x, y:P.y-80}; const tangDn={x:P.x, y:P.y+80};
      const Q=ptOn(150); const insAngle=angle/2;
      return(<>
        <line x1={tangUp.x} y1={tangUp.y} x2={tangDn.x} y2={tangDn.y} stroke="var(--purple)" strokeWidth="2.5"/>
        <line x1={P.x} y1={P.y} x2={Q.x} y2={Q.y} stroke="var(--orange)" strokeWidth="1.5"/>
        <line x1={cx} y1={cy} x2={Q.x} y2={Q.y} stroke="var(--text-2)" strokeWidth="1" strokeDasharray="4,3"/>
        <circle cx={P.x} cy={P.y} r={4} fill="var(--orange)"/>
        <circle cx={Q.x} cy={Q.y} r={4} fill="var(--purple)"/>
        <text x={P.x+8} y={P.y-10} fontSize="10" fill="var(--orange)">{fmtAng(insAngle)}</text>
        <text x={Q.x-50} y={Q.y-8} fontSize="10" fill="var(--purple)">{fmtAng(insAngle)}</text>
        <text x={W/2-60} y={H-10} fontSize="10" fill="var(--text-2)">Tangent-chord angle = Alternate segment angle</text>
      </>);
    }
    // chord bisector
    const a1=angle-20; const a2=angle+20;
    const P1=ptOn(a1); const P2=ptOn(a2);
    const mx=(P1.x+P2.x)/2; const my=(P1.y+P2.y)/2;
    return(<>
      <line x1={P1.x} y1={P1.y} x2={P2.x} y2={P2.y} stroke="var(--orange)" strokeWidth="2.5"/>
      <line x1={cx} y1={cy} x2={mx} y2={my} stroke="var(--purple)" strokeWidth="2" strokeDasharray="5,4"/>
      <rect x={mx-6} y={my-6} width={6} height={6} fill="none" stroke="#ef4444" strokeWidth="1.5" transform={`rotate(${a1/2+a2/2+90},${mx},${my})`}/>
      <circle cx={P1.x} cy={P1.y} r={4} fill="var(--orange)"/> <circle cx={P2.x} cy={P2.y} r={4} fill="var(--orange)"/>
      <circle cx={mx} cy={my} r={4} fill="#ef4444"/>
      <text x={mx+8} y={my-6} fontSize="10" fill="#ef4444">M (midpoint)</text>
      <text x={cx+4} y={cy+14} fontSize="10" fill="var(--purple)">O</text>
    </>);
  };

  const fml=THEOREMS.find(t=>t.key===theorem)?.formula||'';
  const btnStyle=(active:boolean)=>({ padding:'5px 10px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:600, fontSize:11, background:active?'var(--purple)':'var(--surface-2)', color:active?'#fff':'var(--text-1)', whiteSpace:'nowrap' as const });

  return (
    <div style={{ background:'var(--surface-1)', borderRadius:12, padding:16, maxWidth:600, margin:'0 auto', fontFamily:'inherit' }}>
      <h3 style={{ color:'var(--text-1)', fontSize:16, fontWeight:700, marginBottom:8 }}>Circle Theorems Explorer</h3>
      <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background:'var(--surface-2)', borderRadius:8, display:'block' }}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--text-2)" strokeWidth="1.5"/>
        {renderTheorem()}
      </svg>
      <div style={{ display:'flex', gap:6, marginTop:10, flexWrap:'wrap', justifyContent:'center' }}>
        {THEOREMS.map(t=><button key={t.key} onClick={()=>setTheorem(t.key)} style={btnStyle(theorem===t.key)}>{t.label}</button>)}
      </div>
      <div style={{ marginTop:8 }}>
        <label style={{ color:'var(--text-2)', fontSize:12 }}>Angle: {angle}°</label>
        <input type="range" min={20} max={80} value={angle} onChange={e=>setAngle(+e.target.value)} style={{ width:'100%' }} />
      </div>
      <div style={{ marginTop:6, padding:'8px 12px', background:'var(--surface-2)', borderRadius:8, fontSize:12, color:'var(--text-1)', textAlign:'center' }}>
        <b style={{ color:'var(--orange)' }}>{fml}</b>
      </div>
    </div>
  );
}
