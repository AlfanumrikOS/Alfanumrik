# STATUS: SLC-1 — quiz_sessions XP-trigger de-dup

**SLC-1 LANDED — uncapped XP double-award de-duped; historical backfill USER-GATED follow-up.**

- **Item:** SLC-1 (post-program remediation backlog, Tier-1; surfaced Cycle 3 — student-learning-core)
- **Invariant:** P2 (XP economy) — pure de-duplication, XP values + 200/day cap UNCHANGED
- **Owner squad:** architect (migration) + assessment (economy/P2) + mobile (offline-replay) + testing + quality
- **CEO gate (original SLC-1 trigger consolidation):** APPROVED — consolidate to one capped writer
- **Started / landed:** 2026-06-29
- **Status:** **LANDED — APPROVE; not yet committed/applied (staged live-DB rollout pending). Historical XP backfill = NEW USER-GATED follow-up.**

## Ledger
| Step | Artifact | Done |
|---|---|---|
| DESIGN (architect) | `01-design.md` | [x] |
| ECONOMY REVIEW (assessment, P2) | `02-economy-review.md` | [x] |
| MOBILE CONTRACT (Q3 offline-replay) | `03-mobile-contract.md` | [x] |
| IMPLEMENTATION (architect — Option B migration) | `04-implementation.md` | [x] |
| VALIDATION (quality APPROVE + residual register) | `05-validation.md` | [x] |

## What landed
- Migration `supabase/migrations/20260702020000_slc1_dedupe_quiz_session_xp_trigger.sql` —
  `CREATE OR REPLACE fn_quiz_session_sync_profile` removed the duplicate uncapped XP / `xp_total` / `level` /
  `total_*` writes; **KEPT** streak (`streak_days` / `longest_streak`, Option B). The capped
  `atomic_quiz_profile_update` RPC is now the **SOLE** XP writer; v1 + v2 both PERFORM it (no under-award).
- Posture preserved (SECURITY DEFINER + `search_path`), idempotent, trigger binding untouched, rollback body
  retained as a commented reference. **XP values 10/20/50 + 200/day cap UNCHANGED — pure de-dup.**
- Mobile **SAFE** (server-authoritative incl. offline-replay; `students.streak_days` maintained by the RPC).
- Tests: `src/__tests__/slc1-quiz-session-trigger-dedupe.test.ts` (17 source-level pins) + REG-181 green;
  27/27 target, 310/310 broad XP/quiz → **REG-194** (catalog 160 → 161).

## Gates
- type-check **PASS** | lint **0 errors** | build **N/A** (migration + test only) | tests **27/27 + 310/310** |
  **Quality APPROVE**.
- **P14 chain COMPLETE:** architect (migration) + assessment (economy — APPROVE-WITH-CONDITIONS resolved) +
  mobile (Q3 SAFE) + testing + quality.

## Deferred / residual
1. **Live-DB single-writer proof — DEFERRED to staged rollout** (`05-validation.md` §3). Source-level pins are
   green; the runtime before/after (2× → 1×) + daily-cap + streak regressions run on staging→prod with the
   pre-fix read-only reconciliation query. Measurement/rollout step, not a correctness gap; gates the prod apply.
2. **Historical XP backfill — NEW USER-GATED follow-up (P2).** This fix stops the double-award GOING FORWARD;
   it does NOT correct already-inflated `students.xp_total` / `student_learning_profiles.xp` / levels /
   leaderboard standings from the period the double-award was live. Reconciling them against the
   `xp_transactions` ledger changes stored economy values + is a visible-to-students XP/rank reduction →
   **CEO decision + comms plan**. Recorded on the `STATE.md` RISK register + `PRIORITY-BACKLOG.md` Tier-1.

## Sign-off
| Role | Agent | Date | Verdict |
|---|---|---|---|
| Builder (migration) | architect | 2026-06-29 | DONE |
| Economy / P2 | assessment | 2026-06-29 | **APPROVE** (conditions resolved) |
| Mobile (Q3) | mobile | 2026-06-29 | **SAFE** |
| Testing | testing | 2026-06-29 | **GREEN** — REG-194 filed |
| Quality (independent) | quality | 2026-06-29 | **APPROVE** |
