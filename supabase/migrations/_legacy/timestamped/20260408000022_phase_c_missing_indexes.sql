-- ─────────────────────────────────────────────────────────────────────────────
-- Phase C: Missing indexes for NCERT question engine + study plan API routes
--
-- WHY these indexes are needed:
--
-- 1. rag_content_chunks — chapter_number lookup (ncert-question-engine fetches
--    questions filtered by subject + grade + chapter_number; no composite index
--    existed for this triple, causing sequential scans on the largest table)
--
-- 2. rag_content_chunks — content_category = 'ncert_qa' filter (all NCERT
--    question fetches filter on this column; idx_rag_chunks_content_type existed
--    but was a single-column index; adding it to the composite below)
--
-- 3. student_ncert_attempts — student_id + created_at (used in answer history
--    lookups and already-answered deduplication; the FK index on student_id
--    existed but not the composite for time-range queries)
--
-- 4. study_plan_tasks — plan_id + status composite (Phase C route queries
--    completed task count: WHERE plan_id = ? AND status = 'completed')
--
-- 5. smart_nudges — student_id + is_dismissed (dashboard query that fetches
--    undismissed nudges; was scanning all nudges for student)
--
-- 6. exam_configs — student_id (ownership check in POST /api/exam/chapters
--    verifies exam config belongs to student; no index existed on student_id)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. rag_content_chunks: subject + grade + chapter_number + content_category
--    (covers the primary ncert-question-engine WHERE clause)
CREATE INDEX IF NOT EXISTS idx_rag_chunks_ncert_chapter
  ON rag_content_chunks (subject, grade, chapter_number, content_category)
  WHERE content_category IN ('ncert_qa', 'ncert_theory', 'ncert_exercise');

-- 2. rag_content_chunks: question_text GIN trigram for the ilike search in
--    evaluate_answer model-answer lookup (ilike '%text%' requires trigram)
CREATE INDEX IF NOT EXISTS idx_rag_chunks_question_trgm
  ON rag_content_chunks USING gin(question_text gin_trgm_ops)
  WHERE question_text IS NOT NULL;

-- 3. student_ncert_attempts: (student_id, created_at DESC) for history lookup
CREATE INDEX IF NOT EXISTS idx_ncert_attempts_student_created
  ON student_ncert_attempts (student_id, created_at DESC);

-- 4. study_plan_tasks: (plan_id, status) for Phase C progress computation
--    PATCH /api/student/study-plan does: WHERE plan_id = ? AND status = 'completed'
CREATE INDEX IF NOT EXISTS idx_study_plan_tasks_plan_status
  ON study_plan_tasks (plan_id, status);

-- 5. smart_nudges: (student_id, is_dismissed, priority DESC) for dashboard
--    PATCH /api/student/preferences dismiss_nudge ownership check
CREATE INDEX IF NOT EXISTS idx_smart_nudges_student_active
  ON smart_nudges (student_id, is_dismissed, priority DESC NULLS LAST)
  WHERE is_dismissed = false;

-- 6. exam_configs: student_id for ownership verification in exam chapter API
CREATE INDEX IF NOT EXISTS idx_exam_configs_student_id
  ON exam_configs (student_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify: run this query to confirm all indexes exist
-- SELECT indexname FROM pg_indexes
--   WHERE tablename IN (
--     'rag_content_chunks','student_ncert_attempts',
--     'study_plan_tasks','smart_nudges','exam_configs'
--   )
--   AND indexname IN (
--     'idx_rag_chunks_ncert_chapter','idx_rag_chunks_question_trgm',
--     'idx_ncert_attempts_student_created','idx_study_plan_tasks_plan_status',
--     'idx_smart_nudges_student_active','idx_exam_configs_student_id'
--   )
--   ORDER BY tablename, indexname;
-- Expected: 6 rows
-- ─────────────────────────────────────────────────────────────────────────────
