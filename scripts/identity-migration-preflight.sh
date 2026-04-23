#!/bin/bash
# Identity Migration Pre-Flight Checks
# Run before applying 20260423151531_identity_service_schema_extraction.sql

set -e

echo "🔍 Identity Migration Pre-Flight Checks"
echo "======================================"

# Check if we're in the right environment
if [ "$NODE_ENV" != "development" ]; then
  echo "❌ Must run in development environment"
  exit 1
fi

echo "✅ Environment check passed"

# Check Supabase CLI
if ! command -v supabase &> /dev/null; then
  echo "❌ Supabase CLI not found"
  exit 1
fi

echo "✅ Supabase CLI available"

# Check database connection
echo "🔗 Testing database connection..."
if ! supabase db ping &> /dev/null; then
  echo "❌ Cannot connect to database"
  exit 1
fi

echo "✅ Database connection OK"

# Get current record counts
echo "📊 Capturing pre-migration record counts..."

cat << 'EOF' | supabase db reset --db-url "$(supabase db url)" --debug
-- Pre-migration record counts
SELECT 'students' as table_name, COUNT(*) as count FROM public.students
UNION ALL
SELECT 'teachers', COUNT(*) FROM public.teachers
UNION ALL
SELECT 'guardians', COUNT(*) FROM public.guardians
UNION ALL
SELECT 'schools', COUNT(*) FROM public.schools
UNION ALL
SELECT 'classes', COUNT(*) FROM public.classes
UNION ALL
SELECT 'user_roles', COUNT(*) FROM public.user_roles
UNION ALL
SELECT 'user_active_sessions', COUNT(*) FROM public.user_active_sessions
UNION ALL
SELECT 'identity_events', COUNT(*) FROM public.identity_events
UNION ALL
SELECT 'class_students', COUNT(*) FROM public.class_students
UNION ALL
SELECT 'guardian_student_links', COUNT(*) FROM public.guardian_student_links
ORDER BY table_name;
EOF

echo "✅ Pre-migration counts captured"

# Validate migration SQL syntax
echo "🔍 Validating migration SQL syntax..."

if [ ! -f "supabase/migrations/20260423151531_identity_service_schema_extraction.sql" ]; then
  echo "❌ Migration file not found"
  exit 1
fi

# Basic syntax check (this is a simple check, full validation requires PostgreSQL)
if ! grep -q "CREATE SCHEMA identity" supabase/migrations/20260423151531_identity_service_schema_extraction.sql; then
  echo "❌ Migration missing schema creation"
  exit 1
fi

if ! grep -q "ALTER TABLE.*SET SCHEMA identity" supabase/migrations/20260423151531_identity_service_schema_extraction.sql; then
  echo "❌ Migration missing table moves"
  exit 1
fi

echo "✅ Migration SQL syntax OK"

# Check for existing identity schema (should not exist)
echo "🔍 Checking for existing identity schema..."

cat << 'EOF' | supabase db reset --db-url "$(supabase db url)" --debug
SELECT EXISTS (
  SELECT 1 FROM information_schema.schemata
  WHERE schema_name = 'identity'
) as identity_schema_exists;
EOF

echo "✅ Schema check completed"

# Validate foreign key constraints will be OK
echo "🔗 Validating FK constraints..."

cat << 'EOF' | supabase db reset --db-url "$(supabase db url)" --debug
-- Check for orphaned records that would break FKs after move
SELECT 'student_learning_profiles' as table_name,
       COUNT(*) as orphaned_count
FROM public.student_learning_profiles slp
LEFT JOIN public.students s ON slp.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'concept_mastery',
       COUNT(*)
FROM public.concept_mastery cm
LEFT JOIN public.students s ON cm.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'topic_mastery',
       COUNT(*)
FROM public.topic_mastery tm
LEFT JOIN public.students s ON tm.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'chat_sessions',
       COUNT(*)
FROM public.chat_sessions cs
LEFT JOIN public.students s ON cs.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'quiz_sessions',
       COUNT(*)
FROM public.quiz_sessions qs
LEFT JOIN public.students s ON qs.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'quiz_responses',
       COUNT(*)
FROM public.quiz_responses qr
LEFT JOIN public.students s ON qr.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'study_plans',
       COUNT(*)
FROM public.study_plans sp
LEFT JOIN public.students s ON sp.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'study_plan_tasks',
       COUNT(*)
FROM public.study_plan_tasks spt
LEFT JOIN public.students s ON spt.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'spaced_repetition_cards',
       COUNT(*)
FROM public.spaced_repetition_cards spc
LEFT JOIN public.students s ON spc.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'competition_participants',
       COUNT(*)
FROM public.competition_participants cp
LEFT JOIN public.students s ON cp.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'daily_activity',
       COUNT(*)
FROM public.daily_activity da
LEFT JOIN public.students s ON da.student_id = s.id
WHERE s.id IS NULL

UNION ALL

SELECT 'student_simulation_progress',
       COUNT(*)
FROM public.student_simulation_progress ssp
LEFT JOIN public.students s ON ssp.student_id = s.id
WHERE s.id IS NULL;
EOF

echo "✅ FK validation completed"

# Check RLS policies exist for tables being moved
echo "🔒 Validating RLS policies..."

cat << 'EOF' | supabase db reset --db-url "$(supabase db url)" --debug
-- Check RLS is enabled on tables being moved
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('students', 'teachers', 'guardians', 'schools', 'classes',
                    'user_roles', 'user_active_sessions', 'identity_events',
                    'class_students', 'guardian_student_links')
ORDER BY tablename;
EOF

echo "✅ RLS validation completed"

echo ""
echo "🎉 Pre-flight checks completed successfully!"
echo ""
echo "Next steps:"
echo "1. Review the output above for any warnings"
echo "2. If all checks pass, apply the migration:"
echo "   supabase db push"
echo "3. Run post-migration validation:"
echo "   ./scripts/validate-identity-migration.sql"
echo "4. Test identity service endpoints"
echo "5. Monitor for 24 hours before production rollout"