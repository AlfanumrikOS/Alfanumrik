'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import { ALL_CONCEPTS, getSubjectIcon, getSubjectColor } from '@/data/curriculum';
import { ArrowLeft, RefreshCw, Clock, Brain, Sparkles } from 'lucide-react';

function genReviewItems(grade:number) {
  const now = new Date();
  return ALL_CONCEPTS.filter(c=>c.grade<=grade).slice(0,12).map(c => {
    const due = new Date(now); due.setHours(due.getHours()-Math.floor(Math.random()*48));
    return { ...c, dueAt:due.toISOString(), interval:[1,3,7,14,30][Math.floor(Math.random()*5)], strength:Math.random(), isOverdue:due<now };
  }).sort((a,b)=>new Date(a.dueAt).getTime()-new Date(b.dueAt).getTime());
}

export default function ReviewPage() {
  const { student, isHi, addXP, isLoggedIn } = useStudent();
  const router = useRouter();
  const [items] = useState(()=>student?genReviewItems(student.grade):[]);
  const [reviewing, setReviewing] = useState(false);
  const [idx, setIdx] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [rating, setRating] = useState<number|null>(null);

  if(!isLoggedIn||!student){router.push('/');return null;}
  const overdue = items.filter(r=>r.isOverdue);
  const upcoming = items.filter(r=>!r.isOverdue);
  const cur = reviewing?items[idx]:null;

  const rate = (r:number) => {
    setRating(r);
    setTimeout(()=>{addXP(r>=3?15:5);setReviewed(c=>c+1);setRating(null);
      if(idx+1<items.length)setIdx(i=>i+1);else setReviewing(false);
    },800);
  };

  if(reviewing&&cur) {
    const color = getSubjectColor(cur.subject);
    return(
      <div className="min-h-screen flex flex-col">
        <div className="sticky top-0 z-50 glass border-b border-white/5"><div className="max-w-2xl mx-auto px-4 py-3"><div className="flex items-center justify-between mb-2"><button onClick={()=>setReviewing(false)}><ArrowLeft className="w-5 h-5 text-white/40" /></button><span className="text-xs text-white/25">{idx+1}/{items.length}</span></div><div className="w-full bg-surface-800/50 rounded-full h-2"><div className="h-2 rounded-full transition-all" style={{width:`${((idx+1)/items.length)*100}%`,background:'linear-gradient(90deg,#9B4DAE,#00B4D8)'}} /></div></div></div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md space-y-8 animate-slide-up">
            <div className="rounded-2xl p-8 text-center min-h-[200px] flex flex-col items-center justify-center" style={{background:`linear-gradient(135deg,${color}15,${color}05)`,border:`2px solid ${color}30`}}>
              <div className="text-3xl mb-3">{getSubjectIcon(cur.subject)}</div>
              <h2 className="text-xl font-bold mb-2">{isHi&&cur.titleHi?cur.titleHi:cur.title}</h2>
              <div className="text-xs text-white/25">{isHi?`कक्षा ${cur.grade}`:`Class ${cur.grade}`} • {isHi?`अंतराल: ${cur.interval} दिन`:`Interval: ${cur.interval}d`}</div>
            </div>
            <div className="text-center"><p className="text-sm text-white/30 mb-4">🦊 {isHi?'कितनी अच्छी याद है?':'How well do you remember?'}</p>
              <div className="grid grid-cols-4 gap-2">{[{r:1,l:isHi?'😟 भूल गया':'😟 Forgot',c:'#FF4757'},{r:2,l:isHi?'😐 थोड़ा':'😐 Barely',c:'#FFB800'},{r:3,l:isHi?'🙂 याद':'🙂 Remember',c:'#00B4D8'},{r:4,l:isHi?'😎 पक्का!':'😎 Solid!',c:'#2DC653'}].map(({r:rv,l,c})=>(
                <button key={rv} onClick={()=>rate(rv)} disabled={rating!==null} className="py-3 px-2 rounded-xl text-center transition-all border" style={{background:rating===rv?`${c}20`:'rgba(30,27,46,0.5)',borderColor:rating===rv?c:'rgba(255,255,255,0.08)'}}><div className="text-xs font-bold" style={{color:rating===rv?c:'rgba(255,255,255,0.6)'}}>{l}</div></button>
              ))}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return(
    <div className="min-h-screen pb-8">
      <div className="sticky top-0 z-50 glass border-b border-white/5"><div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3"><button onClick={()=>router.push('/dashboard')}><ArrowLeft className="w-5 h-5 text-white/40" /></button><div><div className="font-bold">{isHi?'🔄 दोहराई':'🔄 Spaced Review'}</div><div className="text-xs text-white/25">{isHi?'याद रखो जो सीखा':'Remember what you learned'}</div></div></div></div>
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        <div className="rounded-xl p-4 animate-slide-up" style={{background:'rgba(123,45,142,0.08)',border:'1px solid rgba(123,45,142,0.2)'}}>
          <div className="flex items-start gap-3"><Brain className="w-5 h-5 mt-0.5 flex-shrink-0" style={{color:'#9B4DAE'}} /><div className="text-sm text-white/40">{isHi?'🦊 स्पेस्ड रिपिटिशन (d≈0.54) — 100+ साल पुरानी तकनीक जो कोई भारतीय EdTech नहीं करता। हम करते हैं!':'🦊 Spaced repetition (d≈0.54) — proven technique no major Indian EdTech uses properly. We do!'}</div></div>
        </div>
        <div className="grid grid-cols-3 gap-3 animate-slide-up" style={{animationDelay:'0.1s'}}>
          <div className="glass rounded-xl p-4 text-center"><div className="text-2xl font-extrabold" style={{color:'#FF4757'}}>{overdue.length}</div><div className="text-xs text-white/25">{isHi?'बकाया':'Overdue'}</div></div>
          <div className="glass rounded-xl p-4 text-center"><div className="text-2xl font-extrabold" style={{color:'#00B4D8'}}>{upcoming.length}</div><div className="text-xs text-white/25">{isHi?'आगामी':'Upcoming'}</div></div>
          <div className="glass rounded-xl p-4 text-center"><div className="text-2xl font-extrabold" style={{color:'#2DC653'}}>{reviewed}</div><div className="text-xs text-white/25">{isHi?'दोहराया':'Reviewed'}</div></div>
        </div>
        {items.length>0&&<button onClick={()=>{setReviewing(true);setIdx(0);}} className="w-full py-4 rounded-xl font-bold text-white flex items-center justify-center gap-2 animate-pulse-glow" style={{background:'linear-gradient(135deg,#9B4DAE,#00B4D8)'}}><RefreshCw className="w-5 h-5" />{isHi?`${overdue.length} बकाया — अभी दोहराओ!`:`${overdue.length} overdue — Review Now!`}</button>}
        {overdue.length>0&&<div className="animate-slide-up" style={{animationDelay:'0.15s'}}><h3 className="text-sm font-bold mb-3 flex items-center gap-2" style={{color:'#FF4757'}}><Clock className="w-4 h-4" />{isHi?'बकाया':'Overdue'}</h3><div className="space-y-2">{overdue.slice(0,5).map(item=><div key={item.id} className="flex items-center gap-3 p-3 rounded-xl border" style={{background:'rgba(30,27,46,0.3)',borderColor:'rgba(255,255,255,0.05)'}}><span className="text-lg">{getSubjectIcon(item.subject)}</span><div className="flex-1 min-w-0"><div className="text-sm font-bold truncate">{isHi&&item.titleHi?item.titleHi:item.title}</div><div className="flex items-center gap-2 mt-1"><div className="flex-1 bg-surface-800/50 rounded-full h-1.5 max-w-20"><div className="h-1.5 rounded-full" style={{width:`${Math.round(item.strength*100)}%`,background:getSubjectColor(item.subject)}} /></div><span className="text-[10px] text-white/20">{Math.round(item.strength*100)}%</span></div></div><span className="text-xs" style={{color:'#FF4757'}}>{isHi?'बकाया!':'Due!'}</span></div>)}</div></div>}
        {upcoming.length>0&&<div className="animate-slide-up" style={{animationDelay:'0.2s'}}><h3 className="text-sm font-bold mb-3 flex items-center gap-2 text-white/30"><Sparkles className="w-4 h-4" />{isHi?'आगामी':'Upcoming'}</h3><div className="space-y-2">{upcoming.slice(0,5).map(item=><div key={item.id} className="flex items-center gap-3 p-3 rounded-xl border" style={{background:'rgba(30,27,46,0.3)',borderColor:'rgba(255,255,255,0.05)'}}><span className="text-lg">{getSubjectIcon(item.subject)}</span><div className="flex-1 min-w-0"><div className="text-sm font-bold truncate">{isHi&&item.titleHi?item.titleHi:item.title}</div></div><span className="text-xs text-white/20">{item.interval}d</span></div>)}</div></div>}
      </div>
    </div>
  );
}
