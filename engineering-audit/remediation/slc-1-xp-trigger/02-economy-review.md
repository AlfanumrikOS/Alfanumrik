# SLC-1 — XP Economy Correctness Review (P2)

**Author:** assessment (owner of XP economy / P2)
**Scope:** read-only analysis. No code or migration changes.
**Question:** Is removing the legacy `quiz_sessions` trigger's XP award a clean de-duplication (RPC remains sole capped writer, no under-award), or does some completion path depend on the trigger as primary writer?

**Verdict (short):** Clean de-dup for every ACTIVE quiz-completion path. The capped RPC `atomic_quiz_profile_update` already does everything the trigger's XP branch does — plus the 200/day cap and ledger idempotency the trigger lacks. One non-XP side effect (`longest_streak`) and one legacy seed path are flagged for the architect/testing, neither in P2 scope.

---

## 1. The two writers

### Canonical XP constants (`src/lib/xp-config.ts`, re-exported by `xp-rules.ts`)
`quiz_per_correct=10`, `quiz_high_score_bonus=20` (score ≥ 80), `quiz_perfect_bonus=50` (score = 100), `quiz_daily_cap=200`, `XP_PER_LEVEL=500`. This is the P2 source of truth.

### Writer A — the authoritative RPC `atomic_quiz_profile_update`
Baseline `supabase/migrations/00000000000000_baseline_from_prod.sql`.
- 7-param void overload (line ~794): **caps** the award via the ledger — `v_xp_to_award := GREATEST(0, LEAST(p_xp, 200 - v_today_quiz_xp))` (line 821); writes the `xp_transactions` ledger row with `reference_id = 'quiz_' || session_id` and **`ON CONFLICT (reference_id) DO NOTHING`** (line 854) for strict per-session idempotency; only increments `students.xp_total` when a new ledger row was actually inserted (line 860); upserts `student_learning_profiles` xp/counters/level; maintains `students.streak_days`.
- 6-param JSONB overload (line ~717): caps against today's `quiz_sessions.xp_earned` sum, returns `effective_xp`/`xp_capped`. This is the overload the client fallback calls.

This RPC is the sole intended capped writer and is the one P1/P2/P4 pin against.

### Writer B — the legacy trigger `fn_quiz_session_sync_profile`
Baseline lines 3828–3908; registered as `trg_quiz_session_sync_profile` **AFTER INSERT OR UPDATE ON quiz_sessions** (line 18551).
- XP computed with **hardcoded literals** (lines 3862–3864): `correct*10`, `+20` if score ≥ 80, `+50` if score = 100. Numerically equal to the P2 formula, but **with NO daily cap and NO ledger**.
- Directly increments `students.xp_total` (line 3899) and upserts `student_learning_profiles` (xp/level/sessions/counters/streak_days/longest_streak, lines 3866–3895).
- Dedup against the RPC is solely the 5-second wall-clock window:
  `last_session_at > NOW() - INTERVAL '5 seconds'` (line 3854) → if found, `RETURN NEW` (skip).

This is a **second, uncapped XP writer** — the P2 economy-leak surface.

---

## 2. Why the 5-second window is worse than "occasionally fails"

In every server RPC path the **INSERT into `quiz_sessions` fires the AFTER-INSERT trigger BEFORE** the RPC's XP write runs:

| Path | quiz_sessions INSERT (trigger fires) | RPC call (stamps last_session_at) |
|---|---|---|
| `submit_quiz_results` (v1, baseline) | line 7409 | `PERFORM atomic_quiz_profile_update` line 7549 |
| `submit_quiz_results_v2` (baseline) | line 7742 | line 7850 |
| `submit_quiz_results_v2` idempotency (`20260504100200`) | line 328 | line 438 |
| client fallback (`src/lib/supabase.ts`) | `.from('quiz_sessions').insert` line 535 | `rpc('atomic_quiz_profile_update')` line 552 |

Because the trigger runs first, it evaluates `last_session_at > NOW() - 5s` **before** the RPC has stamped `last_session_at` for this submission. For a normal, isolated quiz the profile's `last_session_at` is NOT within the last 5 seconds, so `v_already_synced = FALSE` and the **trigger awards**. The RPC then awards again. The window only "saves" the system when the same student completed another quiz in the **same subject within the prior 5 seconds** — i.e., the dedup fires for back-to-back quizzes but structurally fails for the common case. The window is not a reliable guard; it is a coincidental one.

---

## 3. Economy impact of the double award (when the window does not suppress the trigger)

Per single quiz, the excess (trigger) award is **uncapped** and equal to the full P2 amount:

- Excess per quiz = `correct*10 + (≥80? 20) + (=100? 50)`. Range **0–maximum**; a 10/10 perfect = `100+20+50 = 170` excess on top of the legitimate (capped) RPC award.
- **Cap bypass:** the trigger never reads the ledger, so it ignores the 200/day cap entirely. A student who has already earned the 200 cap through the RPC keeps accruing full uncapped XP through the trigger on every subsequent quiz. The intended hard ceiling (200 quiz-XP/day) is effectively defeated.

Downstream corruption (all read `students.xp_total` / profile `xp`):
- **Level progression** (`calculateLevel = floor(xp/500)+1`): inflated `xp_total` advances levels up to ~2× too fast; level names (`LEVEL_NAMES`) and the XP progress bar (`xp_total % 500`) misreport.
- **Leaderboards / XP velocity:** any ranking or "XP this week" metric reading `xp_total` is inflated and non-deterministic (depends on whether the 5s window happened to fire), so ranks are not reproducible — a fairness/integrity defect.
- **Subject XP / SubjectProgress:** `student_learning_profiles.xp` and `.level` are double-incremented per subject, corrupting per-subject progress bars and level.
- **Streaks:** `students.streak_days` is day-boundary based (not XP-based), so the count itself is not corrupted by double XP; but the trigger writes a **second** streak/`longest_streak` computation against the profile (see §5).
- **Mastery:** `concept_mastery` / `bloom_progression` are driven by `update_learner_state_post_quiz` and the CME action, NOT by the XP writers, so mastery is unaffected by the double award.

Net: a silent, non-deterministic XP inflation that defeats the P2 daily cap and propagates into level, leaderboard, and subject-progress surfaces. This is a genuine P2 economy leak.

---

## 4. Is removal a clean de-dup? — YES for all active paths

**Coverage check — does the RPC already do everything the trigger's XP branch does?**

| Effect | Trigger (Writer B) | RPC `atomic_quiz_profile_update` (Writer A) |
|---|---|---|
| `student_learning_profiles.xp` increment | yes (uncapped) | yes (capped) |
| profile `level` recompute (floor/500+1) | yes | yes |
| profile session/question counters | yes | yes |
| `students.xp_total` increment | yes (uncapped) | yes (capped, ledger-gated) |
| daily 200 cap | **no** | **yes** |
| ledger row + per-session idempotency | **no** | **yes** (`reference_id` ON CONFLICT DO NOTHING) |
| `students.streak_days` | n/a (writes profile streak only) | yes |
| profile `longest_streak` | yes | **no** (see §5) |

The RPC is a strict superset on the XP economy. Removing the trigger's XP award **loses nothing legitimate** and removes the only uncapped writer → **clean de-duplication.**

**No-under-award proof — every active path that inserts `quiz_sessions` also calls the RPC:**
- `submit_quiz_results` (v1) — INSERT 7409 → RPC 7549.
- `submit_quiz_results_v2` (and the `20260621000600`/`20260622030000`/`20260623000300`/`20260623000500` variants) — INSERT → RPC (baseline 7742→7850; idempotency `20260504100200` 328→438).
- API routes `/api/quiz/submit` and `/api/v2/quiz/submit` — both call `submit_quiz_results_v2` (the RPC), confirmed in `src/app/api/v2/quiz/submit/route.ts`.
- Mobile — submits through the same v2 RPC/API contract; no direct `quiz_sessions` insert in `mobile/lib/ui/screens/quiz/quiz_screen.dart`.
- Client fallback (`src/lib/supabase.ts` 535) — direct insert immediately followed by `atomic_quiz_profile_update` (552).

After the trigger's XP branch is removed, the RPC remains the writer on 100% of active paths, and a normal quiz earns **exactly** the P2 amount **once** (the capped RPC value), not twice. No under-award.

**FLAGS (not in P2 scope, but the architect must account for them in 01-design.md):**
1. **`longest_streak` side effect.** The trigger is the only writer that maintains `student_learning_profiles.longest_streak`; the authoritative 7-param RPC does NOT update `longest_streak`. If the fix deletes the trigger **wholesale** rather than removing only its XP/profile-write branch, `longest_streak` on the profile stops advancing. This is a progress-stat regression, not an XP-economy one. Recommendation: either (a) remove only the XP/`xp_total`/profile-xp writes and keep a minimal `longest_streak` maintenance, or (b) move `longest_streak` maintenance into the RPC. Assessment is fine with either; pick one explicitly so the progress page does not silently freeze `longest_streak`.
2. **Legacy demo-seed path.** `supabase/migrations/_legacy/timestamped/20260401180000_demo_account_system.sql` inserts `quiz_sessions` rows directly **without** calling the RPC. With the trigger present, demo accounts get XP from the trigger; removing the trigger means demo-seeded rows award no XP. This is a demo/seed path (not real economy) and is in `_legacy/` (not applied by `db push`), so it does not affect production. Testing should confirm demo accounts still display sensible XP (seed explicit XP, or route demo seeding through the RPC) — low priority.

Neither flag changes the P2 verdict. The XP-award removal itself is clean.

---

## 5. P2-values-unchanged confirmation

The fix is **pure de-duplication** — it removes a redundant writer, it does NOT touch any constant or formula:
- `quiz_per_correct=10`, `quiz_high_score_bonus=20`, `quiz_perfect_bonus=50`, `quiz_daily_cap=200`, `XP_PER_LEVEL=500` — all unchanged in `xp-config.ts`.
- The surviving RPC's formula and cap (lines 821/854) are unchanged.
- Post-fix, `xp_earned` returned to the UI = the RPC's capped `effective_xp`, matching `submitQuizResults()` / `QuizResults.tsx` / the RPC (P1+P2 consistency preserved).

---

## 6. Verification checklist for the testing agent (post-fix)

Required before SLC-1 can be signed off:

- [ ] **(a) Single award, exact P2 amount.** One quiz completion (e.g., 8/10, score 80) increments `students.xp_total` by exactly `8*10 + 20 = 100` (capped), not by `200`. Assert across all paths: v1 `submit_quiz_results`, v2 `submit_quiz_results_v2`, v2 idempotency, and the client fallback. Perfect 10/10 = exactly `100+20+50 = 170` once.
- [ ] **(b) Daily cap holds on ALL paths.** After ≥200 quiz-XP earned today, additional quizzes add **0** to `students.xp_total` and the `xp_transactions` quiz total stays ≤ 200. Specifically include the case the leak exploited: a perfect quiz **after** the cap is reached must add 0 (with the trigger gone, the trigger's uncapped path can no longer bypass the cap).
- [ ] **(c) No under-award regression / no silent stop.** Every completion path that inserts a `quiz_sessions` row still results in exactly one capped XP award. Add a canary: count distinct XP writers per submission = exactly 1 (the RPC). Confirm no path that previously relied on the trigger as sole writer now awards 0 — in particular re-run the v2 happy path and the offline-replay path (REG-91).
- [ ] **(d) Back-to-back quizzes (the old 5s-window case).** Two quizzes in the same subject within 5 seconds now each award exactly once (previously the window could suppress the trigger — confirm the RPC-only path still awards both, capped).
- [ ] **(e) Level / leaderboard / subject-progress math unaffected.** `calculateLevel`, `xpToNextLevel`, `getLevelName`, ProgressSnapshot, and SubjectProgress all read the (now single-written) `students.xp_total` / profile `xp`; assert values match the capped RPC result and are deterministic (no dependence on trigger timing).
- [ ] **(f) Idempotency intact.** Re-submitting the same `session_id` still awards 0 additional XP via the RPC's `reference_id` ON CONFLICT DO NOTHING — independent of the removed trigger.
- [ ] **(g) `longest_streak` (per architect's chosen option in §4 flag 1).** If `longest_streak` maintenance is retained/moved, assert it still advances; if intentionally dropped, document it. Confirm `students.streak_days` (the scorecard source of truth) is unchanged.
- [ ] **(h) Regression catalog.** Promote a P2 entry pinning "single capped XP writer; legacy `fn_quiz_session_sync_profile` XP award removed; trigger can no longer bypass the 200/day cap."

---

## Output (assessment standard format)

### Answer Correctness
- Score formula: MATCHES P1 — fix does not touch scoring.
- XP formula: MATCHES P2 — no constant/formula change; removal is pure de-dup. The pre-fix trigger was an uncapped second writer (literals 10/20/50, no ledger, no cap) — its removal restores a single capped writer.

### Grading Consistency
- Score display matches submission: YES — unchanged.
- XP display matches submission: YES — post-fix `xp_earned` = RPC capped `effective_xp` on all paths.
- Scorecard sources correct: YES — level/leaderboard/subject-progress read the now single-written `xp_total`/profile xp.

### Learner Progress
- Atomic update path: INTACT — RPC `atomic_quiz_profile_update` remains the sole writer on every active path.
- Post-quiz data flow: COMPLETE — sessions/profile/xp_total/streak via RPC; mastery via `update_learner_state_post_quiz`/CME (unaffected). Note: profile `longest_streak` is the one field the RPC does not maintain (§5 flag 1).

### Anti-Cheat
- Client checks: INTACT — not touched.
- Server checks: INTACT — the flagged-submission `v_xp := 0` path in the RPCs is unaffected.

### CBSE Alignment
- Grade format: CORRECT — grades remain strings; fix does not touch grade handling.
- Subject codes: CORRECT — unaffected.
- Bloom's levels: CORRECT — unaffected.

### Verdict
- **APPROVE WITH CONDITIONS**
- Reason: Removing the trigger's uncapped XP award is a clean P2 de-duplication leaving the capped RPC as the sole writer on all active paths (no under-award), conditioned on the architect explicitly deciding `longest_streak` maintenance (§4 flag 1) and testing completing checklist items (a)–(h).
