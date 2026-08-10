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
