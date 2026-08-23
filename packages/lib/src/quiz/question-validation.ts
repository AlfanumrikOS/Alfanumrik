/**
 * ALFANUMRIK — Canonical P6 question quality gate.
 *
 * ONE validator. Every path that serves a question to a student runs THIS
 * function. Do not fork it, do not inline a "quick" variant, do not relax a
 * check at a call site.
 *
 * WHY THIS EXISTS
 * ---------------
 * The P6 gate had drifted into three divergent copies and the one on the LIVE
 * quiz path was the weakest of the three:
 *
 *   - `quiz-assembler.ts`  (LIVE — imported by the student quiz page)
 *   - `domains/quiz.ts`
 *   - `supabase.ts`
 *
 * Divergences that shipped:
 *   1. quiz-assembler used `idx < 0 || idx > 3` with NO null guard. In JS both
 *      `null < 0` and `null > 3` are `false`, so a NULL `correct_answer_index`
 *      sailed through the live gate and was treated as index 0 downstream —
 *      i.e. the student was marked against an answer key that did not exist.
 *      The 2026-07-29 forensic audit fixed this in the other two copies only.
 *   2. quiz-assembler and domains/quiz accepted `>= 3` distinct options;
 *      supabase.ts required `>= 4`. P6 mandates exactly FOUR distinct
 *      non-empty options — 4 is correct, 3 let a duplicated distractor through.
 *   3. Only domains/quiz checked `bloom_level`.
 *   4. Only supabase.ts carried the full garbage-text pattern set and the
 *      "explanation is too terse to be educational" word-count floor.
 *
 * This module is the STRICT UNION of every ANSWERABILITY / GRADEABILITY check
 * from every copy, at its strictest setting. Two axes are deliberately NOT
 * unioned-on-by-default — see `allowNonMcq` (shape contract) and
 * `enforceBloomLevel` (metadata tag) for each, and why.
 *
 * The dividing line: a check earns "on by default on the serving path" only if
 * failing it means the question cannot be ANSWERED or GRADED correctly. A
 * missing/variant `bloom_level` degrades a mastery heatmap; dropping the row
 * removes the question from the student entirely. That trade is backwards, so
 * bloom validity is opt-in (`enforceBloomLevel`) rather than always-on.
 *
 * P6 (product invariant, verbatim): "Every served question: non-empty text
 * (no `{{`/`[BLANK]`), exactly 4 distinct non-empty options,
 * `correct_answer_index` 0-3, non-empty explanation, valid difficulty and
 * bloom_level."
 *
 * OWNER: assessment agent. Changes here require the P6 review chain
 * (testing + ai-engineer, since quiz-generator's own validation must agree).
 */

import { BLOOM_LEVELS_ORDERED } from '@alfanumrik/lib/score-config';

// ── Canonical Bloom's set ─────────────────────────────────────────────────────
// Sourced from score-config (a zero-dependency constants module) rather than
// cognitive-engine, so that importing the P6 gate does not drag the 1400-LOC
// cognitive engine into every bundle that serves a question.
const VALID_BLOOM_LEVELS: ReadonlySet<string> = new Set<string>(BLOOM_LEVELS_ORDERED);

// ── Garbage content patterns ──────────────────────────────────────────────────
// These are the fingerprints of template-filler and hallucinated questions that
// have actually reached production. Union of all three former copies.

/** Question-text openers that indicate a content-free template question. */
const GARBAGE_TEXT_RULES: ReadonlyArray<(text: string) => boolean> = [
  t => t.includes('unrelated topic'),
  t => t.startsWith('a student studying') && t.includes('should focus on'),
  t => t.startsWith('which of the following best describes the main topic'),
  t => t.startsWith('why is') && t.includes('important for grade'),
  t => t.startsWith('the chapter') && t.includes('most closely related to which area'),
  t => t.startsWith('what is the primary purpose of studying'),
];

/** Substrings that mark an option as filler rather than a real distractor. */
const GARBAGE_OPTION_SUBSTRINGS: readonly string[] = [
  'unrelated topic',
  'physical education',
  'art and craft',
  'music theory',
  'it is not important',
  'no board exam',
];

/**
 * Substrings that mark an explanation as self-contradicting — the model told us
 * the key is wrong. Serving these means grading a student against an answer the
 * explanation itself disputes.
 */
const UNRELIABLE_EXPLANATION_SUBSTRINGS: readonly string[] = [
  'does not match any option',
  'suggesting a possible error',
  'assuming a typo',
  'not listed',
  'however, the correct',
  'this is incorrect',
  'none of the options',
  'there seems to be',
  'closest plausible',
];

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Minimum question-text length. Shorter than this is a stub, not a question. */
export const MIN_QUESTION_TEXT_LENGTH = 15;
/** Minimum explanation length in characters. */
export const MIN_EXPLANATION_LENGTH = 20;
/** Minimum explanation length in words — below this it cannot teach anything. */
export const MIN_EXPLANATION_WORDS = 8;
/** P6: exactly four options, and all four must be distinct. */
export const REQUIRED_OPTION_COUNT = 4;
/** Minimum `expected_answer` length for non-MCQ types (see `allowNonMcq`). */
const MIN_EXPECTED_ANSWER_LENGTH = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Machine-readable rejection reason, for observability. Callers log these so a
 * content gap is diagnosable without re-running the validator by hand.
 *
 * `${number}_options` is emitted for a wrong option count (e.g. `3_options`).
 *
 * This is a CLOSED union on purpose. It previously ended in `(string & {})`,
 * which collapses the whole union to `string` for assignability — a typo'd
 * reason then compiles silently and no exhaustive `switch` over the reasons can
 * ever be checked. Adding a reason means adding it here.
 */
export type QuestionRejectionReason =
  | 'null_question'
  | 'empty_text'
  | 'text_too_short'
  | 'template_marker'
  | 'garbage_text'
  | 'invalid_bloom_level'
  | `${number}_options`
  | 'empty_option'
  | 'missing_answer_index'
  | 'bad_answer_index'
  | 'garbage_option'
  | 'duplicate_options'
  | 'missing_expected_answer'
  | 'weak_explanation'
  | 'terse_explanation'
  | 'unreliable_explanation'
  | 'duplicate_question';

export interface QuestionValidationResult {
  valid: boolean;
  /** Present only when `valid` is false. */
  reason?: QuestionRejectionReason;
}

export interface ValidateQuestionOptions {
  /**
   * When true, MCQ *shape* checks (4 options + `correct_answer_index`) are
   * applied only to rows whose `question_type_v2`/`question_type` is `mcq`;
   * other types are instead required to carry an `expected_answer` or a usable
   * explanation for the grader.
   *
   * This is the ONE axis that is not unioned across the three former copies,
   * and that is deliberate:
   *   - `quiz-assembler` (live path) gates on type. That was a considered
   *     2026-05-09 fix — before it, the unconditional MCQ-shape checks rejected
   *     100% of short/long-answer questions.
   *   - `supabase.ts` and `domains/quiz.ts` did NOT gate, so on those paths a
   *     non-MCQ row has always been rejected.
   *
   * Defaulting to `false` preserves each caller's existing posture exactly:
   * no path silently starts serving a question shape its UI cannot render.
   * Every actual QUALITY check is identical on all paths regardless of this
   * flag — this only selects which shape contract applies.
   */
  allowNonMcq?: boolean;

  /**
   * When true, `bloom_level` must be one of the canonical six (case- and
   * whitespace-insensitive). When false/omitted, `bloom_level` is NOT validated
   * and a row with a NULL, empty, or variant tag is served normally.
   *
   * DEFAULT: `false` (OFF). This default is chosen so that the SAFE behaviour is
   * what you get by forgetting to pass the option:
   *   - Forgetting it on a SERVING caller → the question is still served. A
   *     stale bloom tag degrades one heatmap cell. Recoverable, invisible to
   *     the student's ability to answer.
   *   - Forgetting it on an INGESTION caller → an untagged row lands in the
   *     bank and is later backfillable. Also recoverable.
   * The inverse default fails the other way: forgetting it on a serving caller
   * silently deletes questions from a chapter and shows the student
   * "No questions available for this chapter yet" on the #1 student surface.
   * Metadata completeness is never worth an empty quiz.
   *
   * WHY THIS IS NOT UNIONED ON: of the checks in this module, bloom validity is
   * the only one with ZERO bearing on whether a question is ANSWERABLE or
   * GRADEABLE. Every other check guards the answer key, the option set, or the
   * explanation the student is graded and taught against.
   *
   * WHY IT IS UNSAFE TO TURN ON BLIND: `question_bank.bloom_level` is `text`,
   * NULLABLE, with no DEFAULT and no CHECK constraint. The schema's own idioms
   * assume non-canonical values exist — the baseline does
   * `COALESCE(v_q.bloom_level, 'recall')`, and `'recall'` is not one of the
   * canonical six. No live serving path has ever filtered on bloom validity:
   * `quiz-generator`'s "Fallback 2: relax bloom constraint" branch drops its
   * `.in('bloom_level', …)` filter outright, `select_quiz_questions_rag` and
   * `select_quiz_questions_v2` pass the column through unfiltered, and the
   * direct `question_bank` query in `getQuizQuestions()` does not filter it.
   * Enforcing here would therefore be a NEW rejection on the live path with an
   * unmeasured blast radius.
   *
   * TODO(assessment): flip this default to ON (or delete the option and make
   * the check unconditional) once — and ONLY once — the corpus is measured or
   * backfilled. Flip condition, either:
   *   (a) the census below shows ~0 offending active rows, or
   *   (b) a backfill migration has populated/normalised the column and a CHECK
   *       constraint pins it going forward.
   *
   *   SELECT count(*) FILTER (WHERE bloom_level IS NULL)                AS null_bloom,
   *          count(*) FILTER (WHERE bloom_level NOT IN (
   *            'remember','understand','apply','analyze','evaluate','create'
   *          ))                                                          AS variant_bloom,
   *          count(*)                                                    AS total
   *     FROM question_bank
   *    WHERE is_active;
   *
   * Until then: ON for ingestion/authoring/validation callers (reject a badly
   * tagged row BEFORE it enters the bank, where rejection costs nothing to a
   * student), OFF for every serving caller.
   */
  enforceBloomLevel?: boolean;

  /**
   * The row came from a KEYLESS serving path — one where the server has already
   * enforced the `correct_answer_index` half of P6 and then deliberately
   * withheld the column, so the client cannot see it.
   *
   * WHAT THIS DOES, PRECISELY: an ABSENT (`null`/`undefined`) answer index stops
   * being a rejection. A PRESENT one is still validated exactly as before —
   * still must be an integer in 0..3, still rejected otherwise. So this option
   * can only ever affect rows that carry no index at all, and it never lets a
   * *bad* index through.
   *
   * WHY IT IS NOT A WEAKENING OF P6 (read this before setting it):
   * Before migration 20260814000023, `question_bank.correct_answer_index` was
   * shipped to the browser on every serving path — the whole ~12.8k-row answer
   * key was one `select=` away for any signed-in student. The ONLY reason it was
   * shipped is the check on lines below: the browser needed the key to prove the
   * question was gradeable. That migration moved the check to the server
   * (`public.question_bank_p6_valid`, applied as a filter inside
   * `select_quiz_questions_rag` / `select_quiz_questions_v2` /
   * `get_quiz_questions`, and as a hard skip inside `start_quiz_session`, which
   * is the last server checkpoint every direct-`question_bank` student path
   * funnels through). The rule is enforced in strictly MORE places than before —
   * it now also rejects rows the client never receives — and it is enforced
   * where it cannot be bypassed by a modified client.
   *
   * SET IT ONLY WHEN BOTH ARE TRUE:
   *   1. the rows came from a server path that runs `question_bank_p6_valid`, and
   *   2. that path does not return `correct_answer_index`.
   * Ingestion, authoring, super-admin CMS and quiz-generator validation callers
   * MUST NOT set it: they hold the real row, the key is present and mandatory
   * there, and a missing key at ingest time is a genuine defect to reject.
   *
   * DEFAULT: `false` (OFF) — i.e. forgetting it keeps the strictest behaviour.
   */
  keylessServing?: boolean;
}

// ── Single-question validation ────────────────────────────────────────────────

/**
 * The P6 gate. Returns `{ valid: false, reason }` so callers can log WHY a
 * question was dropped instead of silently shrinking the quiz.
 *
 * Accepts `unknown` on purpose: rows arrive from four different sources (Edge
 * Function JSON, two RPCs, and a direct table query) with no shared type.
 */
export function validateQuestion(
  q: unknown,
  options: ValidateQuestionOptions = {},
): QuestionValidationResult {
  if (!q || typeof q !== 'object') return { valid: false, reason: 'null_question' };

  const row = q as Record<string, unknown>;

  // ── Question text ───────────────────────────────────────────────────────────
  const questionText = row.question_text;
  if (!questionText || typeof questionText !== 'string')
    return { valid: false, reason: 'empty_text' };
  if (questionText.length < MIN_QUESTION_TEXT_LENGTH)
    return { valid: false, reason: 'text_too_short' };
  if (questionText.includes('{{') || questionText.includes('[BLANK]'))
    return { valid: false, reason: 'template_marker' };

  const text = questionText.toLowerCase();
  if (GARBAGE_TEXT_RULES.some(rule => rule(text)))
    return { valid: false, reason: 'garbage_text' };

  // ── Bloom's level (P6: "valid ... bloom_level") — OPT-IN ─────────────────────
  // OFF unless the caller passes `enforceBloomLevel: true`. See the long note on
  // that option for why serving callers must NOT enforce this yet: the column is
  // nullable with no CHECK, no live path has ever filtered on it, and rejecting
  // an otherwise-answerable row over a metadata tag can empty a whole chapter.
  //
  // When enforced, the value is compared case-insensitively against the
  // canonical six. British "analyse" and any other spelling variant is REJECTED
  // on purpose — the Bloom's code is a key into bloom_progression and mastery
  // reporting, so a variant spelling silently forks the learner's heatmap.
  if (options.enforceBloomLevel) {
    const bloomLevel = row.bloom_level;
    if (
      typeof bloomLevel !== 'string' ||
      !VALID_BLOOM_LEVELS.has(bloomLevel.trim().toLowerCase())
    ) {
      return { valid: false, reason: 'invalid_bloom_level' };
    }
  }

  // ── Shape ───────────────────────────────────────────────────────────────────
  const declaredType = String(row.question_type_v2 ?? row.question_type ?? 'mcq').toLowerCase();
  const requireMcqShape = !options.allowNonMcq || declaredType === 'mcq';

  if (requireMcqShape) {
    const opts: unknown[] = Array.isArray(row.options) ? row.options : [];

    if (opts.length !== REQUIRED_OPTION_COUNT)
      return { valid: false, reason: `${opts.length}_options` };

    // P6: all four options non-empty.
    if (opts.some(o => !o || String(o).trim() === ''))
      return { valid: false, reason: 'empty_option' };

    const answerIndex = row.correct_answer_index;
    // P6 / forensic-audit fix: `null < 0` and `null > 3` are BOTH false in JS,
    // so the null guard must come first or a keyless question passes the gate.
    //
    // `keylessServing` (migration 20260814000023) is the ONE case where an
    // ABSENT index is legitimate: the server ran `question_bank_p6_valid` and
    // then withheld the column so the browser can no longer harvest the answer
    // key. See the option's doc comment for why that is stronger, not weaker.
    // A PRESENT index is validated identically either way — the range check
    // below is NEVER skipped.
    if (answerIndex == null) {
      if (!options.keylessServing)
        return { valid: false, reason: 'missing_answer_index' };
    } else if (
      typeof answerIndex !== 'number' ||
      !Number.isInteger(answerIndex) ||
      answerIndex < 0 ||
      answerIndex > REQUIRED_OPTION_COUNT - 1
    ) {
      return { valid: false, reason: 'bad_answer_index' };
    }

    const optTexts = opts.map(o => String(o ?? '').toLowerCase().trim());
    if (optTexts.some(o => GARBAGE_OPTION_SUBSTRINGS.some(bad => o.includes(bad))))
      return { valid: false, reason: 'garbage_option' };

    // P6: exactly four DISTINCT options. (The old live path accepted 3 distinct,
    // which let a duplicated distractor reduce a 4-way MCQ to a 3-way guess.)
    if (new Set(optTexts).size < REQUIRED_OPTION_COUNT)
      return { valid: false, reason: 'duplicate_options' };
  } else {
    // short_answer / long_answer / ncert — the grader needs SOMETHING to mark
    // against. Fall back to the explanation when expected_answer is unpopulated.
    const expected = String(row.expected_answer ?? '').trim();
    const explanationText = String(row.explanation ?? '').trim();
    if (
      expected.length < MIN_EXPECTED_ANSWER_LENGTH &&
      explanationText.length < MIN_EXPLANATION_LENGTH
    ) {
      return { valid: false, reason: 'missing_expected_answer' };
    }
  }

  // ── Explanation (required for every type) ───────────────────────────────────
  const explanation = row.explanation;
  if (!explanation || typeof explanation !== 'string' || explanation.length < MIN_EXPLANATION_LENGTH)
    return { valid: false, reason: 'weak_explanation' };

  if (explanation.trim().split(/\s+/).length < MIN_EXPLANATION_WORDS)
    return { valid: false, reason: 'terse_explanation' };

  const expl = explanation.toLowerCase();
  if (UNRELIABLE_EXPLANATION_SUBSTRINGS.some(bad => expl.includes(bad)))
    return { valid: false, reason: 'unreliable_explanation' };

  return { valid: true };
}

// ── Batch validation ──────────────────────────────────────────────────────────

/**
 * Filter a batch through the P6 gate and drop within-batch duplicates
 * (same normalised question text). Order is preserved; the first occurrence of
 * a duplicated text wins.
 *
 * Returns the SAME element type it was given, so callers keep their row typing.
 */
export function validateQuestions<T>(
  questions: readonly T[],
  options: ValidateQuestionOptions = {},
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];

  for (const q of questions) {
    if (!validateQuestion(q, options).valid) continue;

    const key = String((q as { question_text?: unknown }).question_text ?? '')
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }

  return out;
}
