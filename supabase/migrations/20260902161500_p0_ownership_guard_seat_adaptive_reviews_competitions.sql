-- P0-1 wave 3 follow-up (2026-09-02 launch audit, same-day). Adds the
-- ownership check that was missing entirely from 4 SECURITY DEFINER
-- functions, found while auditing wave 3's REVOKE targets
-- (20260902160000). This is a different class of fix from wave 3: that
-- migration closed the GRANT (who can call the function at all); this one
-- closes a gap in the function BODY (once called, whether it verifies the
-- caller owns the id they passed).
--
-- assert_seat_capacity, get_due_reviews, get_adaptive_questions, and
-- get_competitions all take a raw p_school_id/p_student_id argument and,
-- until now, trusted it with no verification. Every caller comment in the
-- codebase already describes these as "scoped by p_student_id" (see
-- apps/host/src/app/api/dive/start/route.ts, dive/state/route.ts,
-- packages/lib/src/learner-model/due-reviews.ts,
-- packages/lib/src/learn/build-rhythm-queue.ts) — the scoping was assumed,
-- not enforced. Wave 3 closes anon/PUBLIC reach to `authenticated`, but
-- without this fix any authenticated account (any student/teacher/parent
-- login) could still call these 4 directly via PostgREST with someone
-- else's id and read their seat-capacity, spaced-repetition due-reviews,
-- adaptive-question-queue, or competition join/score data.
--
-- Every live caller passes a session-derived id already (confirmed via grep
-- across apps/host/src, packages/lib/src, mobile/lib):
--   - assert_seat_capacity: only called from
--     packages/lib/src/school-admin/bulk-roster.ts via the service-role
--     admin client (getSupabaseAdmin()), which is why the guard here allows
--     a NULL auth.uid() (service-role) through unconditionally.
--   - get_due_reviews / get_adaptive_questions / get_competitions: always
--     called with the CURRENT session's own resolved students.id (see
--     build-rhythm-queue.ts's "Pass the resolved surrogate students.id, not
--     the auth uid" comment).
--
-- The guard pattern mirrors two functions already live in this exact
-- codebase: check_formative_answer / update_chapter_progress (inline
-- `auth.uid() IS NOT NULL AND NOT EXISTS (... auth_user_id = auth.uid())`)
-- and is_school_admin_of() (used verbatim here, already NULL-safe — see
-- wave 3's migration comment for why). get_adaptive_questions' guard
-- additionally accepts either students.id or auth_user_id for p_student_id,
-- matching its own existing dual-key resolution 2 lines below the guard.
--
-- Every other statement in each function body is preserved verbatim; only
-- the guard is new.

CREATE OR REPLACE FUNCTION public.assert_seat_capacity(p_school_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ceiling integer;
  v_active_students integer;
  v_active_teachers integer;
  v_used integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_school_admin_of(p_school_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'school_id is required' USING ERRCODE = '22004';
  END IF;

  -- Ceiling: prefer an active/trial subscription's seats_purchased; fall back to
  -- schools.max_students; final floor of 0 (which then blocks everything).
  SELECT COALESCE(
    (SELECT ss.seats_purchased
       FROM school_subscriptions ss
      WHERE ss.school_id = p_school_id
        AND ss.status IN ('active', 'trial')
      ORDER BY ss.current_period_end DESC NULLS LAST
      LIMIT 1),
    (SELECT s.max_students FROM schools s WHERE s.id = p_school_id),
    0
  ) INTO v_ceiling;

  -- Active students enrolled in any class of this school (distinct so a student
  -- in two classes counts once toward the seat ceiling).
  SELECT COUNT(DISTINCT cs.student_id)
    INTO v_active_students
    FROM class_students cs
    JOIN classes c ON c.id = cs.class_id
   WHERE c.school_id = p_school_id
     AND cs.is_active = true;

  -- Active teachers of this school.
  SELECT COUNT(*)
    INTO v_active_teachers
    FROM teachers t
   WHERE t.school_id = p_school_id
     AND t.is_active = true;

  v_used := COALESCE(v_active_students, 0) + COALESCE(v_active_teachers, 0);

  IF v_used >= v_ceiling THEN
    RAISE EXCEPTION 'seat_capacity_exceeded: school % is at its seat ceiling (% of % used)',
      p_school_id, v_used, v_ceiling
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'school_id', p_school_id,
    'ceiling', v_ceiling,
    'used', v_used,
    'remaining', GREATEST(v_ceiling - v_used, 0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_due_reviews(p_student_id uuid, p_subject_code text DEFAULT NULL::text, p_limit integer DEFAULT 10)
 RETURNS TABLE(topic_id uuid, title text, title_hi text, mastery_probability double precision, last_attempted_at timestamp with time zone, review_interval_days integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.students WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY SELECT cm.topic_id, ct.title, ct.title_hi, cm.mastery_probability, cm.last_attempted_at, cm.review_interval_days FROM public.concept_mastery cm JOIN public.curriculum_topics ct ON ct.id = cm.topic_id JOIN public.subjects s ON s.id = ct.subject_id WHERE cm.student_id = p_student_id AND cm.mastery_level != 'not_started' AND (cm.next_review_at IS NULL OR cm.next_review_at <= NOW()) AND (p_subject_code IS NULL OR s.code = p_subject_code) ORDER BY cm.mastery_probability ASC, cm.last_attempted_at ASC NULLS FIRST LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_competitions(p_student_id uuid, p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'title_hi', c.title_hi, 'description', c.description, 'competition_type', c.competition_type, 'subject', c.subject, 'grade', c.grade, 'status', c.status, 'start_date', c.start_date, 'end_date', c.end_date, 'scoring_metric', c.scoring_metric, 'prize_1_title', c.prize_1_title, 'bonus_xp_1', c.bonus_xp_1, 'participation_xp', c.participation_xp, 'banner_emoji', c.banner_emoji, 'is_featured', c.is_featured, 'participant_count', (SELECT count(*) FROM competition_participants cp WHERE cp.competition_id = c.id), 'is_joined', EXISTS(SELECT 1 FROM competition_participants cp WHERE cp.competition_id = c.id AND cp.student_id = p_student_id), 'my_score', (SELECT cp.score FROM competition_participants cp WHERE cp.competition_id = c.id AND cp.student_id = p_student_id)) ORDER BY c.is_featured DESC, c.start_date) FROM competitions c WHERE (p_status IS NULL OR c.status = p_status) AND c.status != 'cancelled' AND (c.grade IS NULL OR c.grade = (SELECT grade FROM students WHERE id = p_student_id))), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_adaptive_questions(p_student_id uuid, p_subject text, p_limit integer DEFAULT 10, p_include_review boolean DEFAULT true, p_mode text DEFAULT 'cognitive'::text)
 RETURNS TABLE(question_id uuid, question_type text, bloom_level text, priority_score numeric, source text, board_year integer, paper_section text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grade text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students WHERE (id = p_student_id OR auth_user_id = p_student_id) AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Resolve student grade (TEXT per P5). Accept either students.id or auth_user_id.
  -- Empty result on a missing student rather than an error.
  SELECT s.grade INTO v_grade
    FROM students s
   WHERE s.id = p_student_id OR s.auth_user_id = p_student_id
   LIMIT 1;

  IF v_grade IS NULL THEN
    RETURN;
  END IF;

  IF p_mode = 'cognitive' THEN
    RETURN QUERY
    WITH
    -- ZPD bloom target per topic (bloom_progression keys topic on concept_id;
    -- empty on prod today, so this LEFT JOINs to NULL and the ELSE 60 priority
    -- applies — preserved structurally for when bloom_progression backfills).
    student_zpd AS (
      SELECT bp.concept_id AS topic_id, bp.zpd_bloom_level
      FROM bloom_progression bp
      WHERE bp.student_id = p_student_id
    ),
    -- DUE reviews: topics whose REAL SM-2 due timestamp (next_review_at,
    -- written by update_learner_state_post_quiz) has passed, ordered
    -- WEAKEST-first. Fixed 20260702200000: previously COALESCEd through the
    -- ghost next_review_date column (DEFAULT CURRENT_DATE + 1, never updated),
    -- which made every touched concept perpetually "due" after day 1.
    due_reviews AS (
      SELECT
        qb.id                                   AS question_id,
        'review'::text                          AS question_type,
        qb.bloom_level                          AS bloom_level,
        (100::numeric + ((1 - LEAST(GREATEST(COALESCE(cm.mastery_probability, 0.5), 0), 1)) * 10)::numeric)
                                                AS priority_score,
        qb.source                               AS source,
        qb.board_year                           AS board_year,
        qb.paper_section                        AS paper_section
      FROM question_bank qb
      JOIN concept_mastery cm
            ON cm.topic_id = qb.topic_id
           AND cm.student_id = p_student_id
      LEFT JOIN quiz_responses qr
            ON qr.question_id = qb.id
           AND qr.student_id  = p_student_id
      WHERE qb.subject     = p_subject
        AND qb.grade       = v_grade
        AND qb.is_active    = true
        AND qb.deleted_at IS NULL
        AND qb.topic_id IS NOT NULL
        AND p_include_review = true
        AND cm.next_review_at <= now()
        AND qr.id IS NULL
      ORDER BY priority_score DESC, qb.id
      LIMIT 3
    ),
    -- ZPD / new questions: unanswered questions in-grade-and-subject.
    zpd_questions AS (
      SELECT
        qb.id                                   AS question_id,
        'new'::text                             AS question_type,
        qb.bloom_level                          AS bloom_level,
        CASE
          WHEN sz.zpd_bloom_level IS NOT NULL
           AND qb.bloom_level = sz.zpd_bloom_level THEN 80::numeric
          ELSE 60::numeric
        END                                     AS priority_score,
        qb.source                               AS source,
        qb.board_year                           AS board_year,
        qb.paper_section                        AS paper_section
      FROM question_bank qb
      LEFT JOIN student_zpd sz
            ON sz.topic_id = qb.topic_id
      LEFT JOIN quiz_responses qr
            ON qr.question_id = qb.id
           AND qr.student_id  = p_student_id
      WHERE qb.subject     = p_subject
        AND qb.grade       = v_grade
        AND qb.is_active    = true
        AND qb.deleted_at IS NULL
        AND qr.id IS NULL
      ORDER BY priority_score DESC, random()
      LIMIT 7
    ),
    combined AS (
      SELECT * FROM due_reviews
      UNION ALL
      SELECT * FROM zpd_questions
    )
    SELECT
      combined.question_id,
      combined.question_type,
      combined.bloom_level,
      combined.priority_score,
      combined.source,
      combined.board_year,
      combined.paper_section
    FROM combined
    ORDER BY combined.priority_score DESC, random()
    LIMIT p_limit;

  ELSIF p_mode = 'board' THEN
    RETURN QUERY
    SELECT
      qb.id            AS question_id,
      'board'::text    AS question_type,
      qb.bloom_level   AS bloom_level,
      90::numeric      AS priority_score,
      qb.source        AS source,
      qb.board_year    AS board_year,
      qb.paper_section AS paper_section
    FROM question_bank qb
    LEFT JOIN quiz_responses qr
          ON qr.question_id = qb.id
         AND qr.student_id  = p_student_id
    WHERE qb.subject     = p_subject
      AND qb.grade       = v_grade
      AND qb.is_active    = true
      AND qb.deleted_at IS NULL
      AND qb.source      = 'cbse_board'
      AND qr.id IS NULL
    ORDER BY qb.board_year DESC NULLS LAST, random()
    LIMIT p_limit;

  ELSE
    RETURN QUERY
    SELECT
      qb.id            AS question_id,
      'practice'::text AS question_type,
      qb.bloom_level   AS bloom_level,
      70::numeric      AS priority_score,
      qb.source        AS source,
      qb.board_year    AS board_year,
      qb.paper_section AS paper_section
    FROM question_bank qb
    LEFT JOIN quiz_responses qr
          ON qr.question_id = qb.id
         AND qr.student_id  = p_student_id
    WHERE qb.subject     = p_subject
      AND qb.grade       = v_grade
      AND qb.is_active    = true
      AND qb.deleted_at IS NULL
      AND qr.id IS NULL
    ORDER BY random()
    LIMIT p_limit;
  END IF;
END;
$function$;
