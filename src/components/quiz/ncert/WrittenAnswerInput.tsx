'use client';

/**
 * WrittenAnswerInput — CBSE-style answer pad for SA / MA / LA questions.
 * Shows word count, time remaining, mark scheme hint, and a "Review before submit" step.
 */

import { useState, useRef, useEffect } from 'react';

interface Props {
  questionText: string;
  questionType: 'short_answer' | 'medium_answer' | 'long_answer' | 'hots' | 'numerical' | 'intext';
  marksP: number;          // marks_possible
  wordLimit: number;       // suggested max words
  timeEstimate: number;    // seconds
  onSubmit: (answer: string, timeSpent: number) => void;
  onSkip: () => void;
  questionNumber: number;
  totalQuestions: number;
  isEvaluating: boolean;
}

const CBSE_HINTS: Record<string, string[]> = {
  short_answer:  ['Name / define the concept', 'One clear sentence', 'No examples needed'],
  medium_answer: ['Introduce the concept', 'Explain with 2–3 key points', 'Give one example or diagram hint'],
  long_answer:   ['Introduction (1–2 sentences)', 'Main points (4–5 numbered)', 'Diagram/flowchart if applicable', 'Conclusion'],
  hots:          ['Apply concept to situation', 'Justify your reasoning', 'State assumptions'],
  numerical:     ['Write formula first', 'Substitute values with units', 'Show each calculation step'],
  intext:        ['Direct answer from chapter', '1–2 sentences maximum'],
};

const TYPE_CONFIG: Record<string, { label: string; color: string; marksLabel: string }> = {
  short_answer:  { label: 'SA',   color: '#0891B2', marksLabel: '1–2 Marks' },
  medium_answer: { label: 'MA',   color: '#16A34A', marksLabel: '3–4 Marks' },
  long_answer:   { label: 'LA',   color: '#DC2626', marksLabel: '5–6 Marks' },
  hots:          { label: 'HOTS', color: '#7C3AED', marksLabel: '4–5 Marks' },
  numerical:     { label: 'NUM',  color: '#D97706', marksLabel: '2–3 Marks' },
  intext:        { label: 'ITQ',  color: '#0891B2', marksLabel: '1–3 Marks' },
};

export default function WrittenAnswerInput({
  questionText, questionType, marksP, wordLimit,
  timeEstimate, onSubmit, onSkip,
  questionNumber, totalQuestions, isEvaluating,
}: Props) {
  const [answer, setAnswer]         = useState('');
  const [timeLeft, setTimeLeft]     = useState(timeEstimate);
  const [showHints, setShowHints]   = useState(false);
  const [reviewing, setReviewing]   = useState(false);
  const startTime                   = useRef(Date.now());
  const timerRef                    = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef                 = useRef<HTMLTextAreaElement>(null);

  const wordCount = answer.trim() ? answer.trim().split(/\s+/).length : 0;
  const charCount = answer.length;
  const isOverLimit = wordLimit > 0 && wordCount > wordLimit * 1.2;
  const tConfig = TYPE_CONFIG[questionType] ?? TYPE_CONFIG.short_answer;
  const hints = CBSE_HINTS[questionType] ?? CBSE_HINTS.short_answer;

  useEffect(() => {
    textareaRef.current?.focus();
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, []);

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function handleSubmit() {
    clearInterval(timerRef.current!);
    const spent = Math.round((Date.now() - startTime.current) / 1000);
    onSubmit(answer.trim(), spent);
  }

  const timePercent = (timeLeft / timeEstimate) * 100;
  const timerColor = timePercent > 50 ? '#16A34A' : timePercent > 20 ? '#D97706' : '#DC2626';

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      {/* Progress header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold px-2 py-0.5 rounded"
            style={{ background: `${tConfig.color}18`, color: tConfig.color }}>
            {tConfig.label} · {marksP} Mark{marksP > 1 ? 's' : ''}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
            Q{questionNumber}/{totalQuestions}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full" style={{ background: timerColor }} />
          <span className="text-sm font-mono font-bold" style={{ color: timerColor }}>
            {formatTime(timeLeft)}
          </span>
        </div>
      </div>

      {/* Timer bar */}
      <div className="w-full h-1 rounded-full mb-4" style={{ background: 'var(--surface-2)' }}>
        <div className="h-1 rounded-full transition-all duration-1000"
          style={{ width: `${timePercent}%`, background: timerColor }} />
      </div>

      {/* Question */}
      <div className="p-4 rounded-2xl mb-4"
        style={{ background: 'var(--surface-1)', border: '1.5px solid var(--border)' }}>
        <p className="text-sm leading-relaxed font-medium" style={{ color: 'var(--text-1)' }}>
          {questionText}
        </p>
        <div className="flex items-center gap-3 mt-2">
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
            [{marksP} mark{marksP > 1 ? 's' : ''}]
          </span>
          {wordLimit > 0 && (
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              ~{wordLimit} words
            </span>
          )}
        </div>
      </div>

      {/* Hints toggle */}
      <button onClick={() => setShowHints(h => !h)}
        className="flex items-center gap-1.5 text-xs mb-3 transition-opacity"
        style={{ color: 'var(--brand)', opacity: showHints ? 1 : 0.7 }}>
        <span>{showHints ? '▾' : '▸'}</span>
        CBSE Writing Guide for {tConfig.label}
      </button>
      {showHints && (
        <div className="mb-3 p-3 rounded-xl text-xs"
          style={{ background: `${tConfig.color}0A`, border: `1px solid ${tConfig.color}30` }}>
          <div className="font-semibold mb-1" style={{ color: tConfig.color }}>Key points to include:</div>
          <ol className="list-decimal list-inside space-y-0.5" style={{ color: 'var(--text-2)' }}>
            {hints.map((h, i) => <li key={i}>{h}</li>)}
          </ol>
        </div>
      )}

      {/* Answer area */}
      {!reviewing ? (
        <>
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              placeholder={`Write your answer here…\n(${marksP} mark${marksP > 1 ? 's' : ''} · ~${wordLimit} words)`}
              className="w-full rounded-2xl px-4 py-3 text-sm leading-relaxed resize-none outline-none transition-all"
              rows={questionType === 'long_answer' ? 10 : questionType === 'medium_answer' ? 7 : 4}
              style={{
                background: 'var(--surface-1)',
                border: `1.5px solid ${isOverLimit ? '#DC2626' : 'var(--border)'}`,
                color: 'var(--text-1)',
                fontFamily: 'var(--font-body)',
              }}
            />
            {/* Word / char count */}
            <div className="absolute bottom-2.5 right-3 flex items-center gap-2 text-[10px]"
              style={{ color: isOverLimit ? '#DC2626' : 'var(--text-3)' }}>
              <span>{wordCount} words</span>
              {wordLimit > 0 && <span>/ {wordLimit} suggested</span>}
            </div>
          </div>

          <div className="flex gap-3 mt-4">
            <button onClick={onSkip} className="px-4 py-3 rounded-xl text-sm font-medium transition-all"
              style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1.5px solid var(--border)' }}>
              Skip
            </button>
            <button
              onClick={() => answer.trim().length > 0 ? setReviewing(true) : handleSubmit()}
              className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98]"
              style={{ background: answer.trim() ? 'var(--brand)' : '#999' }}
              disabled={isEvaluating}>
              {answer.trim() ? 'Review Answer →' : 'Submit Empty'}
            </button>
          </div>
        </>
      ) : (
        /* Review screen before final submit */
        <div>
          <div className="p-3 mb-4 rounded-xl text-sm"
            style={{ background: 'var(--surface-1)', border: '1.5px solid var(--border)', color: 'var(--text-1)' }}>
            <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-3)' }}>YOUR ANSWER</div>
            <p className="leading-relaxed whitespace-pre-wrap">{answer}</p>
            <div className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
              {wordCount} words · {charCount} characters
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setReviewing(false)}
              className="px-4 py-3 rounded-xl text-sm font-medium transition-all"
              style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1.5px solid var(--border)' }}>
              ← Edit
            </button>
            <button onClick={handleSubmit}
              className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, var(--brand), #ff7043)' }}
              disabled={isEvaluating}>
              {isEvaluating ? 'Evaluating…' : 'Submit for Evaluation →'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
