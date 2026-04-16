'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { track } from '@/lib/analytics';
import { logger } from '@/lib/logger';
import { getQuizQuestionsV2, submitQuizResults, saveCognitiveMetrics, saveQuestionResponses, processAdaptiveLearning, supabase, updateChapterProgress } from '@/lib/supabase';
import { XP_RULES } from '@/lib/xp-rules';
import { Card, Button, ProgressBar, LoadingFoxy } from '@/components/ui';
import { SUBJECT_META } from '@/lib/constants';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import QuizSetup from '@/components/quiz/QuizSetup';
import FeedbackOverlay from '@/components/quiz/FeedbackOverlay';
import WrittenAnswerInput from '@/components/quiz/ncert/WrittenAnswerInput';

// Lazy-load QuizResults — only shown after quiz completion (results screen)
const QuizResults = dynamic(() => import('@/components/quiz/QuizResults'), {
  ssr: false,
  loading: () => <LoadingFoxy />,
});
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
  // Written answer fields (SA/MA/LA from NCERT sources)
  marks_possible?: number;
  answer_text?: string | null;
  source_table?: string;
  question_id?: string;  // original ID from ncert_exercises or rag_content_chunks
  cbse_type?: string;
  cbse_label?: string;
  time_estimate?: number;
  word_limit?: number;
}

interface Response {
  question_id: string;
  selected_option: number;
  is_correct: boolean;
  time_spent: number;
  error_type?: ErrorType;
  // Written answer fields (populated for SA/MA/LA)
  student_answer_text?: string;
  marks_awarded?: number;
  marks_possible?: number;
  rubric_feedback?: string;
}

// ─── Written answer helpers ──────────────────────────────────────────────────
function mapToWrittenType(qt: string): 'short_answer' | 'medium_answer' | 'long_answer' | 'hots' | 'numerical' | 'intext' {
  const map: Record<string, string> = {
    short_answer: 'short_answer', medium_answer: 'medium_answer', long_answer: 'long_answer',
    hots: 'hots', numerical: 'numerical', intext: 'intext',
    sa: 'short_answer', la: 'long_answer', ma: 'medium_answer',
  };
  return (map[qt] ?? 'short_answer') as 'short_answer' | 'medium_answer' | 'long_answer' | 'hots' | 'numerical' | 'intext';
}

function getWordLimit(qt: string): number {
  const limits: Record<string, number> = {
    short_answer: 40, medium_answer: 100, long_answer: 200,
    hots: 150, numerical: 60, intext: 80, sa: 40, la: 200, ma: 100,
  };
  return limits[qt] ?? 80;
}

function getTimeEstimate(qt: string): number {
  const times: Record<string, number> = {
    short_answer: 120, medium_answer: 240, long_answer: 480,
    hots: 360, numerical: 180, intext: 150, sa: 120, la: 480, ma: 240,
  };
  return times[qt] ?? 180;
}

/** Detect whether a question is MCQ based on its type and available options */
function isQuestionMCQ(q: Question): boolean {
  if (q.question_type === 'mcq' || q.cbse_type === 'mcq') return true;
  // Has valid MCQ options: array with 4 items
  const opts = Array.isArray(q.options) ? q.options : (() => { try { return JSON.parse(q.options as string); } catch { return []; } })();
  if (opts.length === 4 && typeof q.correct_answer_index === 'number' && q.correct_answer_index >= 0 && q.correct_answer_index <= 3) return true;
  return false;
}

/** Classify error type for wrong answers — used by adaptive processing */
function classifyQuizError(question: Question, response: Response): string {
  // If student answered very quickly (<5s), likely careless
  if ((response.time_spent ?? 0) < 5) return 'careless';
  // If question is 'remember' level and wrong, likely knowledge gap
  if (question.bloom_level === 'remember') return 'knowledge_gap';
  // If question is 'apply' or higher, likely conceptual
  if (['apply', 'analyze', 'evaluate', 'create'].includes(question.bloom_level ?? '')) return 'conceptual';
  // Default
  return 'procedural';
}

const VALID_QUIZ_COUNTS = [5, 10, 15, 20] as const;
const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

export default function QuizPage() {
  const { student, snapshot, isLoggedIn, isLoading, isHi, refreshSnapshot, activeRole } = useAuth();
  const router = useRouter();
  const { unlocked: allowedSubjects } = useAllowedSubjects();

  // Setup state
  const [screen, setScreen] = useState<Screen>('select');
  const [quizMode, setQuizMode] = useState<QuizMode>('cognitive');
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<number | null>(null);
  const [questionCount, setQuestionCount] = useState(10);
  const [examTimeLimit, setExamTimeLimit] = useState(180); // minutes for exam mode
  const [examTimerActive, setExamTimerActive] = useState(false);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<string[]>(['mcq']);

  // Written answer evaluation state
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [lastWrittenAnswer, setLastWrittenAnswer] = useState<string>('');
  const [lastWrittenTimeSpent, setLastWrittenTimeSpent] = useState<number>(0);
  const [currentEval, setCurrentEval] = useState<{
    marks_awarded: number;
    marks_possible: number;
    feedback: string;
    is_correct: boolean;
    key_points?: { point: string; hit: boolean }[];
    model_answer_summary?: string;
    grade?: string;
    percentage?: number;
  } | null>(null);

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
  const [noQuestionsError, setNoQuestionsError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Results state
  const [results, setResults] = useState<{
    total: number; correct: number; score_percent: number; xp_earned: number; session_id: string;
  } | null>(null);

  // Network error resilience — retry support for failed submissions
  const [networkError, setNetworkError] = useState<string | null>(null);
  const pendingSubmissionRef = useRef<Response[] | null>(null);

  // JEE/NEET tag mode — grades 11-12 only, persisted to localStorage
  const [jeeNeetMode, setJeeNeetMode] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('alfanumrik_jee_neet_mode');
    if (stored !== null) setJeeNeetMode(stored === 'true');
    else {
      const g = student?.grade ?? '9';
      if (g === '11' || g === '12') setJeeNeetMode(true);
    }
  }, [student?.grade]);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
    if (!isLoading && isLoggedIn && !student && activeRole !== 'student') {
      router.replace(activeRole === 'teacher' ? '/teacher' : activeRole === 'guardian' ? '/parent' : '/');
    }
  }, [isLoading, isLoggedIn, student, activeRole, router]);

  // Check URL params for pre-selected subject/mode (passed as initial values to QuizSetup)
  const [initialSubject, setInitialSubject] = useState<string | null>(null);
  const [initialMode, setInitialMode] = useState<QuizMode>('cognitive');
  const [initialCount, setInitialCount] = useState<number>(10);
  const [initialChapter, setInitialChapter] = useState<number | null>(null);
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
    const countParam = params.get('count');
    if (countParam) {
      const c = parseInt(countParam, 10);
      if ((VALID_QUIZ_COUNTS as readonly number[]).includes(c)) {
        setQuestionCount(c);
        setInitialCount(c);
      }
    }
    const chapterParam = params.get('chapter');
    if (chapterParam) {
      const ch = parseInt(chapterParam, 10);
      if (!isNaN(ch) && ch > 0) {
        setSelectedChapter(ch);
        setInitialChapter(ch);
      }
    }
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

  /** P6: Runtime question quality gate — filter out malformed questions before serving */
  function isValidQuestion(q: Question): boolean {
    // Text must be non-empty and free of template markers
    if (!q.question_text || q.question_text.length < 5) return false;
    if (q.question_text.includes('{{') || q.question_text.includes('[BLANK]')) return false;

    // MCQ-specific validation
    if (isQuestionMCQ(q)) {
      const qOpts = Array.isArray(q.options) ? q.options : (() => { try { return JSON.parse(q.options as string); } catch { return []; } })();
      if (qOpts.length !== 4) return false;
      if (qOpts.some((o: string) => !o || String(o).trim() === '')) return false;
      if (typeof q.correct_answer_index !== 'number' || q.correct_answer_index < 0 || q.correct_answer_index > 3) return false;
    }

    return true;
  }

  const startQuiz = useCallback(async (opts?: {
    subject: string;
    difficulty: number | null;
    questionCount: number;
    quizMode: QuizMode;
    examTimeLimit: number;
    chapterNumber: number | null;
    questionTypes?: string[];
  }) => {
    // When called from QuizSetup, apply the selected options to page state
    const subj = opts?.subject ?? selectedSubject;
    const diff = opts?.difficulty ?? selectedDifficulty;
    const qCount = opts?.questionCount ?? questionCount;
    const chapter = opts?.chapterNumber ?? selectedChapter;
    const qTypes = opts?.questionTypes ?? selectedQuestionTypes;
    if (opts) {
      setSelectedSubject(opts.subject);
      setSelectedDifficulty(opts.difficulty);
      setQuestionCount(opts.questionCount);
      setQuizMode(opts.quizMode);
      setExamTimeLimit(opts.examTimeLimit);
      setSelectedChapter(opts.chapterNumber);
      setSelectedQuestionTypes(opts.questionTypes ?? ['mcq']);
    }
    if (!subj || !student) return;
    setLoading(true);

    // Map 'ncert' to all NCERT written question types (fetch in main quiz, no redirect)
    const effectiveTypes = qTypes.length === 1 && qTypes[0] === 'ncert'
      ? ['short_answer', 'long_answer', 'intext', 'exercise', 'example', 'hots', 'numerical']
      : qTypes;

    try {
      const diffModeMap: Record<string, string> = { '1': 'easy', '2': 'medium', '3': 'hard' };
      const diffMode = diff != null ? (diffModeMap[String(diff)] || 'mixed') : (opts?.quizMode === 'cognitive' ? 'progressive' : 'mixed');

      // GUARANTEED COUNT ASSEMBLER — replaces scattered fetching
      // Uses 4-rung fallback ladder to ensure exact count fulfillment.
      // Never returns a partial quiz silently.
      const { assembleQuiz } = await import('@/lib/quiz-assembler');
      const assemblyResult = await assembleQuiz({
        subject: subj,
        grade: student.grade,
        requestedCount: qCount,
        difficulty: diffMode,
        chapter: chapter ?? null,
        questionTypes: effectiveTypes,
        mode: quizMode,
      });

      if (!assemblyResult.success) {
        setNoQuestionsError(true);
        setLoading(false);
        return;
      }

      const qs = assemblyResult.questions;

      // If we still have fewer questions than requested after all fallbacks,
      // proceed with what we have but log the gap
      if (qs.length < qCount) {
        logger.warn('quiz_pool_insufficient', {
          requested: qCount,
          available: qs.length,
          subject: subj,
          grade: student.grade,
          chapter,
        });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSubject, student, questionCount, selectedDifficulty, selectedChapter, selectedQuestionTypes, isHi, router]);

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

  // ─── Written answer submission (SA/MA/LA) ─────────────────────────────────
  const handleWrittenSubmit = async (answer: string, timeSpent: number) => {
    const q = questions[currentIdx];
    setIsEvaluating(true);
    setEvalError(null);
    // Save for retry
    setLastWrittenAnswer(answer);
    setLastWrittenTimeSpent(timeSpent);

    let evalResult: { marks_awarded: number; marks_possible: number; feedback: string; is_correct: boolean; key_points?: { point: string; hit: boolean }[]; model_answer_summary?: string } | null = null;

    try {
      const { data: sessData } = await supabase.auth.getSession();
      const token = sessData?.session?.access_token ?? '';
      const resp = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ncert-question-engine`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            action: 'evaluate_answer',
            student_id: student!.id,
            question_id: q.question_id ?? q.id,
            source_table: q.source_table ?? 'question_bank',
            question_text: q.question_text,
            student_answer: answer,
            marks_possible: q.marks_possible ?? 2,
            question_type: q.cbse_type ?? q.question_type,
          }),
        }
      );
      if (resp.ok) {
        evalResult = await resp.json();
      }
    } catch (err) {
      console.warn('Written answer evaluation failed:', err);
    }

    // If evaluation failed (network error, API error, null result), don't punish the student.
    // Show retry/skip options instead of marking wrong.
    if (!evalResult) {
      setIsEvaluating(false);
      setEvalError(
        isHi
          ? 'मूल्यांकन विफल। तुम्हारा जवाब सहेजा गया है — फिर से कोशिश करो या छोड़ दो।'
          : 'Evaluation failed. Your answer is saved — you can retry or skip.'
      );
      return; // Don't auto-advance — let student retry or skip
    }

    // Record the written response
    // Written answers are "correct" if they earn >= 50% of marks.
    // A student who earns 1/2 marks deserves credit, not a red "WRONG" mark.
    const marksAwarded = evalResult.marks_awarded ?? 0;
    const marksPossible = q.marks_possible ?? 2;
    const isCorrect = marksPossible > 0 ? marksAwarded >= marksPossible * 0.5 : false;

    // Emotional feedback
    const fb = isCorrect ? onCorrectAnswer(feedbackState) : onWrongAnswer(feedbackState);
    playFeedbackSound(fb);
    setActiveFeedback({ ...fb });

    setResponses(prev => [...prev, {
      question_id: q.id,
      selected_option: -1, // No option selected for written answers
      is_correct: isCorrect,
      time_spent: timeSpent,
      student_answer_text: answer,
      marks_awarded: marksAwarded,
      marks_possible: marksPossible,
      rubric_feedback: evalResult?.feedback ?? undefined,
    }]);

    // Store full evaluation result for rich feedback display
    setCurrentEval({
      marks_awarded: marksAwarded,
      marks_possible: marksPossible,
      feedback: evalResult.feedback,
      is_correct: isCorrect,
      key_points: evalResult.key_points,
      model_answer_summary: evalResult.model_answer_summary,
      grade: undefined, // grade not returned from this endpoint
      percentage: marksPossible > 0 ? Math.round((marksAwarded / marksPossible) * 100) : 0,
    });

    setIsEvaluating(false);
    setShowExplanation(true);
    if (qTimerRef.current) clearInterval(qTimerRef.current);

    // Update cognitive load
    const newCogLoad = updateCognitiveLoad(cogLoad, isCorrect, timeSpent);
    setCogLoad(newCogLoad);
  };

  const handleWrittenSkip = () => {
    const q = questions[currentIdx];
    setResponses(prev => [...prev, {
      question_id: q.id,
      selected_option: -1,
      is_correct: false,
      time_spent: 0,
      student_answer_text: '',
      marks_awarded: 0,
      marks_possible: q.marks_possible ?? 2,
      rubric_feedback: 'Skipped',
    }]);
    // Move to next question
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(i => i + 1);
      setSelectedOption(null);
      setShowExplanation(false);
      setReflection(null);
      setHintLevel(0);
    } else {
      nextQuestion();
    }
  };

  const nextQuestion = async () => {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(i => i + 1);
      setSelectedOption(null);
      setShowExplanation(false);
      setReflection(null);
      setHintLevel(0);
      setCurrentEval(null);
    } else {
      // Quiz complete — submit results
      if (timerRef.current) clearInterval(timerRef.current);
      setScreen('feedback');
      setLoading(true);
      try {
        const allResponses = [...responses];
        // Add the last response if not already added (only for MCQ — written answers are added by handleWrittenSubmit)
        if (allResponses.length < questions.length) {
          const q = questions[currentIdx];
          if (isQuestionMCQ(q)) {
            allResponses.push({
              question_id: q.id,
              selected_option: selectedOption!,
              is_correct: selectedOption === q.correct_answer_index,
              time_spent: questionTimer,
            });
          }
        }

        // ── ANTI-CHEAT: Client-side validation before submission (P3) ──
        // 1. Minimum time: 3 seconds avg per MCQ question (bots submit instantly) — REJECT
        // Written answers have their own time budgets and are excluded from this check
        const mcqResponses = allResponses.filter(r => r.selected_option >= 0);
        const avgTimePerQ = mcqResponses.length > 0 ? timer / allResponses.length : (allResponses.length > 0 ? timer / allResponses.length : 0);
        if (mcqResponses.length > 0 && avgTimePerQ < 3) {
          console.warn(`[AntiCheat] Quiz completed too fast: ${timer}s for ${allResponses.length} questions (avg ${avgTimePerQ.toFixed(1)}s < 3s)`);
          setResults({
            total: allResponses.length,
            correct: allResponses.filter(r => r.is_correct).length,
            score_percent: 0,
            xp_earned: 0,
            session_id: '',
          });
          setLoading(false);
          setScreen('results');
          return;
        }

        // 2. Detect impossible response patterns — FLAG (warn but still submit)
        // If ALL MCQ answers are the same index and >3 MCQ questions, flag as suspicious
        // Written answers (selected_option === -1) are excluded from this check
        const optionCounts = [0, 0, 0, 0];
        mcqResponses.forEach(r => { if (r.selected_option >= 0 && r.selected_option < 4) optionCounts[r.selected_option]++; });
        const maxSameOption = Math.max(...optionCounts);
        if (mcqResponses.length > 3 && maxSameOption === mcqResponses.length) {
          console.warn(`[AntiCheat] All MCQ answers were option ${optionCounts.indexOf(maxSameOption)} — pattern gaming`);
        }

        // 3. Verify response count matches question count — REJECT
        if (allResponses.length !== questions.length) {
          console.warn(`[AntiCheat] Response count (${allResponses.length}) != question count (${questions.length})`);
          setResults({
            total: questions.length,
            correct: 0,
            score_percent: 0,
            xp_earned: 0,
            session_id: '',
          });
          setLoading(false);
          setScreen('results');
          return;
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

        // Update chapter progress after quiz
        if (selectedChapter) {
          updateChapterProgress(selectedSubject!, student!.grade, selectedChapter).catch((err: unknown) => {
            console.warn('[quiz] chapter progress update failed:', err instanceof Error ? err.message : String(err));
          });
        }

        // Save per-question responses for ALL quiz modes (populates question_responses table).
        // Runs for practice, cognitive, and exam modes — enables adaptive learning tracking.
        if (res?.session_id) {
          saveQuestionResponses(allResponses.map((r, i) => ({
            student_id: student!.id,
            question_id: r.question_id,
            quiz_session_id: res.session_id,
            selected_answer: String(r.selected_option),
            is_correct: r.is_correct,
            response_time_seconds: r.time_spent,
            bloom_level_attempted: questions[i]?.bloom_level || 'remember',
            was_in_zpd: questions[i]?.difficulty === 2,
            error_type: !r.is_correct ? (r.error_type || classifyQuizError(questions[i], r)) : undefined,
            quality: r.is_correct ? (r.time_spent < 10 ? 5 : 4) : (r.time_spent < 5 ? 1 : 2),
          }))).catch((err: unknown) => {
            console.warn('[quiz] saveQuestionResponses failed:', err instanceof Error ? err.message : String(err));
          });

          // Fire-and-forget: update CME mastery state for adaptive question selection.
          // Populates cme_concept_state so future quizzes adapt to the student's
          // mastery level. Non-blocking — P1/P2/P3/P4 invariants untouched.
          processAdaptiveLearning(
            student!.id,
            selectedSubject!,
            student!.grade,
            allResponses.map(r => ({
              question_id: r.question_id,
              is_correct: r.is_correct,
              time_spent: r.time_spent,
              selected_option: r.selected_option,
            })),
            questions.map(q => ({
              id: q.id,
              chapter_number: q.chapter_number,
              difficulty: q.difficulty,
              bloom_level: q.bloom_level,
            })),
            res.session_id,
          ).catch((err: unknown) => {
            console.warn('[quiz] processAdaptiveLearning failed:', err instanceof Error ? err.message : String(err));
          });
        }

        // Save cognitive metrics for this session (cognitive mode only — tracks ZPD and fatigue)
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
          }).catch((err: unknown) => {
            console.warn('[quiz] saveCognitiveMetrics failed:', err instanceof Error ? err.message : String(err));
          });
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
        // Store pending submission for retry
        pendingSubmissionRef.current = [...responses];
        if (pendingSubmissionRef.current.length < questions.length) {
          const q = questions[currentIdx];
          if (isQuestionMCQ(q) && selectedOption !== null) {
            pendingSubmissionRef.current.push({
              question_id: q.id,
              selected_option: selectedOption,
              is_correct: selectedOption === q.correct_answer_index,
              time_spent: questionTimer,
            });
          }
        }
        setNetworkError(isHi
          ? 'कनेक्शन टूट गया — आपके उत्तर सुरक्षित हैं। पुनः प्रयास करें।'
          : 'Connection lost — your answers are saved. Please retry.');
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

  // Retry failed quiz submission (network error recovery)
  const retrySubmit = useCallback(async () => {
    if (!pendingSubmissionRef.current || !student || !selectedSubject) return;
    setLoading(true);
    setNetworkError(null);
    try {
      const allResponses = pendingSubmissionRef.current;
      const subMeta = SUBJECT_META.find(s => s.code === selectedSubject);
      const res = await submitQuizResults(
        student.id,
        selectedSubject,
        student.grade,
        subMeta?.name || selectedSubject,
        questions[0]?.chapter_number || 1,
        allResponses,
        timer
      );
      setResults(res);
      refreshSnapshot();
      pendingSubmissionRef.current = null;

      // Update chapter progress after quiz
      if (selectedChapter) {
        updateChapterProgress(selectedSubject, student.grade, selectedChapter).catch((err: unknown) => {
          console.warn('[quiz-retry] chapter progress update failed:', err instanceof Error ? err.message : String(err));
        });
      }

      track('quiz_completed', {
        subject: selectedSubject,
        score: res?.score_percent ?? 0,
        questions: allResponses.length,
        grade: student.grade,
        time_seconds: timer,
      });
    } catch (e) {
      console.error('Retry submit error:', e);
      setNetworkError(isHi
        ? 'कनेक्शन टूट गया — आपके उत्तर सुरक्षित हैं। पुनः प्रयास करें।'
        : 'Connection lost — your answers are saved. Please retry.');
    }
    setLoading(false);
  }, [student, selectedSubject, questions, timer, selectedChapter, isHi, refreshSnapshot]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  /**
   * Heuristic exam tag for JEE/NEET mode (grades 11-12).
   * Physics numerical-style → JEE Main
   * Biology application → NEET
   * Chemistry with organic keywords → JEE Advanced
   * Else → Board
   */
  function getExamTag(question: Question): { label: string; labelHi: string; color: string } {
    const text = (question.question_text || '').toLowerCase();
    const subject = selectedSubject || '';
    if (subject === 'physics' && /\d+\s*(m\/s|newton|joule|kg|ms|rad|ohm|volt|watt|coulomb|ampere|hertz|pascal)/.test(text)) {
      return { label: 'JEE Main', labelHi: 'JEE मेन', color: '#2563EB' };
    }
    if (subject === 'biology' && (question.bloom_level === 'apply' || question.bloom_level === 'analyze' || /cell|enzyme|hormone|dna|rna|organ|gene|photosynthesis|respirat/.test(text))) {
      return { label: 'NEET', labelHi: 'NEET', color: '#16A34A' };
    }
    if (subject === 'chemistry' && /organic|benzene|alkane|alkene|alkyl|ester|aldehyde|ketone|amine|polymer|aromatic/.test(text)) {
      return { label: 'JEE Adv', labelHi: 'JEE एडवांस', color: '#7C3AED' };
    }
    return { label: 'Board', labelHi: 'बोर्ड', color: '#F97316' };
  }

  if (isLoading || !student) return <LoadingFoxy />;

  const subMeta = SUBJECT_META.find(s => s.code === selectedSubject);
  const q = questions[currentIdx];
  const opts = q ? parseOptions(q.options) : [];
  const progress = questions.length > 0 ? ((currentIdx + (showExplanation ? 1 : 0)) / questions.length) * 100 : 0;
  const correctSoFar = responses.filter(r => r.is_correct).length;

  // ═══ NO QUESTIONS AVAILABLE — friendly empty state ═══
  if (noQuestionsError && screen === 'select') {
    const errorSubMeta = SUBJECT_META.find(s => s.code === selectedSubject);
    return (
      <div className="mesh-bg min-h-dvh flex flex-col items-center justify-center px-6 gap-5">
        <div className="text-5xl">📭</div>
        <h2 className="font-bold text-lg text-center" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
          {isHi ? 'इस विषय में अभी प्रश्न नहीं हैं' : 'No questions available yet'}
        </h2>
        <p className="text-sm text-center max-w-xs" style={{ color: 'var(--text-2)' }}>
          {isHi
            ? `${errorSubMeta?.name ?? 'इस विषय'} के लिए पर्याप्त प्रश्न उपलब्ध नहीं हैं। कृपया कोई अन्य विषय या अध्याय चुनें।`
            : `Not enough questions for ${errorSubMeta?.name ?? 'this subject'} right now. Try a different subject or chapter.`}
        </p>
        <div className="flex gap-3">
          <Button variant="primary" onClick={() => { setNoQuestionsError(false); }}>
            {isHi ? '← विषय बदलें' : '← Change Subject'}
          </Button>
          <Button variant="ghost" onClick={() => router.push('/foxy')}>
            {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
          </Button>
        </div>
      </div>
    );
  }

  // ═══ SUBJECT SELECTION SCREEN ═══
  if (screen === 'select') {
    return (
      <QuizSetup
        isHi={isHi}
        initialSubject={initialSubject}
        initialMode={initialMode}
        initialCount={initialCount}
        initialChapter={initialChapter}
        loading={loading}
        studentGrade={student?.grade ?? ''}
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

        {/* Full-screen evaluation blocker for written answers */}
        {isEvaluating && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white rounded-xl p-8 text-center max-w-sm mx-4 shadow-xl">
              <div className="text-4xl mb-4 animate-bounce">🤔</div>
              <h3 className="text-lg font-semibold mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
                {isHi ? 'तुम्हारा जवाब जांचा जा रहा है...' : 'Evaluating your answer...'}
              </h3>
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'AI शिक्षक तुम्हारे उत्तर की समीक्षा कर रहा है' : 'Our AI teacher is reviewing your response'}
              </p>
              <div className="mt-4 w-full bg-gray-200 rounded-full h-1">
                <div className="bg-purple-600 h-1 rounded-full animate-pulse" style={{ width: '60%' }} />
              </div>
            </div>
          </div>
        )}

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
                {(student?.grade === '11' || student?.grade === '12') && (
                  <button
                    onClick={() => {
                      const next = !jeeNeetMode;
                      setJeeNeetMode(next);
                      localStorage.setItem('alfanumrik_jee_neet_mode', String(next));
                    }}
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full transition-all"
                    style={{
                      background: jeeNeetMode ? '#2563EB18' : 'var(--surface-2)',
                      color: jeeNeetMode ? '#2563EB' : 'var(--text-3)',
                      border: `1px solid ${jeeNeetMode ? '#2563EB40' : 'transparent'}`,
                    }}
                    title={jeeNeetMode ? 'Hide JEE/NEET tags' : 'Show JEE/NEET tags'}
                  >
                    🎯 {jeeNeetMode ? 'JEE/NEET' : 'Tags'}
                  </button>
                )}
              </div>
            </div>
            <ProgressBar value={progress} color={subMeta?.color} height={4} />
          </div>
        </header>

        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-5 flex flex-col gap-4">
          {/* Branch: MCQ vs Written Answer rendering */}
          {isQuestionMCQ(q) ? (
            <>
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
                  {jeeNeetMode && (student?.grade === '11' || student?.grade === '12') && (() => {
                    const tag = getExamTag(q);
                    return (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full ml-auto"
                        style={{ background: tag.color + '18', color: tag.color }}>
                        🎯 {isHi ? tag.labelHi : tag.label}
                      </span>
                    );
                  })()}
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
                    {isCorrect && <span className="ml-auto text-xs font-bold" style={{ color: 'var(--orange)' }}>+{XP_RULES.quiz_per_correct} XP</span>}
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
            </>
          ) : (
            /* ═══ WRITTEN ANSWER (SA/MA/LA) ═══ */
            <>
              {!isAnswered ? (
                <>
                  <WrittenAnswerInput
                    questionText={isHi && q.question_hi ? q.question_hi : q.question_text}
                    questionType={mapToWrittenType(q.cbse_type ?? q.question_type)}
                    marksP={q.marks_possible ?? 2}
                    wordLimit={q.word_limit ?? getWordLimit(q.cbse_type ?? q.question_type)}
                    timeEstimate={q.time_estimate ?? getTimeEstimate(q.cbse_type ?? q.question_type)}
                    onSubmit={handleWrittenSubmit}
                    onSkip={handleWrittenSkip}
                    questionNumber={currentIdx + 1}
                    totalQuestions={questions.length}
                    isEvaluating={isEvaluating}
                  />
                  {/* Evaluation failure — retry/skip UI */}
                  {evalError && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center space-y-2">
                      <p className="text-sm text-amber-800">{evalError}</p>
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={() => { setEvalError(null); handleWrittenSubmit(lastWrittenAnswer, lastWrittenTimeSpent); }}
                          className="px-4 py-2 bg-amber-600 text-white rounded text-sm font-medium hover:bg-amber-700 active:scale-[0.98] transition-all"
                        >
                          {isHi ? 'फिर से कोशिश करो' : 'Retry Evaluation'}
                        </button>
                        <button
                          onClick={() => { setEvalError(null); handleWrittenSkip(); }}
                          className="px-4 py-2 bg-gray-200 text-gray-700 rounded text-sm font-medium hover:bg-gray-300 active:scale-[0.98] transition-all"
                        >
                          {isHi ? 'छोड़ दो' : 'Skip'}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* Written answer post-evaluation feedback */
                <>
                  <Card className="!p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-wider">
                        {isHi ? `अध्याय ${q.chapter_number}` : `Chapter ${q.chapter_number}`}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                        style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                        {q.cbse_label ?? 'SA'} {q.marks_possible ?? 2} {isHi ? 'अंक' : 'marks'}
                      </span>
                    </div>
                    <div className="text-lg md:text-xl font-semibold leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>
                      {isHi && q.question_hi ? q.question_hi : q.question_text}
                    </div>
                  </Card>

                  {/* Written evaluation feedback — uses currentEval for richer display */}
                  {currentEval && (
                    <div className="rounded-2xl p-4 border space-y-3"
                      style={{
                        background: (currentEval.percentage ?? 0) >= 80 ? 'rgba(22,163,74,0.05)'
                          : (currentEval.percentage ?? 0) >= 50 ? 'rgba(245,158,11,0.05)'
                          : 'rgba(220,38,38,0.04)',
                        borderColor: (currentEval.percentage ?? 0) >= 80 ? 'rgba(22,163,74,0.15)'
                          : (currentEval.percentage ?? 0) >= 50 ? 'rgba(245,158,11,0.15)'
                          : 'rgba(220,38,38,0.12)',
                      }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">
                            {(currentEval.percentage ?? 0) >= 80 ? '🎉' : (currentEval.marks_awarded ?? 0) > 0 ? '📝' : '💡'}
                          </span>
                          <span className="text-base font-bold"
                            style={{
                              color: (currentEval.percentage ?? 0) >= 80 ? '#16A34A'
                                : (currentEval.marks_awarded ?? 0) > 0 ? '#F59E0B'
                                : '#DC2626',
                            }}>
                            {currentEval.marks_awarded}/{currentEval.marks_possible} {isHi ? 'अंक' : 'marks'}
                          </span>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          (currentEval.percentage ?? 0) >= 80 ? 'bg-green-100 text-green-700'
                            : (currentEval.percentage ?? 0) >= 50 ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {(currentEval.percentage ?? 0) >= 80
                            ? (isHi ? 'बहुत अच्छा' : 'Good')
                            : (currentEval.percentage ?? 0) >= 50
                            ? (isHi ? 'ठीक' : 'Fair')
                            : (isHi ? 'सुधार करो' : 'Needs Work')}
                        </span>
                      </div>

                      {/* AI feedback */}
                      {currentEval.feedback && (
                        <p className="text-sm leading-relaxed text-[var(--text-2)]">
                          {currentEval.feedback}
                        </p>
                      )}

                      {/* Key points breakdown */}
                      {currentEval.key_points && currentEval.key_points.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>
                            {isHi ? 'मुख्य बिंदु:' : 'Key Points:'}
                          </span>
                          {currentEval.key_points.map((kp, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <span className="flex-shrink-0 mt-0.5">{kp.hit ? '✅' : '❌'}</span>
                              <span style={{ color: kp.hit ? '#16A34A' : 'var(--text-3)' }}>{kp.point}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Model answer */}
                      {(currentEval.model_answer_summary || q.explanation) && (
                        <div className="pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                          <div className="rounded-lg px-3 py-2 text-sm leading-relaxed"
                            style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.12)' }}>
                            <span className="font-semibold text-xs block mb-1" style={{ color: '#3B82F6' }}>
                              {isHi ? 'आदर्श उत्तर' : 'Model Answer'}
                            </span>
                            <p className="text-[var(--text-2)]">
                              {currentEval.model_answer_summary || q.explanation}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Fallback if currentEval is null but showExplanation is true */}
                  {!currentEval && (() => {
                    const lastResp = responses[responses.length - 1];
                    if (!lastResp) return null;
                    const awarded = lastResp.marks_awarded ?? 0;
                    const possible = lastResp.marks_possible ?? q.marks_possible ?? 2;
                    const gotFullMarks = awarded >= possible;
                    return (
                      <div className="rounded-2xl p-4 border"
                        style={{
                          background: gotFullMarks ? 'rgba(22,163,74,0.05)' : 'rgba(220,38,38,0.04)',
                          borderColor: gotFullMarks ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.12)',
                        }}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">{gotFullMarks ? '🎉' : awarded > 0 ? '📝' : '💡'}</span>
                          <span className="text-sm font-bold"
                            style={{ color: gotFullMarks ? '#16A34A' : awarded > 0 ? '#F59E0B' : '#DC2626' }}>
                            {awarded}/{possible} {isHi ? 'अंक' : 'marks'}
                          </span>
                        </div>
                        {lastResp.rubric_feedback && (
                          <p className="text-sm leading-relaxed text-[var(--text-2)]">
                            {lastResp.rubric_feedback}
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {/* Next button for written answers */}
                  <div className="flex gap-3 mt-auto pb-2">
                    <Button fullWidth onClick={nextQuestion} color={subMeta?.color}>
                      {currentIdx < questions.length - 1
                        ? (isHi ? 'अगला सवाल →' : 'Next Question →')
                        : (isHi ? 'नतीजे देखो 🎯' : 'See Results 🎯')}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>
    );
  }

  // ═══ RESULTS SCREEN ═══
  if (screen === 'results' && results) {
    return (
      <>
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
          isFirstQuiz={(snapshot?.quizzes_taken ?? 0) <= 1}
          onRetry={() => { setScreen('select'); setQuestions([]); setResponses([]); setResults(null); setNetworkError(null); pendingSubmissionRef.current = null; }}
          onGoHome={() => router.push('/dashboard')}
        />
        {networkError && (
          <div className="fixed bottom-20 left-4 right-4 bg-amber-500 text-white rounded-xl p-4 text-center z-40 shadow-lg animate-slide-up">
            <p className="text-sm font-medium mb-2">{networkError}</p>
            <button
              onClick={retrySubmit}
              disabled={loading}
              className="px-4 py-1.5 bg-white text-amber-700 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {loading
                ? (isHi ? 'भेज रहे हैं...' : 'Submitting...')
                : (isHi ? 'पुनः प्रयास करें' : 'Retry')}
            </button>
          </div>
        )}
      </>
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
