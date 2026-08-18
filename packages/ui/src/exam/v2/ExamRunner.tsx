'use client';

/**
 * ExamRunner — screen 11 "Mock exam" (`ff_exam_v2`) presentation layer.
 *
 * PRESENTATIONAL WRAPPER, NOT A REPLACEMENT. All state — timer countdown,
 * responses, cursor, submit/retry, the `deriveStatus()` palette classifier —
 * comes from the EXISTING `useMockTestState` hook
 * (`packages/ui/src/exams/useMockTestState.ts`). This file does not
 * reimplement the timer, anti-cheat, or the atomic `submit_mock_test_attempt`
 * call; it only restyles the same state machine `<MockTestRunner>` already
 * uses, per SCREENS.md screen 11's visual intent:
 *   - Sections, a MONO countdown timer, a question palette
 *     (answered / marked / left), and DEFERRED feedback (no correctness is
 *     ever shown mid-attempt — the exact opposite of screen 07 Practice's
 *     immediate-explanation behaviour). `useMockTestState` never exposes
 *     `is_correct` before submit, so this component has nothing to hide.
 *
 * House v2 design system only (CSS custom properties — --orange, --purple,
 * --green, --red, --surface-*, --text-*, --border, --font-display/--font-mono),
 * matching packages/ui/src/today/v2/TodayHomeV2.tsx and
 * packages/ui/src/quiz/v2/ResultSummary.tsx. The handoff's separate hex-token
 * system (tokens/student-v2.ts, primitives/student-v2.tsx) is deliberately
 * NOT used — house system decision made earlier this session.
 *
 * ── Autosave (the actual net-new behaviour here) ─────────────────────────
 * Every ~10s, IF the response/cursor snapshot has changed since the last
 * queued write, this component mints a fresh idempotency key AT CAPTURE TIME
 * (the moment the change is observed, not when the write is later flushed or
 * retried) and calls `queueWrite()` against the `pending_writes` IndexedDB
 * store (`packages/lib/src/offline/store.ts`). `useOfflineState`'s existing
 * `online` handler already calls `replayPending()` generically — no change
 * needed there; it POSTs each queued row's payload + capture-time
 * idempotency key to `row.endpoint` (`/api/exams/papers/[id]/autosave`,
 * new — see that route's header for why static JEE/NEET/Olympiad papers,
 * which never carry an attemptId, autosave client-side only).
 *
 * This NEVER interferes with the real submit: `handleSubmit`/`retrySubmit`
 * from `useMockTestState` are passed through completely unchanged, and the
 * autosave queue only ever targets the new `/autosave` route — never
 * `/submit`. Autosave is stopped once `submitted` is true.
 *
 * Not a general "offline mock exam" mode — starting/submitting a mock exam
 * still always requires a live connection (`ff_offline_v2`'s scope note).
 * This is a live-session safety net against a transient signal drop only.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import MathRenderer from '@alfanumrik/ui/math/MathRenderer';
import { queueWrite } from '@alfanumrik/lib/offline/store';
import type { MockTestPaper, MockTestQuestion, ResponseEntry } from '../../exams/mock-test-types';
import { deriveStatus, useMockTestState } from '../../exams/useMockTestState';

export type { MockTestPaper, MockTestQuestion } from '../../exams/mock-test-types';

const AUTOSAVE_INTERVAL_MS = 10_000;

function autosaveEndpoint(paperId: string): string {
  return `/api/exams/papers/${paperId}/autosave`;
}

function mintIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (older WebViews).
  return `autosave-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface AutosavePayload {
  attempt_id?: string;
  responses: Array<{ question_id: string; response_index: number | null; marked_for_review: boolean }>;
  cursor: number;
  remaining_seconds: number;
}

/**
 * Wires the ~10s autosave cadence against the mock-test state machine.
 * Extracted as its own hook so <ExamRunner> stays presentation-focused and
 * this logic is independently unit-testable.
 */
function useMockExamAutosave(
  paper: MockTestPaper,
  questions: MockTestQuestion[],
  responses: ResponseEntry[],
  cursor: number,
  remaining: number,
  submitted: boolean,
  attemptId?: string,
) {
  // Captured at the moment the answer state actually changes — never
  // regenerated when the same snapshot is later flushed or replayed.
  const capturedRef = useRef<{ key: string; payload: AutosavePayload } | null>(null);
  const lastQueuedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (submitted) return;
    capturedRef.current = {
      key: mintIdempotencyKey(),
      payload: {
        ...(attemptId ? { attempt_id: attemptId } : {}),
        responses: responses.map((r, i) => ({
          question_id: questions[i]?.id ?? '',
          response_index: r.selectedIndex,
          marked_for_review: r.marked,
        })),
        cursor,
        remaining_seconds: remaining,
      },
    };
    // remaining intentionally excluded from deps — a bare timer tick should
    // not by itself mint a new capture; only an actual answer/nav change
    // (responses/cursor) does. The latest `remaining` is still read via the
    // ref's payload above whenever a real change fires this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responses, cursor, submitted, attemptId, questions]);

  useEffect(() => {
    if (submitted) return;
    const interval = setInterval(() => {
      const captured = capturedRef.current;
      if (!captured) return;
      if (captured.key === lastQueuedKeyRef.current) return; // nothing new since last flush
      lastQueuedKeyRef.current = captured.key;
      void queueWrite({
        idempotencyKey: captured.key,
        kind: 'mock_exam_autosave',
        endpoint: autosaveEndpoint(paper.id),
        payload: captured.payload,
        occurredAt: new Date().toISOString(),
      }).catch(() => {
        // IndexedDB unavailable (private mode / quota) — degrade silently;
        // the in-memory capturedRef still holds the latest snapshot for the
        // next tick, and the final submit path is entirely unaffected.
      });
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [submitted, paper.id]);
}

const STATUS_COLORS = {
  unattempted: { bg: 'var(--surface-2)', fg: 'var(--text-3)', ring: 'var(--border)' },
  attempted: { bg: 'rgb(var(--green-rgb, 22 163 74) / 0.12)', fg: 'var(--green, #16A34A)', ring: 'rgb(var(--green-rgb, 22 163 74) / 0.4)' },
  marked: { bg: 'rgb(var(--purple-rgb, 124 58 237) / 0.12)', fg: 'var(--purple, #7C3AED)', ring: 'rgb(var(--purple-rgb, 124 58 237) / 0.4)' },
  skipped: { bg: 'rgb(var(--orange-rgb) / 0.12)', fg: 'var(--orange)', ring: 'rgb(var(--orange-rgb) / 0.4)' },
} as const;

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

function SubmittedScreen({ isHi }: { isHi: boolean }) {
  return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center p-6" data-testid="exam-runner-v2-submitted">
      <div className="rounded-2xl p-6 max-w-md w-full text-center space-y-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
        <div className="text-5xl" aria-hidden="true">📨</div>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? 'सबमिशन प्राप्त' : 'Submission received'}
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          {isHi ? 'परिणाम तैयार हो रहे हैं…' : 'Preparing your results…'}
        </p>
        <Link
          href="/dashboard"
          className="inline-flex justify-center rounded-xl px-4 py-2.5 text-sm font-semibold"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        >
          {isHi ? 'डैशबोर्ड' : 'Dashboard'}
        </Link>
      </div>
    </div>
  );
}

function ExamPalette({
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
    responses.forEach((r) => { acc[deriveStatus(r)] += 1; });
    return acc;
  }, [responses]);

  return (
    <div
      className="rounded-2xl p-4 space-y-3"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      data-testid="exam-runner-v2-palette"
    >
      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-3)' }}>
        <span className="font-bold uppercase tracking-wider">{isHi ? 'प्रश्न सूची' : 'Palette'}</span>
        <span>
          {counts.attempted} {isHi ? 'किए' : 'answered'} · {counts.marked} {isHi ? 'चिह्नित' : 'marked'} · {counts.unattempted + counts.skipped} {isHi ? 'शेष' : 'left'}
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
              data-testid={`exam-runner-v2-palette-${i}`}
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
  /** cbse_board dynamic-attempt flow only — see useMockTestState + the
   *  autosave route header for why static papers omit this. */
  attemptId?: string;
}

export default function ExamRunner({ paper, questions, isHi, attemptId }: Props) {
  const router = useRouter();
  const onNavigate = useCallback((path: string) => { router.push(path); }, [router]);
  const s = useMockTestState(paper, questions, { onNavigate, attemptId });

  useMockExamAutosave(paper, questions, s.responses, s.cursor, s.remaining, s.submitted, attemptId);

  if (s.submitted) return <SubmittedScreen isHi={isHi} />;

  const current = questions[s.cursor];
  if (!current) {
    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center p-6">
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
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
    <div className="mesh-bg min-h-dvh pb-32" data-testid="exam-runner-v2">
      <header
        className="page-header sticky top-0 z-30"
        style={{ background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}
      >
        <div className="app-container py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: 'var(--text-3)' }}>{paper.paper_code}</p>
            <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-2)' }}>
              {isHi ? 'प्रश्न' : 'Question'} {current.question_number}/{questions.length}
              {current.section && (
                <span> · {isHi ? `खंड ${current.section}` : `Section ${current.section}`}</span>
              )}
            </p>
          </div>
          <div
            className="rounded-xl px-3 py-1.5 font-bold text-base tabular-nums"
            data-testid="exam-runner-v2-timer"
            aria-label={isHi ? 'शेष समय' : 'Time remaining'}
            style={{
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              background: lowTime ? 'rgb(220 38 38 / 0.12)' : 'var(--surface-2)',
              color: lowTime ? 'var(--red, #DC2626)' : 'var(--text-1)',
              border: `1px solid ${lowTime ? 'rgb(220 38 38 / 0.3)' : 'var(--border)'}`,
            }}
          >
            ⏱ {formatTime(s.remaining)}
          </div>
        </div>
      </header>

      <main className="app-container py-5 space-y-4">
        <div className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-xs">
              {current.section && (
                <span
                  className="rounded-full px-2.5 py-0.5 font-bold"
                  style={{ background: 'var(--purple, #7C3AED)', color: '#fff' }}
                  data-testid="exam-runner-v2-section-badge"
                >
                  {isHi ? `खंड ${current.section}` : `Section ${current.section}`}
                </span>
              )}
              <span className="rounded-md px-2 py-0.5 font-bold" style={{ background: 'rgb(22 163 74 / 0.12)', color: 'var(--green, #16A34A)' }}>+{current.marks_correct}</span>
              {!(current.section && current.marks_wrong === 0) && (
                <span className="rounded-md px-2 py-0.5 font-bold" style={{ background: 'rgb(220 38 38 / 0.10)', color: 'var(--red, #DC2626)' }}>−{Math.abs(current.marks_wrong)}</span>
              )}
              {current.chapter_title && <span className="truncate" style={{ color: 'var(--text-3)' }}>· {current.chapter_title}</span>}
            </div>
            <button
              type="button"
              onClick={s.toggleMarked}
              data-testid="exam-runner-v2-mark"
              className="text-xs font-semibold rounded-lg px-2.5 py-1"
              style={{
                background: r?.marked ? 'rgb(var(--purple-rgb, 124 58 237) / 0.12)' : 'var(--surface-2)',
                color: r?.marked ? 'var(--purple, #7C3AED)' : 'var(--text-3)',
                border: `1px solid ${r?.marked ? 'rgb(var(--purple-rgb, 124 58 237) / 0.3)' : 'var(--border)'}`,
              }}
            >
              {r?.marked ? (isHi ? '✓ चिह्नित' : '✓ Marked') : (isHi ? 'समीक्षा हेतु चिह्नित करें' : 'Mark for review')}
            </button>
          </div>

          <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-1)' }}>
            <MathRenderer content={questionText} />
          </p>

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
                  data-testid={`exam-runner-v2-option-${i}`}
                  className="w-full text-left rounded-xl px-4 py-3 flex items-start gap-3 transition-all"
                  style={{
                    background: selected ? 'rgb(var(--orange-rgb) / 0.08)' : 'var(--surface-2)',
                    border: selected ? '2px solid var(--orange)' : '1.5px solid var(--border)',
                  }}
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
                  <span className="text-sm flex-1" style={{ color: 'var(--text-1)' }}>
                    <MathRenderer inline content={opt} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => s.navigateTo(s.cursor - 1)}
            disabled={s.cursor === 0}
            className="rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          >
            ← {isHi ? 'पिछला' : 'Previous'}
          </button>
          <button
            type="button"
            onClick={s.skip}
            disabled={isLast}
            className="rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
          >
            {isHi ? 'छोड़ें' : 'Skip'}
          </button>
          <div className="flex-1" />
          {isLast ? (
            <button
              type="button"
              onClick={s.handleSubmit}
              disabled={s.submitting}
              data-testid="exam-runner-v2-submit"
              className="rounded-xl px-5 py-2 text-sm font-bold"
              style={{
                background: 'var(--surface-accent)',
                color: 'var(--on-surface-accent)',
                opacity: s.submitting ? 0.7 : 1,
              }}
            >
              {s.submitting ? (isHi ? 'भेज रहे हैं…' : 'Submitting…') : (isHi ? 'सबमिट करें' : 'Submit')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => s.navigateTo(s.cursor + 1)}
              className="rounded-xl px-5 py-2 text-sm font-bold"
              style={{ background: 'var(--surface-accent)', color: 'var(--on-surface-accent)' }}
            >
              {isHi ? 'अगला' : 'Next'} →
            </button>
          )}
        </div>

        {s.submitError && (
          <div
            role="alert"
            data-testid="exam-runner-v2-submit-error"
            className="rounded-2xl p-4 flex items-start gap-3"
            style={{ background: 'rgb(220 38 38 / 0.08)', border: '1px solid rgb(220 38 38 / 0.3)' }}
          >
            <span aria-hidden="true" className="text-lg">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: 'var(--red, #DC2626)' }}>
                {isHi ? 'सबमिट करने में समस्या। आपके उत्तर सुरक्षित हैं।' : 'Submission failed. Your responses are saved locally.'}
              </p>
              <button
                type="button"
                onClick={s.retrySubmit}
                disabled={s.submitting}
                data-testid="exam-runner-v2-submit-retry"
                className="mt-2 text-xs font-bold underline disabled:opacity-50"
                style={{ color: 'var(--red, #DC2626)' }}
              >
                {s.submitting ? (isHi ? 'भेज रहे हैं…' : 'Submitting…') : (isHi ? 'पुनः प्रयास करें' : 'Retry')}
              </button>
            </div>
          </div>
        )}

        <ExamPalette
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
