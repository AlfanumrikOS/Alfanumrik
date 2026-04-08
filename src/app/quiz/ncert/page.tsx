'use client';

/**
 * /quiz/ncert — NCERT Full Coverage Quiz
 *
 * Covers ALL NCERT questions: MCQ + Short Answer + Medium Answer + Long Answer.
 * Uses ncert-question-engine edge function backed by RAG (rag_content_chunks
 * + ncert_exercises). AI evaluates written answers with CBSE marking scheme.
 *
 * Screens: setup → quiz → evaluation → results
 */

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { LoadingFoxy } from '@/components/ui';
import NCERTQuizSetup, { type NCERTQuizConfig } from '@/components/quiz/ncert/NCERTQuizSetup';
import WrittenAnswerInput from '@/components/quiz/ncert/WrittenAnswerInput';
import NCERTEvaluation from '@/components/quiz/ncert/NCERTEvaluation';
import NCERTCoverageMap from '@/components/quiz/ncert/NCERTCoverageMap';

// ─── Types ────────────────────────────────────────────────────────────────────
type Screen = 'setup' | 'loading' | 'quiz' | 'evaluating' | 'evaluation' | 'results' | 'coverage';

interface NCERTQuestion {
  question_id: string;
  source_table: 'ncert_exercises' | 'rag_content_chunks' | 'question_bank';
  question_text: string;
  answer_text: string | null;
  solution_steps: string | null;
  question_type: string;
  cbse_type: string;
  cbse_label: string;
  marks_possible: number;
  bloom_level: string | null;
  ncert_exercise: string | null;
  options: string[] | null;
  topic_tag: string | null;
  time_estimate: number;
  word_limit: number;
}

interface EvaluationResult {
  marks_awarded: number;
  marks_possible: number;
  feedback: string;
  key_points: { point: string; hit: boolean }[];
  model_answer_summary: string;
  grade: string;
  is_correct: boolean;
}

interface AttemptRecord {
  question: NCERTQuestion;
  studentAnswer: string;
  selectedOption: number | null;
  evaluation: EvaluationResult | null;
  timeSpent: number;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

export default function NCERTQuizPage() {
  const { student, isLoggedIn, isLoading } = useAuth();
  const router = useRouter();

  const [screen, setScreen]           = useState<Screen>('setup');
  const [config, setConfig]           = useState<NCERTQuizConfig | null>(null);
  const [questions, setQuestions]     = useState<NCERTQuestion[]>([]);
  const [currentIdx, setCurrentIdx]   = useState(0);
  const [attempts, setAttempts]       = useState<AttemptRecord[]>([]);
  const [currentEval, setCurrentEval] = useState<EvaluationResult | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [loadError, setLoadError]     = useState('');
  // MCQ state
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [optionConfirmed, setOptionConfirmed] = useState(false);

  const EDGE_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ncert-question-engine`;

  async function getAuthToken(): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? '';
  }

  // ─── Start: fetch questions ───────────────────────────────────────────────
  const handleStart = useCallback(async (cfg: NCERTQuizConfig) => {
    setConfig(cfg);
    setScreen('loading');
    setLoadError('');
    setAttempts([]);
    setCurrentIdx(0);

    try {
      const token = await getAuthToken();
      const resp = await fetch(EDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          action: 'fetch_questions',
          student_id: student!.id,
          subject: cfg.subject,
          grade: cfg.grade,
          chapter: cfg.chapter,
          question_type: cfg.questionType,
          count: cfg.count,
        }),
      });

      if (!resp.ok) throw new Error(`Server error ${resp.status}`);
      const data = await resp.json();

      if (!data.questions || data.questions.length === 0) {
        setLoadError('No questions found for this chapter and type. Try "All" or a different chapter.');
        setScreen('setup');
        return;
      }

      setQuestions(data.questions);
      setScreen('quiz');
      setSelectedOption(null);
      setOptionConfirmed(false);
    } catch (e) {
      console.error('fetch_questions error:', e);
      setLoadError('Failed to load questions. Please try again.');
      setScreen('setup');
    }
  }, [student, EDGE_URL]);

  // ─── MCQ submission ───────────────────────────────────────────────────────
  async function handleMCQSubmit() {
    if (selectedOption === null || !config) return;
    const q = questions[currentIdx];
    const opts = Array.isArray(q.options) ? q.options : (q.options ? JSON.parse(q.options as unknown as string) : []);
    // For MCQ from rag_content_chunks, correct_answer_index may not exist — treat as not graded
    const correctIdx = (q as unknown as Record<string, unknown>).correct_answer_index as number | undefined;
    const isCorrect = correctIdx !== undefined ? selectedOption === correctIdx : false;
    const eval_: EvaluationResult = {
      marks_awarded: isCorrect ? q.marks_possible : 0,
      marks_possible: q.marks_possible,
      feedback: isCorrect ? 'Correct! Well done.' : `Incorrect. The correct answer was: ${opts[correctIdx ?? 0] ?? 'See model answer.'}`,
      key_points: [],
      model_answer_summary: q.answer_text ?? opts[correctIdx ?? 0] ?? '',
      grade: isCorrect ? 'Excellent' : 'Needs Improvement',
      is_correct: isCorrect,
    };
    setCurrentEval(eval_);
    await saveAttempt(q, '', selectedOption, eval_, 0);
    setOptionConfirmed(true);
    setScreen('evaluation');
  }

  // ─── Written answer evaluation ────────────────────────────────────────────
  async function handleWrittenSubmit(answer: string, timeSpent: number) {
    if (!config) return;
    const q = questions[currentIdx];
    setIsEvaluating(true);
    setScreen('evaluating');

    try {
      const token = await getAuthToken();
      const resp = await fetch(EDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          action: 'evaluate_answer',
          student_id: student!.id,
          question_id: q.question_id,
          source_table: q.source_table,
          question_text: q.question_text,
          student_answer: answer,
          marks_possible: q.marks_possible,
          question_type: q.cbse_type ?? q.question_type,
        }),
      });

      const eval_: EvaluationResult = resp.ok
        ? await resp.json()
        : { marks_awarded: 0, marks_possible: q.marks_possible, feedback: 'Evaluation failed — please check the model answer.', key_points: [], model_answer_summary: q.answer_text ?? '', grade: 'Needs Improvement', is_correct: false };

      setCurrentEval(eval_);
      await saveAttempt(q, answer, null, eval_, timeSpent);
    } catch (e) {
      console.error('evaluate_answer error:', e);
      setCurrentEval({ marks_awarded: 0, marks_possible: q.marks_possible, feedback: 'Could not evaluate — check the model answer.', key_points: [], model_answer_summary: q.answer_text ?? '', grade: 'Needs Improvement', is_correct: false });
    } finally {
      setIsEvaluating(false);
      setScreen('evaluation');
    }
  }

  // ─── Save attempt to DB ───────────────────────────────────────────────────
  async function saveAttempt(
    q: NCERTQuestion, answer: string, option: number | null,
    eval_: EvaluationResult, timeSpent: number
  ) {
    if (!config || !student) return;
    setAttempts(prev => [...prev, {
      question: q, studentAnswer: answer, selectedOption: option,
      evaluation: eval_, timeSpent,
    }]);

    const token = await getAuthToken();
    fetch(EDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        action: 'save_attempt',
        student_id: student.id,
        question_id: q.question_id,
        source_table: q.source_table,
        subject: config.subject,
        grade: config.grade,
        chapter_number: config.chapter,
        question_type: q.cbse_type ?? q.question_type,
        marks_possible: q.marks_possible,
        student_answer: answer || null,
        selected_option: option,
        marks_awarded: eval_.marks_awarded,
        is_correct: eval_.is_correct,
        ai_feedback: eval_.feedback,
        ai_key_points: eval_.key_points,
        model_answer: eval_.model_answer_summary,
        time_spent: timeSpent,
      }),
    }).catch(e => console.warn('save_attempt silent fail:', e));
  }

  // ─── Navigation ──────────────────────────────────────────────────────────
  function handleNext() {
    const next = currentIdx + 1;
    if (next >= questions.length) {
      setScreen('results');
    } else {
      setCurrentIdx(next);
      setCurrentEval(null);
      setSelectedOption(null);
      setOptionConfirmed(false);
      setScreen('quiz');
    }
  }

  function handleSkip() {
    const q = questions[currentIdx];
    const skip: EvaluationResult = { marks_awarded: 0, marks_possible: q.marks_possible, feedback: 'Skipped.', key_points: [], model_answer_summary: q.answer_text ?? '', grade: 'Needs Improvement', is_correct: false };
    setAttempts(prev => [...prev, { question: q, studentAnswer: '', selectedOption: null, evaluation: skip, timeSpent: 0 }]);
    handleNext();
  }

  // ─── Auth guard ───────────────────────────────────────────────────────────
  if (isLoading) return <div className="flex items-center justify-center min-h-screen"><LoadingFoxy /></div>;
  if (!isLoggedIn) { router.push('/login'); return null; }

  // ─── Results summary ─────────────────────────────────────────────────────
  function ResultsScreen() {
    const totalMarks    = attempts.reduce((s, a) => s + (a.evaluation?.marks_possible ?? 0), 0);
    const earnedMarks   = attempts.reduce((s, a) => s + (a.evaluation?.marks_awarded ?? 0), 0);
    const pct           = totalMarks > 0 ? Math.round((earnedMarks / totalMarks) * 100) : 0;
    const scoreFeedback = pct >= 80 ? '🏆 Outstanding!' : pct >= 60 ? '✅ Well done!' : pct >= 40 ? '📝 Keep practising.' : '💡 Review your notes.';

    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="text-center mb-6">
          <div className="text-5xl font-black mb-1" style={{ color: 'var(--text-1)' }}>{pct}%</div>
          <div className="text-lg font-bold mb-1" style={{ color: 'var(--text-2)' }}>{scoreFeedback}</div>
          <div className="text-sm" style={{ color: 'var(--text-3)' }}>
            {earnedMarks}/{totalMarks} marks · {config?.subject} Grade {config?.grade} Chapter {config?.chapter}
          </div>
        </div>

        {/* CBSE marks breakdown */}
        <div className="rounded-2xl p-4 mb-4" style={{ background: 'var(--surface-1)', border: '1.5px solid var(--border)' }}>
          <div className="text-xs font-bold mb-3" style={{ color: 'var(--text-3)' }}>MARKS BREAKDOWN</div>
          {(['mcq','short_answer','medium_answer','long_answer'] as const).map(type => {
            const typeAttempts = attempts.filter(a => a.question.cbse_type === type || a.question.question_type === type);
            if (typeAttempts.length === 0) return null;
            const typePossible = typeAttempts.reduce((s,a) => s + (a.evaluation?.marks_possible ?? 0), 0);
            const typeEarned   = typeAttempts.reduce((s,a) => s + (a.evaluation?.marks_awarded ?? 0), 0);
            const typeLabels: Record<string, string> = { mcq: '⭕ MCQ', short_answer: '✏️ Short Answer', medium_answer: '📝 Medium Answer', long_answer: '📃 Long Answer' };
            return (
              <div key={type} className="flex items-center gap-3 mb-2">
                <span className="text-sm w-32 flex-shrink-0" style={{ color: 'var(--text-2)' }}>{typeLabels[type] ?? type}</span>
                <div className="flex-1 h-2 rounded-full" style={{ background: 'var(--surface-2)' }}>
                  <div className="h-2 rounded-full" style={{ width: `${typePossible > 0 ? (typeEarned/typePossible)*100 : 0}%`, background: 'var(--brand)' }} />
                </div>
                <span className="text-xs font-bold w-12 text-right" style={{ color: 'var(--text-1)' }}>{typeEarned}/{typePossible}</span>
              </div>
            );
          })}
        </div>

        {/* Per-question summary */}
        <div className="space-y-2 mb-6">
          {attempts.map((a, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-xl"
              style={{ background: 'var(--surface-1)', border: '1.5px solid var(--border)' }}>
              <span className="text-base flex-shrink-0">
                {(a.evaluation?.marks_awarded ?? 0) >= (a.evaluation?.marks_possible ?? 1) ? '✅' :
                 (a.evaluation?.marks_awarded ?? 0) > 0 ? '🟡' : '❌'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs truncate" style={{ color: 'var(--text-2)' }}>
                  Q{i+1}: {a.question.question_text.slice(0, 60)}…
                </div>
                <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                  {a.question.cbse_label} · {a.evaluation?.marks_awarded ?? 0}/{a.question.marks_possible} marks
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button onClick={() => { setScreen('setup'); setConfig(null); }}
            className="flex-1 py-3 rounded-xl font-bold text-sm transition-all"
            style={{ background: 'var(--surface-1)', border: '1.5px solid var(--border)', color: 'var(--text-1)' }}>
            New Chapter
          </button>
          {config && student && (
            <button onClick={() => setScreen('coverage')}
              className="flex-1 py-3 rounded-xl font-bold text-sm text-white transition-all"
              style={{ background: 'var(--brand)' }}>
              Coverage Map →
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Current question ─────────────────────────────────────────────────────
  const q = questions[currentIdx];
  const isMCQ = q && (q.cbse_type === 'mcq' || q.question_type === 'mcq');

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3"
        style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => screen === 'setup' ? router.push('/quiz') : setScreen('setup')}
          className="w-8 h-8 flex items-center justify-center rounded-lg"
          style={{ background: 'var(--surface-1)', color: 'var(--text-2)' }}>
          ←
        </button>
        <div className="flex-1">
          <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
            NCERT Practice
            {config && <span style={{ color: 'var(--text-3)' }}> · {config.subject} G{config.grade} Ch.{config.chapter}</span>}
          </div>
          {screen === 'quiz' && questions.length > 0 && (
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {currentIdx + 1} / {questions.length}
            </div>
          )}
        </div>
        {screen !== 'setup' && screen !== 'results' && screen !== 'coverage' && (
          <button onClick={() => setScreen('setup')} className="text-xs px-2 py-1 rounded"
            style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
            Exit
          </button>
        )}
      </div>

      {/* ── Screens ─────────────────────────────────────────────── */}

      {screen === 'setup' && (
        <>
          {loadError && (
            <div className="mx-4 mt-3 p-3 rounded-xl text-sm" style={{ background: '#DC262608', border: '1px solid #DC262630', color: '#DC2626' }}>
              {loadError}
            </div>
          )}
          <NCERTQuizSetup onStart={handleStart} />
        </>
      )}

      {screen === 'loading' && (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <LoadingFoxy />
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading NCERT questions…</p>
        </div>
      )}

      {screen === 'quiz' && q && (
        isMCQ ? (
          /* MCQ */
          <div className="max-w-2xl mx-auto px-4 py-4">
            {/* Progress bar */}
            <div className="w-full h-1.5 rounded-full mb-4" style={{ background: 'var(--surface-2)' }}>
              <div className="h-1.5 rounded-full transition-all"
                style={{ width: `${((currentIdx) / questions.length) * 100}%`, background: 'var(--brand)' }} />
            </div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs px-2 py-0.5 rounded font-bold"
                style={{ background: '#6C5CE718', color: '#6C5CE7' }}>MCQ · 1 Mark</span>
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>Q{currentIdx+1}/{questions.length}</span>
            </div>
            <div className="p-4 rounded-2xl mb-4"
              style={{ background: 'var(--surface-1)', border: '1.5px solid var(--border)' }}>
              <p className="text-sm font-medium leading-relaxed" style={{ color: 'var(--text-1)' }}>
                {q.question_text}
              </p>
            </div>
            <div className="space-y-2 mb-4">
              {(Array.isArray(q.options) ? q.options : []).map((opt, i) => (
                <button key={i} onClick={() => !optionConfirmed && setSelectedOption(i)}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl text-left text-sm transition-all active:scale-[0.99]"
                  style={{
                    border: selectedOption === i ? '2px solid var(--brand)' : '1.5px solid var(--border)',
                    background: selectedOption === i ? 'var(--brand-soft,#E8581C10)' : 'var(--surface-1)',
                    color: 'var(--text-1)',
                  }}>
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: selectedOption === i ? 'var(--brand)' : 'var(--surface-2)', color: selectedOption === i ? '#fff' : 'var(--text-2)' }}>
                    {OPTION_LETTERS[i]}
                  </span>
                  {opt}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={handleSkip} className="px-4 py-3 rounded-xl text-sm font-medium"
                style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1.5px solid var(--border)' }}>
                Skip
              </button>
              <button onClick={handleMCQSubmit} disabled={selectedOption === null}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98]"
                style={{ background: selectedOption !== null ? 'var(--brand)' : '#999' }}>
                Submit Answer
              </button>
            </div>
          </div>
        ) : (
          /* Written question */
          <WrittenAnswerInput
            questionText={q.question_text}
            questionType={(q.cbse_type as 'short_answer' | 'medium_answer' | 'long_answer' | 'hots' | 'numerical' | 'intext') ?? 'short_answer'}
            marksP={q.marks_possible}
            wordLimit={q.word_limit}
            timeEstimate={q.time_estimate}
            onSubmit={handleWrittenSubmit}
            onSkip={handleSkip}
            questionNumber={currentIdx + 1}
            totalQuestions={questions.length}
            isEvaluating={isEvaluating}
          />
        )
      )}

      {screen === 'evaluating' && (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <div className="text-3xl animate-bounce">🤔</div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>Evaluating your answer…</p>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>CBSE marking scheme applied</p>
        </div>
      )}

      {screen === 'evaluation' && currentEval && q && (
        <NCERTEvaluation
          questionText={q.question_text}
          studentAnswer={
            isMCQ
              ? (selectedOption !== null && Array.isArray(q.options) ? `${OPTION_LETTERS[selectedOption]}. ${q.options[selectedOption]}` : '')
              : (attempts[attempts.length - 1]?.studentAnswer ?? '')
          }
          marksAwarded={currentEval.marks_awarded}
          marksPossible={currentEval.marks_possible}
          feedback={currentEval.feedback}
          keyPoints={currentEval.key_points}
          modelAnswerSummary={currentEval.model_answer_summary}
          grade={currentEval.grade}
          questionType={q.cbse_type ?? q.question_type}
          onNext={handleNext}
          isLast={currentIdx + 1 >= questions.length}
        />
      )}

      {screen === 'results' && <ResultsScreen />}

      {screen === 'coverage' && config && student && (
        <div className="max-w-2xl mx-auto px-4 py-4">
          <h2 className="text-lg font-bold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
            📊 Your NCERT Coverage
          </h2>
          <NCERTCoverageMap
            studentId={student.id}
            subject={config.subject}
            grade={config.grade}
            onChapterClick={(ch, title) => {
              setConfig(prev => prev ? { ...prev, chapter: ch, chapterTitle: title } : prev);
              handleStart({ ...config!, chapter: ch, chapterTitle: title });
            }}
          />
          <button onClick={() => setScreen('setup')} className="mt-4 w-full py-3 rounded-xl font-bold text-sm"
            style={{ background: 'var(--surface-1)', border: '1.5px solid var(--border)', color: 'var(--text-1)' }}>
            ← Back to Setup
          </button>
        </div>
      )}
    </div>
  );
}
