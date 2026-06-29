# Student Learning Core — Solution Design (Cycle 3, auto-fix-safe set)

**Audit cycle:** Cycle 3 (SOLUTION DESIGN) · **Owner:** Assessment (lead) + frontend + testing · **Date:** 2026-06-29
**Invariants under design:** P1 (Score accuracy), P2 (XP economy), P3 (Anti-cheat), P4 (Atomic submission),
P5 (Grade format), P6 (Question quality) — all **preserved verbatim**. No score formula, XP value, or
anti-cheat threshold is changed anywhere in this design.

This document designs only the **auto-fix-safe** subset of Cycle-3 (SLC-2, SLC-3, SLC-6, SLC-7, and the
SLC-8 idempotency *pin*). The four HIGH/MEDIUM behavior-or-schema gaps (SLC-1, SLC-4, SLC-5, and the
SLC-8 *cutover*) are explicitly **GATED / cross-agent** and are recorded at the end with owners — they are
NOT implemented this cycle. SLC-9 (coverage ratchet) and SLC-10 (informational) are tracked, not actioned.

---

## Scope

| ID | Title | Class | Owner | Designed here |
|---|---|---|---|---|
| SLC-7 | `isValidQuestion` P6 gate defined but not invoked in serve path | AUTO-FIX-SAFE | **frontend** | Yes |
| SLC-2 | P2 XP earning literals (10/20/50) duplicated across SQL bodies (drift risk) | AUTO-FIX-SAFE (test) | **testing** | Yes |
| SLC-3 | No mechanical P1 three-way score-formula parity guard | AUTO-FIX-SAFE (test) | **testing** | Yes |
| SLC-6 | Pattern check (P3 #2) is FLAG-only by design — asymmetry unpinned | AUTO-FIX-SAFE (test) | **testing** | Yes |
| SLC-8 (pin) | Live client bypasses idempotency-keyed `/api/quiz/submit`; double-submit risk | AUTO-FIX-SAFE (test) | **testing** | Yes (pin only) |

**GATED / cross-agent — excluded from this cycle (recorded below with owners):**
SLC-1 (second uncapped XP writer — DB trigger; **architect + assessment**, USER-GATED), SLC-4 (dual
daily-cap implementation + column mismatch; **architect / backend**), SLC-5 (server records flagged
submissions vs client true-reject; **assessment → backend**), SLC-8 cutover (flip
`ff_server_only_quiz_submit`; **backend / architect**).

---

## Design per gap

### SLC-7 — Wire the dead P6 `isValidQuestion` gate into the serve path (frontend)
**Root cause (from 03):** the render-boundary P6 gate (`quiz/page.tsx:419-433`) was written but its
`.filter(isValidQuestion)` wiring was dropped during the server-shuffle-authority refactor; P6 enforcement
became solely upstream (quiz-generator oracle REG-54 + DB constraints). The validator is live code that
protects nothing.

**Design:** invoke the existing validator inside `startQuiz`, filtering the **assembled** question set
*before* it becomes the served set — and crucially derive **every** downstream artifact from the SAME
filtered list so P1/P4 served-count consistency is preserved:
- `mcqIds` (the list handed to `startQuizSession` for the server-shuffle snapshot),
- `displayQuestions` (what the student sees),
- the submitted/expected response set (count check + per-question payload).

Behavior contract:
- **Zero valid questions after filter** → do not start; render a **bilingual** (P7) error state
  (Hi/En via `AuthContext.isHi`); no server session is opened.
- **Partial removal** (some malformed, some valid) → proceed with the valid subset; the count the student
  answers, the count snapshotted server-side, and the count submitted all equal the filtered count.
- **Dropped item logging** → a **PII-free** `console.warn` (question id / reason only — never student
  identity), so an upstream contract break is observable without violating P13.

**Why P1/P4 preserved:** the only way wiring a filter could break P1/P4 is if the served set, the
shuffle-snapshot set, and the submitted set diverged in count. The design forbids that by construction —
all three derive from one filtered array, so `responses.length === questions.length` still holds and the
server still re-derives the score over exactly the snapshotted set. The score formula and the atomic RPC
call are untouched. This is purely additive defense-in-depth: it can only *remove a malformed item before
serving*, never alter scoring of a valid one.

**Alternatives considered:**
- *Assert-in-dev only (throw on malformed).* Rejected — a production student hitting an upstream glitch
  would get a crash instead of a clean degrade; the audit asks for a last-line gate, not a tripwire.
- *Filter only `displayQuestions` but keep `mcqIds` from the unfiltered set.* Rejected — that is exactly
  the count-divergence that would threaten P1/P4. The shuffle snapshot must be built from the filtered set.
- *Move the gate server-side into the RPC.* Rejected for this cycle — that is a schema/behavior change
  (gated, backend-owned). The cheapest correct fix is to revive the client gate that already exists; the
  server snapshot already protects scoring integrity independently.

### SLC-2 — Parity guard for the P2 XP earning literals (testing)
**Root cause (from 03):** the TS XP economy is single-sourced (`xp-config.ts:44-47` behind the
`xp-rules.ts` shim), but the SQL side re-types `10 / 20 / 50` inline in ~9 function bodies. REG-48 only
guards the **cap** arithmetic + the `quiz_daily_cap === 200` anchor — the three *earning* literals are
unguarded.

**Design:** a source-inspection parity test (`xp-sql-literal-parity.test.ts`) that reads every root
migration SQL body containing a quiz-XP award expression and asserts the per-correct / high-score-bonus /
perfect-bonus literals equal `XP_RULES.quiz_per_correct` (10), `XP_RULES.quiz_high_score_bonus` (20),
`XP_RULES.quiz_perfect_bonus` (50) read from `xp-config.ts`. Test-only; changes no value. Closes the
REG-48 gap (cap-only → cap + earning literals). Files a regression entry → **REG-181**.

**Alternatives considered:**
- *Wait for the SQL `xp_constants()` single-source refactor (architect).* Rejected as the *only* action —
  that is a real (gated) DB change; the parity guard delivers protection today with zero schema risk and
  remains useful even after the refactor lands.
- *Grep only the baseline.* Rejected — per SLC-10 the latest migration is what's live; the guard targets
  the live function bodies across all root migrations, not just the pg_dump snapshot.

### SLC-3 — Three-way P1 score-formula parity guard (testing)
**Root cause (from 03):** P1 parity is upheld by discipline + comments, not by an executable assertion
comparing the three computing sites (`scoring.ts:18`, v1 RPC, v2 RPC) and the consume-not-recompute
display site.

**Design:** `score-formula-three-way-parity.test.ts` — (a) source-inspect the canonical
`ROUND((correct/total)*100)` / `Math.round((correct/total)*100)` expression at all three computing sites
(TS `scoring.ts`, SQL v1, SQL v2) and assert byte-pattern presence; (b) assert `QuizResults.tsx`
**consumes** `results.score_percent` and never recomputes; (c) a property check asserting `Math.round`
(half-up) and a PG-`ROUND` model (half-away-from-zero) agree on all `0..100` non-negative inputs —
documenting the equivalence that currently only lives in a comment. Test-only. Files **REG-180**.

**Alternatives considered:**
- *Pure outcome test (more E2E score checks).* Rejected — REG-45/51/52 already cover outcomes; the gap is
  *formula identity* across TS↔SQL, which only source-inspection + the property check can catch before a
  future `ROUND(x,2)`/floor edit silently diverges.

### SLC-6 — Pin the INTENDED P3 pattern-check asymmetry (testing)
**Root cause (from 03):** none — deliberate. Pattern gaming is false-positive-prone, so it is FLAG-only
(submit proceeds, server zeroes XP) while Speed/Count are true-REJECT. The asymmetry is correct but
unguarded, so a future "tighten anti-cheat" edit could silently flip pattern to REJECT.

**Design:** `quiz-pattern-flag-intended-behavior.test.ts` pins, on **both** client and server: pattern
match (all-same-index, >3 MCQ) → **flag** (warn + submit + server records row with XP 0), while speed
(<3s avg) and count-mismatch → **reject** (no server call client-side). Includes a balanced-brace
robustness fix in the matcher so the assertion can't be fooled by formatting. Test-only — locks current
intended behavior; changes no threshold.

### SLC-8 (pin only) — Pin the current keyless direct-submit + no-double-XP contract (testing)
**Root cause (from 03):** incomplete rollout — the production client calls `submit_quiz_results_v2`
directly with no Idempotency-Key; the hardened `/api/quiz/submit` route runs as passthrough until
`ff_server_only_quiz_submit` flips ON. Double-XP is currently prevented only by the 7-arg RPC's
`reference_id = quiz_<session_id>` `ON CONFLICT DO NOTHING`.

**Design (pin, not fix):** `quiz-submit-idempotency-contract-pin.test.ts` pins the **current** contract —
keyless direct submit + `reference_id` dedup prevents double XP on replay — and carries an **honest FIXME**
documenting the residual pre-cutover gap: a duplicate `quiz_sessions` row can still be inserted by v2
before the cap step even though XP is not double-awarded. This makes the known in-flight state explicit and
regression-protected without pretending the cutover is done. The cutover itself (flag flip) is **gated**
(backend/architect, below).

---

## What is GATED / cross-agent (NOT implemented this cycle)

| ID | Title | Severity | Why gated | Owner(s) | Action |
|---|---|---|---|---|---|
| **SLC-1** | Legacy `quiz_sessions` AFTER-completion trigger re-awards XP (10/20/50) with **no daily cap**, deduped from the RPC only by a fragile 5-second wall-clock window — a **second uncapped XP writer**. | **High** | Touches a **DB trigger** + the P2 economy → schema/behavior change. A second writer to `student_learning_profiles.xp` that bypasses the 200/day cap. | **architect** (trigger gating on a source/`scored_by` column) + **assessment** (defines: RPC is the sole authoritative XP writer; cap always applies). **USER-GATED** (P2 change). | Joint design to consolidate to one capped writer. Do NOT change the cap value (200) or the 10/20/50 literals. |
| **SLC-4** | Two daily-cap implementations — 7-arg IST `xp_transactions` ledger vs JSONB 6-arg `CURRENT_DATE` `quiz_sessions` fallback — plus a `score`-vs-`xp_earned` column mismatch on the fallback insert. | Medium | Schema/behavior alignment of two SQL overloads + a column-source fix → not pure-app. | **architect / backend** (align fallback to the ledger + IST boundary + correct column) + **assessment** (confirm cap semantics). | Align both overloads to one cap source. Do NOT change the cap value (200). |
| **SLC-5** | Server "rejects" a flagged submission by zeroing XP but **still records** the session row + `quiz_responses` + mastery counters (vs the client's true-reject = no DB call). Pollutes mastery analytics; reachable by direct/mobile callers. | Medium | Requires a **canonical reject-semantics definition** (reject the *row* vs reject the *XP*) then an RPC behavior change. | **assessment** (define canonical per-check server behavior) → **backend** (implement) → **testing**. | Define + implement; thresholds (3s / >3 / count) stay unchanged. |
| **SLC-8 cutover** | Flip `ff_server_only_quiz_submit` so **all** submits route through the idempotency-keyed `/api/quiz/submit` (RBAC `quiz.attempt` + studentId↔JWT cross-check + idempotency replay). | Medium | Rollout/flag flip with behavior + auth-path implications; assessment signs off on XP-non-duplication. | **backend / architect** (complete cutover) + **assessment** (XP-non-duplication sign-off). | Track to completion; the SLC-8 pin protects the interim state. |

> SLC-9 (coverage ratchet — xp-rules branches + cognitive-engine) and SLC-10 (v2 redefinition churn,
> informational) are carried as testing backlog items; not actioned this cycle. When SLC-2/SLC-3 guards
> land, target the **latest** migration body (SLC-10 note), not only the baseline.

---

## Risk & rollback (auto-fix-safe set)

- **Blast radius:** SLC-7 is a single pure-React change in `src/app/quiz/page.tsx` (no schema, no RPC, no
  XP/score value); SLC-2/3/6/8-pin are **test-only** additions. No migration, no RLS, no flag toggled.
- **Risk level:** Low. SLC-7 can only remove a malformed question before serving; valid-question scoring,
  the XP formula, the anti-cheat thresholds, and the atomic RPC call are byte-for-byte unchanged. The four
  new tests add assertions only (no production behavior touched).
- **Rollback:** `git revert` of the commit. No data migration to undo, no flag to flip, no schema to
  restore. The server-side snapshot scoring (the real P1/P6 integrity guarantee) is independent of the
  SLC-7 client gate and remains in place regardless.
- **Forward verification:** `npm run type-check` (clean), `npm run lint` (0 errors), the 40 new
  assertions + the broad ~1678 quiz/xp/scoring suite (all PASS), `npm run build` (PASS, bundle within P10
  caps). Independent quality verdict: **APPROVE**.
