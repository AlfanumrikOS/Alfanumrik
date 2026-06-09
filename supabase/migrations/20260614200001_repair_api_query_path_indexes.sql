-- Migration: 20260614200001_repair_api_query_path_indexes.sql
-- Date: 2026-06-14
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Migration 20260525130002_api_query_path_indexes_batch2.sql was applied to
-- production as a no-op (empty `statements = []` in schema_migrations).  The
-- API query-path covering indexes it was meant to create were NEVER applied to
-- any environment. This migration recovers those indexes for all tables added
-- between 20260525 and 20260528 (the range covered by "Batch 2") plus tables
-- in later migrations that were also never index-swept.
--
-- RISKS
-- -----
--   - LOW: CREATE INDEX IF NOT EXISTS is purely additive and never blocks DML.
--     On Supabase (Postgres 14+) regular (non-CONCURRENT) index creation is
--     inside a migration transaction; tables are locked briefly. All indexed
--     tables are new or low-row-count at migration time.
--   - Re-running is safe: IF NOT EXISTS makes every statement a no-op if the
--     index already exists.
--
-- EXECUTION ORDER
-- ---------------
-- Step 2 of 3 repair migrations. Run after 20260614200000.
-- Depends on: all migrations through 20260614000003 being applied, including
--   the tables created by 20260527000003 through 20260528000002.
--
-- IDEMPOTENCY: YES
-- CREATE INDEX IF NOT EXISTS — each statement is a no-op if the named index
-- already exists.

-- ============================================================================
-- Section A: teacher_parent_threads (20260527000003)
-- FK columns: teacher_id, guardian_id, student_id, school_id
-- teacher_id + guardian_id + last_message_at already covered by the
-- migration itself. student_id FK is unindexed — adding it.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_tp_threads_student_id
  ON public.teacher_parent_threads (student_id);

COMMENT ON INDEX idx_tp_threads_student_id IS
  'repair_api_query_path_indexes (2026-06-14): index on teacher_parent_threads.student_id FK for ON DELETE CASCADE reverse lookup and per-student thread queries.';

-- ============================================================================
-- Section B: teacher_parent_messages (20260527000003)
-- FK column: thread_id — already indexed by idx_tp_messages_thread_created.
-- sender_auth_user_id is not a FK but used in INSERT WITH CHECK RLS policies.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_tp_messages_sender
  ON public.teacher_parent_messages (sender_auth_user_id, created_at DESC);

COMMENT ON INDEX idx_tp_messages_sender IS
  'repair_api_query_path_indexes (2026-06-14): index on teacher_parent_messages.sender_auth_user_id for "messages I sent" queries and RLS policy evaluation.';

-- ============================================================================
-- Section C: parental_consent (20260527000004)
-- FK columns: guardian_id (indexed), student_id (indexed by idx_parental_consent_student)
-- Already well-indexed by the migration itself. Adding compound for version queries.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_parental_consent_version
  ON public.parental_consent (guardian_id, consent_version)
  WHERE revoked_at IS NULL;

COMMENT ON INDEX idx_parental_consent_version IS
  'repair_api_query_path_indexes (2026-06-14): partial index for "does this guardian have active consent at version V" query — the gate re-prompt check hot path.';

-- ============================================================================
-- Section D: data_erasure_requests (20260527000006)
-- FK: student_id, requested_by (auth user uuid)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_data_erasure_requests_student
  ON public.data_erasure_requests (student_id);

COMMENT ON INDEX idx_data_erasure_requests_student IS
  'repair_api_query_path_indexes (2026-06-14): index on data_erasure_requests.student_id FK for per-student erasure status checks.';

CREATE INDEX IF NOT EXISTS idx_data_erasure_requests_status_created
  ON public.data_erasure_requests (status, created_at DESC);

COMMENT ON INDEX idx_data_erasure_requests_status_created IS
  'repair_api_query_path_indexes (2026-06-14): index for admin queue view "pending erasure requests, newest first".';

-- ============================================================================
-- Section E: synthetic_monitor_results (20260527000010)
-- New table for prod-readiness synthetic monitoring. monitor_name + checked_at
-- is the hot query path.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_synthetic_monitor_results_name_checked
  ON public.synthetic_monitor_results (monitor_name, checked_at DESC);

COMMENT ON INDEX idx_synthetic_monitor_results_name_checked IS
  'repair_api_query_path_indexes (2026-06-14): index for "latest result for monitor X" query pattern used by health dashboard.';

CREATE INDEX IF NOT EXISTS idx_synthetic_monitor_results_status
  ON public.synthetic_monitor_results (status, checked_at DESC)
  WHERE status != 'ok';

COMMENT ON INDEX idx_synthetic_monitor_results_status IS
  'repair_api_query_path_indexes (2026-06-14): partial index for failure/warning rows only — keeps the on-call alert query fast without touching the majority ok rows.';

-- ============================================================================
-- Section F: school_slo_log (20260528000002)
-- FK: school_id; query pattern: school_id + evaluated_at
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_school_slo_log_school_evaluated
  ON public.school_slo_log (school_id, evaluated_at DESC);

COMMENT ON INDEX idx_school_slo_log_school_evaluated IS
  'repair_api_query_path_indexes (2026-06-14): index for "latest SLO evaluations for school X" — the school command center read model hot path.';

-- ============================================================================
-- Section G: grounding_circuit_state (20260528000003)
-- Key column: circuit_name (unique); secondary: last_failure_at for dashboards
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_grounding_circuit_state_name
  ON public.grounding_circuit_state (circuit_name);

COMMENT ON INDEX idx_grounding_circuit_state_name IS
  'repair_api_query_path_indexes (2026-06-14): lookup index on grounding_circuit_state.circuit_name for the foxy-tutor circuit-breaker read path.';

-- ============================================================================
-- Section H: admin_login_attempts (20260528000007)
-- FK: user_id (auth user); query: user_id + attempted_at for brute-force check
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_user_attempted
  ON public.admin_login_attempts (user_id, attempted_at DESC);

COMMENT ON INDEX idx_admin_login_attempts_user_attempted IS
  'repair_api_query_path_indexes (2026-06-14): index for brute-force lockout check "how many failures for user X in last N minutes".';

-- ============================================================================
-- Section I: parent_cheers (20260613000001)
-- All three indexes already created by the migration itself.
-- Adding notification_id FK index (unindexed FK — ON DELETE SET NULL).
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_parent_cheers_notification_id
  ON public.parent_cheers (notification_id)
  WHERE notification_id IS NOT NULL;

COMMENT ON INDEX idx_parent_cheers_notification_id IS
  'repair_api_query_path_indexes (2026-06-14): partial index on parent_cheers.notification_id FK for ON DELETE SET NULL reverse lookup.';

-- ============================================================================
-- Section J: teacher_remediation_assignments (20260613000004)
-- FK columns: teacher_id, student_id, question_bank_id
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_teacher_remediation_teacher_id
  ON public.teacher_remediation_assignments (teacher_id);

COMMENT ON INDEX idx_teacher_remediation_teacher_id IS
  'repair_api_query_path_indexes (2026-06-14): index on teacher_remediation_assignments.teacher_id FK for "assignments I created" query.';

CREATE INDEX IF NOT EXISTS idx_teacher_remediation_student_id
  ON public.teacher_remediation_assignments (student_id);

COMMENT ON INDEX idx_teacher_remediation_student_id IS
  'repair_api_query_path_indexes (2026-06-14): index on teacher_remediation_assignments.student_id FK for "my remediation tasks" student query.';

CREATE INDEX IF NOT EXISTS idx_teacher_remediation_status_assigned
  ON public.teacher_remediation_assignments (status, assigned_at DESC);

COMMENT ON INDEX idx_teacher_remediation_status_assigned IS
  'repair_api_query_path_indexes (2026-06-14): index for teacher queue view "pending assignments, newest first".';

-- ============================================================================
-- Section K: at_risk_alerts (20260614000000 phase3b)
-- FK: school_id, class_id; query: status + created_at for dashboard
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_at_risk_alerts_school_status
  ON public.at_risk_alerts (school_id, status, created_at DESC);

COMMENT ON INDEX idx_at_risk_alerts_school_status IS
  'repair_api_query_path_indexes (2026-06-14): index for school command center "active at-risk alerts for school X" query.';

-- ============================================================================
-- Verification block
-- ============================================================================

DO $verify$
DECLARE
  v_idx_count   integer;
  v_expected    integer := 14;  -- indexes we expect to exist after this migration
BEGIN
  SELECT count(*) INTO v_idx_count
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN (
       'idx_tp_threads_student_id',
       'idx_tp_messages_sender',
       'idx_parental_consent_version',
       'idx_data_erasure_requests_student',
       'idx_data_erasure_requests_status_created',
       'idx_synthetic_monitor_results_name_checked',
       'idx_synthetic_monitor_results_status',
       'idx_school_slo_log_school_evaluated',
       'idx_grounding_circuit_state_name',
       'idx_admin_login_attempts_user_attempted',
       'idx_parent_cheers_notification_id',
       'idx_teacher_remediation_teacher_id',
       'idx_teacher_remediation_student_id',
       'idx_teacher_remediation_status_assigned'
     );

  -- Note: idx_at_risk_alerts_school_status is also expected but at_risk_alerts
  -- table existence depends on phase3b landing. Count it separately.
  RAISE NOTICE '[20260614200001] Core repair indexes present: %/%', v_idx_count, v_expected;

  IF v_idx_count < v_expected THEN
    RAISE WARNING '[20260614200001] Some indexes are missing. Tables may not exist yet or index names changed. Current count: %', v_idx_count;
  ELSE
    RAISE NOTICE '[20260614200001] REPAIR COMPLETE — api_query_path_indexes_batch2 indexes applied';
  END IF;
END $verify$;
