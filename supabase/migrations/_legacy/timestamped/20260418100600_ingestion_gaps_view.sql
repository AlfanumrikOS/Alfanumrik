-- supabase/migrations/20260418100600_ingestion_gaps_view.sql

CREATE OR REPLACE VIEW ingestion_gaps AS
SELECT
  s.board, s.grade, s.subject_code, s.subject_display,
  s.chapter_number, s.chapter_title,
  s.rag_status, s.chunk_count, s.verified_question_count,
  s.last_verified_at,
  CASE
    WHEN s.rag_status = 'missing' THEN 'critical'
    WHEN s.rag_status = 'partial' AND s.chunk_count < 10 THEN 'high'
    WHEN s.rag_status = 'partial' THEN 'medium'
  END AS severity,
  (SELECT count(*) FROM students
    WHERE grade = s.grade AND account_status = 'active') AS potential_affected_students,
  (SELECT count(*) FROM content_requests cr
    WHERE cr.grade = s.grade
      AND cr.subject_code = s.subject_code
      AND cr.chapter_number = s.chapter_number) AS request_count
FROM cbse_syllabus s
WHERE s.is_in_scope = true AND s.rag_status != 'ready';

GRANT SELECT ON ingestion_gaps TO authenticated;

COMMENT ON VIEW ingestion_gaps IS
  'Live derivation from cbse_syllabus. Admin dashboard sorts by '
  '(severity DESC, request_count DESC, potential_affected_students DESC). §5.5.';