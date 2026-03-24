-- ============================================================================
-- Exam-Centric Personalization Engine
-- Tables: exam_configs, exam_chapters, image_uploads, monthly_reports,
--         smart_nudges, exam_simulations, learner_clusters, student_cluster_assignments
-- Functions: generate_exam_study_plan, generate_monthly_report, generate_smart_nudges
-- ============================================================================

-- ===========================================
-- 1. exam_configs
-- ===========================================
CREATE TABLE IF NOT EXISTS exam_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_type TEXT NOT NULL CHECK (exam_type IN ('unit_test', 'half_yearly', 'annual')),
  exam_name TEXT NOT NULL,
  exam_date DATE NOT NULL,
  subject TEXT NOT NULL,
  grade TEXT NOT NULL,
  total_marks INTEGER DEFAULT 80,
  duration_minutes INTEGER DEFAULT 180,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE exam_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "students_own_exam_configs" ON exam_configs FOR ALL
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = exam_configs.student_id));

CREATE POLICY "guardians_view_exam_configs" ON exam_configs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM guardian_student_links gsl
    WHERE gsl.student_id = exam_configs.student_id
    AND gsl.guardian_id IN (SELECT id FROM guardians WHERE auth_user_id = auth.uid())
    AND gsl.status = 'approved'
  ));

CREATE INDEX IF NOT EXISTS idx_exam_configs_student_id ON exam_configs(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_configs_exam_date ON exam_configs(exam_date);
CREATE INDEX IF NOT EXISTS idx_exam_configs_is_active ON exam_configs(is_active);
CREATE INDEX IF NOT EXISTS idx_exam_configs_subject_grade ON exam_configs(subject, grade);

-- ===========================================
-- 2. exam_chapters
-- ===========================================
CREATE TABLE IF NOT EXISTS exam_chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_config_id UUID NOT NULL REFERENCES exam_configs(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL,
  chapter_title TEXT NOT NULL,
  marks_weightage INTEGER DEFAULT 0,
  difficulty_weight NUMERIC(3,2) DEFAULT 1.0,
  is_covered BOOLEAN DEFAULT false,
  student_mastery NUMERIC(3,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(exam_config_id, chapter_number)
);

ALTER TABLE exam_chapters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "students_own_exam_chapters" ON exam_chapters FOR ALL
  USING (auth.uid() IN (
    SELECT s.auth_user_id FROM students s
    JOIN exam_configs ec ON ec.student_id = s.id
    WHERE ec.id = exam_chapters.exam_config_id
  ));

CREATE INDEX IF NOT EXISTS idx_exam_chapters_exam_config_id ON exam_chapters(exam_config_id);
CREATE INDEX IF NOT EXISTS idx_exam_chapters_is_covered ON exam_chapters(is_covered);

-- ===========================================
-- 3. image_uploads
-- ===========================================
CREATE TABLE IF NOT EXISTS image_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  image_type TEXT NOT NULL CHECK (image_type IN ('assignment', 'question_paper', 'notes', 'textbook', 'other')),
  ocr_text TEXT,
  detected_subject TEXT,
  detected_chapter INTEGER,
  detected_questions JSONB DEFAULT '[]',
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  mapped_topics JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE image_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "students_own_image_uploads" ON image_uploads FOR ALL
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = image_uploads.student_id));

CREATE INDEX IF NOT EXISTS idx_image_uploads_student_id ON image_uploads(student_id);
CREATE INDEX IF NOT EXISTS idx_image_uploads_processing_status ON image_uploads(processing_status);
CREATE INDEX IF NOT EXISTS idx_image_uploads_image_type ON image_uploads(image_type);

-- ===========================================
-- 4. monthly_reports
-- ===========================================
CREATE TABLE IF NOT EXISTS monthly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  report_month DATE NOT NULL, -- first day of month
  concept_mastery_pct NUMERIC(5,2),
  retention_score NUMERIC(5,2),
  weak_chapters JSONB DEFAULT '[]',
  strong_chapters JSONB DEFAULT '[]',
  test_scores JSONB DEFAULT '[]',
  accuracy_trend JSONB DEFAULT '[]',
  time_efficiency NUMERIC(5,2),
  predicted_score JSONB DEFAULT '{}',
  syllabus_completion_pct NUMERIC(5,2),
  study_consistency_pct NUMERIC(5,2),
  total_study_minutes INTEGER DEFAULT 0,
  total_questions_attempted INTEGER DEFAULT 0,
  report_data JSONB DEFAULT '{}',
  generated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, report_month)
);

ALTER TABLE monthly_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "students_own_monthly_reports" ON monthly_reports FOR ALL
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = monthly_reports.student_id));

CREATE POLICY "guardians_view_monthly_reports" ON monthly_reports FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM guardian_student_links gsl
    WHERE gsl.student_id = monthly_reports.student_id
    AND gsl.guardian_id IN (SELECT id FROM guardians WHERE auth_user_id = auth.uid())
    AND gsl.status = 'approved'
  ));

CREATE INDEX IF NOT EXISTS idx_monthly_reports_student_id ON monthly_reports(student_id);
CREATE INDEX IF NOT EXISTS idx_monthly_reports_report_month ON monthly_reports(report_month);

-- ===========================================
-- 5. smart_nudges
-- ===========================================
CREATE TABLE IF NOT EXISTS smart_nudges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  nudge_type TEXT NOT NULL CHECK (nudge_type IN ('schedule_behind', 'revision_due', 'streak_risk', 'exam_approaching', 'weak_topic', 'milestone', 'encouragement')),
  message TEXT NOT NULL,
  message_hi TEXT,
  priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  is_read BOOLEAN DEFAULT false,
  is_dismissed BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE smart_nudges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "students_own_smart_nudges" ON smart_nudges FOR ALL
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = smart_nudges.student_id));

CREATE INDEX IF NOT EXISTS idx_smart_nudges_student_id ON smart_nudges(student_id);
CREATE INDEX IF NOT EXISTS idx_smart_nudges_nudge_type ON smart_nudges(nudge_type);
CREATE INDEX IF NOT EXISTS idx_smart_nudges_is_read ON smart_nudges(student_id, is_read);
CREATE INDEX IF NOT EXISTS idx_smart_nudges_expires_at ON smart_nudges(expires_at);

-- ===========================================
-- 6. exam_simulations
-- ===========================================
CREATE TABLE IF NOT EXISTS exam_simulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_config_id UUID REFERENCES exam_configs(id),
  subject TEXT NOT NULL,
  grade TEXT NOT NULL,
  exam_format TEXT NOT NULL DEFAULT 'cbse' CHECK (exam_format IN ('cbse', 'icse', 'custom')),
  total_marks INTEGER NOT NULL,
  obtained_marks INTEGER DEFAULT 0,
  percentage NUMERIC(5,2),
  section_scores JSONB DEFAULT '{}',
  time_taken_seconds INTEGER,
  time_limit_seconds INTEGER,
  question_responses JSONB DEFAULT '[]',
  predicted_board_score NUMERIC(5,2),
  is_completed BOOLEAN DEFAULT false,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE exam_simulations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "students_own_exam_simulations" ON exam_simulations FOR ALL
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = exam_simulations.student_id));

CREATE INDEX IF NOT EXISTS idx_exam_simulations_student_id ON exam_simulations(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_simulations_exam_config_id ON exam_simulations(exam_config_id);
CREATE INDEX IF NOT EXISTS idx_exam_simulations_is_completed ON exam_simulations(is_completed);
CREATE INDEX IF NOT EXISTS idx_exam_simulations_subject_grade ON exam_simulations(subject, grade);

-- ===========================================
-- 7. learner_clusters
-- ===========================================
CREATE TABLE IF NOT EXISTS learner_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_name TEXT NOT NULL,
  grade TEXT NOT NULL,
  subject TEXT NOT NULL,
  avg_mastery NUMERIC(3,2),
  avg_accuracy NUMERIC(3,2),
  common_weak_topics JSONB DEFAULT '[]',
  common_strong_topics JSONB DEFAULT '[]',
  student_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE learner_clusters ENABLE ROW LEVEL SECURITY;

-- Learner clusters are read-only for authenticated users (aggregate data)
CREATE POLICY "authenticated_read_learner_clusters" ON learner_clusters FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_learner_clusters_grade_subject ON learner_clusters(grade, subject);

-- ===========================================
-- 8. student_cluster_assignments
-- ===========================================
CREATE TABLE IF NOT EXISTS student_cluster_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  cluster_id UUID NOT NULL REFERENCES learner_clusters(id) ON DELETE CASCADE,
  similarity_score NUMERIC(3,2),
  assigned_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, cluster_id)
);

ALTER TABLE student_cluster_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "students_own_student_cluster_assignments" ON student_cluster_assignments FOR ALL
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = student_cluster_assignments.student_id));

CREATE INDEX IF NOT EXISTS idx_student_cluster_assignments_student_id ON student_cluster_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_student_cluster_assignments_cluster_id ON student_cluster_assignments(cluster_id);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- ===========================================
-- generate_exam_study_plan
-- ===========================================
CREATE OR REPLACE FUNCTION generate_exam_study_plan(
  p_student_id UUID,
  p_exam_config_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id UUID;
  v_exam_date DATE;
  v_days_until_exam INTEGER;
  v_subject TEXT;
  v_grade TEXT;
  v_total_marks INTEGER;
  v_chapter RECORD;
  v_total_weight NUMERIC := 0;
  v_daily_minutes INTEGER := 90; -- default daily study time
  v_day_offset INTEGER := 0;
  v_tasks_per_day INTEGER;
  v_priority_score NUMERIC;
BEGIN
  -- 1. Get exam config details
  SELECT exam_date, subject, grade, total_marks
  INTO v_exam_date, v_subject, v_grade, v_total_marks
  FROM exam_configs
  WHERE id = p_exam_config_id AND student_id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam config not found for this student';
  END IF;

  -- 2. Calculate days until exam
  v_days_until_exam := v_exam_date - CURRENT_DATE;
  IF v_days_until_exam <= 0 THEN
    RAISE EXCEPTION 'Exam date has already passed';
  END IF;

  -- 3. Create a study plan entry
  INSERT INTO study_plans (student_id, subject, grade, plan_type, start_date, end_date, status)
  VALUES (
    p_student_id,
    v_subject,
    v_grade,
    'exam_prep',
    CURRENT_DATE,
    v_exam_date,
    'active'
  )
  RETURNING id INTO v_plan_id;

  -- 4. Calculate weighted priority per chapter
  -- Priority = (marks_weightage / total_marks) * difficulty_weight * (1 - student_mastery)
  -- Higher priority = more marks weight, higher difficulty, lower mastery
  FOR v_chapter IN
    SELECT
      ec.id AS chapter_id,
      ec.chapter_number,
      ec.chapter_title,
      ec.marks_weightage,
      ec.difficulty_weight,
      COALESCE(ec.student_mastery, 0) AS mastery,
      CASE
        WHEN ec.marks_weightage > 0 THEN
          (ec.marks_weightage::NUMERIC / GREATEST(v_total_marks, 1)) *
          COALESCE(ec.difficulty_weight, 1.0) *
          (1.0 - COALESCE(ec.student_mastery, 0))
        ELSE
          COALESCE(ec.difficulty_weight, 1.0) * (1.0 - COALESCE(ec.student_mastery, 0))
      END AS priority
    FROM exam_chapters ec
    WHERE ec.exam_config_id = p_exam_config_id
    ORDER BY priority DESC
  LOOP
    v_total_weight := v_total_weight + v_chapter.priority;
  END LOOP;

  -- 5. Generate daily tasks weighted by exam priority
  IF v_total_weight > 0 THEN
    FOR v_chapter IN
      SELECT
        ec.chapter_number,
        ec.chapter_title,
        ec.marks_weightage,
        ec.difficulty_weight,
        COALESCE(ec.student_mastery, 0) AS mastery,
        CASE
          WHEN ec.marks_weightage > 0 THEN
            (ec.marks_weightage::NUMERIC / GREATEST(v_total_marks, 1)) *
            COALESCE(ec.difficulty_weight, 1.0) *
            (1.0 - COALESCE(ec.student_mastery, 0))
          ELSE
            COALESCE(ec.difficulty_weight, 1.0) * (1.0 - COALESCE(ec.student_mastery, 0))
        END AS priority
      FROM exam_chapters ec
      WHERE ec.exam_config_id = p_exam_config_id
      ORDER BY priority DESC
    LOOP
      v_priority_score := v_chapter.priority;

      -- Number of days allocated proportional to priority
      v_tasks_per_day := GREATEST(1, ROUND((v_priority_score / v_total_weight) * v_days_until_exam));

      -- Insert study plan tasks for this chapter
      INSERT INTO study_plan_tasks (
        plan_id,
        task_type,
        title,
        description,
        scheduled_date,
        duration_minutes,
        status,
        metadata
      )
      SELECT
        v_plan_id,
        CASE
          WHEN v_chapter.mastery < 0.3 THEN 'learn'
          WHEN v_chapter.mastery < 0.6 THEN 'practice'
          WHEN v_chapter.mastery < 0.8 THEN 'revise'
          ELSE 'test'
        END,
        'Ch ' || v_chapter.chapter_number || ': ' || v_chapter.chapter_title,
        CASE
          WHEN v_chapter.mastery < 0.3 THEN 'Learn concepts from Chapter ' || v_chapter.chapter_number
          WHEN v_chapter.mastery < 0.6 THEN 'Practice problems from Chapter ' || v_chapter.chapter_number
          WHEN v_chapter.mastery < 0.8 THEN 'Revise key topics from Chapter ' || v_chapter.chapter_number
          ELSE 'Take a test on Chapter ' || v_chapter.chapter_number
        END,
        CURRENT_DATE + (v_day_offset + gs.n),
        GREATEST(30, ROUND(v_daily_minutes * (v_priority_score / v_total_weight))),
        'pending',
        jsonb_build_object(
          'chapter_number', v_chapter.chapter_number,
          'marks_weightage', v_chapter.marks_weightage,
          'current_mastery', v_chapter.mastery,
          'priority_score', v_priority_score,
          'exam_config_id', p_exam_config_id
        )
      FROM generate_series(0, v_tasks_per_day - 1) AS gs(n)
      WHERE CURRENT_DATE + (v_day_offset + gs.n) <= v_exam_date;

      v_day_offset := v_day_offset + v_tasks_per_day;
    END LOOP;
  END IF;

  RETURN v_plan_id;
END;
$$;

-- ===========================================
-- generate_monthly_report
-- ===========================================
CREATE OR REPLACE FUNCTION generate_monthly_report(
  p_student_id UUID,
  p_month DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start DATE;
  v_month_end DATE;
  v_concept_mastery NUMERIC(5,2) := 0;
  v_retention_score NUMERIC(5,2) := 0;
  v_weak_chapters JSONB := '[]';
  v_strong_chapters JSONB := '[]';
  v_test_scores JSONB := '[]';
  v_accuracy_trend JSONB := '[]';
  v_time_efficiency NUMERIC(5,2) := 0;
  v_predicted_score JSONB := '{}';
  v_syllabus_completion NUMERIC(5,2) := 0;
  v_study_consistency NUMERIC(5,2) := 0;
  v_total_study_minutes INTEGER := 0;
  v_total_questions INTEGER := 0;
  v_report_id UUID;
  v_result JSONB;
BEGIN
  -- Normalize to first day of month
  v_month_start := date_trunc('month', p_month)::DATE;
  v_month_end := (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::DATE;

  -- 1. Calculate concept mastery from concept_mastery table
  SELECT COALESCE(AVG(mastery_level) * 100, 0)
  INTO v_concept_mastery
  FROM concept_mastery
  WHERE student_id = p_student_id
    AND updated_at >= v_month_start
    AND updated_at < v_month_end + 1;

  -- 2. Get retention score from retention_tests
  SELECT COALESCE(AVG(score) * 100, 0)
  INTO v_retention_score
  FROM retention_tests
  WHERE student_id = p_student_id
    AND created_at >= v_month_start
    AND created_at < v_month_end + 1;

  -- 3. Get test scores from quiz_sessions
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id', qs.id,
    'subject', qs.subject,
    'score', qs.score,
    'total', qs.total_questions,
    'date', qs.created_at
  )), '[]'::jsonb)
  INTO v_test_scores
  FROM quiz_sessions qs
  WHERE qs.student_id = p_student_id
    AND qs.created_at >= v_month_start
    AND qs.created_at < v_month_end + 1;

  -- 4. Get accuracy trend from question_responses (weekly buckets)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'week', week_start,
    'accuracy', accuracy_pct
  ) ORDER BY week_start), '[]'::jsonb)
  INTO v_accuracy_trend
  FROM (
    SELECT
      date_trunc('week', created_at)::DATE AS week_start,
      ROUND(AVG(CASE WHEN is_correct THEN 100.0 ELSE 0.0 END), 2) AS accuracy_pct
    FROM question_responses
    WHERE student_id = p_student_id
      AND created_at >= v_month_start
      AND created_at < v_month_end + 1
    GROUP BY date_trunc('week', created_at)
  ) weekly;

  -- 5. Total questions attempted
  SELECT COUNT(*)
  INTO v_total_questions
  FROM question_responses
  WHERE student_id = p_student_id
    AND created_at >= v_month_start
    AND created_at < v_month_end + 1;

  -- 6. Identify weak chapters (mastery < 0.4) and strong chapters (mastery >= 0.7)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'chapter', ec.chapter_title,
    'chapter_number', ec.chapter_number,
    'mastery', ec.student_mastery
  )), '[]'::jsonb)
  INTO v_weak_chapters
  FROM exam_chapters ec
  JOIN exam_configs cfg ON cfg.id = ec.exam_config_id
  WHERE cfg.student_id = p_student_id
    AND cfg.is_active = true
    AND COALESCE(ec.student_mastery, 0) < 0.4;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'chapter', ec.chapter_title,
    'chapter_number', ec.chapter_number,
    'mastery', ec.student_mastery
  )), '[]'::jsonb)
  INTO v_strong_chapters
  FROM exam_chapters ec
  JOIN exam_configs cfg ON cfg.id = ec.exam_config_id
  WHERE cfg.student_id = p_student_id
    AND cfg.is_active = true
    AND COALESCE(ec.student_mastery, 0) >= 0.7;

  -- 7. Calculate predicted score: mastery * weightage per chapter
  SELECT COALESCE(jsonb_build_object(
    'predicted_total', ROUND(SUM(COALESCE(ec.student_mastery, 0) * ec.marks_weightage), 1),
    'max_marks', SUM(ec.marks_weightage),
    'predicted_pct', CASE WHEN SUM(ec.marks_weightage) > 0
      THEN ROUND((SUM(COALESCE(ec.student_mastery, 0) * ec.marks_weightage) / SUM(ec.marks_weightage)) * 100, 1)
      ELSE 0
    END
  ), '{}'::jsonb)
  INTO v_predicted_score
  FROM exam_chapters ec
  JOIN exam_configs cfg ON cfg.id = ec.exam_config_id
  WHERE cfg.student_id = p_student_id
    AND cfg.is_active = true;

  -- 8. Study consistency: days with activity / days in month
  SELECT COALESCE(
    ROUND((COUNT(DISTINCT created_at::DATE)::NUMERIC / GREATEST(EXTRACT(DAY FROM v_month_end::TIMESTAMP - v_month_start::TIMESTAMP + interval '1 day'), 1)) * 100, 2),
    0
  )
  INTO v_study_consistency
  FROM question_responses
  WHERE student_id = p_student_id
    AND created_at >= v_month_start
    AND created_at < v_month_end + 1;

  -- 9. Syllabus completion
  SELECT COALESCE(
    ROUND((COUNT(*) FILTER (WHERE ec.is_covered = true)::NUMERIC / GREATEST(COUNT(*), 1)) * 100, 2),
    0
  )
  INTO v_syllabus_completion
  FROM exam_chapters ec
  JOIN exam_configs cfg ON cfg.id = ec.exam_config_id
  WHERE cfg.student_id = p_student_id
    AND cfg.is_active = true;

  -- 10. Insert into monthly_reports (upsert)
  INSERT INTO monthly_reports (
    student_id, report_month, concept_mastery_pct, retention_score,
    weak_chapters, strong_chapters, test_scores, accuracy_trend,
    time_efficiency, predicted_score, syllabus_completion_pct,
    study_consistency_pct, total_study_minutes, total_questions_attempted,
    report_data
  ) VALUES (
    p_student_id, v_month_start, v_concept_mastery, v_retention_score,
    v_weak_chapters, v_strong_chapters, v_test_scores, v_accuracy_trend,
    v_time_efficiency, v_predicted_score, v_syllabus_completion,
    v_study_consistency, v_total_study_minutes, v_total_questions,
    jsonb_build_object(
      'generated_at', now(),
      'month', v_month_start,
      'student_id', p_student_id
    )
  )
  ON CONFLICT (student_id, report_month) DO UPDATE SET
    concept_mastery_pct = EXCLUDED.concept_mastery_pct,
    retention_score = EXCLUDED.retention_score,
    weak_chapters = EXCLUDED.weak_chapters,
    strong_chapters = EXCLUDED.strong_chapters,
    test_scores = EXCLUDED.test_scores,
    accuracy_trend = EXCLUDED.accuracy_trend,
    time_efficiency = EXCLUDED.time_efficiency,
    predicted_score = EXCLUDED.predicted_score,
    syllabus_completion_pct = EXCLUDED.syllabus_completion_pct,
    study_consistency_pct = EXCLUDED.study_consistency_pct,
    total_study_minutes = EXCLUDED.total_study_minutes,
    total_questions_attempted = EXCLUDED.total_questions_attempted,
    report_data = EXCLUDED.report_data,
    generated_at = now()
  RETURNING id INTO v_report_id;

  -- Return the full report as JSONB
  SELECT jsonb_build_object(
    'report_id', v_report_id,
    'student_id', p_student_id,
    'month', v_month_start,
    'concept_mastery_pct', v_concept_mastery,
    'retention_score', v_retention_score,
    'weak_chapters', v_weak_chapters,
    'strong_chapters', v_strong_chapters,
    'test_scores', v_test_scores,
    'accuracy_trend', v_accuracy_trend,
    'predicted_score', v_predicted_score,
    'syllabus_completion_pct', v_syllabus_completion,
    'study_consistency_pct', v_study_consistency,
    'total_questions_attempted', v_total_questions
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ===========================================
-- generate_smart_nudges
-- ===========================================
CREATE OR REPLACE FUNCTION generate_smart_nudges(
  p_student_id UUID
)
RETURNS SETOF smart_nudges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nudge RECORD;
  v_exam RECORD;
  v_last_activity TIMESTAMPTZ;
  v_streak_days INTEGER;
  v_overdue_tasks INTEGER;
BEGIN
  -- Clear expired nudges first
  DELETE FROM smart_nudges
  WHERE student_id = p_student_id
    AND expires_at IS NOT NULL
    AND expires_at < now();

  -- 1. Check for upcoming exams (within 7 days) → 'exam_approaching'
  FOR v_exam IN
    SELECT id, exam_name, exam_date, subject,
           (exam_date - CURRENT_DATE) AS days_until
    FROM exam_configs
    WHERE student_id = p_student_id
      AND is_active = true
      AND exam_date >= CURRENT_DATE
      AND exam_date <= CURRENT_DATE + 7
  LOOP
    -- Only insert if no recent nudge of same type for same exam
    IF NOT EXISTS (
      SELECT 1 FROM smart_nudges
      WHERE student_id = p_student_id
        AND nudge_type = 'exam_approaching'
        AND metadata->>'exam_config_id' = v_exam.id::TEXT
        AND created_at > now() - interval '1 day'
    ) THEN
      RETURN QUERY
      INSERT INTO smart_nudges (student_id, nudge_type, message, message_hi, priority, expires_at, metadata)
      VALUES (
        p_student_id,
        'exam_approaching',
        format('Your %s exam is in %s days! Focus on weak chapters.', v_exam.exam_name, v_exam.days_until),
        format('आपकी %s परीक्षा %s दिन में है! कमज़ोर अध्यायों पर ध्यान दें।', v_exam.exam_name, v_exam.days_until),
        CASE WHEN v_exam.days_until <= 2 THEN 9 WHEN v_exam.days_until <= 4 THEN 7 ELSE 5 END,
        v_exam.exam_date::TIMESTAMPTZ,
        jsonb_build_object('exam_config_id', v_exam.id, 'exam_name', v_exam.exam_name, 'days_until', v_exam.days_until)
      )
      RETURNING *;
    END IF;
  END LOOP;

  -- 2. Check for schedule behind → 'schedule_behind'
  SELECT COUNT(*)
  INTO v_overdue_tasks
  FROM study_plan_tasks spt
  JOIN study_plans sp ON sp.id = spt.plan_id
  WHERE sp.student_id = p_student_id
    AND sp.status = 'active'
    AND spt.status = 'pending'
    AND spt.scheduled_date < CURRENT_DATE;

  IF v_overdue_tasks > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM smart_nudges
      WHERE student_id = p_student_id
        AND nudge_type = 'schedule_behind'
        AND created_at > now() - interval '1 day'
    ) THEN
      RETURN QUERY
      INSERT INTO smart_nudges (student_id, nudge_type, message, message_hi, priority, expires_at, metadata)
      VALUES (
        p_student_id,
        'schedule_behind',
        format('You have %s overdue tasks. Let''s catch up today!', v_overdue_tasks),
        format('आपके %s कार्य बाकी हैं। आज पूरा करें!', v_overdue_tasks),
        CASE WHEN v_overdue_tasks >= 5 THEN 8 WHEN v_overdue_tasks >= 3 THEN 6 ELSE 4 END,
        now() + interval '2 days',
        jsonb_build_object('overdue_count', v_overdue_tasks)
      )
      RETURNING *;
    END IF;
  END IF;

  -- 3. Check for revision due → 'revision_due'
  -- Topics with mastery that haven't been reviewed in 3+ days
  IF EXISTS (
    SELECT 1 FROM concept_mastery cm
    WHERE cm.student_id = p_student_id
      AND cm.mastery_level < 0.7
      AND cm.updated_at < now() - interval '3 days'
    LIMIT 1
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM smart_nudges
      WHERE student_id = p_student_id
        AND nudge_type = 'revision_due'
        AND created_at > now() - interval '1 day'
    ) THEN
      RETURN QUERY
      INSERT INTO smart_nudges (student_id, nudge_type, message, message_hi, priority, expires_at, metadata)
      VALUES (
        p_student_id,
        'revision_due',
        'Some topics need revision to avoid forgetting. Review them now!',
        'कुछ विषयों को भूलने से बचाने के लिए दोहराना ज़रूरी है। अभी दोहराएं!',
        6,
        now() + interval '2 days',
        jsonb_build_object('reason', 'mastery_decay')
      )
      RETURNING *;
    END IF;
  END IF;

  -- 4. Check for streak risk → 'streak_risk'
  -- If student hasn't been active in the last day
  SELECT MAX(created_at)
  INTO v_last_activity
  FROM question_responses
  WHERE student_id = p_student_id;

  IF v_last_activity IS NOT NULL AND v_last_activity < now() - interval '1 day' THEN
    -- Check current streak
    SELECT COALESCE(current_streak, 0)
    INTO v_streak_days
    FROM student_streaks
    WHERE student_id = p_student_id;

    IF v_streak_days > 0 THEN
      IF NOT EXISTS (
        SELECT 1 FROM smart_nudges
        WHERE student_id = p_student_id
          AND nudge_type = 'streak_risk'
          AND created_at > now() - interval '12 hours'
      ) THEN
        RETURN QUERY
        INSERT INTO smart_nudges (student_id, nudge_type, message, message_hi, priority, expires_at, metadata)
        VALUES (
          p_student_id,
          'streak_risk',
          format('Your %s-day streak is at risk! Complete one question to keep it going.', v_streak_days),
          format('आपकी %s दिन की स्ट्रीक खतरे में है! इसे बनाए रखने के लिए एक प्रश्न हल करें।', v_streak_days),
          8,
          now() + interval '12 hours',
          jsonb_build_object('current_streak', v_streak_days)
        )
        RETURNING *;
      END IF;
    END IF;
  END IF;

  RETURN;
END;
$$;

-- ===========================================
-- updated_at triggers for new tables
-- ===========================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_exam_configs_updated_at') THEN
    CREATE TRIGGER set_exam_configs_updated_at
      BEFORE UPDATE ON exam_configs
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_image_uploads_updated_at') THEN
    CREATE TRIGGER set_image_uploads_updated_at
      BEFORE UPDATE ON image_uploads
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_learner_clusters_updated_at') THEN
    CREATE TRIGGER set_learner_clusters_updated_at
      BEFORE UPDATE ON learner_clusters
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END;
$$;
