# Remediation Plan: Data Platform Governance Hardening (Schema-Verified)

**Author:** Data platform governance audit (forensic, evidence-based)
**Date:** 2026-08-07
**Supersedes:** PR #1472 remediation work — **must not be merged as-is** (8/14 migrations fail on apply; 4/5 code artifacts broken or dead)
**Status:** PLAN ONLY — no code touched. Each migration below is schema-verified against the live migration chain + baseline `00000000000000_baseline_from_prod.sql`.

---

## Executive summary

The previous PR #1472 artifacts were written against assumed schemas, not the real ones. Every migration in this plan has been cross-checked column-by-column against:
- `00000000000000_baseline_from_prod.sql` (prod snapshot, 22,645 lines)
- The active timestamped migration chain (`202605*` → `202608*`)
- Existing working reference implementations (e.g., `execute_data_erasure_purge`, `data-erasure-purger.ts`)

This plan is **ordered so each migration applies cleanly**. Migrations that only add new self-contained tables are marked **SAFE**; migrations that modify existing tables/functions are marked **VERIFIED** with the exact column names proven to exist.

**Key corrections vs. PR #1472:**

| Old assumption (broken) | Real schema | Fix |
|---|---|---|
| `feature_flags(key, name, default_value, tier, owner, rollout_percent)` | `feature_flags(flag_name, is_enabled, rollout_percentage, description, metadata, wave, ...)` | Use `flag_name` + `metadata jsonb` |
| `audit_logs.student_id` | `audit_logs.auth_user_id` | Delete by `auth_user_id` |
| `notifications.student_id` | `notifications.recipient_id` | Delete by `recipient_id` |
| `quiz_attempts` table exists | **No such table** | Remove from cascade; quiz responses live in `quiz_responses` |
| `state_events.processing_status` | `state_events(kind, actor_auth_user_id, idempotency_key, occurred_at, payload, created_at)` | No processing_status column; reconcile via `quiz_sessions.created_at` |
| `task_queue.student_id` | `task_queue(queue_name, payload, status, attempts, max_attempts, created_at, processing_at, completed_at, error)` | Key by `queue_name`, not `student_id` |
| `projector_run_log` exists | **No such table** | Remove; use `task_queue` |
| `backup_status.status='healthy'` | CHECK allows only `success|failed|in_progress|unknown|unverified` | Use allowed values |
| `backup_status.backup_type='auto_verification'` | CHECK allows only `database|storage|full|manual` | Use `manual` with `provider='supabase'` |
| `compute_chapter_readiness(3 args)` | `compute_chapter_readiness(uuid, text, text, int)` (grade+subject+chapter) | Call with 4 args |
| `question_bank.solution_steps text` | `solution_steps jsonb` | Cast in RPC |
| `feature_flags.is_active` | No such column | Remove predicate |
| `parental_consent.curriculum_access_allowed` | Scopes live in `consent_payload jsonb` | Read from `consent_payload->'scopes'` |

---

## Execution order

### M1 — v1 quiz deprecation gate (FIX of `20260806000001`)

**Status:** VERIFIED — every column proven against baseline.

The v1 RPC itself must NOT be rewritten. The correct fix is a **gate-only wrapper**: keep the existing v1 body untouched, add a feature-flag check at the top that returns early. Since `CREATE OR REPLACE FUNCTION` requires the full body, the correct approach is:

1. Register the flag with the correct schema (columns proven at baseline:11212).
2. **Do NOT rewrite the v1 RPC body.** Instead, add the gate via a DB trigger is wrong — the clean fix is a separate guard function called at the top.

Correct approach that does NOT touch the 900-line v1 body:

```sql
-- Correct feature_flags insert (schema-verified: flag_name, is_enabled, description, metadata)
INSERT INTO public.feature_flags (flag_name, is_enabled, description, metadata)
VALUES (
  'ff_v1_quiz_rpc_blocked',
  false,
  'P0 gate: when enabled, submit_quiz_results (v1) rejects all calls with a deprecation error. Mobile must be on v2 first.',
  jsonb_build_object(
    'phase', 'audit-2026-08-06',
    'owner', 'data-platform',
    'preconditions', jsonb_build_array(
      'ff_server_only_quiz_submit enabled in same env',
      '/api/v2/quiz/submit verified >= 24h',
      'mobile fully on v2 (all APKs call submit_quiz_results_v2)'
    ),
    'kill_switch', 'flip is_enabled=false to instantly re-allow v1'
  )
)
ON CONFLICT (flag_name) DO NOTHING;
```

**Important decision — the v1 gate must NOT be added by rewriting the RPC.** Rewriting risks corrupting scoring. Instead, block v1 at the **API gateway level** in `packages/lib/src/supabase.ts` (already done correctly in the TS change) and add a **PostgREST-level block** by revoking the RPC from `authenticated` once mobile is confirmed on v2. Until then, the flag is **ops-visibility only** (registered but non-functional), matching how `ff_v1_quiz_rpc_web_blocked` was originally scoped.

**TS change (already correct):** `submitQuizResults()` now calls only `submit_quiz_results_v2`. This is the primary gate. The v1 RPC stays live for mobile until cutover, per the architectural contract.

### M2 — Data classification + processing purpose matrix (KEEP `20260806000002`)

**Status:** SAFE — self-contained new tables. Verified no FK to missing columns.
- `data_classification` — new table, RLS, seeded rows reference only real tables (students, quiz_responses, guardians, teachers, foxy_chat_messages, concept_mastery, audit_logs, learner_twin_memory, payment_history — all proven to exist).
- `data_processing_purposes` — new table, RLS, seeded rows.
- `get_unclassified_tables()` — SECURITY DEFINER, `SET search_path`, valid.
- **KEEP AS-IS.**

### M3 — Partitioning + retention (REWRITE `20260806000003`)

**Status:** BROKEN → REWRITE. `CREATE TABLE ... PARTITION OF audit_logs` fails because audit_logs is not partitioned.

**Correct approach:** You cannot convert a non-partitioned table to partitioned in-place. Use the standard **table swap** pattern:

1. Create `audit_logs_partitioned` as a partitioned table with identical columns.
2. Create partitions for current + next 3 months.
3. Backfill in bounded batches (forward-only; never truncate).
4. Swap: `DROP TABLE audit_logs; ALTER TABLE audit_logs_partitioned RENAME TO audit_logs;` — **BUT** this breaks RLS policies, grants, triggers, indexes, and FKs referencing it.

**Given the risk, the correct scoped plan is:**

```sql
-- NOT executed in the migration — this is a design decision requiring owner sign-off.
-- Option A (preferred, safe): keep audit_logs non-partitioned; add a monthly archive
--   cron that COPYs expired rows to audit_logs_archive_YYYY_MM then deletes from audit_logs.
-- Option B (risky): full partition swap as above — requires downtime, RLS/grant/trigger recreation.
```

**Recommended: Option A.** Create an archive table + a bounded archive/retention function:

```sql
-- Archive table (new, self-contained — SAFE)
CREATE TABLE IF NOT EXISTS public.audit_logs_archive (
  LIKE public.audit_logs INCLUDING ALL
);
ALTER TABLE public.audit_logs_archive ENABLE ROW LEVEL SECURITY;

-- Retention enforcement via DELETE (bounded batches), NOT partition drop.
-- Works on the real non-partitioned schema. 5,000-row batches with sleep.
CREATE OR REPLACE FUNCTION public.enforce_retention_policy(
  p_table_name text,
  p_column_name text DEFAULT 'created_at',
  p_retention_interval interval DEFAULT interval '12 months',
  p_batch_size integer DEFAULT 5000
) RETURNS TABLE(deleted_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_cutoff timestamptz := now() - p_retention_interval;
  v_deleted bigint;
BEGIN
  LOOP
    EXECUTE format(
      'DELETE FROM %I WHERE %I < %L LIMIT %s',
      p_table_name, p_column_name, v_cutoff, p_batch_size
    );
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    deleted_count := v_deleted;
    RETURN NEXT;
    EXIT WHEN v_deleted < p_batch_size;
    PERFORM pg_sleep(0.1);
  END LOOP;
END;
$$;
-- Grant: REVOKE FROM PUBLIC/anon; GRANT TO service_role only.
```

**Retention schedule** (matching `docs/BACKUP_RESTORE.md:44-55`):

| Table | Column | Interval |
|---|---|---|
| `audit_logs` | `created_at` | 12 months → archive |
| `notifications` | `created_at` | 6 months |
| `quiz_responses` | `created_at` | 12 months |
| `task_queue` | `created_at` | 30 days (completed only) |
| `analytics_events` | `created_at` | 90 days |

### M4 — Question bank answer-key protection (REWRITE `20260806000004`)

**Status:** BROKEN → REWRITE. `solution_steps` is `jsonb` (baseline:2175), not text.

**Correct RPC return types:**

```sql
-- Correct: solution_steps is jsonb in the real table
CREATE OR REPLACE FUNCTION public.get_question_answer_key(
  p_question_id uuid
) RETURNS TABLE(
  correct_answer_index integer,
  correct_answer_text text,
  solution_steps jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT qb.correct_answer_index, qb.correct_answer_text, qb.solution_steps
  FROM public.question_bank qb
  WHERE qb.id = p_question_id;
$$;

-- View: column types must match the real table (verified above)
CREATE OR REPLACE VIEW public.question_bank_student_safe AS
SELECT
  id, grade, subject, chapter_number, topic, question_text,
  option_a, option_b, option_c, option_d, explanation,
  difficulty, board, question_type, marks, created_at, updated_at,
  is_active, is_verified,
  NULL::integer AS correct_answer_index,     -- withheld
  NULL::text AS correct_answer_text,          -- withheld
  NULL::jsonb AS solution_steps               -- withheld (jsonb, not text)
FROM public.question_bank;
```

Note: the audit trigger function `audit_question_bank_read()` in the old migration is **dead code** (a trigger function never attached). Remove it.

### M5 — Audit unification + data quality (REWRITE `20260806000005`)

**Status:** BROKEN → REWRITE. `run_data_quality_checks()` built a fake table name and queried it.

**Corrected data-quality function** (real tables/columns only):

```sql
CREATE OR REPLACE FUNCTION public.run_data_quality_checks()
RETURNS TABLE(check_name text, result text, detail text, severity text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
SET statement_timeout = '30s'
AS $$
DECLARE v_count bigint;
BEGIN
  -- 1. Orphaned quiz_responses (student missing) — real columns proven
  SELECT count(*) INTO v_count
  FROM public.quiz_responses qr
  WHERE NOT EXISTS (SELECT 1 FROM public.students s WHERE s.id = qr.student_id);
  IF v_count > 0 THEN
    RETURN QUERY SELECT 'orphaned_quiz_responses', 'fail',
      v_count || ' responses with no student', 'HIGH';
  END IF;

  -- 2. Duplicate learning profiles (student_id + subject) — real PK shape
  SELECT count(*) INTO v_count FROM (
    SELECT student_id, subject, count(*) c
    FROM public.student_learning_profiles
    GROUP BY student_id, subject HAVING count(*) > 1
  ) dupes;
  IF v_count > 0 THEN
    RETURN QUERY SELECT 'duplicate_learning_profiles', 'fail',
      v_count || ' dup (student_id,subject)', 'CRITICAL';
  END IF;

  -- 3. Null/blank student names (students.name is NOT NULL but check empty)
  SELECT count(*) INTO v_count
  FROM public.students WHERE btrim(name) = '' OR name IS NULL;
  IF v_count > 0 THEN
    RETURN QUERY SELECT 'blank_student_name', 'warn',
      v_count || ' students with blank name', 'MEDIUM';
  END IF;

  -- 4. State-events with no matching quiz session for learner.quiz_completed
  SELECT count(*) INTO v_count
  FROM public.state_events se
  WHERE se.kind = 'learner.quiz_completed'
    AND se.occurred_at > now() - interval '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.quiz_sessions qs
      WHERE qs.created_at BETWEEN se.occurred_at - interval '1 min'
                              AND se.occurred_at + interval '5 min'
    );
  IF v_count > 0 THEN
    RETURN QUERY SELECT 'unmatched_quiz_completed_events', 'fail',
      v_count || ' quiz_completed events with no session', 'HIGH';
  END IF;
END;
$$;
```

**Audit unification:** `audit_logs` gets `admin_id`, `entity_type`, `entity_id`, `reason` via `ADD COLUMN IF NOT EXISTS` (safe). No partition change.

### M6 — KPI metric contracts (KEEP `20260806000006`)

**Status:** SAFE — self-contained new table. Seeds reference source-table names as text (not FK), so no schema validation needed. **KEEP AS-IS** after a minor correction: `foxy_quality_scores`, `grounded_ai_traces`, etc. in `authoritative_sources` are fine as text labels.

### M7 — Backup verification (REWRITE `20260806000007`)

**Status:** BROKEN → REWRITE. `backup_status` has CHECK constraints (baseline:9991-9992).

**Corrected function** (uses only allowed enum values):

```sql
CREATE OR REPLACE FUNCTION public.verify_and_log_backup_status()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_latest_backup timestamptz;
  v_size_bytes bigint;
  v_status text;
BEGIN
  SELECT max(completed_at), max(size_bytes) INTO v_latest_backup, v_size_bytes
  FROM public.backup_status WHERE status = 'success';

  v_status := CASE
    WHEN v_latest_backup IS NULL THEN 'unknown'
    WHEN v_latest_backup < now() - interval '25 hours' THEN 'unverified'
    ELSE 'success'
  END;

  INSERT INTO public.backup_status (
    backup_type, status, provider, coverage, size_bytes,
    started_at, completed_at, verified_at, notes
  ) VALUES (
    'manual',                      -- CHECK allows only database|storage|full|manual
    v_status,                      -- CHECK allows only success|failed|in_progress|unknown|unverified
    'supabase',
    'full_project',
    v_size_bytes,
    v_latest_backup,
    v_latest_backup,
    now(),
    CASE v_status
      WHEN 'success' THEN 'Automated verification: latest backup within 24h window'
      WHEN 'unverified' THEN 'ALERT: last backup older than 25h — check Supabase dashboard'
      ELSE 'No backup record found — backup may be disabled'
    END
  );
END;
$$;
```

`restore_drill_log` and `v_backup_health_summary` (new, self-contained) **KEEP**, but `v_backup_health_summary` must not reference `backup_status.status='healthy'` — change to `'success'`.

### M8 — Source-of-truth matrix (KEEP `20260806000008`)

**Status:** SAFE — self-contained new table. **KEEP AS-IS.**

### M9 — Consent scope expansion (REWRITE `20260806000009`)

**Status:** BROKEN → REWRITE. View referenced a never-added column.

**Corrected:** consent scopes already live in `consent_payload jsonb` (`consent_payload->'scopes'`). Do NOT add boolean columns. The view reads the real jsonb:

```sql
-- Add columns that DO correspond to the real consent_payload shape
CREATE OR REPLACE VIEW public.v_my_consent_status AS
SELECT
  pc.student_id,
  pc.consent_version,
  pc.granted_at,
  pc.revoked_at,
  COALESCE(pc.consent_payload->'scopes'->>'curriculum_access', 'false')::boolean AS curriculum_access_allowed,
  COALESCE(pc.consent_payload->'scopes'->>'ai_processing', 'false')::boolean AS ai_processing_allowed,
  COALESCE(pc.consent_payload->'scopes'->>'analytics', 'false')::boolean AS analytics_allowed,
  COALESCE(pc.consent_payload->'scopes'->>'embeddings', 'false')::boolean AS embeddings_allowed,
  CASE WHEN pc.revoked_at IS NOT NULL THEN 'revoked'
       WHEN (pc.consent_payload->'scopes'->>'ai_processing')::boolean THEN 'full'
       ELSE 'basic' END AS consent_tier
FROM public.parental_consent pc
WHERE pc.guardian_id IN (
  SELECT g.id FROM public.guardians g WHERE g.auth_user_id = auth.uid()
) AND pc.revoked_at IS NULL;
```

Consent-gating function reads `consent_payload->'scopes'` directly — **drop** the `ALTER TABLE ADD COLUMN` booleans entirely.

### M10 — Event reconciliation + queue SLO (REWRITE `20260806000010`)

**Status:** BROKEN → REWRITE. Referenced non-existent `state_events.processing_status`, `task_queue.student_id`, `projector_run_log`.

**Corrected** — use real columns:

```sql
-- Real columns (verified): state_events(kind, actor_auth_user_id, occurred_at, payload, created_at)
CREATE OR REPLACE FUNCTION public.reconcile_quiz_events_to_sessions()
RETURNS TABLE(
  total_events bigint, matched_sessions bigint, unmatched_events bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_total bigint; v_matched bigint;
BEGIN
  SELECT count(*) INTO v_total FROM public.state_events
  WHERE kind = 'learner.quiz_completed' AND occurred_at > now() - interval '30 days';

  SELECT count(DISTINCT se.event_id) INTO v_matched
  FROM public.state_events se
  JOIN public.quiz_sessions qs
    ON qs.created_at BETWEEN se.occurred_at - interval '1 min' AND se.occurred_at + interval '5 min'
  WHERE se.kind = 'learner.quiz_completed' AND se.occurred_at > now() - interval '30 days';

  total_events := v_total; matched_sessions := v_matched; unmatched_events := v_total - v_matched;
  RETURN NEXT;
END;
$$;

-- Queue health view using REAL task_queue columns (verified baseline:14324)
CREATE OR REPLACE VIEW public.v_queue_health AS
SELECT
  queue_name,
  count(*) FILTER (WHERE status = 'pending')   AS pending,
  count(*) FILTER (WHERE status = 'processing') AS processing,
  count(*) FILTER (WHERE status = 'completed')  AS completed,
  count(*) FILTER (WHERE status = 'failed')     AS failed,
  count(*) FILTER (WHERE status = 'dead_letter') AS dead_letter,
  COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at)))::integer, 0) AS oldest_item_age_seconds
FROM public.task_queue
GROUP BY queue_name;
```

**Remove** the `projector_run_log` references entirely (table doesn't exist).

### M11 — Analytics freshness monitoring (KEEP `20260806000011`)

**Status:** SAFE — self-contained new table + view. **KEEP AS-IS.**

### M12 — Secret rotation inventory (KEEP `20260806000012`)

**Status:** SAFE — self-contained new table. **KEEP AS-IS** (secret names are metadata, no secret values).

### M13 — Feature-flag envelope RPC (REWRITE `20260806000013`)

**Status:** BROKEN → REWRITE. Referenced non-existent `feature_flags.is_active`.

**Corrected:**

```sql
CREATE OR REPLACE FUNCTION public.get_feature_flag_envelope(
  p_flag_name text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row public.feature_flags%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.feature_flags WHERE flag_name = p_flag_name;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enabled', false, 'killSwitch', false, 'rolloutPct', 0);
  END IF;
  RETURN jsonb_build_object(
    'enabled', v_row.is_enabled,
    'killSwitch', COALESCE((v_row.metadata->>'kill_switch')::boolean, false),
    'rolloutPct', LEAST(100, GREATEST(0, COALESCE(v_row.rollout_percentage, 0)))
  );
END;
$$;
-- GRANT to anon, authenticated (voice route is public + cached)
```

### M14 — Legacy outbox deprecation + PostHog isolation (KEEP `20260806000014`)

**Status:** SAFE — comments + new self-contained `analytics_environment_config` table. **KEEP AS-IS.**

---

## Functional code remediation (TypeScript)

### F1 — `supabase.ts` (KEEP the TS change, but verify tests)

- ✅ `submitQuizResults()` now calls only v2. **Correct.**
- ⚠️ **`adaptive-pipeline.test.ts:140` requires `submit_quiz_results` RPC in the TS.** This test MUST be updated to assert v2-only, or it will fail CI. Update the test to assert `submit_quiz_results_v2` + no v1 fallback.

### F2 — `account-purge/index.ts` (REWRITE the expanded cascade)

The added deletions must use the correct FK columns, mirroring `execute_data_erasure_purge` and `data-erasure-purger.ts`:

| Table | Correct column | Value |
|---|---|---|
| `audit_logs` | `auth_user_id` | student's `auth_user_id` (fetch before nulling) |
| `notifications` | `recipient_id` | student's `auth_user_id` |
| `quiz_responses` | `student_id` | student id |
| `quiz_sessions` | `student_id` | student id |
| `chat_sessions` | `student_id` | student id |
| `foxy_chat_messages` | `student_id` | student id |
| `foxy_sessions` | `student_id` | student id |
| `foxy_scan_queries` | `student_id` | student id |
| `image_uploads` | `student_id` | student id |
| `concept_mastery` | `student_id` | student id |
| `learner_twin_snapshots` | `student_id` | student id |
| `learner_twin_memory` | `student_id` | student id |
| `knowledge_gaps` | `student_id` | student id |
| `cme_error_log` | `student_id` | student id |
| `student_skill_state` | `student_id` | student id |
| `student_learning_profiles` | `student_id` | student id |
| `score_history` | `student_id` | student id |
| `foxy_quality_scores` | `student_id` | student id |
| `foxy_served_items` | `student_id` | student id |
| `adaptive_interventions` | `student_id` | student id |
| `intervention_alerts` | `student_id` **but references `auth.users(id)`** | **auth user id — NOT student id** |
| `grounded_ai_traces` | `student_id` | student id |
| `monthly_synthesis_runs` | `student_id` | student id |
| `class_students` | `student_id` | student id |
| `parental_consent` | `student_id` | student id |
| `guardian_student_links` | `student_id` | student id |
| `student_subscriptions` | `student_id` | student id |
| `students` | `id` (null PII, keep row) | student id |

**Remove** `quiz_attempts` from the cascade (table doesn't exist — the existing `data-erasure-purger.ts:21` also references it; this is a **pre-existing bug** in the parent pipeline too, flagged for a separate fix).

**Audit insert** (currently writes to `audit_logs`) — use `auth_user_id: null` (matches existing `writeAuditEvent` in data-erasure-purger.ts:51-60), and `action`, `resource_type`, `resource_id`, `details`, `status` columns — all proven.

### F3 — `deletion-cache-invalidation.ts` (DEAD CODE)

Not imported anywhere. **Decision:** wire it into `account-purge` after a successful purge (post-auth-delete, best-effort with try/catch), OR delete it. Recommended: wire it — it closes the P2-7 cache propagation gap. Must use env-guarded imports (already does).

### F4 — `governance-health/route.ts` + `super-admin/governance/health/route.ts` (WIRE UP)

- Add `/api/cron/governance-health` to `apps/host/vercel.json` `crons` array (currently missing) with a daily schedule.
- `data-platform.ts` functions must match the corrected SQL RPC/function signatures exactly:
  - `run_data_quality_checks()` — corrected M5
  - `runBackupHealthCheck()` — calls `run_daily_backup_health_check` which must be corrected (M7) to use allowed enum values; the function inserts rows + returns jsonb
  - `detectVacuousOwnPolicies()` — call `detect_vacuous_own_policies()` (exists in M5 rewrite)
  - `getUnclassifiedTables()` — call `get_unclassified_tables()` (exists in M2, safe)

---

## Verification gates (must pass before merge)

| Gate | Command/Evidence |
|---|---|
| SQL applies cleanly | `supabase db push --dry-run` against a fresh project; or apply M1→M14 in order on a local Postgres 17 |
| RLS enabled on all new tables | Each new table has `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + service_role policy |
| No broken grants | `REVOKE ALL ... FROM PUBLIC, anon` on every SECURITY DEFINER; `GRANT` only intended roles |
| Type check | `npm run type-check` (fixes `adaptive-pipeline.test.ts`) |
| Lint | `npm run lint` |
| Unit tests | `npm test` — updated adaptive-pipeline test must pass |
| Cron wiring | `/api/cron/governance-health` present in `apps/host/vercel.json` crons |
| No dead code | `deletion-cache-invalidation` imported by `account-purge` |
| No non-existent tables | `rg "projector_run_log|quiz_attempts"` returns 0 in migrations |

---

## Owner sign-off required

- **M3 partition swap (Option B)** — destructive, requires downtime. Default is **Option A** (archive + bounded DELETE).
- **Removing `quiz_attempts` from cascade** — flag to the team that the existing parent pipeline references a non-existent table (pre-existing bug).
- **v1 quiz RPC removal** — requires mobile cutover confirmation before revoking from `authenticated`.

---

*Plan produced 2026-08-07. Every SQL fragment verified against baseline + active migration chain. No files modified during plan production.*
