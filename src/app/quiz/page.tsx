'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { track } from '@/lib/analytics';
import { getQuizQuestions, submitQuizResults, saveCognitiveMetrics, saveQuestionResponses, supabase } from '@/lib/supabase';
import { Card, Button, ProgressBar, LoadingFoxy } from '@/components/ui';
import { SUBJECT_META } from '@/lib/constants';
import QuizSetup from '@/components/quiz/QuizSetup';
import QuizResults from '@/components/quiz/QuizResults';
import FeedbackOverlay from '@/components/quiz/FeedbackOverlay';
import {
  createFeedbackState, onCorrectAnswer, onWrongAnswer, onSessionComplete,
  getNearCompletionNudge, playFeedbackSound,
  type FeedbackState, type FeedbackResult,
} from '@/lib/feedback-engine';
import {
  BLOOM_CONFIG,
  initialCognitiveLoad, updateCognitiveLoad, getReflectionPrompt, classifyError,
  type BloomLevel, type CognitiveLoadState, type ReflectionPrompt, type ErrorType,
} from '@/lib/cognitive-engine';

type QuizMode = 'practice' | 'cognitive' | 'exam';
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

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

export default function QuizPage() {
  const { student, isLoggedIn, isLoading, isHi, refreshSnapshot, activeRole } = useAuth();
  const router = useRouter();

  // Setup state
  const [screen, setScreen] = useState<Screen>('select');
  const [quizMode, setQuizMode] = useState<QuizMode>('cognitive');
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<number | null>(null);
  const [questionCount, setQuestionCount] = useState(10);
  const [examTimeLimit, setExamTimeLimit] = useState(180); // minutes for exam mode
  const [examTimerActive, setExamTimerActive] = useState(false);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);

  // Cognitive 2.0 state
  const [cogLoad, setCogLoad] = useState<CognitiveLoadState>(initialCognitiveLoad());
  const [reflection, setReflection] = useState<ReflectionPrompt | null>(null);

  // Emotional feedback state
  const [feedbackState] = useState<FeedbackState>(() => createFeedbackState());
  const [activeFeedback, setActiveFeedback] = useState<FeedbackResult | null>(null);

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

  // Check URL params for pre-selected subject/mode (passed as initial values to QuizSetup)
  const [initialSubject, setInitialSubject] = useState<string | null>(null);
  const [initialMode, setInitialMode] = useState<QuizMode>('cognitive');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const subj = params.get('subject');
    if (subj && SUBJECT_META.find(s => s.code === subj)) {
      setSelectedSubject(subj);
      setInitialSubject(subj);
    }
    const mode = params.get('mode');
    if (mode === 'cognitive') { setQuizMode('cognitive'); setInitialMode('cognitive'); }
    if (mode === 'exam') { setQuizMode('exam'); setInitialMode('exam'); }
  }, []);

  // Track whether exam auto-submit has fired (prevents double-submit)
  const examAutoSubmittedRef = useRef(false);

  // Global timer (counts up for practice/cognitive, starts from limit for exam)
  useEffect(() => {
    if (screen === 'quiz') {
      if (quizMode === 'exam' && !examTimerActive) {
        setTimer(examTimeLimit * 60); // set to limit in seconds
        setExamTimerActive(true);
        examAutoSubmittedRef.current = false;
      }
      timerRef.current = setInterval(() => {
        setTimer(t => {
          if (quizMode === 'exam') {
            if (t <= 1) {
              // Time's up — auto-submit
              if (timerRef.current) clearInterval(timerRef.current);
              return 0;
            }
            return t - 1;
          }
          return t + 1;
        });
      }, 1000);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }
    setExamTimerActive(false);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [screen, quizMode, examTimeLimit, examTimerActive]);

  // Exam auto-submit: when timer reaches 0, trigger submission
  useEffect(() => {
    if (screen === 'quiz' && quizMode === 'exam' && timer === 0 && examTimerActive && !examAutoSubmittedRef.current) {
      examAutoSubmittedRef.current = true;
      nextQuestion();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on timer reaching 0
  }, [timer, screen, quizMode, examTimerActive]);

  // Per-question timer
  useEffect(() => {
    if (screen === 'quiz' && !showExplanation) {
      setQuestionTimer(0);
      qTimerRef.current = setInterval(() => setQuestionTimer(t => t + 1), 1000);
      return () => { if (qTimerRef.current) clearInterval(qTimerRef.current); };
    }
    return () => { if (qTimerRef.current) clearInterval(qTimerRef.current); };
  }, [screen, currentIdx, showExplanation]);

  const startQuiz = useCallback(async (opts?: {
    subject: string;
    difficulty: number | null;
    questionCount: number;
    quizMode: QuizMode;
    examTimeLimit: number;
    chapterNumber: number | null;
  }) => {
    // When called from QuizSetup, apply the selected options to page state
    const subj = opts?.subject ?? selectedSubject;
    const diff = opts?.difficulty ?? selectedDifficulty;
    const qCount = opts?.questionCount ?? questionCount;
    const chapter = opts?.chapterNumber ?? selectedChapter;
    if (opts) {
      setSelectedSubject(opts.subject);
      setSelectedDifficulty(opts.difficulty);
      setQuestionCount(opts.questionCount);
      setQuizMode(opts.quizMode);
      setExamTimeLimit(opts.examTimeLimit);
      setSelectedChapter(opts.chapterNumber);
    }
    if (!subj || !student) return;
    setLoading(true);
    try {
      const data = await getQuizQuestions(
        subj,
        student.grade,
        qCount,
        diff,
        chapter
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
  }, [selectedSubject, student, questionCount, selectedDifficulty, selectedChapter, isHi]);

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

    // Emotional feedback — sound + Foxy reaction
    const fb = isCorrect ? onCorrectAnswer(feedbackState) : onWrongAnswer(feedbackState);
    playFeedbackSound(fb);
    setActiveFeedback({ ...fb }); // spread to trigger re-render

    // Near-completion nudge
    const nudge = getNearCompletionNudge(currentIdx, questions.length);
    if (nudge && !isCorrect) {
      // Show nudge as feedback instead if near end and wrong
      setActiveFeedback({ ...fb, foxyLine: nudge });
    }

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

    // In exam mode, skip explanation — go straight to next question
    if (quizMode === 'exam') {
      if (qTimerRef.current) clearInterval(qTimerRef.current);
      if (currentIdx < questions.length - 1) {
        setCurrentIdx(i => i + 1);
        setSelectedOption(null);
        setHintLevel(0);
        return;
      }
      // Last question — submit
      nextQuestion();
      return;
    }

    setShowExplanation(true);
    if (qTimerRef.current) clearInterval(qTimerRef.current);

    // Cognitive load tracking + reflection prompts
    const newCogLoad = updateCognitiveLoad(cogLoad, isCorrect, questionTimer);
    setCogLoad(newCogLoad);
    if (quizMode === 'cognitive' || quizMode === 'practice') {
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

        // Save exam simulation if in exam mode
        if (quizMode === 'exam' && res?.session_id) {
          const totalMarks = allResponses.length; // 1 mark per question for MCQ
          const obtainedMarks = allResponses.filter(r => r.is_correct).length;
          supabase.from('exam_simulations').insert({
            student_id: student!.id,
            subject: selectedSubject!,
            grade: student!.grade,
            exam_format: 'cbse',
            total_marks: totalMarks,
            obtained_marks: obtainedMarks,
            percentage: totalMarks > 0 ? Math.round((obtainedMarks / totalMarks) * 100 * 100) / 100 : 0,
            time_taken_seconds: examTimeLimit * 60 - timer,
            time_limit_seconds: examTimeLimit * 60,
            is_completed: true,
            completed_at: new Date().toISOString(),
          }).then(() => {});
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

      // Play completion sound
      const completionFb = onSessionComplete(feedbackState);
      playFeedbackSound(completionFb);
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
      <QuizSetup
        isHi={isHi}
        initialSubject={initialSubject}
        initialMode={initialMode}
        loading={loading}
        onStart={startQuiz}
        onGoBack={() => router.push('/dashboard')}
      />
    );
  }

  // ═══ QUIZ SCREEN ═══
  if (screen === 'quiz' && q) {
    const isAnswered = showExplanation;
    const isCorrect = selectedOption === q.correct_answer_index;

    return (
      <div className="mesh-bg min-h-dvh flex flex-col focus-screen">
        {/* Emotional feedback overlay */}
        <FeedbackOverlay feedback={activeFeedback} isHi={isHi} />

        {/* Header — distraction-free: progress + timer only */}
        <header className="page-header" style={{ background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}>
          <div className="app-container py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{subMeta?.icon}</span>
                <span className="text-sm font-semibold" style={{ color: subMeta?.color }}>
                  {isHi ? `सवाल ${currentIdx + 1}/${questions.length}` : `Q ${currentIdx + 1}/${questions.length}`}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-[var(--text-3)] font-medium">
                <span>{correctSoFar}/{responses.length} ✓</span>
                <span style={{ color: quizMode === 'exam' && timer < 300 ? '#DC2626' : 'var(--text-3)', fontWeight: 600, fontFamily: 'var(--font-mono, monospace)' }}>
                  {formatTime(timer)}
                </span>
              </div>
            </div>
            <ProgressBar value={progress} color={subMeta?.color} height={4} />
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
            <div className="text-lg md:text-xl font-semibold leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>
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

          {/* Reflection Prompt — shown in cognitive and practice modes */}
          {isAnswered && (quizMode === 'cognitive' || quizMode === 'practice') && reflection && (
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

          {/* Cognitive Pause Alert — shown when fatigue detected */}
          {isAnswered && (quizMode === 'cognitive' || quizMode === 'practice') && cogLoad.shouldPause && (
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

          {/* Progressive Hints */}
          {!isAnswered && q.hint && (
            <div className="space-y-2">
              {hintLevel >= 1 && (
                <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.2)', color: 'var(--text-2)' }}>
                  💡 {q.hint}
                </div>
              )}
              {hintLevel >= 2 && (
                <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)', color: 'var(--text-2)' }}>
                  🔍 {q.hint} {isHi ? 'अंतर्निहित अवधारणा और सूत्र के बारे में सोचो।' : 'Think about the underlying concept and formula.'}
                </div>
              )}
              {hintLevel >= 3 && (
                <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.15)', color: 'var(--text-2)' }}>
                  🎯 {isHi ? 'उत्तर से संबंधित:' : 'The answer involves:'} {q.explanation?.split('.')[0] || (isHi ? 'व्याख्या उपलब्ध नहीं' : 'No explanation available')}
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 mt-auto pb-2">
            {!isAnswered ? (
              <>
                {q.hint && selectedOption === null && hintLevel < 3 && (
                  <Button variant="ghost" onClick={() => setHintLevel(prev => Math.min(prev + 1, 3))} size="sm">
                    {hintLevel === 0 ? (isHi ? '💡 संकेत' : '💡 Hint') : `💡 ${hintLevel}/3`}
                  </Button>
                )}
                <Button
                  fullWidth
                  onClick={confirmAnswer}
                  color={subMeta?.color}
                  size="md"
                  disabled={selectedOption === null}
                  style={selectedOption === null ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
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
    return (
      <QuizResults
        results={results}
        questions={questions}
        responses={responses}
        isHi={isHi}
        quizMode={quizMode}
        cogLoad={cogLoad}
        selectedSubject={selectedSubject}
        studentName={student!.name}
        timer={timer}
        onRetry={() => { setScreen('select'); setQuestions([]); setResponses([]); setResults(null); }}
        onGoHome={() => router.push('/dashboard')}
      />
    );
  }

  // ═══ RESULTS SCREEN — no results (submission failed or no responses) ═══
  if (screen === 'results' && !results) {
    return (
      <div className="mesh-bg min-h-dvh flex flex-col items-center justify-center px-6">
        <div className="text-center py-12 px-6">
          <div className="text-5xl mb-4">😕</div>
          <h3 className="text-lg font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'नतीजे उपलब्ध नहीं हैं' : 'Results not available'}
          </h3>
          <p className="text-sm text-[var(--text-3)] mb-4 max-w-xs mx-auto">
            {isHi
              ? 'कुछ गलत हो गया। कृपया दोबारा कोशिश करो।'
              : 'Something went wrong. Please try again.'}
          </p>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => { setScreen('select'); setQuestions([]); setResponses([]); setResults(null); }}>
              {isHi ? 'फिर से क्विज़ लो' : 'Try Again'}
            </Button>
            <Button variant="ghost" onClick={() => router.push('/dashboard')}>
              {isHi ? 'होम' : 'Home'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Submission in progress (screen === 'feedback')
  if (screen === 'feedback') {
    return (
      <div className="mesh-bg min-h-dvh flex flex-col items-center justify-center px-6">
        <div className="text-center">
          <LoadingFoxy />
          <p className="text-sm text-[var(--text-2)] mt-4 font-medium">
            {isHi ? 'नतीजे तैयार हो रहे हैं...' : 'Preparing your results...'}
          </p>
        </div>
      </div>
    );
  }

  // Fallback loading
  return <LoadingFoxy />;
}
