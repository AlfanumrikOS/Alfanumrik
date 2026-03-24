-- ============================================================
-- Launch Readiness: Add missing indexes on foreign keys
-- Applied: 2026-03-24
-- ============================================================

-- CRITICAL: teachers.auth_user_id (hit on every teacher login/dashboard)
CREATE INDEX IF NOT EXISTS idx_teachers_auth_user_id ON teachers(auth_user_id);

-- cognitive_session_metrics.quiz_session_id (JOINs/deletes on quiz sessions)
CREATE INDEX IF NOT EXISTS idx_csm_quiz_session_id ON cognitive_session_metrics(quiz_session_id);

-- guardian_student_links audit columns
CREATE INDEX IF NOT EXISTS idx_gsl_revoked_by ON guardian_student_links(revoked_by);
CREATE INDEX IF NOT EXISTS idx_gsl_initiated_by ON guardian_student_links(initiated_by);

-- question_bank.cbse_paper_id (joins to board papers)
CREATE INDEX IF NOT EXISTS idx_qb_cbse_paper_id ON question_bank(cbse_paper_id);

-- cbse_question_config (258 seq scans, 0 index scans)
CREATE INDEX IF NOT EXISTS idx_cbse_qconfig_grade_subject ON cbse_question_config(grade, subject_code);
