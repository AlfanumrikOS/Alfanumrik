/**
 * Alfanumrik — Foxy 5-rung Hint Ladder (Foxy North-Star Phase 3, L5/U4/S4.5).
 *
 * PURE state machine. No I/O, no Supabase client, no async — this module only
 * decides WHICH rung a student may receive next and describes WHERE the
 * content for that rung lives (a content DESCRIPTOR: source + fetch key).
 * Callers (quiz page, FoxyPanel, /api/learn/remediation) inject their own
 * async fetchers and resolve the descriptor against the DB.
 *
 * The five rungs (assessment-owned pedagogy, design spec 2026-08-05 §L5):
 *   1. gentle prompt      — `question_bank.hint`              (pre-attempt OK)
 *   2. directional clue   — sentence 1 of the per-distractor
 *                           `wrong_answer_remediations` text  (post-wrong ONLY)
 *   3. partially worked   — the full remediation snippet      (post-wrong ONLY)
 *   4. full explanation   — `question_bank.explanation(_hi)`  (post-wrong ONLY)
 *   5. move on / skip     — advance past the current question         (post-wrong ONLY)
 *
 * ── Rung 5 v1 (assessment-mandated relabel, 2026-08-05) ────────────────────
 * Rung 5 is CURRENTLY a skip-only rung ("Move on / try a fresh question").
 * The originally-designed same-misconception evidential twin (fresh generated
 * question via quiz-generator + foxy_served_items, P6-gated) is DEFERRED: the
 * wave-3b UI wired the CTA to nextQuestion(), which advances to whatever is
 * next in the quiz queue (potentially a different topic). Serving that as
 * "similar question" would be pedagogically dishonest, so the label + the
 * descriptor kind are both "skip" until a same-topic twin pipeline exists.
 *
 * TODO(L5): restore the same-topic evidential twin — per assessment mandate,
 * tracked as plan-tracker record E5/L5 (same-misconception twin via a
 * dedicated retry lane, not the generic next-question pointer). When that
 * lands, flip rung 5 back to { source:'quiz_generator', kind:'equivalent_question' }
 * and re-wire the UI CTA + tests together in one PR.
 *
 * ── P3 (anti-cheat) AVAILABILITY RULE — load-bearing, do not weaken ─────────
 * Rungs 2-5 unlock ONLY after a recorded wrong attempt. Rungs 2-3 are built
 * from PER-DISTRACTOR remediation text: served before an answer they function
 * as a correctness oracle ("your likely wrong answer is X because…") which a
 * student can invert to find the right option. The lock is encoded IN the
 * state machine — `nextRung()` refuses to advance past rung 1 unless
 * `state.wrongAttempted` — so no UI can bypass it by calling in a loop.
 * Server-side callers must equally gate content resolution on the same state.
 *
 * hint_level persistence (D5/P8): `toHintLevel()` maps the state to the 0..5
 * integer written to `quiz_responses.hint_level` (0 = unhinted/independent).
 * The unhinted-mastery XP bonus (xp-config `unhinted_mastery_bonus`) keys off
 * hint_level === 0, so this mapping is part of the P2 surface.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type HintRung = 1 | 2 | 3 | 4 | 5;

/** 0 = no hint served yet; otherwise highest rung served. */
export type HintLevel = 0 | HintRung;

export interface HintLadderContext {
  questionId: string;
}

export interface HintLadderState {
  questionId: string;
  /** Highest rung served so far (0 = none). */
  currentRung: HintLevel;
  /** True once the student has submitted at least one wrong answer. */
  wrongAttempted: boolean;
  /** Distractor index (0-3) of the FIRST wrong attempt; null before any. */
  distractorIndex: number | null;
}

export type NextRungResult =
  | { ok: true; rung: HintRung; state: HintLadderState }
  | { ok: false; reason: 'locked_pre_attempt' | 'exhausted'; state: HintLadderState };

/**
 * Content descriptor — pure description of where a rung's content lives.
 * `fields` name the bilingual column pair on the source row (`hi: null` where
 * the schema has no Hindi twin; callers fall back to EN — P7-compliant
 * because the surrounding UI chrome is translated even when curated content
 * is EN-only).
 */
export interface RungContentSpec {
  rung: HintRung;
  source: 'question_bank' | 'wrong_answer_remediations' | 'skip';
  fetchKey:
    | { questionId: string }
    | { questionId: string; distractorIndex: number };
  fields: { en: string; hi: string | null } | null;
  /** 'first_sentence' → caller applies extractFirstSentence(); 'full' → verbatim. */
  transform: 'first_sentence' | 'full' | null;
  /**
   * 'skip' (rung 5, v1) — no content is fetched; the UI renders a "Move on"
   * CTA that advances past the current question. See TODO(L5) in the header:
   * the same-topic evidential twin ('equivalent_question') is deferred.
   */
  kind: 'text' | 'skip';
}

// ── State machine ───────────────────────────────────────────────────────────

export function createLadder(ctx: HintLadderContext): HintLadderState {
  return {
    questionId: ctx.questionId,
    currentRung: 0,
    wrongAttempted: false,
    distractorIndex: null,
  };
}

/**
 * Record a wrong attempt (unlocks rungs 2-5). Idempotent: the FIRST wrong
 * attempt's distractor index is kept — rungs 2-3 remediate the student's
 * original misconception, not their latest guess.
 */
export function recordWrongAttempt(
  state: HintLadderState,
  distractorIndex: number,
): HintLadderState {
  if (state.wrongAttempted) return state;
  if (!Number.isInteger(distractorIndex) || distractorIndex < 0 || distractorIndex > 3) {
    // Invalid index still unlocks the ladder (the wrong attempt happened) but
    // carries no distractor — rungs 2-3 resolve to null content and callers
    // skip to rung 4. Never throw from the pure module.
    return { ...state, wrongAttempted: true };
  }
  return { ...state, wrongAttempted: true, distractorIndex };
}

/**
 * Advance the ladder. Enforces:
 *  - rungs are sequential (no skipping),
 *  - P3 lock: cannot advance past rung 1 without a wrong attempt,
 *  - rung 5 is terminal.
 */
export function nextRung(state: HintLadderState): NextRungResult {
  if (state.currentRung >= 5) {
    return { ok: false, reason: 'exhausted', state };
  }
  const candidate = (state.currentRung + 1) as HintRung;
  if (candidate >= 2 && !state.wrongAttempted) {
    return { ok: false, reason: 'locked_pre_attempt', state };
  }
  return { ok: true, rung: candidate, state: { ...state, currentRung: candidate } };
}

/** hint_level integer persisted to quiz_responses (D5). 0 = independent. */
export function toHintLevel(state: HintLadderState): HintLevel {
  return state.currentRung;
}

// ── Content descriptors ─────────────────────────────────────────────────────

export function rungContentSpec(rung: HintRung, state: HintLadderState): RungContentSpec {
  switch (rung) {
    case 1:
      return {
        rung,
        source: 'question_bank',
        fetchKey: { questionId: state.questionId },
        // question_bank has no hint_hi column — EN only, UI chrome translated.
        fields: { en: 'hint', hi: null },
        transform: 'full',
        kind: 'text',
      };
    case 2:
    case 3: {
      // Per-distractor remediation. Descriptor is only resolvable when a
      // distractor is known; the P3 lock in nextRung() guarantees a wrong
      // attempt happened, but an invalid index may leave it null — callers
      // treat null fields as "content unavailable, offer the next rung".
      const hasDistractor = state.distractorIndex !== null;
      return {
        rung,
        source: 'wrong_answer_remediations',
        fetchKey: hasDistractor
          ? { questionId: state.questionId, distractorIndex: state.distractorIndex as number }
          : { questionId: state.questionId },
        fields: hasDistractor
          ? { en: 'remediation_text', hi: 'remediation_text_hi' }
          : null,
        transform: rung === 2 ? 'first_sentence' : 'full',
        kind: 'text',
      };
    }
    case 4:
      return {
        rung,
        source: 'question_bank',
        fetchKey: { questionId: state.questionId },
        fields: { en: 'explanation', hi: 'explanation_hi' },
        transform: 'full',
        kind: 'text',
      };
    case 5:
      // v1 skip-only rung (assessment mandate 2026-08-05). See header TODO(L5)
      // — same-topic evidential twin is deferred to plan-tracker record E5/L5.
      return {
        rung,
        source: 'skip',
        fetchKey: { questionId: state.questionId },
        fields: null,
        transform: null,
        kind: 'skip',
      };
  }
}

/**
 * Rung-2 transform: first sentence of a remediation snippet. Sentence =
 * everything up to and including the first '.', '?', '!', or Devanagari
 * danda '।' (Hindi remediation text); falls back to the whole trimmed string
 * when no terminator exists.
 */
export function extractFirstSentence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^[\s\S]*?[.?!।]/);
  return (match ? match[0] : trimmed).trim();
}
