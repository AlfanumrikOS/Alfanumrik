-- Reconstructed from production ledger (supabase_migrations.schema_migrations).
-- Originally applied out-of-band 2026-08-29; committed to restore parity.
-- Content verified byte-identical to stored statements. Do not re-run
-- against production — already applied at version 20260829163955.
--
-- NON-IDEMPOTENT (committed verbatim, matching what actually executed):
-- CREATE MATERIALIZED VIEW and CREATE UNIQUE INDEX below have no
-- IF NOT EXISTS guard. Safe to replay once against a fresh database;
-- would error (already exists) if ever re-run against a database that
-- already holds these objects, including current production. The
-- migration-history parity check that reconciles this file only compares
-- version numbers and never executes this file, so this is not a live
-- risk today — flagged per house convention for non-idempotent SQL.

CREATE MATERIALIZED VIEW analytics.student_daily_summary AS
SELECT
  t.student_id,
  (t.occurred_at AT TIME ZONE 'Asia/Kolkata')::date AS activity_date_ist,
  s.grade,
  s.school_id,

  COUNT(*) FILTER (WHERE t.activity_type = 'session_login')          AS login_count,

  COUNT(*) FILTER (WHERE t.activity_category = 'assessment')         AS assessment_events,
  COUNT(*) FILTER (WHERE t.activity_type IN ('quiz_completed', 'mock_test_completed'))
                                                                     AS quizzes_completed,
  COUNT(*) FILTER (WHERE t.activity_type = 'question_answered')      AS questions_answered,
  COUNT(*) FILTER (WHERE t.activity_type = 'question_answered'
    AND (t.detail->>'is_correct')::boolean = true)                   AS questions_correct,

  COUNT(*) FILTER (WHERE t.activity_type = 'foxy_session_started')   AS foxy_sessions,
  COUNT(*) FILTER (WHERE t.activity_type = 'foxy_message_sent')      AS foxy_messages_sent,

  COUNT(*) FILTER (WHERE t.activity_category = 'learning')           AS learning_events,
  COUNT(*) FILTER (WHERE t.activity_type = 'chapter_completed')      AS chapters_completed,
  COUNT(*) FILTER (WHERE t.activity_type = 'concept_check_answered') AS concept_checks,
  COUNT(*) FILTER (WHERE t.activity_type = 'ncert_exercise_attempted') AS ncert_attempts,

  COALESCE(SUM((t.detail->>'amount')::int)
    FILTER (WHERE t.activity_type = 'xp_earned'), 0)                 AS xp_earned,
  COUNT(*) FILTER (WHERE t.activity_type = 'challenge_attempted')    AS challenges_attempted,
  COUNT(*) FILTER (WHERE t.activity_type = 'achievement_earned')     AS achievements_earned,

  COUNT(*) FILTER (WHERE t.activity_category = 'content_interaction') AS content_interactions,

  ARRAY_AGG(DISTINCT t.subject)
    FILTER (WHERE t.subject IS NOT NULL)                             AS subjects_studied,

  COUNT(*)                                                           AS total_events

FROM analytics.student_activity_timeline t
JOIN public.students s ON s.id = t.student_id
WHERE s.is_demo IS NOT TRUE
GROUP BY t.student_id, (t.occurred_at AT TIME ZONE 'Asia/Kolkata')::date, s.grade, s.school_id
WITH NO DATA;

CREATE UNIQUE INDEX idx_sds_student_date
  ON analytics.student_daily_summary (student_id, activity_date_ist);
CREATE INDEX idx_sds_school_date
  ON analytics.student_daily_summary (school_id, activity_date_ist DESC)
  WHERE school_id IS NOT NULL;
CREATE INDEX idx_sds_date_desc
  ON analytics.student_daily_summary (activity_date_ist DESC);

REVOKE ALL ON analytics.student_daily_summary FROM authenticated, anon;


CREATE MATERIALIZED VIEW analytics.class_activity_summary AS
SELECT
  ce.class_id,
  sds.activity_date_ist,
  COUNT(DISTINCT sds.student_id)                           AS active_students,
  SUM(sds.total_events)                                    AS total_events,
  SUM(sds.quizzes_completed)                               AS quizzes_completed,
  SUM(sds.questions_answered)                               AS questions_answered,
  SUM(sds.questions_correct)                                AS questions_correct,
  CASE WHEN SUM(sds.questions_answered) > 0
    THEN ROUND(SUM(sds.questions_correct)::numeric
               / SUM(sds.questions_answered) * 100, 1)
    ELSE NULL END                                          AS accuracy_pct,
  SUM(sds.foxy_sessions)                                   AS foxy_sessions,
  SUM(sds.foxy_messages_sent)                              AS foxy_messages,
  SUM(sds.xp_earned)                                       AS xp_earned,
  SUM(sds.chapters_completed)                              AS chapters_completed,
  SUM(sds.concept_checks)                                  AS concept_checks
FROM analytics.student_daily_summary sds
JOIN public.class_enrollments ce
  ON ce.student_id = sds.student_id AND ce.is_active = true
GROUP BY ce.class_id, sds.activity_date_ist
WITH NO DATA;

CREATE UNIQUE INDEX idx_cas_class_date
  ON analytics.class_activity_summary (class_id, activity_date_ist);
CREATE INDEX idx_cas_date_desc
  ON analytics.class_activity_summary (activity_date_ist DESC);

REVOKE ALL ON analytics.class_activity_summary FROM authenticated, anon;


CREATE MATERIALIZED VIEW analytics.school_activity_summary AS
SELECT
  sds.school_id,
  sds.activity_date_ist,
  COUNT(DISTINCT sds.student_id)                           AS active_students,
  SUM(sds.total_events)                                    AS total_events,
  SUM(sds.quizzes_completed)                               AS quizzes_completed,
  SUM(sds.questions_answered)                               AS questions_answered,
  SUM(sds.questions_correct)                                AS questions_correct,
  CASE WHEN SUM(sds.questions_answered) > 0
    THEN ROUND(SUM(sds.questions_correct)::numeric
               / SUM(sds.questions_answered) * 100, 1)
    ELSE NULL END                                          AS accuracy_pct,
  SUM(sds.foxy_sessions)                                   AS foxy_sessions,
  SUM(sds.xp_earned)                                       AS xp_earned,
  SUM(sds.chapters_completed)                              AS chapters_completed
FROM analytics.student_daily_summary sds
WHERE sds.school_id IS NOT NULL
GROUP BY sds.school_id, sds.activity_date_ist
WITH NO DATA;

CREATE UNIQUE INDEX idx_sas_school_date
  ON analytics.school_activity_summary (school_id, activity_date_ist);

REVOKE ALL ON analytics.school_activity_summary FROM authenticated, anon;

REFRESH MATERIALIZED VIEW analytics.student_daily_summary;
REFRESH MATERIALIZED VIEW analytics.class_activity_summary;
REFRESH MATERIALIZED VIEW analytics.school_activity_summary;