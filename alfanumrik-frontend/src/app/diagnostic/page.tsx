'use client';
import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import { selectNextItem, updateTheta } from '@/lib/engine';
import { ALL_CONCEPTS, ALL_QUESTIONS } from '@/data/curriculum';
import type { Subject } from '@/lib/types';
import { ArrowLeft, Brain, Target, Loader2, CheckCircle2, AlertTriangle, TrendingUp, ChevronRight, Sparkles } from 'lucide-react';

const ITEMS = ALL_CONCEPTS.map(c => ({ id:c.id, difficulty:c.difficulty, discrimination:c.discrimination, grade:c.grade, subject:c.subject, title:c.title, titleHi:c.titleHi||c.title, bloomLevel:c.bloomLevel }));
const MAX_Q = 10;

export default function DiagnosticPage() {
  const { student, isHi, addXP, isLoggedIn } = useStudent();
  const router = useRouter();
  const [state, setState] = useState<'intro'|'testing'|'analyzing'|'results'>('intro');
  const [subject, setSubject] = useState<Subject>('math');
  const [theta, setTheta] = useState(0);
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [currentItem, setCurrentItem] = useState<typeof ITEMS[0]|null>(null);
  const [selected, setSelected] = useState<string|null>(null);
  const [showRes, setShowRes] = useState(false);
  const [qCount, setQCount] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [results, setResults] = useState<{estimatedGrade:number;theta:number;strengths:string[];gaps:string[];path:string[]}|null>(null);

  if(!isLoggedIn||!student){router.push('/');return null;}
  const subjectItems = ITEMS.filter(i=>i.subject===subject);

  const start = (s:Subject) => {
    setSubject(s); setTheta(0); setAnswered(new Set()); setQCount(0); setCorrect(0); setState('testing');
    const first = selectNextItem(0, ITEMS.filter(i=>i.subject===s), new Set());
    setCurrentItem(first ? ITEMS.find(i=>i.id===first.id)||null : null);
  };

  const answer = useCallback((optId:string) => {
    if(!currentItem||showRes) return;
    setSelected(optId); setShowRes(true);
    const realQ = ALL_QUESTIONS.find(q=>q.conceptId===currentItem.id);
    const isCorrect = realQ ? realQ.options?.find(o=>o.id===optId)?.isCorrect ?? false : optId==='a';
    if(isCorrect) setCorrect(c=>c+1);
    const newTheta = updateTheta(theta, isCorrect, currentItem.difficulty, currentItem.discrimination);
    setTheta(newTheta);
    const newAnswered = new Set(answered).add(currentItem.id);
    setAnswered(newAnswered); setQCount(q=>q+1);

    setTimeout(() => {
      setShowRes(false); setSelected(null);
      if(qCount+1 >= MAX_Q || newAnswered.size >= subjectItems.length) {
        setState('analyzing');
        setTimeout(() => {
          const estGrade = Math.round(Math.min(12,Math.max(4,8+newTheta*2)));
          const concepts = ALL_CONCEPTS.filter(c=>newAnswered.has(c.id)&&c.subject===subject);
          const strengths = concepts.filter(c=>c.difficulty<newTheta+0.3).slice(0,3).map(c=>isHi&&c.titleHi?c.titleHi:c.title);
          const gaps = concepts.filter(c=>c.difficulty>newTheta).slice(0,3).map(c=>isHi&&c.titleHi?c.titleHi:c.title);
          const path = ALL_CONCEPTS.filter(c=>c.subject===subject&&c.difficulty>=newTheta-0.2&&c.difficulty<=newTheta+0.5).sort((a,b)=>a.difficulty-b.difficulty).slice(0,5).map(c=>isHi&&c.titleHi?c.titleHi:c.title);
          setResults({estimatedGrade:estGrade,theta:newTheta,strengths,gaps,path});
          addXP(50); setState('results');
        }, 2500);
      } else {
        const next = selectNextItem(newTheta, subjectItems, newAnswered);
        setCurrentItem(next ? ITEMS.find(i=>i.id===next.id)||null : null);
      }
    }, 1500);
  },[currentItem,theta,answered,qCount,subjectItems,showRes,subject,isHi,addXP]);

  // INTRO
  if(state==='intro') return(
    <div className="min-h-screen flex flex-col">
      <div className="sticky top-0 z-50 glass border-b border-white/5"><div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3"><button onClick={()=>router.push('/dashboard')}><ArrowLeft className="w-5 h-5 text-white/40" /></button><div className="font-bold">{isHi?'🎯 नैदानिक परीक्षा':'🎯 Diagnostic Test'}</div></div></div>
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 animate-slide-up">
          <div className="text-center"><div className="text-6xl mb-4">🎯</div><h1 className="text-2xl font-extrabold mb-2">{isHi?'तुम्हारा सही स्तर जानो':'Find Your True Level'}</h1><p className="text-sm text-white/30">{isHi?'यह परीक्षा तुम्हारा असली स्तर पता लगाएगी — ताकि हम सही जगह से शुरू करें!':'This discovers your actual level — so we teach at the right place for YOU!'}</p></div>
          <div className="glass rounded-xl p-4 text-sm"><div className="flex items-center gap-2 mb-2 font-bold" style={{color:'#FFB800'}}><Sparkles className="w-4 h-4" />{isHi?'कैसे:':'How:'}</div><div className="space-y-1 text-white/40"><p>🔹 {isHi?'10 अनुकूली प्रश्न':'10 adaptive questions'}</p><p>🔹 {isHi?'कठिनाई स्वतः बदलती है':'Difficulty auto-adjusts'}</p><p>🔹 +50 XP</p></div></div>
          <div className="space-y-3"><p className="text-sm font-bold text-center text-white/25">{isHi?'विषय चुनो:':'Choose subject:'}</p>
            {([['math','🧮','Mathematics','गणित'],['science','🔬','Science','विज्ञान']] as const).map(([s,icon,en,hi])=>(
              <button key={s} onClick={()=>start(s as Subject)} className="w-full p-4 rounded-xl flex items-center gap-4 card-interactive border" style={{background:'rgba(30,27,46,0.5)',borderColor:'rgba(255,255,255,0.1)'}}>
                <span className="text-3xl">{icon}</span><div className="flex-1 text-left"><div className="font-bold">{isHi?hi:en}</div></div><ChevronRight className="w-5 h-5 text-white/20" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // TESTING
  if(state==='testing'&&currentItem) {
    const realQ = ALL_QUESTIONS.find(q=>q.conceptId===currentItem.id);
    const opts = realQ?.options || [{id:'a',text:'I can solve this confidently',textHi:'मैं आत्मविश्वास से हल कर सकता/सकती हूँ',isCorrect:true},{id:'b',text:'I need practice',textHi:'अभ्यास चाहिए',isCorrect:false},{id:'c',text:'I barely understand',textHi:'बमुश्किल समझता/समझती हूँ',isCorrect:false},{id:'d',text:"Haven't learned yet",textHi:'अभी नहीं पढ़ा',isCorrect:false}];
    const qText = realQ ? (isHi&&realQ.questionTextHi?realQ.questionTextHi:realQ.questionText) : (isHi?`"${currentItem.titleHi}" के बारे में तुम्हारा स्तर क्या है?`:`How well do you know "${currentItem.title}"?`);
    return(
      <div className="min-h-screen flex flex-col">
        <div className="sticky top-0 z-50 glass border-b border-white/5"><div className="max-w-2xl mx-auto px-4 py-3"><div className="flex items-center justify-between mb-2"><span className="text-sm text-white/30 flex items-center gap-2"><Target className="w-4 h-4" style={{color:'#FF6B35'}} />{isHi?'नैदानिक':'Diagnostic'}</span><span className="text-xs text-white/25">{qCount+1}/{MAX_Q}</span></div><div className="w-full bg-surface-800/50 rounded-full h-2"><div className="h-2 rounded-full transition-all" style={{width:`${((qCount+1)/MAX_Q)*100}%`,background:'linear-gradient(90deg,#7B2D8E,#00B4D8)'}} /></div></div></div>
        <div className="flex-1 max-w-2xl mx-auto px-4 py-6 w-full"><div className="animate-slide-up">
          <div className="text-xs text-white/20 mb-2 flex items-center gap-2"><Brain className="w-3.5 h-3.5" />{isHi?currentItem.titleHi:currentItem.title}<span className="ml-auto px-2 py-0.5 rounded-full text-[10px]" style={{background:'rgba(123,45,142,0.15)',color:'#9B4DAE'}}>{isHi?`कक्षा ${currentItem.grade}`:`Class ${currentItem.grade}`}</span></div>
          <h2 className="text-lg font-bold leading-relaxed mb-6">{qText}</h2>
          <div className="space-y-3">{opts.map((opt,i) => {
            let st: React.CSSProperties = {background:'rgba(30,27,46,0.5)',borderColor:selected===opt.id&&!showRes?'#7B2D8E':'rgba(255,255,255,0.08)'};
            if(showRes&&selected===opt.id){const c=realQ?opt.isCorrect:opt.id==='a';st={background:c?'rgba(45,198,83,0.15)':'rgba(255,71,87,0.15)',borderColor:c?'#2DC653':'#FF4757'};}
            if(showRes&&selected!==opt.id&&(realQ?opt.isCorrect:opt.id==='a'))st={background:'rgba(45,198,83,0.1)',borderColor:'#2DC653'};
            return <button key={opt.id} onClick={()=>answer(opt.id)} disabled={showRes} className="w-full p-4 rounded-xl border text-left flex items-center gap-3 font-medium transition-all" style={st}><span className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0" style={{background:selected===opt.id?'rgba(123,45,142,0.3)':'rgba(255,255,255,0.05)'}}>{String.fromCharCode(65+i)}</span><span className="flex-1 text-sm">{isHi&&opt.textHi?opt.textHi:opt.text}</span></button>;
          })}</div>
        </div></div>
      </div>
    );
  }

  // ANALYZING
  if(state==='analyzing') return(
    <div className="min-h-screen flex items-center justify-center p-4"><div className="text-center animate-slide-up space-y-6"><Loader2 className="w-16 h-16 mx-auto animate-spin" style={{color:'#7B2D8E'}} /><h2 className="text-xl font-bold">{isHi?'🧠 विश्लेषण हो रहा है...':'🧠 Analyzing...'}</h2><div className="space-y-3 text-sm text-white/25"><p className="animate-pulse">{isHi?'📊 स्तर निर्धारित कर रहे हैं':'📊 Determining your level'}</p><p className="animate-pulse" style={{animationDelay:'0.5s'}}>{isHi?'🎯 कमियाँ पहचान रहे हैं':'🎯 Identifying gaps'}</p><p className="animate-pulse" style={{animationDelay:'1s'}}>{isHi?'🗺️ रास्ता बना रहे हैं':'🗺️ Building your path'}</p></div></div></div>
  );

  // RESULTS
  if(state==='results'&&results) {
    const gc = results.estimatedGrade>=student.grade?'#2DC653':'#FFB800';
    return(
      <div className="min-h-screen pb-8">
        <div className="sticky top-0 z-50 glass border-b border-white/5"><div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3"><button onClick={()=>router.push('/dashboard')}><ArrowLeft className="w-5 h-5 text-white/40" /></button><div className="font-bold">{isHi?'📊 परिणाम':'📊 Results'}</div></div></div>
        <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
          <div className="glass rounded-2xl p-6 text-center animate-bounce-in"><div className="text-sm text-white/30 mb-2">{isHi?'अनुमानित स्तर':'Estimated Level'}</div><div className="text-6xl font-extrabold mb-2" style={{color:gc}}>{isHi?`कक्षा ${results.estimatedGrade}`:`Class ${results.estimatedGrade}`}</div><div className="text-sm text-white/25">{results.estimatedGrade<student.grade?(isHi?`📍 तुम कक्षा ${student.grade} में हो लेकिन कुछ में कक्षा ${results.estimatedGrade} स्तर — चिंता मत करो!`:`📍 In Class ${student.grade} but some areas at Class ${results.estimatedGrade} — don't worry!`):(isHi?'🌟 बहुत बढ़िया!':'🌟 Excellent!')}</div></div>
          <div className="grid grid-cols-3 gap-3 animate-slide-up"><div className="glass rounded-xl p-4 text-center"><div className="text-2xl font-extrabold" style={{color:'#2DC653'}}>{correct}/{MAX_Q}</div><div className="text-xs text-white/25">{isHi?'सही':'Correct'}</div></div><div className="glass rounded-xl p-4 text-center"><div className="text-2xl font-extrabold" style={{color:'#FFB800'}}>+50</div><div className="text-xs text-white/25">XP</div></div><div className="glass rounded-xl p-4 text-center"><div className="text-2xl font-extrabold" style={{color:'#00B4D8'}}>{results.theta.toFixed(1)}</div><div className="text-xs text-white/25">θ</div></div></div>
          {results.strengths.length>0&&<div className="glass rounded-xl p-5 animate-slide-up"><h3 className="font-bold text-sm mb-3 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" style={{color:'#2DC653'}} />{isHi?'ताकत':'Strengths'}</h3><div className="space-y-2">{results.strengths.map((s,i)=><div key={i} className="flex items-center gap-2 text-sm"><span style={{color:'#2DC653'}}>✓</span><span className="text-white/50">{s}</span></div>)}</div></div>}
          {results.gaps.length>0&&<div className="rounded-xl p-5 animate-slide-up" style={{background:'rgba(255,184,0,0.05)',border:'1px solid rgba(255,184,0,0.2)'}}><h3 className="font-bold text-sm mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4" style={{color:'#FFB800'}} />{isHi?'सुधार':'Improve'}</h3><div className="space-y-2">{results.gaps.map((g,i)=><div key={i} className="flex items-center gap-2 text-sm"><span style={{color:'#FFB800'}}>▸</span><span className="text-white/50">{g}</span></div>)}</div></div>}
          <div className="glass rounded-xl p-5 animate-slide-up"><h3 className="font-bold text-sm mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4" style={{color:'#7B2D8E'}} />{isHi?'🗺️ सीखने का रास्ता':'🗺️ Learning Path'}</h3><div className="space-y-3">{results.path.map((r,i)=><div key={i} className="flex items-center gap-3"><div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{background:'rgba(123,45,142,0.2)',color:'#9B4DAE'}}>{i+1}</div><span className="text-sm text-white/50">{r}</span></div>)}</div></div>
          <div className="flex gap-3"><button onClick={()=>router.push('/dashboard')} className="flex-1 py-3 rounded-xl font-bold border border-white/10 text-white/40">{isHi?'डैशबोर्ड':'Dashboard'}</button><button onClick={()=>router.push(`/learn/${subject}`)} className="flex-1 py-3 rounded-xl font-bold text-white" style={{background:'linear-gradient(135deg,#FF6B35,#FFB800)'}}>{isHi?'सीखना शुरू!':'Start Learning!'}</button></div>
        </div>
      </div>
    );
  }
  return null;
}
