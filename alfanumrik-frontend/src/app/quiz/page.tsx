'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import BottomNav from '@/components/BottomNav';
import { getQuizQuestions, submitQuiz, getSubjects, awardXP, updateStreak } from '@/lib/supabase';
import type { Subject } from '@/lib/types';

interface Question {
  id: string;
  question_text: string;
  question_text_vernacular?: string | null;
  options?: Array<{ id: string; text: string; text_vernacular?: string }> | null;
  correct_answer: string;
  explanation?: string | null;
  topic_id?: string | null;
  bloom_level?: string | null;
  difficulty?: number | null;
}

export default function QuizPage() {
  const { student, isLoggedIn, isLoading, isHi, refreshSnapshot } = useAuth();
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubject, setSelectedSubject] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [responses, setResponses] = useState<Array<{ questionId: string; conceptId: string; selectedAnswer: string; isCorrect: boolean; timeTakenSeconds: number }>>([]);
  const [streak, setStreak] = useState(0);
  const [xpEarned, setXpEarned] = useState(0);
  const [phase, setPhase] = useState<'setup' | 'loading' | 'playing' | 'complete'>('setup');
  const questionStart = useRef(Date.now());
  const quizStart = useRef(Date.now());

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
  }, [isLoading, isLoggedIn, router]);

  useEffect(() => {
    if (student) {
      setSelectedSubject(student.preferred_subject);
      getSubjects().then(s => setSubjects(s as Subject[]));
    }
  }, [student?.id]); // eslint-disable-line

  const startQuiz = useCallback(async () => {
    if (!student) return;
    setPhase('loading');
    const qs = await getQuizQuestions({ studentId: student.id, subject: selectedSubject, grade: student.grade, limit: 10 });
    if (qs.length === 0) { setPhase('setup'); return; }
    setQuestions(qs.sort(() => Math.random() - 0.5));
    setIdx(0); setSelected(null); setRevealed(false); setResponses([]); setStreak(0); setXpEarned(0);
    quizStart.current = Date.now();
    questionStart.current = Date.now();
    setPhase('playing');
  }, [student, selectedSubject]);

  const handleSelect = (optId: string) => {
    if (revealed) return;
    setSelected(optId);
  };

  const handleSubmit = () => {
    if (!selected || !questions[idx]) return;
    const q = questions[idx];
    const isCorrect = selected === q.correct_answer;
    const timeTaken = Math.round((Date.now() - questionStart.current) / 1000);
    setResponses(prev => [...prev, { questionId: q.id, conceptId: q.topic_id ?? q.id, selectedAnswer: selected, isCorrect, timeTakenSeconds: timeTaken }]);
    setStreak(isCorrect ? streak + 1 : 0);
    setRevealed(true);
  };

  const handleNext = async () => {
    if (idx + 1 >= questions.length) {
      setPhase('complete');
      if (!student) return;
      const durationSec = Math.round((Date.now() - quizStart.current) / 1000);
      const correct = [...responses, { questionId: questions[idx].id, conceptId: questions[idx].topic_id ?? '', selectedAnswer: selected ?? '', isCorrect: selected === questions[idx].correct_answer, timeTakenSeconds: Math.round((Date.now() - questionStart.current) / 1000) }].filter(r => r.isCorrect).length;
      const xp = correct * 10 + (correct === questions.length ? 30 : 0);
      setXpEarned(xp);
      await Promise.all([
        submitQuiz({ studentId: student.id, subject: selectedSubject, grade: student.grade, questions, responses, timeTakenSeconds: durationSec }),
        awardXP(student.id, selectedSubject, xp),
        updateStreak(student.id, selectedSubject),
      ]);
      await refreshSnapshot();
    } else {
      setIdx(idx + 1); setSelected(null); setRevealed(false);
      questionStart.current = Date.now();
    }
  };

  if (isLoading || !student) return <div className="mesh-bg min-h-dvh flex items-center justify-center"><div className="text-5xl animate-float">🦊</div></div>;

  const q = questions[idx];
  const currentSubject = subjects.find(s => s.code === selectedSubject);

  // ── SETUP ──
  if (phase === 'setup') return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="glass border-b border-[var(--border)]">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">←</button>
          <h1 className="font-bold text-lg" style={{ fontFamily: 'var(--font-display)' }}>
            ⚡ {isHi ? 'क्विज़ शुरू करो' : 'Start Quiz'}
          </h1>
        </div>
      </header>
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <div className="glass rounded-2xl p-5">
          <p className="text-sm text-[var(--text-3)] mb-3">{isHi ? 'विषय चुनो' : 'Choose subject'}</p>
          <div className="grid grid-cols-4 gap-2">
            {subjects.slice(0,8).map(s => (
              <button key={s.code} onClick={() => setSelectedSubject(s.code)}
                className="rounded-xl p-2 text-center transition-all"
                style={{ background: selectedSubject === s.code ? `${s.color}20` : 'var(--surface-2)',
                  border: selectedSubject === s.code ? `1.5px solid ${s.color}` : '1px solid var(--border)' }}>
                <div className="text-xl">{s.icon}</div>
                <div className="text-[9px] mt-0.5 font-semibold truncate" style={{ color: selectedSubject === s.code ? s.color : 'var(--text-3)' }}>
                  {s.name.split(' ')[0]}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="glass rounded-2xl p-5 space-y-3">
          <div className="flex gap-3">
            <span className="text-3xl">⚡</span>
            <div>
              <div className="font-bold">{isHi ? '10 सवाल' : '10 Questions'}</div>
              <div className="text-sm text-[var(--text-3)]">{isHi ? 'AI द्वारा चुने गए' : 'AI-selected for your level'}</div>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="text-3xl">🏆</span>
            <div>
              <div className="font-bold">{isHi ? 'XP कमाओ' : 'Earn XP'}</div>
              <div className="text-sm text-[var(--text-3)]">{isHi ? 'हर सही जवाब पर 10 XP + 30 परफेक्ट बोनस' : '10 XP per correct + 30 perfect bonus'}</div>
            </div>
          </div>
        </div>
        <button className="btn-primary w-full text-lg py-4" onClick={startQuiz}>
          {isHi ? 'क्विज़ शुरू करो ⚡' : 'Start Quiz ⚡'}
        </button>
      </div>
      <BottomNav />
    </div>
  );

  // ── LOADING ──
  if (phase === 'loading') return (
    <div className="mesh-bg min-h-dvh flex flex-col items-center justify-center gap-4">
      <div className="text-5xl animate-float">⚡</div>
      <p className="text-[var(--text-3)]">{isHi ? 'सवाल तैयार हो रहे हैं…' : 'Loading questions…'}</p>
    </div>
  );

  // ── COMPLETE ──
  if (phase === 'complete') {
    const correctCount = responses.filter(r => r.isCorrect).length;
    const pct = Math.round((correctCount / questions.length) * 100);
    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center p-4">
        <div className="glass rounded-3xl p-8 max-w-sm w-full text-center animate-slide-up">
          <div className="text-6xl mb-4">{pct >= 80 ? '🏆' : pct >= 50 ? '⭐' : '💪'}</div>
          <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            {pct >= 80 ? (isHi ? 'शानदार!' : 'Outstanding!') : pct >= 50 ? (isHi ? 'बहुत अच्छा!' : 'Well Done!') : (isHi ? 'अच्छा प्रयास!' : 'Good Effort!')}
          </h1>
          <div className="text-5xl font-bold my-4 gradient-text" style={{ fontFamily: 'var(--font-display)' }}>{pct}%</div>
          <p className="text-[var(--text-3)] mb-3">{correctCount}/{questions.length} {isHi ? 'सही' : 'correct'}</p>
          {xpEarned > 0 && (
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 font-bold"
              style={{ background: 'rgba(255,184,0,0.15)', color: 'var(--gold)' }}>
              🔥 +{xpEarned} XP {isHi ? 'मिले!' : 'earned!'}
            </div>
          )}
          <div className="flex gap-3">
            <button className="btn-ghost flex-1" onClick={() => router.push('/dashboard')}>{isHi ? 'डैशबोर्ड' : 'Dashboard'}</button>
            <button className="btn-primary flex-1" onClick={() => { setPhase('setup'); setQuestions([]); }}>
              {isHi ? 'फिर से' : 'Play Again'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── PLAYING ──
  if (!q) return null;
  const options = (q.options as Array<{ id: string; text: string; text_vernacular?: string }>) ?? [];

  return (
    <div className="mesh-bg min-h-dvh pb-nav flex flex-col">
      {/* Header */}
      <header className="glass border-b border-[var(--border)] sticky top-0 z-40">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={() => setPhase('setup')} className="text-[var(--text-3)] hover:text-[var(--text-1)]">✕</button>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold">{idx + 1}<span className="text-[var(--text-3)]">/{questions.length}</span></span>
            {streak >= 3 && <span className="text-orange-400 font-bold streak-flame">🔥{streak}</span>}
          </div>
          <div className="text-xs px-2 py-1 rounded-full" style={{ background: `${currentSubject?.color ?? 'var(--orange)'}20`, color: currentSubject?.color ?? 'var(--orange)' }}>
            {q.bloom_level ?? 'apply'}
          </div>
        </div>
        {/* Progress bar */}
        <div className="h-1 w-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <div className="h-full transition-all duration-500" style={{ width: `${((idx) / questions.length) * 100}%`, background: currentSubject?.color ?? 'var(--orange)' }} />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto max-w-lg mx-auto w-full px-4 py-5 flex flex-col gap-4">
        {/* Question */}
        <div className="glass rounded-2xl p-5">
          <p className="text-base font-semibold leading-relaxed">
            {(isHi && q.question_text_vernacular) ? q.question_text_vernacular : q.question_text}
          </p>
          {q.difficulty !== null && q.difficulty !== undefined && (
            <div className="flex gap-1 mt-3">
              {[1,2,3,4,5].map(d => (
                <div key={d} className="w-4 h-1 rounded-full" style={{ background: d <= Math.round((q.difficulty ?? 0) * 5) ? (currentSubject?.color ?? 'var(--orange)') : 'rgba(255,255,255,0.1)' }} />
              ))}
              <span className="text-[10px] text-[var(--text-3)] ml-1">{isHi ? 'कठिनाई' : 'Difficulty'}</span>
            </div>
          )}
        </div>

        {/* Options */}
        <div className="space-y-2">
          {options.map(opt => {
            const isSelected = selected === opt.id;
            const isCorrect = opt.id === q.correct_answer;
            let style: React.CSSProperties = { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' };
            if (revealed) {
              if (isCorrect) style = { background: 'rgba(45,198,83,0.15)', border: '1.5px solid var(--green)', color: 'var(--green)' };
              else if (isSelected && !isCorrect) style = { background: 'rgba(255,71,87,0.15)', border: '1.5px solid var(--red)', color: 'var(--red)' };
            } else if (isSelected) {
              style = { background: `${currentSubject?.color ?? 'var(--orange)'}15`, border: `1.5px solid ${currentSubject?.color ?? 'var(--orange)'}`, color: 'var(--text-1)' };
            }
            return (
              <button key={opt.id} onClick={() => handleSelect(opt.id)} disabled={revealed}
                className={`w-full rounded-xl p-4 text-left flex items-center gap-3 transition-all ${revealed && isCorrect ? 'quiz-correct' : ''} ${revealed && isSelected && !isCorrect ? 'quiz-wrong' : ''}`}
                style={style}>
                <span className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ background: 'rgba(255,255,255,0.07)' }}>
                  {opt.id.toUpperCase()}
                </span>
                <span className="flex-1 text-sm">{(isHi && opt.text_vernacular) ? opt.text_vernacular : opt.text}</span>
                {revealed && isCorrect && <span className="text-[var(--green)]">✓</span>}
                {revealed && isSelected && !isCorrect && <span className="text-[var(--red)]">✗</span>}
              </button>
            );
          })}
        </div>

        {/* Explanation */}
        {revealed && q.explanation && (
          <div className="glass rounded-xl p-4 animate-fade-in" style={{ borderColor: 'rgba(255,184,0,0.2)' }}>
            <p className="text-xs font-bold text-[var(--gold)] mb-1">{isHi ? '💡 समझाओ' : '💡 Explanation'}</p>
            <p className="text-sm text-[var(--text-2)]">{q.explanation}</p>
          </div>
        )}
      </div>

      {/* Action button */}
      <div className="glass border-t border-[var(--border)] px-4 py-3 sticky bottom-[4.5rem] max-w-lg mx-auto w-full">
        {!revealed ? (
          <button className="btn-primary w-full" onClick={handleSubmit} disabled={!selected}>
            {isHi ? 'जवाब दो' : 'Submit Answer'}
          </button>
        ) : (
          <button className="btn-primary w-full" onClick={handleNext}>
            {idx + 1 >= questions.length ? (isHi ? 'नतीजे देखो 🏆' : 'See Results 🏆') : (isHi ? 'अगला →' : 'Next →')}
          </button>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
