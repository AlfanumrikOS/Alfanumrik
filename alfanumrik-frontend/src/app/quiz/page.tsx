'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import { calculateXP, getBloomLabel, getBloomLabelHi, getBloomColor } from '@/lib/engine';
import { getAllQuestions } from '@/data/curriculum';
import { saveQuizSession } from '@/lib/supabase';
import type { Question } from '@/lib/types';
import { ArrowLeft, Clock, Zap, Flame, CheckCircle2, XCircle, Lightbulb, ChevronRight, Star } from 'lucide-react';

export default function QuizPage() {
  const { student, isHi, addXP, isLoggedIn } = useStudent();
  const router = useRouter();
  const [questions] = useState<Question[]>(() => {
    const all = getAllQuestions();
    return [...all].sort(() => Math.random()-0.5).slice(0,5);
  });
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<string|null>(null);
  const [showResult, setShowResult] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [streak, setStreak] = useState(0);
  const [totalXP, setTotalXP] = useState(0);
  const [score, setScore] = useState(0);
  const [timer, setTimer] = useState(0);
  const [qStart, setQStart] = useState(Date.now());
  const [finished, setFinished] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);

  const q = questions[idx];

  useEffect(() => { if(!finished){const t=setInterval(()=>setTimer(v=>v+1),1000);return()=>clearInterval(t);} }, [finished]);

  const handleSubmit = useCallback(() => {
    if(!selected||!q) return;
    const correct = q.options?.find(o=>o.id===selected)?.isCorrect ?? false;
    const earned = calculateXP(correct,q.bloomLevel,streak,Date.now()-qStart,showHint?1:0,q.difficulty);
    setShowResult(true);
    setTotalXP(v=>v+earned);
    setResults(r=>[...r,correct]);
    if(correct){setStreak(s=>s+1);setScore(s=>s+1);}else{setStreak(0);}
  },[selected,q,streak,qStart,showHint]);

  const handleNext = useCallback(() => {
    if(idx>=questions.length-1){
      addXP(totalXP);
      // Save session to Supabase
      if(student) {
        saveQuizSession({
          studentId: student.id,
          subject: 'mixed',
          questionsAttempted: questions.length,
          questionsCorrect: score,
          xpEarned: totalXP,
          durationSeconds: timer,
        });
      }
      setFinished(true);
      return;
    }
    setIdx(i=>i+1);setSelected(null);setShowResult(false);setShowHint(false);setQStart(Date.now());
  },[idx,questions.length,totalXP,addXP,student,score,timer]);

  if(!isLoggedIn){router.push('/');return null;}

  const fmt = (s:number) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;

  if(finished){
    const pct=Math.round((score/questions.length)*100);
    const stars=pct>=80?3:pct>=60?2:pct>=40?1:0;
    return(
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center animate-bounce-in">
          <div className="flex justify-center gap-2 mb-6">{[1,2,3].map(i=><Star key={i} className="w-12 h-12" style={{color:i<=stars?'#FFB800':'rgba(255,255,255,0.1)',fill:i<=stars?'#FFB800':'none'}} />)}</div>
          <div className="text-6xl mb-4">{pct>=80?'🎉':pct>=60?'👏':pct>=40?'💪':'🦊'}</div>
          <h1 className="text-3xl font-extrabold mb-2">{pct>=80?(isHi?'शानदार!':'Outstanding!'):pct>=60?(isHi?'बहुत अच्छा!':'Great Job!'):(isHi?'कोशिश जारी रखो!':'Keep Trying!')}</h1>
          <div className="glass rounded-2xl p-6 mt-6">
            <div className="grid grid-cols-3 gap-4">
              <div><div className="text-2xl font-extrabold" style={{color:'#2DC653'}}>{score}/{questions.length}</div><div className="text-xs text-white/30">{isHi?'सही':'Correct'}</div></div>
              <div><div className="text-2xl font-extrabold" style={{color:'#FFB800'}}>+{totalXP}</div><div className="text-xs text-white/30">XP</div></div>
              <div><div className="text-2xl font-extrabold" style={{color:'#FF6B35'}}>{fmt(timer)}</div><div className="text-xs text-white/30">{isHi?'समय':'Time'}</div></div>
            </div>
            <div className="flex justify-center gap-2 mt-4">{results.map((c,i)=><div key={i} className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold" style={{background:c?'rgba(45,198,83,0.2)':'rgba(255,71,87,0.2)',border:`1px solid ${c?'#2DC653':'#FF4757'}`}}>{c?'✓':'✗'}</div>)}</div>
          </div>
          <div className="flex gap-3 mt-6">
            <button onClick={()=>router.push('/dashboard')} className="flex-1 py-3 rounded-xl font-bold border border-white/10 text-white/40">{isHi?'होम':'Home'}</button>
            <button onClick={()=>window.location.reload()} className="flex-1 py-3 rounded-xl font-bold text-white" style={{background:'linear-gradient(135deg,#FF6B35,#FFB800)'}}>{isHi?'फिर से खेलो':'Play Again'}</button>
          </div>
        </div>
      </div>
    );
  }

  return(
    <div className="min-h-screen flex flex-col">
      <div className="sticky top-0 z-50 glass border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <button onClick={()=>router.push('/dashboard')}><ArrowLeft className="w-5 h-5 text-white/40" /></button>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-sm"><Clock className="w-4 h-4 text-white/30" /><span className="font-mono text-white/50">{fmt(timer)}</span></div>
              <div className="flex items-center gap-1.5 text-sm"><Zap className="w-4 h-4" style={{color:'#FFB800'}} /><span className="font-bold" style={{color:'#FFB800'}}>+{totalXP}</span></div>
              {streak>=2 && <div className="flex items-center gap-1 text-sm animate-bounce-in"><Flame className="w-4 h-4" style={{color:'#FF6B35'}} /><span className="font-bold streak-glow">{streak}🔥</span></div>}
            </div>
          </div>
          <div className="w-full bg-surface-800/50 rounded-full h-2"><div className="h-2 rounded-full transition-all duration-500" style={{width:`${((idx+(showResult?1:0))/questions.length)*100}%`,background:'linear-gradient(90deg,#FF6B35,#FFB800)'}} /></div>
          <div className="flex justify-between mt-1">
            <span className="text-xs text-white/20">{isHi?`प्रश्न ${idx+1}/${questions.length}`:`Q ${idx+1}/${questions.length}`}</span>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{background:`${getBloomColor(q.bloomLevel)}20`,color:getBloomColor(q.bloomLevel)}}>{isHi?getBloomLabelHi(q.bloomLevel):getBloomLabel(q.bloomLevel)}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-2xl mx-auto px-4 py-6 w-full">
        <div className="animate-slide-up">
          <div className="flex items-center gap-2 mb-4">{[1,2,3,4,5].map(i=><div key={i} className="h-1.5 flex-1 rounded-full" style={{background:i<=Math.ceil(q.difficulty*5)?'linear-gradient(90deg,#2DC653,#FFB800,#FF4757)':'rgba(255,255,255,0.05)'}} />)}<span className="text-xs text-white/20 ml-2">{q.difficulty<0.4?(isHi?'आसान':'Easy'):q.difficulty<0.7?(isHi?'मध्यम':'Medium'):(isHi?'कठिन':'Hard')}</span></div>
          <h2 className="text-xl font-bold leading-relaxed mb-6">{isHi&&q.questionTextHi?q.questionTextHi:q.questionText}</h2>
          <div className="space-y-3">
            {q.options?.map((opt,oi) => {
              let st: React.CSSProperties = {borderColor:'rgba(255,255,255,0.1)',background:'rgba(30,27,46,0.5)'};
              let cls = 'quiz-option';
              if(showResult){
                if(opt.isCorrect){st={borderColor:'#2DC653',background:'rgba(45,198,83,0.15)'};cls+=' correct';}
                else if(selected===opt.id&&!opt.isCorrect){st={borderColor:'#FF4757',background:'rgba(255,71,87,0.15)'};cls+=' incorrect';}
              } else if(selected===opt.id){st={borderColor:'#FF6B35',background:'rgba(255,107,53,0.1)'};}
              return(
                <button key={opt.id} onClick={()=>!showResult&&setSelected(opt.id)} disabled={showResult} className={`${cls} w-full p-4 rounded-xl border text-left flex items-center gap-3 font-medium`} style={st}>
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0" style={{background:selected===opt.id&&!showResult?'rgba(255,107,53,0.3)':'rgba(255,255,255,0.05)'}}>{String.fromCharCode(65+oi)}</span>
                  <span className="flex-1">{isHi&&opt.textHi?opt.textHi:opt.text}</span>
                  {showResult&&opt.isCorrect&&<CheckCircle2 className="w-5 h-5 text-brand-green flex-shrink-0" />}
                  {showResult&&selected===opt.id&&!opt.isCorrect&&<XCircle className="w-5 h-5 flex-shrink-0" style={{color:'#FF4757'}} />}
                </button>
              );
            })}
          </div>
          {!showResult&&q.hint&&<button onClick={()=>setShowHint(!showHint)} className="mt-4 flex items-center gap-2 text-sm text-brand-gold/70 hover:text-brand-gold transition-all"><Lightbulb className="w-4 h-4" />{showHint?(isHi&&q.hintHi?q.hintHi:q.hint):(isHi?'💡 संकेत दिखाओ (-3 XP)':'💡 Show Hint (-3 XP)')}</button>}
          {showResult&&<div className="mt-6 p-4 rounded-xl animate-slide-up" style={{background:'rgba(123,45,142,0.1)',border:'1px solid rgba(123,45,142,0.3)'}}><div className="text-sm font-bold text-brand-purple-light mb-2">🦊 {isHi?'फॉक्सी कहती है:':'Foxy says:'}</div><p className="text-sm text-white/50 leading-relaxed">{isHi&&q.explanationHi?q.explanationHi:q.explanation}</p></div>}
        </div>
      </div>

      <div className="sticky bottom-0 glass border-t border-white/5 p-4">
        <div className="max-w-2xl mx-auto">
          {!showResult
            ? <button onClick={handleSubmit} disabled={!selected} className="w-full py-3.5 rounded-xl font-bold text-white transition-all disabled:opacity-30" style={{background:selected?'linear-gradient(135deg,#FF6B35,#FFB800)':'#333'}}>{isHi?'जमा करो':'Submit Answer'}</button>
            : <button onClick={handleNext} className="w-full py-3.5 rounded-xl font-bold text-white flex items-center justify-center gap-2" style={{background:'linear-gradient(135deg,#7B2D8E,#00B4D8)'}}>{idx>=questions.length-1?(isHi?'🏆 परिणाम देखो':'🏆 See Results'):(isHi?'अगला प्रश्न →':'Next Question →')}<ChevronRight className="w-5 h-5" /></button>}
        </div>
      </div>
    </div>
  );
}
