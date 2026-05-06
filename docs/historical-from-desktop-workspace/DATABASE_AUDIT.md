# DATABASE_AUDIT.md — Alfanumrik Application
**Audit Date:** 2026-04-10  
**Auditor:** Claude Sonnet 4.6 (automated deep audit)  
**Scope:** `supabase/migrations/` (9 files, all from 2026-04-08 P4 Sprint), source modules, Edge Functions  
**Database:** Supabase PostgreSQL 15

---

## Executive Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 4 |
| HIGH | 8 |
| MEDIUM | 9 |
| LOW | 6 |
| **Total** | **27** |

The most serious finding is that **the base schema is entirely absent from version control**. All 9 migrations are incremental patch files — zero `CREATE TABLE` statements exist anywhere in `supabase/migrations/`. A fresh database cannot be reproduced from the repository. The second most serious class of findings is **race conditions on concurrent quiz submissions** caused by missing `UNIQUE` constraints on tables that use SELECT-then-INSERT/UPDATE upsert patterns in SECURITY DEFINER trigger functions.

---

## Part 1 — Schema Audit

### Migrations Inventory

| File | Purpose | DDL Changes |
|------|---------|------------|
| `20260408000001` | IRT b-parameter proxy calibration | `UPDATE question_bank` (data-only) |
| `20260408000002` | Fix SECURITY DEFINER view + RLS initplan | `DROP/CREATE VIEW`, `DROP/CREATE POLICY` (3 tables) |
| `20260408000003` | Fix search_path on SECDEF functions | `ALTER FUNCTION` (dynamic) |
| `20260408000004` | Fix service_role RLS policies | `DROP/CREATE POLICY` (dynamic, 37 policies, 33 tables) |
| `20260408000005` | Drop redundant indexes | `DROP INDEX` (9 indexes) |
| `20260408000006` | IRT theta estimation RPC + trigger | `CREATE FUNCTION` × 2, `CREATE TRIGGER` |
| `20260408000007` | Covering indexes for unindexed FKs | `CREATE INDEX` (31 indexes) |
| `20260408000008` | Affective state computation pipeline | `CREATE FUNCTION` × 3, `CREATE TRIGGER` |
| `20260408000009` | Drop old check_and_record_usage overload | `DROP FUNCTION` |

**None of these migrations define the base schema.** All 40+ tables referenced in code are created by an unversioned baseline.

---

## Part 2 — CRITICAL Findings

---

### CRITICAL-1: Base Schema Is Not Versioned — Fresh Deploy Is Impossible

**Severity:** CRITICAL  
**Tables affected:** ALL (~40 tables)  
**Migration files:** None (absence of initial migration)

The entire production schema — `students`, `quiz_sessions`, `quiz_responses`, `question_bank`, `adaptive_mastery`, `concept_graph`, `rag_content_chunks`, `subscriptions`, `feature_flags`, `guardian_student_links`, `profiles`, and ~30 more tables — has **no corresponding `CREATE TABLE` migration**. The 9 existing migrations presuppose these tables exist.

**Consequences:**
- Restoring to a new Supabase project or running a CI database is impossible from the repo alone.
- There is no single source of truth for the canonical schema — the Supabase cloud dashboard is the implicit source of truth.
- Any developer onboarding has to manually export from the cloud, creating drift risk.
- Disaster recovery cannot be schema-reproduced from the repo.

**Fix:**  
Run `supabase db dump --schema-only > supabase/migrations/00000000000000_initial_schema.sql` against the production project and commit it. Then establish a migration hygiene rule: every DDL change goes through a migration file.

---

### CRITICAL-2: Race Condition on Concurrent Quiz Submissions — Missing UNIQUE Constraints

**Severity:** CRITICAL  
**Tables affected:** `student_learning_profiles`, `adaptive_profile`, `cognitive_session_metrics`  
**Migration files:** `20260408000006`, `20260408000008`

Both `update_irt_theta()` (migration 6) and `compute_session_cognitive_metrics()` / `compute_student_affective_profile()` (migration 8) use a SELECT-then-INSERT/UPDATE anti-pattern:

```sql
-- From migration 6 (repeated pattern in migration 8):
SELECT id INTO v_existing_slp
FROM student_learning_profiles
WHERE student_id = p_student_id AND subject = p_subject LIMIT 1;

IF v_existing_slp IS NOT NULL THEN
  UPDATE ...
ELSE
  INSERT ...  -- ← can execute twice concurrently → duplicate rows
END IF;
```

If two quiz responses arrive simultaneously (e.g., a student rapid-fires answers), two trigger invocations run concurrently. Both `SELECT`s return NULL, both reach the `ELSE` branch, and both `INSERT` — creating **duplicate rows** that will corrupt subsequent IRT theta calculations (the LIMIT 1 will silently pick whichever row was last updated, silently discarding the other).

**Affected tables and missing constraints:**

| Table | Missing Constraint | Impact |
|-------|-------------------|--------|
| `student_learning_profiles` | `UNIQUE(student_id, subject)` | Duplicate IRT theta rows per student+subject |
| `adaptive_profile` | `UNIQUE(student_id)` | Duplicate difficulty/boredom/frustration profiles |
| `cognitive_session_metrics` | `UNIQUE(student_id, quiz_session_id)` | Duplicate session cognitive metrics |

**Fix:**
```sql
ALTER TABLE student_learning_profiles
  ADD CONSTRAINT uq_slp_student_subject UNIQUE (student_id, subject);

ALTER TABLE adaptive_profile
  ADD CONSTRAINT uq_adaptive_profile_student UNIQUE (student_id);

ALTER TABLE cognitive_session_metrics
  ADD CONSTRAINT uq_csm_student_session UNIQUE (student_id, quiz_session_id);
```

Then rewrite the functions to use proper `INSERT ... ON CONFLICT DO UPDATE` (PostgreSQL upsert).

---

### CRITICAL-3: Migration 4 Overwrites Original WITH CHECK Clauses on INSERT/UPDATE Policies

**Severity:** CRITICAL  
**Tables affected:** All 33 tables touched by `20260408000004`  
**Migration file:** `20260408000004_fix_service_role_rls_policies.sql`

Migration 4 dynamically recreates RLS policies. The recreation template is:

```sql
'CREATE POLICY %I ON %I.%I AS PERMISSIVE FOR %s TO service_role USING (true) WITH CHECK (true)'
```

`WITH CHECK (true)` is applied to **every** policy regardless of the original `with_check` clause stored in `pg_policies`. This means:

- Any INSERT/UPDATE service_role policy that originally had a restrictive `WITH CHECK` (e.g., restricting inserts to specific subjects, grades, or non-null fields) **now allows any data to be inserted/updated** by the service role.
- The migration correctly fixes the `roles = '{public}'` bug, but breaks the data validation gate in the process.

**Additionally**, the `pg_policies.roles = '{public}'` comparison is likely wrong syntax for array column equality. The correct check is `'{public}' = ANY(roles)` or `roles @> ARRAY['public']`. If the comparison failed silently, **none of the 37 policies were actually fixed** and authenticated users may still have service-role-level access.

**Fix:**  
Audit each of the 33 affected tables' INSERT/UPDATE policies in the Supabase dashboard. Verify the current `with_check` expressions. Re-create any that should have non-trivial `WITH CHECK` clauses. Validate the `roles` column filter syntax was effective.

---

### CRITICAL-4: No RLS Policies Confirmed for Sensitive Computed Tables

**Severity:** CRITICAL  
**Tables affected:** `cognitive_session_metrics`, `adaptive_profile`, `ai_tutor_logs`, `audit_logs`  
**Migration files:** None (these tables have no policy definitions in any migration)

The following tables store highly sensitive student data with **no RLS policy definitions found in any migration file**:

| Table | Data Stored | Risk if Unprotected |
|-------|------------|-------------------|
| `cognitive_session_metrics` | ZPD state, flow probability, fatigue detection, session cognitive metrics | Student psychological profiling data exposed to all authenticated users |
| `adaptive_profile` | boredom_floor, frustration_ceiling, optimal_difficulty | Student learning psychology exposed |
| `ai_tutor_logs` | Full AI tutor conversation logs | Student conversations visible to other students |
| `audit_logs` | Admin action trail with auth_user_id, IP, user agent | Admin audit logs visible to students |

Since the base schema is not versioned, we cannot confirm whether RLS is even enabled on these tables, let alone whether policies exist. If RLS was not enabled (which is the Supabase default for new tables created outside the dashboard), any authenticated user can read all rows.

**Fix:**  
For each table, verify in the dashboard:
1. `SELECT relrowsecurity FROM pg_class WHERE relname = 'cognitive_session_metrics';` — must be `true`.
2. Confirm row-level policies exist.
3. Add missing policies with appropriate student/admin scoping.

---

## Part 3 — HIGH Findings

---

### HIGH-1: IRT Trigger Performs Full Table Scan on Every Quiz Response INSERT

**Severity:** HIGH  
**Tables affected:** `quiz_responses`, `question_bank`  
**Migration file:** `20260408000006`

`trg_fn_update_irt_theta()` fires `AFTER INSERT ON quiz_responses FOR EACH ROW`. It calls `update_irt_theta()`, which runs **5 Newton-Raphson iterations**, each scanning **ALL quiz_responses** for that student+subject with an inner JOIN to `question_bank`:

```sql
FOR v_responses IN
  SELECT qb.irt_difficulty AS b, ...
  FROM quiz_responses qr
  JOIN question_bank qb ON qb.id = qr.question_id
  WHERE qr.student_id = p_student_id AND qr.subject = p_subject
  -- No LIMIT
```

A student with 500 history responses incurs 5 full scans × 500 rows = 2,500 row fetches on **every single answer submission**. This will visibly degrade answer submission latency as students progress.

**Required indexes not confirmed in migrations:**
- `quiz_responses(student_id, subject)` — needed for the WHERE filter
- `quiz_responses(student_id, quiz_session_id)` — needed by migration 8's affective function

Migration 7 adds 31 FK-covering indexes but does NOT add these query-path indexes.

**Fix:**
```sql
CREATE INDEX IF NOT EXISTS idx_quiz_responses_student_subject
  ON quiz_responses (student_id, subject)
  INCLUDE (question_id, is_correct);

CREATE INDEX IF NOT EXISTS idx_quiz_responses_student_session
  ON quiz_responses (student_id, quiz_session_id)
  INCLUDE (is_correct, time_taken_seconds, difficulty, question_number);
```

Also add `LIMIT 200` (or similar sliding window) to the IRT computation query to cap computation at recent responses.

---

### HIGH-2: Backfill Operations in Production Migrations Will Lock Tables

**Severity:** HIGH  
**Tables affected:** `quiz_responses`, `quiz_sessions`, `student_learning_profiles`, `adaptive_profile`, `cognitive_session_metrics`  
**Migration files:** `20260408000006`, `20260408000008`

Both migrations end with unbounded `DO $$` backfill blocks that iterate over all existing data:

**Migration 6:**
```sql
FOR v_rec IN
  SELECT DISTINCT student_id, subject FROM quiz_responses
  WHERE student_id IS NOT NULL AND subject IS NOT NULL
LOOP
  PERFORM public.update_irt_theta(v_rec.student_id, v_rec.subject);
END LOOP;
```

**Migration 8:**
```sql
FOR v_rec IN
  SELECT DISTINCT qs.student_id, qs.id FROM quiz_sessions qs
  WHERE qs.is_completed = true ...
LOOP
  PERFORM public.compute_session_cognitive_metrics(v_rec.student_id, v_rec.quiz_session_id);
END LOOP;
-- Second loop over all distinct students with completed sessions
```

Each `update_irt_theta()` call also internally iterates quiz_responses. On a database with 1,000 students and average 200 responses each, migration 6 could execute 1,000 × 5 × 200 = 1,000,000 row fetches in a single transaction — causing a migration timeout and leaving the database in a partial state. Supabase migrations run in a single transaction by default.

**Fix:**  
If these migrations have already run in production, no action needed now. For future migrations, backfills should be run out-of-band via a separate script or scheduled Edge Function, not inside the migration transaction.

---

### HIGH-3: Missing Index on quiz_responses(student_id, subject) for IRT Queries

**Severity:** HIGH  
**Table:** `quiz_responses`  
**Migration file:** Not present (omitted from migration 7)

Migration 7 adds 31 FK-covering indexes but misses the two most query-critical indexes for the newly-added trigger functions (migrations 6 and 8). Both the IRT theta computation and the affective state pipeline query `quiz_responses` by `student_id` + either `subject` or `quiz_session_id`.

Without these indexes:
- Every quiz answer triggers a sequential scan of the entire `quiz_responses` table filtered in memory.
- At 10,000+ total responses (a modest number for a live app), each answer submission triggers an unindexed full scan.

See HIGH-1 for the fix.

---

### HIGH-4: foxy_sessions Has No INSERT/UPDATE/DELETE RLS Policies

**Severity:** HIGH  
**Table:** `foxy_sessions`  
**Migration file:** `20260408000002`

Migration 2 adds only a SELECT policy for `foxy_sessions`:
```sql
CREATE POLICY "Students can view own foxy sessions"
  ON public.foxy_sessions FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()));
```

No INSERT, UPDATE, or DELETE policies are defined. If RLS is enabled on this table (which it should be), students cannot create new Foxy tutor sessions — the INSERT will be rejected by the missing policy. If RLS is not enabled, this is a different CRITICAL issue (see CRITICAL-4 pattern).

**Fix:**
```sql
CREATE POLICY "Students can insert own foxy sessions"
  ON public.foxy_sessions FOR INSERT TO authenticated
  WITH CHECK (student_id = (SELECT auth.uid()));

CREATE POLICY "Students can update own foxy sessions"
  ON public.foxy_sessions FOR UPDATE TO authenticated
  USING (student_id = (SELECT auth.uid()))
  WITH CHECK (student_id = (SELECT auth.uid()));
```

---

### HIGH-5: RPC Functions Called from Code Are Not in Any Migration

**Severity:** HIGH  
**Tables affected:** Multiple  
**Migration files:** None

The following RPC functions are called from production code but are defined nowhere in the migrations directory:

| RPC Function | Called From | Purpose |
|-------------|------------|---------|
| `get_user_role(p_auth_user_id uuid)` | `src/modules/auth/guards.ts` | RBAC role lookup |
| `check_and_record_usage(...)` | `supabase/functions/foxy-tutor/index.ts` | Rate limiting |
| `add_xp(p_student_id, p_xp, p_source)` | `supabase/functions/foxy-tutor/index.ts` | Gamification |
| `match_rag_chunks(...)` | `supabase/functions/rag-retrieval/index.ts` | Vector search |

Migration 9 drops the old `check_and_record_usage` overload, confirming the correct version exists, but its definition is not in any migration. If the base schema were to be regenerated, all four of these functions would be missing — breaking authentication, rate limiting, gamification, and RAG retrieval simultaneously.

**Fix:** Export function definitions from the Supabase dashboard and add them to the initial schema migration (see CRITICAL-1 fix).

---

### HIGH-6: Migration 4 Dynamic Policy Recreation May Have Silently Failed

**Severity:** HIGH  
**Tables affected:** All 33 tables in `20260408000004`  
**Migration file:** `20260408000004_fix_service_role_rls_policies.sql`

The policy discovery query uses:
```sql
WHERE roles = '{public}'   -- incorrectly scoped to public
```

`pg_policies.roles` is a `name[]` (array of names). The comparison `roles = '{public}'` compares an array to a text literal. In PostgreSQL, this can either work (if the array contains exactly `{public}`) or fail silently (returning no rows). The correct form is:

```sql
WHERE 'public' = ANY(roles)
-- or
WHERE roles @> ARRAY['public']::name[]
```

If the comparison returned 0 rows, the entire DO block was a no-op — none of the 37 policies were fixed. Authenticated users may still have the ability to bypass RLS by triggering service-role code paths.

**Verification query to run in production:**
```sql
SELECT tablename, policyname, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname ILIKE '%service role%'
ORDER BY tablename;
```
Any row with `roles = {public}` means the fix failed for that table.

---

### HIGH-7: No Check Constraint on irt_difficulty Bounds

**Severity:** HIGH  
**Table:** `question_bank`  
**Migration file:** `20260408000001`

Migration 1 computes `irt_difficulty` values clamped to `[-2.5, 2.5]` via `GREATEST`/`LEAST`. However, no `CHECK` constraint enforces this bound at the database level. Any direct INSERT or UPDATE (e.g., from an admin seeding script, a bulk import, or a future migration that doesn't follow the same formula) can store out-of-range values that will corrupt the Newton-Raphson convergence in `update_irt_theta()` (values far outside the expected range cause the logistic function to saturate, zeroing out the Fisher information).

**Fix:**
```sql
ALTER TABLE question_bank
  ADD CONSTRAINT chk_irt_difficulty_bounds
    CHECK (irt_difficulty BETWEEN -4.0 AND 4.0);
-- Note: use -4/4 not -2.5/2.5 to align with theta bounds in migration 6
```

---

### HIGH-8: cognitive_session_metrics.session_start Incorrectly Set to Completion Time

**Severity:** HIGH  
**Table:** `cognitive_session_metrics`  
**Migration file:** `20260408000008`

In `compute_session_cognitive_metrics()`, the INSERT for a new cognitive metrics record sets:
```sql
session_start, session_end, created_at
) VALUES (
  gen_random_uuid(), p_student_id, p_quiz_session_id,
  ...
  now(), now(), now()  -- ← session_start = now() = session completion time
```

The trigger fires `AFTER UPDATE OF is_completed ON quiz_sessions` — i.e., when the session has already ended. Both `session_start` and `session_end` are being set to the same value (the completion timestamp), making session duration calculations impossible and making the `session_start` field meaningless.

**Fix:** `quiz_sessions` likely has a `created_at` or `started_at` column. Join to it:
```sql
SELECT qs.created_at INTO v_session_start
FROM quiz_sessions qs WHERE qs.id = p_quiz_session_id;
-- Then use v_session_start instead of now() for session_start in INSERT
```

---

## Part 4 — MEDIUM Findings

---

### MEDIUM-1: admin_question_verification_status View Has No GRANT

**Severity:** MEDIUM  
**Object:** `public.admin_question_verification_status` (view)  
**Migration file:** `20260408000002`

Migration 2 recreates this view as SECURITY INVOKER (correct) but adds no `GRANT SELECT` statement. In Supabase, new objects default to owner-only access. The `authenticated` role cannot SELECT from this view unless explicitly granted.

**Fix:**
```sql
GRANT SELECT ON public.admin_question_verification_status TO authenticated;
-- Or restrict to admin role:
GRANT SELECT ON public.admin_question_verification_status TO service_role;
```

---

### MEDIUM-2: Migration 3 Silently Swallows Function Alteration Failures

**Severity:** MEDIUM  
**Migration file:** `20260408000003_fix_search_path_on_secdef_functions.sql`

The DO block catches all exceptions with `RAISE WARNING` and continues:
```sql
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not set search_path on %.%: %', ...
```

Supabase migration logs may not surface `RAISE WARNING` outputs after deployment. Any SECURITY DEFINER function that failed to get `search_path = public` would remain vulnerable to search_path injection — the most common attack vector against SECURITY DEFINER functions in PostgreSQL. There is no way to know from the migration file how many functions (if any) failed.

**Fix:** Run this query to verify all SECURITY DEFINER functions now have `search_path` set:
```sql
SELECT n.nspname, p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef = true
  AND NOT EXISTS (
    SELECT 1 FROM pg_options_to_table(p.proconfig)
    WHERE option_name = 'search_path'
  );
```
Any rows returned are still vulnerable.

---

### MEDIUM-3: quiz_responses.subject Column Is a Denormalized Duplicate

**Severity:** MEDIUM  
**Table:** `quiz_responses`  
**Migration file:** `20260408000006` (relies on this column)

The IRT trigger uses `NEW.subject` from `quiz_responses`. However, subject is derivable from `question_bank.subject` via the `question_id` FK. Having subject stored redundantly in `quiz_responses` creates a data integrity risk: if a question's subject is ever corrected in `question_bank`, existing `quiz_responses` rows retain the stale subject value, causing the IRT model to bucket responses under the wrong subject.

**Fix:** Either add a `CHECK` constraint or trigger that validates `quiz_responses.subject = (SELECT subject FROM question_bank WHERE id = quiz_responses.question_id)`, or remove the column and derive subject via a JOIN in the IRT function.

---

### MEDIUM-4: IRT Theta Function Risks Numeric Instability at Extreme Response Histories

**Severity:** MEDIUM  
**Function:** `public.update_irt_theta()`  
**Migration file:** `20260408000006`

The Newton-Raphson computation is unbounded on history size. With 5,000+ responses for a long-term student, the accumulated Fisher information (`v_fisher_info`) can grow arbitrarily large, driving `v_se` toward zero (0 standard error). The guard `LEAST(9.99, v_se)` only caps the upper bound; there is no lower bound guard on `v_se`. A near-zero SE would incorrectly signal extreme certainty in theta estimation regardless of actual accuracy.

Additionally, if `ABS(v_l_double) < 1e-8` (convergence detected early), the Fisher information loop still runs over all responses — wasted compute.

**Fix:** Add `LIMIT 300` to the inner query (use recent 300 responses as a sliding window), which also bounds compute time. This is standard practice in CAT (Computer Adaptive Testing) systems.

---

### MEDIUM-5: Missing Guardian/Student Link Table in Migrations

**Severity:** MEDIUM  
**Table:** `guardian_student_links`  
**Migration files:** None

The `guardian_student_links` table (linking guardian accounts to students for parental oversight) is referenced in the audit scope but has no CREATE TABLE in any migration. Given that this table controls what student data guardians can see, its RLS policy is critical. Without it in version control, the RLS configuration cannot be audited.

**Fix:** Add to the initial schema migration (see CRITICAL-1).

---

### MEDIUM-6: Subscriptions/Payments Tables Not in Migrations

**Severity:** MEDIUM  
**Tables:** `subscriptions`, payment-related tables  
**Migration files:** None

`src/modules/payments/types.ts` defines `Subscription`, `PaymentOrder`, `WebhookEvent` types with fields like `plan`, `status`, `razorpay_subscription_id`, `current_period_end`. The corresponding tables are not in any migration. Payment data is among the most sensitive data in the application. Without the schema versioned:
- Missing `UNIQUE(student_id)` constraint on subscriptions could allow duplicate active subscriptions (double billing).
- RLS policy for subscriptions cannot be audited.

**Fix:** Add to the initial schema migration.

---

### MEDIUM-7: feature_flags Table Not in Migrations

**Severity:** MEDIUM  
**Table:** `feature_flags`  
**Migration files:** None

30 feature flags are referenced in the application but the table schema is not versioned. Feature flags likely control which students have access to paid/beta features. Without the schema, we cannot verify:
- Is `UNIQUE(flag_name)` enforced? (Duplicate flags could cause inconsistent feature gating)
- Is RLS enabled? (Students should not be able to read or modify their own flags)

---

### MEDIUM-8: adaptive_mastery Unique Constraint Relies on Application-Level onConflict

**Severity:** MEDIUM  
**Table:** `adaptive_mastery`  
**Migration files:** None (base schema not present)

The `ml-adaptation` Edge Function upserts with:
```typescript
.upsert(masteryUpdate, { onConflict: 'student_id,node_code' })
```

This relies on a `UNIQUE(student_id, node_code)` constraint existing in the database. If this constraint was dropped or never created (since we cannot verify the base schema), the `onConflict` clause silently falls back to an INSERT, creating duplicate mastery rows. This would cause the BKT model to diverge — each upsert adds a new row instead of updating the existing state.

**Verification:**
```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.adaptive_mastery'::regclass
  AND contype = 'u';
```

---

### MEDIUM-9: check_and_record_usage Return Column Name Changed Without API Version

**Severity:** MEDIUM  
**Function:** `public.check_and_record_usage`  
**Migration file:** `20260408000009`

Migration 9 removes the old overload that returned column `current_count`. The new signature returns `used_count`. The comment says `foxy-tutor v32` was updated to use `used_count`. However, if any other callers (e.g., a mobile client, analytics dashboard, or another Edge Function) still reference `current_count`, they will receive `null` silently (JavaScript doesn't throw on missing properties). This is an API breaking change without a versioning strategy.

**Fix:** Search all Edge Functions and client code for `current_count` to confirm no callers remain. Add a migration that adds `current_count` as an alias column temporarily if needed.

---

## Part 5 — LOW Findings

---

### LOW-1: admin_question_verification_status View Has No Teacher-Scoped RLS Policy

**Severity:** LOW  
**Object:** `public.admin_question_verification_status`

The view shows all questions from `question_bank` without any row-level filtering. Teachers who access this view can see questions from all grades, subjects, and boards — not just their own class content. If the view is intended for admins only, it should be restricted. If teachers should use it, a `WHERE grade = get_teacher_grade()` or similar filter is needed.

---

### LOW-2: Redundant HNSW and IVFFlat Vector Indexes on rag_content_chunks

**Severity:** LOW  
**Table:** `rag_content_chunks`  
**Migration file:** `20260408000005` (mentions retaining both)

Migration 5 explicitly retains "HNSW/IVFFlat vector indexes" as a class. Having both index types on the same `embedding` column is redundant — PostgreSQL's query planner will use one or the other but not both. HNSW generally outperforms IVFFlat for recall@10 at similar index build time. The IVFFlat index is wasting memory and slowing INSERT/UPDATE operations on `rag_content_chunks` with no query benefit.

**Fix:** Drop the IVFFlat index. Retain HNSW only.

---

### LOW-3: No NOT NULL Constraints Confirmed for Critical FK Columns

**Severity:** LOW  
**Tables:** `quiz_responses`, `adaptive_mastery`, `student_learning_profiles`

From the migrations, we can see columns like `quiz_responses.student_id` and `quiz_responses.question_id` are used in critical joins, but no `NOT NULL` or `FOREIGN KEY` constraint is visible in any migration. The IRT trigger function guards with `IF NEW.student_id IS NOT NULL AND NEW.subject IS NOT NULL THEN RETURN; END IF;` — suggesting nullable FKs are a known risk. Null FKs would silently skip IRT computation.

**Verification:**
```sql
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'quiz_responses'
  AND column_name IN ('student_id', 'question_id', 'quiz_session_id', 'subject');
```

---

### LOW-4: Numeric Type Inconsistency Between irt_difficulty and irt_theta

**Severity:** LOW  
**Tables:** `question_bank`, `student_learning_profiles`  
**Migration files:** `20260408000001`, `20260408000006`

Migration 1 stores `irt_difficulty` as `NUMERIC(X, 3)` (using `ROUND(...::numeric, 3)`). Migration 6 stores `irt_theta` as `double precision` (float8). The Newton-Raphson computation computes `v_theta - v_responses.b` where `v_theta` is float8 and `v_responses.b` is numeric. PostgreSQL coerces numeric to float8 implicitly, but at scale the rounding behavior differs: NUMERIC uses decimal rounding while float8 uses binary floating point. This can introduce tiny accumulated errors in the theta estimate.

**Fix:** Standardize both to `float8` (double precision) for consistency with the algorithm's expectations.

---

### LOW-5: deployment_history Table Has No Apparent RLS

**Severity:** LOW  
**Table:** `deployment_history`  
**Migration file:** `20260408000007` (adds `idx_deployment_history_triggered_by`)

Migration 7 adds an index on `deployment_history.triggered_by`, confirming the table exists. Deployment history is an audit table containing infrastructure operation records. If RLS is not enabled, any authenticated student can query it. Even if it contains no PII, it leaks infrastructure information (deployment timestamps, who triggered deploys).

---

### LOW-6: pilot_daily_metrics Exposes Cohort Analytics Without Scoping

**Severity:** LOW  
**Table:** `pilot_daily_metrics`  
**Migration file:** `20260408000007` (adds `idx_pilot_daily_metrics_cohort_id`)

Pilot cohort metrics exist as a table. Depending on RLS configuration (unverifiable without base schema), students in one cohort could potentially query aggregate metrics from other cohorts, exposing program performance data that is commercially or pedagogically sensitive.

---

## Part 6 — Migration Health Assessment

### Sequential Numbering
All 9 migrations share the prefix `20260408` with sequential suffixes `000001`–`000009`. No gaps. No conflicts. Migration ordering is deterministic.

### Fresh Database Reproducibility
**FAILS.** Without the base schema, running `supabase db push` on a new project will fail immediately because all 9 migrations reference tables, functions, indexes, and policies that do not exist.

### Idempotency
- Migrations 2, 4 use `DROP ... IF EXISTS` before recreation — idempotent.
- Migration 5 uses `DROP INDEX IF EXISTS` — idempotent.
- Migration 6, 8 use `CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` — idempotent.
- Migration 7 uses `CREATE INDEX IF NOT EXISTS` — idempotent.
- Migration 9 uses `DROP FUNCTION IF EXISTS` — idempotent.
- Migration 1 is `UPDATE` — running twice doubles `irt_difficulty` noise (hash is stable so re-running migration 1 is safe, but it modifies all rows again unnecessarily).
- Migration 3 is idempotent (ALTER FUNCTION is safe to re-run).

All migrations are re-run safe in isolation, but the backfill DO blocks in migrations 6 and 8 would re-run full computations on every `supabase db reset`.

### Conflicts
No conflicting migrations found. Each migration operates on distinct objects or uses `IF EXISTS` guards.

---

## Part 7 — Table × RLS Policy Matrix

| Table | RLS Enabled (Confirmed) | Student Policy | Teacher Policy | Admin/Service Policy | Notes |
|-------|------------------------|----------------|----------------|----------------------|-------|
| `adaptive_mastery` | ✅ Migration 2 | SELECT + UPDATE (own) | Not shown | Service role (migration 4) | INSERT policy not shown |
| `foxy_chat_messages` | ✅ Migration 2 | SELECT + INSERT (own) | Not shown | Service role (migration 4) | UPDATE/DELETE not shown |
| `foxy_sessions` | ✅ Migration 2 | SELECT only | Not shown | Service role (migration 4) | INSERT missing (HIGH-4) |
| `question_bank` | ❓ Assumed | Not shown | Not shown | Service role | Base schema not versioned |
| `quiz_responses` | ❓ Assumed | Not shown | Not shown | Service role | Base schema not versioned |
| `quiz_sessions` | ❓ Assumed | Not shown | Not shown | Service role | Trigger target |
| `student_learning_profiles` | ❓ Assumed | Not shown | Not shown | Service role | CRITICAL-2 risk |
| `adaptive_profile` | ❓ Assumed | Not shown | Not shown | Service role | CRITICAL-2 risk |
| `cognitive_session_metrics` | ❓ Unknown | None found | None found | None found | CRITICAL-4 |
| `ai_tutor_logs` | ❓ Unknown | None found | None found | None found | CRITICAL-4 |
| `audit_logs` | ❓ Unknown | None found | None found | None found | CRITICAL-4 |
| `rag_content_chunks` | ❓ Assumed | Not shown | Not shown | Service role | Public read likely OK |
| `concept_graph` | ❓ Assumed | Not shown | Not shown | Service role | Public read likely OK |
| `subscriptions` | ❓ Unknown | None found | None found | None found | HIGH sensitivity |
| `guardian_student_links` | ❓ Unknown | None found | None found | None found | HIGH sensitivity |
| `feature_flags` | ❓ Unknown | None found | None found | None found | Must be admin-only |
| `curriculum_topics` | ❓ Assumed | Not shown | Not shown | Service role | Migration 7 FK indexes added |

**Legend:** ✅ Confirmed enabled | ❓ Cannot confirm (base schema not versioned) | None found = no policy in any migration file

---

## Part 8 — Recommended Action Plan

### Immediate (before next production push)

1. **CRITICAL-1**: Export base schema from Supabase dashboard → `supabase/migrations/00000000000000_initial_schema.sql`
2. **CRITICAL-2**: Add UNIQUE constraints via new migration. Test with concurrent load.
3. **CRITICAL-3 / HIGH-6**: Verify migration 4 actually fixed the 37 policies (run the verification query above).
4. **CRITICAL-4**: For each of `cognitive_session_metrics`, `adaptive_profile`, `ai_tutor_logs`, `audit_logs` — verify `relrowsecurity = true` and add missing policies.
5. **HIGH-1 / HIGH-3**: Add composite indexes on `quiz_responses(student_id, subject)` and `quiz_responses(student_id, quiz_session_id)`.

### Next Sprint

6. **HIGH-4**: Add INSERT policy for `foxy_sessions`.
7. **HIGH-5**: Export and version all RPC function definitions.
8. **HIGH-7**: Add `CHECK(irt_difficulty BETWEEN -4.0 AND 4.0)` constraint to `question_bank`.
9. **HIGH-8**: Fix `cognitive_session_metrics.session_start` to use `quiz_sessions.created_at`.
10. **MEDIUM-4**: Add `LIMIT 300` sliding window to IRT computation query.

### Ongoing

11. **MEDIUM-5/6/7**: Version `guardian_student_links`, `subscriptions`, `feature_flags` table schemas.
12. **MEDIUM-8**: Verify `UNIQUE(student_id, node_code)` exists on `adaptive_mastery`.
13. **LOW-2**: Drop IVFFlat index on `rag_content_chunks.embedding`.
14. Establish migration hygiene: no DDL changes outside migration files; migration PR requires schema review.

---

*Audit generated from 9 migration files, 12 TypeScript source files, 3 Edge Functions. Base schema not available for inspection — findings marked ❓ require verification in the Supabase dashboard.*
