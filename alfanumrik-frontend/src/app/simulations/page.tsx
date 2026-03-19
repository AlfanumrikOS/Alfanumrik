'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import { SIMULATIONS } from '@/data/curriculum';
import { ArrowLeft, Play, RotateCcw, Info } from 'lucide-react';

export default function SimulationsPage() {
  const { isHi, isLoggedIn } = useStudent();
  const router = useRouter();
  const [activeSim, setActiveSim] = useState<string|null>(null);
  if(!isLoggedIn){router.push('/');return null;}
  const sim = SIMULATIONS.find(s=>s.id===activeSim);

  return(
    <div className="min-h-screen pb-8">
      <div className="sticky top-0 z-50 glass border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={()=>activeSim?setActiveSim(null):router.push('/dashboard')}><ArrowLeft className="w-5 h-5 text-white/40" /></button>
          <div><div className="font-bold">{isHi?'🔬 वर्चुअल प्रयोगशाला':'🔬 Virtual Lab'}</div><div className="text-xs text-white/25">{isHi?'सिमुलेशन से सीखो':'Learn by experimenting'}</div></div>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 pt-6">
        {!activeSim ? (
          <div className="space-y-4">
            <p className="text-sm text-white/30 mb-4">{isHi?'75% भारतीय स्कूलों में ठीक से विज्ञान लैब नहीं है। यहाँ प्रयोग करो!':'75% of Indian schools lack proper science labs. Experiment here!'}</p>
            {SIMULATIONS.map(s=>(
              <button key={s.id} onClick={()=>setActiveSim(s.id)} className="w-full p-5 rounded-xl text-left card-interactive border" style={{background:'linear-gradient(135deg,rgba(0,180,216,0.08),rgba(45,198,83,0.05))',borderColor:'rgba(0,180,216,0.2)'}}>
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl" style={{background:'rgba(0,180,216,0.15)'}}>⚡</div>
                  <div className="flex-1"><div className="font-bold">{isHi&&s.titleHi?s.titleHi:s.title}</div><div className="text-xs text-white/30 mt-1">{s.description}</div></div>
                  <Play className="w-5 h-5 text-brand-teal" />
                </div>
              </button>
            ))}
          </div>
        ) : activeSim==='sim-ohm' ? <OhmSim isHi={isHi} /> : activeSim==='sim-projectile' ? <ProjectileSim isHi={isHi} /> : activeSim==='sim-lens' ? <LensSim isHi={isHi} /> : <div className="text-center py-20 text-white/20">{isHi?'जल्द आ रहा है...':'Coming soon...'}</div>}
      </div>
    </div>
  );
}

function Slider({label,value,min,max,step,onChange,color,maxVal}:{label:string;value:number;min:number;max:number;step:number;onChange:(v:number)=>void;color:string;maxVal:number}) {
  return(<div><div className="flex justify-between mb-2"><span className="text-sm font-bold" style={{color}}>{label}</span><span className="text-sm font-mono" style={{color}}>{value}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))} className="w-full h-2 rounded-full appearance-none cursor-pointer" style={{background:`linear-gradient(to right,${color} ${(value/maxVal)*100}%,rgba(255,255,255,0.1) ${(value/maxVal)*100}%)`}} /></div>);
}

// === OHM'S LAW ===
function OhmSim({isHi}:{isHi:boolean}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [V, setV] = useState(12);
  const [R, setR] = useState(4);
  const I = V / R;

  useEffect(() => {
    const c = canvasRef.current; if(!c) return; const ctx = c.getContext('2d'); if(!ctx) return;
    const w=c.width, h=c.height; ctx.clearRect(0,0,w,h); ctx.fillStyle='#0D0B15'; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle='#00B4D8'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(100,80); ctx.lineTo(300,80); ctx.lineTo(300,220); ctx.lineTo(100,220); ctx.lineTo(100,80); ctx.stroke();
    ctx.fillStyle='#FFB800'; ctx.font='bold 14px Nunito'; ctx.textAlign='center';
    ctx.fillText(`${V}V`,100,200); ctx.fillText(isHi?'बैटरी':'Battery',100,260);
    ctx.strokeStyle='#FF6B35'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(170,80);
    [175,70,185,90,195,70,205,90,215,70,225,90,230,80].forEach((v,i)=>{if(i%2===0)ctx.lineTo(v,0);ctx.lineTo(170+((i/2)*10),i%2===0?70:90);});
    ctx.stroke();
    ctx.fillStyle='#FF6B35'; ctx.fillText(`${R}Ω`,200,60);
    ctx.fillStyle=`rgba(45,198,83,${Math.min(I/5,1)})`; ctx.font='bold 16px Nunito';
    ctx.fillText('→',150,240); ctx.fillText('→',200,240); ctx.fillText('→',250,240);
    ctx.fillStyle='#2DC653'; ctx.font='bold 20px Nunito'; ctx.fillText(`I = ${I.toFixed(2)} A`,200,300);
    ctx.fillStyle='rgba(255,255,255,0.3)'; ctx.font='12px Nunito'; ctx.fillText('V = I × R',200,330);
    const brightness = Math.min(I/6,1);
    const grad = ctx.createRadialGradient(300,150,5,300,150,20+brightness*15);
    grad.addColorStop(0,`rgba(255,184,0,${brightness})`); grad.addColorStop(1,'transparent');
    ctx.fillStyle=grad; ctx.fillRect(270,120,60,60);
    ctx.fillStyle='#FFB800'; ctx.font='20px Nunito'; ctx.fillText('💡',295,160);
  },[V,R,I,isHi]);

  return(
    <div className="space-y-6 animate-slide-up">
      <div className="text-center"><h2 className="text-xl font-bold">{isHi?"⚡ ओम का नियम":"⚡ Ohm's Law Circuit"}</h2></div>
      <canvas ref={canvasRef} width={400} height={350} className="sim-canvas w-full mx-auto" style={{maxWidth:400}} />
      <div className="text-center p-4 rounded-xl" style={{background:'rgba(45,198,83,0.1)',border:'1px solid rgba(45,198,83,0.3)'}}>
        <div className="text-3xl font-extrabold" style={{color:'#2DC653'}}>{I.toFixed(2)} A</div>
        <div className="text-xs text-white/30 mt-1">I = V ÷ R = {V} ÷ {R} = {I.toFixed(2)}</div>
      </div>
      <div className="glass rounded-xl p-5 space-y-5">
        <Slider label={isHi?'वोल्टेज (V)':'Voltage (V)'} value={V} min={0} max={24} step={1} onChange={setV} color="#FFB800" maxVal={24} />
        <Slider label={isHi?'प्रतिरोध (Ω)':'Resistance (Ω)'} value={R} min={1} max={20} step={1} onChange={setR} color="#FF6B35" maxVal={20} />
      </div>
      <div className="p-4 rounded-xl flex items-start gap-3" style={{background:'rgba(123,45,142,0.1)',border:'1px solid rgba(123,45,142,0.3)'}}>
        <Info className="w-5 h-5 mt-0.5 flex-shrink-0" style={{color:'#9B4DAE'}} />
        <div className="text-sm text-white/50">{isHi?'🦊 देखो: वोल्टेज बढ़ाओ → करंट बढ़ती है। प्रतिरोध बढ़ाओ → करंट कम। यही ओम का नियम है!':'🦊 Notice: More voltage → more current. More resistance → less current. That\'s Ohm\'s Law!'}</div>
      </div>
    </div>
  );
}

// === PROJECTILE MOTION ===
function ProjectileSim({isHi}:{isHi:boolean}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [angle, setAngle] = useState(45);
  const [vel, setVel] = useState(20);
  const [g, setG] = useState(10);
  const [playing, setPlaying] = useState(false);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);

  const rad = (angle*Math.PI)/180;
  const vx = vel*Math.cos(rad), vy = vel*Math.sin(rad);
  const totalT = (2*vy)/g;
  const maxH = (vy*vy)/(2*g);
  const range = vx*totalT;

  const draw = useCallback((t:number) => {
    const c=canvasRef.current;if(!c)return;const ctx=c.getContext('2d');if(!ctx)return;
    const w=c.width,h=c.height,sc=Math.min(w/(range+20),(h-80)/(maxH+10)),gy=h-40;
    ctx.clearRect(0,0,w,h);ctx.fillStyle='#0D0B15';ctx.fillRect(0,0,w,h);
    ctx.strokeStyle='rgba(255,255,255,0.15)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(w,gy);ctx.stroke();
    ctx.strokeStyle='rgba(0,180,216,0.3)';ctx.lineWidth=2;ctx.setLineDash([5,5]);ctx.beginPath();
    for(let ti=0;ti<=totalT;ti+=0.05){const px=30+vx*ti*sc,py=gy-(vy*ti-0.5*g*ti*ti)*sc;ti===0?ctx.moveTo(px,py):ctx.lineTo(px,py);}
    ctx.stroke();ctx.setLineDash([]);
    const ct=Math.min(t,totalT),bx=30+vx*ct*sc,by=gy-(vy*ct-0.5*g*ct*ct)*sc;
    ctx.fillStyle='rgba(255,107,53,0.3)';
    for(let ti=Math.max(0,ct-0.5);ti<ct;ti+=0.05){const tx=30+vx*ti*sc,ty=gy-(vy*ti-0.5*g*ti*ti)*sc;ctx.beginPath();ctx.arc(tx,ty,3,0,Math.PI*2);ctx.fill();}
    const grad=ctx.createRadialGradient(bx,by,2,bx,by,10);grad.addColorStop(0,'#FF6B35');grad.addColorStop(1,'rgba(255,107,53,0)');ctx.fillStyle=grad;ctx.beginPath();ctx.arc(bx,by,15,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#FF6B35';ctx.beginPath();ctx.arc(bx,by,6,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#00B4D8';ctx.font='bold 11px Nunito';ctx.textAlign='center';
    ctx.fillText(`Range: ${range.toFixed(1)}m`,30+range*sc/2,gy+25);
  },[angle,vel,g,range,maxH,totalT,vx,vy]);

  useEffect(()=>{draw(0);},[draw]);
  useEffect(()=>{
    if(!playing)return;timeRef.current=0;
    const step=()=>{timeRef.current+=0.03;if(timeRef.current>totalT){setPlaying(false);draw(totalT);return;}draw(timeRef.current);animRef.current=requestAnimationFrame(step);};
    animRef.current=requestAnimationFrame(step);return()=>cancelAnimationFrame(animRef.current);
  },[playing,totalT,draw]);

  return(
    <div className="space-y-6 animate-slide-up">
      <div className="text-center"><h2 className="text-xl font-bold">{isHi?'🚀 प्रक्षेप्य गति':'🚀 Projectile Motion'}</h2></div>
      <canvas ref={canvasRef} width={400} height={280} className="sim-canvas w-full mx-auto" style={{maxWidth:400}} />
      <div className="flex justify-center gap-3">
        <button onClick={()=>setPlaying(true)} className="px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2" style={{background:'linear-gradient(135deg,#2DC653,#00B4D8)'}}><Play className="w-4 h-4" />{isHi?'लॉन्च!':'Launch!'}</button>
        <button onClick={()=>{setPlaying(false);timeRef.current=0;draw(0);}} className="px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 border border-white/10"><RotateCcw className="w-4 h-4" />{isHi?'रीसेट':'Reset'}</button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="glass rounded-xl p-3 text-center"><div className="text-lg font-extrabold" style={{color:'#00B4D8'}}>{range.toFixed(1)}m</div><div className="text-xs text-white/25">{isHi?'दूरी':'Range'}</div></div>
        <div className="glass rounded-xl p-3 text-center"><div className="text-lg font-extrabold" style={{color:'#FFB800'}}>{maxH.toFixed(1)}m</div><div className="text-xs text-white/25">{isHi?'ऊँचाई':'Height'}</div></div>
        <div className="glass rounded-xl p-3 text-center"><div className="text-lg font-extrabold" style={{color:'#FF6B35'}}>{totalT.toFixed(2)}s</div><div className="text-xs text-white/25">{isHi?'समय':'Time'}</div></div>
      </div>
      <div className="glass rounded-xl p-5 space-y-5">
        <Slider label={isHi?'कोण (°)':'Angle (°)'} value={angle} min={0} max={90} step={5} onChange={setAngle} color="#00B4D8" maxVal={90} />
        <Slider label={isHi?'वेग (m/s)':'Velocity (m/s)'} value={vel} min={5} max={50} step={5} onChange={setVel} color="#FFB800" maxVal={50} />
        <Slider label={isHi?'गुरुत्व (m/s²)':'Gravity (m/s²)'} value={g} min={1} max={20} step={1} onChange={setG} color="#FF6B35" maxVal={20} />
      </div>
    </div>
  );
}

// === LENS RAY DIAGRAM ===
function LensSim({isHi}:{isHi:boolean}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [objD, setObjD] = useState(30);
  const [fLen, setFLen] = useState(15);
  const [lType, setLType] = useState<'convex'|'concave'>('convex');

  const u = -objD;
  const f = lType==='convex'?fLen:-fLen;
  const v = 1/(1/f-1/u);
  const mag = v/u;
  const isVirtual = !(lType==='convex'&&objD>fLen);

  useEffect(()=>{
    const c=canvasRef.current;if(!c)return;const ctx=c.getContext('2d');if(!ctx)return;
    const W=c.width,H=c.height,cx=W/2,cy=H/2,sc=4;
    ctx.clearRect(0,0,W,H);ctx.fillStyle='#0D0B15';ctx.fillRect(0,0,W,H);
    // Grid
    ctx.strokeStyle='rgba(255,255,255,0.03)';ctx.lineWidth=1;
    for(let x=0;x<W;x+=20){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for(let y=0;y<H;y+=20){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    // Axis
    ctx.strokeStyle='rgba(255,255,255,0.15)';ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(0,cy);ctx.lineTo(W,cy);ctx.stroke();ctx.setLineDash([]);
    // Lens
    ctx.strokeStyle='#00B4D8';ctx.lineWidth=3;ctx.beginPath();
    if(lType==='convex'){ctx.ellipse(cx,cy,8,60,0,0,Math.PI*2);}
    else{ctx.moveTo(cx-4,cy-60);ctx.quadraticCurveTo(cx+8,cy,cx-4,cy+60);ctx.moveTo(cx+4,cy-60);ctx.quadraticCurveTo(cx-8,cy,cx+4,cy+60);}
    ctx.stroke();
    // Focal points
    const fPx=Math.abs(fLen)*sc;
    ctx.fillStyle='#FFB800';ctx.beginPath();ctx.arc(cx-fPx,cy,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(cx+fPx,cy,4,0,Math.PI*2);ctx.fill();
    ctx.font='10px Nunito';ctx.textAlign='center';ctx.fillText('F',cx-fPx,cy+15);ctx.fillText('F',cx+fPx,cy+15);
    // Object
    const objX=cx-objD*sc,objH=30;
    ctx.strokeStyle='#FF6B35';ctx.fillStyle='#FF6B35';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(objX,cy);ctx.lineTo(objX,cy-objH);ctx.stroke();
    ctx.beginPath();ctx.moveTo(objX-5,cy-objH+8);ctx.lineTo(objX,cy-objH);ctx.lineTo(objX+5,cy-objH+8);ctx.fill();
    ctx.font='bold 11px Nunito';ctx.fillText(isHi?'वस्तु':'Object',objX,cy+20);
    // Image
    if(isFinite(v)&&Math.abs(v)<200){
      const imgX=cx+v*sc,imgH=mag*objH;
      ctx.strokeStyle=isVirtual?'rgba(45,198,83,0.5)':'#2DC653';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=3;
      if(isVirtual)ctx.setLineDash([6,4]);
      ctx.beginPath();ctx.moveTo(imgX,cy);ctx.lineTo(imgX,cy-imgH);ctx.stroke();ctx.setLineDash([]);
      ctx.font='bold 11px Nunito';ctx.fillText(isVirtual?(isHi?'आभासी':'Virtual'):(isHi?'वास्तविक':'Real'),imgX,cy+20);
      // Rays
      ctx.strokeStyle='rgba(255,184,0,0.5)';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(objX,cy-objH);ctx.lineTo(cx,cy-objH);
      if(lType==='convex'){ctx.lineTo(cx+fPx*4,cy+(objH/fPx)*fPx*4);}ctx.stroke();
      ctx.strokeStyle='rgba(0,180,216,0.5)';ctx.beginPath();ctx.moveTo(objX,cy-objH);ctx.lineTo(cx+(cx-objX)*2,cy+objH*2);ctx.stroke();
    }
  },[objD,fLen,lType,u,v,mag,isVirtual,isHi]);

  return(
    <div className="space-y-6 animate-slide-up">
      <div className="text-center"><h2 className="text-xl font-bold">{isHi?'🔍 लेंस किरण आरेख':'🔍 Lens Ray Diagram'}</h2></div>
      <canvas ref={canvasRef} width={400} height={250} className="sim-canvas w-full mx-auto" style={{maxWidth:400}} />
      <div className="grid grid-cols-3 gap-3">
        <div className="glass rounded-xl p-3 text-center"><div className="text-lg font-extrabold" style={{color:'#2DC653'}}>{isFinite(v)?`${v.toFixed(1)}cm`:'∞'}</div><div className="text-xs text-white/25">{isHi?'प्रतिबिंब':'Image'}</div></div>
        <div className="glass rounded-xl p-3 text-center"><div className="text-lg font-extrabold" style={{color:'#FFB800'}}>{isFinite(mag)?mag.toFixed(2):'—'}×</div><div className="text-xs text-white/25">{isHi?'आवर्धन':'Mag.'}</div></div>
        <div className="glass rounded-xl p-3 text-center"><div className="text-sm font-extrabold" style={{color:isVirtual?'#9B4DAE':'#00B4D8'}}>{isVirtual?(isHi?'आभासी':'Virtual'):(isHi?'वास्तविक':'Real')}</div><div className="text-xs text-white/25">{isHi?'प्रकार':'Type'}</div></div>
      </div>
      <div className="glass rounded-xl p-5 space-y-5">
        <div><div className="text-sm font-bold mb-2" style={{color:'#00B4D8'}}>{isHi?'लेंस प्रकार':'Lens Type'}</div>
          <div className="grid grid-cols-2 gap-2">{(['convex','concave'] as const).map(t=><button key={t} onClick={()=>setLType(t)} className="py-2.5 rounded-lg text-sm font-bold transition-all border" style={{background:lType===t?'rgba(0,180,216,0.15)':'rgba(30,27,46,0.5)',borderColor:lType===t?'#00B4D8':'rgba(255,255,255,0.08)',color:lType===t?'#00B4D8':'rgba(255,255,255,0.4)'}}>{t==='convex'?(isHi?'उत्तल':'Convex'):(isHi?'अवतल':'Concave')}</button>)}</div>
        </div>
        <Slider label={isHi?'वस्तु दूरी (cm)':'Object Distance (cm)'} value={objD} min={5} max={50} step={1} onChange={setObjD} color="#FF6B35" maxVal={50} />
        <Slider label={isHi?'फोकस दूरी (cm)':'Focal Length (cm)'} value={fLen} min={5} max={25} step={1} onChange={setFLen} color="#FFB800" maxVal={25} />
      </div>
      <div className="p-4 rounded-xl flex items-start gap-3" style={{background:'rgba(123,45,142,0.1)',border:'1px solid rgba(123,45,142,0.3)'}}>
        <Info className="w-5 h-5 mt-0.5 flex-shrink-0" style={{color:'#9B4DAE'}} />
        <div className="text-sm text-white/50">{objD>fLen*2?(isHi?'🦊 वस्तु 2F से आगे — छोटा, उल्टा, वास्तविक। कैमरा!':'🦊 Object beyond 2F — smaller, inverted, real. Camera!'):objD>fLen?(isHi?'🦊 F और 2F के बीच — बड़ा, उल्टा, वास्तविक। प्रोजेक्टर!':'🦊 Between F and 2F — magnified, inverted, real. Projector!'):(isHi?'🦊 F से पहले — बड़ा, सीधा, आभासी। आवर्धक लेंस!':'🦊 Inside F — magnified, erect, virtual. Magnifying glass!')}</div>
      </div>
    </div>
  );
}
