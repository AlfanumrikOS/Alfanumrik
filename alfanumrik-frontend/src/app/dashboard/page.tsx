'use client';
import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import BottomNav from '@/components/BottomNav';
import { getXPProgress } from '@/lib/engine';
import { getSubjectIcon, getSubjectLabel, getSubjectLabelHi, getSubjectColor, BADGES } from '@/data/curriculum';
import type { Subject } from '@/lib/types';
import { Flame, Trophy, Zap, Target, ChevronRight, Globe, LogOut, MessageCircle, Gamepad2, FlaskConical, BarChart3, RefreshCw } from 'lucide-react';

const SUBJECTS: { id: Subject; grades: string }[] = [{id:'math',grades:'6-12'},{id:'science',grades:'6-10'},{id:'english',grades:'6-12'}];

export default function DashboardPage() {
  const { student, isHi, setLang, logout, isLoggedIn } = useStudent();
  const router = useRouter();

  if (!isLoggedIn || !student) { router.push('/'); return null; }

  const xp = getXPProgress(student.xp);
  const hour = new Date().getHours();
  const greeting = isHi
    ? (hour<12?'🌅 सुप्रभात':hour<17?'☀️ नमस्ते':'🌙 शुभ संध्या') + `, ${student.name}!`
    : (hour<12?'🌅 Good morning':hour<17?'☀️ Good afternoon':'🌙 Good evening') + `, ${student.name}!`;

  return (
    <div className="min-h-screen pb-24">
      {/* Top Bar */}
      <div className="sticky top-0 z-50 glass border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3"><span className="text-2xl">🦊</span><span className="font-extrabold gradient-text text-lg">Alfanumrik</span></div>
          <div className="flex items-center gap-3">
            <button onClick={() => setLang(isHi?'en':'hi')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-white/10 hover:border-brand-gold/50 transition-all"><Globe className="w-3.5 h-3.5" />{isHi?'EN':'हिं'}</button>
            <button onClick={() => { logout(); router.push('/'); }} className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm" style={{background:'linear-gradient(135deg,#FF6B35,#FFB800)'}}>{student.name.charAt(0).toUpperCase()}</button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Greeting */}
        <div className="animate-slide-up">
          <h1 className="text-2xl font-extrabold">{greeting}</h1>
          <p className="text-white/30 text-sm mt-1">{isHi?'आज कुछ नया सीखने का समय है!':'Let\'s learn something amazing today!'}</p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3 animate-slide-up" style={{animationDelay:'0.1s'}}>
          <div className="glass rounded-xl p-4 text-center card-interactive">
            <Flame className="w-6 h-6 mx-auto mb-1" style={{color:'#FF6B35'}} />
            <div className="text-2xl font-extrabold streak-glow">{student.streak}</div>
            <div className="text-xs text-white/30">{isHi?'दिन स्ट्रीक':'Day Streak'}</div>
          </div>
          <div className="glass rounded-xl p-4 text-center card-interactive">
            <Zap className="w-6 h-6 mx-auto mb-1" style={{color:'#FFB800'}} />
            <div className="text-2xl font-extrabold" style={{color:'#FFB800'}}>{xp.level}</div>
            <div className="text-xs text-white/30">{isHi?'स्तर':'Level'}</div>
            <div className="w-full bg-surface-800/50 rounded-full h-1.5 mt-2"><div className="h-1.5 rounded-full xp-fill" style={{width:`${xp.percentage}%`,background:'linear-gradient(90deg,#FFB800,#FF6B35)'}} /></div>
            <div className="text-[10px] text-white/20 mt-1">{student.xp} XP</div>
          </div>
          <div className="glass rounded-xl p-4 text-center card-interactive cursor-pointer" onClick={() => router.push('/badges')}>
            <Trophy className="w-6 h-6 mx-auto mb-1" style={{color:'#9B4DAE'}} />
            <div className="text-2xl font-extrabold" style={{color:'#9B4DAE'}}>0</div>
            <div className="text-xs text-white/30">{isHi?'बैज':'Badges'}</div>
          </div>
        </div>

        {/* Daily Challenge */}
        <div className="animate-slide-up" style={{animationDelay:'0.15s'}}>
          <div className="rounded-2xl p-5 card-interactive cursor-pointer" style={{background:'linear-gradient(135deg,rgba(255,107,53,0.15),rgba(123,45,142,0.15))',border:'1px solid rgba(255,107,53,0.3)'}} onClick={() => router.push('/quiz')}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{background:'linear-gradient(135deg,#FF6B35,#FFB800)'}}><Target className="w-6 h-6 text-white" /></div>
                <div><div className="font-bold text-sm">{isHi?'🎯 आज की चुनौती':'🎯 Daily Challenge'}</div><div className="text-xs text-white/30">{isHi?'गणित दौड़ — 5 मिनट, 100 XP':'Math Sprint — 5 min, 100 XP'}</div></div>
              </div>
              <ChevronRight className="w-5 h-5 text-brand-orange" />
            </div>
          </div>
        </div>

        {/* Subjects */}
        <div className="animate-slide-up" style={{animationDelay:'0.2s'}}>
          <h2 className="text-lg font-bold mb-3">{isHi?'📚 विषय':'📚 Subjects'}</h2>
          <div className="space-y-3">
            {SUBJECTS.map(subj => (
              <button key={subj.id} onClick={() => router.push(`/learn/${subj.id}`)} className="w-full rounded-xl p-4 flex items-center gap-4 card-interactive border" style={{background:`linear-gradient(135deg,${getSubjectColor(subj.id)}10,${getSubjectColor(subj.id)}05)`,borderColor:`${getSubjectColor(subj.id)}30`}}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{background:`${getSubjectColor(subj.id)}20`}}>{getSubjectIcon(subj.id)}</div>
                <div className="flex-1 text-left"><div className="font-bold">{isHi?getSubjectLabelHi(subj.id):getSubjectLabel(subj.id)}</div><div className="text-xs text-white/25">{isHi?`कक्षा ${subj.grades}`:`Class ${subj.grades}`}</div><div className="w-full bg-surface-800/50 rounded-full h-1.5 mt-2"><div className="h-1.5 rounded-full" style={{width:'0%',background:getSubjectColor(subj.id)}} /></div></div>
                <ChevronRight className="w-5 h-5" style={{color:getSubjectColor(subj.id)}} />
              </button>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="animate-slide-up" style={{animationDelay:'0.25s'}}>
          <h2 className="text-lg font-bold mb-3">{isHi?'⚡ त्वरित कार्य':'⚡ Quick Actions'}</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              {href:'/foxy',icon:MessageCircle,label:isHi?'फॉक्सी':'Ask Foxy',color:'#FF6B35'},
              {href:'/quiz',icon:Gamepad2,label:isHi?'क्विज़':'Quiz',color:'#00B4D8'},
              {href:'/simulations',icon:FlaskConical,label:isHi?'लैब':'Lab',color:'#2DC653'},
              {href:'/diagnostic',icon:Target,label:isHi?'स्तर जाँचो':'My Level',color:'#FFB800'},
              {href:'/review',icon:RefreshCw,label:isHi?'दोहराओ':'Review',color:'#9B4DAE'},
              {href:'/progress',icon:BarChart3,label:isHi?'प्रगति':'Stats',color:'#9B4DAE'},
            ].map(a => (
              <button key={a.href} onClick={() => router.push(a.href)} className="glass rounded-xl p-4 text-center card-interactive">
                <a.icon className="w-6 h-6 mx-auto mb-2" style={{color:a.color}} />
                <div className="font-bold text-xs">{a.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Badges Preview */}
        <div className="animate-slide-up" style={{animationDelay:'0.3s'}}>
          <h2 className="text-lg font-bold mb-3">{isHi?'🏆 बैज अनलॉक करो':'🏆 Unlock Badges'}</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {BADGES.slice(0,5).map(b => (
              <div key={b.id} className="flex-shrink-0 glass rounded-xl p-4 w-28 text-center opacity-50">
                <div className="text-3xl mb-2">{b.icon}</div>
                <div className="text-xs font-bold truncate">{isHi?b.nameHi:b.name}</div>
                <div className="text-[10px] text-brand-gold mt-1">+{b.xpReward} XP</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
