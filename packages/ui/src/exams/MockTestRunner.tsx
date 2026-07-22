'use client';

/**
 * MockTestRunner — one-question-at-a-time mock test player (view layer).
 *
 * State machine lives in `./useMockTestState`. This file is the view only:
 *   - sticky header with paper code + countdown timer
 *   - question card (marks, mark-for-review, options)
 *   - prev / skip / next / submit nav row
 *   - palette grid color-coded by status
 *
 * P6 — mcq_single renders 4 radios; mcq_multi renders 4 checkboxes (stub
 *      until scoring lands in PR-6).
 * P7 — bilingual via isHi prop. Numerals stay Arabic; timer is MM:SS.
 */

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import MathRenderer from '@alfanumrik/ui/math/MathRenderer';
import type { MockTestPaper, MockTestQuestion, ResponseEntry } from './mock-test-types';
import { deriveStatus, useMockTestState } from './useMockTestState';

// Re-export so existing consumers can keep `import { MockTestPaper } from '@alfanumrik/ui/exams/MockTestRunner'`.
export type { MockTestPaper, MockTestQuestion } from './mock-test-types';

const STATUS_COLORS = {
  unattempted: { bg: 'var(--surface-2)',      fg: 'var(--text-3)', ring: 'var(--border)' },
  attempted:   { bg: 'rgba(22,163,74,0.12)',  fg: '#16A34A',       ring: 'rgba(22,163,74,0.4)' },
  marked:      { bg: 'rgba(124,58,237,0.12)', fg: '#7C3AED',       ring: 'rgba(124,58,237,0.4)' },
  skipped:     { bg: 'rgba(245,158,11,0.12)', fg: '#B45309',       ring: 'rgba(245,158,11,0.4)' },
} as const;

const PRIMARY_CLS = 'rounded-xl px-5 py-2 text-sm font-bold';
const PRIMARY_STYLE = { background: 'linear-gradient(135deg, var(--orange), var(--orange-light, #FB923C))', color: '#fff' };
const NAV_CLS = 'rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40';
const NAV_STYLE = { background: 'var(--surface-2)', border: '1px solid var(--border)' };
const CARD_STYLE = { background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' };

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

function SubmittedScreen({ isHi }: { isHi: boolean }) {
  return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center p-6">
      <div className="rounded-2xl p-6 max-w-md w-full text-center space-y-4" style={CARD_STYLE} data-testid="mock-test-submitted">
        <div className="text-5xl">📨</div>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? 'सबमिशन प्राप्त' : 'Submission received'}
        </h2>
        <p className="text-sm text-[var(--text-3)]">
          {isHi ? 'परिणाम तैयार हो रहे हैं…' : 'Preparing your results…'}
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Link href="/exams/mock" className={`${PRIMARY_CLS} inline-flex justify-center`} style={PRIMARY_STYLE}>
            {isHi ? 'अन्य पेपर देखें' : 'Browse other papers'}
          </Link>
          <Link href="/dashboard" className="rounded-xl px-4 py-2.5 text-sm font-semibold inline-flex justify-center" style={NAV_STYLE}>
            {isHi ? 'डैशबोर्ड' : 'Dashboard'}
          </Link>
        </div>
      </div>
    </div>
  );
}

function SubmitErrorBanner({
  errorKey,
  isSubmitting,
  isHi,
  onRetry,
}: {
  errorKey: string;
  isSubmitting: boolean;
  isHi: boolean;
  onRetry: () => void;
}) {
  // P13: keep the copy generic — never include response data or server body.
  const isNetwork = errorKey === 'network_error';
  const msg = isHi
    ? isNetwork
      ? 'नेटवर्क समस्या। आपके उत्तर सुरक्षित हैं।'
      : 'सबमिट करने में समस्या। आपके उत्तर सुरक्षित हैं।'
    : isNetwork
      ? 'Network issue. Your responses are saved locally.'
      : 'Submission failed. Your responses are saved locally.';
  return (
    <div
      role="alert"
      data-testid="mock-test-submit-error"
      className="rounded-2xl p-4 flex items-start gap-3"
      style={{
        background: 'rgba(220,38,38,0.08)',
        border: '1px solid rgba(220,38,38,0.3)',
      }}
    >
      <span aria-hidden="true" className="text-lg">⚠️</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: '#DC2626' }}>{msg}</p>
        <button
          type="button"
          onClick={onRetry}
          disabled={isSubmitting}
          data-testid="mock-test-submit-retry"
          className="mt-2 text-xs font-bold underline disabled:opacity-50"
          style={{ color: '#DC2626' }}
        >
          {isSubmitting ? (isHi ? 'भेज रहे हैं…' : 'Submitting…') : (isHi ? 'पुनः प्रयास करें' : 'Retry')}
        </button>
      </div>
    </div>
  );
}

function QuestionPalette({
  questions, responses, cursor, isHi, onNavigate,
}: {
  questions: MockTestQuestion[];
  responses: ResponseEntry[];
  cursor: number;
  isHi: boolean;
  onNavigate: (i: number) => void;
}) {
  const counts = useMemo(() => {
    const acc = { attempted: 0, marked: 0, skipped: 0, unattempted: 0 };
    responses.forEach(r => { acc[deriveStatus(r)] += 1; });
    return acc;
  }, [responses]);

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between text-xs text-[var(--text-3)]">
        <span className="font-bold uppercase tracking-wider">{isHi ? 'प्रश्न सूची' : 'Palette'}</span>
        <span>
          {counts.attempted} {isHi ? 'किए' : 'done'} · {counts.marked} {isHi ? 'चिह्नित' : 'marked'} · {counts.unattempted + counts.skipped} {isHi ? 'शेष' : 'left'}
        </span>
      </div>
      <div className="grid grid-cols-8 sm:grid-cols-10 gap-2">
        {questions.map((q, i) => {
          const status = deriveStatus(responses[i] ?? { selectedIndex: null, marked: false, visited: false });
          const c = STATUS_COLORS[status];
          const active = i === cursor;
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => onNavigate(i)}
              aria-label={`${isHi ? 'प्रश्न' : 'Question'} ${q.question_number}: ${status}`}
              aria-current={active ? 'true' : undefined}
              className="aspect-square rounded-lg text-xs font-bold flex items-center justify-center"
              style={{ background: c.bg, color: c.fg, border: `1.5px solid ${active ? 'var(--orange)' : c.ring}` }}
            >
              {q.question_number}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  paper: MockTestPaper;
  questions: MockTestQuestion[];
  isHi: boolean;
  /** cbse_board dynamic-attempt flow only — see useMockTestState. */
  attemptId?: string;
}

export default function MockTestRunner({ paper, questions, isHi, attemptId }: Props) {
  const router = useRouter();
  const onNavigate = useCallback((path: string) => { router.push(path); }, [router]);
  const s = useMockTestState(paper, questions, { onNavigate, attemptId });

  if (s.submitted) return <SubmittedScreen isHi={isHi} />;

  const current = questions[s.cursor];
  if (!current) {
    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center p-6">
        <p className="text-sm text-[var(--text-3)]">
          {isHi ? 'इस पेपर में कोई प्रश्न नहीं है।' : 'No questions found in this paper.'}
        </p>
      </div>
    );
  }

  const r = s.responses[s.cursor];
  const questionText = isHi && current.question_hi ? current.question_hi : current.question_text;
  const isMulti = current.question_type === 'mcq_multi';
  const lowTime = s.remaining < 60;
  const isLast = s.cursor === questions.length - 1;

  return (
    <div className="mesh-bg min-h-dvh pb-32">
      <header className="page-header sticky top-0 z-30" style={{ background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}>
        <div className="app-container py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wider font-bold">{paper.paper_code}</p>
            <p className="text-xs text-[var(--text-2)] font-semibold truncate">
              {isHi ? 'प्रश्न' : 'Question'} {current.question_number}/{questions.length}
            </p>
          </div>
          <div
            className="rounded-xl px-3 py-1.5 font-mono font-bold text-base tabular-nums"
            data-testid="mock-test-timer"
            aria-label={isHi ? 'शेष समय' : 'Time remaining'}
            style={{
              background: lowTime ? 'rgba(220,38,38,0.12)' : 'var(--surface-2)',
              color: lowTime ? '#DC2626' : 'var(--text-1)',
              border: `1px solid ${lowTime ? 'rgba(220,38,38,0.3)' : 'var(--border)'}`,
            }}
          >
            ⏱ {formatTime(s.remaining)}
          </div>
        </div>
      </header>

      <main className="app-container py-5 space-y-4">
        <div className="rounded-2xl p-5 space-y-4" style={CARD_STYLE}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-xs">
              {current.section && (
                <span
                  className="rounded-full px-2.5 py-0.5 font-bold"
                  style={{ background: 'var(--purple, #7C3AED)', color: '#fff' }}
                  data-testid="mock-test-section-badge"
                >
                  {isHi ? `खंड ${current.section}` : `Section ${current.section}`}
                </span>
              )}
              <span className="rounded-md px-2 py-0.5 font-bold" style={{ background: 'rgba(22,163,74,0.12)', color: '#16A34A' }}>+{current.marks_correct}</span>
              {/* CBSE-board dynamic questions carry no negative marking; hide the −0 chip to avoid confusing students. */}
              {!(current.section && current.marks_wrong === 0) && (
                <span className="rounded-md px-2 py-0.5 font-bold" style={{ background: 'rgba(220,38,38,0.10)', color: '#DC2626' }}>−{Math.abs(current.marks_wrong)}</span>
              )}
              {current.chapter_title && <span className="text-[var(--text-3)] truncate">· {current.chapter_title}</span>}
            </div>
            <button
              type="button"
              onClick={s.toggleMarked}
              data-testid="mock-test-mark"
              className="text-xs font-semibold rounded-lg px-2.5 py-1"
              style={{
                background: r?.marked ? 'rgba(124,58,237,0.12)' : 'var(--surface-2)',
                color: r?.marked ? '#7C3AED' : 'var(--text-3)',
                border: `1px solid ${r?.marked ? 'rgba(124,58,237,0.3)' : 'var(--border)'}`,
              }}
            >
              {r?.marked ? (isHi ? '✓ चिह्नित' : '✓ Marked') : (isHi ? 'समीक्षा हेतु चिह्नित करें' : 'Mark for review')}
            </button>
          </div>

          <p className="text-sm leading-relaxed text-[var(--text-1)] whitespace-pre-line"><MathRenderer content={questionText} /></p>

          <div className="space-y-2" role={isMulti ? 'group' : 'radiogroup'}>
            {current.options.map((opt, i) => {
              const selected = isMulti ? (r?.selectedIndices ?? []).includes(i) : r?.selectedIndex === i;
              return (
                <button
                  key={i}
                  type="button"
                  role={isMulti ? 'checkbox' : 'radio'}
                  aria-checked={selected}
                  onClick={() => s.selectOption(i)}
                  data-testid={`mock-test-option-${i}`}
                  className="w-full text-left rounded-xl px-4 py-3 flex items-start gap-3 transition-all"
                  style={{ background: selected ? 'rgba(232,88,28,0.08)' : 'var(--surface-2)', border: selected ? '2px solid var(--orange)' : '1.5px solid var(--border)' }}
                >
                  <span
                    className="flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold flex-shrink-0 mt-0.5"
                    style={{
                      background: selected ? 'var(--orange)' : 'var(--surface-1)',
                      color: selected ? '#fff' : 'var(--text-3)',
                      border: selected ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="text-sm text-[var(--text-1)] flex-1"><MathRenderer inline content={opt} /></span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => s.navigateTo(s.cursor - 1)} disabled={s.cursor === 0} className={NAV_CLS} style={{ ...NAV_STYLE, color: 'var(--text-1)' }}>
            ← {isHi ? 'पिछला' : 'Previous'}
          </button>
          <button type="button" onClick={s.skip} disabled={isLast} className={NAV_CLS} style={{ ...NAV_STYLE, color: 'var(--text-3)' }}>
            {isHi ? 'छोड़ें' : 'Skip'}
          </button>
          <div className="flex-1" />
          {isLast ? (
            <button
              type="button"
              onClick={s.handleSubmit}
              disabled={s.submitting}
              data-testid="mock-test-submit"
              className={PRIMARY_CLS}
              style={{ ...PRIMARY_STYLE, opacity: s.submitting ? 0.7 : 1 }}
            >
              {s.submitting ? (isHi ? 'भेज रहे हैं…' : 'Submitting…') : (isHi ? 'सबमिट करें' : 'Submit')}
            </button>
          ) : (
            <button type="button" onClick={() => s.navigateTo(s.cursor + 1)} className={PRIMARY_CLS} style={PRIMARY_STYLE}>
              {isHi ? 'अगला' : 'Next'} →
            </button>
          )}
        </div>

        {s.submitError && (
          <SubmitErrorBanner
            errorKey={s.submitError}
            isSubmitting={s.submitting}
            isHi={isHi}
            onRetry={s.retrySubmit}
          />
        )}

        <QuestionPalette
          questions={questions}
          responses={s.responses}
          cursor={s.cursor}
          isHi={isHi}
          onNavigate={s.navigateTo}
        />
      </main>
    </div>
  );
}
