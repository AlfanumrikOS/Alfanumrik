# Student Learning Core — Implementation (Cycle 3, auto-fix-safe set)

**Audit cycle:** Cycle 3 (IMPLEMENTATION) · **Owner:** frontend (SLC-7) + testing (SLC-2/3/6/8-pin) · **Date:** 2026-06-29
**Implemented here:** SLC-7 (frontend), SLC-2 / SLC-3 / SLC-6 / SLC-8-pin (testing).
**Validation:** `npm run type-check` → clean; `npm run lint` → 0 errors; 40/40 new + ~1678 broad
quiz/xp/scoring tests PASS; `npm run build` → PASS, bundle within P10 caps.

No score formula, XP value (10/20/50/200), or anti-cheat threshold (3s / >3 / count) was touched anywhere.
No schema / RLS / migration / RPC / feature flag was touched.

---

## SLC-7 — Wire the dead P6 `isValidQuestion` gate into `startQuiz` (frontend)

**File:** `src/app/quiz/page.tsx`

**Before** — `isValidQuestion(q)` was *defined* (`:419-433`: rejects text < 5 chars, `{{`, `[BLANK]`; for
MCQ requires exactly 4 non-empty options + `correct_answer_index` in 0..3) but **never called** in
`startQuiz`. `displayQuestions` was built straight from `assembleQuiz` output + the server-shuffle merge,
with no `.filter(isValidQuestion)` — dead defense-in-depth.

**After** — inside `startQuiz`, the assembled question set is filtered through `isValidQuestion` **before**
it becomes the served set, and **all three downstream artifacts derive from the SAME filtered list**:
1. **`mcqIds`** — the id list handed to `startQuizSession` for the server-shuffle snapshot is built from
   the filtered set, so the `quiz_session_shuffles` snapshot covers exactly the served questions.
2. **`displayQuestions`** — the student sees only filtered questions.
3. **submitted / expected set** — the per-question response payload and the P3 count check both run over
   the same filtered count.

Behavior:
- **Zero valid questions after filter** → `startQuiz` aborts before opening a server session and renders a
  **bilingual** error state (Hi/En via `AuthContext.isHi`). No `start_quiz_session` call, no DB write.
- **Partial removal** → proceeds with the valid subset; because all three artifacts come from one filtered
  array, `responses.length === questions.length` still holds and the server re-derives the score over
  exactly the snapshotted set.
- **Dropped-item logging** → a **PII-free** `console.warn` carrying question id + drop reason only (no
  student identity / answers) → P13 preserved.

**Why P1/P4 served-count consistency is preserved (the load-bearing rationale):**
The only mechanism by which adding a filter could break P1 (score) or P4 (atomic submission) is a
**count divergence** between the served set, the shuffle-snapshot set, and the submitted set. This change
forbids that by construction: `mcqIds`, `displayQuestions`, and the submitted/expected set are **all
derived from the single filtered array**. Therefore:
- the server still snapshots exactly the questions the student answers (`start_quiz_session` over filtered
  `mcqIds`),
- the P3 count check `responses.length === questions.length` still passes for a clean attempt,
- the server still re-derives `score_percent = ROUND((correct/total)*100)` over the snapshotted set, and
- the single in-transaction `atomic_quiz_profile_update` call is unchanged.

This was **independently verified by quality** as part of the APPROVE verdict. The change is purely
additive: it removes malformed items *before* serving and never alters the scoring of a valid question.

---

## SLC-2 — XP earning-literal parity guard (testing)

**File (new):** `xp-sql-literal-parity.test.ts`

**What it pins:** the P2 XP **earning** literals SQL↔TS across **every root migration** — asserts the
per-correct (`10`), high-score-bonus (`20`), and perfect-bonus (`50`) literals in each quiz-XP award
expression equal `XP_RULES.quiz_per_correct` / `quiz_high_score_bonus` / `quiz_perfect_bonus` read from
`xp-config.ts`. Closes the documented REG-48 gap (REG-48 guarded only the **cap** arithmetic + the
`quiz_daily_cap === 200` anchor; the three earning literals were unguarded). Per SLC-10, the guard targets
the live function bodies across all root migrations, not just the baseline snapshot.
**Regression filed → REG-181.** Test-only; no value changed.

---

## SLC-3 — Three-way P1 score-formula parity guard (testing)

**File (new):** `score-formula-three-way-parity.test.ts`

**What it pins:** P1 score-formula identity end-to-end —
- source-inspects the canonical `Math.round((correct/total)*100)` (TS `scoring.ts`) and
  `ROUND((correct/total)*100)` (SQL **v1** + **v2** RPCs) and asserts the byte-pattern is present at all
  three computing sites;
- asserts `QuizResults.tsx` **consumes** `results.score_percent` and never recomputes the headline score;
- a property check asserting `Math.round` (half-up) and a PG-`ROUND` model (half-away-from-zero) agree on
  all `0..100` non-negative inputs — converting the previously comment-only equivalence into an executable
  assertion that catches a future `ROUND(x,2)` / floor / negative-intermediate divergence.
**Regression filed → REG-180.** Test-only; no value changed.

---

## SLC-6 — Pin the intended P3 pattern-flag asymmetry (testing)

**File (new):** `quiz-pattern-flag-intended-behavior.test.ts`

**What it pins:** the INTENDED P3 asymmetry on **both** client and server — pattern check (all-same-index,
`>3` MCQ) → **FLAG** (warn + submit; server records the row with XP 0), while speed (`<3s` avg) and
count-mismatch → **REJECT** (client short-circuits before any server call). Locks the deliberate
flag-vs-reject split so a future "tighten anti-cheat" edit can't silently flip pattern to reject. A
**balanced-brace robustness fix** was applied to the source matcher so the assertion isn't defeated by
formatting. Test-only; no threshold changed.

---

## SLC-8 (pin) — Current keyless-submit + no-double-XP contract pin (testing)

**File (new):** `quiz-submit-idempotency-contract-pin.test.ts`

**What it pins:** the **current** (pre-cutover) contract — the live client submits via
`submit_quiz_results_v2` directly (no Idempotency-Key), and the 7-arg RPC's
`reference_id = quiz_<session_id>` `ON CONFLICT DO NOTHING` prevents **double XP** on replay. Carries an
**honest FIXME** documenting the residual gap: a duplicate `quiz_sessions` row can still be inserted by v2
before the cap step even though XP is not double-awarded — that closes only when the SLC-8 **cutover**
(flip `ff_server_only_quiz_submit`) lands (gated, backend/architect). Test-only; pins reality, does not
fix it.

---

## Files touched (by builders, outside this doc-only finalization)

| File | Gap | Type |
|---|---|---|
| `src/app/quiz/page.tsx` | SLC-7 | frontend app code (wire P6 filter into `startQuiz`) |
| `xp-sql-literal-parity.test.ts` | SLC-2 | new test (→ REG-181) |
| `score-formula-three-way-parity.test.ts` | SLC-3 | new test (→ REG-180) |
| `quiz-pattern-flag-intended-behavior.test.ts` | SLC-6 | new test (+ brace-robustness fix) |
| `quiz-submit-idempotency-contract-pin.test.ts` | SLC-8 (pin) | new test (honest FIXME) |

---

## Self-review (implementation squad)

- **P1 score formula:** untouched at all three computing sites; SLC-3 now *guards* it. SLC-7 preserves
  served-count consistency by construction (one filtered array feeds `mcqIds` + `displayQuestions` +
  submitted set). ✔
- **P2 XP economy:** no literal (10/20/50) or cap (200) changed; SLC-2 now *guards* the earning literals.
  ✔
- **P3 anti-cheat:** thresholds (3s / >3 / count) unchanged; SLC-6 *pins* the intended flag-vs-reject
  asymmetry. ✔
- **P4 atomic submission:** the single in-transaction `atomic_quiz_profile_update` call is unchanged;
  SLC-7's count-consistency keeps `responses.length === questions.length`. ✔
- **P5 grade format:** untouched — `student.grade` still flows as a string. ✔
- **P6 question quality:** *strengthened* — the previously-dead `isValidQuestion` gate is now live at the
  render boundary (last-line defense-in-depth) without weakening the server-side snapshot guarantee. ✔
- **P7 bilingual:** SLC-7 zero-valid error state is Hi/En via `AuthContext.isHi`. ✔
- **P13 privacy:** SLC-7 drop-log is PII-free (question id + reason only). ✔
- **No schema / RLS / migration / RPC / flag touched;** SLC-2/3/6/8-pin are test-only. ✔
- **Gates:** type-check PASS, lint 0 errors, 40/40 new + ~1678 broad tests PASS, build PASS, bundle within
  P10 caps. ✔

**Deferred to review chain (P14):** assessment (audit/correctness sign-off) → frontend (impl) + testing
(coverage) + quality (independent APPROVE). See `06-self-review.md` / `07-validation.md` / `08-regression.md`.

**Gated / cross-agent (NOT implemented — see `04-solution-design.md`):** SLC-1 (architect + assessment,
USER-GATED), SLC-4 (architect / backend), SLC-5 (assessment → backend), SLC-8 cutover (backend / architect).
