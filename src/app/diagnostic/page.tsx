'use client';

/**
 * /diagnostic — Diagnostic Assessment Page
 *
 * Student-facing diagnostic quiz (grades 6-10) that helps identify
 * current knowledge level before starting a subject.
 *
 * Flow:
 *   1. Setup screen  — grade (pre-filled) + subject selection
 *   2. Quiz screen   — 15 questions, one at a time, no timer
 *   3. Results screen — score, weak/strong topics, recommended difficulty, CTA
 *
 * Constraints:
 *   - P3: no anti-cheat (diagnostic is untimed, no XP awarded)
 *   - P5: grade stored/passed as string "6"-"10"
 *   - P7: bilingual (EN/HI) via isHi
 *   - P8: uses server-side auth in API routes; client only reads RLS-filtered data
 *   - P15: independent of onboarding funnel — no onboarding files modified
 */

import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { LoadingFoxy } from '@/components/ui';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';

// ─── Types ──────────────────────────────────────────────────────

interface DiagnosticQuestion {
  id: string;
  question_text: string;
  question_hi: string | null;
  question_type: string;
  options: string | string[];
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  difficulty: number;
  bloom_level: string;
  chapter_number: number | null;
  topic_id: string | null;
}

interface DiagnosticResponse {
  question_id: string;
  selected_answer_index: number;
  is_correct: boolean;
  time_taken_seconds: number;
  topic: string | null;
  difficulty: number;
  bloom_level: string;
}

interface DiagnosticSummary {
  session_id: string;
  score_percent: number;
  correct_answers: number;
  total_questions: number;
  weak_topics: string[];
  strong_topics: string[];
  recommended_difficulty: 'easy' | 'medium' | 'hard';
  rpc_failed?: boolean;
}

type DiagnosticScreen = 'setup' | 'quiz' | 'results';

// ─── Constants ──────────────────────────────────────────────────

const VALID_DIAGNOSTIC_GRADES = ['6', '7', '8', '9', '10'] as const;

const SUBJECT_OPTIONS: Record<string, { code: string; label: string; labelHi: string; icon: string }[]> = {
  '6': [
    { code: 'math', label: 'Mathematics', labelHi: 'गणित', icon: '∑' },
    { code: 'science', label: 'Science', labelHi: 'विज्ञान', icon: '⚛' },
  ],
  '7': [
    { code: 'math', label: 'Mathematics', labelHi: 'गणित', icon: '∑' },
    { code: 'science', label: 'Science', labelHi: 'विज्ञान', icon: '⚛' },
  ],
  '8': [
    { code: 'math', label: 'Mathematics', labelHi: 'गणित', icon: '∑' },
    { code: 'science', label: 'Science', labelHi: 'विज्ञान', icon: '⚛' },
  ],
  '9': [
    { code: 'math', label: 'Mathematics', labelHi: 'गणित', icon: '∑' },
    { code: 'physics', label: 'Physics', labelHi: 'भौतिकी', icon: '⚡' },
    { code: 'chemistry', label: 'Chemistry', labelHi: 'रसायन', icon: '🧪' },
    { code: 'biology', label: 'Biology', labelHi: 'जीव विज्ञान', icon: '🧬' },
  ],
  '10': [
    { code: 'math', label: 'Mathematics', labelHi: 'गणित', icon: '∑' },
    { code: 'physics', label: 'Physics', labelHi: 'भौतिकी', icon: '⚡' },
    { code: 'chemistry', label: 'Chemistry', labelHi: 'रसायन', icon: '🧪' },
    { code: 'biology', label: 'Biology', labelHi: 'जीव विज्ञान', icon: '🧬' },
  ],
};

const DIFFICULTY_LABELS: Record<string, { en: string; hi: string; color: string }> = {
  easy:   { en: 'Start with Easy questions',   hi: 'आसान प्रश्नों से शुरू करें',    color: '#16A34A' },
  medium: { en: 'Start with Medium questions',  hi: 'मध्यम प्रश्नों से शुरू करें',   color: '#D97706' },
  hard:   { en: 'Start with Hard questions',    hi: 'कठिन प्रश्नों से शुरू करें',    color: '#DC2626' },
};

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

// ─── Helper: parse options ───────────────────────────────────────

function parseOptions(opts: string | string[]): string[] {
  if (Array.isArray(opts)) return opts;
  try {
    return JSON.parse(opts);
  } catch {
    return [];
  }
}

// ─── Circular progress ring (SVG) ───────────────────────────────

function CircleProgress({ percent, size = 120, stroke = 10 }: { percent: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (percent / 100) * circ;
  const color = percent >= 70 ? '#16A34A' : percent >= 40 ? '#D97706' : '#DC2626';

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--border)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
      {/* percent text — rotated back so it reads correctly */}
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fill={color}
        fontSize={size / 4.5}
        fontWeight="700"
        style={{ transform: 'rotate(90deg)', transformOrigin: '50% 50%', fontFamily: 'var(--font-display)' }}
      >
        {percent}%
      </text>
    </svg>
  );
}

// ─── Page Component ─────────────────────────────────────────────

export default function DiagnosticPage() {
  const { student, isLoggedIn, isLoading, isHi, activeRole } = useAuth();
  const router = useRouter();

  // ── Navigation guard ──────────────────────────────────────────
  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.replace('/');
    }
    if (!isLoading && isLoggedIn && activeRole !== 'student') {
      // Diagnostic is student-only
      router.replace(activeRole === 'teacher' ? '/teacher' : '/parent');
    }
  }, [isLoading, isLoggedIn, activeRole, router]);

  // ── Shared styles ─────────────────────────────────────────────
  const inputStyle: CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 12,
    border: '1.5px solid var(--border)',
    background: 'var(--surface-2)',
    fontSize: 15,
    color: 'var(--text-1)',
    outline: 'none',
    fontFamily: 'var(--font-body)',
    appearance: 'none',
    transition: 'border-color 0.2s ease',
  };

  // ── Screen state ─────────────────────────────────────────────
  const [screen, setScreen] = useState<DiagnosticScreen>('setup');

  // ── Setup state ──────────────────────────────────────────────
  const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [setupError, setSetupError] = useState('');
  const [starting, setStarting] = useState(false);

  // ── Quiz state ───────────────────────────────────────────────
  const [sessionId, setSessionId] = useState('');
  const [questions, setQuestions] = useState<DiagnosticQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [responses, setResponses] = useState<DiagnosticResponse[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [quizError, setQuizError] = useState('');
  // Track per-question start time (no timer display, but we record time_taken_seconds)
  const questionStartRef = useRef<number>(Date.now());

  // ── Results state ─────────────────────────────────────────────
  const [summary, setSummary] = useState<DiagnosticSummary | null>(null);

  // Pre-fill grade from student profile
  useEffect(() => {
    if (student?.grade) {
      const raw = student.grade.replace(/^Grade\s*/i, '').trim();
      if (VALID_DIAGNOSTIC_GRADES.includes(raw as typeof VALID_DIAGNOSTIC_GRADES[number])) {
        setGrade(raw);
      }
    }
  }, [student]);

  // Reset subject when grade changes
  useEffect(() => {
    setSubject('');
  }, [grade]);

  // Reset question timer when question changes
  useEffect(() => {
    questionStartRef.current = Date.now();
  }, [currentIdx]);

  // ── Loading / redirect guards ─────────────────────────────────
  if (isLoading) return <LoadingFoxy />;
  if (!isLoggedIn || activeRole !== 'student') return <LoadingFoxy />;

  const subjectOptions = SUBJECT_OPTIONS[grade] ?? [];
  const currentQuestion = questions[currentIdx];
  const totalQuestions = questions.length;

  // ─── Handler: start diagnostic ────────────────────────────────

  async function handleStart() {
    if (!grade || !subject) {
      setSetupError(isHi ? 'कृपया कक्षा और विषय चुनें।' : 'Please select grade and subject.');
      return;
    }
    setSetupError('');
    setStarting(true);

    try {
      const res = await fetch('/api/diagnostic/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade, subject }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setSetupError(json.error ?? (isHi ? 'डायग्नोस्टिक शुरू नहीं हो सका। कृपया पुनः प्रयास करें।' : 'Could not start diagnostic. Please try again.'));
        setStarting(false);
        return;
      }

      setSessionId(json.data.session_id);
      setQuestions(json.data.questions);
      setCurrentIdx(0);
      setResponses([]);
      setSelectedOption(null);
      questionStartRef.current = Date.now();
      setScreen('quiz');
    } catch {
      setSetupError(isHi ? 'कनेक्शन त्रुटि। कृपया पुनः प्रयास करें।' : 'Connection error. Please try again.');
    } finally {
      setStarting(false);
    }
  }

  // ─── Handler: advance to next question ────────────────────────

  function handleNext() {
    if (selectedOption === null || !currentQuestion) return;

    const timeTaken = Math.round((Date.now() - questionStartRef.current) / 1000);
    const isCorrect = selectedOption === currentQuestion.correct_answer_index;

    const newResponse: DiagnosticResponse = {
      question_id: currentQuestion.id,
      selected_answer_index: selectedOption,
      is_correct: isCorrect,
      time_taken_seconds: timeTaken,
      topic: currentQuestion.topic_id ?? null,
      difficulty: currentQuestion.difficulty,
      bloom_level: currentQuestion.bloom_level,
    };

    const updatedResponses = [...responses, newResponse];
    setResponses(updatedResponses);
    setSelectedOption(null);

    if (currentIdx < totalQuestions - 1) {
      setCurrentIdx(currentIdx + 1);
    } else {
      // Last question — submit
      handleSubmit(updatedResponses);
    }
  }

  // ─── Handler: submit all responses ────────────────────────────

  async function handleSubmit(finalResponses: DiagnosticResponse[]) {
    setSubmitting(true);
    setQuizError('');

    try {
      const res = await fetch('/api/diagnostic/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, responses: finalResponses }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setQuizError(json.error ?? (isHi ? 'परिणाम सहेजे नहीं जा सके।' : 'Could not save results. Please try again.'));
        setSubmitting(false);
        return;
      }

      setSummary(json.data as DiagnosticSummary);
      setScreen('results');
    } catch {
      setQuizError(isHi ? 'कनेक्शन त्रुटि।' : 'Connection error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Render: Setup screen ──────────────────────────────────────

  if (screen === 'setup') {
    return (
      <div
        className="mesh-bg"
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px',
        }}
      >
        <div style={{ width: '100%', maxWidth: 420, animation: 'slideUp 0.5s ease-out' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div className="animate-float" style={{ fontSize: 44, marginBottom: 12 }}>🎯</div>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: 'var(--text-1)',
                marginBottom: 8,
                fontFamily: 'var(--font-display)',
              }}
            >
              {isHi ? 'डायग्नोस्टिक टेस्ट' : 'Diagnostic Assessment'}
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.6 }}>
              {isHi
                ? '15 प्रश्नों का टेस्ट देकर जानें आप किस स्तर पर हैं।'
                : 'Answer 15 questions to discover your current level and get personalised recommendations.'}
            </p>
          </div>

          {/* Card */}
          <div
            style={{
              borderRadius: 16,
              padding: 24,
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Grade selector */}
              <div style={{ animation: 'slideUp 0.4s ease-out 0.1s both' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text-2)',
                    marginBottom: 6,
                  }}
                >
                  {isHi ? 'कक्षा' : 'Grade'}
                </label>
                <select
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  style={inputStyle}
                  aria-label={isHi ? 'कक्षा चुनें' : 'Select grade'}
                >
                  <option value="" disabled>
                    {isHi ? 'कक्षा चुनें...' : 'Select grade...'}
                  </option>
                  {VALID_DIAGNOSTIC_GRADES.map((g) => (
                    <option key={g} value={g}>
                      {isHi ? `कक्षा ${g}` : `Grade ${g}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Subject selector — grid of buttons */}
              {grade && (
                <div style={{ animation: 'slideUp 0.4s ease-out 0.15s both' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--text-2)',
                      marginBottom: 8,
                    }}
                  >
                    {isHi ? 'विषय' : 'Subject'}
                  </label>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: subjectOptions.length <= 2 ? '1fr 1fr' : '1fr 1fr',
                      gap: 8,
                    }}
                  >
                    {subjectOptions.map((opt) => {
                      const isSelected = subject === opt.code;
                      return (
                        <button
                          key={opt.code}
                          type="button"
                          onClick={() => setSubject(opt.code)}
                          style={{
                            padding: '12px 8px',
                            borderRadius: 10,
                            textAlign: 'center',
                            border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                            background: isSelected ? 'rgba(232,88,28,0.06)' : 'var(--surface-2)',
                            cursor: 'pointer',
                            transition: 'border-color 0.15s ease, background 0.15s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 6,
                            minHeight: 44,
                          }}
                          aria-pressed={isSelected}
                        >
                          <span style={{ fontSize: 18 }}>{opt.icon}</span>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              lineHeight: 1.3,
                              color: isSelected ? 'var(--accent)' : 'var(--text-2)',
                            }}
                          >
                            {isHi ? opt.labelHi : opt.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Error */}
              {setupError && (
                <div
                  role="alert"
                  style={{
                    fontSize: 13,
                    color: 'var(--danger)',
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: 'var(--danger-light)',
                    border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)',
                    fontWeight: 600,
                  }}
                >
                  {setupError}
                </div>
              )}

              {/* Start button */}
              <button
                type="button"
                disabled={!grade || !subject || starting}
                onClick={handleStart}
                style={{
                  width: '100%',
                  padding: '14px 0',
                  borderRadius: 12,
                  background:
                    grade && subject
                      ? 'linear-gradient(135deg, #E8590C, #F59E0B)'
                      : 'var(--surface-3)',
                  color: grade && subject ? '#fff' : 'var(--text-3)',
                  border: 'none',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: grade && subject && !starting ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s ease',
                  animation: 'slideUp 0.4s ease-out 0.3s both',
                  minHeight: 44,
                }}
              >
                {starting
                  ? (isHi ? 'लोड हो रहा है...' : 'Loading...')
                  : (isHi ? 'टेस्ट शुरू करें' : 'Start Diagnostic')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Quiz screen ───────────────────────────────────────

  if (screen === 'quiz') {
    if (!currentQuestion || totalQuestions === 0) {
      return (
        <div
          className="mesh-bg"
          style={{
            minHeight: '100dvh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px 16px',
          }}
        >
          <div
            role="alert"
            style={{
              textAlign: 'center',
              padding: 24,
              borderRadius: 16,
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              maxWidth: 360,
            }}
          >
            <p style={{ fontSize: 15, color: 'var(--danger)', marginBottom: 16 }}>
              {isHi ? 'प्रश्न लोड नहीं हो सके।' : 'Questions could not be loaded.'}
            </p>
            <button
              onClick={() => setScreen('setup')}
              style={{
                padding: '10px 20px',
                borderRadius: 10,
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              {isHi ? 'वापस जाएं' : 'Go Back'}
            </button>
          </div>
        </div>
      );
    }

    const opts = parseOptions(currentQuestion.options);
    const questionText =
      isHi && currentQuestion.question_hi
        ? currentQuestion.question_hi
        : currentQuestion.question_text;
    const progressPct = Math.round(((currentIdx) / totalQuestions) * 100);

    return (
      <div
        className="mesh-bg"
        style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: '0' }}
      >
        <SectionErrorBoundary section="Diagnostic Quiz">
          {/* Header */}
          <header
            style={{
              padding: '16px 16px 0',
              maxWidth: 520,
              width: '100%',
              margin: '0 auto',
            }}
          >
            {/* Back + progress label */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <button
                onClick={() => setScreen('setup')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-3)',
                  fontSize: 20,
                  cursor: 'pointer',
                  padding: '4px 8px',
                  minHeight: 44,
                  minWidth: 44,
                  display: 'flex',
                  alignItems: 'center',
                }}
                aria-label={isHi ? 'वापस' : 'Back'}
              >
                &#8592;
              </button>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-2)',
                }}
              >
                {isHi
                  ? `प्रश्न ${currentIdx + 1} / ${totalQuestions}`
                  : `Question ${currentIdx + 1} of ${totalQuestions}`}
              </span>
              <div style={{ width: 44 }} />
            </div>

            {/* Progress bar */}
            <div
              style={{
                height: 6,
                borderRadius: 6,
                background: 'var(--surface-3)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  borderRadius: 6,
                  width: `${progressPct}%`,
                  background: 'linear-gradient(90deg, #E8590C, #F59E0B)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </header>

          {/* Main content */}
          <main
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              padding: '20px 16px 24px',
              maxWidth: 520,
              width: '100%',
              margin: '0 auto',
            }}
          >
            {/* Question card */}
            <div
              style={{
                borderRadius: 16,
                padding: '20px',
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
                boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
                marginBottom: 16,
              }}
            >
              <p
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'var(--text-1)',
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {questionText}
              </p>
            </div>

            {/* Answer options */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                marginBottom: 20,
              }}
            >
              {opts.map((opt, oi) => {
                const isSelected = selectedOption === oi;
                return (
                  <button
                    key={oi}
                    type="button"
                    onClick={() => setSelectedOption(oi)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '14px 16px',
                      borderRadius: 12,
                      border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      background: isSelected ? 'rgba(232,88,28,0.07)' : 'var(--surface-2)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'border-color 0.15s ease, background 0.15s ease',
                      minHeight: 44,
                    }}
                    aria-pressed={isSelected}
                  >
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: isSelected ? 'var(--accent)' : 'var(--surface-3)',
                        color: isSelected ? '#fff' : 'var(--text-2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 700,
                        flexShrink: 0,
                        transition: 'background 0.15s ease',
                      }}
                    >
                      {OPTION_LETTERS[oi]}
                    </span>
                    <span
                      style={{
                        fontSize: 14,
                        color: isSelected ? 'var(--accent)' : 'var(--text-1)',
                        fontWeight: isSelected ? 600 : 400,
                        lineHeight: 1.4,
                        transition: 'color 0.15s ease',
                      }}
                    >
                      {opt}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Quiz error */}
            {quizError && (
              <div
                role="alert"
                style={{
                  fontSize: 13,
                  color: 'var(--danger)',
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'var(--danger-light)',
                  border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)',
                  fontWeight: 600,
                  marginBottom: 12,
                }}
              >
                {quizError}
              </div>
            )}

            {/* Next / Submit button */}
            <button
              type="button"
              disabled={selectedOption === null || submitting}
              onClick={handleNext}
              style={{
                width: '100%',
                padding: '14px 0',
                borderRadius: 12,
                background:
                  selectedOption !== null
                    ? 'linear-gradient(135deg, #E8590C, #F59E0B)'
                    : 'var(--surface-3)',
                color: selectedOption !== null ? '#fff' : 'var(--text-3)',
                border: 'none',
                fontSize: 15,
                fontWeight: 700,
                cursor: selectedOption !== null && !submitting ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s ease',
                minHeight: 44,
              }}
            >
              {submitting
                ? (isHi ? 'जमा हो रहा है...' : 'Submitting...')
                : currentIdx < totalQuestions - 1
                  ? (isHi ? 'अगला' : 'Next')
                  : (isHi ? 'परिणाम देखें' : 'See Results')}
            </button>
          </main>
        </SectionErrorBoundary>
      </div>
    );
  }

  // ─── Render: Results screen ────────────────────────────────────

  if (screen === 'results' && summary) {
    const pct = summary.score_percent;
    const emoji = pct >= 70 ? '🏆' : pct >= 40 ? '💪' : '📚';
    const diffLabel = DIFFICULTY_LABELS[summary.recommended_difficulty] ?? DIFFICULTY_LABELS.medium;

    return (
      <div
        className="mesh-bg"
        style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: '0 16px 40px' }}
      >
        <SectionErrorBoundary section="Diagnostic Results">
          <main
            style={{
              maxWidth: 480,
              width: '100%',
              margin: '0 auto',
              paddingTop: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              animation: 'slideUp 0.5s ease-out',
            }}
          >
            {/* Title */}
            <h1
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: 'var(--text-1)',
                fontFamily: 'var(--font-display)',
                textAlign: 'center',
                margin: 0,
              }}
            >
              {isHi ? 'डायग्नोस्टिक परिणाम' : 'Diagnostic Results'}
            </h1>

            {/* Score card */}
            <div
              style={{
                borderRadius: 16,
                padding: 24,
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
                boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 8 }}>{emoji}</div>

              {/* Circular progress ring */}
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <CircleProgress percent={pct} size={120} stroke={10} />
              </div>

              <p
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: 'var(--text-1)',
                  margin: '0 0 4px',
                  fontFamily: 'var(--font-display)',
                }}
              >
                {summary.correct_answers}/{summary.total_questions}{' '}
                {isHi ? 'सही' : 'correct'}
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
                {pct >= 70
                  ? (isHi ? 'शानदार! तुम इस विषय में अच्छे हो।' : 'Great work! You have a strong foundation.')
                  : pct >= 40
                    ? (isHi ? 'ठीक है! थोड़ा अभ्यास और करो।' : 'Good start! A bit more practice will help.')
                    : (isHi ? 'चलो मिलकर बेसिक्स मजबूत करते हैं।' : "Let's build a stronger foundation together.")}
              </p>
            </div>

            {/* Recommended difficulty tag */}
            <div
              style={{
                borderRadius: 12,
                padding: '14px 16px',
                background: `${diffLabel.color}12`,
                border: `1.5px solid ${diffLabel.color}40`,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span style={{ fontSize: 20 }}>🎯</span>
              <div>
                <p
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text-3)',
                    margin: '0 0 2px',
                  }}
                >
                  {isHi ? 'सुझाव' : 'Recommendation'}
                </p>
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: diffLabel.color,
                    margin: 0,
                  }}
                >
                  {isHi ? diffLabel.hi : diffLabel.en}
                </p>
              </div>
            </div>

            {/* Weak topics */}
            {summary.weak_topics && summary.weak_topics.length > 0 && (
              <div
                style={{
                  borderRadius: 14,
                  padding: 16,
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                }}
              >
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#DC2626',
                    marginBottom: 10,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span>⚠</span>
                  {isHi ? 'सुधार की जरूरत' : 'Areas to strengthen'}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {summary.weak_topics.map((topic) => (
                    <span
                      key={topic}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '5px 10px',
                        borderRadius: 20,
                        background: 'rgba(220,38,38,0.08)',
                        color: '#DC2626',
                        border: '1px solid rgba(220,38,38,0.2)',
                      }}
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Strong topics */}
            {summary.strong_topics && summary.strong_topics.length > 0 && (
              <div
                style={{
                  borderRadius: 14,
                  padding: 16,
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                }}
              >
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#16A34A',
                    marginBottom: 10,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span>✓</span>
                  {isHi ? 'मजबूत क्षेत्र' : 'Strong areas'}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {summary.strong_topics.map((topic) => (
                    <span
                      key={topic}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '5px 10px',
                        borderRadius: 20,
                        background: 'rgba(22,163,74,0.08)',
                        color: '#16A34A',
                        border: '1px solid rgba(22,163,74,0.2)',
                      }}
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state for topics when RPC failed or returned nothing */}
            {(!summary.weak_topics || summary.weak_topics.length === 0) &&
              (!summary.strong_topics || summary.strong_topics.length === 0) && (
              <div
                style={{
                  borderRadius: 14,
                  padding: 16,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  textAlign: 'center',
                }}
              >
                <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
                  {isHi
                    ? 'विस्तृत topic विश्लेषण उपलब्ध नहीं है। कृपया अभ्यास शुरू करें।'
                    : 'Detailed topic analysis is not available. Please start practising.'}
                </p>
              </div>
            )}

            {/* CTA */}
            <button
              type="button"
              onClick={() => router.push('/quiz')}
              style={{
                width: '100%',
                padding: '15px 0',
                borderRadius: 12,
                background: 'linear-gradient(135deg, #E8590C, #F59E0B)',
                color: '#fff',
                border: 'none',
                fontSize: 16,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'opacity 0.2s ease',
                minHeight: 44,
              }}
            >
              {isHi ? 'अभ्यास शुरू करें' : 'Start Practicing'}
            </button>

            {/* Secondary: re-take */}
            <button
              type="button"
              onClick={() => {
                setScreen('setup');
                setResponses([]);
                setCurrentIdx(0);
                setSelectedOption(null);
                setQuizError('');
                setSummary(null);
              }}
              style={{
                width: '100%',
                padding: '12px 0',
                borderRadius: 12,
                background: 'none',
                color: 'var(--text-2)',
                border: '1.5px solid var(--border)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              {isHi ? 'दूसरा विषय आज़माएं' : 'Try Another Subject'}
            </button>
          </main>
        </SectionErrorBoundary>
      </div>
    );
  }

  // Fallback (should not be reached)
  return <LoadingFoxy />;
}
