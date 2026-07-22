-- Migration: 20260722097000_start_mock_test_attempt_rpc.sql
-- Purpose:    Phase 2.2 remediation, item 4 of the "Alfanumrik Student
--             Portal — Master Action Plan" (assessment-authored spec).
--             Installs the RPC `public.start_mock_test_attempt` that
--             dynamically assembles a 5-section, 39-question, 80-mark CBSE
--             board test at attempt-start time by pulling directly from the
--             GENERAL `question_bank` pool (subject + grade + difficulty),
--             NOT from `exam_paper_id` linkage.
--
-- Why dynamic assembly (per spec, verbatim): the 51 cbse_board template
--   rows seeded in 20260722096200 are catalog/metadata ONLY — zero
--   pre-linked question_bank rows via exam_paper_id. That is intentional,
--   not a content gap: the general question_bank pool already serves the
--   legacy /mock-exam page for any subject/grade combination, so this RPC
--   reuses that same pool at attempt-start time instead of requiring a
--   separate per-paper content-authoring pass.
--
-- Predecessors:
--   - 20260722096000 added exam_papers.grade (text, P5).
--   - 20260722096100 added mock_test_attempts.question_snapshot (jsonb).
--   - 20260722096200 seeded the 51 cbse_board template rows this RPC reads.
--   - 20260520000008 (PR-6) created mock_test_attempts / submit_mock_test_attempt
--     — this RPC is the attempt-START counterpart; submit-side snapshot
--     scoring is wired in a companion migration (20260722097100).
--
-- Section -> difficulty mapping (assessment spec, verbatim):
--   Section  Count  Marks/Q  Target difficulty
--   A        20     1        1
--   B        6      2        2
--   C        7      3        3
--   D        3      5        4
--   E        3      4        5
--   (39 questions, 80 marks total — matches exam_papers seed row exactly)
--
-- Selection query per section, with a 3-step fallback ladder (all scoped to
-- subject+grade, excluding ids already selected anywhere in this attempt,
-- same ordering throughout):
--   1. exact target difficulty
--   2. target difficulty +/- 1
--   3. any difficulty in the subject/grade pool
--   ORDER BY COALESCE(last_served_at, '-infinity') ASC, random()
-- Bloom level is NOT a filter (CBSE-board content is remember/understand/
-- apply only per 20260520000009's seed comment — a 5-way bloom filter
-- would return zero rows for sections D/E).
--
-- source_type isolation (assessment REJECTION fix, 2026-07-21): ALL THREE
-- fallback steps additionally restrict to
--   source_type = ANY (ARRAY['ncert_intext','ncert_exercise',
--                             'ncert_example','cbse_style','board_paper',
--                             'practice'])
-- Without this, the general subject+grade pool this RPC deliberately reuses
-- (see "Why dynamic assembly" above) also contains competition-tier rows —
-- 20260520000004 widened chk_source_type to admit 'jee_archive',
-- 'neet_archive', 'olympiad', 'pyq' — seeded by 20260520000006 for the SAME
-- subject+grade combinations this RPC serves: physics/chemistry/math grade
-- '12' (jee_archive, difficulty up to 5), biology grade '12' (neet_archive),
-- and math grade '10' (olympiad, difficulty 4-5). Genuine CBSE-board content
-- for those exact grade-12 STEM subjects (20260520000009) and grade-10 math
-- (20260520000011) is capped at difficulty 1-4 with only 7-8 board-tagged
-- rows per subject, so Section E (target difficulty 5) had ZERO
-- board-appropriate candidates and resolved exclusively from
-- JEE/NEET/Olympiad rows on step 1 (not an edge case — the default outcome
-- for every grade-12-STEM and grade-10-math attempt). Sections A-D also
-- backfilled from competition pools once the small board-tagged pool ran
-- out. NULL source_type is deliberately NOT treated as board-appropriate
-- here even though the column defaults to 'practice' at the schema level
-- (baseline_from_prod.sql:2199) — 'practice' rows already pass the
-- allow-list explicitly, so a literal NULL would only occur from an
-- anomalous/unverified insert path, and this RPC should not silently trust
-- that as CBSE-board content. Expected consequence, called out by
-- assessment as the CORRECT behavior, not a bug: Sections D/E for
-- physics/chemistry/math/biology grade '12' and math grade '10' will now
-- legitimately hit content_insufficient until real board-tagged
-- difficulty-4/5 rows are authored for those subject/grade pairs — see the
-- pre-rollout audit query in
-- docs/runbooks/cbse-board-mock-exam-source-type-audit.md.
--
-- All-or-nothing: if step 3 still cannot fill EVERY section to its
-- required count, the whole assembly is rejected. This RPC signals that by
-- returning `{"attempt_id": <fresh non-persisted uuid>, "questions": [],
-- "content_insufficient": true, "deficient_sections": [...]}` rather than
-- raising — this exactly matches the shape the API route needs to satisfy
-- the frontend's already-built contract (packages/ui/src/exams/mock-test-
-- types.ts StartAttemptResponse: a truthy attempt_id + a `questions` array,
-- empty in this case) so the existing NotReadyCard renders, the same as
-- the static-paper empty-state (GET .../[id] returning `questions: []`).
-- No mock_test_attempts row is written when content is insufficient — the
-- returned attempt_id is never submitted (the runner never mounts past
-- NotReadyCard), so there is nothing to reconcile.
--
-- Single-subject requirement: dynamic assembly assumes exactly one subject
-- in exam_papers.subject_scope (true for all 51 new template rows, each
-- ARRAY[subject]). The ONE pre-existing hand-authored cbse_board paper
-- (sample_cbse_class12_general_v1, from 20260520000009) is a 4-subject
-- cross-stream paper with grade = NULL (never backfilled — that migration
-- explicitly deferred it as "a content-team follow-up, not a schema
-- concern"). This RPC raises a clear exception for subject_scope <> 1
-- element rather than silently cherry-picking subject_scope[1] and
-- serving a physics-only test under a "general" paper code. FLAGGED FOR
-- REVIEWER ATTENTION (backend report): because the frontend's isCbseBoard
-- check is exam_family === 'cbse_board' with no subject-count carve-out,
-- this ONE legacy sample paper will now hit the /start route (since ALL
-- cbse_board papers route through the dynamic flow post-deploy) and
-- receive a 500 from this RPC instead of rendering its original 30
-- static questions. This is a real regression against that one paper,
-- flagged for architect/frontend/ops follow-up (options: retire the
-- sample paper from the active catalog, or teach the frontend to treat
-- multi-subject cbse_board papers as static). NOT fixed by this migration
-- since deciding which of those paths to take is outside a schema-only
-- backend PR.
--
-- Does NOT touch: submit_mock_test_attempt (companion migration
-- 20260722097100), exam_papers, question_bank content, RLS on any table.
--
-- Idempotent: CREATE OR REPLACE FUNCTION; GRANT is idempotent; verification
-- block is read-only.
--
-- Owner: backend (per Master Action Plan Phase 2.2 assignment). Reviewers
--   per P14: assessment (section/difficulty mapping + fallback-ladder
--   correctness, bloom-level exclusion rationale), architect (SECURITY
--   DEFINER justification, RLS bypass posture), testing (unit coverage for
--   the fallback ladder + all-or-nothing rejection), frontend (contract
--   conformance against StartAttemptResponse).
--
-- Rollback (manual, requires user approval per CLAUDE.md):
--   DROP FUNCTION public.start_mock_test_attempt(uuid, uuid);

BEGIN;

CREATE OR REPLACE FUNCTION public.start_mock_test_attempt(
  p_student_id uuid,
  p_paper_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
-- SECURITY DEFINER justification (architect review, 2026-07-22, mirrors
-- the established posture of the sibling submit_mock_test_attempt RPC,
-- 20260520000008 / 20260722097100): this RPC must (a) INSERT into
-- mock_test_attempts on behalf of the target student even when the
-- caller is an admin acting on that student's behalf (the table's INSERT
-- RLS policy is `student_id = auth.uid()`-scoped and would reject an
-- admin-driven insert under SECURITY INVOKER), and (b) read
-- question_bank across the full subject/grade pool to assemble the
-- section-weighted paper — a broad, cross-row SELECT that is intentional
-- here (question_bank's student-facing SELECT policy is not scoped per
-- student, so INVOKER would work for the read alone, but consistency
-- with the atomic write in the same transaction favors one authorization
-- posture for the whole function). The function's own explicit
-- authorization check (caller = p_student_id OR service_role OR active
-- admin_users) is the compensating control that stands in for the RLS
-- check DEFINER bypasses; SET search_path pins it against search-path
-- hijacking.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid      uuid    := auth.uid();
  v_caller_role     text    := COALESCE(auth.jwt() ->> 'role', '');
  v_is_admin        boolean := false;
  v_paper           record;
  v_subject         text;
  v_grade           text;

  -- Section definitions (parallel arrays; index 1..5 = sections A..E).
  v_sections        text[] := ARRAY['A','B','C','D','E'];
  v_counts          int[]  := ARRAY[20,6,7,3,3];
  v_marks_per_q     int[]  := ARRAY[1,2,3,5,4];
  v_targets         int[]  := ARRAY[1,2,3,4,5];

  v_selected_ids    uuid[] := ARRAY[]::uuid[];
  v_final_ids       uuid[] := ARRAY[]::uuid[];
  v_final_sections  text[] := ARRAY[]::text[];
  v_final_marks     int[]  := ARRAY[]::int[];

  v_section_ids     uuid[];
  v_filled          int;
  v_required        int;
  v_target          int;
  v_section         text;
  v_marks_q         int;
  v_insufficient    boolean := false;
  v_deficient       jsonb := '[]'::jsonb;
  v_row             record;
  v_pick_id         uuid;
  v_i               int;

  v_attempt_id      uuid;
  v_snapshot        jsonb := '[]'::jsonb;
  v_questions       jsonb := '[]'::jsonb;
BEGIN
  -- (a) Authorization — same convention as submit_mock_test_attempt.
  IF v_caller_role <> 'service_role' THEN
    IF v_caller_uid IS NULL THEN
      RAISE EXCEPTION 'start_mock_test_attempt: not authenticated' USING ERRCODE = '42501';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.admin_users au
       WHERE au.auth_user_id = v_caller_uid
         AND au.is_active = true
         AND au.admin_level IN ('admin', 'super_admin')
    ) INTO v_is_admin;
    IF v_caller_uid <> p_student_id AND NOT v_is_admin THEN
      RAISE EXCEPTION 'start_mock_test_attempt: caller % may not start for student %',
        v_caller_uid, p_student_id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- (b) Load paper — must be an active cbse_board single-subject paper.
  SELECT id, exam_family, grade, subject_scope, is_active
    INTO v_paper
    FROM public.exam_papers
   WHERE id = p_paper_id AND is_active = true;

  IF v_paper.id IS NULL THEN
    RAISE EXCEPTION 'start_mock_test_attempt: exam_paper % not found or inactive', p_paper_id
      USING ERRCODE = '22023';
  END IF;
  IF v_paper.exam_family <> 'cbse_board' THEN
    RAISE EXCEPTION 'start_mock_test_attempt: exam_paper % is not exam_family=cbse_board', p_paper_id
      USING ERRCODE = '22023';
  END IF;
  IF v_paper.subject_scope IS NULL OR array_length(v_paper.subject_scope, 1) <> 1 THEN
    RAISE EXCEPTION 'start_mock_test_attempt: exam_paper % has subject_scope length <> 1 (dynamic assembly requires exactly one subject)', p_paper_id
      USING ERRCODE = '22023';
  END IF;

  v_subject := v_paper.subject_scope[1];
  v_grade   := v_paper.grade;

  -- (c) Assemble each section with the 3-step fallback ladder.
  FOR v_i IN 1..5 LOOP
    v_section  := v_sections[v_i];
    v_required := v_counts[v_i];
    v_target   := v_targets[v_i];
    v_marks_q  := v_marks_per_q[v_i];
    v_section_ids := ARRAY[]::uuid[];

    -- Step 1: exact target difficulty.
    FOR v_row IN
      SELECT id FROM public.question_bank
       WHERE subject = v_subject AND grade = v_grade
         AND difficulty = v_target
         AND is_active = true AND is_verified = true
         AND source_type = ANY (ARRAY['ncert_intext','ncert_exercise','ncert_example','cbse_style','board_paper','practice'])
         AND NOT (id = ANY (v_selected_ids))
       ORDER BY COALESCE(last_served_at, '-infinity'::timestamptz) ASC, random()
       LIMIT v_required
    LOOP
      v_section_ids := array_append(v_section_ids, v_row.id);
    END LOOP;
    v_filled := COALESCE(array_length(v_section_ids, 1), 0);

    -- Step 2: target difficulty +/- 1 (top-up only; exclude what step 1 got).
    IF v_filled < v_required THEN
      FOR v_row IN
        SELECT id FROM public.question_bank
         WHERE subject = v_subject AND grade = v_grade
           AND difficulty BETWEEN (v_target - 1) AND (v_target + 1)
           AND is_active = true AND is_verified = true
           AND source_type = ANY (ARRAY['ncert_intext','ncert_exercise','ncert_example','cbse_style','board_paper','practice'])
           AND NOT (id = ANY (v_selected_ids))
           AND NOT (id = ANY (v_section_ids))
         ORDER BY COALESCE(last_served_at, '-infinity'::timestamptz) ASC, random()
         LIMIT (v_required - v_filled)
      LOOP
        v_section_ids := array_append(v_section_ids, v_row.id);
      END LOOP;
      v_filled := COALESCE(array_length(v_section_ids, 1), 0);
    END IF;

    -- Step 3: any difficulty in the subject/grade pool (top-up only).
    IF v_filled < v_required THEN
      FOR v_row IN
        SELECT id FROM public.question_bank
         WHERE subject = v_subject AND grade = v_grade
           AND is_active = true AND is_verified = true
           AND source_type = ANY (ARRAY['ncert_intext','ncert_exercise','ncert_example','cbse_style','board_paper','practice'])
           AND NOT (id = ANY (v_selected_ids))
           AND NOT (id = ANY (v_section_ids))
         ORDER BY COALESCE(last_served_at, '-infinity'::timestamptz) ASC, random()
         LIMIT (v_required - v_filled)
      LOOP
        v_section_ids := array_append(v_section_ids, v_row.id);
      END LOOP;
      v_filled := COALESCE(array_length(v_section_ids, 1), 0);
    END IF;

    IF v_filled < v_required THEN
      v_insufficient := true;
      v_deficient := v_deficient || jsonb_build_object(
        'section', v_section, 'required', v_required, 'filled', v_filled
      );
    END IF;

    -- Record this section's picks in display order (A..E), even when a
    -- section came up short — diagnostics only; the all-or-nothing gate
    -- below is what actually blocks the assembly from being persisted.
    FOREACH v_pick_id IN ARRAY v_section_ids LOOP
      v_final_ids      := array_append(v_final_ids, v_pick_id);
      v_final_sections := array_append(v_final_sections, v_section);
      v_final_marks    := array_append(v_final_marks, v_marks_q);
    END LOOP;

    v_selected_ids := v_selected_ids || v_section_ids;
  END LOOP;

  -- (d) All-or-nothing gate.
  IF v_insufficient THEN
    RETURN jsonb_build_object(
      'attempt_id', gen_random_uuid(),
      'questions', '[]'::jsonb,
      'content_insufficient', true,
      'deficient_sections', v_deficient
    );
  END IF;

  -- (e) Build the snapshot (question_id/section/marks/order only — per
  --     spec, NOT the full question text) and the student-facing question
  --     payload (adds text/text_hi/options for immediate rendering),
  --     preserving the exact A->E display order assembled above via
  --     unnest(...) WITH ORDINALITY zipping the three parallel arrays.
  SELECT jsonb_agg(
           jsonb_build_object(
             'question_id', t.id,
             'section', t.section,
             'marks', t.marks,
             'order', t.ord
           ) ORDER BY t.ord
         )
    INTO v_snapshot
    FROM unnest(v_final_ids, v_final_sections, v_final_marks)
           WITH ORDINALITY AS t(id, section, marks, ord);

  SELECT jsonb_agg(
           jsonb_build_object(
             'question_id', t.id,
             'section', t.section,
             'marks', t.marks,
             'order', t.ord,
             'text', qb.question_text,
             'text_hi', qb.question_hi,
             'options', COALESCE(qb.options, '[]'::jsonb)
           ) ORDER BY t.ord
         )
    INTO v_questions
    FROM unnest(v_final_ids, v_final_sections, v_final_marks)
           WITH ORDINALITY AS t(id, section, marks, ord)
    JOIN public.question_bank qb ON qb.id = t.id;

  -- (f) Persist the in-progress attempt. total_questions/max_score are
  --     always exactly 39/80 here (all-or-nothing gate above already
  --     guaranteed a full assembly). attempted/correct/wrong = 0,
  --     skipped = 39 satisfies chk_mta_count_consistency for a
  --     not-yet-submitted row.
  INSERT INTO public.mock_test_attempts (
    student_id, exam_paper_id, started_at, submitted_at, status,
    time_taken_seconds, total_questions, attempted_count, correct_count,
    wrong_count, skipped_count, raw_score, max_score, score_percent,
    xp_earned, client_metadata, question_snapshot
  ) VALUES (
    p_student_id, p_paper_id, now(), NULL, 'in_progress',
    NULL, 39, 0, 0,
    0, 39, 0, 80, 0,
    0, NULL, v_snapshot
  )
  RETURNING id INTO v_attempt_id;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id,
    'questions', COALESCE(v_questions, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.start_mock_test_attempt(uuid, uuid) IS
  'Phase 2.2 (2026-07-22, source_type isolation fix 2026-07-21 assessment rejection): dynamically assembles a 39-question / 80-mark, 5-section CBSE-board mock test from the general question_bank pool (subject+grade+difficulty, NOT exam_paper_id), snapshots the selection into mock_test_attempts.question_snapshot, and returns {attempt_id, questions} for immediate rendering. All three fallback-ladder steps additionally restrict source_type to the CBSE-board-appropriate set (ncert_intext, ncert_exercise, ncert_example, cbse_style, board_paper, practice), excluding competition-tier rows (jee_archive, neet_archive, olympiad, pyq) that otherwise share the same subject+grade pool. All-or-nothing: any section that cannot be filled via the 3-step fallback ladder (exact difficulty -> +/-1 -> any difficulty), each scoped to that source_type allow-list, rejects the whole assembly and returns {attempt_id: <non-persisted>, questions: [], content_insufficient: true} instead of writing a row. Requires exam_papers.exam_family=''cbse_board'' and subject_scope of exactly one subject. SECURITY DEFINER: caller must equal p_student_id OR be service_role OR be active admin_users (admin/super_admin).';

GRANT EXECUTE ON FUNCTION public.start_mock_test_attempt(uuid, uuid)
  TO authenticated, service_role;

-- ============================================================================
-- Verification block — read-only sanity checks
-- ============================================================================

DO $verify$
DECLARE
  v_fn_exists boolean;
  v_arg_count integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'start_mock_test_attempt'
  ) INTO v_fn_exists;

  SELECT COALESCE(MAX(pronargs), 0) INTO v_arg_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'start_mock_test_attempt';

  RAISE NOTICE '[p2.2-item4] start_mock_test_attempt exists: % (args: %, expect 2)', v_fn_exists, v_arg_count;

  IF NOT (v_fn_exists AND v_arg_count = 2) THEN
    RAISE WARNING '[p2.2-item4] migration did NOT land cleanly — see flags above';
  ELSE
    RAISE NOTICE '[p2.2-item4] MIGRATION COMPLETE — start_mock_test_attempt RPC installed';
  END IF;
END $verify$;

COMMIT;
