'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import { Sparkles, GraduationCap, Globe, BookOpen } from 'lucide-react';

const GRADES = [6,7,8,9,10,11,12];
const BOARDS = [{id:'CBSE',label:'CBSE',hi:'सीबीएसई'},{id:'ICSE',label:'ICSE',hi:'आईसीएसई'},{id:'STATE',label:'State Board',hi:'राज्य बोर्ड'}];
const LANGUAGES = [{id:'en',label:'English',emoji:'🇬🇧'},{id:'hi',label:'हिन्दी',emoji:'🇮🇳'},{id:'hinglish',label:'Hinglish',emoji:'🔀'}];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [grade, setGrade] = useState(9);
  const [board, setBoard] = useState('CBSE');
  const [lang, setLang] = useState('en');
  const { login, isLoggedIn } = useStudent();
  const router = useRouter();

  if (isLoggedIn) { router.push('/dashboard'); return null; }

  const handleComplete = () => { login(name, grade, board, lang); router.push('/dashboard'); };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0" style={{background:'radial-gradient(ellipse at 20% 50%,rgba(123,45,142,0.15) 0%,transparent 50%),radial-gradient(ellipse at 80% 50%,rgba(255,107,53,0.1) 0%,transparent 50%),#0D0B15'}} />
      {[...Array(6)].map((_,i) => <div key={i} className="absolute rounded-full opacity-20 animate-float" style={{width:`${8+i*4}px`,height:`${8+i*4}px`,background:i%2===0?'#FF6B35':'#7B2D8E',left:`${10+i*15}%`,top:`${20+(i%3)*25}%`,animationDelay:`${i*0.5}s`}} />)}
      <div className="relative z-10 w-full max-w-lg">
        <div className="text-center mb-8 animate-slide-up">
          <div className="text-6xl mb-3">🦊</div>
          <h1 className="text-3xl font-extrabold gradient-text">Alfanumrik</h1>
          <p className="text-white/30 text-sm mt-1 font-medium tracking-wide">ADAPTIVE LEARNING OS</p>
        </div>
        <div className="glass rounded-2xl p-8 animate-slide-up" style={{animationDelay:'0.15s'}}>
          {step === 0 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-2"><Sparkles className="w-5 h-5 text-brand-orange" /><h2 className="text-xl font-bold">Welcome! What&apos;s your name?</h2></div>
              <p className="text-white/40 text-sm">Foxy is excited to meet you! 🐾</p>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Enter your name..." className="w-full px-4 py-3 rounded-xl bg-surface-800/50 border border-white/10 text-white placeholder-white/30 focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20 transition-all text-lg" autoFocus />
              <button onClick={() => name.trim() && setStep(1)} disabled={!name.trim()} className="w-full py-3 rounded-xl font-bold text-white transition-all disabled:opacity-30" style={{background:name.trim()?'linear-gradient(135deg,#FF6B35,#FFB800)':'#333'}}>Next →</button>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-2"><GraduationCap className="w-5 h-5 text-brand-purple" /><h2 className="text-xl font-bold">Hi {name}! Which class?</h2></div>
              <div className="grid grid-cols-4 gap-3">
                {GRADES.map(g => <button key={g} onClick={() => setGrade(g)} className="py-3 rounded-xl font-bold text-center transition-all border" style={{background:grade===g?'linear-gradient(135deg,#7B2D8E,#9B4DAE)':'rgba(30,27,46,0.5)',borderColor:grade===g?'#9B4DAE':'rgba(255,255,255,0.1)',color:grade===g?'#fff':'rgba(255,255,255,0.6)',transform:grade===g?'scale(1.05)':'scale(1)'}}>{g}</button>)}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(0)} className="flex-1 py-3 rounded-xl font-bold text-white/40 border border-white/10">← Back</button>
                <button onClick={() => setStep(2)} className="flex-1 py-3 rounded-xl font-bold text-white" style={{background:'linear-gradient(135deg,#FF6B35,#FFB800)'}}>Next →</button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-2"><BookOpen className="w-5 h-5 text-brand-teal" /><h2 className="text-xl font-bold">Which board?</h2></div>
              <div className="space-y-3">
                {BOARDS.map(b => <button key={b.id} onClick={() => setBoard(b.id)} className="w-full py-4 px-5 rounded-xl font-bold text-left transition-all border flex items-center justify-between" style={{background:board===b.id?'linear-gradient(135deg,rgba(0,180,216,0.2),rgba(0,180,216,0.05))':'rgba(30,27,46,0.5)',borderColor:board===b.id?'#00B4D8':'rgba(255,255,255,0.1)'}}><span>{b.label}</span>{board===b.id && <span className="text-brand-teal">✓</span>}</button>)}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="flex-1 py-3 rounded-xl font-bold text-white/40 border border-white/10">← Back</button>
                <button onClick={() => setStep(3)} className="flex-1 py-3 rounded-xl font-bold text-white" style={{background:'linear-gradient(135deg,#FF6B35,#FFB800)'}}>Next →</button>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-2"><Globe className="w-5 h-5 text-brand-gold" /><h2 className="text-xl font-bold">Preferred language?</h2></div>
              <div className="space-y-3">
                {LANGUAGES.map(l => <button key={l.id} onClick={() => setLang(l.id)} className="w-full py-4 px-5 rounded-xl font-bold text-left transition-all border flex items-center gap-4" style={{background:lang===l.id?'linear-gradient(135deg,rgba(255,184,0,0.2),rgba(255,184,0,0.05))':'rgba(30,27,46,0.5)',borderColor:lang===l.id?'#FFB800':'rgba(255,255,255,0.1)'}}><span className="text-2xl">{l.emoji}</span><span>{l.label}</span>{lang===l.id && <span className="ml-auto text-brand-gold">✓</span>}</button>)}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(2)} className="flex-1 py-3 rounded-xl font-bold text-white/40 border border-white/10">← Back</button>
                <button onClick={handleComplete} className="flex-1 py-3 rounded-xl font-bold text-white animate-pulse-glow" style={{background:'linear-gradient(135deg,#FF6B35,#FFB800)'}}>🦊 Start Learning!</button>
              </div>
            </div>
          )}
          <div className="flex justify-center gap-2 mt-6">
            {[0,1,2,3].map(i => <div key={i} className="h-2 rounded-full transition-all" style={{background:i===step?'#FF6B35':i<step?'#7B2D8E':'rgba(255,255,255,0.15)',width:i===step?'24px':'8px'}} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
