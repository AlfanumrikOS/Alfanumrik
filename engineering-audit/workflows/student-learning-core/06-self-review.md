# 06 — Self-Review: Student Learning Core (Cycle 3)

> Phase: SELF-REVIEW. The implementation squad reviews its own work before independent validation.

- **Cycle:** cycle-3
- **Workflow:** student-learning-core (P1, P2, P3, P4, P5, P6, P12)
- **Reviewer (authors):** frontend (SLC-7) + testing (SLC-2, SLC-3, SLC-6, SLC-8-pin)
- **Date:** 2026-06-29
- **Implementation reference:** `./05-implementation.md`

## Per-gap verification

| Gap ID | Owner | Fixed? | Evidence (file / test) | Notes |
|---|---|---|---|---|
| SLC-7 | frontend | yes | `src/app/quiz/page.tsx` — `isValidQuestion` wired into `startQuiz`; `mcqIds` + `displayQuestions` + submitted set all derive from the SAME filtered array; zero-valid → bilingual error; partial removal proceeds; PII-free warn on drop | Strengthens P6 defense-in-depth; P1/P4 served-count consistency preserved by construction (quality-verified). |
| SLC-2 | testing | yes | new `xp-sql-literal-parity.test.ts` — asserts 10/20/50 SQL↔TS across every root migration | Closes the REG-48 earning-literal gap (REG-48 covered only the cap). → REG-181. |
| SLC-3 | testing | yes | new `score-formula-three-way-parity.test.ts` — three computing-site source-inspect + consume-not-recompute + Math.round/PG-ROUND property check | → REG-180. |
| SLC-6 | testing | yes | new `quiz-pattern-flag-intended-behavior.test.ts` — pins pattern=FLAG, speed/count=REJECT, client + server; balanced-brace robustness fix | Locks the intended P3 asymmetry against silent flip. |
| SLC-8 (pin) | testing | yes (pin) | new `quiz-submit-idempotency-contract-pin.test.ts` — current keyless-submit + `reference_id` no-double-XP; honest FIXME for the pre-cutover duplicate-row gap | Pins reality; the cutover itself is gated (backend/architect). |
| **SLC-1** | architect + assessment | **GATED** | second uncapped XP writer (`quiz_sessions` AFTER-completion trigger) | DB trigger + P2 economy → schema/behavior change, **USER-GATED**. NOT implemented. |
| **SLC-4** | architect / backend | **GATED** | dual daily-cap impl + `score`-vs-`xp_earned` column mismatch | Schema/behavior alignment → gated. NOT implemented. |
| **SLC-5** | assessment → backend | **GATED** | server records flagged submission (XP=0) vs client true-reject; pollutes mastery analytics | Needs canonical reject-semantics definition → cross-agent. NOT implemented. |
| SLC-9 | testing | deferred | xp-rules branch + cognitive-engine coverage below aspirational target | Documented ratchet backlog; not actioned this cycle. |
| SLC-10 | testing | informational | v2 redefined across 6 post-baseline migrations | Reinforces SLC-2/3; parity guards target the latest migration body. |

## Self-review checklist
- [x] Every gap in `02-gap-analysis.md` is addressed or explicitly deferred (SLC-2/3/6/7/8-pin landed;
  SLC-1/4/5 + SLC-8 cutover gated/cross-agent; SLC-9/10 backlog/informational).
- [x] No broken / empty states on touched paths — SLC-7 zero-valid renders a clean **bilingual** error
  state, not a crash or blank screen; partial removal proceeds normally.
- [x] **Bilingual (P7)** — the SLC-7 zero-valid error state is Hi/En via `AuthContext.isHi`.
- [x] **P1 score accuracy** — formula untouched at all three sites; SLC-3 now guards it; SLC-7 preserves
  served-count consistency (one filtered array feeds `mcqIds` + `displayQuestions` + submitted set), so
  the server re-derives the score over exactly the snapshotted set.
- [x] **P2 XP economy** — no 10/20/50 literal or 200 cap changed; SLC-2 now guards the earning literals.
- [x] **P3 anti-cheat** — 3s / >3 / count thresholds unchanged; SLC-6 pins the intended flag-vs-reject
  asymmetry (client + server).
- [x] **P4 atomic submission** — the single in-transaction `atomic_quiz_profile_update` call is unchanged;
  count consistency keeps `responses.length === questions.length`.
- [x] **P5 grade format** — `student.grade` still a string end-to-end; untouched.
- [x] **P6 question quality** — strengthened: the dead `isValidQuestion` gate is now live at the render
  boundary without weakening the server snapshot guarantee.
- [x] **P13 privacy** — SLC-7 drop-log carries question id + reason only; no student identity / answers.
- [x] **No schema / RLS / migration / RPC / feature-flag touched** — SLC-7 is pure React app code;
  SLC-2/3/6/8-pin are test-only.
- [x] No `any` in new code; no `console.log` introduced beyond the intentional PII-free `console.warn`
  drop signal (allowed: `console.warn`); no weakened assertions.
- [x] Ownership/scope — frontend edit limited to `src/app/quiz/page.tsx`; testing edits limited to the
  four new test files. The gated DB/behavior changes (SLC-1/4/5) and the SLC-8 cutover were NOT touched.

## Known limitations carried forward (for the independent reviewer)
1. **SLC-1 is GATED, not fixed.** A legacy `quiz_sessions` AFTER-completion trigger re-awards XP
   (10/20/50) with **no daily cap**, deduped from the RPC only by a fragile 5-second wall-clock window — a
   second uncapped XP writer. Fixing it touches a DB trigger + the P2 economy → **USER-GATED**; needs
   architect + assessment joint design to consolidate to one capped writer. Do NOT change the cap (200) or
   the earning literals.
2. **SLC-4 is GATED.** Two daily-cap implementations (7-arg IST ledger vs JSONB 6-arg `CURRENT_DATE`
   fallback) + a `score`-vs-`xp_earned` column mismatch. Schema/behavior alignment → architect / backend.
3. **SLC-5 is GATED.** The server "rejects" flagged submissions by zeroing XP but still records the
   session/counters (vs client true-reject), polluting mastery analytics and reachable by direct/mobile
   callers. Needs a canonical reject-semantics definition → assessment → backend.
4. **SLC-8 cutover pending.** The idempotency-keyed `/api/quiz/submit` route runs as passthrough until
   `ff_server_only_quiz_submit` flips ON (backend/architect). The SLC-8 pin protects the interim state.
5. **SLC-9 coverage ratchet** (xp-rules branches + cognitive-engine) remains a documented testing backlog
   target; not blocking.

## Ready for independent validation?
**YES.** All Cycle-3 auto-fix-safe items (SLC-7 frontend + SLC-2/3/6/8-pin testing) are implemented and
locally green; the four gated/cross-agent items (SLC-1/4/5 + SLC-8 cutover) are explicitly recorded with
owners and were not touched.
