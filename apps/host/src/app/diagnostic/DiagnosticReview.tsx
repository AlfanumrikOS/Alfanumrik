'use client';

/**
 * /diagnostic — per-question answer review (Phase 5A).
 *
 * CEO defect #4: "After diagnostic test completion it does not adapt to
 * strengthen the student upon wrong answers. Student shall also know why was
 * the answer incorrect."
 *
 * ─── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 * `explanation` and `explanation_hi` have been on the wire since the
 * diagnostic shipped — `/api/diagnostic/start`'s `CLIENT_QUESTION_FIELDS`
 * includes both and `DiagnosticQuestion` declares both — and had NEVER been
 * rendered anywhere in `apps/host/src/app/diagnostic/`. The student finished a
 * 15-question placement check and was shown a percentage and nothing else; they
 * were not even told which answers were wrong. This renders them.
 *
 * ─── CORRECTNESS SOURCING (P1 discipline, one level down) ─────────────────
 * `is_correct` and `correct_index` come from `summary.question_results`, i.e.
 * the SERVER's re-derivation in `/api/diagnostic/complete` (contract C1). This
 * component never compares `selected` to `question.correct_answer_index`
 * itself — if it did, a stale client copy of a since-edited question could
 * render a green tick next to a row the server scored zero for, and the tick
 * count would contradict the "N/M correct" headline above it.
 *
 * Everything that is NOT a correctness claim (question text, options,
 * explanations) is read from the `questions` the page already has in memory.
 * Nothing is re-fetched and nothing is re-sent.
 *
 * ─── REUSE, NOT CLONES ────────────────────────────────────────────────────
 *  - `MathRenderer` (`@alfanumrik/ui/math/MathRenderer`) — the canonical
 *    question-bank text renderer; KaTeX-lazy, so math costs nothing here until
 *    a question actually contains math.
 *  - `parseOptions` / `OPTION_LETTERS` (`@alfanumrik/lib/quiz/options`) — the
 *    single MCQ option primitives, same as `QuizScreen`.
 *  - `MisconceptionExplainer` (`@alfanumrik/ui/quiz/MisconceptionExplainer`) —
 *    the SAME component already mounted by the quiz player and `QuizResults`.
 *    See the mount site below for why it is strictly additive.
 * The row layout deliberately mirrors `packages/ui/src/quiz/QuizResults.tsx`
 * (:1236-1242 correct/selected option tinting, :1299-1304 explanation block,
 * :1136 `isHi && explanation_hi ? … : explanation` resolution) so a student
 * sees the same review idiom on both surfaces.
 *
 * P7: every string comes from `./copy.ts` via `t()`. No inline literals.
 */

import type { CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { OPTION_LETTERS, parseOptions } from '@alfanumrik/lib/quiz/options';
import MathRenderer from '@alfanumrik/ui/math/MathRenderer';
import { DIAGNOSTIC_COPY as C, t } from './copy';
import type { DiagnosticQuestion, DiagnosticQuestionResult } from './types';

/**
 * PROGRESSIVE ENHANCEMENT ONLY — read this before assuming it does anything.
 *
 * `MisconceptionExplainer` renders `null` whenever `/api/learn/remediation`
 * has no curated row for (questionId, distractorIndex). As of 2026-08-24
 * production `wrong_answer_remediations` holds **0 rows against 18,750 active
 * questions — 0% coverage** — so today this mount is a guaranteed no-op and
 * shows the student NOTHING. That is exactly why the explanation block above
 * it is the headline fix and stands entirely on its own: the "why was this
 * wrong" the student actually receives comes from `question_bank.explanation`,
 * with zero dependence on the remediation table.
 *
 * This mount exists so the Eedi-style distractor micro-explanation lights up
 * automatically the day that table is authored — the flag
 * (`ff_distractor_micro_explainer_v1`) is already ON at 100% in production, so
 * content is the only missing ingredient. Do not delete it, and do not report
 * misconception remediation as "shipped" on the strength of it.
 *
 * Lazy + ssr:false, matching the quiz player's mount
 * (`apps/host/src/app/(student)/quiz/page.tsx:122`), so it costs nothing on a
 * form with no wrong answers.
 */
const MisconceptionExplainer = dynamic(
  () => import('@alfanumrik/ui/quiz/MisconceptionExplainer'),
  { ssr: false, loading: () => null },
);

export interface DiagnosticReviewProps {
  isHi: boolean;
  /** The questions as served by /api/diagnostic/start, in order. */
  questions: DiagnosticQuestion[];
  /** Server-authoritative verdicts from /api/diagnostic/complete. */
  results: DiagnosticQuestionResult[];
}

const cardStyle: CSSProperties = {
  borderRadius: 14,
  padding: 16,
  background: 'var(--surface-1)',
  border: '1px solid var(--border)',
};

export default function DiagnosticReview({ isHi, questions, results }: DiagnosticReviewProps) {
  if (!Array.isArray(results) || results.length === 0) return null;

  const byId = new Map<string, DiagnosticQuestion>();
  for (const q of questions ?? []) {
    if (q && typeof q.id === 'string') byId.set(q.id, q);
  }

  // Only rows whose question we still hold can be reviewed — without the
  // question we have no text, no options and no explanation to show, and
  // inventing a placeholder row would be worse than omitting it.
  const rows = results
    .map((r) => ({ result: r, question: byId.get(r.question_id) }))
    .filter((row): row is { result: DiagnosticQuestionResult; question: DiagnosticQuestion } =>
      row.question !== undefined,
    );

  if (rows.length === 0) return null;

  const anyWrong = rows.some((row) => row.result.is_correct === false);

  return (
    <section style={{ ...cardStyle }} data-testid="diagnostic-answer-review">
      <p
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--text-1)',
          margin: '0 0 4px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span aria-hidden="true">📝</span>
        {t(C.reviewHeading, isHi)}
      </p>
      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 14px', lineHeight: 1.5 }}>
        {anyWrong ? t(C.reviewSubheadingWrong, isHi) : t(C.reviewAllCorrect, isHi)}
      </p>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map(({ result, question }) => {
          const correct = result.is_correct === true;
          const opts = parseOptions(question.options);
          const questionText =
            isHi && question.question_hi ? question.question_hi : question.question_text;
          // Same resolution as QuizResults.tsx:1136 — Hindi when present,
          // English otherwise. A missing Hindi explanation falls back rather
          // than rendering blank (P7: never blank a student-facing surface).
          const explanation =
            isHi && question.explanation_hi ? question.explanation_hi : question.explanation;

          const selectedIdx =
            typeof result.selected_index === 'number' ? result.selected_index : -1;
          const correctIdx =
            typeof result.correct_index === 'number' ? result.correct_index : -1;

          return (
            <li
              key={`${result.question_id}-${result.question_number}`}
              data-testid={correct ? 'diagnostic-review-correct' : 'diagnostic-review-wrong'}
              style={{
                borderRadius: 12,
                padding: 12,
                background: correct
                  ? 'rgba(22,163,74,0.05)'
                  : 'rgba(220,38,38,0.05)',
                border: `1px solid ${correct ? 'rgba(22,163,74,0.20)' : 'rgba(220,38,38,0.22)'}`,
              }}
            >
              {/* Verdict header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', letterSpacing: 0.6 }}>
                  Q{result.question_number}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 20,
                    color: correct ? '#16A34A' : '#DC2626',
                    background: correct ? 'rgba(22,163,74,0.10)' : 'rgba(220,38,38,0.10)',
                  }}
                >
                  {correct ? `✓ ${t(C.reviewCorrectBadge, isHi)}` : `✗ ${t(C.reviewIncorrectBadge, isHi)}`}
                </span>
              </div>

              {/* Question */}
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.5, margin: '0 0 8px' }}>
                <MathRenderer inline content={questionText} />
              </p>

              {/* Options — correct always green, the student's wrong pick red.
                  Mirrors QuizResults.tsx:1236-1242. */}
              {opts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                  {opts.map((opt, oi) => {
                    const isCorrectOpt = oi === correctIdx;
                    const isSelected = oi === selectedIdx;
                    let bg = 'var(--surface-2)';
                    let borderColor = 'transparent';
                    let color = 'var(--text-3)';
                    if (isCorrectOpt) {
                      bg = 'rgba(22,163,74,0.10)';
                      borderColor = '#16A34A';
                      color = '#16A34A';
                    } else if (isSelected && !correct) {
                      bg = 'rgba(220,38,38,0.08)';
                      borderColor = '#DC2626';
                      color = '#DC2626';
                    }
                    return (
                      <div
                        key={oi}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          borderRadius: 8,
                          padding: '6px 10px',
                          fontSize: 12,
                          background: bg,
                          border: `1px solid ${borderColor}`,
                          color,
                        }}
                      >
                        <span style={{ fontWeight: 700, width: 14, flexShrink: 0 }}>
                          {OPTION_LETTERS[oi]}.
                        </span>
                        <span style={{ flex: 1, lineHeight: 1.4 }}>
                          <MathRenderer inline content={opt} />
                        </span>
                        {isCorrectOpt && <span aria-hidden="true">✓</span>}
                        {isSelected && !correct && <span aria-hidden="true">✗</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* What the student picked — spelled out so the row is readable
                  even when the option list could not be parsed. */}
              {!correct && (
                <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '0 0 8px' }}>
                  {t(C.reviewYourAnswer, isHi)}:{' '}
                  <span style={{ fontWeight: 700, color: '#DC2626' }}>
                    {selectedIdx >= 0
                      ? (OPTION_LETTERS[selectedIdx] ?? String(selectedIdx + 1))
                      : t(C.reviewNotAnswered, isHi)}
                  </span>
                  {correctIdx >= 0 && (
                    <>
                      {' · '}
                      {t(C.reviewCorrectAnswer, isHi)}:{' '}
                      <span style={{ fontWeight: 700, color: '#16A34A' }}>
                        {OPTION_LETTERS[correctIdx] ?? String(correctIdx + 1)}
                      </span>
                    </>
                  )}
                </p>
              )}

              {/* THE HEADLINE FIX — why the answer was what it was.
                  Mirrors QuizResults.tsx:1299-1304. */}
              <div
                data-testid="diagnostic-review-explanation"
                style={{
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 12,
                  lineHeight: 1.6,
                  background: 'var(--surface-2)',
                  color: 'var(--text-2)',
                }}
              >
                <span style={{ fontWeight: 700, color: 'var(--text-1)' }}>
                  {t(C.reviewWhyLabel, isHi)}:{' '}
                </span>
                {explanation
                  ? <MathRenderer content={explanation} />
                  : <span style={{ color: 'var(--text-3)' }}>{t(C.reviewNoExplanation, isHi)}</span>}
              </div>

              {/* Additive only — see the MisconceptionExplainer note at the top
                  of this file. Renders nothing while wrong_answer_remediations
                  is empty, which it is in production today. */}
              {!correct && selectedIdx >= 0 && question.id && (
                <MisconceptionExplainer questionId={question.id} distractorIndex={selectedIdx} />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
