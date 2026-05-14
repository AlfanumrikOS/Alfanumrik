-- Add indexes for hot read patterns observed in src/lib/supabase.ts

-- student_learning_profiles lookups by student_id + subject
CREATE INDEX IF NOT EXISTS idx_student_learning_profiles_student_subject
  ON student_learning_profiles (student_id, subject);

-- question_responses for seen/unseen checks (student_id + question_id)
CREATE INDEX IF NOT EXISTS idx_question_responses_student_question
  ON question_responses (student_id, question_id);

-- question_bank: common filters by subject, grade, chapter_number when is_active = true
CREATE INDEX IF NOT EXISTS idx_question_bank_subject_grade_chapter_is_active
  ON question_bank (subject, grade, chapter_number)
  WHERE is_active = true;

-- curriculum_topics fast resolution by subject_id, grade, chapter_number
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_subject_grade_chapter
  ON curriculum_topics (subject_id, grade, chapter_number);

-- student_learning_profiles: quick existence/IRT lookup
CREATE INDEX IF NOT EXISTS idx_student_learning_profiles_irt_theta
  ON student_learning_profiles (student_id)
  WHERE irt_theta IS NOT NULL;
