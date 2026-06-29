# SLC-1 — Implementation (architect)

**Status:** MIGRATION AUTHORED (not committed, not applied)
**Owner:** architect
**Decision implemented:** Option B — `CREATE OR REPLACE FUNCTION public.fn_quiz_session_sync_profile()` neutered to streak-only; all duplicate XP / `xp_total` / level / counter writes removed. Trigger binding `trg_quiz_session_sync_profile` is left unchanged (NOT dropped).
**Invariant posture:** Pure P2 de-duplication. XP literals 10/20/50 and the 200/day cap UNCHANGED. No RLS/RBAC change. No DROP. SECURITY DEFINER + `search_path` preserved verbatim.

---

## 1. Migration file

`supabase/migrations/20260702020000_slc1_dedupe_quiz_session_xp_trigger.sql`

- **Timestamp rationale:** latest root migration is `20260702010000_teacher_assigned_students_rls.sql` (confirmed via `Glob supabase/migrations/2026070*.sql` — nothing later exists). New file uses `20260702020000` (after the latest, before any future one).
- **Idempotent by nature:** single `CREATE OR REPLACE FUNCTION` statement. Re-runnable. No table/index/RLS/trigger-binding change.
- **Preserved settings:** `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path TO 'public', 'pg_temp'` — copied exactly from the original (baseline 3829-3830). No new SECURITY DEFINER surface introduced.

---

## 2. Exact statements REMOVED vs KEPT

All line cites are into `supabase/migrations/00000000000000_baseline_from_prod.sql`, function body at **3828-3908**.

### REMOVED (every removed item is a duplicate of `atomic_quiz_profile_update`'s capped work)

| Removed | Baseline lines | Owned instead by the RPC (baseline) |
|---|---|---|
| `v_xp INTEGER` declaration | 3835 | — (XP no longer computed in trigger) |
| XP computation `v_xp := correct*10 (+20 ≥80) (+50 =100)` | 3861-3864 | RPC computes/caps award @ 821 |
| profile `xp` increment | 3867-3877 | RPC `xp` @ 869 (capped) |
| profile `level` recompute | 3872, 3878 | RPC `level` @ 940 |
| profile `total_sessions` | 3868, 3879 | RPC @ 933 |
| profile `total_questions_asked` | 3869, 3880 | RPC @ 934 |
| profile `total_questions_answered_correctly` | 3869, 3881 | RPC @ 935 |
| profile `total_time_minutes` | 3870, 3882 | RPC @ 936 |
| `UPDATE students SET xp_total = ... , last_active = NOW()` | 3897-3901 | RPC `xp_total` @ 862, `last_active` @ 863 & 947 |

### KEPT (NOT written by the RPC, or load-bearing for the kept streak logic)

| Kept | Baseline lines | Why |
|---|---|---|
| `is_completed` early-return guards | 3839-3844 | preserves exact firing condition (completes-once) |
| `v_subject := LOWER(COALESCE(NEW.subject,'math'))` | 3846 | subject key for the profile upsert |
| `v_today DATE := CURRENT_DATE` | 3834 | anchor for the streak day-delta |
| 5-second "already synced" window | 3848-3859 | kept verbatim to preserve the EXACT set of conditions under which the trigger mutates the profile (no-op-equivalent for the day-granular streak) |
| `last_session_at = NOW()` (streak anchor write) | 3883 | streak CASE reads the PRE-RPC value (trigger runs before RPC); RPC re-stamps @ 937 — both write `NOW()`, identical final state (resolves design Q2) |
| `student_learning_profiles.streak_days` day-delta CASE | 3884-3888 | **RPC profile upsert (907-940) never writes profile `streak_days`** |
| `student_learning_profiles.longest_streak` GREATEST | 3889-3895 | **RPC never writes `longest_streak` anywhere** (assessment §4 flag 1) |
| error-isolating `EXCEPTION WHEN OTHERS … RETURN NEW` | 3904-3906 | never fail a quiz submission |

### Brand-new-profile parity
The reduced INSERT specifies only `(student_id, subject, last_session_at, streak_days) VALUES (…, NOW(), 1)`. Dropped columns fall to table DEFAULTs (`student_learning_profiles` DDL @ baseline 13769-13792: `xp/streak_days/longest_streak/total_*` DEFAULT 0, `level` DEFAULT 1, `current_level` DEFAULT 'beginner'). This matches the original new-profile streak outcome exactly: original set `streak_days=1` and **omitted** `longest_streak` (→ DEFAULT 0); the reduced INSERT does the same. Counters that the original INSERT seeded to the session values are now left at 0, and the RPC's `ON CONFLICT` increments them from 0 → correct single-count (the original double-counted them: trigger seeded 1, RPC `+1` = 2).

---

## 3. v1-RPC independent-award confirmation (resolves mobile residual / design Q3 server-side)

**CONFIRMED — no STOP.** The v1 `submit_quiz_results` RPC awards XP itself through the capped RPC, independent of the trigger:

- v1 INSERTs the completed `quiz_sessions` row at baseline **7409-7417**, then calls
  `PERFORM atomic_quiz_profile_update(p_student_id, p_subject, v_xp, v_total, v_correct, p_time, v_session_id);` at baseline **7549-7551** (7-param overload, with `v_session_id`).

So after the trigger stops awarding XP, the v1 path still awards exactly once via the capped, ledger-idempotent RPC. Mobile uses v1 only as a `useV2`-OFF / no-session fallback (`mobile/lib/data/repositories/quiz_repository.dart:380`), and that fallback therefore remains correctly served. The mobile review's one residual ("confirm v1 still awards XP on its own") is **resolved**. No path relied on the trigger as sole writer; the "STOP and flag" condition is NOT triggered.

---

## 4. XP values unchanged (P2)

- No XP literal touched. `atomic_quiz_profile_update` is not modified — its cap `GREATEST(0, LEAST(p_xp, 200 - v_today_quiz_xp))` (baseline 821) and ledger idempotency (854) remain the sole authority.
- `src/lib/xp-config.ts` constants untouched.
- Per-quiz user-facing `xp_earned` (the RPC/submit return value) unchanged.
- Going-forward effect: cached totals (`students.xp_total`, `student_learning_profiles.xp`) stop being double-incremented and converge on the ledger. **Existing inflated balances are NOT corrected by this migration** — historical backfill is a separate, user-approval-gated decision (design Q4), out of scope here.

---

## 5. Rollback

Re-`CREATE OR REPLACE FUNCTION public.fn_quiz_session_sync_profile()` with the original body (baseline 3828-3908). The exact original body is reproduced verbatim as a commented `ROLLBACK REFERENCE` block at the bottom of the migration file. Trigger binding never changed, so no re-bind needed. Never DROP in panic.

---

## 6. Self-review (well-formedness)

- Single `CREATE OR REPLACE FUNCTION` statement; balanced `$$ … $$`; `DECLARE`/`BEGIN`/`END`; matched `IF`/`END IF`, `CASE`/`END`, `GREATEST(...)` parens.
- `DECLARE` now lists only `v_subject`, `v_today`, `v_already_synced` (removed `v_xp`).
- Reduced INSERT column list `(student_id, subject, last_session_at, streak_days)` — all NOT NULL columns covered (`student_id`, `subject` are the only NOT NULLs without defaults; both supplied); all omitted columns have DEFAULTs.
- `ON CONFLICT (student_id, subject)` matches the table's unique key (same target used by the RPC's upsert @ 932 and the original trigger @ 3876).
- Streak CASE references `student_learning_profiles.<col>` (pre-update value during `ON CONFLICT DO UPDATE`) — correct anchor semantics, identical to original.
- No reference to removed `v_xp`; no orphan columns.

---

## 7. Tests (testing) — TO BE FILLED BY THE TESTING AGENT

Map to assessment's checklist (02-economy-review §6) and design verification plan (§6). Left for testing to author/run:

- [ ] (a) Single award, exact P2 amount, across v1 / v2 / v2-idempotency / client fallback (8/10 → +100 once, not +200; 10/10 → +170 once).
- [ ] (b) Daily cap holds on ALL paths; a perfect quiz AFTER the 200 cap adds 0 (trigger can no longer bypass the cap).
- [ ] (c) No under-award / no silent stop; canary: exactly 1 XP writer per submission (the RPC). Re-run v2 happy path + offline-replay (REG-91).
- [ ] (d) Back-to-back same-subject within 5s: each awards exactly once (capped).
- [ ] (e) Level / leaderboard / subject-progress read the now single-written totals; deterministic (no trigger-timing dependence).
- [ ] (f) Idempotency intact (`reference_id` ON CONFLICT DO NOTHING) — re-submit same `session_id` adds 0.
- [ ] (g) **Streak preserved (Option B):** `student_learning_profiles.streak_days` and `longest_streak` still advance across same-day / next-day / gap boundaries after the neuter; `students.streak_days` (scorecard source) unchanged.
- [ ] (h) New regression-catalog entry (P2): "atomic_quiz_profile_update is the SINGLE XP writer for quiz submissions; fn_quiz_session_sync_profile performs no XP/xp_total/counter award and can no longer bypass the 200/day cap." Cross-reference REG-48.
- [ ] (counter parity) New-profile first quiz: `total_sessions = 1` (not 2) and counters single-counted post-fix.
