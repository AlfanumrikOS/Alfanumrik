'use client';
import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import BottomNav from '@/components/BottomNav';
import { getXPProgress } from '@/lib/engine';
import { ArrowLeft, TrendingUp, Brain, Clock, Target, Flame, Trophy } from 'lucide-react';

const BLOOMS = [{level:'Remember',color:'#2DC653',hi:'याद'},{level:'Understand',color:'#00B4D8',hi:'समझ'},{level:'Apply',color:'#FFB800',hi:'लागू'},{level:'Analyze',color:'#FF6B35',hi:'विश्लेषण'},{level:'Evaluate',color:'#9B4DAE',hi:'मूल्यांकन'},{level:'Create',color:'#FF4757',hi:'रचना'}];
const WEEKLY = [{day:'Mon',xp:45},{day:'Tue',xp:80},{day:'Wed',xp:60},{day:'Thu',xp:120},{day:'Fri',xp:90},{day:'Sat',xp:150},{day:'Sun',xp:30}];

export default function ProgressPage() {
  const { student, isHi, isLoggedIn } = useStudent();
  const router = useRouter();
  if(!isLoggedIn||!student){router.push('/');return null;}
  const xp = getXPProgress(student.xp);
  const maxXP = Math.max(...WEEKLY.map(d=>d.xp),1);

  return(
    <div className="min-h-screen pb-24">
      <div className="sticky top-0 z-50 glass border-b border-white/5"><div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3"><button onClick={()=>router.push('/dashboard')}><ArrowLeft className="w-5 h-5 text-white/40" /></button><div><div className="font-bold">{isHi?'📊 मेरी प्रगति':'📊 My Progress'}</div></div></div></div>
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Level Card */}
        <div className="glass rounded-2xl p-6 animate-slide-up">
          <div className="flex items-center justify-between mb-4"><div><div className="text-sm text-white/30">{isHi?'स्तर':'Level'}</div><div className="text-4xl font-extrabold" style={{color:'#FFB800'}}>{xp.level}</div></div><div className="text-right"><div className="text-sm text-white/30">{isHi?'कुल XP':'Total XP'}</div><div className="text-2xl font-extrabold gradient-text">{student.xp}</div></div></div>
          <div className="w-full bg-surface-800/50 rounded-full h-3"><div className="h-3 rounded-full xp-fill" style={{width:`${xp.percentage}%`,background:'linear-gradient(90deg,#FFB800,#FF6B35)'}} /></div>
          <div className="text-xs text-white/20 mt-2 text-right">{xp.current}/{xp.required} XP {isHi?'अगले स्तर तक':'to next level'}</div>
        </div>
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 animate-slide-up" style={{animationDelay:'0.1s'}}>
          {[{icon:Flame,label:isHi?'वर्तमान स्ट्रीक':'Current Streak',value:`${student.streak} ${isHi?'दिन':'days'}`,color:'#FF6B35'},
            {icon:Trophy,label:isHi?'सबसे लंबी':'Longest Streak',value:`${student.longestStreak} ${isHi?'दिन':'days'}`,color:'#FFB800'},
            {icon:Target,label:isHi?'अवधारणाएँ':'Concepts',value:'0',color:'#2DC653'},
            {icon:Clock,label:isHi?'कुल समय':'Total Time',value:isHi?'0 मिनट':'0 min',color:'#00B4D8'}
          ].map((s,i)=><div key={i} className="glass rounded-xl p-4 card-interactive"><s.icon className="w-5 h-5 mb-2" style={{color:s.color}} /><div className="text-lg font-extrabold" style={{color:s.color}}>{s.value}</div><div className="text-xs text-white/25">{s.label}</div></div>)}
        </div>
        {/* Weekly XP Chart */}
        <div className="glass rounded-2xl p-6 animate-slide-up" style={{animationDelay:'0.15s'}}>
          <h3 className="font-bold mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4" style={{color:'#FF6B35'}} />{isHi?'साप्ताहिक XP':'Weekly XP'}</h3>
          <div className="flex items-end justify-between gap-2 h-32">{WEEKLY.map(d=>(
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1"><div className="text-[10px] font-bold" style={{color:'#FFB800'}}>{d.xp}</div><div className="w-full rounded-t-lg" style={{height:`${(d.xp/maxXP)*100}%`,minHeight:'4px',background:'linear-gradient(180deg,#FF6B35,#FFB800)',opacity:0.6+(d.xp/maxXP)*0.4}} /><div className="text-[10px] text-white/25">{d.day}</div></div>
          ))}</div>
        </div>
        {/* Bloom's Distribution */}
        <div className="glass rounded-2xl p-6 animate-slide-up" style={{animationDelay:'0.2s'}}>
          <h3 className="font-bold mb-4 flex items-center gap-2"><Brain className="w-4 h-4" style={{color:'#9B4DAE'}} />{isHi?"ब्लूम का स्तर":"Bloom's Levels"}</h3>
          <p className="text-xs text-white/25 mb-4">{isHi?'NEP 2020: CBSE बोर्ड के 50% प्रश्न योग्यता-आधारित':'NEP 2020: 50% of CBSE board questions are competency-based'}</p>
          <div className="space-y-3">{BLOOMS.map((b,i)=>{const pct=Math.max(5,100-i*18);return(<div key={b.level} className="flex items-center gap-3"><div className="w-16 text-xs font-bold" style={{color:b.color}}>{isHi?b.hi:b.level}</div><div className="flex-1 bg-surface-800/50 rounded-full h-2"><div className="h-2 rounded-full" style={{width:`${pct}%`,background:b.color,opacity:0.7}} /></div><div className="w-8 text-xs text-white/20 text-right">{pct}%</div></div>);})}</div>
          <div className="mt-4 p-3 rounded-lg text-xs" style={{background:'rgba(123,45,142,0.1)',border:'1px solid rgba(123,45,142,0.2)'}}>🦊 {isHi?'टिप: "विश्लेषण" और "मूल्यांकन" पर ज़्यादा अभ्यास करो — बोर्ड में ज़रूरी!':'Tip: Practice more at "Analyze" and "Evaluate" — crucial for boards!'}</div>
        </div>
        {/* NEP Compliance */}
        <div className="rounded-2xl p-5 animate-slide-up" style={{animationDelay:'0.25s',background:'linear-gradient(135deg,rgba(0,180,216,0.1),rgba(123,45,142,0.1))',border:'1px solid rgba(0,180,216,0.2)'}}>
          <div className="flex items-center gap-3"><div className="text-3xl">🏛️</div><div><div className="font-bold text-sm">{isHi?'NEP 2020 समग्र प्रगति कार्ड':'NEP 2020 Holistic Progress Card'}</div><div className="text-xs text-white/30 mt-1">{isHi?'CBSE अनुपालन: योग्यता, कौशल, समग्र विकास':'CBSE-compliant: Competency, skills, holistic development'}</div><button className="mt-2 px-3 py-1 rounded-lg text-xs font-bold" style={{background:'rgba(0,180,216,0.2)',color:'#00B4D8'}}>{isHi?'जल्द आ रहा है':'Coming Soon'}</button></div></div>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
