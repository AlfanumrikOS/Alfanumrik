/**
 * packages/lib/src/quiz/resume.ts — the quiz-session RESUME contract.
 *
 * Phase 4 "make resume actually resume". Before this module, no quiz session
 * in the product survived a refresh: `resolveNextLearnerAction` emitted a
 * `resume_in_progress` action whose deep link was a bare `/quiz` (the setup
 * screen), and `/quiz` accepted no session parameter at all — the CTA said
 * "resume" and started over.
 *
 * ─── Which substrate this is built on, and why ───────────────────────────
 *
 * `quiz_session_shuffles` (PK `(session_id, question_id)`), plus the three
 * nullable durability columns added by migration
 * `20260802130000_check_quiz_answer_rpc.sql`:
 *   student_selected_displayed_index / student_time_spent_seconds /
 *   student_answered_at.
 *
 * That migration's header says verbatim that reading those columns back to
 * restore a session is "a follow-up UX feature, out of scope for this
 * migration — the durability exists independent of whether anything reads it
 * back yet." This module is that follow-up.
 *
 * FLAG-STATE FINDING (verified in source, not assumed): the persist-immediately
 * path is DARK on the live code path today. `check_quiz_answer()` has exactly
 * one product caller — `confirmAnswerPracticeV2` in
 * `apps/host/src/app/(student)/quiz/page.tsx` — and that function is only
 * reachable from the render branch guarded by
 * `practiceV2On && quizMode === 'practice' && isQuestionMCQ(q)`, where
 * `practiceV2On = ff_quiz_v2 === true`. `ff_quiz_v2` is seeded
 * `is_enabled = FALSE, rollout_percentage = 0`
 * (`20260802150000_seed_ff_quiz_v2.sql`), AND `mode=practice` was unreachable
 * from any deep link. So ZERO rows carry a persisted answer today.
 *
 * Rather than ramp `ff_quiz_v2` (which would turn on immediate per-question
 * correctness — a pedagogy change owned by assessment, and, worse, the exact
 * combination that would make resume exploitable; see the interlock below),
 * the always-on persistence is done by a backend API route
 * (`POST /api/quiz/session/[sessionId]/progress`) writing the SAME three
 * columns through the service-role client with an explicit ownership check.
 * It reveals NOTHING about correctness, so it is a pure durability upgrade
 * available on every quiz mode with the flag still OFF.
 *
 * Why not the other candidate substrates:
 *   - `useMockExamAutosave` → `mock_test_attempts.client_metadata` is a
 *     different table for a different runner behind a different OFF flag
 *     (`ff_exam_v2`), and `/start` never reads it back either.
 *   - `packages/lib/src/offline/store.ts` (`queueWrite`/`replayPending`) and
 *     `localStorage['alfanumrik_mock_pending_*']` are CLIENT-only. They
 *     survive a tab crash but not a device loss, a reinstall, or a storage
 *     clear — and they cannot be the source of truth for a payload whose
 *     whole security property is "the client is not trusted with the answer
 *     key". They are used here only for a same-device convenience breadcrumb
 *     (see `readResumeBreadcrumb`), never for answer state.
 *
 * ─── SECURITY: the resume payload must never leak the answer key ─────────
 *
 * `quiz_session_shuffles.correct_answer_index_snapshot` is the server-owned
 * answer key that migration `20260428160000` exists to keep away from the
 * browser. This module enforces three independent layers:
 *
 *   1. `SHUFFLE_RESUME_COLUMNS` — the EXACT PostgREST select list the resume
 *      route uses. `correct_answer_index_snapshot` is not in it, so the value
 *      never enters the Node process at all. Same for
 *      `QUESTION_BANK_RESUME_COLUMNS` and `question_bank.correct_answer_index`.
 *   2. `ShuffleResumeRow` / `QuestionBankResumeRow` have no field for it, so
 *      adding one back is a type error at every call site.
 *   3. `buildQuizResumePayload` constructs each output object field-by-field
 *      from a fixed whitelist — it never spreads an input row.
 *
 * What the payload DOES return per question is exactly what a FRESH serve of
 * the same question already returns from `start_quiz_session` (question text,
 * the displayed-order options, explanation, hint, difficulty, bloom), plus
 * three strictly self-referential facts: whether the student answered it,
 * WHICH DISPLAYED INDEX THEY THEMSELVES PICKED, and how long they spent.
 * None of those is a function of the correct answer. Correctness is never
 * computed, never returned, and never inferable: an answered question looks
 * identical in the payload whether the student got it right or wrong.
 */

// ── Column whitelists (single source of truth, asserted by tests) ─────────

/**
 * The ONLY columns the resume route selects from `quiz_session_shuffles`.
 * `correct_answer_index_snapshot` is deliberately absent — see the module
 * doc comment. Do not add it: the whole point is that the answer key never
 * leaves Postgres on this path.
 *
 * `shuffle_map` IS selected, and that is safe: a permutation reveals nothing
 * without the correct index it would be applied to. It is needed to rebuild
 * the same displayed option order the student saw before the interruption.
 */
export const SHUFFLE_RESUME_COLUMNS =
  'question_id, shuffle_map, options_snapshot, student_selected_displayed_index, ' +
  'student_time_spent_seconds, student_answered_at, created_at, session_mode';

/**
 * The ONLY columns the resume route selects from `question_bank`.
 * `correct_answer_index` is deliberately absent — same reason.
 */
export const QUESTION_BANK_RESUME_COLUMNS =
  'id, subject, question_text, question_hi, question_type, explanation, ' +
  'explanation_hi, hint, difficulty, bloom_level, chapter_number';

/**
 * A resumable session must have been started within this window. Older
 * sessions are treated as abandoned: the question set may no longer reflect
 * the learner's current level, and a stale "continue" card is worse than a
 * fresh start.
 */
export const RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Upper bound applied server-side to any client-reported per-question time
 * before it is persisted. Mirrors the `max(3600)` already used by
 * `/api/quiz/submit`'s `time_taken_seconds` validator, so a resumed session
 * cannot reconstruct a larger per-question time than a live one could submit.
 */
export const MAX_QUESTION_SECONDS = 3600;

// ── Row shapes (deliberately missing the answer key) ──────────────────────

export interface ShuffleResumeRow {
  question_id: string;
  shuffle_map: number[] | null;
  options_snapshot: unknown;
  student_selected_displayed_index: number | null;
  student_time_spent_seconds: number | null;
  student_answered_at: string | null;
  created_at: string | null;
  /**
   * Which INSTRUMENT this session is (migration 20260814000021). `null` on any
   * row written before that column existed, or by a writer that did not stamp
   * it — treated as NOT resumable, never as a default. See `resolveSessionMode`.
   */
  session_mode?: string | null;
}

export interface QuestionBankResumeRow {
  id: string;
  subject: string | null;
  question_text: string | null;
  question_hi: string | null;
  question_type: string | null;
  explanation: string | null;
  explanation_hi: string | null;
  hint: string | null;
  difficulty: number | null;
  bloom_level: string | null;
  chapter_number: number | null;
}

// ── Payload shapes ────────────────────────────────────────────────────────

/**
 * The three instruments `/quiz` can run. `exam` is TIMED with an auto-submit;
 * the other two are untimed. Mirrors the `QuizMode` union in the quiz
 * orchestrator and the CHECK constraint in migration 20260814000021 — all three
 * must agree.
 */
export type QuizSessionMode = 'practice' | 'cognitive' | 'exam';

const QUIZ_SESSION_MODES: readonly string[] = ['practice', 'cognitive', 'exam'];

/**
 * Read the session's instrument off its snapshot rows.
 *
 * Returns `null` when NO row carries a recognised mode. That is deliberately
 * indistinguishable from "we do not know", because it is the same thing: the
 * caller must refuse rather than assume `cognitive`. An unrecognised string
 * (schema drift, a hand-edited row) is also `null` — a value we cannot map to
 * an instrument tells us nothing about whether it was timed.
 */
export function resolveSessionMode(
  // Structurally minimal on purpose: the `/today` producer
  // (`resolveResumableQuiz`) selects only the three columns it needs and must
  // be able to reuse the SAME resolver as the resume route, or the card and the
  // route could disagree about what counts as an exam.
  rows: Array<Pick<ShuffleResumeRow, 'session_mode'>>,
): QuizSessionMode | null {
  for (const row of rows) {
    const m = row.session_mode;
    if (typeof m === 'string' && QUIZ_SESSION_MODES.includes(m)) {
      return m as QuizSessionMode;
    }
  }
  return null;
}

export interface QuizResumeQuestion {
  question_id: string;
  question_text: string;
  question_hi: string | null;
  question_type: string;
  /** Options in the SAME displayed order the student saw pre-interruption. */
  options_displayed: string[];
  explanation: string | null;
  explanation_hi: string | null;
  hint: string | null;
  /**
   * `question_bank.difficulty` / `question_bank.bloom_level` VERBATIM, including
   * NULL. These are NULLABLE columns and this payload must not invent values
   * for them.
   *
   * WHY THIS IS NOT A NICETY. `classifyQuizError` in the quiz orchestrator
   * branches on `bloom_level`: `'remember'` → `'knowledge_gap'`, `'apply' |
   * 'analyze' | 'evaluate' | 'create'` → `'conceptual'`, otherwise
   * `'procedural'`. This module used to default a NULL bloom to `'remember'`.
   * A FRESH serve passes the real NULL through and classifies `'procedural'`;
   * a RESUMED serve stamped `'remember'` and classified `'knowledge_gap'` —
   * for the SAME question answered wrong the SAME way. That `error_type` is
   * persisted to `quiz_responses.error_type` and feeds
   * `update_learner_state_post_quiz` and misconception analysis, so the
   * fabricated default was silently corrupting learner state as a function of
   * whether a session had been interrupted. Any consumer that needs a concrete
   * value must apply its fallback at the point of CONSUMPTION, where the fresh
   * and resumed paths share code and therefore cannot diverge.
   */
  difficulty: number | null;
  bloom_level: string | null;
  chapter_number: number;
  /** True when this question already has a durable, immutable answer. */
  answered: boolean;
  /** The student's OWN pick, in displayed-index space. Never correctness. */
  selected_displayed_index: number | null;
  time_spent_seconds: number | null;
}

export interface QuizResumeSession {
  resumable: true;
  session_id: string;
  /**
   * The instrument this session was started as. Always a concrete non-exam
   * mode: an `exam` session is refused (`exam_not_resumable`) and an unknown
   * one is refused (`mode_unknown`), so a resumable payload can only ever carry
   * an instrument the runtime can honestly reproduce.
   */
  mode: Exclude<QuizSessionMode, 'exam'>;
  subject: string;
  chapter_number: number | null;
  total_questions: number;
  answered_count: number;
  /**
   * Sum of the SERVER-PERSISTED per-question times. This is on-task time only
   * — never wall clock — which is what keeps P3's 3s/question floor honest
   * across a resume in both directions. See the anti-cheat note on
   * `buildQuizResumePayload`.
   */
  elapsed_seconds: number;
  questions: QuizResumeQuestion[];
}

export type QuizResumeBlockedReason =
  /** No shuffle rows for this session id (or not owned by the caller). */
  | 'not_found'
  /** Session exists but the student never confirmed an answer — start fresh. */
  | 'not_started'
  /** Session already graded (quiz_sessions row keyed by the idempotency key). */
  | 'already_submitted'
  /** Older than RESUME_MAX_AGE_MS. */
  | 'expired'
  /** Snapshot rows are unusable (missing/short option snapshots). */
  | 'corrupt'
  /**
   * `ff_quiz_v2` (immediate per-question correctness) is ON for this caller.
   * Resume + mid-quiz correctness is the one combination that would let a
   * student learn an answer was wrong, refresh, and re-answer — because
   * `submit_quiz_results_v2` still grades from the CLIENT-supplied responses,
   * not from the persisted columns (an explicit non-goal of migration
   * 20260802130000). This interlock is mechanical, not advisory: it can only
   * be removed once the submit RPC prefers the persisted answer, which is an
   * assessment + architect change.
   */
  | 'blocked_immediate_feedback'
  /**
   * The session was started in `exam` mode. A timed test is taken in ONE
   * SITTING — it is not resumable, by assessment's ruling.
   *
   * Before migration 20260814000021 the mode was persisted nowhere, so a
   * resumed exam attempt silently ran untimed and was recorded in
   * `quiz_sessions` as though it were the same instrument. The page carried an
   * `if (quizMode === 'exam') setQuizMode('cognitive')` line meant as the
   * safeguard, but on a fresh `/quiz?session=<uuid>` load — the ONLY way the
   * resume CTA arrives — the URL carries no `?mode=exam`, so `quizMode` was
   * already the default and the branch could never fire.
   *
   * Resuming an exam CORRECTLY needs server-computed remaining time (never
   * client state) and is deliberately not built here. Until it is, refusing is
   * the honest answer, and `/today` suppresses the card so the refusal is never
   * a broken promise.
   */
  | 'exam_not_resumable'
  /**
   * No snapshot row carries a recognised `session_mode`, so we cannot prove the
   * attempt was not a timed one. Fail-closed: refuse rather than assume
   * `cognitive`. Mirrors the `blocked_immediate_feedback` posture — an
   * interlock that cannot read its input must not open.
   */
  | 'mode_unknown';

export interface QuizResumeBlocked {
  resumable: false;
  reason: QuizResumeBlockedReason;
}

export type QuizResumeResult = QuizResumeSession | QuizResumeBlocked;

// ── Pure helpers ──────────────────────────────────────────────────────────

/**
 * Rebuild the displayed option order from the snapshot + shuffle map, using
 * the IDENTICAL derivation `start_quiz_session` uses when it first serves the
 * question (`options_snapshot -> shuffle_map[i]`, 1-based in PL/pgSQL, 0-based
 * here). Returns null when the snapshot is not a usable 4-option array —
 * callers treat that as a corrupt session rather than guessing.
 */
export function deriveDisplayedOptions(
  optionsSnapshot: unknown,
  shuffleMap: number[] | null,
): string[] | null {
  let arr: unknown = optionsSnapshot;
  if (typeof arr === 'string') {
    try {
      arr = JSON.parse(arr);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr) || arr.length !== 4) return null;
  const opts = arr.map(o => (typeof o === 'string' ? o : String(o ?? '')));
  if (opts.some(o => o.trim() === '')) return null;

  if (
    !Array.isArray(shuffleMap) ||
    shuffleMap.length !== 4 ||
    !shuffleMap.every(n => Number.isInteger(n) && n >= 0 && n <= 3) ||
    new Set(shuffleMap).size !== 4
  ) {
    // Degenerate/absent map — identity order, same fallback the DB side uses.
    return opts;
  }
  return shuffleMap.map(orig => opts[orig]);
}

function clampSeconds(v: number | null | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 0;
  return Math.min(Math.floor(v), MAX_QUESTION_SECONDS);
}

/**
 * Deterministic resume order: every ANSWERED question first (oldest answer
 * first), then every unanswered one (stable by question_id).
 *
 * Why the original serve order is not preserved: `quiz_session_shuffles` has
 * no ordinal column, and all rows for one session share a single transaction
 * `created_at`, so it is not recoverable — and it does not need to be. The
 * student never saw the unanswered questions, and never returns to the
 * answered ones (the runtime has no backward navigation, and answered rows
 * are immutable server-side). Answered-first ordering makes "the right
 * question to resume at" exactly `answered_count`.
 */
export function orderResumeRows(rows: ShuffleResumeRow[]): ShuffleResumeRow[] {
  const answered = rows.filter(r => r.student_answered_at !== null);
  const pending = rows.filter(r => r.student_answered_at === null);
  answered.sort((a, b) => {
    const ta = Date.parse(a.student_answered_at ?? '') || 0;
    const tb = Date.parse(b.student_answered_at ?? '') || 0;
    if (ta !== tb) return ta - tb;
    return a.question_id.localeCompare(b.question_id);
  });
  pending.sort((a, b) => a.question_id.localeCompare(b.question_id));
  return [...answered, ...pending];
}

/**
 * Project raw snapshot rows + question metadata into the resume payload.
 *
 * PURE. No IO, no clock reads beyond what the caller passes. Every output
 * field is written explicitly from a whitelist — input rows are never spread
 * — so a future column added to either table cannot silently reach the client.
 *
 * ANTI-CHEAT ACROSS A RESUME (P3), stated explicitly:
 *   `elapsed_seconds` is the SUM OF PERSISTED PER-QUESTION TIMES, never
 *   `now - started_at`. The client seeds its total-time counter with it and
 *   keeps counting only while the quiz screen is actually mounted, so:
 *     - a student CANNOT bank wall-clock time by walking away for an hour and
 *       coming back — the gap contributes exactly zero to `p_time`, and the
 *       server's `p_time / total >= 3s` floor is unaffected; and
 *     - a legitimate resumer is NOT falsely flagged — without restoring these
 *       times the counter would restart at 0 and a quiz resumed near the end
 *       would submit an avg well under 3s, zeroing the XP of an honest
 *       student.
 *   Each per-question value was persisted at answer time by a separate
 *   authenticated request and is first-write-wins server-side, so it cannot be
 *   retro-edited after the fact.
 */
export function buildQuizResumePayload(
  sessionId: string,
  rows: ShuffleResumeRow[],
  questionsById: Map<string, QuestionBankResumeRow>,
): QuizResumeResult {
  if (rows.length === 0) return { resumable: false, reason: 'not_found' };

  // INSTRUMENT GATE — before any per-question work, because the answer here is
  // "do not resume this at all", not "resume it differently".
  const mode = resolveSessionMode(rows);
  if (mode === null) return { resumable: false, reason: 'mode_unknown' };
  if (mode === 'exam') return { resumable: false, reason: 'exam_not_resumable' };

  const ordered = orderResumeRows(rows);
  const questions: QuizResumeQuestion[] = [];

  for (const row of ordered) {
    const meta = questionsById.get(row.question_id);
    if (!meta) return { resumable: false, reason: 'corrupt' };

    const optionsDisplayed = deriveDisplayedOptions(row.options_snapshot, row.shuffle_map);
    if (!optionsDisplayed) return { resumable: false, reason: 'corrupt' };

    const answered = row.student_answered_at !== null;
    const picked = row.student_selected_displayed_index;
    const validPick =
      typeof picked === 'number' && Number.isInteger(picked) && picked >= 0 && picked <= 3;

    questions.push({
      question_id: row.question_id,
      question_text: meta.question_text ?? '',
      question_hi: meta.question_hi ?? null,
      question_type: meta.question_type ?? 'mcq',
      options_displayed: optionsDisplayed,
      explanation: meta.explanation ?? null,
      explanation_hi: meta.explanation_hi ?? null,
      hint: meta.hint ?? null,
      // VERBATIM, including NULL — see the field docs on QuizResumeQuestion.
      // Defaulting these to 2 / 'remember' made a resumed answer classify into
      // a DIFFERENT error_type than the identical fresh answer, corrupting
      // learner state as a function of interruption.
      difficulty: typeof meta.difficulty === 'number' ? meta.difficulty : null,
      bloom_level: typeof meta.bloom_level === 'string' ? meta.bloom_level : null,
      chapter_number: typeof meta.chapter_number === 'number' ? meta.chapter_number : 0,
      answered,
      selected_displayed_index: answered && validPick ? picked : null,
      time_spent_seconds: answered ? clampSeconds(row.student_time_spent_seconds) : null,
    });
  }

  const answeredCount = questions.filter(q => q.answered).length;
  if (answeredCount === 0) return { resumable: false, reason: 'not_started' };
  // Nothing left to do — the student answered everything but never submitted.
  // That is still resumable: they land on the last question's confirm state
  // and the runtime submits. Guard only against an empty question set.
  if (questions.length === 0) return { resumable: false, reason: 'corrupt' };

  const elapsedSeconds = questions.reduce((acc, q) => acc + (q.time_spent_seconds ?? 0), 0);

  // Subject/chapter for the CTA copy + the submit call. Taken from the first
  // question that declares one (a session is assembled from a single subject).
  const firstMeta = ordered
    .map(r => questionsById.get(r.question_id))
    .find(m => m && m.subject);
  const chapter = questions.find(q => q.chapter_number > 0)?.chapter_number ?? null;

  return {
    resumable: true,
    session_id: sessionId,
    // Narrowed by the instrument gate at the top of this function.
    mode,
    subject: firstMeta?.subject ?? '',
    chapter_number: chapter,
    total_questions: questions.length,
    answered_count: answeredCount,
    elapsed_seconds: elapsedSeconds,
    questions,
  };
}

/** True when the session's snapshot is older than the resume window. */
export function isResumeExpired(createdAt: string | null | undefined, now: Date): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t > RESUME_MAX_AGE_MS;
}

// ── Same-device breadcrumb (convenience only — never answer state) ────────

/**
 * localStorage key holding ONLY the in-flight session id, so returning to
 * `/quiz` on the same device offers "continue" without a round-trip through
 * the Today surface. It carries no answers, no options, and no correctness —
 * a tampered value simply produces a 403/`not_found` from the resume route.
 */
export const QUIZ_RESUME_BREADCRUMB_KEY = 'alfanumrik_quiz_resume_session';

export function writeResumeBreadcrumb(sessionId: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(QUIZ_RESUME_BREADCRUMB_KEY, sessionId);
  } catch {
    /* storage disabled / quota — resume still works via /today. */
  }
}

export function readResumeBreadcrumb(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(QUIZ_RESUME_BREADCRUMB_KEY);
  } catch {
    return null;
  }
}

export function clearResumeBreadcrumb(): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(QUIZ_RESUME_BREADCRUMB_KEY);
  } catch {
    /* no-op */
  }
}

// ── Client helpers (browser → the backend resume routes) ──────────────────

const RESUME_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isResumeSessionId(v: unknown): v is string {
  return typeof v === 'string' && RESUME_UUID_RE.test(v);
}

type AuthHeaderFn = () => Promise<Record<string, string>>;

/**
 * Persist ONE confirmed answer, immediately, on every quiz mode.
 * Fire-and-forget by contract: never blocks the quiz, never throws, and its
 * failure costs only resumability — grading still happens exactly once at
 * final submit, unchanged (P1/P2/P4 untouched).
 *
 * `mode` rides along on the SAME request, and the server stamps it onto the
 * same row in the SAME first-write-wins UPDATE. That coupling is the point:
 * a session becomes resumable only once it has ≥ 1 persisted answer, so there
 * is no interleaving in which a session is resumable but its instrument is
 * unknown. A separate "record the mode" call would have created exactly that
 * window — and an exam attempt whose mode write failed would have resumed
 * untimed, which is the defect this is closing.
 */
export async function saveQuizAnswerProgress(
  sessionId: string,
  questionId: string,
  selectedDisplayedIndex: number,
  timeSpentSeconds: number,
  authHeaderFn: AuthHeaderFn,
  mode: QuizSessionMode,
): Promise<boolean> {
  if (!isResumeSessionId(sessionId) || !isResumeSessionId(questionId)) return false;
  try {
    const res = await fetch(
      `/api/quiz/session/${encodeURIComponent(sessionId)}/progress`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaderFn()) },
        credentials: 'same-origin',
        body: JSON.stringify({
          questionId,
          selectedDisplayedIndex,
          timeSpentSeconds: clampSeconds(timeSpentSeconds),
          mode,
        }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch the resume payload for a session. Returns a blocked result (never
 * throws) on any failure so the caller can fall soft to the setup screen.
 */
export async function fetchQuizResume(
  sessionId: string,
  authHeaderFn: AuthHeaderFn,
): Promise<QuizResumeResult> {
  if (!isResumeSessionId(sessionId)) return { resumable: false, reason: 'not_found' };
  try {
    const res = await fetch(
      `/api/quiz/session/${encodeURIComponent(sessionId)}/progress`,
      {
        method: 'GET',
        headers: { ...(await authHeaderFn()) },
        credentials: 'same-origin',
      },
    );
    if (!res.ok) return { resumable: false, reason: 'not_found' };
    const json = (await res.json()) as { success?: boolean; data?: QuizResumeResult };
    if (!json?.success || !json.data) return { resumable: false, reason: 'not_found' };
    return json.data;
  } catch {
    return { resumable: false, reason: 'not_found' };
  }
}
