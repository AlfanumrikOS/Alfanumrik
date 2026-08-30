-- Reconstructed from production ledger (supabase_migrations.schema_migrations).
-- Originally applied out-of-band 2026-08-29; committed to restore parity.
-- Content verified byte-identical to stored statements. Do not re-run
-- against production — already applied at version 20260829163907.

CREATE SCHEMA IF NOT EXISTS analytics;
GRANT USAGE ON SCHEMA analytics TO authenticated, service_role;

CREATE OR REPLACE VIEW analytics.student_activity_timeline AS

-- 1. Quiz sessions
SELECT
  qs.student_id,
  qs.created_at                          AS occurred_at,
  CASE WHEN qs.is_completed THEN 'quiz_completed' ELSE 'quiz_started' END AS activity_type,
  'assessment'::text                     AS activity_category,
  qs.subject,
  qs.grade,
  jsonb_build_object(
    'score', qs.score, 'total', qs.total_questions,
    'score_percent', qs.score_percent, 'chapter_number', qs.chapter_number,
    'time_taken', qs.time_taken_seconds
  )                                      AS detail,
  'quiz_sessions'::text                  AS source_table,
  qs.id::text                            AS source_id,
  qs.school_id
FROM public.quiz_sessions qs
WHERE qs.deleted_at IS NULL

UNION ALL

-- 2. Quiz responses
SELECT
  qr.student_id,
  qr.created_at                          AS occurred_at,
  'question_answered'::text              AS activity_type,
  'assessment'::text                     AS activity_category,
  qr.subject,
  NULL::text                             AS grade,
  jsonb_build_object(
    'is_correct', qr.is_correct, 'difficulty', qr.difficulty,
    'bloom_level', qr.bloom_level, 'time_taken', qr.time_taken_seconds
  )                                      AS detail,
  'quiz_responses'::text                 AS source_table,
  qr.id::text                            AS source_id,
  NULL::uuid                             AS school_id
FROM public.quiz_responses qr

UNION ALL

-- 3. Foxy sessions
SELECT
  fs.student_id,
  fs.created_at                          AS occurred_at,
  'foxy_session_started'::text           AS activity_type,
  'ai_tutor'::text                       AS activity_category,
  fs.subject,
  fs.grade,
  jsonb_build_object(
    'mode', fs.mode, 'chapter', fs.chapter
  )                                      AS detail,
  'foxy_sessions'::text                  AS source_table,
  fs.id::text                            AS source_id,
  NULL::uuid                             AS school_id
FROM public.foxy_sessions fs

UNION ALL

-- 4. Foxy chat messages (student messages only)
SELECT
  fcm.student_id,
  fcm.created_at                         AS occurred_at,
  'foxy_message_sent'::text              AS activity_type,
  'ai_tutor'::text                       AS activity_category,
  NULL::text                             AS subject,
  NULL::text                             AS grade,
  jsonb_build_object('role', fcm.role)   AS detail,
  'foxy_chat_messages'::text             AS source_table,
  fcm.id::text                           AS source_id,
  fcm.school_id
FROM public.foxy_chat_messages fcm
WHERE fcm.role = 'user'

UNION ALL

-- 5. Concept attempts
SELECT
  ca.student_id,
  COALESCE(ca.answered_at, ca.served_at) AS occurred_at,
  'concept_check_answered'::text         AS activity_type,
  'mastery'::text                        AS activity_category,
  NULL::text                             AS subject,
  NULL::text                             AS grade,
  jsonb_build_object(
    'correct', ca.correct, 'status', ca.status,
    'posterior_mastery', ca.posterior_mastery_mean,
    'concept_id', ca.concept_id,
    'response_time_ms', ca.response_time_ms
  )                                      AS detail,
  'concept_attempts'::text               AS source_table,
  ca.attempt_id::text                    AS source_id,
  NULL::uuid                             AS school_id
FROM public.concept_attempts ca

UNION ALL

-- 6. XP transactions
SELECT
  xt.student_id,
  xt.created_at                          AS occurred_at,
  'xp_earned'::text                      AS activity_type,
  'gamification'::text                   AS activity_category,
  xt.subject,
  NULL::text                             AS grade,
  jsonb_build_object(
    'amount', xt.amount, 'source', xt.source,
    'daily_category', xt.daily_category
  )                                      AS detail,
  'xp_transactions'::text               AS source_table,
  xt.id::text                            AS source_id,
  NULL::uuid                             AS school_id
FROM public.xp_transactions xt

UNION ALL

-- 7. Chapter progress
SELECT
  cp.student_id,
  COALESCE(cp.last_activity_at, cp.updated_at, cp.created_at) AS occurred_at,
  CASE WHEN cp.is_completed THEN 'chapter_completed'
       ELSE 'chapter_progress_updated' END::text AS activity_type,
  'learning'::text                       AS activity_category,
  cp.subject,
  cp.grade,
  jsonb_build_object(
    'chapter_id', cp.chapter_id, 'chapter_number', cp.chapter_number,
    'pool_coverage_percent', cp.pool_coverage_percent,
    'accuracy_percent', cp.accuracy_percent,
    'is_completed', cp.is_completed,
    'concepts_mastered', cp.concepts_mastered,
    'total_concepts', cp.total_concepts
  )                                      AS detail,
  'chapter_progress'::text               AS source_table,
  cp.id::text                            AS source_id,
  NULL::uuid                             AS school_id
FROM public.chapter_progress cp

UNION ALL

-- 8. Challenge attempts
SELECT
  cha.student_id,
  cha.attempted_at                       AS occurred_at,
  'challenge_attempted'::text            AS activity_type,
  'gamification'::text                   AS activity_category,
  NULL::text                             AS subject,
  NULL::text                             AS grade,
  jsonb_build_object(
    'solved', cha.solved, 'time_spent', cha.time_spent_seconds,
    'challenge_id', cha.challenge_id,
    'hints_used', cha.hints_used, 'coins_earned', cha.coins_earned
  )                                      AS detail,
  'challenge_attempts'::text             AS source_table,
  cha.id::text                           AS source_id,
  NULL::uuid                             AS school_id
FROM public.challenge_attempts cha

UNION ALL

-- 9. NCERT attempts
SELECT
  sna.student_id,
  sna.created_at                         AS occurred_at,
  'ncert_exercise_attempted'::text       AS activity_type,
  'learning'::text                       AS activity_category,
  COALESCE(sna.subject_code, sna.subject) AS subject,
  sna.grade,
  jsonb_build_object(
    'is_correct', sna.is_correct, 'chapter_number', sna.chapter_number,
    'exercise_id', sna.exercise_id, 'question_type', sna.question_type,
    'marks_awarded', sna.marks_awarded, 'marks_possible', sna.marks_possible
  )                                      AS detail,
  'student_ncert_attempts'::text         AS source_table,
  sna.id::text                           AS source_id,
  NULL::uuid                             AS school_id
FROM public.student_ncert_attempts sna

UNION ALL

-- 10. Mock test attempts (student_id is auth.users.id, needs JOIN)
SELECT
  s.id                                   AS student_id,
  COALESCE(mta.submitted_at, mta.started_at) AS occurred_at,
  CASE WHEN mta.status = 'submitted' THEN 'mock_test_completed'
       ELSE 'mock_test_started' END::text AS activity_type,
  'assessment'::text                     AS activity_category,
  NULL::text                             AS subject,
  NULL::text                             AS grade,
  jsonb_build_object(
    'correct_count', mta.correct_count, 'total_questions', mta.total_questions,
    'score_percent', mta.score_percent, 'time_taken', mta.time_taken_seconds,
    'status', mta.status, 'raw_score', mta.raw_score, 'max_score', mta.max_score
  )                                      AS detail,
  'mock_test_attempts'::text             AS source_table,
  mta.id::text                           AS source_id,
  s.school_id
FROM public.mock_test_attempts mta
JOIN public.students s ON s.auth_user_id = mta.student_id

UNION ALL

-- 11. Assignment submissions
SELECT
  asub.student_id,
  COALESCE(asub.submitted_at, asub.created_at) AS occurred_at,
  'assignment_submitted'::text           AS activity_type,
  'assessment'::text                     AS activity_category,
  NULL::text                             AS subject,
  NULL::text                             AS grade,
  jsonb_build_object(
    'assignment_id', asub.assignment_id, 'score', asub.score,
    'status', asub.status, 'questions_correct', asub.questions_correct,
    'questions_total', asub.questions_total
  )                                      AS detail,
  'assignment_submissions'::text         AS source_table,
  asub.id::text                          AS source_id,
  NULL::uuid                             AS school_id
FROM public.assignment_submissions asub

UNION ALL

-- 12. Student bookmarks
SELECT
  sb.student_id,
  sb.created_at                          AS occurred_at,
  'content_bookmarked'::text             AS activity_type,
  'content_interaction'::text            AS activity_category,
  sb.subject,
  NULL::text                             AS grade,
  jsonb_build_object(
    'content_type', sb.content_type, 'topic_tag', sb.topic_tag,
    'chapter_number', sb.chapter_number
  )                                      AS detail,
  'student_bookmarks'::text              AS source_table,
  sb.id::text                            AS source_id,
  NULL::uuid                             AS school_id
FROM public.student_bookmarks sb

UNION ALL

-- 13. Student notes
SELECT
  sn.student_id,
  sn.created_at                          AS occurred_at,
  'note_created'::text                   AS activity_type,
  'content_interaction'::text            AS activity_category,
  sn.subject,
  sn.grade,
  jsonb_build_object(
    'note_type', sn.note_type, 'chapter_number', sn.chapter_number,
    'word_count', sn.word_count, 'source', sn.source
  )                                      AS detail,
  'student_notes'::text                  AS source_table,
  sn.id::text                            AS source_id,
  NULL::uuid                             AS school_id
FROM public.student_notes sn

UNION ALL

-- 14. Auth events (login/logout)
SELECT
  s.id                                   AS student_id,
  aal.created_at                         AS occurred_at,
  CASE
    WHEN aal.event_type ILIKE '%login%' THEN 'session_login'
    WHEN aal.event_type ILIKE '%logout%' THEN 'session_logout'
    ELSE 'auth_event'
  END::text                              AS activity_type,
  'session'::text                        AS activity_category,
  NULL::text                             AS subject,
  NULL::text                             AS grade,
  jsonb_build_object('ip', aal.ip_address, 'event', aal.event_type) AS detail,
  'auth_audit_log'::text                 AS source_table,
  aal.id::text                           AS source_id,
  s.school_id
FROM public.auth_audit_log aal
JOIN public.students s ON s.auth_user_id = aal.auth_user_id

UNION ALL

-- 15. Learning events (student_id is auth.users.id, needs JOIN)
SELECT
  s.id                                   AS student_id,
  le.occurred_at,
  le.verb                                AS activity_type,
  'learning'::text                       AS activity_category,
  NULL::text                             AS subject,
  NULL::text                             AS grade,
  jsonb_build_object(
    'object_type', le.object_type, 'result', le.result,
    'topic_id', le.topic_id, 'event_type', le.event_type
  )                                      AS detail,
  'learning_events'::text                AS source_table,
  le.id::text                            AS source_id,
  s.school_id
FROM public.learning_events le
JOIN public.students s ON s.auth_user_id = le.student_id

UNION ALL

-- 16. Student achievements
SELECT
  sa.student_id,
  sa.unlocked_at                         AS occurred_at,
  'achievement_earned'::text             AS activity_type,
  'gamification'::text                   AS activity_category,
  NULL::text                             AS subject,
  NULL::text                             AS grade,
  jsonb_build_object('achievement_id', sa.achievement_id) AS detail,
  'student_achievements'::text           AS source_table,
  sa.id::text                            AS source_id,
  NULL::uuid                             AS school_id
FROM public.student_achievements sa

UNION ALL

-- 17. AI interaction logs
SELECT
  ail.student_id,
  ail.created_at                         AS occurred_at,
  'ai_interaction'::text                 AS activity_type,
  'ai_tutor'::text                       AS activity_category,
  NULL::text                             AS subject,
  NULL::text                             AS grade,
  jsonb_build_object(
    'model', ail.model, 'interaction_type', ail.interaction_type,
    'tokens_input', ail.tokens_input, 'tokens_output', ail.tokens_output,
    'was_helpful', ail.was_helpful
  )                                      AS detail,
  'ai_interaction_logs'::text            AS source_table,
  ail.id::text                           AS source_id,
  NULL::uuid                             AS school_id
FROM public.ai_interaction_logs ail

UNION ALL

-- 18. Product events (client-side telemetry)
SELECT
  pe.student_id,
  pe.created_at                          AS occurred_at,
  pe.event_type                          AS activity_type,
  COALESCE(pe.category, 'telemetry')     AS activity_category,
  NULL::text                             AS subject,
  NULL::text                             AS grade,
  pe.payload                             AS detail,
  'product_events'::text                 AS source_table,
  pe.id::text                            AS source_id,
  NULL::uuid                             AS school_id
FROM public.product_events pe
WHERE pe.student_id IS NOT NULL

UNION ALL

-- 19. Engagement events (client-side telemetry)
SELECT
  ee.student_id,
  ee.created_at                          AS occurred_at,
  ee.event_type                          AS activity_type,
  'engagement'::text                     AS activity_category,
  ee.subject,
  ee.grade,
  ee.event_data                          AS detail,
  'engagement_events'::text              AS source_table,
  ee.id::text                            AS source_id,
  NULL::uuid                             AS school_id
FROM public.engagement_events ee
WHERE ee.student_id IS NOT NULL;

COMMENT ON VIEW analytics.student_activity_timeline IS
  'Unified student activity stream. 19-source UNION ALL normalizing all '
  'domain tables into (student_id, occurred_at, activity_type, activity_category, '
  'subject, grade, detail, source_table, source_id, school_id). '
  'Consumed by materialized views and reporting RPCs — not queried directly by clients.';
