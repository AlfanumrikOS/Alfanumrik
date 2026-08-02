'use client';

/**
 * PlacementCheck — the first-run calibration flow (design screen 02).
 *
 * PURE PRESENTATION. No fetch, no hook, no scoring. The caller supplies the
 * questions and receives each response; the caller decides what to write. The
 * question source and the write target are a PROPOSAL — see
 * handoff/BLOCKED-SCREENS.md §2 — and must be approved before wiring.
 *
 * The UX rules this encodes, from the student-side review:
 *   - It is never called a test. Framing line is fixed above the progress bar.
 *   - "Haven't done this yet" is a first-class ANSWER, not a skip. It carries
 *     `unseen: true` so the caller can set a low prior WITHOUT recording a
 *     wrong answer.
 *   - Six questions, and the whole thing is skippable at any point.
 *   - No score, no right/wrong feedback, no celebration. It ends silently and
 *     hands off to the plan.
 *
 * `PlacementQuestion` / `PlacementAnswer` live in
 * `@alfanumrik/lib/placement/types` — lib owns the DTO, this file only
 * consumes it (2026-08-02 layering fix; see that module's header for why).
 */

import type { PlacementQuestion, PlacementAnswer } from '@alfanumrik/lib/placement/types';

export default function PlacementCheck({
  questions,
  index,
  isHi,
  onAnswer,
  onSkipAll,
}: {
  questions: PlacementQuestion[];
  /** 0-based index of the question being shown. */
  index: number;
  isHi: boolean;
  onAnswer: (answer: PlacementAnswer) => void;
  onSkipAll: () => void;
}) {
  const q = questions[index];
  if (!q) return null;

  const answer = (optionId: string | null, unseen: boolean) =>
    onAnswer({ questionId: q.id, topicId: q.topicId, optionId, unseen });

  return (
    <div data-testid="placement-check" className="flex flex-col gap-3.5">
      <div className="flex items-center">
        <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
          {isHi
            ? `प्रश्न ${index + 1} / ${questions.length}`
            : `Question ${index + 1} of ${questions.length}`}
        </p>
        <button
          type="button"
          onClick={onSkipAll}
          className="ml-auto text-sm font-semibold px-3"
          style={{ color: 'var(--text-3)', minHeight: 44 }}
          data-testid="placement-skip-all"
        >
          {isHi ? 'छोड़ दें' : 'Skip this'}
        </button>
      </div>

      {/* The framing line. Non-negotiable — it is what stops this reading as a test. */}
      <p
        className="rounded-2xl px-4 py-3 text-sm font-semibold leading-relaxed"
        style={{
          background: 'rgb(var(--orange-rgb) / 0.08)',
          border: '1px solid rgb(var(--orange-rgb) / 0.2)',
          color: 'var(--orange)',
        }}
      >
        {isHi
          ? 'यह जाँच नहीं है और किसी को नहीं दिखती। बस ताकि आपका समय बर्बाद न हो।'
          : "Not marked, not shown to anyone. It's so I don't hand you things you already know."}
      </p>

      <div className="flex gap-1" aria-hidden="true">
        {questions.map((item, i) => (
          <div
            key={item.id}
            className="flex-1 rounded-full"
            style={{ height: 5, background: i <= index ? 'var(--text-1)' : 'var(--surface-2)' }}
          />
        ))}
      </div>

      <h2
        className="text-base font-bold leading-relaxed"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
      >
        {q.stem}
      </h2>

      <div className="flex flex-col gap-2.5">
        {q.options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => answer(o.id, false)}
            className="w-full rounded-2xl px-4 text-left text-sm"
            style={{
              background: 'var(--surface-1, #fff)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
              minHeight: 52,
            }}
            data-testid="placement-option"
          >
            {o.label}
          </button>
        ))}

        {/* An answer, not a failure. Sets the prior; records no wrong response. */}
        <button
          type="button"
          onClick={() => answer(null, true)}
          className="w-full rounded-2xl px-4 text-sm font-bold"
          style={{
            background: 'transparent',
            border: '1px dashed var(--border)',
            color: 'var(--text-3)',
            minHeight: 52,
          }}
          data-testid="placement-unseen"
        >
          {isHi ? 'यह अभी पढ़ा नहीं है' : "Haven't done this yet"}
        </button>
      </div>

      <p className="text-xs leading-relaxed text-center" style={{ color: 'var(--text-3)' }}>
        {isHi
          ? '"अभी पढ़ा नहीं है" भी एक उत्तर है — इससे गलत उत्तर दर्ज नहीं होता।'
          : '"Haven\'t done this yet" sets the starting estimate without counting as wrong.'}
      </p>
    </div>
  );
}
