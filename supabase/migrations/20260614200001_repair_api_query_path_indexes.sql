-- Migration: 20260614200001_repair_api_query_path_indexes.sql
-- Date: 2026-06-14
-- Fixed: 2026-06-14 v2 -- removed wrong-column/wrong-table index statements
--   Section E: monitor_name/status do not exist on synthetic_monitor_results
--              (actual columns: host, ok). Replaced with host-based index.
--              Failure partial index NOT recreated (already exists as
--              idx_synthetic_monitor_results_recent_failures).
--   Section F: table school_slo_log does not exist. Actual tables school_slo
--              and health_check_log already indexed by 20260528000002. Removed.
--   Section H: user_id does not exist on admin_login_attempts. email +
--              ip_address already indexed by 20260528000007. Removed.
--   Expected index count updated: 14 -> 11.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Migration 20260525130002_api_query_path_indexes_batch2.sql was applied to
-- production as a no-op (empty statements = [] in schema_migrations). The
-- API query-path covering indexes it was meant to create were NEVER applied.
--
-- RISKS: LOW -- CREATE INDEX IF NOT EXISTS is purely additive, never blocks DML.
-- IDEMPOTENCY: YES -- IF NOT EXISTS is a no-op if index already exists.
-- EXECUTION ORDER: Step 2 of 3. Run after 20260614200000.

-- ============================================================================
-- Section A: teacher_parent_threads (20260527000003)
-- student_id FK is unindexed -- adding it.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_tp_threads_student_id
  ON public.teacher_parent_threads (student_id);

COMMENT ON INDEX idx_tp_threads_student_id IS
  'repair_api_query_path_indexes (2026-06-14): student_id FK index for ON DELETE CASCADE lookup and per-student thread queries.';

-- ============================================================================
-- Section B: teacher_parent_messages (20260527000003)
-- sender_auth_user_id used in RLS INSERT WITH CHECK -- adding it.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_tp_messages_sender
  ON public.teacher_parent_messages (sender_auth_user_id, created_at DESC);

COMMENT ON INDEX idx_tp_messages_sender IS
  'repair_api_query_path_indexes (2026-06-14): sender_auth_user_id index for messages-I-sent queries and RLS policy evaluation.';

-- ============================================================================
-- Section C: parental_consent (20260527000004)
-- Adding compound index for version queries.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_parental_consent_version
  ON public.parental_consent (guardian_id, consent_version)
  WHERE revoked_at IS NULL;

COMMENT ON INDEX idx_parental_consent_version IS
  'repair_api_query_path_indexes (2026-06-14): partial index for active-consent-at-version-V check -- gate re-prompt hot path.';

-- ============================================================================
-- Section D: data_erasure_requests (20260527000006)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_data_erasure_requests_student
  ON public.data_erasure_requests (student_id);

COMMENT ON INDEX idx_data_erasure_requests_student IS
  'repair_api_query_path_indexes (2026-06-14): student_id FK index for per-student erasure status checks.';

CREATE INDEX IF NOT EXISTS idx_data_erasure_requests_status_created
  ON public.data_erasure_requests (status, created_at DESC);

COMMENT ON INDEX idx_data_erasure_requests_status_created IS
  'repair_api_query_path_indexes (2026-06-14): status index for admin pending-erasure queue view.';

-- ============================================================================
-- Section E: synthetic_monitor_results (20260527000010)
-- Actual schema: school_id, host, checked_at, ok (boolean), failure_reason.
-- NO monitor_name or status columns exist on this table.
-- Table already has idx_synthetic_monitor_results_school_checked and
-- idx_synthetic_monitor_results_recent_failures from 20260527000010.
-- Adding per-host lookup index only. Failure index NOT recreated.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_synthetic_monitor_results_host_checked
  ON public.synthetic_monitor_results (host, checked_at DESC);

COMMENT ON INDEX idx_synthetic_monitor_results_host_checked IS
  'repair_api_query_path_indexes (2026-06-14 v2): per-host latest-result lookup. Uses column host (monitor_name does not exist on this table).';

-- ============================================================================
-- Section F: school_slo / health_check_log (20260528000002)
-- NOTE: school_slo_log does NOT exist. Actual tables: school_slo, health_check_log.
-- Both fully indexed by their own migration (20260528000002). No statements.
-- ============================================================================

-- (No statements -- school_slo and health_check_log already covered.)

-- ============================================================================
-- Section G: grounding_circuit_state (20260528000003)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_grounding_circuit_state_name
  ON public.grounding_circuit_state (circuit_name);

COMMENT ON INDEX idx_grounding_circuit_state_name IS
  'repair_api_query_path_indexes (2026-06-14): circuit_name lookup for foxy-tutor circuit-breaker read path.';

-- ============================================================================
-- Section H: admin_login_attempts (20260528000007)
-- NOTE: user_id does NOT exist. Actual: email, ip_address.
-- idx_admin_login_attempts_email_recent and idx_admin_login_attempts_ip_recent
-- already created by 20260528000007. No statements.
-- ============================================================================

-- (No statements -- admin_login_attempts already covered.)

-- ============================================================================
-- Section I: parent_cheers (20260613000001)
-- notification_id FK unindexed (ON DELETE SET NULL) -- adding it.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_parent_cheers_notification_id
  ON public.parent_cheers (notification_id)
  WHERE notification_id IS NOT NULL;

COMMENT ON INDEX idx_parent_cheers_notification_id IS
  'repair_api_query_path_indexes (2026-06-14): partial index on notification_id FK for ON DELETE SET NULL reverse lookup.';

-- ============================================================================
-- Section J: teacher_remediation_assignments (20260613000004)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_teacher_remediation_teacher_id
  ON public.teacher_remediation_assignments (teacher_id);

COMMENT ON INDEX idx_teacher_remediation_teacher_id IS
  'repair_api_query_path_indexes (2026-06-14): teacher_id FK index for assignments-I-created query.';

CREATE INDEX IF NOT EXISTS idx_teacher_remediation_student_id
  ON public.teacher_remediation_assignments (student_id);

COMMENT ON INDEX idx_teacher_remediation_student_id IS
  'repair_api_query_path_indexes (2026-06-14): student_id FK index for my-remediation-tasks query.';

CREATE INDEX IF NOT EXISTS idx_teacher_remediation_status_assigned
  ON public.teacher_remediation_assignments (status, assigned_at DESC);

COMMENT ON INDEX idx_teacher_remediation_status_assigned IS
  'repair_api_query_path_indexes (2026-06-14): status index for teacher pending-assignments queue view.';

-- ============================================================================
-- Section K: at_risk_alerts (20260614000000 phase3b)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_at_risk_alerts_school_status
  ON public.at_risk_alerts (school_id, status, created_at DESC);

COMMENT ON INDEX idx_at_risk_alerts_school_status IS
  'repair_api_query_path_indexes (2026-06-14): school_id + status index for school command center at-risk alerts.';

-- ============================================================================
-- Verification block
-- ============================================================================

DO $verify$
DECLARE
  v_idx_count   integer;
  v_expected    integer := 11;
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
       'idx_synthetic_monitor_results_host_checked',
       'idx_grounding_circuit_state_name',
       'idx_parent_cheers_notification_id',
       'idx_teacher_remediation_teacher_id',
       'idx_teacher_remediation_student_id',
       'idx_teacher_remediation_status_assigned'
     );

  -- idx_at_risk_alerts_school_status also expected but depends on phase3b.
  RAISE NOTICE '[20260614200001] Core repair indexes present: %/%', v_idx_count, v_expected;

  IF v_idx_count < v_expected THEN
    RAISE WARNING '[20260614200001] Some indexes missing. Current count: %', v_idx_count;
  ELSE
    RAISE NOTICE '[20260614200001] REPAIR COMPLETE -- api_query_path_indexes_batch2 indexes applied';
  END IF;
END $verify$;
