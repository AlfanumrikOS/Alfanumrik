# SLC-1 — Independent Validation (quality) + residual register

**Status:** VALIDATED — **APPROVE**. Migration authored + tested, not yet committed/applied.
**Validator:** quality (independent of architect/assessment/mobile/testing builders)
**Date:** 2026-06-29
**Change under review:** `supabase/migrations/20260702020000_slc1_dedupe_quiz_session_xp_trigger.sql`
**Verdict:** **APPROVE** — pure P2 de-duplication; the capped `atomic_quiz_profile_update` RPC is now the SOLE XP writer. XP values 10/20/50 + 200/day cap UNCHANGED. Mobile SAFE. Streak preserved (Option B). No under-award on any active path.

---

## 1. What landed

`CREATE OR REPLACE FUNCTION public.fn_quiz_session_sync_profile()` removed the duplicate, uncapped XP / `xp_total` / `level` / `total_*` writes from the `quiz_sessions` completion trigger and **kept** the streak maintenance (`student_learning_profiles.streak_days` / `longest_streak` — Option B). The capped, ledger-idempotent RPC `atomic_quiz_profile_update` is now the **single** XP writer for quiz submissions. Both `submit_quiz_results` (v1) and `submit_quiz_results_v2` continue to `PERFORM` it, so no path under-awards.

**Posture preserved:** SECURITY DEFINER + `SET search_path = public, pg_temp` copied verbatim; idempotent single `CREATE OR REPLACE`; trigger binding `trg_quiz_session_sync_profile` untouched (not dropped); original function body retained verbatim as a commented `ROLLBACK REFERENCE` block. No table / index / RLS / RBAC change. No DROP.

---

## 2. Gates (quality APPROVE — verbatim)

| Gate | Result | Note |
|---|---|---|
| **type-check** | **PASS** | `tsc --noEmit` clean |
| **lint** | **PASS — 0 errors** | |
| **build** | **N/A** | migration + test-only change; no client bundle, no TS runtime surface. CI post-merge build is the backstop. |
| **unit tests** | **PASS** | `src/__tests__/slc1-quiz-session-trigger-dedupe.test.ts` — **17 source-level pins** (single-writer / removed-vs-kept statements / streak-preserved / posture). **27/27** SLC-1 target; **310/310** broad XP/quiz suite. **REG-181** (P2 SQL↔TS earning-literal parity) still green. |
| **Quality verdict** | **APPROVE** | independent re-derivation of the removed-vs-kept statement set against the baseline function body (3828-3908) and the RPC's owned writes |
| **Regression catalog** | **REG-194** filed (P2 — "atomic_quiz_profile_update is the SINGLE XP writer; fn_quiz_session_sync_profile performs no XP/`xp_total`/counter award and can no longer bypass the 200/day cap"); cross-references REG-48 (cap clamp) + REG-181 (earning-literal parity). Catalog 160 → **161**. |

### P14 review chain — COMPLETE
- **architect** — authored the Option B migration (`04-implementation.md`); v1-RPC independent-award confirmed (no STOP), no path relied on the trigger as sole writer.
- **assessment** — XP economy / P2 correctness (`02-economy-review.md`): **APPROVE WITH CONDITIONS** → both conditions **RESOLVED** (architect explicitly chose Option B keeping `longest_streak`; testing completed checklist (a)–(h)).
- **mobile** — Q3 (`03-mobile-contract.md`): **SAFE** — every Flutter path (online + offline-replay) is server-authoritative through `submit_quiz_results*`; the trigger is never the sole writer on mobile; `students.streak_days` (the column mobile renders) stays maintained by the RPC.
- **testing** — 17 source-level pins + REG-194; 27/27 target, 310/310 broad; REG-181 green.
- **quality** — this document; independent **APPROVE**.

---

## 3. Behavioral deferral — live-DB single-writer proof (DEFERRED to staging→prod)

The unit suite is **source-level** (asserts the removed-vs-kept statement set, posture, and streak retention against the function text). The **runtime** single-writer proof — that `submit_quiz_results_v2` for a fresh session increments `students.xp_total` by exactly the capped amount **once** (not 2×), that the daily 200 cap holds when a perfect quiz follows the cap, and that `student_learning_profiles.streak_days`/`longest_streak` still advance across same-day/next-day/gap boundaries — requires a live Postgres with the RPC + trigger installed. Per the design verification plan (`01-design.md` §6) this is **DEFERRED** to the staged rollout:

1. **Pre-fix prod reconciliation (read-only, service role)** — compare `students.xp_total` / `Σ student_learning_profiles.xp` vs. `Σ xp_transactions.amount` to quantify the real double-award footprint.
2. **Deploy to staging** → run the DB integration single-writer assertion (before = 2×, after = 1×) + daily-cap + streak regressions.
3. **Promote to prod** only after the staging deltas confirm 1× capped award and intact streak.

This deferral is a **measurement/rollout step, not a correctness gap** — the migration is statically proven to remove only writes the RPC already owns (capped) and keep only writes the RPC does not own (streak). It does not block the APPROVE; it is the operational gate before the migration is applied to production.

---

## 4. RESIDUAL — historical XP backfill is a SEPARATE, USER-GATED decision (P2 economy)

**This fix stops the double-award GOING FORWARD. It does NOT correct already-inflated data.**

During the window the double-award was live, every completed quiz incremented `students.xp_total` and `student_learning_profiles.xp` **twice** (uncapped trigger + capped RPC) while the `xp_transactions` ledger recorded only the capped amount. Post-fix the cached totals **stop inflating** and converge on the ledger going forward, but the **existing inflated balances** — and everything derived from them — remain inflated:

- `students.xp_total` (and per-subject `student_learning_profiles.xp`) carry the accumulated over-award.
- **Levels** computed `floor(xp/500)+1` are advanced too far for affected students.
- **Leaderboard / XP-velocity** standings reflect the inflated, non-deterministic totals (the inflation depended on whether the fragile 5-second window happened to fire).

Reconciling historical inflation against the `xp_transactions` ledger (a one-time backfill / recompute of `xp_total` and dependent levels + leaderboard standings) **changes stored P2 economy values** and is therefore **USER-GATED** (CEO decision) — it is NOT covered by this de-dup migration. It also carries a **product-communications** dimension: a backfill would visibly **reduce** some students' displayed XP / level / rank, which needs a comms decision.

**Recorded as a NEW open item** on the program RISK register (`STATE.md`) and the post-program remediation backlog (`PRIORITY-BACKLOG.md`):

> **SLC-1-backfill (NEW, Tier-1 USER-GATED, P2):** decide whether to reconcile historical inflated `students.xp_total` / `student_learning_profiles.xp` (+ recompute dependent levels and leaderboard standings) against the `xp_transactions` ledger. Quantify the footprint via the read-only reconciliation query first (§3 step 1). Backfill changes stored economy values + is a visible-to-students XP/rank reduction → CEO decision + comms plan. Successor to SLC-1 (design Q4).

---

## 5. Sign-off

| Role | Agent | Date | Verdict |
|---|---|---|---|
| Builder (migration) | architect | 2026-06-29 | DONE (`04-implementation.md`) |
| Economy / P2 (audit lead) | assessment | 2026-06-29 | **APPROVE** (conditions resolved) |
| Mobile contract (Q3) | mobile | 2026-06-29 | **SAFE** |
| Testing | testing | 2026-06-29 | **GREEN** — 17 pins, 27/27 target, 310/310 broad, REG-181 green; **REG-194** filed |
| Quality (independent) | quality | 2026-06-29 | **APPROVE** |

**Going-forward fix: LANDED + APPROVED (pending staged live-DB rollout in §3).**
**Historical backfill: NEW USER-GATED follow-up — not in scope here.**
