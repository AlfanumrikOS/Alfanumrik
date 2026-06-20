-- Migration: add get_next_unstarted_chapter SQL helper
-- Resolves the learner-loop "stuck chapter" regression: the resolver had no way
-- to surface chapters where mastery = NULL (never started). This function
-- returns the lowest-numbered unstarted chapter (across all subjects) for the
-- student's grade, ordered by chapter_number ASC, LIMIT 1.
--
-- SECURITY INVOKER: the caller's RLS context applies — a student only sees
-- chapters for their own grade because `students.auth_user_id = p_auth_user_id`
-- is part of the join condition.

CREATE OR REPLACE FUNCTION public.get_next_unstarted_chapter(p_auth_user_id uuid)
RETURNS TABLE(subject_code text, chapter_number integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT c.subject_code, MIN(c.chapter_number) AS chapter_number
  FROM chapters c
  JOIN students s ON s.auth_user_id = p_auth_user_id
  WHERE c.grade = s.grade
    AND c.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM learner_mastery lm
      WHERE lm.auth_user_id = p_auth_user_id
        AND lm.subject_code = c.subject_code
        AND lm.chapter_number = c.chapter_number
    )
  GROUP BY c.subject_code
  ORDER BY MIN(c.chapter_number)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_next_unstarted_chapter(uuid) TO authenticated, service_role;
