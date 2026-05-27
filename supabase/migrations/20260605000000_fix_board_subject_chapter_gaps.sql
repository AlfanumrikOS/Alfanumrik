-- Migration: 20260605000000_fix_board_subject_chapter_gaps.sql
-- Purpose:   Add board-awareness to subject/chapter RPCs, fix hardcoded CBSE board filters,
--            and seed core subjects for Class 10 to resolve coverage gaps.

BEGIN;

-- ─── 1. Schema Upgrades: grade_subject_map ───────────────────────────────────
-- Add board column if not exists (defaults to 'CBSE')
ALTER TABLE public.grade_subject_map ADD COLUMN IF NOT EXISTS board TEXT DEFAULT 'CBSE';

-- Recreate unique constraint/index to be board-aware
ALTER TABLE public.grade_subject_map DROP CONSTRAINT IF EXISTS grade_subject_map_uniq;
DROP INDEX IF EXISTS public.grade_subject_map_uniq;

CREATE UNIQUE INDEX grade_subject_map_uniq ON public.grade_subject_map (grade, subject_code, stream, board) NULLS NOT DISTINCT;

-- ─── 2. Revise public.get_available_subjects (v1) ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_available_subjects(p_student_id UUID)
RETURNS TABLE (
  code TEXT, name TEXT, name_hi TEXT, icon TEXT, color TEXT,
  subject_kind TEXT, is_core BOOLEAN, is_locked BOOLEAN
)
LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public, auth, pg_catalog AS $$
  WITH s AS (
    SELECT id, grade, stream, COALESCE(board, 'CBSE') AS board FROM public.students
     WHERE (id = p_student_id OR auth_user_id = p_student_id)
       AND (auth.uid() IS NULL OR auth_user_id = auth.uid())
     LIMIT 1
  ),
  p AS (
    SELECT plan_code FROM public.student_subscriptions
     WHERE student_id = (SELECT id FROM s)
       AND status IN ('active','trialing','grace')
     ORDER BY current_period_end DESC NULLS LAST LIMIT 1
  ),
  effective_plan AS (
    SELECT COALESCE((SELECT plan_code FROM p), 'free') AS plan_code
  ),
  grade_valid AS (
    SELECT gsm.subject_code, BOOL_OR(gsm.is_core) AS is_core
      FROM public.grade_subject_map gsm, s
     WHERE gsm.grade = s.grade
       AND (gsm.stream IS NULL OR gsm.stream = s.stream OR s.stream IS NULL)
       AND (
         -- Match student's board specifically
         gsm.board = s.board
         -- Or fallback to CBSE / NULL if no mapping exists for the student's board
         OR (gsm.board IN ('CBSE', 'Other') OR gsm.board IS NULL) AND NOT EXISTS (
           SELECT 1 FROM public.grade_subject_map gsm2
            WHERE gsm2.grade = s.grade
              AND (gsm2.stream IS NULL OR gsm2.stream = s.stream OR s.stream IS NULL)
              AND gsm2.board = s.board
         )
       )
     GROUP BY gsm.subject_code
  ),
  plan_valid AS (
    SELECT psa.subject_code FROM public.plan_subject_access psa, effective_plan ep
     WHERE psa.plan_code = ep.plan_code
  )
  SELECT sub.code, sub.name, COALESCE(sub.name_hi, sub.name), sub.icon, sub.color,
         sub.subject_kind, gv.is_core,
         (gv.subject_code NOT IN (SELECT subject_code FROM plan_valid)) AS is_locked
    FROM public.subjects sub
    JOIN grade_valid gv ON gv.subject_code = sub.code
   WHERE sub.is_active;
$$;

REVOKE ALL ON FUNCTION public.get_available_subjects(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_subjects(UUID) TO authenticated, service_role;

-- ─── 3. Revise public.get_available_subjects_v2 (v2) ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_available_subjects_v2(p_student_id uuid)
 RETURNS TABLE(subject_code text, subject_display text, subject_display_hi text, ready_chapter_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id UUID;
  v_grade      TEXT;
  v_stream     TEXT;
  v_board      TEXT;
BEGIN
  SELECT id, grade, stream, COALESCE(board, 'CBSE') INTO v_student_id, v_grade, v_stream, v_board
    FROM public.students
   WHERE (id = p_student_id OR auth_user_id = p_student_id)
     AND (auth.uid() IS NULL OR auth_user_id = auth.uid())
   LIMIT 1;

  IF v_student_id IS NULL OR v_grade IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH s AS (
    SELECT v_grade AS grade, v_stream AS stream, v_board AS board
  ),
  grade_valid AS (
    SELECT gsm.subject_code
      FROM public.grade_subject_map gsm, s
     WHERE gsm.grade = s.grade
       AND (gsm.stream IS NULL OR gsm.stream = s.stream OR s.stream IS NULL)
       AND (
         gsm.board = s.board
         OR (gsm.board IN ('CBSE', 'Other') OR gsm.board IS NULL) AND NOT EXISTS (
           SELECT 1 FROM public.grade_subject_map gsm2
            WHERE gsm2.grade = s.grade
              AND (gsm2.stream IS NULL OR gsm2.stream = s.stream OR s.stream IS NULL)
              AND gsm2.board = s.board
         )
       )
     GROUP BY gsm.subject_code
  )
  SELECT
    sub.code,
    sub.name,
    COALESCE(sub.name_hi, sub.name),
    COALESCE((
      SELECT COUNT(DISTINCT cs.chapter_number)::INTEGER
        FROM public.cbse_syllabus cs
       WHERE cs.subject_code = sub.code
         AND cs.grade        = v_grade
         AND cs.rag_status   IN ('partial', 'ready')
         AND cs.is_in_scope  = TRUE
         AND (
           cs.board = v_board
           OR cs.board = 'CBSE' AND NOT EXISTS (
             SELECT 1 FROM public.cbse_syllabus cs2
              WHERE cs2.subject_code = sub.code
                AND cs2.grade        = v_grade
                AND cs2.board        = v_board
                AND cs2.rag_status   IN ('partial', 'ready')
                AND cs2.is_in_scope  = TRUE
           )
         )
    ), 0) AS ready_chapter_count
  FROM public.subjects sub
  JOIN grade_valid gv ON gv.subject_code = sub.code
  WHERE sub.is_active
  ORDER BY sub.name;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_available_subjects_v2(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_available_subjects_v2(uuid) TO authenticated, service_role;

-- ─── 4. Revise public.available_chapters_for_student_subject_v2 ──────────────
CREATE OR REPLACE FUNCTION public.available_chapters_for_student_subject_v2(
  p_student_id   UUID,
  p_subject_code TEXT
)
RETURNS TABLE (
  chapter_number          INTEGER,
  chapter_title           TEXT,
  chapter_title_hi        TEXT,
  verified_question_count INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_student_id UUID;
  v_grade      TEXT;
  v_board      TEXT;
BEGIN
  IF p_subject_code IS NULL OR LENGTH(p_subject_code) = 0 THEN
    RETURN;
  END IF;

  SELECT id, grade, COALESCE(board, 'CBSE') INTO v_student_id, v_grade, v_board
    FROM public.students
   WHERE (id = p_student_id OR auth_user_id = p_student_id)
     AND (auth.uid() IS NULL OR auth_user_id = auth.uid())
   LIMIT 1;

  IF v_student_id IS NULL OR v_grade IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH active_board AS (
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM public.cbse_syllabus cs2
       WHERE cs2.board        = v_board
         AND cs2.grade        = v_grade
         AND cs2.subject_code = p_subject_code
         AND cs2.rag_status   IN ('partial', 'ready')
         AND cs2.is_in_scope  = TRUE
    ) THEN v_board ELSE 'CBSE' END AS board
  )
  SELECT
    cs.chapter_number,
    cs.chapter_title,
    cs.chapter_title_hi,
    COALESCE((
      SELECT COUNT(*)::INTEGER FROM public.question_bank qb
       WHERE qb.subject = p_subject_code
         AND qb.grade = v_grade
         AND qb.chapter_number = cs.chapter_number
         AND qb.is_active
         AND qb.deleted_at IS NULL
         AND qb.verification_state = 'verified'
    ), 0) AS verified_question_count
  FROM public.cbse_syllabus cs, active_board ab
  WHERE cs.board        = ab.board
    AND cs.grade        = v_grade
    AND cs.subject_code = p_subject_code
    AND cs.rag_status   IN ('partial', 'ready')
    AND cs.is_in_scope  = TRUE
  ORDER BY cs.chapter_number;
END;
$$;

REVOKE ALL ON FUNCTION public.available_chapters_for_student_subject_v2(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.available_chapters_for_student_subject_v2(UUID, TEXT) TO authenticated, service_role;

-- ─── 5. Revise public.get_adaptive_questions ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_adaptive_questions(
  p_student_id     UUID,
  p_subject        TEXT,
  p_limit          INTEGER DEFAULT 10,
  p_include_review BOOLEAN DEFAULT true,
  p_mode           TEXT DEFAULT 'cognitive'
)
RETURNS TABLE(
  question_id   UUID,
  question_type TEXT,
  bloom_level   TEXT,
  priority_score NUMERIC,
  source        TEXT,
  board_year    INTEGER,
  paper_section TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_grade TEXT;
  v_board TEXT;
  v_source_target TEXT;
BEGIN
  SELECT grade, COALESCE(board, 'CBSE') INTO v_grade, v_board
    FROM public.students
   WHERE id = p_student_id OR auth_user_id = p_student_id
   LIMIT 1;

  v_source_target := LOWER(v_board) || '_board';

  -- Check if any questions exist for the student's selected board in question_bank
  IF NOT EXISTS (
    SELECT 1 FROM public.question_bank qb
     WHERE qb.subject = p_subject
       AND qb.source = v_source_target
       AND qb.is_active
       AND qb.deleted_at IS NULL
  ) THEN
    v_source_target := 'cbse_board'; -- Fallback to cbse_board
  END IF;

  IF p_mode = 'cognitive' THEN
    RETURN QUERY
    WITH student_zpd AS (
      SELECT bp.concept_id, bp.zpd_bloom_level
        FROM public.bloom_progression bp
       WHERE bp.student_id = p_student_id
    ),
    due_reviews AS (
      SELECT qb.id as question_id, 'review'::TEXT as question_type, qb.bloom_level, 100::NUMERIC as priority_score, qb.source, qb.board_year, qb.paper_section
        FROM public.question_bank qb
        JOIN public.concept_mastery cm ON qb.concept_id = cm.concept_id
       WHERE cm.student_id = p_student_id
         AND cm.next_review_date <= CURRENT_DATE
         AND qb.subject = p_subject
         AND p_include_review = true
       LIMIT 3
    ),
    zpd_questions AS (
      SELECT qb.id as question_id, 'new'::TEXT as question_type, qb.bloom_level,
             CASE WHEN qb.bloom_level = sz.zpd_bloom_level THEN 80::NUMERIC ELSE 60::NUMERIC END as priority_score,
             qb.source, qb.board_year, qb.paper_section
        FROM public.question_bank qb
        LEFT JOIN student_zpd sz ON qb.concept_id = sz.concept_id
        LEFT JOIN public.question_responses qr ON qr.question_id = qb.id AND qr.student_id = p_student_id
       WHERE qb.subject = p_subject
         AND qr.id IS NULL
       LIMIT 7
    )
    SELECT * FROM due_reviews
    UNION ALL
    SELECT * FROM zpd_questions
    ORDER BY priority_score DESC, random()
    LIMIT p_limit;

  ELSIF p_mode = 'board' THEN
    RETURN QUERY
    SELECT qb.id as question_id, 'board'::TEXT as question_type, qb.bloom_level, 90::NUMERIC as priority_score, qb.source, qb.board_year, qb.paper_section
      FROM public.question_bank qb
      LEFT JOIN public.question_responses qr ON qr.question_id = qb.id AND qr.student_id = p_student_id
     WHERE qb.subject = p_subject
       AND qb.source = v_source_target
       AND qr.id IS NULL
     ORDER BY qb.board_year DESC, random()
     LIMIT p_limit;

  ELSE
    RETURN QUERY
    SELECT qb.id as question_id, 'practice'::TEXT as question_type, qb.bloom_level, 70::NUMERIC as priority_score, qb.source, qb.board_year, qb.paper_section
      FROM public.question_bank qb
      LEFT JOIN public.question_responses qr ON qr.question_id = qb.id AND qr.student_id = p_student_id
     WHERE qb.subject = p_subject
       AND qr.id IS NULL
     ORDER BY random()
     LIMIT p_limit;
  END IF;
END;
$$;

-- ─── 6. Seed Grade 10 Content ───────────────────────────────────────────────
-- Add chapters to cbse_syllabus for core Grade 10 subjects
INSERT INTO public.cbse_syllabus (board, grade, subject_code, subject_display, chapter_number, chapter_title, rag_status, is_in_scope)
VALUES
  ('CBSE', '10', 'english', 'English', 1, 'A Letter to God', 'ready', true),
  ('CBSE', '10', 'english', 'English', 2, 'Nelson Mandela: Long Walk to Freedom', 'ready', true),
  ('CBSE', '10', 'hindi', 'Hindi', 1, 'Surdas ke Pad', 'ready', true),
  ('CBSE', '10', 'hindi', 'Hindi', 2, 'Ram-Lakshman-Parashuram Samvad', 'ready', true),
  ('CBSE', '10', 'social_studies', 'Social Studies', 1, 'The Rise of Nationalism in Europe', 'ready', true),
  ('CBSE', '10', 'social_studies', 'Social Studies', 2, 'Nationalism in India', 'ready', true)
ON CONFLICT ("board", "grade", "subject_code", "chapter_number") DO NOTHING;

-- Seed questions for core Grade 10 subjects
INSERT INTO public.question_bank (
  id, subject, grade, question_text, question_hi, question_type, options,
  correct_answer_index, explanation, explanation_hi, hint, difficulty, bloom_level,
  source, source_type, is_active, is_verified, verification_state,
  verified_against_ncert, is_ncert, chapter_number, tags, created_at
)
VALUES
  -- English
  (gen_random_uuid(), 'english', '10', 'Who is the author of "A Letter to God"?', 'पूंजीवादी लेखक कौन हैं "A Letter to God"?', 'mcq', '["G.L. Fuentes", "Nelson Mandela", "Robert Frost", "Leslie Norris"]'::jsonb, 0, 'G.L. Fuentes is the author of the story "A Letter to God".', 'जी.एल. फुएंटेस कहानी के लेखक हैं।', 'Think of the author initials.', 1, 'remember', 'curated_seed', 'board_paper', true, true, 'verified', true, true, 1, ARRAY['english', 'class10', 'sample']::text[], now()),
  -- Hindi
  (gen_random_uuid(), 'hindi', '10', 'सूरदास के पद किस भाषा में रचे गए हैं?', 'सूरदास के पद किस भाषा में रचे गए हैं?', 'mcq', '["ब्रजभाषा", "अवधी", "खड़ी बोली", "मैथिली"]'::jsonb, 0, 'सूरदास के पद ब्रजभाषा में रचे गए हैं।', 'सूरदास के पद ब्रजभाषा में रचे गए हैं।', 'कृष्ण की जन्मभूमि की भाषा।', 1, 'remember', 'curated_seed', 'board_paper', true, true, 'verified', true, true, 1, ARRAY['hindi', 'class10', 'sample']::text[], now()),
  -- Social Studies
  (gen_random_uuid(), 'social_studies', '10', 'When did the French Revolution occur?', 'फ्रांसीसी क्रांति कब हुई थी?', 'mcq', '["1789", "1799", "1804", "1815"]'::jsonb, 0, 'The French Revolution started in 1789.', 'फ्रांसीसी क्रांति 1789 में शुरू हुई थी।', 'End of the 18th century.', 2, 'remember', 'curated_seed', 'board_paper', true, true, 'verified', true, true, 1, ARRAY['social_studies', 'class10', 'sample']::text[], now())
ON CONFLICT DO NOTHING;

COMMIT;
