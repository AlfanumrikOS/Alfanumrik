# Student Learning Core — Root Cause Analysis

**Workflow:** Quiz / Scoring / XP / Mastery
**Audit cycle:** Cycle 3 — ROOT-CAUSE
**Owner:** Assessment engineer
**Date:** 2026-06-29

For each significant gap: the true root cause and the layer/decision that introduced it.
Evidence cites file:line.

---

## SLC-1 — Uncapped XP-award trigger on `quiz_sessions`
- **True root cause:** Historical evolution. XP was originally awarded by an AFTER-completion trigger on `quiz_sessions` (baseline `:3838-3882`). When the atomic RPC (`atomic_quiz_profile_update`) became the authoritative writer with the P2 daily cap (added in migration `20260408000004`, per COMMENT at `:957`), the legacy trigger was **left attached** and patched with a 5-second timing heuristic (`:3849-3859`) instead of being decommissioned or made source-aware.
- **Introducing layer:** Database / migration sequencing. Two XP writers were allowed to coexist; the dedup contract is a wall-clock window rather than an authoritative-source flag.
- **Why it survived:** The 5s guard makes the double-award invisible in normal sequential play, so no test fails. The cap-bypass only manifests on the trigger path, which the happy-path E2E (REG-45) never exercises in isolation.
- **Fix layer:** architect (trigger gating on a source/scored-by column) + assessment (defines "RPC is the sole authoritative XP writer; cap always applies").

## SLC-2 — XP formula duplicated as raw SQL literals
- **True root cause:** No shared SQL constant for the XP economy. The TS side correctly centralised into `xp-config.ts` (`:44-47`) behind the `xp-rules.ts` shim, but the SQL side never got an equivalent single source — every RPC redefinition re-types `10/20/50` inline (baseline `:7404-7406`, `:7736-7738`; six post-baseline migrations).
- **Introducing layer:** Database engineering convention. PL/pgSQL functions are self-contained; the team chose inline literals + a `-- P2: XP_RULES…` comment (e.g. `20260621000600:255-257`) as the parity mechanism instead of a callable `xp_constants()` function or a constants table.
- **Why it survived:** The documented parity guard (REG-48 / `xp-ledger-parity.test.ts`) asserts the **cap** arithmetic and the `quiz_daily_cap === 200` anchor (`:106-168`) but never asserts the per-correct/bonus literals against the SQL bodies — so the duplication is unguarded for the three earning constants.
- **Fix layer:** testing (literal-parity guard now) + architect (SQL constants single-source later). No value change.

## SLC-3 — No mechanical P1 three-way parity guard
- **True root cause:** P1 parity is maintained by discipline + code comments (`scoring.ts:14-15`, v2 COMMENT `:7886` "P1/P2/P3/P4 invariants preserved verbatim") rather than by an executable assertion that compares the three computing sites.
- **Introducing layer:** Testing strategy. Existing regressions test *outcomes* (E2E score, shuffle authority, canary) but not *formula identity* across TS and SQL.
- **Why it survived:** Because the formula has never actually diverged, outcome tests stay green; the latent risk (e.g. a future `ROUND(x,2)` or a negative intermediate where Math.round and PG ROUND disagree) is untested.
- **Fix layer:** testing (source-inspection + property test). No value change.

## SLC-4 — Two daily-cap implementations with different source + boundary
- **True root cause:** Two overloads of `atomic_quiz_profile_update` were authored at different times for different callers. The 7-arg void (production, `:794`) was rebuilt around the **ledger** (`xp_transactions`) at **IST** boundary when the ledger landed (`:812-817`). The 6-arg JSONB (`:717`), used only by the client-side fallback, predates that and still sums **`quiz_sessions.xp_earned`** at server `CURRENT_DATE` (`:731-737`).
- **Introducing layer:** Backend/data — overload proliferation. The fallback path in `submitQuizResults` (`supabase.ts:552`) was never migrated to the ledger-based cap, and it writes the session with column `score` (`:538`) while the JSONB cap reads `xp_earned` — a column-name mismatch that further weakens the fallback cap.
- **Why it survived:** The fallback only runs when both v2 and v1 RPCs fail — a rare path with no dedicated test exercising the cap there.
- **Fix layer:** architect/backend (align fallback to ledger + IST + correct column) + assessment (confirms cap semantics). No value change.

## SLC-5 — Server records flagged submissions (XP=0) rather than rejecting
- **True root cause:** Defensive design choice to never lose a submission server-side (always insert the session, zero the XP) combined with the constitution labelling Speed/Count as "Reject". The two were never reconciled into a single documented server contract; the client implements true reject (no DB call, `quiz/page.tsx:896-908`) while the server implements record-but-zero (`:7733-7734`, `:7742`).
- **Introducing layer:** Assessment/backend contract ambiguity. "Reject" was specified for the client UX but not precisely defined for the server (reject the *row* vs reject the *XP*).
- **Why it survived:** Because the client blocks the obvious case before the server is ever called, the server's record-but-zero behavior is reachable mostly by non-web callers (mobile / direct RPC) that integration tests don't cover.
- **Fix layer:** assessment (define canonical per-check server behavior) → backend (implement) → testing.

## SLC-6 — Pattern-check flag asymmetry (intended)
- **True root cause:** None — deliberate. Pattern gaming is heuristic and false-positive-prone, so it is flag-only by design (skill table marks it "Flag"). Recorded for completeness.
- **Introducing layer:** n/a.
- **Fix layer:** testing (lock the intended behavior).

## SLC-7 — P6 `isValidQuestion` gate defined but not invoked
- **True root cause:** The render-boundary gate was written (`quiz/page.tsx:419-433`) but the wiring was dropped when the server-shuffle assembly path was introduced (migration `20260428160000`) — `startQuiz` builds `displayQuestions` from the assembler + shuffle merge (`:548-581`) and the `.filter(isValidQuestion)` step was never added back. P6 enforcement effectively moved entirely upstream (quiz-generator oracle REG-54 + DB constraints).
- **Introducing layer:** Frontend/assembly refactor. The defense-in-depth layer became dead code during the shuffle-authority migration.
- **Why it survived:** Upstream validation reliably produces well-formed questions, so the missing last-line gate never surfaces a defect.
- **Fix layer:** frontend (wire the filter) with ai-engineer alignment on the upstream contract.

## SLC-8 — Live client bypasses idempotency-keyed submit route
- **True root cause:** Incomplete rollout. The hardened `/api/quiz/submit` route + `submit_quiz_results_v2(p_idempotency_key)` were built for a staged cutover gated by `ff_server_only_quiz_submit` (`api/quiz/submit/route.ts:1-10,172-188`), but the flag has not flipped, so the production client still calls the RPC directly without an Idempotency-Key (`supabase.ts:505`).
- **Introducing layer:** Release engineering / rollout sequencing (Marking-Authenticity Phase 2.6→2.7, per route header). Mitigated meanwhile by the RPC's `reference_id` `ON CONFLICT DO NOTHING` which blocks double XP (`:824-854`) — but not a duplicate session row.
- **Why it survived:** It is a known in-flight migration, not a defect; the residual duplicate-session risk is low-frequency.
- **Fix layer:** backend/architect (complete cutover) + testing (replay pin).

## SLC-9 — Coverage below aspirational targets (xp-rules branches, cognitive-engine)
- **True root cause:** Thresholds were intentionally relaxed (90/**75**/90/90 for xp-rules; **65** for cognitive-engine) with explicit `TODO(assessment)` markers in `vitest.config.ts` because the hardest branches (IRT 3PL Newton-Raphson convergence, SM-2 decay, error-classification, daily-cap clamp combos) had not yet been written.
- **Introducing layer:** Testing backlog — a deliberate, documented deferral, not an accident.
- **Why it survived:** Self-documented as a ratchet target; not blocking.
- **Fix layer:** testing.

## SLC-10 — v2 RPC redefinition churn
- **True root cause:** Iterative bug-fix migrations (topic_id fallback, resilient mastery, server error-type classify, column fix, reference_id 42P10) each `CREATE OR REPLACE` the whole v2 body, re-typing the scoring/XP block every time.
- **Introducing layer:** Database migration practice (whole-function replacement). Directly amplifies SLC-2/SLC-3 — more copies of the literals to keep in lock-step.
- **Why it survived:** Each migration preserved the formula (grep-verified identical), so nothing broke; the risk is purely forward-looking.
- **Fix layer:** testing (target latest migration in the parity guard); architect (SQL single-source).

---

## Cross-cutting root cause

The dominant theme is **single-source discipline asymmetry**: the TypeScript layer is
correctly centralised (`scoring.ts` + `xp-config.ts`), but the **SQL layer has no
equivalent single source** for either the XP earning literals (SLC-2/-10) or the daily-cap
implementation (SLC-4), and **two XP writers** exist (RPC + legacy trigger, SLC-1). The
parity that P1/P2 demand is currently upheld by comments and discipline rather than by
executable guards. None of this has produced a wrong value in production yet — but the
audit's job is to convert "correct by discipline" into "correct by construction" via
parity guards and writer consolidation, without touching any P1/P2/P3 value.
