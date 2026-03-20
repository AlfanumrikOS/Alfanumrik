'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getQuizQuestions, submitQuizResults, supabase } from '@/lib/supabase';
import { Card, Button, ProgressBar, StatCard, LoadingFoxy, BottomNav } from '@/components/ui';
import { SUBJECT_META } from '@/lib/constants';

type Screen = 'select' | 'quiz' | 'feedback' | 'results';

interface Question {
  id: string;
  question_text: string;
  question_hi: string | null;
  question_type: string;
  options: string | string[];
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  hint: string | null;
  difficulty: number;
  bloom_level: string;
  chapter_number: number;
}

interface Response {
  question_id: string;
  selected_option: number;
  is_correct: boolean;
  time_spent: number;
}

const DIFF_LABELS = [
  { id: null, label: 'All Levels', labelHi: 'सभी स्तर', icon: '🎯' },
  { id: 1, label: 'Easy', labelHi: 'आसान', icon: '🟢' },
  { id: 2, label: 'Medium', labelHi: 'मध्यम', icon: '🟡' },
  { id: 3, label: 'Hard', labelHi: 'कठिन', icon: '🔴' },
];

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];
const OPTION_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6'];

export default function QuizPage() {
  const { student, isLoggedIn, isLoading, isHi, refreshSnapshot } = useAuth();
  const router = useRouter();

  // Setup state
  const [screen, setScreen] = useState<Screen>('select');
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<number | null>(null);
  const [questionCount, setQuestionCount] = useState(10);

  // Quiz state
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [responses, setResponses] = useState<Response[]>([]);
  const [showExplanation, setShowExplanation] = useState(false);
  const [timer, setTimer] = useState(0);
  const [questionTimer, setQuestionTimer] = useState(0);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Results state
  const [results, setResults] = useState<{
    total: number; correct: number; score_percent: number; xp_earned: number; session_id: string;
  } | null>(null);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
  }, [isLoading, isLoggedIn, router]);

  // Check URL params for pre-selected subject
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const subj = params.get('subject');
    if (subj && SUBJECT_META.find(s => s.code === subj)) {
      setSelectedSubject(subj);
    }
  }, []);

  // Global timer
  useEffect(() => {
    if (screen === 'quiz') {
      timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [screen]);

  // Per-question timer
  useEffect(() => {
    if (screen === 'quiz' && !showExplanation) {
      setQuestionTimer(0);
      qTimerRef.current = setInterval(() => setQuestionTimer(t => t + 1), 1000);
      return () => { if (qTimerRef.current) clearInterval(qTimerRef.current); };
    }
    return () => { if (qTimerRef.current) clearInterval(qTimerRef.current); };
  }, [screen, currentIdx, showExplanation]);

  const startQuiz = useCallback(async () => {
    if (!selectedSubject || !student) return;
    setLoading(true);
    try {
      const data = await getQuizQuestions(
        selectedSubject,
        student.grade,
        questionCount
      );
      const qs = Array.isArray(data) ? data : [];
      if (qs.length === 0) {
        alert(isHi ? 'इस विषय में अभी प्रश्न नहीं हैं।' : 'No questions available for this subject yet.');
        setLoading(false);
        return;
      }
      setQuestions(qs);
      setCurrentIdx(0);
      setResponses([]);
      setSelectedOption(null);
      setShowExplanation(false);
      setTimer(0);
      setScreen('quiz');
    } catch (e) {
      console.error('Quiz load error:', e);
    }
    setLoading(false);
  }, [selectedSubject, student, questionCount, isHi]);

  const parseOptions = (opts: string | string[]): string[] => {
    if (Array.isArray(opts)) return opts;
    try { return JSON.parse(opts); } catch { return []; }
  };

  const selectAnswer = (optIdx: number) => {
    if (showExplanation) return;
    setSelectedOption(optIdx);
  };

  const confirmAnswer = () => {
    if (selectedOption === null) return;
    const q = questions[currentIdx];
    const isCorrect = selectedOption === q.correct_answer_index;
    setResponses(prev => [...prev, {
      question_id: q.id,
      selected_option: selectedOption,
      is_correct: isCorrect,
      time_spent: questionTimer,
    }]);
    setShowExplanation(true);
    if (qTimerRef.current) clearInterval(qTimerRef.current);
  };

  const nextQuestion = async () => {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(i => i + 1);
      setSelectedOption(null);
      setShowExplanation(false);
    } else {
      // Quiz complete — submit results
      if (timerRef.current) clearInterval(timerRef.current);
      setScreen('feedback');
      setLoading(true);
      try {
        const allResponses = [...responses];
        // Add the last response if not already added
        if (allResponses.length < questions.length) {
          const q = questions[currentIdx];
          allResponses.push({
            question_id: q.id,
            selected_option: selectedOption!,
            is_correct: selectedOption === q.correct_answer_index,
            time_spent: questionTimer,
          });
        }

        const subMeta = SUBJECT_META.find(s => s.code === selectedSubject);
        const res = await submitQuizResults(
          student!.id,
          selectedSubject!,
          student!.grade,
          subMeta?.name || selectedSubject!,
          questions[0]?.chapter_number || 1,
          allResponses,
          timer
        );
        setResults(res);
        refreshSnapshot();
      } catch (e) {
        console.error('Submit error:', e);
        const total = responses.length;
        const correct = responses.filter(r => r.is_correct).length;
        setResults({ total, correct, score_percent: total > 0 ? Math.round((correct / total) * 100) : 0, xp_earned: correct * 10, session_id: '' });
      }
      setLoading(false);
      setScreen('results');
    }
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  if (isLoading || !student) return <LoadingFoxy />;

  const subMeta = SUBJECT_META.find(s => s.code === selectedSubject);
  const q = questions[currentIdx];
  const opts = q ? parseOptions(q.options) : [];
  const progress = questions.length > 0 ? ((currentIdx + (showExplanation ? 1 : 0)) / questions.length) * 100 : 0;
  const correctSoFar = responses.filter(r => r.is_correct).length;

  // ═══ SUBJECT SELECTION SCREEN ═══
  if (screen === 'select') {
    return (
      <div className="mesh-bg min-h-dvh pb-nav">
        <header className="page-header">
          <div className="page-header-inner flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">&larr;</button>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'क्विज़ शुरू करो' : 'Start a Quiz'}
            </h1>
          </div>
        </header>
        <main className="app-container py-6 space-y-5">
          {/* Subject Grid */}
          <div>
            <p className="text-sm text-[var(--text-3)] mb-3 font-medium">
              {isHi ? '1. विषय चुनो' : '1. Choose your subject'}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {SUBJECT_META.slice(0, 9).map(s => (
                <button
                  key={s.code}
                  onClick={() => setSelectedSubject(s.code)}
                  className="rounded-2xl p-4 text-center transition-all active:scale-95"
                  style={{
                    background: selectedSubject === s.code ? `${s.color}12` : 'var(--surface-1)',
                    border: selectedSubject === s.code ? `2px solid ${s.color}` : '1.5px solid var(--border)',
                    boxShadow: selectedSubject === s.code ? `0 4px 16px ${s.color}20` : '0 2px 8px rgba(0,0,0,0.03)',
                  }}
                >
                  <div className="text-3xl mb-2">{s.icon}</div>
                  <div className="text-sm font-semibold" style={{ color: selectedSubject === s.code ? s.color : 'var(--text-2)' }}>
                    {s.name}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Difficulty Selection */}
          {selectedSubject && (
            <div>
              <p className="text-sm text-[var(--text-3)] mb-3 font-medium">
                {isHi ? '2. कठिनाई स्तर' : '2. Difficulty level'}
              </p>
              <div className="flex gap-2 flex-wrap">
                {DIFF_LABELS.map(d => (
                  <button
                    key={String(d.id)}
                    onClick={() => setSelectedDifficulty(d.id)}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold transition-all"
                    style={{
                      background: selectedDifficulty === d.id ? 'var(--orange)' : 'var(--surface-2)',
                      color: selectedDifficulty === d.id ? '#fff' : 'var(--text-2)',
                      border: selectedDifficulty === d.id ? '1.5px solid var(--orange)' : '1.5px solid transparent',
                    }}
                  >
                    {d.icon} {isHi ? d.labelHi : d.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Question Count */}
          {selectedSubject && (
            <div>
              <p className="text-sm text-[var(--text-3)] mb-3 font-medium">
                {isHi ? '3. कितने सवाल?' : '3. Number of questions'}
              </p>
              <div className="flex gap-2">
                {[5, 10, 15, 20].map(n => (
                  <button
                    key={n}
                    onClick={() => setQuestionCount(n)}
                    className="rounded-xl px-5 py-2.5 text-sm font-bold transition-all"
                    style={{
                      background: questionCount === n ? 'var(--orange)' : 'var(--surface-2)',
                      color: questionCount === n ? '#fff' : 'var(--text-2)',
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Start Button */}
          {selectedSubject && (
            <Button fullWidth onClick={startQuiz} color={subMeta?.color}>
              {loading ? (isHi ? 'लोड हो रहा...' : 'Loading...') : (
                <>
                  {subMeta?.icon} {isHi ? `${questionCount} सवालों की क्विज़ शुरू करो` : `Start ${questionCount}-Question Quiz`}
                </>
              )}
            </Button>
          )}

          {/* Quick stats */}
          <Card className="!p-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">💡</span>
              <div className="text-xs text-[var(--text-3)] leading-relaxed">
                {isHi
                  ? 'हर सही जवाब पर 10 XP मिलता है। 80%+ स्कोर पर बोनस 20 XP!'
                  : 'Earn 10 XP per correct answer. Score 80%+ for a bonus 20 XP!'}
              </div>
            </div>
          </Card>
        </main>
        <BottomNav />
      </div>
    );
  }

  // ═══ QUIZ SCREEN ═══
  if (screen === 'quiz' && q) {
    const isAnswered = showExplanation;
    const isCorrect = selectedOption === q.correct_answer_index;

    return (
      <div className="mesh-bg min-h-dvh pb-nav flex flex-col">
        {/* Header */}
        <header className="page-header" style={{ background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}>
          <div className="app-container py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{subMeta?.icon}</span>
                <span className="text-sm font-semibold" style={{ color: subMeta?.color }}>{subMeta?.name}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-[var(--text-3)] font-medium">
                <span>{correctSoFar}/{responses.length} ✓</span>
                <span style={{ color: 'var(--orange)', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>
                  {formatTime(timer)}
                </span>
              </div>
            </div>
            <ProgressBar value={progress} color={subMeta?.color} height={5} />
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-[var(--text-3)]">
                {isHi ? `सवाल ${currentIdx + 1}/${questions.length}` : `Question ${currentIdx + 1} of ${questions.length}`}
              </span>
              <span className="text-[10px] text-[var(--text-3)]">
                {isHi ? `कठिनाई: ${q.difficulty}/5` : `Difficulty: ${q.difficulty}/5`}
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-5 flex flex-col gap-4">
          {/* Question */}
          <Card className="!p-5">
            <div className="text-[10px] font-semibold text-[var(--text-3)] mb-2 uppercase tracking-wider">
              {isHi ? `अध्याय ${q.chapter_number} · ${q.bloom_level}` : `Chapter ${q.chapter_number} · ${q.bloom_level}`}
            </div>
            <div className="text-base md:text-lg font-semibold leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>
              {isHi && q.question_hi ? q.question_hi : q.question_text}
            </div>
          </Card>

          {/* Options */}
          <div className="space-y-2.5">
            {opts.map((opt, idx) => {
              const letter = OPTION_LETTERS[idx] || String(idx + 1);
              const optText = opt.replace(/^[A-D][\.\)]\s*/, '');
              const isSelected = selectedOption === idx;
              const isCorrectOpt = idx === q.correct_answer_index;

              let bg = 'var(--surface-1)';
              let border = 'var(--border)';
              let textColor = 'var(--text-1)';
              let letterBg = 'var(--surface-2)';
              let letterColor = 'var(--text-2)';

              if (isAnswered) {
                if (isCorrectOpt) {
                  bg = 'rgba(22,163,74,0.08)';
                  border = 'rgba(22,163,74,0.4)';
                  textColor = '#16A34A';
                  letterBg = '#16A34A';
                  letterColor = '#fff';
                } else if (isSelected && !isCorrectOpt) {
                  bg = 'rgba(220,38,38,0.06)';
                  border = 'rgba(220,38,38,0.3)';
                  textColor = '#DC2626';
                  letterBg = '#DC2626';
                  letterColor = '#fff';
                }
              } else if (isSelected) {
                bg = `${subMeta?.color || 'var(--orange)'}08`;
                border = subMeta?.color || 'var(--orange)';
                letterBg = subMeta?.color || 'var(--orange)';
                letterColor = '#fff';
              }

              return (
                <button
                  key={idx}
                  onClick={() => selectAnswer(idx)}
                  className="w-full rounded-2xl p-4 flex items-center gap-4 transition-all active:scale-[0.98]"
                  style={{ background: bg, border: `1.5px solid ${border}`, textAlign: 'left' }}
                  disabled={isAnswered}
                >
                  <span
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 transition-all"
                    style={{ background: letterBg, color: letterColor }}
                  >
                    {letter}
                  </span>
                  <span className="text-sm md:text-base font-medium leading-snug" style={{ color: textColor }}>
                    {optText}
                  </span>
                  {isAnswered && isCorrectOpt && <span className="ml-auto text-xl flex-shrink-0">✓</span>}
                  {isAnswered && isSelected && !isCorrectOpt && <span className="ml-auto text-xl flex-shrink-0">✗</span>}
                </button>
              );
            })}
          </div>

          {/* Explanation */}
          {isAnswered && (
            <div
              className="rounded-2xl p-4 border"
              style={{
                background: isCorrect ? 'rgba(22,163,74,0.05)' : 'rgba(220,38,38,0.04)',
                borderColor: isCorrect ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.12)',
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{isCorrect ? '🎉' : '💡'}</span>
                <span className="text-sm font-bold" style={{ color: isCorrect ? '#16A34A' : '#DC2626' }}>
                  {isCorrect
                    ? (isHi ? 'शाबाश! सही जवाब!' : 'Correct! Well done!')
                    : (isHi ? 'गलत जवाब' : 'Incorrect')}
                </span>
                {isCorrect && <span className="ml-auto text-xs font-bold" style={{ color: 'var(--orange)' }}>+10 XP</span>}
              </div>
              <p className="text-sm leading-relaxed text-[var(--text-2)]">
                {isHi && q.explanation_hi ? q.explanation_hi : q.explanation || (isHi ? 'कोई व्याख्या उपलब्ध नहीं' : 'No explanation available')}
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 mt-auto pb-2">
            {!isAnswered ? (
              <>
                {q.hint && selectedOption === null && (
                  <Button variant="ghost" onClick={() => alert(q.hint)} size="sm">
                    💡 {isHi ? 'संकेत' : 'Hint'}
                  </Button>
                )}
                <Button
                  fullWidth
                  onClick={confirmAnswer}
                  color={subMeta?.color}
                  size="md"
                >
                  {selectedOption !== null
                    ? (isHi ? 'जवाब जमा करो' : 'Submit Answer')
                    : (isHi ? 'एक विकल्प चुनो' : 'Select an option')}
                </Button>
              </>
            ) : (
              <Button fullWidth onClick={nextQuestion} color={subMeta?.color}>
                {currentIdx < questions.length - 1
                  ? (isHi ? 'अगला सवाल →' : 'Next Question →')
                  : (isHi ? 'नतीजे देखो 🎯' : 'See Results 🎯')}
              </Button>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ═══ RESULTS SCREEN ═══
  if (screen === 'results' && results) {
    const pct = results.score_percent;
    const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 40 ? 'D' : 'F';
    const emoji = pct >= 80 ? '🏆' : pct >= 60 ? '👍' : pct >= 40 ? '💪' : '📚';
    const message = pct >= 80
      ? (isHi ? 'शानदार! तुम तो CBSE topper हो!' : 'Outstanding! You nailed it!')
      : pct >= 60
        ? (isHi ? 'बहुत अच्छा! थोड़ा और अभ्यास करो!' : 'Good job! A little more practice!')
        : pct >= 40
          ? (isHi ? 'ठीक है! रिव्यू करके फिर try करो!' : 'Keep going! Review and try again!')
          : (isHi ? 'कोई बात नहीं! Foxy से सीखो!' : 'No worries! Learn with Foxy first!');

    return (
      <div className="mesh-bg min-h-dvh pb-nav">
        <header className="page-header">
          <div className="page-header-inner flex items-center gap-3">
            <button onClick={() => { setScreen('select'); setQuestions([]); }} className="text-[var(--text-3)]">&larr;</button>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'क्विज़ नतीजे' : 'Quiz Results'}
            </h1>
          </div>
        </header>
        <main className="app-container py-6 space-y-5 max-w-lg mx-auto">
          {/* Score Card */}
          <Card accent={pct >= 60 ? '#16A34A' : '#DC2626'}>
            <div className="text-center py-4">
              <div className="text-5xl mb-3">{emoji}</div>
              <div className="text-6xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)', color: pct >= 60 ? '#16A34A' : '#DC2626' }}>
                {pct}%
              </div>
              <div className="text-xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                Grade: {grade}
              </div>
              <p className="text-sm text-[var(--text-3)]">{message}</p>
            </div>
          </Card>

          {/* Stats Grid */}
          <div className="grid-stats">
            <StatCard icon="✓" value={results.correct} label={isHi ? 'सही' : 'Correct'} color="#16A34A" />
            <StatCard icon="✗" value={results.total - results.correct} label={isHi ? 'गलत' : 'Wrong'} color="#DC2626" />
            <StatCard icon="⭐" value={`+${results.xp_earned}`} label="XP" color="var(--orange)" />
            <StatCard icon="⏱" value={formatTime(timer)} label={isHi ? 'समय' : 'Time'} color="var(--teal)" />
          </div>

          {/* Question Review */}
          <div>
            <p className="text-sm font-semibold text-[var(--text-2)] mb-3">
              {isHi ? 'सवालों की समीक्षा' : 'Question Review'}
            </p>
            <div className="space-y-2">
              {questions.map((question, idx) => {
                const resp = responses[idx];
                const correct = resp?.is_correct;
                return (
                  <div
                    key={question.id}
                    className="rounded-xl p-3 flex items-center gap-3"
                    style={{
                      background: correct ? 'rgba(22,163,74,0.06)' : 'rgba(220,38,38,0.04)',
                      border: `1px solid ${correct ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.12)'}`,
                    }}
                  >
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{
                        background: correct ? '#16A34A' : '#DC2626',
                        color: '#fff',
                      }}
                    >
                      {correct ? '✓' : '✗'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate" style={{ color: 'var(--text-2)' }}>
                        {question.question_text.substring(0, 80)}{question.question_text.length > 80 ? '...' : ''}
                      </div>
                      {!correct && (
                        <div className="text-[10px] text-[var(--text-3)] mt-0.5">
                          {isHi ? 'सही:' : 'Correct:'} {OPTION_LETTERS[question.correct_answer_index]}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-[var(--text-3)] flex-shrink-0">
                      {resp?.time_spent || 0}s
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2">
            <Button fullWidth onClick={() => { setScreen('select'); setQuestions([]); setResponses([]); setResults(null); }}>
              {isHi ? 'एक और क्विज़ खेलो' : 'Take Another Quiz'} ⚡
            </Button>
            {pct < 60 && (
              <Button fullWidth variant="ghost" onClick={() => router.push('/foxy')}>
                🦊 {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
              </Button>
            )}
            <Button fullWidth variant="ghost" onClick={() => router.push('/dashboard')}>
              {isHi ? 'होम' : 'Home'}
            </Button>
          </div>
        </main>
        <BottomNav />
      </div>
    );
  }

  // Fallback loading
  return <LoadingFoxy />;
}
