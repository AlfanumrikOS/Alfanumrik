'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { Card, Button, ProgressBar } from '@/components/ui';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import { useSubjectLookup } from '@/lib/useSubjectLookup';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];
const PYQ_YEARS = Array.from({ length: 11 }, (_, i) => 2025 - i); // 2025 down to 2015

interface Question {
  id: string;
  question_text: string;
  question_hi: string | null;
  options: string | string[];
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  difficulty: number;
  bloom_level: string;
  tags?: string[] | null;
}

type Screen = 'select' | 'quiz' | 'done';

function parseOptions(raw: string | string[]): string[] {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

export default function PYQPage() {
  const { student, isLoggedIn, isLoading, isHi, activeRole } = useAuth();
  const router = useRouter();

  const [screen, setScreen] = useState<Screen>('select');
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [answered, setAnswered] = useState<boolean[]>([]);
  const [loading, setLoading] = useState(false);
  const [noQuestions, setNoQuestions] = useState(false);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
    if (!isLoading && isLoggedIn && activeRole !== 'student') {
      router.replace(activeRole === 'teacher' ? '/teacher' : activeRole === 'guardian' ? '/parent' : '/');
    }
  }, [isLoading, isLoggedIn, activeRole, router]);

  const grade = student?.grade ?? '9';
  // Source of truth: /api/student/subjects → get_available_subjects RPC.
  // Intersects grade ∩ plan ∩ stream server-side. PYQ practice only exposes
  // subjects the student can actually drill.
  const { unlocked: availableSubjects, isLoading: subjectsLoading } = useAllowedSubjects();
  const lookupSubject = useSubjectLookup();

  const startPractice = useCallback(async () => {
    if (!selectedSubject || !selectedYear) return;
    setLoading(true);
    setNoQuestions(false);
    try {
      // Try to fetch year-tagged questions first
      const { data: taggedData } = await supabase
        .from('question_bank')
        .select('id, question_text, question_hi, options, correct_answer_index, explanation, explanation_hi, difficulty, bloom_level, tags')
        .eq('subject', selectedSubject)
        .eq('grade', grade)
        .contains('tags', [String(selectedYear)])
        .limit(30);

      if (taggedData && taggedData.length > 0) {
        setQuestions(taggedData as Question[]);
        setAnswered(new Array(taggedData.length).fill(false));
      } else {
        // Fallback: sample from question_bank for this subject
        const { data: fallbackData } = await supabase
          .from('question_bank')
          .select('id, question_text, question_hi, options, correct_answer_index, explanation, explanation_hi, difficulty, bloom_level, tags')
          .eq('subject', selectedSubject)
          .eq('grade', grade)
          .limit(25);

        if (fallbackData && fallbackData.length > 0) {
          setQuestions(fallbackData as Question[]);
          setAnswered(new Array(fallbackData.length).fill(false));
          setNoQuestions(true); // Flag: no year-specific questions
        } else {
          setQuestions([]);
          setNoQuestions(true);
        }
      }
      setCurrentIdx(0);
      setCorrectCount(0);
      setSelectedOption(null);
      setShowExplanation(false);
      setScreen('quiz');
    } catch {
      setNoQuestions(true);
      setScreen('quiz');
    } finally {
      setLoading(false);
    }
  }, [selectedSubject, selectedYear, grade]);

  const handleAnswer = (idx: number) => {
    if (showExplanation) return;
    setSelectedOption(idx);
    setShowExplanation(true);
    const q = questions[currentIdx];
    if (idx === q.correct_answer_index) {
      setCorrectCount(c => c + 1);
    }
    const newAnswered = [...answered];
    newAnswered[currentIdx] = true;
    setAnswered(newAnswered);
  };

  const goNext = () => {
    if (currentIdx + 1 >= questions.length) {
      setScreen('done');
      return;
    }
    setCurrentIdx(i => i + 1);
    setSelectedOption(null);
    setShowExplanation(false);
  };

  const restart = () => {
    setScreen('select');
    setSelectedSubject(null);
    setSelectedYear(null);
    setQuestions([]);
    setAnswered([]);
    setCorrectCount(0);
    setNoQuestions(false);
  };

  const subjectMeta = selectedSubject ? lookupSubject(selectedSubject) : null;

  /* ─── Loading ─── */
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--warm-cream, #FFF9F0)' }}>
        <div className="text-center">
          <div className="text-4xl mb-3 animate-bounce">📚</div>
          <p style={{ color: 'var(--text-2)' }}>{isHi ? 'लोड हो रहा है…' : 'Loading…'}</p>
        </div>
      </div>
    );
  }

  /* ─── Select Screen ─── */
  if (screen === 'select') {
    return (
      <div className="min-h-screen pb-24" style={{ background: 'var(--warm-cream, #FFF9F0)' }}>
        {/* Header */}
        <div className="sticky top-0 z-10 px-4 py-4 flex items-center gap-3" style={{ background: 'var(--warm-cream, #FFF9F0)', borderBottom: '1px solid var(--border)' }}>
          <button onClick={() => router.back()} className="text-xl p-1 rounded-lg hover:bg-black/5" aria-label="Go back">←</button>
          <div>
            <h1 className="font-bold text-xl" style={{ color: 'var(--text-1)' }}>
              {isHi ? 'पिछले साल के प्रश्न' : 'PYQ Practice'}
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>
              {isHi ? 'CBSE बोर्ड प्रश्नपत्र अभ्यास' : 'CBSE Board Paper Practice'}
            </p>
          </div>
        </div>

        <div className="px-4 py-6 max-w-lg mx-auto space-y-8">
          {/* Subject Picker */}
          <div>
            <h2 className="font-semibold text-base mb-3" style={{ color: 'var(--text-1)' }}>
              {isHi ? '1. विषय चुनें' : '1. Choose Subject'}
            </h2>
            {subjectsLoading && availableSubjects.length === 0 ? (
              <div className="text-center py-8 text-sm" style={{ color: 'var(--text-2)' }}>
                {isHi ? 'विषय लोड हो रहे हैं…' : 'Loading subjects…'}
              </div>
            ) : availableSubjects.length === 0 ? (
              <div className="text-center py-8 text-sm" style={{ color: 'var(--text-2)' }}>
                {isHi
                  ? 'आपकी कक्षा और योजना के लिए कोई विषय उपलब्ध नहीं है।'
                  : 'No subjects available for your grade and plan.'}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {availableSubjects.map(s => (
                  <button
                    key={s.code}
                    onClick={() => setSelectedSubject(s.code)}
                    className="flex items-center gap-2 p-3 rounded-2xl text-left transition-all"
                    style={{
                      background: selectedSubject === s.code ? s.color + '20' : 'var(--surface-1)',
                      border: `2px solid ${selectedSubject === s.code ? s.color : 'var(--border)'}`,
                      color: 'var(--text-1)',
                    }}
                  >
                    <span className="text-2xl" style={{ color: s.color }}>{s.icon}</span>
                    <span className="font-medium text-sm">
                      {isHi ? s.nameHi || s.name : s.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Year Picker */}
          {selectedSubject && (
            <div>
              <h2 className="font-semibold text-base mb-3" style={{ color: 'var(--text-1)' }}>
                {isHi ? '2. वर्ष चुनें' : '2. Choose Year'}
              </h2>
              <div className="flex flex-wrap gap-2">
                {PYQ_YEARS.map(yr => (
                  <button
                    key={yr}
                    onClick={() => setSelectedYear(yr)}
                    className="px-4 py-2 rounded-xl font-semibold text-sm transition-all"
                    style={{
                      background: selectedYear === yr ? 'var(--orange, #F97316)' : 'var(--surface-1)',
                      color: selectedYear === yr ? '#fff' : 'var(--text-1)',
                      border: `1px solid ${selectedYear === yr ? 'var(--orange, #F97316)' : 'var(--border)'}`,
                    }}
                  >
                    {yr}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Start Button */}
          {selectedSubject && selectedYear && (
            <Button
              fullWidth
              disabled={loading}
              onClick={startPractice}
              style={{ background: 'var(--orange, #F97316)', color: '#fff', borderRadius: '1rem' }}
            >
              {loading
                ? (isHi ? 'लोड हो रहा है…' : 'Loading questions…')
                : (isHi ? 'अभ्यास शुरू करें →' : 'Start Practice →')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  /* ─── No Questions / Fallback ─── */
  if (screen === 'quiz' && (questions.length === 0)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-6" style={{ background: 'var(--warm-cream, #FFF9F0)' }}>
        <div className="text-6xl">📄</div>
        <h2 className="font-bold text-xl" style={{ color: 'var(--text-1)' }}>
          {isHi ? 'PYQ प्रश्न जोड़े जा रहे हैं' : 'PYQ papers being added'}
        </h2>
        <p style={{ color: 'var(--text-2)' }}>
          {isHi
            ? 'इस विषय के लिए पिछले साल के प्रश्न जल्द उपलब्ध होंगे।'
            : 'Previous year questions for this subject are coming soon.'}
        </p>
        <Button onClick={() => router.push('/quiz?subject=' + (selectedSubject ?? ''))} style={{ background: 'var(--orange, #F97316)', color: '#fff', borderRadius: '1rem' }}>
          {isHi ? 'प्रश्न बैंक से अभ्यास करें' : 'Practice from Question Bank'}
        </Button>
        <button onClick={restart} className="text-sm underline" style={{ color: 'var(--text-2)' }}>
          {isHi ? 'वापस जाएं' : 'Go back'}
        </button>
      </div>
    );
  }

  /* ─── Quiz Screen ─── */
  if (screen === 'quiz' && questions.length > 0) {
    const q = questions[currentIdx];
    const opts = parseOptions(q.options);
    const progress = ((currentIdx) / questions.length) * 100;
    const isAnswered = showExplanation;
    const isCorrect = selectedOption === q.correct_answer_index;

    return (
      <div className="min-h-screen pb-28" style={{ background: 'var(--warm-cream, #FFF9F0)' }}>
        {/* Header */}
        <div className="sticky top-0 z-10 px-4 pt-4 pb-3" style={{ background: 'var(--warm-cream, #FFF9F0)', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-2">
            <button onClick={restart} className="text-sm px-3 py-1 rounded-lg" style={{ color: 'var(--text-2)', background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              {isHi ? '← वापस' : '← Back'}
            </button>
            <div className="text-center">
              <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                {subjectMeta?.icon} {isHi ? subjectMeta?.nameHi || subjectMeta?.name : subjectMeta?.name} · {selectedYear}
                {noQuestions && <span className="ml-2 text-xs px-2 py-0.5 rounded-full" style={{ background: '#FFF3CD', color: '#856404' }}>
                  {isHi ? 'प्रश्न बैंक से' : 'From question bank'}
                </span>}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                {currentIdx + 1}/{questions.length}
              </p>
            </div>
            <div className="text-sm font-bold" style={{ color: 'var(--orange, #F97316)' }}>
              {correctCount} ✓
            </div>
          </div>
          <ProgressBar value={progress} />
        </div>

        {/* Fallback Banner */}
        {noQuestions && (
          <div className="mx-4 mt-4 px-4 py-3 rounded-xl text-sm" style={{ background: '#FFF8E6', border: '1px solid #F5C842', color: '#6D5300' }}>
            📄 {isHi
              ? `${selectedYear} के PYQ प्रश्न जल्द आ रहे हैं — अभी प्रश्न बैंक से अभ्यास करें।`
              : `${selectedYear} PYQ papers being added — practising from question bank for now.`}
            {' '}<a href="/quiz" className="underline font-semibold">
              {isHi ? 'क्विज़ पर जाएं' : 'Go to Quiz'}
            </a>
          </div>
        )}

        {/* Question */}
        <div className="px-4 pt-5 max-w-lg mx-auto space-y-4">
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: 'var(--purple, #7C3AED)' + '15', color: 'var(--purple, #7C3AED)' }}>
                Q{currentIdx + 1}
              </span>
              <span className="text-xs" style={{ color: 'var(--text-2)' }}>
                1 {isHi ? 'अंक' : 'mark'}
              </span>
            </div>
            <p className="font-medium text-base leading-relaxed" style={{ color: 'var(--text-1)' }}>
              {isHi && q.question_hi ? q.question_hi : q.question_text}
            </p>
          </Card>

          {/* Options */}
          <div className="space-y-3">
            {opts.map((opt, idx) => {
              let bg = 'var(--surface-1)';
              let border = 'var(--border)';
              let textColor = 'var(--text-1)';

              if (isAnswered) {
                if (idx === q.correct_answer_index) {
                  bg = '#ECFDF5'; border = '#16A34A'; textColor = '#15803D';
                } else if (idx === selectedOption) {
                  bg = '#FEF2F2'; border = '#DC2626'; textColor = '#B91C1C';
                }
              } else if (selectedOption === idx) {
                bg = 'var(--orange, #F97316)' + '10';
                border = 'var(--orange, #F97316)';
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleAnswer(idx)}
                  disabled={isAnswered}
                  className="w-full text-left p-4 rounded-2xl flex items-start gap-3 transition-all"
                  style={{ background: bg, border: `2px solid ${border}`, color: textColor }}
                >
                  <span className="font-bold text-sm w-6 flex-shrink-0 mt-0.5"
                    style={{ color: isAnswered && idx === q.correct_answer_index ? '#16A34A' : isAnswered && idx === selectedOption ? '#DC2626' : 'var(--text-2)' }}>
                    {OPTION_LETTERS[idx]}
                  </span>
                  <span className="text-sm leading-relaxed">{opt}</span>
                  {isAnswered && idx === q.correct_answer_index && (
                    <span className="ml-auto text-green-600 font-bold flex-shrink-0">✓</span>
                  )}
                  {isAnswered && idx === selectedOption && idx !== q.correct_answer_index && (
                    <span className="ml-auto text-red-600 font-bold flex-shrink-0">✗</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Explanation + Marking Scheme */}
          {isAnswered && (
            <Card className="mt-4" accent={isCorrect ? '#16A34A' : '#DC2626'}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">{isCorrect ? '🎉' : '📖'}</span>
                <span className="font-bold" style={{ color: isCorrect ? '#16A34A' : '#DC2626' }}>
                  {isCorrect
                    ? (isHi ? 'सही!' : 'Correct!')
                    : (isHi ? 'गलत' : 'Incorrect')}
                </span>
              </div>

              {/* Marking Scheme */}
              <div className="mb-3 px-3 py-2 rounded-xl text-sm" style={{ background: isCorrect ? '#F0FDF4' : '#FEF2F2', color: isCorrect ? '#15803D' : '#B91C1C' }}>
                <span className="font-semibold">{isHi ? 'अंक योजना: ' : 'Marking Scheme: '}</span>
                {isHi
                  ? (isCorrect ? '+1 अंक (सही उत्तर)' : '0 अंक — कोई नकारात्मक अंकन नहीं')
                  : (isCorrect ? '+1 mark (correct answer)' : '0 marks — no negative marking')}
              </div>

              {(q.explanation || q.explanation_hi) && (
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>
                  <span className="font-semibold">{isHi ? 'व्याख्या: ' : 'Explanation: '}</span>
                  {isHi && q.explanation_hi ? q.explanation_hi : q.explanation}
                </p>
              )}
            </Card>
          )}

          {/* Next Button */}
          {isAnswered && (
            <Button fullWidth onClick={goNext} style={{ background: 'var(--orange, #F97316)', color: '#fff', borderRadius: '1rem' }}>
              {currentIdx + 1 >= questions.length
                ? (isHi ? 'परिणाम देखें →' : 'See Results →')
                : (isHi ? 'अगला प्रश्न →' : 'Next Question →')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  /* ─── Done Screen ─── */
  if (screen === 'done') {
    const pct = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
    const grade_emoji = pct >= 80 ? '🌟' : pct >= 60 ? '👍' : '📚';
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-6" style={{ background: 'var(--warm-cream, #FFF9F0)' }}>
        <div className="text-6xl animate-bounce">{grade_emoji}</div>
        <h2 className="font-bold text-2xl text-center" style={{ color: 'var(--text-1)' }}>
          {isHi ? 'सत्र पूरा!' : 'Session Complete!'}
        </h2>

        <Card className="w-full max-w-sm text-center">
          <p className="text-4xl font-black mb-1" style={{ color: 'var(--orange, #F97316)' }}>{pct}%</p>
          <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>
            {correctCount}/{questions.length} {isHi ? 'सही' : 'correct'}
          </p>
          <ProgressBar value={pct} />
          <div className="mt-4 text-sm" style={{ color: 'var(--text-2)' }}>
            {isHi ? subjectMeta?.nameHi || subjectMeta?.name : subjectMeta?.name} · {selectedYear}
            {noQuestions && ` (${isHi ? 'प्रश्न बैंक' : 'Question Bank'})`}
          </div>
        </Card>

        <div className="flex flex-col gap-3 w-full max-w-sm">
          <Button fullWidth onClick={startPractice} style={{ background: 'var(--orange, #F97316)', color: '#fff', borderRadius: '1rem' }}>
            {isHi ? 'फिर से कोशिश करें' : 'Try Again'}
          </Button>
          <Button fullWidth variant="ghost" onClick={restart}>
            {isHi ? 'दूसरा वर्ष/विषय' : 'Different Year / Subject'}
          </Button>
          <Button fullWidth variant="ghost" onClick={() => router.push('/dashboard')}>
            {isHi ? 'डैशबोर्ड' : 'Dashboard'}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
