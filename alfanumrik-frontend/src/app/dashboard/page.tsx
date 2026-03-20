'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import { getNextConcept, getDueReviews, type NextConcept } from '@/lib/supabase';
import { SUBJECT_CONFIG, MASTERY_CONFIG, type Subject } from '@/lib/types';
import { BookOpen, Brain, MessageCircle, FlaskConical, BarChart3, Flame, Zap, Star, ChevronRight, Bell } from 'lucide-react';

export default function DashboardPage() {
  const { student, snapshot, isLoggedIn, isLoading, isHi, refreshSnapshot, setLanguage } = useStudent();
  const router = useRouter();
  const [nextConcept, setNextConcept] = useState<NextConcept | null>(null);
  const [dueReviews, setDueReviews] = useState(0);

  useEffect(() => {
    if (!isLoggedIn && !isLoading) { router.push('/'); return; }
    if (student?.id) {
      refreshSnapshot();
      // Get next concept and due reviews
      getNextConcept(student.id, student.subject || 'math').then(c => setNextConcept(c));
      getDueReviews(student.id).then(r => { if (r) setDueReviews(r.due_count); });
    }
  }, [isLoggedIn, isLoading, student?.id]);

  if (isLoading || !student) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-2xl animate-pulse">🦊</div>
    </div>
  );

  const xp = snapshot?.student?.xp_total ?? student.xpTotal;
  const streak = snapshot?.student?.streak_days ?? student.streakDays;
  const streakBest = snapshot?.student?.streak_best ?? student.streakBest;
  const mastery = snapshot?.mastery ?? { not_started: 0, attempted: 0, familiar: 0, proficient: 0, mastered: 0 };
  const totalConcepts = Object.values(mastery).reduce((a, b) => a + b, 0) || 121;
  const masteredCount = mastery.mastered + mastery.proficient;

  const subjectConfig = SUBJECT_CONFIG[student.subject as Subject] || SUBJECT_CONFIG.math;

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-50 glass border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🦊</span>
            <span className="font-bold text-lg" style={{background:'linear-gradient(135deg,#FF6B35,#FFB800)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>Alfanumrik</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setLanguage(student.language === 'hi' ? 'en' : 'hi')} className="text-xs px-2 py-1 rounded-lg border border-white/10 text-white/50 hover:text-white/80 transition-colors">
              {student.language === 'hi' ? '🌐 EN' : '🇮🇳 हिं'}
            </button>
            <button className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold" style={{background:'linear-gradient(135deg,#FF6B35,#FFB800)'}}>
              {student.name[0]?.toUpperCase()}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        {/* Welcome + XP Bar */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-xl font-bold">{isHi ? `नमस्ते, ${student.name}!` : `Hey, ${student.name}!`}</h1>
              <p className="text-sm text-white/40">{isHi ? `कक्षा ${student.grade} • ${subjectConfig.nameHi}` : `Class ${student.grade} • ${subjectConfig.nameEn}`}</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold" style={{color:'#FFB800'}}>{xp} <span className="text-xs text-white/30">XP</span></div>
            </div>
          </div>
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mt-4">
            <div className="text-center p-2 rounded-xl" style={{background:'rgba(255,107,53,0.1)'}}>
              <Flame className="w-5 h-5 mx-auto mb-1" style={{color:'#FF6B35'}} />
              <div className="text-lg font-bold">{streak}</div>
              <div className="text-[10px] text-white/30">{isHi ? 'दिन स्ट्रीक' : 'Day Streak'}</div>
            </div>
            <div className="text-center p-2 rounded-xl" style={{background:'rgba(255,184,0,0.1)'}}>
              <Star className="w-5 h-5 mx-auto mb-1" style={{color:'#FFB800'}} />
              <div className="text-lg font-bold">{masteredCount}</div>
              <div className="text-[10px] text-white/30">{isHi ? 'महारत' : 'Mastered'}</div>
            </div>
            <div className="text-center p-2 rounded-xl" style={{background:'rgba(0,180,216,0.1)'}}>
              <Bell className="w-5 h-5 mx-auto mb-1" style={{color:'#00B4D8'}} />
              <div className="text-lg font-bold">{dueReviews}</div>
              <div className="text-[10px] text-white/30">{isHi ? 'रिव्यू बाकी' : 'Due Reviews'}</div>
            </div>
          </div>
        </div>

        {/* Continue Learning — from knowledge graph */}
        {nextConcept && nextConcept.status === 'found' && (
          <button onClick={() => router.push('/foxy')} className="w-full glass rounded-2xl p-5 text-left transition-all hover:scale-[1.01] active:scale-[0.99] border border-white/5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-white/30 mb-1">{isHi ? 'आगे सीखो' : 'Continue Learning'}</div>
                <div className="font-bold">{isHi && nextConcept.title_hi ? nextConcept.title_hi : nextConcept.title_en}</div>
                <div className="text-xs text-white/25 mt-1">{isHi ? `कक्षा ${nextConcept.grade}` : `Class ${nextConcept.grade}`} • {nextConcept.chapter} • ~{nextConcept.estimated_minutes} min</div>
              </div>
              <ChevronRight className="w-5 h-5 text-white/20" />
            </div>
          </button>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => router.push('/quiz')} className="glass rounded-xl p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98]">
            <Brain className="w-6 h-6 mb-2" style={{color:'#FF6B35'}} />
            <div className="font-bold text-sm">{isHi ? 'क्विज़ खेलो' : 'Play Quiz'}</div>
            <div className="text-xs text-white/25 mt-1">{isHi ? 'अपना ज्ञान परखो' : 'Test your knowledge'}</div>
          </button>
          <button onClick={() => router.push('/foxy')} className="glass rounded-xl p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98]">
            <MessageCircle className="w-6 h-6 mb-2" style={{color:'#00B4D8'}} />
            <div className="font-bold text-sm">{isHi ? 'फॉक्सी से पूछो' : 'Ask Foxy'}</div>
            <div className="text-xs text-white/25 mt-1">{isHi ? 'AI ट्यूटर से बात करो' : 'Chat with AI tutor'}</div>
          </button>
          <button onClick={() => router.push('/review')} className="glass rounded-xl p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98]">
            <Zap className="w-6 h-6 mb-2" style={{color:'#FFB800'}} />
            <div className="font-bold text-sm">{isHi ? 'रिव्यू करो' : 'Review'}</div>
            <div className="text-xs text-white/25 mt-1">{dueReviews > 0 ? `${dueReviews} ${isHi ? 'बाकी' : 'due'}` : (isHi ? 'सब पूरा!' : 'All caught up!')}</div>
          </button>
          <button onClick={() => router.push('/progress')} className="glass rounded-xl p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98]">
            <BarChart3 className="w-6 h-6 mb-2" style={{color:'#9B4DAE'}} />
            <div className="font-bold text-sm">{isHi ? 'प्रगति देखो' : 'My Progress'}</div>
            <div className="text-xs text-white/25 mt-1">{masteredCount}/{totalConcepts > 121 ? 121 : totalConcepts} {isHi ? 'पूरे' : 'concepts'}</div>
          </button>
        </div>

        {/* Mastery Progress Bar */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold">{isHi ? 'महारत प्रगति' : 'Mastery Progress'}</span>
            <span className="text-xs text-white/30">{Math.round((masteredCount / Math.max(totalConcepts, 1)) * 100)}%</span>
          </div>
          <div className="w-full h-4 rounded-full overflow-hidden flex" style={{background:'rgba(255,255,255,0.05)'}}>
            {(['mastered', 'proficient', 'familiar', 'attempted'] as const).map(level => {
              const count = mastery[level] || 0;
              const pct = (count / Math.max(totalConcepts, 1)) * 100;
              if (pct === 0) return null;
              return (
                <div key={level} style={{width:`${pct}%`, background: MASTERY_CONFIG[level].color}} className="h-full transition-all duration-500" />
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-white/30">
            {(['mastered', 'proficient', 'familiar', 'attempted'] as const).map(level => (
              <span key={level} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{background: MASTERY_CONFIG[level].color}} />
                {mastery[level] || 0} {isHi ? MASTERY_CONFIG[level].labelHi : MASTERY_CONFIG[level].label}
              </span>
            ))}
          </div>
        </div>

        {/* Subject Selector */}
        <div className="glass rounded-2xl p-5">
          <div className="text-sm font-bold mb-3">{isHi ? 'विषय चुनो' : 'Choose Subject'}</div>
          <div className="grid grid-cols-5 gap-2">
            {(Object.keys(SUBJECT_CONFIG) as Subject[]).map(subj => {
              const cfg = SUBJECT_CONFIG[subj];
              const isActive = student.subject === subj;
              return (
                <button key={subj} onClick={() => router.push(`/learn/${subj}`)} className="p-2 rounded-xl text-center transition-all" style={{background: isActive ? `${cfg.color}20` : 'rgba(255,255,255,0.03)', border: isActive ? `1px solid ${cfg.color}40` : '1px solid transparent'}}>
                  <span className="text-lg">{cfg.icon}</span>
                  <div className="text-[10px] mt-1 truncate" style={{color: isActive ? cfg.color : 'rgba(255,255,255,0.3)'}}>{isHi ? cfg.nameHi : cfg.nameEn}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
