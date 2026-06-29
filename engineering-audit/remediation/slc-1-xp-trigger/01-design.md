# SLC-1 — Consolidate the duplicate `quiz_sessions` XP-award trigger

**Status:** DESIGN (read-only — no code/migration written yet)
**Owner:** architect (schema/triggers)
**Mandatory reviewers (P14 / P2 economy):** assessment (XP correctness + streak-column liveness), testing (regression coverage), backend (quiz-submit API contract), mobile (offline-replay path)
**Invariant in scope:** P2 (XP Economy). Fix is a **de-duplication**, not an economy change — XP values 10/20/50 and the 200/day cap are **unchanged**.
**CEO approval:** Tier-2, engineering-audit Cycle 3.

---

## 1. The exact object, location, and behavior

### The trigger
- **Trigger:** `trg_quiz_session_sync_profile`
  `00000000000000_baseline_from_prod.sql:18551`
  ```
  CREATE OR REPLACE TRIGGER "trg_quiz_session_sync_profile"
    AFTER INSERT OR UPDATE ON "public"."quiz_sessions"
    FOR EACH ROW EXECUTE FUNCTION "public"."fn_quiz_session_sync_profile"();
  ```
- **Function:** `public.fn_quiz_session_sync_profile()`
  `00000000000000_baseline_from_prod.sql:3828-3908` (SECURITY DEFINER, `search_path = public, pg_temp`).

### What the function does (line refs into the baseline)
1. **Fires only when `is_completed` flips to TRUE** (3839-3844): returns early if `is_completed IS NOT TRUE`, and on `UPDATE` returns early if `OLD.is_completed IS TRUE`. So it acts on the INSERT (or first UPDATE) that completes a session.
2. **The 5-second dedup window** (3848-3859): skips if `student_learning_profiles.last_session_at > NOW() - INTERVAL '5 seconds'` for the same subject. Comment claims this detects "already synced by submit_quiz_results RPC."
3. **Computes XP with the same literals as P2, but with NO daily cap** (3861-3864):
   ```
   v_xp := correct_answers * 10;
   IF score_percent >= 80 THEN v_xp := v_xp + 20; END IF;
   IF score_percent = 100 THEN v_xp := v_xp + 50; END IF;
   ```
4. **Upserts `student_learning_profiles`** (3867-3895): increments `xp`, recomputes `level`, increments `total_sessions` / questions / `total_time_minutes`, sets `last_session_at`, and maintains `streak_days` + `longest_streak`.
5. **Increments `students.xp_total` + `last_active`** (3897-3901).
6. Error-isolated (`EXCEPTION WHEN OTHERS … RETURN NEW`, 3904-3906) — never fails the submission.

### The authoritative (capped) path
- **`submit_quiz_results_v2(...)`** `…:7594-7885` — the active web path (snapshot-backed scoring). Order of operations:
  - `INSERT INTO quiz_sessions (... is_completed=true, completed_at=NOW() ...)` at **7742-7750** → **this INSERT synchronously fires `trg_quiz_session_sync_profile`**.
  - second pass writes `quiz_responses` (7752-7847).
  - **`PERFORM atomic_quiz_profile_update(...)`** at **7850-7852** — the capped, ledger-writing authoritative XP writer.
- **`submit_quiz_results` (v1)** `…:7274-7579` — identical ordering: INSERT completed `quiz_sessions` at 7409-7417, then `PERFORM atomic_quiz_profile_update(...)` at 7549-7551.
- **`atomic_quiz_profile_update(...,p_session_id)`** `…:794-956` (ledger version): reads today's quiz XP from the `xp_transactions` ledger (812-817), caps to 200 (821), writes an idempotent ledger row keyed `quiz_<session_id>` `ON CONFLICT (reference_id) DO NOTHING` (835-854), and only when a **new** ledger row is inserted increments `students.xp_total` (861-864) and `student_learning_profiles.xp` (868-872). Profile counters/level upserted in Step 4 (907-940); `students.streak_days` in Step 5 (946-953).

### Call-path confirmation (who writes a completed `quiz_sessions` row)
- Server submit routes `src/app/api/quiz/submit/route.ts:207` and `src/app/api/v2/quiz/submit/route.ts:301` both call `submit_quiz_results_v2` (which calls the RPC). No server route inserts a completed `quiz_sessions` row directly.
- `src/app/challenge/page.tsx:201-208` only **SELECTs** `quiz_sessions`.
- No client/server code path inserts a completed `quiz_sessions` row outside the two RPCs (grep of `src/` for `quiz_sessions` inserts).
- **Residual unverified path:** mobile/offline quiz replay (Flutter `/mobile`, REG-91). It is expected to POST to the same submit endpoints (→ RPC), but this was not source-confirmed here — see Open Question Q3.

---

## 2. The double-award scenario, and when the 5-second window FAILS

Because the completed-`quiz_sessions` INSERT happens **before** the RPC in both v1 and v2, the AFTER-INSERT trigger always runs **before** `atomic_quiz_profile_update`. The 5-second window checks `student_learning_profiles.last_session_at`, but the RPC that would set it for *this* session has **not run yet**. So the window can only suppress the trigger if a **prior same-subject session** wrote `last_session_at` within the previous 5 wall-clock seconds.

**The window's premise is inverted vs. the actual ordering.** It was evidently written for a historical order where the profile sync ran *before* the `quiz_sessions` INSERT; the current baseline inserts first, so the guard no longer guards against the RPC.

**Double-award sequence (the common case):**
1. `submit_quiz_results_v2` INSERTs the completed `quiz_sessions` row (7742).
2. Trigger fires. `last_session_at` reflects the *previous* session (or is null). For a first quiz of the day, or any quiz >5 s after the last same-subject activity, the window does **not** suppress → trigger awards **uncapped** `v_xp`, bumping `students.xp_total` and `student_learning_profiles.xp`, and stamps `last_session_at=NOW()`.
3. RPC runs (7850). Ledger has no row for this session yet → it writes the capped amount and bumps `students.xp_total` and `student_learning_profiles.xp` **again**.

**Net effect:** `students.xp_total` and `student_learning_profiles.xp` are incremented **twice** per completed quiz (uncapped trigger + capped RPC), while the `xp_transactions` ledger records only the capped RPC amount. The cached totals therefore **drift above** the authoritative ledger, and the trigger's half is **not** subject to the 200/day cap.

**When the window "works" (suppresses):** only when two same-subject sessions complete within ~5 s of each other (rapid back-to-back) — which P3 anti-cheat would typically flag anyway. That is the rare case; **the window FAILS for normal play** (the overwhelmingly common path).

**Why this stayed latent:** the user-facing per-quiz `xp_earned` is the RPC/function **return value** (`v_xp`), not a re-read of `students.xp_total`. No surface re-derives total XP from the ledger to cross-check the cached totals, so the inflation accrues silently. This matches the audit's "latent P2 economy-leak" classification.

> **Magnitude is to be empirically confirmed**, not assumed (see Verification §6, step 1). The static analysis says "double on most quizzes"; a read-only prod reconciliation query proves the real footprint before we ship.

---

## 3. Is it a duplicate or a primary writer?

**It is a DUPLICATE on every confirmed path.** Every observed completion path inserts the `quiz_sessions` row and then unconditionally calls `atomic_quiz_profile_update`, which is the P2-cap-enforcing, ledger-writing authoritative writer. The trigger re-does the RPC's XP + counter work (uncapped, ledger-bypassing).

**The one non-duplicate side-effect:** the trigger maintains two columns the RPC does **not**:
- `student_learning_profiles.streak_days`
- `student_learning_profiles.longest_streak`

The ledger RPC maintains streak only on **`students.streak_days`** (Step 5, 946-953); its profile upsert (907-940) never touches `streak_days`/`longest_streak`. So neutering/dropping the trigger would stop maintaining those two **profile-level** streak columns. Whether that is observable depends on whether anything reads them (Open Question Q1).

**No primary-writer path found** in `src/` — so the task's "STOP and flag if it's the primary writer" condition is **not** triggered for the web/server paths. The only residual is the mobile/offline-replay path (Q3): if that path inserts a completed `quiz_sessions` row **without** calling the RPC, the trigger would be the **sole** XP writer there, and a naive de-dup would zero out its XP. **This must be confirmed before shipping.**

---

## 4. Recommended fix

### Primary recommendation — Option B: neuter the trigger to its non-duplicate side-effects only
Rewrite `fn_quiz_session_sync_profile()` via `CREATE OR REPLACE FUNCTION` so it **only** maintains `student_learning_profiles.streak_days` and `longest_streak` (and `last_session_at` as the streak anchor), and **removes**:
- the XP computation (3861-3864),
- the `xp` / `level` / counter increments that the RPC already does (3867-3895 reduced to streak-only),
- the `students.xp_total` / `last_active` UPDATE (3897-3901).

**Rationale:**
- Pure **de-duplication** of the XP economy writes — eliminates the uncapped second writer while leaving the authoritative capped RPC as the **single** XP writer.
- **Preserves 100% of the trigger's non-XP observable behavior** (profile streak columns) regardless of whether they are currently read → zero behavior-regression risk on that axis, so it is safe to ship even before Q1 is fully answered.
- `CREATE OR REPLACE FUNCTION` is idempotent; the trigger binding (`trg_quiz_session_sync_profile`) is **unchanged**.
- **Does not touch `atomic_quiz_profile_update`** → no risk to the P1/P2 formulas or the ledger/cap logic.
- Trivially reversible: restore the prior function body.

### Cleaner alternative — Option A: DROP the trigger (contingent)
If assessment confirms `student_learning_profiles.streak_days`/`longest_streak` are **dead** (streak universally sourced from `students.streak_days`), then `DROP TRIGGER IF EXISTS trg_quiz_session_sync_profile ON quiz_sessions;` is the cleanest de-dup. This drops a **trigger**, not a table/column — no user-approval gate for a DROP TABLE/COLUMN, and it is reversible by recreating the trigger. Choose A only after Q1 resolves "dead."

### Rejected — Option C: make the trigger delegate to the capped RPC
Rejected. It would re-enter the same RPC the calling function already invokes, risking double ledger logic / re-entrancy, and adds complexity for no benefit. The RPC is already called explicitly by both submit functions.

### Feature flag?
**No SQL feature flag.** A trigger can't be cleanly flag-gated without embedding a settings-table read inside the function, and a flag here would mean "optionally keep the leak on" — undesirable. The neuter (Option B) can only **reduce** writes, never increase them, so it is safe to ship as a direct trigger change. Stage it: deploy to **staging → run reconciliation → prod**.

---

## 5. Migration sketch (DDL outline — NOT a runnable migration yet)

Filename (when authored): `YYYYMMDDHHMMSS_slc1_dedupe_quiz_xp_trigger.sql`

```sql
-- Purpose: SLC-1 — make atomic_quiz_profile_update the single XP writer for
-- quiz submissions. Remove the duplicate, uncapped XP-award branch from the
-- quiz_sessions completion trigger. P2 de-duplication; XP values UNCHANGED.

-- OPTION B (primary): neuter to streak-only.
CREATE OR REPLACE FUNCTION public.fn_quiz_session_sync_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_subject TEXT;
  v_today   DATE := CURRENT_DATE;
BEGIN
  IF NEW.is_completed IS NOT TRUE THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_completed IS TRUE THEN RETURN NEW; END IF;

  v_subject := LOWER(COALESCE(NEW.subject, 'math'));

  -- Maintain ONLY the profile-level streak columns the authoritative RPC
  -- (atomic_quiz_profile_update) does not write. NO XP, NO level, NO counters,
  -- NO students.xp_total — those are owned by the capped RPC (single writer).
  INSERT INTO student_learning_profiles (
    student_id, subject, xp, level, total_sessions, last_session_at,
    streak_days, longest_streak
  ) VALUES (
    NEW.student_id, v_subject, 0, 1, 0, NOW(), 1, 1
  )
  ON CONFLICT (student_id, subject) DO UPDATE SET
    streak_days = CASE
      WHEN DATE(student_learning_profiles.last_session_at) = v_today     THEN student_learning_profiles.streak_days
      WHEN DATE(student_learning_profiles.last_session_at) = v_today - 1  THEN student_learning_profiles.streak_days + 1
      ELSE 1
    END,
    longest_streak = GREATEST(
      student_learning_profiles.longest_streak,
      CASE
        WHEN DATE(student_learning_profiles.last_session_at) = v_today - 1 THEN student_learning_profiles.streak_days + 1
        ELSE student_learning_profiles.streak_days
      END
    );
  -- NOTE: do NOT set last_session_at here on conflict — leave the RPC (Step 4)
  -- as the owner of last_session_at, OR set it; resolve with assessment so the
  -- streak day-delta reads a consistent anchor (see Q2). The INSERT branch's
  -- zero xp/counters are placeholders only hit on a brand-new profile row that
  -- the RPC's ON CONFLICT will then populate.
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[profile_sync_trigger] streak-only error student=% subject=%: %',
    NEW.student_id, v_subject, SQLERRM;
  RETURN NEW;
END;
$$;

-- OPTION A (alternative, only if Q1 = streak columns dead):
-- DROP TRIGGER IF EXISTS trg_quiz_session_sync_profile ON public.quiz_sessions;
```

**Idempotency:** `CREATE OR REPLACE FUNCTION` (Option B) / `DROP TRIGGER IF EXISTS` (Option A) are both idempotent. No table/RLS/index change. No new table → no RLS additions needed.

**Preserved side-effects:** profile `streak_days` + `longest_streak` (Option B). All other trigger writes were duplicates of the RPC and are intentionally removed.

**Rollback:** keep the current `fn_quiz_session_sync_profile()` body (baseline 3828-3908) verbatim in a commented `-- ROLLBACK:` block in the migration; reverting = `CREATE OR REPLACE` back to it (Option B) or `CREATE OR REPLACE TRIGGER` to re-bind (Option A). Never a DROP-in-panic.

> **The exact INSERT-branch placeholder semantics and the `last_session_at` ownership (Q2) must be finalized with assessment before this sketch becomes a real migration.** The body above is illustrative, not final.

---

## 6. Verification plan (proves no economy regression)

1. **Pre-fix prod reconciliation (read-only, service role).** For a sample of active students, compare cached totals vs. ledger:
   `students.xp_total` and `SUM(student_learning_profiles.xp)` vs. `SUM(xp_transactions.amount)` (quiz vs. all categories). Establishes the **real** double-award footprint (confirms/quantifies the leak; turns static analysis into evidence).
2. **DB integration test (test project) — single-writer assertion.** Run `submit_quiz_results_v2` for one fresh session and assert, post-submit:
   - exactly **one** `xp_transactions` row for `reference_id = 'quiz_<session_id>'`;
   - `Δ students.xp_total == capped v_xp == Σ ledger` (no 2×);
   - `Δ student_learning_profiles.xp == capped v_xp`.
   Run **before** fix (expect 2×) and **after** (expect 1×) — the before/after delta is the proof.
3. **Daily-cap regression.** Submit enough quizzes to exceed 200 XP/day; assert the daily `Δ students.xp_total` ≤ 200 post-fix (pre-fix the trigger pushes it over). Reuses/extends REG-48 (daily-cap clamp + SQL/TS literal parity).
4. **Streak regression (Option B).** Assert `student_learning_profiles.streak_days`/`longest_streak` still advance correctly across same-day / next-day / gap boundaries after the neuter.
5. **Per-quiz `xp_earned` unchanged.** E2E REG-45 must still pass — the function return value (`v_xp`) is untouched; only the duplicate cached-total writes are removed.
6. **New regression-catalog entry (P2).** "atomic_quiz_profile_update is the SINGLE XP writer for quiz submissions; the quiz_sessions completion trigger performs no XP/`xp_total`/counter award." Cross-reference REG-48.

---

## 7. P2 confirmation — XP VALUES are UNCHANGED

- The literals **10 / 20 / 50** and the **200/day** cap are not modified anywhere. The cap lives solely in `atomic_quiz_profile_update` (821) and remains authoritative.
- The fix **removes a duplicate, uncapped award path**; the capped RPC stays the sole writer. This is a **de-duplication**, not an economy change.
- Per-quiz user-facing `xp_earned` (the function return) is unchanged.

**Honest caveat (not "no observable change"):** post-fix the cached totals (`students.xp_total`, `student_learning_profiles.xp`) will **stop being inflated** and will match the ledger. The going-forward accrual rate of the *displayed* total drops from ~2× to the correct 1×. **Existing inflated balances** are not corrected by this migration. Whether to backfill/reconcile historical inflation is a **separate, user-approval-gated** decision (it touches P2 economy values) and a product-comms consideration — flagged here, out of scope for this de-dup migration.

---

## 8. Open questions for the assessment reviewer

- **Q1 (blocking for Option A; informational for Option B).** Is `student_learning_profiles.streak_days` / `longest_streak` read anywhere, or is student streak universally sourced from `students.streak_days`? Candidate readers to confirm: `src/app/api/student/profile/route.ts`, `src/lib/state/student-state-builder.ts`, `src/lib/pulse/signals.ts`, `src/app/api/cron/streak-guardian/route.ts`, leaderboard. (Note: `src/lib/learn/weekly-streak.ts` is the separate weekly-dive streak feature, not this column.) If dead → Option A (clean DROP). If live → Option B preserves them.
- **Q2.** For Option B, who should own `student_learning_profiles.last_session_at` — the streak-only trigger or the RPC (Step 4)? The streak day-delta must read a consistent anchor; since the trigger runs **before** the RPC, the trigger should compute the delta from the pre-RPC value, then the RPC may overwrite `last_session_at`. Confirm the intended semantics so the day-boundary math stays correct.
- **Q3 (blocking).** Does the mobile/offline quiz-replay path (Flutter `/mobile`, REG-91) ever insert a completed `quiz_sessions` row **without** calling `submit_quiz_results*` / `atomic_quiz_profile_update`? If yes, the trigger is the **sole** XP writer there and de-dup must instead **route that path through the RPC**. Must be confirmed before authoring the migration.
- **Q4.** Should historical inflated `students.xp_total` / `student_learning_profiles.xp` be reconciled against the ledger (one-time backfill)? P2-economy + user-approval-gated; flagged for the CEO/assessment, out of scope here.
