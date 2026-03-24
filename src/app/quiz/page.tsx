'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { track } from '@/lib/analytics';
import { shareResult, quizShareMessage } from '@/lib/share';
import { getQuizQuestions, submitQuizResults, saveCognitiveMetrics, saveQuestionResponses, supabase } from '@/lib/supabase';
import { Card, Button, ProgressBar, StatCard, LoadingFoxy, BottomNav } from '@/components/ui';
import { SUBJECT_META } from '@/lib/constants';
import {
  BLOOM_CONFIG, BLOOM_LEVELS,
  initialCognitiveLoad, updateCognitiveLoad, getReflectionPrompt, classifyError,
  type BloomLevel, type CognitiveLoadState, type ReflectionPrompt, type ErrorType,
} from '@/lib/cognitive-engine';

type QuizMode = 'practice' | 'cognitive';
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
  error_type?: ErrorType;
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
  const { student, isLoggedIn, isLoading, isHi, refreshSnapshot, activeRole } = useAuth();
  const router = useRouter();

  // Setup state
  const [screen, setScreen] = useState<Screen>('select');
  const [quizMode, setQuizMode] = useState<QuizMode>('cognitive');
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<number | null>(null);
  const [questionCount, setQuestionCount] = useState(10);

  // Cognitive 2.0 state
  const [cogLoad, setCogLoad] = useState<CognitiveLoadState>(initialCognitiveLoad());
  const [reflection, setReflection] = useState<ReflectionPrompt | null>(null);

  // Quiz state
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [responses, setResponses] = useState<Response[]>([]);
  const [showExplanation, setShowExplanation] = useState(false);
  const [hintLevel, setHintLevel] = useState(0);
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
    if (!isLoading && isLoggedIn && !student && activeRole !== 'student') {
      router.replace(activeRole === 'teacher' ? '/teacher' : activeRole === 'guardian' ? '/parent' : '/');
    }
  }, [isLoading, isLoggedIn, student, activeRole, router]);

  // Check URL params for pre-selected subject
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const subj = params.get('subject');
    if (subj && SUBJECT_META.find(s => s.code === subj)) {
      setSelectedSubject(subj);
    }
    const mode = params.get('mode');
    if (mode === 'cognitive') setQuizMode('cognitive');
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
        questionCount,
        selectedDifficulty
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
      setCogLoad(initialCognitiveLoad());
      setReflection(null);
      setScreen('quiz');
    } catch (e) {
      console.error('Quiz load error:', e);
      alert(isHi ? 'क्विज़ लोड करने में समस्या हुई। कृपया फिर से कोशिश करें।' : 'Failed to load quiz. Please try again.');
    }
    setLoading(false);
  }, [selectedSubject, student, questionCount, selectedDifficulty, isHi]);

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

    // Classify error type for cognitive analysis
    const avgTime = responses.length > 0
      ? responses.reduce((a, r) => a + r.time_spent, 0) / responses.length
      : questionTimer;
    const errorType = classifyError(isCorrect, questionTimer, avgTime, q.difficulty, 0.5);

    setResponses(prev => [...prev, {
      question_id: q.id,
      selected_option: selectedOption,
      is_correct: isCorrect,
      time_spent: questionTimer,
      error_type: errorType,
    }]);
    setShowExplanation(true);
    if (qTimerRef.current) clearInterval(qTimerRef.current);

    // Cognitive 2.0: update cognitive load
    if (quizMode === 'cognitive') {
      const newCogLoad = updateCognitiveLoad(cogLoad, isCorrect, questionTimer);
      setCogLoad(newCogLoad);
      const bloom = (q.bloom_level || 'remember') as BloomLevel;
      const prompt = getReflectionPrompt(isCorrect, newCogLoad.consecutiveErrors, newCogLoad.consecutiveCorrect, bloom);
      setReflection(prompt);
    }
  };

  const nextQuestion = async () => {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(i => i + 1);
      setSelectedOption(null);
      setShowExplanation(false);
      setReflection(null);
      setHintLevel(0);
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

        // ── ANTI-CHEAT: Client-side validation before submission ──
        // 1. Minimum time: 3 seconds per question (bots submit instantly)
        const minTime = allResponses.length * 3;
        if (timer < minTime) {
          console.warn(`[AntiCheat] Quiz completed too fast: ${timer}s for ${allResponses.length} questions (min: ${minTime}s)`);
          // Still submit, but the DB trigger will flag it as suspicious
        }

        // 2. Detect impossible response patterns
        // If ALL answers are option 0 (or any single option), flag it
        const optionCounts = [0, 0, 0, 0];
        allResponses.forEach(r => { if (r.selected_option >= 0 && r.selected_option < 4) optionCounts[r.selected_option]++; });
        const maxSameOption = Math.max(...optionCounts);
        if (allResponses.length >= 5 && maxSameOption === allResponses.length) {
          console.warn(`[AntiCheat] All answers were option ${optionCounts.indexOf(maxSameOption)} — pattern gaming`);
        }

        // 3. Verify response count matches question count
        if (allResponses.length !== questions.length) {
          console.warn(`[AntiCheat] Response count (${allResponses.length}) != question count (${questions.length})`);
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

        // Save cognitive metrics for this session (fire-and-forget)
        if (quizMode === 'cognitive' && res?.session_id) {
          const inZpd = allResponses.filter((_, i) => questions[i]?.difficulty === 2).length;
          const tooEasy = allResponses.filter((_, i) => questions[i]?.difficulty === 1).length;
          const tooHard = allResponses.filter((_, i) => questions[i]?.difficulty === 3).length;
          saveCognitiveMetrics({
            student_id: student!.id,
            quiz_session_id: res.session_id,
            questions_in_zpd: inZpd,
            questions_too_easy: tooEasy,
            questions_too_hard: tooHard,
            zpd_accuracy_rate: inZpd > 0 ? allResponses.filter((r, i) => r.is_correct && questions[i]?.difficulty === 2).length / inZpd : undefined,
            fatigue_detected: cogLoad.fatigueScore > 0.6,
            difficulty_adjustments: cogLoad.shouldEaseOff || cogLoad.shouldPushHarder ? 1 : 0,
            avg_response_time_seconds: allResponses.length > 0
              ? allResponses.reduce((a, r) => a + r.time_spent, 0) / allResponses.length
              : undefined,
          }).catch(() => {});

          // Save per-question responses
          saveQuestionResponses(allResponses.map((r, i) => ({
            student_id: student!.id,
            question_id: r.question_id,
            quiz_session_id: res.session_id,
            selected_answer: String(r.selected_option),
            is_correct: r.is_correct,
            response_time_seconds: r.time_spent,
            bloom_level_attempted: questions[i]?.bloom_level || 'remember',
            was_in_zpd: questions[i]?.difficulty === 2,
            quality: r.is_correct ? (r.time_spent < 10 ? 5 : 4) : (r.time_spent < 5 ? 1 : 2),
          }))).catch(() => {});
        }

        track('quiz_completed', {
          subject: selectedSubject!,
          score: res?.score_percent ?? 0,
          questions: allResponses.length,
          grade: student!.grade,
          time_seconds: timer,
        });
      } catch (e) {
        console.error('Submit error:', e);
        const total = responses.length;
        const correct = responses.filter(r => r.is_correct).length;
        // SECURITY: When API fails, show score for display only but DO NOT award XP.
        // XP must only be granted by the server after answer validation.
        // Showing xp_earned: 0 with a note that XP will sync when online.
        setResults({
          total,
          correct,
          score_percent: total > 0 ? Math.round((correct / total) * 100) : 0,
          xp_earned: 0, // XP is ONLY awarded server-side
          session_id: '',
        });
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
          {/* Quiz Mode */}
          <div>
            <p className="text-sm text-[var(--text-3)] mb-3 font-medium">
              {isHi ? 'मोड चुनो' : 'Choose Mode'}
            </p>
            <div className="flex gap-3">
              {([
                { id: 'practice' as QuizMode, icon: '✏️', label: 'Practice', labelHi: 'अभ्यास', desc: 'Choose your own difficulty', descHi: 'अपनी कठिनाई चुनो', color: '#F5A623' },
                { id: 'cognitive' as QuizMode, icon: '🧠', label: 'Smart', labelHi: 'स्मार्ट', desc: 'AI picks the right level', descHi: 'AI सही स्तर चुनता है', color: '#7C3AED' },
              ]).map(m => (
                <button
                  key={m.id}
                  onClick={() => setQuizMode(m.id)}
                  className="flex-1 rounded-2xl p-4 text-left transition-all active:scale-95"
                  style={{
                    background: quizMode === m.id ? `${m.color}12` : 'var(--surface-1)',
                    border: quizMode === m.id ? `2px solid ${m.color}` : '1.5px solid var(--border)',
                    boxShadow: quizMode === m.id ? `0 4px 16px ${m.color}20` : 'none',
                  }}
                >
                  <div className="text-2xl mb-1">{m.icon}</div>
                  <div className="text-sm font-bold" style={{ color: quizMode === m.id ? m.color : 'var(--text-2)' }}>
                    {isHi ? m.labelHi : m.label}
                  </div>
                  <div className="text-[10px] text-[var(--text-3)] mt-0.5">{isHi ? m.descHi : m.desc}</div>
                </button>
              ))}
            </div>
          </div>

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

          {/* Difficulty Selection (hidden in cognitive mode — ZPD auto-selects) */}
          {selectedSubject && quizMode === 'practice' && (
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
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-wider">
                {isHi ? `अध्याय ${q.chapter_number}` : `Chapter ${q.chapter_number}`}
              </span>
              {(() => {
                const bl = (q.bloom_level || 'remember') as BloomLevel;
                const bc = BLOOM_CONFIG[bl] || BLOOM_CONFIG.remember;
                return (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${bc.color}18`, color: bc.color }}>
                    {bc.icon} {isHi ? bc.labelHi : bc.label}
                  </span>
                );
              })()}
              {quizMode === 'cognitive' && cogLoad.fatigueScore > 0.4 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.1)', color: '#EF4444' }}>
                  {isHi ? 'थकान' : 'Fatigue'} {Math.round(cogLoad.fatigueScore * 100)}%
                </span>
              )}
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
                  className={`w-full rounded-2xl py-4 px-4 flex items-center gap-4 transition-all active:scale-[0.97] ${isAnswered && isCorrectOpt ? 'quiz-correct' : ''} ${isAnswered && isSelected && !isCorrectOpt ? 'quiz-wrong' : ''}`}
                  style={{
                    background: bg,
                    border: `1.5px solid ${border}`,
                    textAlign: 'left',
                    minHeight: 56, /* Fat-finger friendly on budget phones */
                    boxShadow: isSelected && !isAnswered ? `0 0 0 2px ${subMeta?.color || 'var(--orange)'}30` : 'none',
                  }}
                  disabled={isAnswered}
                >
                  <span
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 transition-all"
                    style={{ background: letterBg, color: letterColor }}
                  >
                    {letter}
                  </span>
                  <span className="text-sm md:text-base font-medium leading-snug flex-1" style={{ color: textColor }}>
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

          {/* Cognitive Reflection Prompt */}
          {isAnswered && quizMode === 'cognitive' && reflection && (
            <div className="rounded-2xl p-4 border" style={{ background: 'rgba(124,58,237,0.05)', borderColor: 'rgba(124,58,237,0.15)' }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">🪞</span>
                <span className="text-xs font-bold" style={{ color: '#7C3AED' }}>
                  {reflection.type === 'pause' ? (isHi ? 'रुको और सोचो' : 'Pause & Reflect') : (isHi ? 'सोचो' : 'Reflect')}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-[var(--text-2)]">
                {isHi ? reflection.messageHi : reflection.message}
              </p>
            </div>
          )}

          {/* Cognitive Pause Alert */}
          {isAnswered && quizMode === 'cognitive' && cogLoad.shouldPause && (
            <div className="rounded-2xl p-4 border" style={{ background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.2)' }}>
              <div className="flex items-center gap-2">
                <span className="text-xl">😮‍💨</span>
                <div>
                  <p className="text-sm font-bold" style={{ color: '#EF4444' }}>
                    {isHi ? 'ब्रेक ले लो!' : 'Take a break!'}
                  </p>
                  <p className="text-xs text-[var(--text-3)]">
                    {isHi ? 'थोड़ा आराम करो, फिर वापस आओ।' : 'Rest a bit, then come back stronger.'}
                  </p>
                </div>
              </div>
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

          {/* Bloom Analysis */}
          {quizMode === 'cognitive' && (
            <div>
              <p className="text-sm font-semibold text-[var(--text-2)] mb-3">
                {isHi ? 'ब्लूम विश्लेषण' : 'Bloom Analysis'}
              </p>
              <Card className="!p-4">
                <div className="space-y-2">
                  {BLOOM_LEVELS.map(bl => {
                    const bc = BLOOM_CONFIG[bl];
                    const qsAtLevel = questions.filter(qq => (qq.bloom_level || 'remember') === bl);
                    const correctAtLevel = qsAtLevel.filter((qq, i) => {
                      const qIdx = questions.indexOf(qq);
                      return responses[qIdx]?.is_correct;
                    }).length;
                    if (qsAtLevel.length === 0) return null;
                    const pctCorrect = Math.round((correctAtLevel / qsAtLevel.length) * 100);
                    return (
                      <div key={bl} className="flex items-center gap-3">
                        <span className="text-xs w-5 text-center" style={{ color: bc.color }}>{bc.icon}</span>
                        <span className="text-xs font-semibold w-20" style={{ color: bc.color }}>
                          {isHi ? bc.labelHi : bc.label}
                        </span>
                        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: `${bc.color}15` }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${pctCorrect}%`, background: bc.color }} />
                        </div>
                        <span className="text-[10px] text-[var(--text-3)] w-16 text-right">
                          {correctAtLevel}/{qsAtLevel.length} ({pctCorrect}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
                {cogLoad.fatigueScore > 0.3 && (
                  <div className="mt-3 pt-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
                    <span className="text-sm">😮‍💨</span>
                    <span className="text-[10px] text-[var(--text-3)]">
                      {isHi ? `थकान स्कोर: ${Math.round(cogLoad.fatigueScore * 100)}%` : `Fatigue detected: ${Math.round(cogLoad.fatigueScore * 100)}%`}
                    </span>
                  </div>
                )}
              </Card>
            </div>
          )}

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
            {/* Share — the growth engine. Indian parents share on WhatsApp. */}
            <Button
              fullWidth
              onClick={() => shareResult(quizShareMessage({
                studentName: student!.name,
                subject: subMeta?.name || selectedSubject!,
                score: pct,
                xpEarned: results.xp_earned,
                isHi,
              }))}
              style={{ background: '#25D366', color: '#fff' }}
            >
              {isHi ? '📱 WhatsApp पर शेयर करो' : '📱 Share on WhatsApp'}
            </Button>
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
