-- 20260527000008_perf_index_audit_phase_d6.sql
--
-- Phase D.6 of the multi-school prod-readiness plan: targeted FK / hot-path
-- index audit driven by reading the in-repo `pg_indexes` baseline (i.e. the
-- consolidated 20251212000001_baseline_from_prod.sql plus every later
-- migration in supabase/migrations/) and reconciling it against the actual
-- WHERE / ORDER BY clauses found in src/app/api/* and supabase/functions/*.
--
-- The audit found that the in-repo schema already has thorough coverage on
-- the obvious hot-path FK columns (quiz_sessions.student_id,
-- assignment_submissions.assignment_id / student_id, notifications by
-- recipient, teacher_parent_threads / teacher_parent_messages by recency,
-- domain_events / state_events by aggregate / kind, etc.). The candidates
-- the brief asked us to verify are already covered:
--
--   quiz_sessions.student_id          -> idx_qs_created / idx_qs_student_*
--   quiz_sessions.completed_at        -> idx_quiz_sessions_student_subject_date
--   assignment_submissions.assignment_id -> idx_submissions_assignment
--   assignment_submissions.student_id    -> idx_submissions_student
--   teacher_parent_messages.thread_id, created_at
--                                     -> idx_tp_messages_thread_created
--   teacher_parent_threads.last_message_at
--                                     -> idx_tp_threads_teacher_recent / _guardian_recent
--   notifications.recipient_id / read_at
--                                     -> idx_notif_*, idx_notifications_unread
--
-- The genuine gaps the audit surfaced (and that this migration closes):
--
--  1. public.school_admins
--     The legacy 20260416240000_school_admins_table.sql created indexes on
--     school_id and auth_user_id, but those did NOT survive consolidation
--     into the baseline. Today the only secondary index is the UNIQUE
--     constraint (auth_user_id, school_id), which only satisfies leftmost-
--     column queries on auth_user_id. The hot read patterns are:
--
--       (a) WHERE auth_user_id = $1 AND is_active = true
--           — fires from authorizeSchoolAdmin (src/lib/school-admin-auth.ts)
--             on EVERY school-admin API request.
--       (b) WHERE school_id = $1 AND is_active = true
--           — fires from RLS subqueries that filter classes / audit_logs /
--             school_announcements / class_students by the admin's school
--             (e.g. supabase/migrations/20260527000001_add_school_id_audit_logs.sql
--              "school_admins_see_school_audit_logs" policy).
--
--     Pattern (b) cannot use the UNIQUE constraint efficiently. Add both
--     partial indexes; both are tiny (only active rows).
--
--  2. public.subscriber_dead_letters
--     Composite PK is (event_id, subscriber_name). Operator queries asking
--     "which dead letters does projector X still own?" have to scan the
--     PK, which is event_id-first. Add a covering partial index on
--     (subscriber_name) WHERE resolved_at IS NULL so the dead-letter
--     observability dashboards stay sub-millisecond as the table grows.
--
--  3. public.subscriber_retry_state
--     Same shape: PK (event_id, subscriber_name) but the retry observability
--     surface enumerates by subscriber. A simple secondary index on
--     subscriber_name keeps "show in-flight retries for projector X" cheap.
--
-- Migration is idempotent (CREATE INDEX IF NOT EXISTS).
--
-- ── Operator note on CONCURRENTLY ─────────────────────────────────────────
-- Index creation on a >5M-row table can hold an ACCESS EXCLUSIVE lock long
-- enough to be visible to users. We are NOT using CREATE INDEX CONCURRENTLY
-- here because Supabase's `db push` wraps each migration file in a
-- transaction, and CONCURRENTLY cannot run inside a transaction.
--
-- Empirically the affected tables in production today are tiny:
--   school_admins:           ~50-100 rows / school × <10 schools at pilot
--   subscriber_dead_letters: best-case empty; capped at retry-budget × subs
--   subscriber_retry_state:  short-lived; cleared on success
--
-- None of these are at >5M rows, so an in-migration CREATE INDEX is safe.
-- If a future audit finds a table at that scale that needs an index, run
-- the CREATE INDEX CONCURRENTLY ... statement manually via psql before the
-- migration ships, and add the IF NOT EXISTS guard here so the migration
-- itself is a no-op.

BEGIN;

-- ── school_admins ────────────────────────────────────────────────────────
-- Used by every RLS subquery that filters by school_id (audit_logs,
-- classes, school_announcements, …). The existing UNIQUE constraint
-- (auth_user_id, school_id) cannot serve a school_id-only scan.
CREATE INDEX IF NOT EXISTS idx_school_admins_school_id_active
  ON public.school_admins (school_id)
  WHERE is_active = true;

COMMENT ON INDEX public.idx_school_admins_school_id_active IS
  'Phase D.6: RLS subqueries filter school_admins by school_id when '
  'checking if the caller is an admin of a tenant. The leftmost-column '
  'unique constraint (auth_user_id, school_id) cannot satisfy that scan. '
  'Partial on is_active because deactivated admins do not authorize.';

-- Hot read on every school-admin API request: lookup by auth_user_id +
-- is_active = true. The UNIQUE constraint covers (auth_user_id, school_id)
-- and so already serves this, but a narrower partial keeps the index
-- working set warmer (only the small fraction of rows that are active).
CREATE INDEX IF NOT EXISTS idx_school_admins_auth_user_active
  ON public.school_admins (auth_user_id)
  WHERE is_active = true;

COMMENT ON INDEX public.idx_school_admins_auth_user_active IS
  'Phase D.6: hot path on every school-admin API call. '
  'src/lib/school-admin-auth.ts -> authorizeSchoolAdmin filters by '
  'auth_user_id AND is_active = true. Partial covers only the small '
  'subset of active rows so the index fits comfortably in cache.';

-- ── subscriber_dead_letters ──────────────────────────────────────────────
-- Observability surface queries by subscriber_name; PK is event_id-first.
CREATE INDEX IF NOT EXISTS idx_subscriber_dead_letters_subscriber_unresolved
  ON public.subscriber_dead_letters (subscriber_name, last_attempted_at DESC)
  WHERE resolved_at IS NULL;

COMMENT ON INDEX public.idx_subscriber_dead_letters_subscriber_unresolved IS
  'Phase D.6: docs/runbooks/dead-letter-inspection.md queries unresolved '
  'dead-letters by subscriber. Partial keeps the index tiny once items '
  'are resolved.';

-- ── subscriber_retry_state ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_subscriber_retry_state_subscriber
  ON public.subscriber_retry_state (subscriber_name, last_attempted_at DESC);

COMMENT ON INDEX public.idx_subscriber_retry_state_subscriber IS
  'Phase D.6: retry-state observability enumerates by subscriber. PK is '
  '(event_id, subscriber_name) so a subscriber-only scan would otherwise '
  'be a seq scan.';

COMMIT;
