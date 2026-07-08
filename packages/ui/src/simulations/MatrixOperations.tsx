'use client';
import { useState } from 'react';

type Op = 'add'|'sub'|'mul'|'det'|'transpose'|'inverse';

function makeMatrix(n:number,init:number):number[][] {
  return Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?init:0));
}
function detCalc(m:number[][]):number {
  if(m.length===2) return m[0][0]*m[1][1]-m[0][1]*m[1][0];
  return m[0].reduce((acc,v,j)=>acc+v*(j%2===0?1:-1)*detCalc(m.slice(1).map(r=>r.filter((_,c)=>c!==j))),0);
}
function transpose(m:number[][]):number[][] { return m[0].map((_,j)=>m.map(r=>r[j])); }
function matMul(a:number[][],b:number[][]):number[][] {
  return a.map((row,i)=>b[0].map((_,j)=>row.reduce((s,_,k)=>s+a[i][k]*b[k][j],0)));
}
function matAdd(a:number[][],b:number[][]): number[][] { return a.map((r,i)=>r.map((v,j)=>v+b[i][j])); }
function matSub(a:number[][],b:number[][]): number[][] { return a.map((r,i)=>r.map((v,j)=>v-b[i][j])); }
function inverse2(m:number[][]):number[][]|null {
  const d=detCalc(m); if(Math.abs(d)<1e-10) return null;
  return [[m[1][1]/d,-m[0][1]/d],[-m[1][0]/d,m[0][0]/d]];
}

const CELL_STYLE:React.CSSProperties={width:40,textAlign:'center',background:'transparent',border:'1px solid var(--text-2)',borderRadius:4,color:'var(--text-1)',fontWeight:600,fontSize:14,padding:'3px 0'};

export default function MatrixOperations() {
  const [size, setSize] = useState<2|3>(2);
  const [matA, setMatA] = useState<number[][]>(()=>[[2,1],[3,4]]);
  const [matB, setMatB] = useState<number[][]>(()=>[[1,2],[0,1]]);
  const [op, setOp] = useState<Op>('mul');

  const handleSize=(n:2|3)=>{
    setSize(n);
    setMatA(n===2?[[2,1],[3,4]]:[[1,2,3],[0,1,4],[5,6,0]]);
    setMatB(n===2?[[1,2],[0,1]]:[[1,0,0],[0,1,0],[0,0,1]]);
    if(n===3&&op==='inverse') setOp('mul');
  };

  const updateCell=(mat:'A'|'B',i:number,j:number,val:string)=>{
    const v=parseFloat(val)||0;
    if(mat==='A') setMatA(prev=>{const n=prev.map(r=>[...r]);n[i][j]=v;return n;});
    else setMatB(prev=>{const n=prev.map(r=>[...r]);n[i][j]=v;return n;});
  };

  const compute=():{result:number[][]|number|null;steps:string;error?:string}=>{
    if(op==='add') return {result:matAdd(matA,matB),steps:'C[i][j] = A[i][j] + B[i][j]'};
    if(op==='sub') return {result:matSub(matA,matB),steps:'C[i][j] = A[i][j] - B[i][j]'};
    if(op==='mul') {
      const r=matMul(matA,matB);
      const step=`C[0][0] = ${matA[0].map((v,k)=>v+'×'+matB[k][0]).join('+')} = ${r[0][0]}`;
      return {result:r,steps:step};
    }
    if(op==='det') {
      const d=detCalc(matA);
      const s=size===2?`det = ${matA[0][0]}×${matA[1][1]} - ${matA[0][1]}×${matA[1][0]} = ${d}`:`Cofactor expansion along row 1: det = ${d.toFixed(4)}`;
      return {result:d,steps:s};
    }
    if(op==='transpose') return {result:transpose(matA),steps:'C[i][j] = A[j][i]'};
    if(op==='inverse'&&size===2){
      const inv=inverse2(matA);
      if(!inv) return {result:null,steps:'',error:'Singular matrix — det = 0, no inverse'};
      return {result:inv,steps:`(1/det) × adj(A), det = ${detCalc(matA).toFixed(3)}`};
    }
    return {result:null,steps:'',error:'Inverse only for 2×2'};
  };

  const {result,steps,error}=compute();

  const MatrixDisplay=({m,label}:{m:number[][];label:string})=>(
    <div style={{display:'inline-block',margin:'0 8px',textAlign:'center'}}>
      <div style={{color:'var(--text-2)',fontSize:11,marginBottom:4}}>{label}</div>
      <div style={{border:'2px solid var(--orange)',borderRadius:6,padding:'4px 8px',display:'inline-block'}}>
        {m.map((row,i)=><div key={i} style={{display:'flex',gap:4}}>{row.map((v,j)=>(
          <input key={j} type="number" value={v} onChange={e=>updateCell(label as 'A'|'B',i,j,e.target.value)} style={CELL_STYLE}/>
        ))}</div>)}
      </div>
    </div>
  );

  const ResultDisplay=({r}:{r:number[][]|number|null})=>{
    if(r===null||error) return <div style={{color:'#ef4444',fontWeight:700,fontSize:14}}>{error}</div>;
    if(typeof r==='number') return <div style={{color:'var(--orange)',fontWeight:700,fontSize:20}}>{r.toFixed(4)}</div>;
    return (
      <div style={{border:'2px solid var(--purple)',borderRadius:6,padding:'4px 8px',display:'inline-block'}}>
        {r.map((row,i)=><div key={i} style={{display:'flex',gap:6}}>{row.map((v,j)=>(
          <div key={j} style={{width:55,textAlign:'center',color:'var(--purple)',fontWeight:700,fontSize:14,background:'var(--surface-1)',borderRadius:4,padding:'3px 0'}}>{v.toFixed(2)}</div>
        ))}</div>)}
      </div>
    );
  };

  const btnStyle=(active:boolean)=>({ padding:'5px 10px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:600, fontSize:11, background:active?'var(--orange)':'var(--surface-2)', color:active?'#fff':'var(--text-1)' });
  const ops:Op[]=['add','sub','mul','det','transpose','inverse'];
  const opLabels:Record<Op,string>={add:'A+B',sub:'A-B',mul:'A×B',det:'det(A)',transpose:'Aᵀ',inverse:'A⁻¹'};

  return (
    <div style={{ background:'var(--surface-1)', borderRadius:12, padding:16, maxWidth:600, margin:'0 auto', fontFamily:'inherit' }}>
      <h3 style={{ color:'var(--text-1)', fontSize:16, fontWeight:700, marginBottom:8 }}>Matrix Operations</h3>
      <div style={{ display:'flex', gap:8, marginBottom:10, justifyContent:'center' }}>
        <button onClick={()=>handleSize(2)} style={btnStyle(size===2)}>2×2</button>
        <button onClick={()=>handleSize(3)} style={btnStyle(size===3)}>3×3</button>
      </div>
      <div style={{ display:'flex', justifyContent:'center', flexWrap:'wrap', gap:8, marginBottom:12 }}>
        <MatrixDisplay m={matA} label="A"/>
        {op!=='det'&&op!=='transpose'&&op!=='inverse'&&<MatrixDisplay m={matB} label="B"/>}
      </div>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', justifyContent:'center', marginBottom:12 }}>
        {ops.filter(o=>!(o==='inverse'&&size===3)).map(o=><button key={o} onClick={()=>setOp(o)} style={btnStyle(op===o)}>{opLabels[o]}</button>)}
      </div>
      <div style={{ background:'var(--surface-2)', borderRadius:8, padding:12, textAlign:'center' }}>
        <div style={{ color:'var(--text-2)', fontSize:11, marginBottom:6 }}>{steps}</div>
        <ResultDisplay r={result}/>
      </div>
      <div style={{ marginTop:8, padding:'6px 12px', background:'var(--surface-2)', borderRadius:8, fontSize:11, color:'var(--text-2)', textAlign:'center' }}>
        Formula: <b style={{ color:'var(--orange)' }}>det(A) = ad - bc (2×2) | (A×B)[i][j] = Σ A[i][k]×B[k][j]</b>
      </div>
    </div>
  );
}
