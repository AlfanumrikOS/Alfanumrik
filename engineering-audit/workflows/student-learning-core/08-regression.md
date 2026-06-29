# 08 — Regression: Student Learning Core (Cycle 3)

> Phase: REGRESSION. Dependent-workflow regression sweep.

- **Cycle:** cycle-3
- **Workflow:** student-learning-core (P1, P2, P3, P4, P5, P6, P12)
- **Verification squad:** **testing**
- **Date:** 2026-06-29
- **Validation reference:** `./07-validation.md`

## Regression sweep
- [x] Quiz / XP / scoring suites green — **40/40** new assertions + **~1678** broad quiz/xp/scoring tests
  PASS.
- [x] No previously-passing test now skipped or weakened — the four new tests are **additive** pins on
  previously-unguarded surfaces (P1 three-way parity, P2 earning literals, P3 flag-vs-reject asymmetry,
  the pre-cutover submit-idempotency contract). The SLC-8 pin carries an **honest FIXME** for the residual
  duplicate-row gap rather than a weakened assertion. No assertion was relaxed.
- [x] type-check green; lint 0 errors; build green; bundle within P10 caps.

## P14 review-chain completeness (Student Learning Core)
Per `.claude/skills/review-chains/SKILL.md`, the learner-core change set was driven by an **assessment**
audit and routed through frontend (impl) + testing (coverage) + quality (independent). All present:

| Role | Agent | Scope | Result |
|---|---|---|---|
| Audit / definition | **assessment** | MAP → GAP → ROOT-CAUSE (01-03); defined the auto-fix-safe vs gated split; signs off on P1/P2/P3 non-change | DONE |
| Maker (impl) | **frontend** | SLC-7 — wire the P6 `isValidQuestion` gate into `startQuiz` (served-count consistency preserved) | DONE |
| Coverage | **testing** | SLC-2 / SLC-3 / SLC-6 / SLC-8-pin (4 new test files) + regression sweep | **GREEN** (40/40 + ~1678) |
| Independent validation | **quality** | re-ran all gates; re-derived P1/P4 consistency; verdict | **APPROVE** |

**Chain: COMPLETE** for the auto-fix-safe set. (The gated items SLC-1/4/5 + SLC-8 cutover open their own
downstream chains — architect + assessment + backend — when they are scheduled.)

## Dependent-workflow regression result
The quiz spine is shared by the dashboard, progress/mastery, leaderboard/XP, exams/simulations, and the
adaptive learner-state pipeline. No regressions in the dependent flows that ride it:

| Dependent flow | Shared dependency | Regression? |
|---|---|---|
| Quiz attempt → results | SLC-7 now filters malformed questions before serving; all artifacts from one filtered set | none — valid-question scoring byte-for-byte unchanged; only malformed items are dropped before serving |
| XP / level / streak | SLC-2 guards the earning literals; no value changed | none — XP formula + 200 cap + ledger path untouched |
| Mastery / learner-state | unchanged this cycle (SLC-5 server-records-flagged is GATED) | none — no RPC behavior changed; SLC-5 residual is a known gated item, not a new regression |
| Server-shuffle snapshot scoring | SLC-7 builds `mcqIds` from the filtered set | none — the snapshot still covers exactly the served set; server re-derivation authority intact |
| Submit idempotency | SLC-8 pin documents the current keyless path + `reference_id` dedup | none — behavior unchanged; the pin records reality + an honest FIXME for the gated cutover |

## Existing learner-core regressions — still green
The pre-existing quiz/score/XP regression catalog entries are unaffected and remain green:

| REG-ID | Pins | Status after Cycle 3 |
|---|---|---|
| REG-45 | E2E quiz happy-path (score + XP from server response, daily-cap copy) | **green** — SLC-7 only drops malformed items pre-serve; the happy-path attempt is unchanged |
| REG-48 | P2 daily-cap clamp + SQL/TS literal parity (cap) + `atomic_quiz_profile_update` return-shape | **green** — SLC-2 *extends* coverage to the earning literals the REG-48 cap-only guard did not cover; no overlap weakened |
| REG-51 | Server-shuffle authority — server is the only re-deriver; snapshot isolation from mid-session edits | **green** — SLC-7 builds the shuffle snapshot from the filtered set, preserving the single-re-deriver authority |
| REG-53 | Phase C integrity hash → tampered snapshot scores zero; `options_version` monotonic | **green** — untouched; SLC-7 is upstream of the snapshot, not in the scoring path |

## New regression catalog entries

| Proposed REG-ID | Invariant | What it pins | Test file | Filed in catalog? |
|---|---|---|---|---|
| **REG-180** | P1 | `score_formula_three_way_parity` — identical `ROUND/Math.round((correct/total)*100)` across `scoring.ts` + SQL v1/v2 + `QuizResults` consume-not-recompute + Math.round/PG-ROUND property on 0..100 | `score-formula-three-way-parity.test.ts` | filed → catalog 148 |
| **REG-181** | P2 | `xp_sql_literal_parity` — 10/20/50 earning literals SQL↔TS across every root migration (closes the REG-48 cap-only gap) | `xp-sql-literal-parity.test.ts` | filed → catalog 148 |

> `.claude/regression-catalog.md` is authoritative. SLC-6 (`quiz-pattern-flag-intended-behavior.test.ts`)
> and the SLC-8 pin (`quiz-submit-idempotency-contract-pin.test.ts`) are additive behavior pins enforced
> by the suite; they ride the existing P3 / submit-idempotency catalog lines rather than minting new
> top-level REG ids this cycle.

## Coverage delta

| Metric | Before | After |
|---|---|---|
| Quiz/XP/scoring assertions | P1 three-way parity unguarded; P2 earning literals unguarded; P3 flag-asymmetry unpinned; submit-idempotency contract unpinned | **40/40** new + **~1678** broad PASS — all four surfaces now pinned |
| Regression catalog entries | 146 (REG-178/179, Cycle 2) | **148** with REG-180 (P1) + REG-181 (P2) |

> Snapshotted into `metrics/coverage-trend.md` (2026-06-29 Cycle-3 row).

## Residual risk
1. **SLC-1 — GATED (HIGH).** Second uncapped XP writer (`quiz_sessions` AFTER-completion trigger) deduped
   from the RPC only by a 5-second wall-clock window. DB trigger + P2 economy → **USER-GATED**; architect
   + assessment joint design to consolidate to one capped writer. Not touched this cycle.
2. **SLC-4 — GATED (MED).** Two daily-cap implementations + `score`-vs-`xp_earned` column mismatch on the
   fallback path. Architect / backend alignment. Cap value (200) must not change.
3. **SLC-5 — GATED (MED).** Server records flagged submissions (XP=0) vs client true-reject; pollutes
   mastery analytics; reachable by direct/mobile callers. Assessment must define canonical reject-semantics
   → backend implements.
4. **SLC-8 cutover — pending.** `ff_server_only_quiz_submit` still OFF; the idempotency-keyed route is
   passthrough. The SLC-8 pin protects the interim state; backend/architect to complete the cutover.
5. **SLC-9 — coverage ratchet.** xp-rules branches + cognitive-engine below aspirational target; testing
   backlog, non-blocking.

## Sweep verdict
**GREEN** — 40/40 new + ~1678 broad quiz/xp/scoring tests PASS, P14 chain complete for the auto-fix-safe
set, no dependent-flow regression, REG-45/48/51/53 still green, the two new guards (REG-180/181) strengthen
the P1/P2 surface; the residual SLC-1/4/5 + SLC-8-cutover items are tracked gated/cross-agent follow-ups,
not sweep failures.
