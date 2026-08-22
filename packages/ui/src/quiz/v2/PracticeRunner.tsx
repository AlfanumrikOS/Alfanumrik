'use client';

/**
 * PracticeRunner — screen 07 "Practice" (`ff_quiz_v2`).
 *
 * PRESENTATIONAL. Fetches nothing — every value is a prop, every write is a
 * callback. This is an ADDITIVE alternative render for the MCQ-in-progress
 * screen of `apps/host/src/app/(student)/quiz/page.tsx`'s existing quiz
 * state machine — it does NOT replace or reimplement `confirmAnswer` /
 * `nextQuestion` / `submitQuizResults` (P1/P2/P3/P4 untouched). The
 * orchestrator wraps the existing handlers and passes their results down as
 * props, exactly the same convention as `ResultSummary.tsx` and
 * `ExamRunner.tsx` (both built this session — see their headers for the
 * house v2-screen design-system rationale, which this file follows
 * verbatim: CSS custom properties only (--orange, --purple, --green, --red,
 * --surface-1, --surface-2, --text-1, --text-2, --text-3, --border,
 * --font-display), no separate hex-token system.
 *
 * ── The one behaviour change (per SCREENS.md screen 07) ─────────────────
 * The explanation/correctness appears IMMEDIATELY after each answer, not at
 * the end. This is powered entirely by `check_quiz_answer()` (migration
 * `20260802130000_check_quiz_answer_rpc.sql`) via the orchestrator's
 * `checkResult` prop — this component never computes or infers correctness
 * itself. `correct_answer_index` is never read by this file for anything
 * (there isn't even a prop for it) — the ONLY source of per-question
 * correctness is the `checkResult` prop, which is `null` while unresolved,
 * `'unavailable'` for the graceful-degrade state (see orchestrator wiring
 * for why), or the real `{ isCorrect, correctDisplayedIndex, explanation,
 * explanationHi }` verdict from `checkQuizAnswer()`.
 *
 * ── "No retry after reveal" ───────────────────────────────────────────────
 * This component enforces it VISUALLY (`disabled={isAnswered}` on every
 * option, regardless of whether `checkResult` has resolved yet — the
 * instant `isAnswered` flips true, options are inert). The PRIMARY
 * enforcement — never invoking `check_quiz_answer()` a second time for the
 * same question — lives in the orchestrator's confirm handler (a
 * synchronous ref-guard checked before any state update or RPC call), not
 * here; this component has no way to call the RPC at all (it only renders
 * props and calls the `onConfirm`/`onNext` callbacks it's given).
 *
 * ── No timer displayed (per SCREENS.md: "No timer on practice") ──────────
 * Time is still tracked by the orchestrator for anti-cheat/analytics
 * (P3/telemetry) exactly as before — this component simply never renders a
 * clock. "Progress is saved" messaging is shown on every state instead,
 * which is now literally true: `check_quiz_answer()` persists the answer
 * onto `quiz_session_shuffles` durably before this component even shows the
 * verdict (see the migration's persist-immediately design note).
 */

import type { ReactNode } from 'react';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import { Card, Button, ProgressBar } from '@alfanumrik/ui/ui';
import MathRenderer from '@alfanumrik/ui/math/MathRenderer';
import { OPTION_LETTERS } from '@alfanumrik/lib/quiz/options';

export interface PracticeRunnerQuestion {
  id: string;
  /** Already in DISPLAYED order (server-shuffled) — same array the legacy
   *  quiz screen renders via `getShuffledOptions`. Never re-shuffled here. */
  options: string[];
  questionText: string;
  questionTextHi: string | null;
  chapterNumber: number;
  /** `question_bank.bloom_level` VERBATIM — a NULLABLE column. Declared
   *  non-null here until 2026-08-11, which was untrue at runtime; the lie let
   *  the resume payload "safely" default a NULL bloom and diverge a resumed
   *  session's error classification from an identical fresh one. */
  bloomLevel: string | null;
  hint?: string | null;
}

/** Mirrors `QuizAnswerCheck` from `@alfanumrik/lib/supabase`, renamed to
 *  camelCase props at the presentational boundary. Kept as a separate type
 *  here (rather than importing the RPC-response type directly) so this
 *  file stays fetch-nothing / has zero dependency on the data layer. */
export interface PracticeRunnerVerdict {
  isCorrect: boolean;
  correctDisplayedIndex: number;
  explanation: string | null;
  explanationHi: string | null;
}

/** `null` = not yet confirmed. `'unavailable'` = confirmed, but no
 *  immediate verdict could be obtained (no server session for this
 *  question, or `checkQuizAnswer()` returned null — offline/RPC failure).
 *  A real verdict object = the confirmed, server-revealed answer. */
export type PracticeRunnerCheckResult = PracticeRunnerVerdict | 'unavailable' | null;

export interface PracticeRunnerProps {
  isHi: boolean;
  question: PracticeRunnerQuestion;
  /** 1-based position for the "Q x/y" header. */
  questionNumber: number;
  totalQuestions: number;
  selectedOption: number | null;
  /** True once the student has confirmed this question (mirrors the
   *  legacy screen's `showExplanation`). Options become inert the instant
   *  this flips true, independent of whether `checkResult` has resolved. */
  isAnswered: boolean;
  /** True while `checkQuizAnswer()` is in flight for this question. */
  checking: boolean;
  checkResult: PracticeRunnerCheckResult;
  subjectName?: string;
  subjectIcon?: string;
  subjectColor?: string;
  hintLevel: number;
  onSelect: (idx: number) => void;
  onConfirm: () => void;
  onNext: () => void;
  onRequestHint: () => void;
}

function ReassurancePill({ isHi }: { isHi: boolean }) {
  return (
    <p
      className="text-[11px] font-medium text-center"
      style={{ color: 'var(--text-3)' }}
      data-testid="practice-runner-v2-saved-note"
    >
      {isHi ? '💾 प्रगति सुरक्षित है' : '💾 Progress is saved'}
    </p>
  );
}

export default function PracticeRunner({
  isHi,
  question,
  questionNumber,
  totalQuestions,
  selectedOption,
  isAnswered,
  checking,
  checkResult,
  subjectName,
  subjectIcon,
  subjectColor,
  hintLevel,
  onSelect,
  onConfirm,
  onNext,
  onRequestHint,
}: PracticeRunnerProps) {
  const progress = totalQuestions > 0 ? ((questionNumber - 1 + (isAnswered ? 1 : 0)) / totalQuestions) * 100 : 0;
  const color = subjectColor || 'var(--orange)';
  const questionCopy = isHi && question.questionTextHi ? question.questionTextHi : question.questionText;

  const hasVerdict = checkResult !== null && checkResult !== 'unavailable';
  const isDegraded = checkResult === 'unavailable';

  let panel: ReactNode = null;
  if (isAnswered) {
    if (checking && checkResult === null) {
      panel = (
        <div
          className="rounded-2xl p-4 border flex items-center gap-3"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
          data-testid="practice-runner-v2-checking"
        >
          <span
            className="inline-block w-4 h-4 rounded-full border-2 border-current border-r-transparent animate-spin"
            style={{ color: 'var(--text-3)' }}
            aria-hidden="true"
          />
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            {isHi ? 'जवाब जांचा जा रहा है…' : 'Checking your answer…'}
          </p>
        </div>
      );
    } else if (hasVerdict) {
      const verdict = checkResult as PracticeRunnerVerdict;
      panel = (
        <div
          className="rounded-2xl p-4 border"
          style={{
            background: verdict.isCorrect ? 'rgba(22,163,74,0.06)' : 'rgba(220,38,38,0.05)',
            borderColor: verdict.isCorrect ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.15)',
          }}
          data-testid="practice-runner-v2-verdict"
          data-correct={verdict.isCorrect ? 'true' : 'false'}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{verdict.isCorrect ? '🎉' : '💡'}</span>
            <span className="text-sm font-bold" style={{ color: verdict.isCorrect ? '#16A34A' : '#DC2626' }}>
              {verdict.isCorrect
                ? (isHi ? 'शाबाश! सही जवाब!' : 'Correct! Well done!')
                : (isHi ? 'इस बार गलत' : 'Not quite this time')}
            </span>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
            <MathRenderer
              content={
                (isHi ? verdict.explanationHi : verdict.explanation) ||
                verdict.explanation ||
                (isHi ? 'कोई व्याख्या उपलब्ध नहीं' : 'No explanation available')
              }
            />
          </p>
        </div>
      );
    } else if (isDegraded) {
      panel = (
        <div
          className="rounded-2xl p-4 border"
          style={{ background: 'rgba(124,58,237,0.05)', borderColor: 'rgba(124,58,237,0.15)' }}
          data-testid="practice-runner-v2-degraded"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">💾</span>
            <span className="text-sm font-bold" style={{ color: '#7C3AED' }}>
              {isHi ? 'जवाब सुरक्षित हो गया' : 'Answer saved'}
            </span>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {isHi
              ? 'अभी सही जवाब नहीं दिखा पा रहे — क्विज़ ख़त्म होने पर देख लोगे। तुम्हारा जवाब सुरक्षित है।'
              : "We can't show the answer right now — you'll see it when the quiz ends. Your answer is saved."}
          </p>
        </div>
      );
    }
  }

  return (
    <SectionErrorBoundary section="Practice Runner">
      <div className="mesh-bg min-h-dvh flex flex-col focus-screen" data-testid="practice-runner-v2">
        <header className="page-header" style={{ background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}>
          <div className="app-container py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {subjectIcon && <span className="text-lg">{subjectIcon}</span>}
                <span className="text-sm font-semibold" style={{ color }}>
                  {isHi ? `सवाल ${questionNumber}/${totalQuestions}` : `Q ${questionNumber}/${totalQuestions}`}
                </span>
              </div>
              {subjectName && (
                <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{subjectName}</span>
              )}
            </div>
            <ProgressBar value={progress} color={color} height={4} />
          </div>
        </header>

        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-5 flex flex-col gap-4">
          <Card className="!p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-wider">
                {isHi ? `अध्याय ${question.chapterNumber}` : `Chapter ${question.chapterNumber}`}
              </span>
            </div>
            <div className="text-lg md:text-xl font-semibold leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>
              <MathRenderer content={questionCopy} />
            </div>
          </Card>

          <div className="space-y-2.5">
            {question.options.map((opt, idx) => {
              const letter = OPTION_LETTERS[idx] || String(idx + 1);
              const optText = opt.replace(/^[A-D][.)]\s*/, '');
              const isSelected = selectedOption === idx;
              const isCorrectOpt = hasVerdict && (checkResult as PracticeRunnerVerdict).correctDisplayedIndex === idx;

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
                } else if (isSelected && hasVerdict && !isCorrectOpt) {
                  bg = 'rgba(220,38,38,0.06)';
                  border = 'rgba(220,38,38,0.3)';
                  textColor = '#DC2626';
                  letterBg = '#DC2626';
                  letterColor = '#fff';
                } else if (isSelected) {
                  // Degraded/checking: neutral highlight only, no color verdict yet.
                  bg = `${color}10`;
                  border = color;
                  letterBg = color;
                  letterColor = '#fff';
                }
              } else if (isSelected) {
                bg = `${color}08`;
                border = color;
                letterBg = color;
                letterColor = '#fff';
              }

              return (
                <button
                  key={idx}
                  type="button"
                  data-testid={`practice-runner-v2-option-${idx}`}
                  onClick={() => onSelect(idx)}
                  disabled={isAnswered}
                  className="w-full rounded-2xl py-4 px-4 flex items-center gap-4 transition-all active:scale-[0.97]"
                  style={{
                    background: bg,
                    border: `1.5px solid ${border}`,
                    textAlign: 'left',
                    minHeight: 56,
                    boxShadow: isSelected && !isAnswered ? `0 0 0 2px ${color}30` : 'none',
                  }}
                >
                  <span
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 transition-all"
                    style={{ background: letterBg, color: letterColor }}
                  >
                    {letter}
                  </span>
                  <span className="text-sm md:text-base font-medium leading-snug flex-1" style={{ color: textColor }}>
                    <MathRenderer inline content={optText} />
                  </span>
                  {isAnswered && isCorrectOpt && <span className="ml-auto text-xl flex-shrink-0">✓</span>}
                  {isAnswered && isSelected && hasVerdict && !isCorrectOpt && <span className="ml-auto text-xl flex-shrink-0">✗</span>}
                </button>
              );
            })}
          </div>

          {panel}

          {!isAnswered && question.hint && (
            <div className="space-y-2">
              {hintLevel >= 1 && (
                <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.2)', color: 'var(--text-2)' }}>
                  💡 {question.hint}
                </div>
              )}
            </div>
          )}

          <ReassurancePill isHi={isHi} />

          <div className="flex gap-3 mt-auto pb-2">
            {!isAnswered ? (
              <>
                {question.hint && selectedOption === null && hintLevel < 1 && (
                  <Button variant="ghost" onClick={onRequestHint} size="sm" data-testid="practice-runner-v2-hint">
                    {isHi ? '💡 संकेत' : '💡 Hint'}
                  </Button>
                )}
                <Button
                  fullWidth
                  onClick={onConfirm}
                  color={color}
                  size="md"
                  disabled={selectedOption === null}
                  data-testid="practice-runner-v2-confirm"
                  style={selectedOption === null ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                >
                  {selectedOption !== null
                    ? (isHi ? 'जवाब जमा करो' : 'Submit Answer')
                    : (isHi ? 'एक विकल्प चुनो' : 'Select an option')}
                </Button>
              </>
            ) : (
              <Button
                fullWidth
                onClick={onNext}
                color={color}
                disabled={checking && checkResult === null}
                data-testid="practice-runner-v2-next"
              >
                {questionNumber < totalQuestions
                  ? (isHi ? 'अगला सवाल →' : 'Next Question →')
                  : (isHi ? 'नतीजे देखो 🎯' : 'See Results 🎯')}
              </Button>
            )}
          </div>
        </main>
      </div>
    </SectionErrorBoundary>
  );
}
