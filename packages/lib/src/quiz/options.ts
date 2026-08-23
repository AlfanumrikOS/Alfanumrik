/**
 * ALFANUMRIK — Canonical MCQ option primitives.
 *
 * ONE `parseOptions`. ONE `OPTION_LETTERS`. Every surface that renders a
 * four-option MCQ imports from here. Do not fork these, do not inline a
 * "quick" variant next to a new screen.
 *
 * WHY THIS EXISTS
 * ---------------
 * `parseOptions` had drifted into SEVEN copies and `OPTION_LETTERS` into
 * SEVEN more, spread across two packages:
 *
 *   parseOptions
 *     1. apps/host/src/app/(student)/quiz/page.tsx                       (LIVE quiz)
 *     2. apps/host/src/app/(student)/learn/[subject]/[chapter]/page.tsx
 *     3. apps/host/src/app/(student)/mock-exam/page.tsx
 *     4. apps/host/src/app/(student)/pyq/page.tsx
 *     5. apps/host/src/app/diagnostic/QuizScreen.tsx
 *     6. apps/host/src/app/tutor/page.tsx
 *     7. packages/ui/src/quiz/QuizResults.tsx
 *
 *   OPTION_LETTERS
 *     1-5 and 7 above, plus packages/ui/src/quiz/v2/PracticeRunner.tsx
 *
 * Copies 1-5 and 7 were byte-equivalent modulo formatting and the
 * declaration form (`function` vs `const` arrow, module-level vs
 * component-local):
 *
 *     if (Array.isArray(opts)) return opts;
 *     try { return JSON.parse(opts); } catch { return []; }
 *
 * Copy 6 (`/tutor`) was the ODD ONE OUT and is the superset this module
 * adopts. It differed on two axes:
 *
 *   (a) Parameter type `unknown` rather than `string | string[]`, with an
 *       explicit `typeof opts === 'string'` guard and a `return []` tail.
 *       The other six fed a non-string, non-array value straight into
 *       `JSON.parse`, which for `null` does NOT throw — `JSON.parse(null)`
 *       coerces to the literal string `"null"` and RETURNS `null`. So the
 *       six copies could return `null` from a function annotated
 *       `: string[]`, and the caller's `opts.map(...)` would throw a
 *       TypeError at render. `/tutor` returned `[]`. Unified on `[]`.
 *       `null` is out-of-contract for the six (their parameter type
 *       forbids it) and in-contract for `/tutor` (`practice_options` is a
 *       nullable column), so this changes no in-contract behaviour.
 *
 *   (b) `opts.map(String)` on the array branch rather than returning the
 *       array by reference. Kept. For a genuine `string[]` — which P6
 *       guarantees for every served question — `String(s) === s`, so the
 *       CONTENT is identical; only the array identity differs, and every
 *       one of the seven call sites consumes the result inline during
 *       render (no `useMemo`/`useEffect` dependency, no reference
 *       comparison), so identity is unobservable. Dropping the coercion
 *       would be a REGRESSION, for two independently sufficient reasons:
 *
 *         1. The quiz / learn / PracticeRunner render paths call
 *            `opt.replace(...)` — stripping the leading `A.`/`B)` option-
 *            letter prefix — on EVERY member. Verified call sites:
 *            `apps/host/src/app/(student)/quiz/page.tsx:1972`,
 *            `apps/host/src/app/(student)/learn/[subject]/[chapter]/page.tsx`
 *            lines 2083 and 2241, and
 *            `packages/ui/src/quiz/v2/PracticeRunner.tsx:254`.
 *            A non-string member would throw a TypeError at render.
 *         2. `/tutor` reads `chapter_concepts.practice_options`, a nullable
 *            `unknown` jsonb column, so non-string members are genuinely
 *            possible there and coercion is what makes rendering safe. That
 *            is why `/tutor` was the only one of the seven originals that
 *            already carried the guard. (`/tutor` itself renders `{opt}`
 *            directly as a React child at `apps/host/src/app/tutor/page.tsx:342`
 *            — it does NOT call `.replace()`, and per `git log -S` never did.)
 *
 * P6 / MARKING SAFETY
 * -------------------
 * This function sits directly on the served-question path. Option ORDER is
 * bound to the server-side shuffle snapshot and `selected_displayed_index`;
 * option COUNT is what P6 pins at exactly four. Therefore:
 *
 *   - `.map(String)` is index-preserving and 1:1 — it can never change the
 *     count or the order.
 *   - There is deliberately NO filtering of empty/duplicate members, NO
 *     trimming, NO truncation to four, and NO `Array.isArray` check on the
 *     `JSON.parse` result. All seven originals returned whatever
 *     `JSON.parse` produced, verbatim. Enforcing shape is the job of the
 *     P6 gate in `./question-validation`, NOT of this parser. Adding a
 *     filter here would silently change how many options render and
 *     corrupt marking.
 *
 * Any change to this file must keep count and order untouched.
 */

/** Display letters for the four MCQ options. Callers index by position and
 *  fall back to `String(idx + 1)` past D — preserved from all seven copies. */
export const OPTION_LETTERS: readonly string[] = Object.freeze(['A', 'B', 'C', 'D']);

/**
 * Minimal shape `isMcqQuestion` reads. Deliberately structural: the two
 * originals this unifies each declared their own local `Question` interface
 * (the quiz page's carries `cbse_type`, the learn page's does not), and
 * neither of those interfaces is exportable from a Next.js page module.
 */
export interface McqCandidate {
  question_type?: string | null;
  cbse_type?: string | null;
  options?: unknown;
  correct_answer_index?: unknown;
}

/**
 * Is this served question renderable as a four-option MCQ?
 *
 * ONE predicate. It had drifted into two copies, sitting on the two surfaces
 * that both serve `question_bank` rows to a student:
 *
 *   1. `apps/host/src/app/(student)/quiz/page.tsx`            → `isQuestionMCQ`
 *   2. `apps/host/src/app/(student)/learn/[subject]/[chapter]/page.tsx`
 *                                                            → `isLearnPageMCQ`
 *
 * Copy 2's own doc comment admitted it was a copy of copy 1 ("Mirrors the
 * check in src/app/quiz/page.tsx isQuestionMCQ()") — and it had already
 * drifted: copy 1 accepts `cbse_type === 'mcq'` as an explicit-type match,
 * copy 2 did not. This module adopts copy 1 (the SUPERSET). That widening is
 * unobservable on the learn surface, whose only feed —
 * `getChapterQuestions()` in `packages/lib/src/supabase.ts` — does not select
 * a `cbse_type` column at all, so the field is always `undefined` there.
 *
 * The shape branch delegates to `parseOptions` above rather than re-inlining
 * `Array.isArray(o) ? o : JSON.parse(o)`, which is what BOTH originals did.
 * That is a strict safety gain and no behaviour change for in-contract input:
 * for an array or a JSON string the two agree member-for-member, and for
 * `null` the originals reached `JSON.parse(null) === null` and then threw a
 * TypeError on `.length` — `parseOptions` returns `[]`.
 *
 * P6 NOTE: this is a RENDERABILITY test, not the quality gate. It answers
 * "can this be drawn as A/B/C/D?" so a short/long-answer row is never fed to
 * an option grid. The P6 contract (four DISTINCT non-empty options, non-empty
 * text, non-empty explanation) is enforced by `./question-validation`.
 *
 * ── KEYLESS SERVING (migration 20260814000023) ───────────────────────────────
 * The shape branch used to ALSO require `correct_answer_index` to be a number in
 * 0..3. That clause is removed, and its removal is a BUG FIX rather than a
 * loosening, for two independent reasons:
 *
 *   1. It was never a renderability signal. Whether a question can be drawn as
 *      A/B/C/D depends on having four options — not on which one is right. The
 *      module's own note above already said so; the clause contradicted it.
 *
 *   2. No serving path supplies the value any more. Every serving RPC and every
 *      direct `question_bank` projection stopped returning the answer key, and
 *      the server-shuffle / resume paths stamp the fail-loud `-1` sentinel. With
 *      the clause in place, a legacy row whose `question_type` is NULL — i.e.
 *      exactly the row shape detection exists FOR — would have been classified
 *      NON-MCQ and rendered in a written-answer box. The same was already true
 *      for any `-1`-stamped resumed question whose snapshot carried a NULL
 *      `question_type`.
 *
 * The rule the clause was standing in for — "correct_answer_index is present
 * and in 0..3" — is still enforced, in two places that cannot be bypassed by a
 * client: `public.question_bank_p6_valid` filters it out of every serving RPC,
 * and `start_quiz_session` refuses to snapshot a row that fails it. The
 * TypeScript gate in `./question-validation` still rejects a PRESENT-but-
 * out-of-range index too.
 */
export function isMcqQuestion(q: McqCandidate | null | undefined): boolean {
  if (!q) return false;
  if (q.question_type === 'mcq' || q.cbse_type === 'mcq') return true;
  return parseOptions(q.options).length === 4;
}

/**
 * Parse a question's `options` column into a renderable array.
 *
 * Accepts the two shapes the DB actually hands back — a real array, or a
 * JSON-encoded string — and returns `[]` for anything else (including
 * `null`/`undefined`) rather than throwing.
 *
 * Returns the `JSON.parse` result VERBATIM when given a string: a malformed
 * payload that parses to a non-array (e.g. `'"abc"'`, `'5'`, `'{}'`) is
 * returned as-is, exactly as all seven originals did. Shape validation
 * belongs to the P6 gate, not here.
 */
export function parseOptions(opts: unknown): string[] {
  if (Array.isArray(opts)) return opts.map(String);
  if (typeof opts === 'string') {
    try {
      return JSON.parse(opts) as string[];
    } catch {
      return [];
    }
  }
  return [];
}
