'use client';

/**
 * Foxy North-Star Phase 3 (L5 / U4 / P8) — 5-Rung Hint Ladder UI.
 *
 * Replaces the legacy 3-tier "padded" hint block in
 * apps/host/src/app/(student)/quiz/page.tsx (rungs were fabricated by
 * suffixing q.hint + splitting q.explanation). The state machine, content
 * descriptors, and P3 anti-cheat lock live in the assessment-owned pure
 * module: packages/lib/src/learn/hint-ladder.ts. This component is a thin
 * renderer over that machine — it never decides WHICH rung is available.
 *
 * Rung sources (see hint-ladder.ts §L5):
 *   1. q.hint / q.hint_hi                        (pre-attempt OK)
 *   2. first sentence of GET /api/learn/remediation (post-wrong ONLY)
 *   3. full remediation text                        (post-wrong ONLY)
 *   4. q.explanation / q.explanation_hi             (post-wrong ONLY)
 *   5. "Move on / try a fresh question" skip CTA    (post-wrong ONLY)
 *
 * ── Rung 5 v1 (assessment mandate 2026-08-05) ──────────────────────────────
 * Rung 5 is currently SKIP-ONLY. The CTA advances past the current question
 * via the parent-provided handler (`onRequestEquivalent` — prop name kept
 * for wiring continuity; semantics are "skip", not "same-misconception twin").
 * The same-topic evidential twin is deferred (see hint-ladder.ts TODO(L5) /
 * plan-tracker record E5/L5). Copy MUST NOT imply "similar" or "equivalent"
 * until that pipeline exists.
 *
 * ── P3 (anti-cheat) — load-bearing ─────────────────────────────────────────
 * Rungs 2-5 are ONLY exposed after `wrongAttempt` is set by the parent
 * (the parent lifts it in the wrong-answer branch of confirmAnswer). The
 * pure `nextRung()` refuses to advance past rung 1 pre-wrong, so even a
 * mis-plumbed caller cannot leak later rungs. Trust the module.
 *
 * hint_level is lifted via `onHintLevelChange(0..5)`; the quiz page stamps
 * it onto each response row (widened from the F8 0..3 clamp — the DB CHECK
 * is now 0..5).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createLadder,
  recordWrongAttempt,
  nextRung,
  rungContentSpec,
  toHintLevel,
  extractFirstSentence,
  type HintLadderState,
  type HintLevel,
  type HintRung,
} from '@alfanumrik/lib/learn/hint-ladder';

/** Minimal question shape the ladder needs — subset of quiz Question. */
export interface HintLadderQuestion {
  id: string;
  hint: string | null;
  /** No hint_hi column exists — EN only per hint-ladder.ts spec. */
  explanation: string | null;
  explanation_hi: string | null;
}

/** Wrong-attempt signal lifted from the quiz page. null before the first wrong submit. */
export interface WrongAttempt {
  distractorIndex: number;
}

/**
 * Remediation fetcher — thin wrapper the parent injects. Default targets
 * GET /api/learn/remediation (existing route). Returns null when the row
 * doesn't exist or the flag is off. Test hook: pass a mock.
 */
export type RemediationFetcher = (
  questionId: string,
  distractorIndex: number,
) => Promise<{ remediationEn: string; remediationHi: string } | null>;

const defaultRemediationFetcher: RemediationFetcher = async (questionId, distractorIndex) => {
  try {
    const res = await fetch(
      `/api/learn/remediation?questionId=${encodeURIComponent(questionId)}&distractorIndex=${distractorIndex}`,
      { credentials: 'same-origin' },
    );
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== 'object') return null;
    return {
      remediationEn: String((body as { remediationEn?: string }).remediationEn ?? ''),
      remediationHi: String((body as { remediationHi?: string }).remediationHi ?? ''),
    };
  } catch {
    return null;
  }
};

export interface HintLadderProps {
  isHi: boolean;
  question: HintLadderQuestion;
  /** null pre-wrong; set once by the quiz page on the wrong-answer branch. */
  wrongAttempt: WrongAttempt | null;
  /** Reports hint_level 0..5 for stamping onto the response row. */
  onHintLevelChange?: (level: HintLevel) => void;
  /**
   * Rung-5 handler — v1 semantics: "skip / move on to the next question".
   * Wired to nextQuestion() in the quiz page. Prop name retained for wiring
   * continuity; see the header TODO(L5) — when the same-topic evidential twin
   * ships, this will become a genuine equivalent-question fetch.
   */
  onRequestEquivalent?: () => void;
  /** Test hook: inject a remediation fetcher. Defaults to /api/learn/remediation. */
  fetchRemediation?: RemediationFetcher;
}

interface RungContent {
  rung: HintRung;
  text: string | null;
  /** True when the descriptor exists but content couldn't be resolved (e.g. no remediation row). */
  unavailable: boolean;
  /** True for rung 5 — no text, renders "Move on" skip CTA only (v1 semantics). */
  cta?: 'skip';
}

const RUNG_ICONS: Record<HintRung, string> = {
  1: '💡',
  2: '🧭',
  3: '🧩',
  4: '📖',
  5: '🔁',
};

const RUNG_BG: Record<HintRung, string> = {
  1: 'rgba(245,166,35,0.08)',
  2: 'rgba(124,58,237,0.06)',
  3: 'rgba(124,58,237,0.10)',
  4: 'rgba(22,163,74,0.06)',
  5: 'rgba(59,130,246,0.06)',
};

const RUNG_BORDER: Record<HintRung, string> = {
  1: 'rgba(245,166,35,0.20)',
  2: 'rgba(124,58,237,0.15)',
  3: 'rgba(124,58,237,0.22)',
  4: 'rgba(22,163,74,0.15)',
  5: 'rgba(59,130,246,0.18)',
};

export default function HintLadder({
  isHi,
  question,
  wrongAttempt,
  onHintLevelChange,
  onRequestEquivalent,
  fetchRemediation = defaultRemediationFetcher,
}: HintLadderProps) {
  const [state, setState] = useState<HintLadderState>(() => createLadder({ questionId: question.id }));
  const [contents, setContents] = useState<RungContent[]>([]);
  const [busy, setBusy] = useState(false);

  // Reset when the question changes (next quiz question).
  useEffect(() => {
    setState(createLadder({ questionId: question.id }));
    setContents([]);
  }, [question.id]);

  // Absorb the wrong-attempt signal into the pure state machine. Key ONLY on
  // distractorIndex — the object identity of `wrongAttempt` may change on
  // every parent render even when the underlying value is stable.
  useEffect(() => {
    if (!wrongAttempt) return;
    setState((prev) => (prev.wrongAttempted ? prev : recordWrongAttempt(prev, wrongAttempt.distractorIndex)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrongAttempt?.distractorIndex]);

  // Lift hint_level up whenever the rung advances (0..5). Key ONLY on
  // currentRung — the state object identity changes on every setState.
  useEffect(() => {
    onHintLevelChange?.(toHintLevel(state));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentRung, onHintLevelChange]);

  const resolveContent = useCallback(
    async (rung: HintRung, s: HintLadderState): Promise<RungContent> => {
      const spec = rungContentSpec(rung, s);
      if (spec.kind === 'skip') {
        return { rung, text: null, unavailable: false, cta: 'skip' };
      }
      // Rung 1 — question_bank.hint (EN only per spec)
      if (rung === 1) {
        const t = question.hint?.trim() ?? '';
        return { rung, text: t || null, unavailable: !t };
      }
      // Rungs 2/3 — /api/learn/remediation
      if (rung === 2 || rung === 3) {
        if (spec.fields === null) return { rung, text: null, unavailable: true };
        const distractorIndex = (spec.fetchKey as { distractorIndex?: number }).distractorIndex;
        if (typeof distractorIndex !== 'number') return { rung, text: null, unavailable: true };
        const remediation = await fetchRemediation(question.id, distractorIndex);
        if (!remediation) return { rung, text: null, unavailable: true };
        const raw = (isHi && remediation.remediationHi) ? remediation.remediationHi : remediation.remediationEn;
        if (!raw) return { rung, text: null, unavailable: true };
        const text = spec.transform === 'first_sentence' ? extractFirstSentence(raw) : raw;
        return { rung, text, unavailable: false };
      }
      // Rung 4 — question_bank.explanation
      if (rung === 4) {
        const t = (isHi && question.explanation_hi) ? question.explanation_hi : question.explanation;
        const trimmed = t?.trim() ?? '';
        return { rung, text: trimmed || null, unavailable: !trimmed };
      }
      return { rung, text: null, unavailable: true };
    },
    [question.id, question.hint, question.explanation, question.explanation_hi, isHi, fetchRemediation],
  );

  const handleReveal = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const advance = nextRung(state);
      if (!advance.ok) return;
      const nextState = advance.state;
      const content = await resolveContent(advance.rung, nextState);
      setContents((prev) => [...prev, content]);
      setState(nextState);
    } finally {
      setBusy(false);
    }
  }, [busy, state, resolveContent]);

  const canAdvance = useMemo(() => {
    const peek = nextRung(state);
    return peek.ok;
  }, [state]);

  const currentRung = state.currentRung;
  const nextRungCandidate: HintRung | null = currentRung < 5 ? ((currentRung + 1) as HintRung) : null;

  // If the parent hasn't wired onRequestEquivalent, rung 5 is inert — hide the skip CTA.
  const hasSkipHandler = typeof onRequestEquivalent === 'function';

  return (
    <div className="space-y-2" data-testid="hint-ladder">
      {contents.map((c) => (
        <div
          key={`rung-${c.rung}`}
          className="rounded-xl p-3 text-sm"
          style={{
            background: RUNG_BG[c.rung],
            border: `1px solid ${RUNG_BORDER[c.rung]}`,
            color: 'var(--text-2)',
          }}
          data-testid={`hint-ladder-rung-${c.rung}`}
        >
          {c.cta === 'skip' ? (
            // v1 skip rung — copy MUST NOT imply "similar/equivalent" (assessment
            // mandate 2026-08-05; the wired action is nextQuestion(), which
            // advances to whatever is next in the queue).
            <div className="flex items-center gap-2">
              <span aria-hidden="true">{RUNG_ICONS[5]}</span>
              <span className="flex-1">
                {isHi ? 'आगे बढ़ो / नया सवाल आज़माओ' : 'Move on / Try a fresh question'}
              </span>
              {hasSkipHandler && (
                <button
                  type="button"
                  onClick={onRequestEquivalent}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-white active:scale-95"
                  style={{ background: '#3B82F6' }}
                  data-testid="hint-ladder-skip-cta"
                >
                  {isHi ? 'आगे बढ़ो' : 'Move on'}
                </button>
              )}
            </div>
          ) : c.text ? (
            <div className="flex gap-2">
              <span aria-hidden="true">{RUNG_ICONS[c.rung]}</span>
              <span className="flex-1 whitespace-pre-wrap">{c.text}</span>
            </div>
          ) : (
            <div className="flex gap-2 text-[var(--text-3)]">
              <span aria-hidden="true">{RUNG_ICONS[c.rung]}</span>
              <span className="flex-1 italic">
                {isHi
                  ? 'यह संकेत अभी उपलब्ध नहीं — अगला खोलो।'
                  : 'This hint is unavailable — try the next one.'}
              </span>
            </div>
          )}
        </div>
      ))}

      {canAdvance && nextRungCandidate !== null && (
        <button
          type="button"
          onClick={handleReveal}
          disabled={busy}
          className="px-3 py-1.5 rounded-xl text-xs font-semibold min-h-[44px] active:scale-95 disabled:opacity-50"
          style={{
            background: 'var(--surface-1)',
            color: 'var(--text-2)',
            border: '1px solid var(--border)',
          }}
          data-testid="hint-ladder-reveal"
          data-next-rung={nextRungCandidate}
        >
          {currentRung === 0
            ? (isHi ? '💡 एक संकेत दो' : '💡 Give me a hint')
            : (isHi ? `और मदद (${currentRung}/5)` : `More help (${currentRung}/5)`)}
        </button>
      )}
    </div>
  );
}
