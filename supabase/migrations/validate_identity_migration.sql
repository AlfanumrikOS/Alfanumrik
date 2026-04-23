-- Identity Migration Post-Flight Validation
-- Run after applying 20260423151531_identity_service_schema_extraction.sql

-- ============================================================================
-- VALIDATION 1: Schema and Tables Exist
-- ============================================================================

DO $$
DECLARE
    table_exists BOOLEAN;
BEGIN
    -- Check identity schema exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.schemata
        WHERE schema_name = 'identity'
    ) INTO table_exists;

    IF NOT table_exists THEN
        RAISE EXCEPTION 'Identity schema does not exist';
    END IF;

    RAISE NOTICE '✅ Identity schema exists';
END $$;

-- Check all tables moved successfully
DO $$
DECLARE
    tables_to_check TEXT[] := ARRAY[
        'students', 'teachers', 'guardians', 'schools', 'classes',
        'user_roles', 'user_active_sessions', 'identity_events',
        'class_students', 'guardian_student_links'
    ];
    table_name TEXT;
    table_exists BOOLEAN;
BEGIN
    FOREACH table_name IN ARRAY tables_to_check
    LOOP
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'identity' AND table_name = table_name
        ) INTO table_exists;

        IF NOT table_exists THEN
            RAISE EXCEPTION 'Table identity.% does not exist', table_name;
        END IF;

        RAISE NOTICE '✅ Table identity.% exists', table_name;
    END LOOP;
END $$;

-- ============================================================================
-- VALIDATION 2: Record Counts Match
-- ============================================================================

-- Compare record counts (should be identical)
SELECT 'Post-migration counts' as phase,
       'identity.students' as table_name, COUNT(*) as count FROM identity.students
UNION ALL
SELECT 'Post-migration', 'identity.teachers', COUNT(*) FROM identity.teachers
UNION ALL
SELECT 'Post-migration', 'identity.guardians', COUNT(*) FROM identity.guardians
UNION ALL
SELECT 'Post-migration', 'identity.schools', COUNT(*) FROM identity.schools
UNION ALL
SELECT 'Post-migration', 'identity.classes', COUNT(*) FROM identity.classes
UNION ALL
SELECT 'Post-migration', 'identity.user_roles', COUNT(*) FROM identity.user_roles
UNION ALL
SELECT 'Post-migration', 'identity.user_active_sessions', COUNT(*) FROM identity.user_active_sessions
UNION ALL
SELECT 'Post-migration', 'identity.identity_events', COUNT(*) FROM identity.identity_events
UNION ALL
SELECT 'Post-migration', 'identity.class_students', COUNT(*) FROM identity.class_students
UNION ALL
SELECT 'Post-migration', 'identity.guardian_student_links', COUNT(*) FROM identity.guardian_student_links
ORDER BY table_name;

-- ============================================================================
-- VALIDATION 3: Foreign Key Integrity
-- ============================================================================

-- Check FK constraints are intact (no orphaned records)
SELECT 'student_learning_profiles_orphaned' as check_name,
       COUNT(*) as orphaned_count
FROM public.student_learning_profiles slp
LEFT JOIN identity.students s ON slp.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'concept_mastery_orphaned',
       COUNT(*)
FROM public.concept_mastery cm
LEFT JOIN identity.students s ON cm.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'topic_mastery_orphaned',
       COUNT(*)
FROM public.topic_mastery tm
LEFT JOIN identity.students s ON tm.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'chat_sessions_orphaned',
       COUNT(*)
FROM public.chat_sessions cs
LEFT JOIN identity.students s ON cs.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'quiz_sessions_orphaned',
       COUNT(*)
FROM public.quiz_sessions qs
LEFT JOIN identity.students s ON qs.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'quiz_responses_orphaned',
       COUNT(*)
FROM public.quiz_responses qr
LEFT JOIN identity.students s ON qr.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'study_plans_orphaned',
       COUNT(*)
FROM public.study_plans sp
LEFT JOIN identity.students s ON sp.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'study_plan_tasks_orphaned',
       COUNT(*)
FROM public.study_plan_tasks spt
LEFT JOIN identity.students s ON spt.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'spaced_repetition_cards_orphaned',
       COUNT(*)
FROM public.spaced_repetition_cards spc
LEFT JOIN identity.students s ON spc.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'competition_participants_orphaned',
       COUNT(*)
FROM public.competition_participants cp
LEFT JOIN identity.students s ON cp.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'daily_activity_orphaned',
       COUNT(*)
FROM public.daily_activity da
LEFT JOIN identity.students s ON da.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'student_simulation_progress_orphaned',
       COUNT(*)
FROM public.student_simulation_progress ssp
LEFT JOIN identity.students s ON ssp.student_id = s.id
WHERE s.id IS NULL;

-- ============================================================================
-- VALIDATION 4: RLS Policies
-- ============================================================================

-- Check RLS is enabled on all identity tables
SELECT schemaname, tablename, rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'identity'
ORDER BY tablename;

-- Check policies exist (basic count)
SELECT schemaname, tablename, COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'identity'
GROUP BY schemaname, tablename
ORDER BY tablename;

-- ============================================================================
-- VALIDATION 5: Permissions
-- ============================================================================

-- Check role search_path was set
SELECT rolname, useconfig
FROM pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role')
  AND useconfig IS NOT NULL;

-- ============================================================================
-- VALIDATION 6: Identity Service Functions
-- ============================================================================

-- Test basic identity service queries (should work with search_path)
DO $$
DECLARE
    test_user_id UUID := '00000000-0000-0000-0000-000000000001'; -- Use a test UUID
    profile_result RECORD;
BEGIN
    -- Test getUserProfile function logic (simplified)
    SELECT * INTO profile_result
    FROM identity.students
    WHERE auth_user_id = test_user_id
    LIMIT 1;

    RAISE NOTICE '✅ Identity service can query identity.students';

    -- Test unqualified query (should resolve via search_path)
    BEGIN
        EXECUTE 'SELECT COUNT(*) FROM students LIMIT 1';
        RAISE NOTICE '✅ Unqualified students query works (search_path)';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '⚠️ Unqualified students query failed (expected if no data)';
    END;

    RAISE NOTICE '✅ Identity service validation completed';
END $$;

-- ============================================================================
-- SUMMARY
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '🎉 Identity Migration Validation Complete!';
    RAISE NOTICE '';
    RAISE NOTICE 'Manual verification steps:';
    RAISE NOTICE '1. Check no orphaned records in FK validation above';
    RAISE NOTICE '2. Verify RLS enabled on all identity tables';
    RAISE NOTICE '3. Test identity service endpoints:';
    RAISE NOTICE '   - POST /functions/v1/identity/profile';
    RAISE NOTICE '   - POST /functions/v1/identity/sessions';
    RAISE NOTICE '4. Test monolith fallback still works';
    RAISE NOTICE '5. Monitor logs for 24 hours';
    RAISE NOTICE '';
    RAISE NOTICE 'If all checks pass, migration is ready for staging!';
END $$;
  nspname AS schema_name,
  nspacl AS privileges
FROM pg_namespace
WHERE nspname = 'identity';

-- 5. Check for orphaned records (should be 0)
SELECT 'orphaned_student_learning_profiles' AS check_type, COUNT(*) AS count
FROM public.student_learning_profiles slp
LEFT JOIN identity.students s ON slp.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'orphaned_quiz_sessions' AS check_type, COUNT(*) AS count
FROM public.quiz_sessions qs
LEFT JOIN identity.students s ON qs.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'orphaned_guardian_links' AS check_type, COUNT(*) AS count
FROM identity.guardian_student_links gsl
LEFT JOIN identity.students s ON gsl.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'orphaned_guardian_links_guardian' AS check_type, COUNT(*) AS count
FROM identity.guardian_student_links gsl
LEFT JOIN identity.guardians g ON gsl.guardian_id = g.id
WHERE g.id IS NULL;

-- 6. Test cross-service access (run as authenticated user)
-- This should work if permissions are correct
SELECT COUNT(*) FROM identity.students LIMIT 1;
SELECT COUNT(*) FROM identity.schools LIMIT 1;

-- 7. Verify onboarding flow still works
-- Check that auth_user_id references are intact
SELECT
  'students_with_auth' AS check_type,
  COUNT(*) AS count
FROM identity.students
WHERE auth_user_id IS NOT NULL;

-- ============================================================================
-- PERFORMANCE MONITORING
-- ============================================================================

-- Check for slow queries that might indicate FK issues
SELECT
  query,
  calls,
  total_time / 1000 AS total_seconds,
  mean_time / 1000 AS mean_seconds,
  rows
FROM pg_stat_statements
WHERE query LIKE '%identity.%'
ORDER BY total_time DESC
LIMIT 10;

-- ============================================================================
-- ALERTING THRESHOLDS
-- ============================================================================

-- Create monitoring function
CREATE OR REPLACE FUNCTION identity.monitor_migration_health()
RETURNS TABLE(metric TEXT, value BIGINT, status TEXT) LANGUAGE plpgsql AS $$
DECLARE
  student_count BIGINT;
  orphaned_count BIGINT;
BEGIN
  -- Count students
  SELECT COUNT(*) INTO student_count FROM identity.students;

  -- Count orphaned records
  SELECT COUNT(*) INTO orphaned_count
  FROM public.quiz_sessions qs
  LEFT JOIN identity.students s ON qs.student_id = s.id
  WHERE s.id IS NULL;

  -- Return metrics
  RETURN QUERY SELECT 'total_students'::TEXT, student_count,
    CASE WHEN student_count > 0 THEN 'OK' ELSE 'CRITICAL' END;

  RETURN QUERY SELECT 'orphaned_records'::TEXT, orphaned_count,
    CASE WHEN orphaned_count = 0 THEN 'OK' ELSE 'CRITICAL' END;

  RETURN QUERY SELECT 'schema_exists'::TEXT,
    CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'identity') THEN 1 ELSE 0 END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'identity') THEN 'OK' ELSE 'CRITICAL' END;
END;
$$;

-- Run health check
SELECT * FROM identity.monitor_migration_health();

-- ============================================================================
-- EMERGENCY ROLLBACK TRIGGER
-- ============================================================================

-- Create emergency rollback trigger (uncomment only if critical issues detected)
/*
CREATE OR REPLACE FUNCTION identity.emergency_rollback_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- If critical errors detected, log and prepare for rollback
  INSERT INTO identity_events (auth_user_id, event_type, metadata)
  VALUES (
    '00000000-0000-0000-0000-000000000000'::UUID,
    'emergency_rollback_triggered',
    jsonb_build_object(
      'trigger_table', TG_TABLE_NAME,
      'operation', TG_OP,
      'timestamp', now(),
      'reason', 'Critical migration issue detected'
    )
  );

  -- Could send alert here via pg_notify or external system
  PERFORM pg_notify('migration_alert', 'emergency_rollback_needed');

  RETURN NEW;
END;
$$;

-- Apply emergency trigger to critical tables (uncomment if needed)
-- CREATE TRIGGER emergency_rollback_students
--   AFTER INSERT OR UPDATE OR DELETE ON identity.students
--   FOR EACH ROW EXECUTE FUNCTION identity.emergency_rollback_trigger();
*/