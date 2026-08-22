/**
 * Quiz session ⇄ server submit-contract primitives.
 *
 * Two values are part of the client → server quiz contract and had each been
 * re-derived inline at more than one call site in
 * `apps/host/src/app/(student)/quiz/page.tsx`. Both derivations were WRONG at
 * one of those sites, and in both cases the correct derivation already existed
 * a few lines away — nobody noticed because there was no single owner. They now
 * live here so there is exactly one place to be right.
 *
 * ─── 1. collectSessionQuestionIds (P0-1) ──────────────────────────────────
 * `start_quiz_session` writes ONE `quiz_session_shuffles` row per question id
 * it is handed. That row is what `submit_quiz_results_v2` looks up per
 * response, and `COUNT(*)` over those rows is what P3 anti-cheat Check 3 uses
 * as "how many questions were actually served".
 *
 * The page used to pass only the MCQ ids (`qs.filter(isQuestionMCQ)`), so a
 * quiz containing ANY written (SA/MA/LA/NCERT-exercise) question served more
 * questions than it snapshotted. The RPC then raised
 * `session_not_started` on the first written response and the entire
 * submission — MCQ answers included — was destroyed. A PURE written quiz was
 * worse still: zero MCQ ids meant `start_quiz_session` was never called at
 * all, so `p_session_id` was NULL and every response missed.
 *
 * The contract this function encodes: EVERY served question is snapshotted,
 * regardless of type. Non-MCQ questions are handled by `start_quiz_session`
 * already — it stores an identity shuffle and an empty options snapshot for
 * anything that is not a 4-option MCQ (migration 20260801100800), which is
 * exactly the "served, but not as an MCQ" marker `submit_quiz_results_v2`
 * needs to score it via the written lane instead of the option-index lane.
 *
 * ─── 2. computeElapsedSeconds (P0-2) ──────────────────────────────────────
 * `submit_quiz_results_v2`'s `p_time` is ELAPSED seconds — P3 Check 1 divides
 * it by the question count and flags anything under 3s/question.
 *
 * In practice/cognitive mode the page's `timer` counts UP, so `timer` IS the
 * elapsed time. In EXAM mode the same `timer` counts DOWN from the limit, so
 * passing it raw sent the time REMAINING. That inverted the check: a student
 * who used the full time submitted `p_time ≈ 0` and was flagged (XP 0), every
 * exam that auto-submitted at `timer === 0` was flagged by construction, and
 * a student who rushed and left 25 minutes on the clock sailed through with
 * `p_time = 1500`. The check punished thoroughness and rewarded rushing.
 *
 * The correct conversion already existed in the same file — the
 * `exam_simulations` write used `examTimeLimit * 60 - timer` — but the submit
 * call did not. Both now read this one function.
 *
 * NOTE: this module changes NO invariant. P1's score formula, P2's XP
 * constants and P3's 3s/question threshold are untouched; these functions only
 * make the values fed INTO them the ones they were always documented to be.
 */

/** Minimal shape needed to collect a served question's id. */
export interface SessionQuestionLike {
  id?: unknown;
}

/**
 * Every served question id, in serve order, deduped, non-empty strings only.
 *
 * Deliberately NOT filtered by question type: see the module header. The
 * returned array is what gets handed to `start_quiz_session`, so it defines
 * the set of questions the server considers "served" for anti-cheat Check 3.
 */
export function collectSessionQuestionIds(
  questions: readonly SessionQuestionLike[] | null | undefined,
): string[] {
  if (!Array.isArray(questions)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const q of questions) {
    const id = q?.id;
    if (typeof id !== 'string' || id.length === 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export interface ElapsedSecondsInput {
  /** 'practice' | 'cognitive' | 'exam' (any other value is treated as count-up). */
  quizMode: string;
  /** The page's raw `timer` state: counts UP except in exam mode, where it counts DOWN. */
  timer: number;
  /** Exam time limit in MINUTES (the page's `examTimeLimit` state). */
  examTimeLimitMinutes: number;
}

/**
 * True wall-clock seconds spent on the attempt, in EVERY mode.
 *
 * Count-up modes  → the timer value itself.
 * Exam (count-down) → limit − remaining, clamped to [0, limit] so a clock
 * glitch can never produce a negative `p_time` (which would sail through P3
 * Check 1) or one larger than the exam window.
 */
export function computeElapsedSeconds({
  quizMode,
  timer,
  examTimeLimitMinutes,
}: ElapsedSecondsInput): number {
  const t = Number.isFinite(timer) ? Math.max(0, Math.trunc(timer)) : 0;
  if (quizMode !== 'exam') return t;
  const limitSeconds = Number.isFinite(examTimeLimitMinutes)
    ? Math.max(0, Math.trunc(examTimeLimitMinutes)) * 60
    : 0;
  return Math.min(limitSeconds, Math.max(0, limitSeconds - t));
}
