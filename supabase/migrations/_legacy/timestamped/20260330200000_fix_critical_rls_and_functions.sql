-- Migration: 20260330200000_fix_critical_rls_and_functions.sql
-- Purpose: Fix 3 critical issues found in database audit
-- Applied directly to production via MCP SQL tool

-- ============================================================
-- 1. Create missing get_my_student_id() function
-- Referenced by RLS policies on solver_results and subscription_events
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_student_id()
RETURNS UUID
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT id FROM students WHERE auth_user_id = auth.uid() AND is_active = true LIMIT 1
$$;

-- ============================================================
-- 2. Fix broken RLS on student_daily_usage
-- Old policies compared auth.uid() to student_id (wrong UUID spaces)
-- ============================================================
DROP POLICY IF EXISTS "Students read own usage" ON student_daily_usage;
DROP POLICY IF EXISTS student_usage_select ON student_daily_usage;
DROP POLICY IF EXISTS student_usage_insert ON student_daily_usage;
DROP POLICY IF EXISTS student_usage_update ON student_daily_usage;

CREATE POLICY student_usage_select ON student_daily_usage
  FOR SELECT USING (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

CREATE POLICY student_usage_insert ON student_daily_usage
  FOR INSERT WITH CHECK (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

CREATE POLICY student_usage_update ON student_daily_usage
  FOR UPDATE USING (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

-- ============================================================
-- 3. Add search_vector auto-population trigger to cbse_syllabus_graph
-- ============================================================
CREATE OR REPLACE FUNCTION update_syllabus_graph_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.concept, '') || ' ' ||
    coalesce(NEW.sub_concept, '') || ' ' ||
    coalesce(NEW.chapter_title, '') || ' ' ||
    coalesce(NEW.learning_objective, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_syllabus_graph_search ON cbse_syllabus_graph;
CREATE TRIGGER trg_syllabus_graph_search
  BEFORE INSERT OR UPDATE ON cbse_syllabus_graph
  FOR EACH ROW EXECUTE FUNCTION update_syllabus_graph_search_vector();

-- Backfill existing rows
UPDATE cbse_syllabus_graph SET search_vector = to_tsvector('english',
  coalesce(concept, '') || ' ' ||
  coalesce(sub_concept, '') || ' ' ||
  coalesce(chapter_title, '') || ' ' ||
  coalesce(learning_objective, '')
) WHERE search_vector IS NULL;
