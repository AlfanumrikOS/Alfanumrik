'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { Card, Button } from '@/components/ui';
import { SUBJECT_META, GRADE_SUBJECTS } from '@/lib/constants';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

/*
  CBSE 80-mark paper structure:
  Section A: 20 × 1 mark  = 20 MCQ
  Section B:  5 × 2 marks = short-answer (modelled as MCQ)
  Section C:  7 × 3 marks = short-answer
  Section D:  3 × 5 marks = long-answer
  Section E:  3 × 4 marks = case-based MCQ (reading comprehension type)
  Total: 38 questions → 80 marks
*/

interface SectionConfig {
  key: string;
  label: string;
  labelHi: string;
  count: number;
  marks: number;
}

const SECTIONS: SectionConfig[] = [
  { key: 'A', label: 'Section A', labelHi: 'खंड अ', count: 20, marks: 1 },
  { key: 'B', label: 'Section B', labelHi: 'खंड ब', count: 5,  marks: 2 },
  { key: 'C', label: 'Section C', labelHi: 'खंड स', count: 7,  marks: 3 },
  { key: 'D', label: 'Section D', labelHi: 'खंड द', count: 3,  marks: 5 },
  { key: 'E', label: 'Section E (Case-based)', labelHi: 'खंड ई (केस-आधारित)', count: 3, marks: 4 },
];

const TOTAL_MARKS = SECTIONS.reduce((s, sec) => s + sec.count * sec.marks, 0); // 80
const EXAM_DURATION_SEC = 3 * 60 * 60; // 3 hours

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
  section: string; // A/B/C/D/E
  marks: number;
}

type Screen = 'select' | 'exam' | 'confirm-submit' | 'submitted';

function parseOptions(raw: string | string[]): string[] {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

export default function MockExamPage() {
  const { student, isLoggedIn, isLoading, isHi, activeRole } = useAuth();
  const router = useRouter();

  const [screen, setScreen] = useState<Screen>('select');
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [responses, setResponses] = useState<Record<number, number>>({}); // qIdx → optionIdx
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [currentIdx, setCurrentIdx] = useState(0);
  const [timeLeft, setTimeLeft] = useState(EXAM_DURATION_SEC);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
    if (!isLoading && isLoggedIn && activeRole !== 'student') {
      router.replace(activeRole === 'teacher' ? '/teacher' : '/');
    }
  }, [isLoading, isLoggedIn, activeRole, router]);

  // Countdown timer during exam
  useEffect(() => {
    if (screen !== 'exam') return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          // Auto-submit
          router.push('/mock-exam/results?auto=1&data=' + encodeURIComponent(buildResultsParam()));
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const buildResultsParam = useCallback(() => {
    const correct = questions.reduce((acc, q, idx) => {
      return acc + (responses[idx] === q.correct_answer_index ? q.marks : 0);
    }, 0);
    const bySection: Record<string, { earned: number; total: number }> = {};
    questions.forEach((q, idx) => {
      if (!bySection[q.section]) bySection[q.section] = { earned: 0, total: 0 };
      bySection[q.section].total += q.marks;
      if (responses[idx] === q.correct_answer_index) bySection[q.section].earned += q.marks;
    });
    return JSON.stringify({ correct, total: TOTAL_MARKS, bySection, subject: selectedSubject });
  }, [questions, responses, selectedSubject]);

  const grade = student?.grade ?? '11';
  const availableSubjects = SUBJECT_META.filter(s =>
    (GRADE_SUBJECTS[grade] ?? GRADE_SUBJECTS['11']).includes(s.code)
  );

  const startExam = useCallback(async () => {
    if (!selectedSubject) return;
    setLoading(true);
    try {
      // Pull questions for each section proportionally
      const allQuestions: Question[] = [];
      for (const sec of SECTIONS) {
        const { data } = await supabase
          .from('question_bank')
          .select('id, question_text, question_hi, options, correct_answer_index, explanation, explanation_hi, difficulty, bloom_level')
          .eq('subject', selectedSubject)
          .eq('grade', grade)
          .limit(sec.count);
        if (data) {
          const secQs: Question[] = (data as any[]).map(q => ({
            ...q,
            section: sec.key,
            marks: sec.marks,
          }));
          allQuestions.push(...secQs);
        }
      }

      if (allQuestions.length === 0) {
        // Fallback: generic pull
        const { data: fallback } = await supabase
          .from('question_bank')
          .select('id, question_text, question_hi, options, correct_answer_index, explanation, explanation_hi, difficulty, bloom_level')
          .eq('subject', selectedSubject)
          .limit(38);
        if (fallback) {
          let qi = 0;
          for (const sec of SECTIONS) {
            for (let i = 0; i < sec.count && qi < fallback.length; i++, qi++) {
              allQuestions.push({ ...(fallback[qi] as any), section: sec.key, marks: sec.marks });
            }
          }
        }
      }

      setQuestions(allQuestions);
      setResponses({});
      setFlagged(new Set());
      setCurrentIdx(0);
      setTimeLeft(EXAM_DURATION_SEC);
      setScreen('exam');
    } finally {
      setLoading(false);
    }
  }, [selectedSubject, grade]);

  const handleAnswer = (optIdx: number) => {
    setResponses(r => ({ ...r, [currentIdx]: optIdx }));
  };

  const toggleFlag = () => {
    setFlagged(f => {
      const nf = new Set(f);
      if (nf.has(currentIdx)) nf.delete(currentIdx);
      else nf.add(currentIdx);
      return nf;
    });
  };

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const submitExam = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    router.push('/mock-exam/results?data=' + encodeURIComponent(buildResultsParam()));
  };

  const subjectMeta = SUBJECT_META.find(s => s.code === selectedSubject);
  const answeredCount = Object.keys(responses).length;
  const isLowTime = timeLeft <= 600;

  /* ─── Loading ─── */
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--warm-cream, #FFF9F0)' }}>
        <div className="text-4xl animate-bounce">📋</div>
      </div>
    );
  }

  /* ─── Subject Select ─── */
  if (screen === 'select') {
    return (
      <div className="min-h-screen pb-24" style={{ background: 'var(--warm-cream, #FFF9F0)' }}>
        <div className="sticky top-0 z-10 px-4 py-4 flex items-center gap-3" style={{ background: 'var(--warm-cream, #FFF9F0)', borderBottom: '1px solid var(--border)' }}>
          <button onClick={() => router.back()} className="text-xl p-1 rounded-lg hover:bg-black/5">←</button>
          <div>
            <h1 className="font-bold text-xl" style={{ color: 'var(--text-1)' }}>
              {isHi ? 'मॉक परीक्षा' : 'Mock Exam'}
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-2)' }}>
              {isHi ? `CBSE पैटर्न · 3 घंटे · ${TOTAL_MARKS} अंक` : `CBSE pattern · 3 hours · ${TOTAL_MARKS} marks`}
            </p>
          </div>
        </div>

        <div className="px-4 py-6 max-w-lg mx-auto space-y-6">
          {/* Info card */}
          <Card accent="#7C3AED">
            <h3 className="font-bold mb-3" style={{ color: 'var(--text-1)' }}>
              {isHi ? 'परीक्षा संरचना' : 'Exam Structure'}
            </h3>
            <div className="space-y-2">
              {SECTIONS.map(sec => (
                <div key={sec.key} className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-2)' }}>{isHi ? sec.labelHi : sec.label}</span>
                  <span className="font-semibold" style={{ color: 'var(--text-1)' }}>
                    {sec.count} × {sec.marks} = {sec.count * sec.marks} {isHi ? 'अंक' : 'marks'}
                  </span>
                </div>
              ))}
              <div className="pt-2 border-t flex justify-between font-bold" style={{ borderColor: 'var(--border)', color: 'var(--text-1)' }}>
                <span>{isHi ? 'कुल' : 'Total'}</span>
                <span>{TOTAL_MARKS} {isHi ? 'अंक' : 'marks'}</span>
              </div>
            </div>
          </Card>

          {/* Subject picker */}
          <div>
            <h2 className="font-semibold text-base mb-3" style={{ color: 'var(--text-1)' }}>
              {isHi ? 'विषय चुनें' : 'Choose Subject'}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {availableSubjects.map(s => (
                <button
                  key={s.code}
                  onClick={() => setSelectedSubject(s.code)}
                  className="flex items-center gap-2 p-3 rounded-2xl text-left transition-all"
                  style={{
                    background: selectedSubject === s.code ? s.color + '20' : 'var(--surface-1)',
                    border: `2px solid ${selectedSubject === s.code ? s.color : 'var(--border)'}`,
                  }}
                >
                  <span className="text-2xl" style={{ color: s.color }}>{s.icon}</span>
                  <span className="font-medium text-sm" style={{ color: 'var(--text-1)' }}>{s.name}</span>
                </button>
              ))}
            </div>
          </div>

          {selectedSubject && (
            <Button
              fullWidth
              disabled={loading}
              onClick={startExam}
              style={{ background: 'var(--purple, #7C3AED)', color: '#fff', borderRadius: '1rem' }}
            >
              {loading
                ? (isHi ? 'प्रश्न लोड हो रहे हैं…' : 'Loading questions…')
                : (isHi ? 'परीक्षा शुरू करें →' : 'Start Exam →')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  /* ─── Exam Screen ─── */
  if (screen === 'exam' && questions.length > 0) {
    const q = questions[currentIdx];
    const opts = parseOptions(q.options);
    const isFlagged = flagged.has(currentIdx);
    const userAns = responses[currentIdx];

    // Determine which section this question is in
    let sectionStart = 0;
    let currentSection: SectionConfig = SECTIONS[0];
    for (const sec of SECTIONS) {
      const end = sectionStart + sec.count;
      if (currentIdx >= sectionStart && currentIdx < end) {
        currentSection = sec;
        break;
      }
      sectionStart += sec.count;
    }

    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--warm-cream, #FFF9F0)' }}>
        {/* ─── Sticky header: timer + progress ─── */}
        <div className="sticky top-0 z-20 px-4 pt-3 pb-2" style={{ background: 'var(--warm-cream, #FFF9F0)', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
                {subjectMeta?.icon} {subjectMeta?.name}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                {isHi ? (currentSection.labelHi) : currentSection.label} · {currentSection.marks} {isHi ? 'अंक' : 'marks'}
              </p>
            </div>
            {/* Countdown Timer */}
            <div className="font-mono text-xl font-bold px-4 py-1 rounded-xl"
              style={{
                background: isLowTime ? '#FEF2F2' : 'var(--surface-1)',
                color: isLowTime ? '#DC2626' : 'var(--text-1)',
                border: `2px solid ${isLowTime ? '#DC2626' : 'var(--border)'}`,
                animation: isLowTime ? 'pulse 1s ease-in-out infinite' : undefined,
              }}>
              ⏱ {formatTime(timeLeft)}
            </div>
          </div>
          <div className="mt-2 text-xs text-right" style={{ color: 'var(--text-2)' }}>
            {answeredCount}/{questions.length} {isHi ? 'उत्तर दिए' : 'answered'}
          </div>
        </div>

        <div className="flex flex-col lg:flex-row flex-1 gap-0 overflow-hidden">
          {/* ─── Question Navigator (sidebar on desktop, collapsible on mobile) ─── */}
          <div className="lg:w-64 lg:h-screen lg:sticky lg:top-20 lg:overflow-y-auto p-3 border-b lg:border-b-0 lg:border-r overflow-x-auto"
            style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs font-semibold mb-2 hidden lg:block" style={{ color: 'var(--text-2)' }}>
              {isHi ? 'प्रश्न नेविगेटर' : 'Question Navigator'}
            </p>
            <div className="flex lg:flex-wrap gap-1.5 lg:gap-2 min-w-max lg:min-w-0">
              {questions.map((_, idx) => {
                const isAns = responses[idx] !== undefined;
                const isFlag = flagged.has(idx);
                const isCurr = idx === currentIdx;
                return (
                  <button
                    key={idx}
                    onClick={() => setCurrentIdx(idx)}
                    className="w-8 h-8 lg:w-9 lg:h-9 rounded-lg text-xs font-bold flex-shrink-0 transition-all relative"
                    style={{
                      background: isCurr ? 'var(--purple, #7C3AED)' : isAns ? '#ECFDF5' : 'var(--surface-1)',
                      color: isCurr ? '#fff' : isAns ? '#15803D' : 'var(--text-2)',
                      border: `1.5px solid ${isCurr ? 'var(--purple, #7C3AED)' : isAns ? '#16A34A' : 'var(--border)'}`,
                    }}
                  >
                    {idx + 1}
                    {isFlag && (
                      <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full text-[8px] flex items-center justify-center"
                        style={{ background: '#F97316', color: '#fff' }}>🚩</span>
                    )}
                  </button>
                );
              })}
            </div>
            {/* Legend */}
            <div className="hidden lg:flex flex-col gap-1 mt-3 text-xs" style={{ color: 'var(--text-2)' }}>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded" style={{ background: '#ECFDF5', border: '1.5px solid #16A34A' }} />
                {isHi ? 'उत्तर दिया' : 'Answered'}
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded" style={{ background: 'var(--surface-1)', border: '1.5px solid var(--border)' }} />
                {isHi ? 'अनुत्तरित' : 'Not answered'}
              </div>
              <div className="flex items-center gap-1">
                <span>🚩</span>
                {isHi ? 'समीक्षा के लिए चिह्नित' : 'Flagged for review'}
              </div>
            </div>
          </div>

          {/* ─── Question + Options ─── */}
          <div className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full overflow-y-auto pb-32">
            {/* Section badge */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-bold px-3 py-1 rounded-full"
                style={{ background: 'var(--purple, #7C3AED)', color: '#fff' }}>
                {isHi ? currentSection.labelHi : currentSection.label}
              </span>
              <span className="text-xs" style={{ color: 'var(--text-2)' }}>
                Q{currentIdx + 1} of {questions.length} · {currentSection.marks} {isHi ? 'अंक' : 'mark'}{currentSection.marks > 1 ? 's' : ''}
              </span>
            </div>

            <Card>
              <p className="font-medium text-base leading-relaxed" style={{ color: 'var(--text-1)' }}>
                {isHi && q.question_hi ? q.question_hi : q.question_text}
              </p>
            </Card>

            <div className="space-y-3 mt-4">
              {opts.map((opt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleAnswer(idx)}
                  className="w-full text-left p-4 rounded-2xl flex items-start gap-3 transition-all"
                  style={{
                    background: userAns === idx ? 'var(--purple, #7C3AED)' + '15' : 'var(--surface-1)',
                    border: `2px solid ${userAns === idx ? 'var(--purple, #7C3AED)' : 'var(--border)'}`,
                    color: 'var(--text-1)',
                  }}
                >
                  <span className="font-bold text-sm w-6 flex-shrink-0 mt-0.5"
                    style={{ color: userAns === idx ? 'var(--purple, #7C3AED)' : 'var(--text-2)' }}>
                    {OPTION_LETTERS[idx]}
                  </span>
                  <span className="text-sm leading-relaxed">{opt}</span>
                </button>
              ))}
            </div>

            {/* Navigation + Flag */}
            <div className="flex items-center justify-between mt-6 gap-3 flex-wrap">
              <Button variant="ghost" disabled={currentIdx === 0} onClick={() => setCurrentIdx(i => i - 1)} size="sm">
                ← {isHi ? 'पिछला' : 'Prev'}
              </Button>
              <button
                onClick={toggleFlag}
                className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-xl"
                style={{
                  background: isFlagged ? '#FFF3ED' : 'var(--surface-1)',
                  color: isFlagged ? '#F97316' : 'var(--text-2)',
                  border: `1px solid ${isFlagged ? '#F97316' : 'var(--border)'}`,
                }}
              >
                🚩 {isFlagged ? (isHi ? 'चिह्नित' : 'Flagged') : (isHi ? 'चिह्नित करें' : 'Flag')}
              </button>
              {currentIdx < questions.length - 1 ? (
                <Button variant="ghost" onClick={() => setCurrentIdx(i => i + 1)} size="sm">
                  {isHi ? 'अगला' : 'Next'} →
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => setScreen('confirm-submit')}
                  style={{ background: 'var(--orange, #F97316)', color: '#fff', borderRadius: '0.75rem' }}
                >
                  {isHi ? 'जमा करें' : 'Submit'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ─── Floating Submit Button ─── */}
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30">
          <button
            onClick={() => setScreen('confirm-submit')}
            className="px-6 py-3 rounded-2xl font-semibold text-sm shadow-xl"
            style={{ background: 'var(--orange, #F97316)', color: '#fff' }}
          >
            {isHi ? `जमा करें (${answeredCount}/${questions.length})` : `Submit Exam (${answeredCount}/${questions.length})`}
          </button>
        </div>
      </div>
    );
  }

  /* ─── Confirm Submit ─── */
  if (screen === 'confirm-submit') {
    const unanswered = questions.length - Object.keys(responses).length;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-6" style={{ background: 'var(--warm-cream, #FFF9F0)' }}>
        <Card className="w-full max-w-sm text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <h2 className="font-bold text-lg mb-2" style={{ color: 'var(--text-1)' }}>
            {isHi ? 'परीक्षा जमा करें?' : 'Submit Exam?'}
          </h2>
          {unanswered > 0 && (
            <p className="text-sm mb-4" style={{ color: '#DC2626' }}>
              {isHi
                ? `आपने ${unanswered} प्रश्न छोड़े हैं।`
                : `You have ${unanswered} unanswered question${unanswered > 1 ? 's' : ''}.`}
            </p>
          )}
          <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>
            {isHi ? 'एक बार जमा करने के बाद वापस नहीं जा सकते।' : 'This action cannot be undone.'}
          </p>
          <div className="flex gap-3">
            <Button fullWidth variant="ghost" onClick={() => setScreen('exam')}>
              {isHi ? 'वापस' : 'Back'}
            </Button>
            <Button fullWidth onClick={submitExam} style={{ background: 'var(--orange, #F97316)', color: '#fff', borderRadius: '0.75rem' }}>
              {isHi ? 'हाँ, जमा करें' : 'Yes, Submit'}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  /* ─── Empty State: exam started but no questions found ─── */
  if (screen === 'exam' && questions.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-5" style={{ background: 'var(--warm-cream, #FFF9F0)' }}>
        <div className="text-5xl">📭</div>
        <h2 className="font-bold text-lg text-center" style={{ color: 'var(--text-1)' }}>
          {isHi ? 'इस विषय के लिए पर्याप्त प्रश्न नहीं हैं' : 'Not enough questions for this subject yet'}
        </h2>
        <p className="text-sm text-center max-w-xs" style={{ color: 'var(--text-2)' }}>
          {isHi
            ? 'हम जल्द ही और प्रश्न जोड़ रहे हैं। कृपया कोई अन्य विषय चुनें या बाद में पुनः प्रयास करें।'
            : 'We\'re adding more questions soon. Please try another subject or check back later.'}
        </p>
        <div className="flex gap-3">
          <Button onClick={() => { setScreen('select'); setQuestions([]); }}>
            {isHi ? '← विषय बदलें' : '← Change Subject'}
          </Button>
          <Button variant="ghost" onClick={() => router.push('/quiz')}>
            {isHi ? 'प्रैक्टिस क्विज़ लो' : 'Take Practice Quiz'}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
