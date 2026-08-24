-- Migration: 20260824090000_quiz_bloom_capture_learner_state_failure_log_and_topic_id_trigger.sql
-- Purpose: Phase 1A — (1) make quiz_responses.bloom_level actually land,
--   (2) make the swallowed learner-state write failure observable, and
--   (3) make question_bank.topic_id SELF-MAINTAINING instead of one-shot.
--
-- ─── PRODUCTION EVIDENCE THAT DROVE THIS (measured read-only, 2026-08-24) ──
-- concept_mastery is NOT empty (91 rows / 22 students; last write byte-identical
-- to max(quiz_sessions.completed_at)). The mastery writer WORKS and is NOT
-- touched here. What is actually broken:
--
--   (A) quiz_responses.bloom_level is never written by the current writer.
--       The column exists (baseline:12214) and v_q_bloom was already in scope in
--       submit_quiz_results_v2 (declared 20260814000022:166, SELECTed :529,
--       passed to update_learner_state_post_quiz :722) — it was simply OMITTED
--       from the INSERT column list at :656-673. The cohort split proves it:
--       Apr-2026 390/390 populated (an older writer), Aug-2026 0/45 (the current
--       writer). error_type shows the mirror image (0/390 then 25/45).
--       question_id is populated on 435/435 rows, so a join-backfill to
--       question_bank repairs EVERY historical row.
--
--   (B) question_bank.topic_id is NULL on 6,025 / 18,750 active questions
--       (32.1%) with NO trigger maintaining it. The 2026-06-21 repair
--       (20260621000500) was a one-shot anonymous DO block; the admin write path
--       (apps/host/src/app/api/internal/admin/content/route.ts) and both bulk
--       drivers never derive topic_id, which is exactly why that fix did not
--       hold. LATENT, not live: 62.3% of the bank sits in subjects that are BOTH
--       is_active=false AND absent from grade_subject_map (students cannot reach
--       them); of the 7,060 REACHABLE questions only 674 (9.5%) are NULL, and
--       0/435 served responses ever hit a NULL-topic question. This migration is
--       prevention plus a re-run of the backfill — not an emergency.
--
--   (C) The mastery-write failure is invisible. 20260814000022:714-731 wrapped
--       the call in BEGIN … EXCEPTION WHEN OTHERS THEN RAISE NOTICE … END and
--       gated it on IF v_q_topic_id IS NOT NULL with a silent implicit ELSE.
--       RAISE NOTICE is invisible TWICE over: Postgres does not log it at the
--       default log_min_messages='warning', and supabase-js never surfaces
--       notices to the client. Operationally it was a comment.
--
--   (D) CHECKED — NOT A BUG. update_learner_state_post_quiz has exactly ONE
--       surviving overload: 20260807000400 DROPs the 10-arg one and creates
--       (UUID, UUID, BOOLEAN, TEXT, TEXT, INT, INT, INT, FLOAT, FLOAT, FLOAT).
--       The call site passes 8 positional args typed UUID, UUID, BOOLEAN, TEXT,
--       TEXT, INT, INT, SMALLINT. v_q_difficulty is declared INT and read from
--       question_bank.difficulty, which is `integer` in the baseline (:2139) —
--       NOT a TEXT 'medium'-style value, so there is no 42883. SMALLINT -> INT
--       (p_hint_level) is an implicit widening and there is no second candidate,
--       so there is no 42725 either. Verified against the schema, not assumed.
--       The finding is now documented inline at the call site as a tripwire.
--
-- ─── WHAT THIS MIGRATION CHANGES ──────────────────────────────────────────
--   1. NEW TABLE public.learner_state_write_failures (+ RLS + policies + grants
--      + indexes, ALL in THIS migration per P8). Metadata only: ids, a bounded
--      failure_kind, SQLSTATE and a truncated SQLERRM. NEVER question text or
--      answer text (P13). Students/parents/teachers have NO access — a row names
--      topics a student got wrong. service_role full; admin/super_admin SELECT.
--   2. submit_quiz_results_v2 re-emitted (CREATE OR REPLACE, SAME 11-param
--      signature, SAME RETURN shape) with exactly three deltas:
--        a) bloom_level / v_q_bloom added to the quiz_responses INSERT;
--        b) RAISE NOTICE -> RAISE WARNING + an error-isolated failure row;
--        c) the missing ELSE branch logs failure_kind='topic_unresolvable'.
--      The body is otherwise copied byte-for-byte from 20260814000022 (which
--      grep confirms is the NEWEST definition — the 20260816/0820-0823 cluster
--      never redefines it).
--   3. Idempotent backfill of quiz_responses.bloom_level from question_bank.
--   4. NEW public.resolve_question_topic_id() BEFORE INSERT OR UPDATE trigger on
--      question_bank — topic_id becomes self-maintaining.
--   5. Idempotent re-run of the topic_id backfill for active NULL rows.
--
-- ─── WHAT THIS MIGRATION DOES *NOT* CHANGE ────────────────────────────────
--   P1  score formula .................... byte-identical, ROUND((correct/total)*100)
--   P2  XP literals + 200/day cap ........ byte-identical (constants live only in
--                                          packages/lib/src/xp-rules.ts)
--   P3  all three anti-cheat checks ...... byte-identical
--   P4  single-transaction submit + the p_idempotency_key replay ... identical.
--       Every NEW write added here is error-isolated in its own
--       BEGIN … EXCEPTION WHEN OTHERS THEN NULL … END so telemetry can never
--       abort a submit.
--   P5  grades stay TEXT — the trigger keys NEW.grade (TEXT) against
--       curriculum_topics.grade (TEXT). No integer comparison is introduced.
--   Function SIGNATURE and RETURN jsonb keys ... identical (REG-48-style pins).
--   concept_mastery.next_review_date ..... NOT dropped (a separate change is
--       repointing its readers). A COMMENT tombstone is added instead.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS; the CHECK constraint is added
--   through a DO block that swallows duplicate_object; DROP POLICY IF EXISTS
--   before each CREATE POLICY; CREATE OR REPLACE FUNCTION; DROP TRIGGER IF
--   EXISTS before CREATE TRIGGER; and both backfills are guarded so a re-run
--   touches 0 rows. Non-destructive: no table is dropped, no column is
--   dropped, no row is deleted.
-- Ordering: REQUIRES 20260814000022 (the body copied here) and 20260807000400
--   (the single 11-arg update_learner_state_post_quiz overload).
--   Timestamp 20260824090000 is strictly greater than the newest existing file
--   (20260823154500_db12_narrow_default_grants_..._DESIGN_ONLY.sql) and no
--   20260824* migration exists, so it can neither collide nor re-order.
-- Owner: architect. Reviewers (P14): backend (the admin content-route half),
--   assessment (bloom_level now populated feeds Bloom analytics), testing.
-- Added: 2026-08-24.

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. learner_state_write_failures — make the swallowed failure observable
-- ═════════════════════════════════════════════════════════════════════════════
-- P13 BY CONSTRUCTION: ids + a bounded enum + a Postgres error string. No
-- question text, no answer text, no name/email/phone. sqlerrm is truncated by
-- the writer to 500 chars.
CREATE TABLE IF NOT EXISTS public.learner_state_write_failures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  topic_id        uuid,          -- NULL for the topic_unresolvable kind
  question_id     uuid,
  quiz_session_id uuid,
  failure_kind    text NOT NULL,
  sqlstate        text,
  sqlerrm         text,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

-- Bounded failure_kind. 'null_topic_id' is RESERVED for a future writer that can
-- distinguish "the column was NULL" from "the fallback also failed";
-- submit_quiz_results_v2 only reaches its ELSE branch when BOTH failed and so
-- records 'topic_unresolvable'. Added via DO/EXCEPTION so a re-run is a no-op
-- (ADD CONSTRAINT has no IF NOT EXISTS form).
DO $do$
BEGIN
  ALTER TABLE public.learner_state_write_failures
    ADD CONSTRAINT learner_state_write_failures_kind_check
    CHECK (failure_kind IN ('exception', 'null_topic_id', 'topic_unresolvable'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table  THEN NULL;
END
$do$;

CREATE INDEX IF NOT EXISTS idx_lswf_occurred_at
  ON public.learner_state_write_failures (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lswf_student
  ON public.learner_state_write_failures (student_id);
CREATE INDEX IF NOT EXISTS idx_lswf_kind_occurred
  ON public.learner_state_write_failures (failure_kind, occurred_at DESC);

-- P8: RLS enabled + policies in the SAME migration.
ALTER TABLE public.learner_state_write_failures ENABLE ROW LEVEL SECURITY;

-- (a) service_role — the RPC's SECURITY DEFINER owner and every server reader.
DROP POLICY IF EXISTS learner_state_write_failures_service_all
  ON public.learner_state_write_failures;
CREATE POLICY learner_state_write_failures_service_all
  ON public.learner_state_write_failures
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- (b) admin / super_admin READ ONLY, delegated to a SECURITY DEFINER helper.
--
--     WHY A HELPER AND NOT AN INLINE EXISTS: the canonical
--     "domain_events_super_admin_select" shape inlines
--     `EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ...)` in USING. Both
--     tables are RLS-enabled, so a SECURITY INVOKER inline subquery re-enters
--     their own RLS — the 2026-07-02 TSB-4 recursion class. The XC-3 guard
--     (apps/host/src/__tests__/rls-no-cross-table-recursion.test.ts) freezes
--     that debt and requires new policies to delegate instead. Following the
--     2026-08-02 precedent (is_own_exam_entry, migration 20260802090100), the
--     helper is minted fresh rather than grandfathering new debt.
--
--     The existing public.is_admin() is NOT usable here: it keys off
--     `admin_users`, and 20260803140000 reconciles admin_users INTO RBAC
--     super_admin one-way only — an RBAC-only admin has no admin_users row and
--     would be wrongly denied.
--
--     Boundary is the EXACT baseline predicate: an ACTIVE, non-expired
--     user_roles grant for role 'super_admin' or 'admin'. No over/under-grant.
-- rls-helper
CREATE OR REPLACE FUNCTION public.is_rbac_platform_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.auth_user_id = auth.uid()
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
      AND r.name = ANY (ARRAY['super_admin'::text, 'admin'::text])
  );
$$;

COMMENT ON FUNCTION public.is_rbac_platform_admin() IS
  'SECURITY DEFINER RLS helper [rls-helper] (migration 20260824090000). Returns '
  'true iff the caller (auth.uid()) holds an ACTIVE, non-expired user_roles '
  'grant for the RBAC role super_admin or admin. Exact boundary equivalent of '
  'the baseline "domain_events_super_admin_select" inline predicate — same two '
  'tables, same is_active + expires_at freshness checks, same role set — so no '
  'over- or under-grant. SECURITY DEFINER so the inner reads of user_roles + '
  'roles BYPASS RLS, which is what keeps a new admin-read policy off the XC-3 '
  'inline cross-table ledger. NOT interchangeable with public.is_admin(), which '
  'keys off admin_users; 20260803140000 syncs admin_users INTO RBAC one-way '
  'only, so an RBAC-only admin has no admin_users row.';

REVOKE EXECUTE ON FUNCTION public.is_rbac_platform_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_rbac_platform_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_rbac_platform_admin() TO authenticated, service_role;

-- No write policy for authenticated: admins can READ the diagnostics, never
-- mutate them. Only the RPC (service_role / SECURITY DEFINER owner) writes.
DROP POLICY IF EXISTS learner_state_write_failures_admin_select
  ON public.learner_state_write_failures;
CREATE POLICY learner_state_write_failures_admin_select
  ON public.learner_state_write_failures
  FOR SELECT TO authenticated
  USING (public.is_rbac_platform_admin());

-- DELIBERATE OMISSION (reviewed, architect): there is NO student policy, NO
-- parent policy and NO teacher policy. A row names a topic the student answered
-- wrong plus a raw Postgres error string — operator diagnostics, not
-- learner-facing data. Those three roles get implicit deny (RLS on, no matching
-- policy). The four-pattern RLS checklist resolves as: student -> deny by
-- design, parent -> deny by design, teacher -> deny by design, admin ->
-- policy (b) plus the service_role bypass.
REVOKE ALL ON public.learner_state_write_failures FROM PUBLIC;
REVOKE ALL ON public.learner_state_write_failures FROM anon;
REVOKE ALL ON public.learner_state_write_failures FROM authenticated;
GRANT SELECT ON public.learner_state_write_failures TO authenticated;  -- still RLS-gated to admin by (b)
GRANT ALL    ON public.learner_state_write_failures TO service_role;

COMMENT ON TABLE public.learner_state_write_failures IS
  'Operator diagnostics for learner-state (concept_mastery) writes that '
  'submit_quiz_results_v2 could not perform. Before 20260824090000 these '
  'failures were emitted as RAISE NOTICE, which Postgres does not log at the '
  'default log_min_messages and supabase-js never surfaces to the client — so '
  'they were invisible twice over. failure_kind: exception = '
  'update_learner_state_post_quiz raised; topic_unresolvable = '
  'question_bank.topic_id was NULL AND the (subject, grade, chapter_number) '
  'curriculum_topics fallback resolved nothing, so the write was skipped '
  'entirely; null_topic_id = reserved for a future finer-grained writer. '
  'Metadata only (P13) — ids, a bounded enum, SQLSTATE and a truncated '
  'SQLERRM; never question or answer text. No student/parent/teacher read '
  'policy by design.';

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. submit_quiz_results_v2 — bloom_level captured + failures made observable
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.submit_quiz_results_v2(
  p_session_id UUID,
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT,
  p_topic TEXT DEFAULT NULL,
  p_chapter INTEGER DEFAULT NULL,
  p_responses JSONB DEFAULT '[]',
  p_time INTEGER DEFAULT 0,
  p_idempotency_key UUID DEFAULT NULL,   -- Phase 2.8 addition (default NULL = legacy path)
  -- Phase 3 (20260809000500): unhinted-mastery bonus economy — DEFAULTs
  -- mirror xp-config (REG-48-style parity pin); client-supplied values are
  -- clamped downward to these constants when auth.uid() is set.
  p_unhinted_xp INTEGER DEFAULT 2,
  p_unhinted_cap INTEGER DEFAULT 30
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
-- SECURITY DEFINER justified: writes quiz_sessions, quiz_responses,
-- user_question_history, student_misconceptions, learner_state_write_failures;
-- invokes atomic_quiz_profile_update and award_xp_capped. Authorization is
-- enforced inline against students.auth_user_id.
SET search_path = public
AS $$
DECLARE
  v_total INTEGER := 0;
  v_correct INTEGER := 0;
  v_score_percent NUMERIC;
  v_xp INTEGER := 0;
  v_quiz_session_id UUID;
  v_flagged BOOLEAN := false;
  v_avg_time NUMERIC;
  r JSONB;
  v_q_id UUID;
  v_question_id UUID;
  v_selected_displayed INTEGER;
  v_selected_orig INTEGER;
  v_shuffle INT[];
  v_correct_idx_snapshot INT;
  v_options_snapshot JSONB;
  v_is_correct BOOLEAN;
  v_q_text TEXT;
  v_q_type TEXT;
  v_q_topic_id UUID;
  v_q_number INTEGER := 0;
  v_q_bloom TEXT;
  v_q_difficulty INT;
  -- RCA 2026-06-21: variables for runtime topic_id derivation fallback
  v_q_subject TEXT;
  v_q_chapter INTEGER;
  -- PART C: server-side error classification
  v_error_type TEXT;       -- computed bucket for THIS wrong response (NULL otherwise)
  v_prior_mastery FLOAT;   -- prior concept mastery, read pre-BKT for this topic
  v_answer_counts INT[] := ARRAY[0,0,0,0];
  v_max_same_answer INT := 0;
  v_review_questions JSONB := '[]'::jsonb;
  v_correct_option_text TEXT;
  v_cme_action TEXT;
  v_cme_concept_id UUID;
  v_cme_reason TEXT;
  -- Phase 2.8 idempotency cache record
  v_existing RECORD;
  -- 20260729 fix cluster (F1/F7/F5): served-question count + daily-cap propagation
  v_served_count INT;           -- F1/F7: rows actually served for this session
  v_xp_effective INT;           -- F5: CAPPED xp read back from the ledger
  v_xp_capped BOOLEAN := false; -- F5: surfaced so the client cap banner can render
  -- 20260805 Foxy North-Star F8: per-response hint tier (NULL when absent/invalid)
  v_hint_level SMALLINT;
  -- 20260807 Phase 2 event capture (D2/D3/D6/D7)
  v_options_version_at_serve INT;  -- D2: server-held snapshot version
  v_integrity_hash TEXT;           -- D2: server-held snapshot hash
  v_answer_method TEXT;            -- D3: whitelisted capture method
  v_confidence SMALLINT;           -- D6: self-reported confidence 1..5 or NULL
  v_misconception_id UUID;         -- D7: matched question_misconceptions.id
  v_misconception_code TEXT;       -- D7: its stable pattern code
  -- 20260809 Phase 3: unhinted-mastery bonus lane
  v_unhinted_count INT := 0;       -- correct answers with hint_level = 0
  v_unhinted_rate INT;             -- effective per-question bonus (clamped)
  v_unhinted_cap_eff INT;          -- effective daily cap (clamped)
  v_unhinted_award JSONB;          -- award_xp_capped result
  v_unhinted_bonus INT := 0;       -- effective bonus actually credited
  -- 20260814000022 P0: written (non-MCQ) response lane
  v_is_written BOOLEAN := false;   -- this response is scored from rubric marks
  v_marks_awarded NUMERIC;         -- AI-evaluated marks for a written answer
  v_marks_possible NUMERIC;        -- marks the written question was worth
  v_student_answer_text TEXT;      -- the student's typed answer
  v_rubric_feedback TEXT;          -- AI rubric feedback for that answer
  -- 20260824090000: learner-state write-failure telemetry. SQLSTATE/SQLERRM
  -- are captured into locals inside the handler because the nested
  -- error-isolated INSERT below opens its own subtransaction, after which
  -- those special variables no longer describe the original failure.
  v_lsw_sqlstate TEXT;
  v_lsw_sqlerrm TEXT;
BEGIN
  -- Ownership check (same pattern as start_quiz_session).
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  -- Phase 3 (20260809000500): resolve the effective bonus economy. Browser-
  -- originated calls (auth.uid() set) are clamped DOWNWARD to the canonical
  -- defaults so a hand-crafted PostgREST call can never raise its own bonus;
  -- service-role callers (auth.uid() NULL) pass values from xp-config
  -- unclamped. Keep these clamp constants identical to the param DEFAULTs.
  v_unhinted_rate    := GREATEST(0, COALESCE(p_unhinted_xp, 0));
  v_unhinted_cap_eff := GREATEST(0, COALESCE(p_unhinted_cap, 0));
  IF auth.uid() IS NOT NULL THEN
    v_unhinted_rate    := LEAST(v_unhinted_rate, 2);
    v_unhinted_cap_eff := LEAST(v_unhinted_cap_eff, 30);
  END IF;

  -- ─── Phase 2.8: idempotency replay short-circuit ──────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, total_questions, correct_answers, score_percent, score
      INTO v_existing
      FROM quiz_sessions
     WHERE student_id = p_student_id
       AND idempotency_key = p_idempotency_key
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                 'question_id', qr.question_id,
                 'is_correct', qr.is_correct,
                 -- COLUMN-NAME CORRECTION: canonical column is student_answer_index.
                 'selected_displayed_index', qr.student_answer_index,
                 'selected_original_index',
                   CASE
                     WHEN qss.shuffle_map IS NOT NULL
                          AND array_length(qss.shuffle_map, 1) = 4
                          AND qr.student_answer_index BETWEEN 0 AND 3
                     THEN qss.shuffle_map[qr.student_answer_index + 1]
                     ELSE qr.student_answer_index
                   END,
                 'correct_original_index', qss.correct_answer_index_snapshot,
                 'correct_option_text',
                   CASE
                     WHEN qss.options_snapshot IS NOT NULL
                          AND jsonb_typeof(qss.options_snapshot) = 'array'
                          AND qss.correct_answer_index_snapshot IS NOT NULL
                          AND jsonb_array_length(qss.options_snapshot)
                              > qss.correct_answer_index_snapshot
                     THEN qss.options_snapshot ->> qss.correct_answer_index_snapshot
                     ELSE NULL
                   END,
                 'shuffle_map', to_jsonb(qss.shuffle_map)
               ) ORDER BY qr.question_number
             ), '[]'::jsonb)
        INTO v_review_questions
        FROM quiz_responses qr
        LEFT JOIN quiz_session_shuffles qss
               ON qss.session_id = p_session_id
              AND qss.question_id = qr.question_id
       WHERE qr.quiz_session_id = v_existing.id;

      RETURN jsonb_build_object(
        'total', v_existing.total_questions,
        'correct', v_existing.correct_answers,
        'score_percent', v_existing.score_percent,
        'xp_earned', v_existing.score,
        'session_id', v_existing.id,
        'flagged', false,
        'idempotent_replay', true,
        'questions', v_review_questions
      );
    END IF;
  END IF;

  -- Validate session ownership.
  IF EXISTS (
    SELECT 1 FROM quiz_session_shuffles
    WHERE session_id = p_session_id AND student_id <> p_student_id
  ) THEN
    RAISE EXCEPTION 'Access denied: session % does not belong to student %',
      p_session_id, p_student_id;
  END IF;

  -- ─── First pass: count + score in original-index space ───────────────
  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_total := v_total + 1;
    v_q_id := (r->>'question_id')::UUID;
    v_question_id := v_q_id;
    v_selected_displayed := COALESCE(
      (r->>'selected_displayed_index')::INTEGER,
      (r->>'selected_option')::INTEGER
    );

    SELECT shuffle_map, correct_answer_index_snapshot, options_snapshot
      INTO v_shuffle, v_correct_idx_snapshot, v_options_snapshot
      FROM quiz_session_shuffles
     WHERE session_id = p_session_id AND question_id = v_q_id;

    -- P0 (20260814000022): decide the scoring lane from SERVER state ONLY.
    -- `options_snapshot` was written by start_quiz_session at serve time and
    -- `question_type` is read live from question_bank — the client can
    -- influence neither, so it cannot elect the written lane for an MCQ.
    v_q_type := NULL;
    SELECT question_type INTO v_q_type FROM question_bank WHERE id = v_q_id;

    v_is_written := (
         v_correct_idx_snapshot IS NULL
      OR v_options_snapshot IS NULL
      OR jsonb_typeof(v_options_snapshot) <> 'array'
      OR jsonb_array_length(v_options_snapshot) <> 4
    ) AND lower(COALESCE(v_q_type, '')) NOT IN ('mcq', 'multiple_choice', 'objective');

    -- Tamper / never-started guard (20260504100100) — PRESERVED for MCQ.
    -- A written response legitimately has no option snapshot to grade
    -- against, so it must not abort the whole submission.
    IF NOT v_is_written AND v_correct_idx_snapshot IS NULL THEN
      RAISE EXCEPTION
        'session_not_started: quiz_session_shuffles row missing for session_id=%, question_id=%',
        p_session_id, v_q_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_is_written THEN
      -- WRITTEN LANE. Correctness from the AI rubric marks, using the SAME
      -- >= 50%-of-marks rule the student was already shown per question.
      -- Regex-guarded so a malformed payload can never raise a cast error
      -- and abort the submit transaction (P4).
      v_marks_awarded := CASE
        WHEN (r->>'marks_awarded') ~ '^[0-9]+(\.[0-9]+)?$' THEN (r->>'marks_awarded')::NUMERIC
        ELSE NULL
      END;
      v_marks_possible := CASE
        WHEN (r->>'marks_possible') ~ '^[0-9]+(\.[0-9]+)?$' THEN (r->>'marks_possible')::NUMERIC
        ELSE NULL
      END;
      v_marks_possible := COALESCE(v_marks_possible, 0);
      v_marks_awarded  := COALESCE(v_marks_awarded, 0);
      v_marks_awarded  := LEAST(GREATEST(v_marks_awarded, 0), v_marks_possible);
      v_selected_orig  := NULL;   -- no option space; never inherit the previous row
      v_is_correct     := (v_marks_possible > 0 AND v_marks_awarded >= v_marks_possible * 0.5);
    ELSE
      IF v_shuffle IS NOT NULL
         AND array_length(v_shuffle, 1) = 4
         AND v_selected_displayed IS NOT NULL
         AND v_selected_displayed BETWEEN 0 AND 3 THEN
        v_selected_orig := v_shuffle[v_selected_displayed + 1];
      ELSE
        v_selected_orig := v_selected_displayed;
      END IF;

      v_is_correct := (
        v_selected_orig IS NOT NULL
        AND v_selected_orig = v_correct_idx_snapshot
      );
    END IF;

    IF v_is_correct THEN
      v_correct := v_correct + 1;
    END IF;

    IF v_selected_displayed IS NOT NULL
       AND v_selected_displayed >= 0
       AND v_selected_displayed <= 3 THEN
      v_answer_counts[v_selected_displayed + 1] := v_answer_counts[v_selected_displayed + 1] + 1;
    END IF;
  END LOOP;

  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'total', 0, 'correct', 0, 'score_percent', 0,
      'xp_earned', 0, 'session_id', NULL, 'flagged', false,
      'idempotent_replay', false,
      'xp_capped', false,
      'questions', '[]'::jsonb
    );
  END IF;

  -- P3 Check 1: avg time < 3s -> flag, xp = 0.
  -- p_time is ELAPSED seconds. (The web client used to pass the exam-mode
  -- COUNTDOWN remainder here, which inverted this check; fixed client-side by
  -- computeElapsedSeconds in packages/lib/src/quiz/session-contract.ts. The
  -- threshold below is unchanged.)
  v_avg_time := CASE WHEN v_total > 0 THEN p_time::NUMERIC / v_total ELSE 0 END;
  IF v_avg_time < 3.0 AND v_total > 0 THEN
    v_flagged := true;
  END IF;

  -- P3 Check 2: not all same answer if >3 questions.
  -- Written responses carry selected_displayed = -1 and are therefore not
  -- counted in v_answer_counts — an all-written quiz cannot trip this check,
  -- which is correct: there is no option index to repeat.
  IF v_total > 3 THEN
    v_max_same_answer := GREATEST(
      v_answer_counts[1], v_answer_counts[2],
      v_answer_counts[3], v_answer_counts[4]
    );
    IF v_max_same_answer = (v_answer_counts[1] + v_answer_counts[2] + v_answer_counts[3] + v_answer_counts[4]) AND (v_answer_counts[1] + v_answer_counts[2] + v_answer_counts[3] + v_answer_counts[4]) > 3 THEN
      v_flagged := true;
    END IF;
  END IF;

  -- P3 Check 3 (FIX F1+F7, 2026-07-29): response count must equal the number
  -- of questions actually SERVED for this session.
  --
  -- p_session_id is the id returned by start_quiz_session(), which is the SAME
  -- id it used as quiz_session_shuffles.session_id when it wrote one row per
  -- served question. COUNT(*) against it is therefore the correct "how many
  -- questions were served" source.
  --
  -- 20260814000022: this only became correct for non-MCQ quizzes once the
  -- client started snapshotting EVERY served question, not just the MCQs (see
  -- collectSessionQuestionIds). Before that, a mixed quiz always had more
  -- responses than served rows. Unchanged here — the comparison is the same.
  --
  -- Fail-closed: an unexpected 0 count still flags rather than silently
  -- passing.
  SELECT COUNT(*) INTO v_served_count
    FROM quiz_session_shuffles
   WHERE session_id = p_session_id;

  IF v_served_count = 0 OR jsonb_array_length(p_responses) <> v_served_count THEN
    v_flagged := true;
  END IF;

  -- P1: score_percent = ROUND((v_correct / v_total) * 100).
  v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100);

  -- P2: base + high_score_bonus + perfect_bonus, gated by P3 flag.
  IF v_flagged THEN
    v_xp := 0;
  ELSE
    v_xp := v_correct * 10;                              -- P2: XP_RULES.quiz_per_correct=10
    IF v_score_percent >= 80 THEN v_xp := v_xp + 20; END IF; -- P2: quiz_high_score_bonus=20
    IF v_score_percent = 100 THEN v_xp := v_xp + 50; END IF; -- P2: quiz_perfect_bonus=50
  END IF;

  INSERT INTO quiz_sessions (
    student_id, subject, grade, topic_title, chapter_number,
    total_questions, correct_answers, score_percent,
    time_taken_seconds, score, is_completed, completed_at,
    idempotency_key
  ) VALUES (
    p_student_id, p_subject, p_grade, p_topic, p_chapter,
    v_total, v_correct, v_score_percent,
    p_time, v_xp, true, NOW(),
    p_idempotency_key
  ) RETURNING id INTO v_quiz_session_id;

  -- ─── Second pass: write quiz_responses + history + per-question state ─
  v_q_number := 0;
  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_q_number := v_q_number + 1;
    v_question_id := (r->>'question_id')::UUID;
    v_selected_displayed := COALESCE(
      (r->>'selected_displayed_index')::INTEGER,
      (r->>'selected_option')::INTEGER
    );

    -- F8 (2026-08-05, Foxy North-Star): each response MAY carry "hint_level"
    -- (0 = no hint .. 5). Normalize defensively via a regex guard (no
    -- per-row subtransaction): absent, non-numeric, or out-of-range values
    -- become NULL so a malformed client payload can never violate
    -- quiz_responses_hint_level_check and abort the whole submission
    -- transaction.
    v_hint_level := CASE
      WHEN (r->>'hint_level') ~ '^[0-5]$' THEN (r->>'hint_level')::SMALLINT
      ELSE NULL
    END;

    -- D3 (2026-08-07, Phase 2): answer_method — server whitelist, same
    -- normalize-never-abort pattern. Unknown/absent -> 'mcq'.
    v_answer_method := CASE
      WHEN (r->>'answer_method') IN ('mcq', 'typed', 'voice', 'scan')
      THEN (r->>'answer_method')
      ELSE 'mcq'
    END;

    -- D6 (2026-08-07, Phase 2): confidence — regex-guard 1..5, else NULL.
    v_confidence := CASE
      WHEN (r->>'confidence') ~ '^[1-5]$' THEN (r->>'confidence')::SMALLINT
      ELSE NULL
    END;

    -- D2 (2026-08-07, Phase 2): the existing per-question snapshot SELECT is
    -- extended to also read the SERVER-HELD snapshot version + integrity hash
    -- (written by start_quiz_session; NOT NULL since 20260504100500). Zero
    -- client trust — the client cannot influence either value.
    SELECT shuffle_map, correct_answer_index_snapshot, options_snapshot,
           options_version_at_serve, integrity_hash
      INTO v_shuffle, v_correct_idx_snapshot, v_options_snapshot,
           v_options_version_at_serve, v_integrity_hash
      FROM quiz_session_shuffles
     WHERE session_id = p_session_id AND question_id = v_question_id;

    -- P0 (20260814000022): same server-only lane decision as the first pass.
    v_q_type := NULL;
    SELECT question_type INTO v_q_type FROM question_bank WHERE id = v_question_id;

    v_is_written := (
         v_correct_idx_snapshot IS NULL
      OR v_options_snapshot IS NULL
      OR jsonb_typeof(v_options_snapshot) <> 'array'
      OR jsonb_array_length(v_options_snapshot) <> 4
    ) AND lower(COALESCE(v_q_type, '')) NOT IN ('mcq', 'multiple_choice', 'objective');

    IF NOT v_is_written AND v_correct_idx_snapshot IS NULL THEN
      RAISE EXCEPTION
        'session_not_started: quiz_session_shuffles row missing in second pass for session_id=%, question_id=%',
        p_session_id, v_question_id
        USING ERRCODE = 'P0001';
    END IF;

    SELECT question_text, question_type, topic_id, bloom_level, difficulty,
           subject, chapter_number
      INTO v_q_text, v_q_type, v_q_topic_id, v_q_bloom, v_q_difficulty,
           v_q_subject, v_q_chapter
      FROM question_bank WHERE id = v_question_id;

    IF v_q_topic_id IS NULL THEN
      SELECT ct.id INTO v_q_topic_id
      FROM   public.curriculum_topics ct
      JOIN   public.subjects s ON s.id = ct.subject_id
      WHERE  s.code            = v_q_subject
        AND  ct.grade          = p_grade
        AND  ct.chapter_number = v_q_chapter
        AND  ct.is_active      = true
      ORDER BY ct.display_order ASC
      LIMIT 1;
    END IF;

    -- P0 (20260814000022): explicit per-iteration reset of the written-answer
    -- columns so an MCQ row can never inherit the previous row's marks.
    v_marks_awarded := CASE
      WHEN (r->>'marks_awarded') ~ '^[0-9]+(\.[0-9]+)?$' THEN (r->>'marks_awarded')::NUMERIC
      ELSE NULL
    END;
    v_marks_possible := CASE
      WHEN (r->>'marks_possible') ~ '^[0-9]+(\.[0-9]+)?$' THEN (r->>'marks_possible')::NUMERIC
      ELSE NULL
    END;
    v_student_answer_text := NULLIF(r->>'student_answer_text', '');
    v_rubric_feedback     := NULLIF(r->>'rubric_feedback', '');

    IF v_is_written THEN
      v_marks_possible := COALESCE(v_marks_possible, 0);
      v_marks_awarded  := COALESCE(v_marks_awarded, 0);
      v_marks_awarded  := LEAST(GREATEST(v_marks_awarded, 0), v_marks_possible);
      v_selected_orig  := NULL;
      v_is_correct     := (v_marks_possible > 0 AND v_marks_awarded >= v_marks_possible * 0.5);
    ELSE
      -- MCQ lane: the written columns stay NULL so quiz_responses keeps its
      -- documented "NULL for MCQ" semantics (baseline:12229-12235).
      v_marks_awarded       := NULL;
      v_marks_possible      := NULL;
      v_student_answer_text := NULL;
      v_rubric_feedback     := NULL;

      IF v_shuffle IS NOT NULL
         AND array_length(v_shuffle, 1) = 4
         AND v_selected_displayed IS NOT NULL
         AND v_selected_displayed BETWEEN 0 AND 3 THEN
        v_selected_orig := v_shuffle[v_selected_displayed + 1];
      ELSE
        v_selected_orig := v_selected_displayed;
      END IF;

      v_is_correct := (
        v_selected_orig IS NOT NULL
        AND v_selected_orig = v_correct_idx_snapshot
      );
    END IF;

    -- Phase 3 (20260809000500): unhinted-mastery tally. hint_level = 0 means
    -- the client EXPLICITLY reported "answered with no hint"; NULL (not
    -- reported / legacy clients) deliberately earns nothing.
    IF v_is_correct AND v_hint_level = 0 THEN
      v_unhinted_count := v_unhinted_count + 1;
    END IF;

    IF v_options_snapshot IS NOT NULL
       AND jsonb_typeof(v_options_snapshot) = 'array'
       AND v_correct_idx_snapshot IS NOT NULL
       AND jsonb_array_length(v_options_snapshot) > v_correct_idx_snapshot THEN
      v_correct_option_text := v_options_snapshot ->> v_correct_idx_snapshot;
    ELSE
      v_correct_option_text := NULL;
    END IF;

    -- ─── PART C: SERVER-SIDE error_type classification (deterministic) ──
    v_error_type := NULL;
    IF NOT v_is_correct THEN
      v_prior_mastery := NULL;
      IF v_q_topic_id IS NOT NULL THEN
        SELECT cm.mastery_probability
          INTO v_prior_mastery
          FROM concept_mastery cm
         WHERE cm.student_id = p_student_id
           AND cm.topic_id   = v_q_topic_id;
      END IF;

      IF COALESCE((r->>'time_spent')::INT, 0) < 3            -- CARELESS_FLOOR_SEC (P3 3s/q boundary)
         AND v_prior_mastery IS NOT NULL
         AND v_prior_mastery >= 0.40 THEN                    -- CONCEPTUAL_MASTERY_CUTOFF
        v_error_type := 'careless';
      ELSIF v_prior_mastery IS NULL
         OR v_prior_mastery < 0.40 THEN                      -- CONCEPTUAL_MASTERY_CUTOFF
        v_error_type := 'conceptual';
      ELSE
        v_error_type := 'procedural';
      END IF;
    END IF;

    -- D7 (2026-08-07, Phase 2): wrong-answer misconception match on the TRUE
    -- ORIGINAL-space distractor index this RPC already re-derived from the
    -- server shuffle snapshot. Explicit per-iteration reset — a correct answer
    -- must never inherit the previous iteration's match. (A written response
    -- has v_selected_orig NULL and is skipped: there is no distractor.)
    v_misconception_id := NULL;
    v_misconception_code := NULL;
    IF NOT v_is_correct
       AND v_selected_orig IS NOT NULL
       AND v_selected_orig BETWEEN 0 AND 3 THEN
      SELECT qm.id, qm.misconception_code
        INTO v_misconception_id, v_misconception_code
        FROM question_misconceptions qm
       WHERE qm.question_id = v_question_id
         AND qm.distractor_index = v_selected_orig
       LIMIT 1;
    END IF;

    -- COLUMN-NAME CORRECTION: student_answer_index + time_taken_seconds are the
    -- canonical columns (NOT selected_option / time_spent_seconds — phantom).
    -- F8 (2026-08-05): hint_level added.
    -- Phase 2 (2026-08-07): question_version, content_hash, answer_method,
    -- confidence, misconception_id added (columns from 20260807000200).
    -- P0 (20260814000022): student_answer_text / marks_awarded /
    -- rubric_feedback / marks added — the written answer is now RECORDED, not
    -- just scored. All four columns pre-exist (baseline:12207-12225) and were
    -- added for written answers; v2 had simply never populated them. MCQ rows
    -- get NULL in the first three and marks = 1, which is the column default,
    -- so nothing about an MCQ row changes.
    -- FIX (20260824090000): bloom_level added. THE one-token defect — the
    -- column exists (baseline:12214) and v_q_bloom was already SELECTed above
    -- and passed to update_learner_state_post_quiz below, but it was never in
    -- this column list, so every response written by this writer had a NULL
    -- Bloom tag (prod: Aug-2026 cohort 0/45; Apr-2026 cohort 390/390 from an
    -- older writer). Section 3 backfills the history.
    INSERT INTO quiz_responses (
      quiz_session_id, student_id, question_id, student_answer_index,
      is_correct, time_taken_seconds,
      question_number, question_text, question_type, bloom_level,
      shuffle_map, error_type, hint_level,
      question_version, content_hash, answer_method, confidence,
      misconception_id,
      student_answer_text, marks_awarded, rubric_feedback, marks
    ) VALUES (
      v_quiz_session_id, p_student_id, v_question_id, v_selected_displayed,
      v_is_correct, COALESCE((r->>'time_spent')::INTEGER, 0),
      v_q_number, v_q_text, v_q_type, v_q_bloom,
      v_shuffle, v_error_type, v_hint_level,
      v_options_version_at_serve, v_integrity_hash, v_answer_method, v_confidence,
      v_misconception_id,
      v_student_answer_text, v_marks_awarded, v_rubric_feedback,
      COALESCE(v_marks_possible, 1)::INT
    ) ON CONFLICT DO NOTHING;

    -- Phase 2 (6): student_misconceptions lifecycle. ERROR-ISOLATED — a
    -- failure here must NEVER abort the submit transaction (P4). Free-text
    -- columns (question_text / student_answer / correct_answer) stay NULL (P13).
    BEGIN
      IF NOT v_is_correct
         AND v_misconception_id IS NOT NULL
         AND v_misconception_code IS NOT NULL
         AND v_q_topic_id IS NOT NULL THEN
        -- Wrong + curated mapping matched -> ONE open row per
        -- (student, pattern, concept); re-detection bumps detected_at.
        INSERT INTO student_misconceptions (
          student_id, pattern_code, concept_code, detected_at, is_resolved
        ) VALUES (
          p_student_id, v_misconception_code, v_q_topic_id::text, now(), false
        )
        ON CONFLICT (student_id, pattern_code, concept_code)
          WHERE is_resolved = false
        DO UPDATE SET detected_at = now();
      ELSIF v_is_correct AND v_q_topic_id IS NOT NULL THEN
        -- Correct on a question whose curated mappings match an open row for
        -- the same student + pattern + concept -> resolve it.
        UPDATE student_misconceptions sm
           SET is_resolved         = true,
               resolved_at         = now(),
               resolution_method   = 'quiz_correct',
               attempts_to_resolve = COALESCE(sm.attempts_to_resolve, 0) + 1
         WHERE sm.student_id  = p_student_id
           AND sm.is_resolved = false
           AND sm.concept_code = v_q_topic_id::text
           AND sm.pattern_code IN (
                 SELECT qm.misconception_code
                   FROM question_misconceptions qm
                  WHERE qm.question_id = v_question_id
               );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- lifecycle is best-effort telemetry; never aborts submit (P4)
    END;

    -- OBSERVABILITY FIX (20260824090000). Two distinct silent-failure modes
    -- lived here and BOTH were invisible:
    --   (a) the EXCEPTION handler used RAISE NOTICE. A NOTICE is invisible
    --       TWICE over: Postgres does not log it at the default
    --       log_min_messages = 'warning', and supabase-js does not surface
    --       notices to the client. Operationally it was a comment.
    --   (b) v_q_topic_id IS NULL fell through an implicit ELSE -- the
    --       learner-state write was simply skipped with no trace at all.
    -- Both now RAISE WARNING (which DOES reach the Postgres log at the default
    -- level) and record a metadata-only row in learner_state_write_failures.
    -- P4: every telemetry write is wrapped in its own BEGIN ... EXCEPTION WHEN
    -- OTHERS THEN NULL, so a failure of the telemetry can never abort the
    -- submit transaction. P13: ids only -- no question text, no answer text.
    IF v_q_topic_id IS NOT NULL THEN
      BEGIN
        -- Phase 2 (1): v_hint_level passed through as the new 8th positional
        -- arg (20260807000400) so evidence counters see the hint tier.
        -- ARGUMENT-TYPE AUDIT (20260824090000): the 8 positional args below are
        -- UUID, UUID, BOOLEAN, TEXT, TEXT, INT, INT, SMALLINT. v_q_difficulty is
        -- declared INT and read from question_bank.difficulty, which is
        -- `integer` in the baseline -- NOT a TEXT 'medium'-style value. The
        -- single surviving overload (20260807000400 DROPped the 10-arg one) is
        -- (UUID, UUID, BOOLEAN, TEXT, TEXT, INT, INT, INT, FLOAT, FLOAT, FLOAT);
        -- SMALLINT -> INT is an implicit widening, so this resolves to exactly
        -- one candidate. No 42883 (undefined_function) and no 42725
        -- (ambiguous_function) risk. Verified against the schema, not assumed --
        -- if either type ever changes, this comment is the tripwire.
        PERFORM update_learner_state_post_quiz(
          p_student_id,
          v_q_topic_id,
          v_is_correct,
          v_q_bloom,
          v_error_type,                                      -- PART C: COMPUTED value
          COALESCE((r->>'time_spent')::INT, 0) * 1000,
          v_q_difficulty,
          v_hint_level
        );
      EXCEPTION WHEN OTHERS THEN
        v_lsw_sqlstate := SQLSTATE;
        v_lsw_sqlerrm  := SQLERRM;
        RAISE WARNING 'submit_quiz_results_v2: update_learner_state_post_quiz failed for student=% topic=% (non-fatal): % [SQLSTATE %]',
          p_student_id, v_q_topic_id, v_lsw_sqlerrm, v_lsw_sqlstate;
        BEGIN
          INSERT INTO public.learner_state_write_failures (
            student_id, topic_id, question_id, quiz_session_id,
            failure_kind, sqlstate, sqlerrm
          ) VALUES (
            p_student_id, v_q_topic_id, v_question_id, v_quiz_session_id,
            'exception', v_lsw_sqlstate, left(v_lsw_sqlerrm, 500)
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;  -- P4: telemetry must never abort the submit
        END;
      END;
    ELSE
      -- (b) The formerly-silent no-op. question_bank.topic_id was NULL AND the
      -- runtime (subject, grade, chapter_number) -> curriculum_topics fallback
      -- resolved nothing, so this response contributes NO mastery evidence.
      RAISE WARNING 'submit_quiz_results_v2: learner-state write SKIPPED (topic_unresolvable) for student=% question=% (non-fatal)',
        p_student_id, v_question_id;
      BEGIN
        INSERT INTO public.learner_state_write_failures (
          student_id, topic_id, question_id, quiz_session_id,
          failure_kind, sqlstate, sqlerrm
        ) VALUES (
          p_student_id, NULL, v_question_id, v_quiz_session_id,
          'topic_unresolvable', NULL,
          'question_bank.topic_id IS NULL and the (subject, grade, chapter_number) curriculum_topics fallback resolved no row'
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;  -- P4: telemetry must never abort the submit
      END;
    END IF;

    INSERT INTO user_question_history (
      student_id, question_id, subject, grade, chapter_number,
      first_shown_at, last_shown_at, times_shown, last_result
    ) VALUES (
      p_student_id, v_question_id, p_subject, p_grade, p_chapter,
      NOW(), NOW(), 1, v_is_correct
    ) ON CONFLICT (student_id, question_id) DO UPDATE SET
      last_shown_at = NOW(),
      times_shown = user_question_history.times_shown + 1,
      last_result = v_is_correct;

    v_review_questions := v_review_questions || jsonb_build_array(
      jsonb_build_object(
        'question_id', v_question_id,
        'is_correct', v_is_correct,
        'selected_displayed_index', v_selected_displayed,
        'selected_original_index', v_selected_orig,
        'correct_original_index', v_correct_idx_snapshot,
        'correct_option_text', v_correct_option_text,
        'shuffle_map', to_jsonb(v_shuffle)
      )
    );
  END LOOP;

  -- P4: atomic XP + profile update.
  PERFORM atomic_quiz_profile_update(
    p_student_id, p_subject, v_xp, v_total, v_correct, p_time, v_quiz_session_id
  );

  -- FIX F5 (2026-07-29): read the CAPPED amount back from the exact ledger row
  -- the 7-arg atomic_quiz_profile_update just wrote (it RETURNS VOID, so its
  -- internal P2 daily-cap clamp never reached this function's return value).
  -- No ledger row exists when the cap was already fully reached before this
  -- call — that case correctly resolves to effective XP = 0 below.
  SELECT amount INTO v_xp_effective
    FROM xp_transactions
   WHERE reference_id = 'quiz_' || v_quiz_session_id::text
   LIMIT 1;

  v_xp_effective := COALESCE(v_xp_effective, 0);
  v_xp_capped := v_xp_effective < v_xp;
  v_xp := v_xp_effective;

  -- Persist the CAPPED amount into quiz_sessions.score. The row above was
  -- inserted with the pre-cap value because the cap is only knowable after
  -- the ledger write completes (which needs v_quiz_session_id, which the
  -- INSERT itself produces) -- so this UPDATE is the correction pass.
  UPDATE quiz_sessions SET score = v_xp WHERE id = v_quiz_session_id;

  -- Phase 3 (20260809000500): unhinted-mastery bonus — SEPARATE capped lane
  -- via award_xp_capped (20260809000300). daily_category 'unhinted_mastery'
  -- has its own cap (v_unhinted_cap_eff); it does NOT consume the 200 XP
  -- 'quiz' cap. reference_id keyed to the session -> a replayed submission
  -- cannot double-award. Gated on NOT v_flagged (P3: flagged earns nothing).
  -- ERROR-ISOLATED: the bonus lane can never abort the submit (P4).
  IF NOT v_flagged AND v_unhinted_count > 0 AND v_unhinted_rate > 0 THEN
    BEGIN
      v_unhinted_award := award_xp_capped(
        p_student_id,
        'unhinted_mastery',
        v_unhinted_count * v_unhinted_rate,
        v_unhinted_cap_eff,
        'unhinted_mastery',
        'unhinted_' || v_quiz_session_id::text,
        jsonb_build_object(
          'quiz_session_id', v_quiz_session_id,
          'unhinted_correct', v_unhinted_count,
          'per_question_xp', v_unhinted_rate
        )
      );
      v_unhinted_bonus := COALESCE((v_unhinted_award->>'effective_xp')::INT, 0);
    EXCEPTION WHEN OTHERS THEN
      v_unhinted_bonus := 0;
      RAISE NOTICE 'submit_quiz_results_v2: award_xp_capped(unhinted_mastery) failed for student=% session=% (non-fatal): %',
        p_student_id, v_quiz_session_id, SQLERRM;
    END;
  END IF;

  -- CME: best-effort post-quiz action (error-isolated).
  BEGIN
    SELECT ca.action_type, ca.concept_id, ca.reason
      INTO v_cme_action, v_cme_concept_id, v_cme_reason
      FROM compute_post_quiz_action(p_student_id, p_subject, p_grade) ca;

    UPDATE quiz_sessions
       SET cme_next_action = v_cme_action,
           cme_next_concept_id = v_cme_concept_id,
           cme_reason = v_cme_reason
     WHERE id = v_quiz_session_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'total', v_total,
    'correct', v_correct,
    'score_percent', v_score_percent,
    'xp_earned', v_xp,
    'xp_capped', v_xp_capped,
    'session_id', v_quiz_session_id,
    'flagged', v_flagged,
    'idempotent_replay', false,
    'cme_next_action', v_cme_action,
    'cme_next_concept_id', v_cme_concept_id,
    'cme_reason', v_cme_reason,
    'questions', v_review_questions,
    -- Phase 3 (20260809000500): ADDITIVE keys — quiz-lane xp_earned above is
    -- unchanged; the bonus rides its own ledger lane.
    'unhinted_correct', v_unhinted_count,
    'unhinted_bonus_xp', v_unhinted_bonus
  );
END;
$$;

COMMENT ON FUNCTION public.submit_quiz_results_v2(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, UUID, INTEGER, INTEGER) IS
  'v2 server-shuffle quiz submission RPC. P1/P2/P3/P4 formulas unchanged. '
  'FIX 2026-07-29 (forensic audit F1/F7/F5): Anti-Cheat Check 3 counts served '
  'questions from quiz_session_shuffles; the daily XP cap is read back from '
  'the ledger and reflected in quiz_sessions.score + xp_earned/xp_capped. '
  'ADDITIVE 2026-08-05 (Foxy North-Star F8): per-response "hint_level". '
  'ADDITIVE 2026-08-07 (Phase 2 event capture): hint_level to '
  'update_learner_state_post_quiz; snapshot version/hash persisted; '
  'answer_method whitelisted; confidence regex-guarded; misconception match + '
  'error-isolated lifecycle. '
  'ADDITIVE 2026-08-09 (Phase 3): p_unhinted_xp/p_unhinted_cap params and the '
  'capped unhinted_mastery bonus lane. '
  'P0 FIX 2026-08-11 (20260814000022): WRITTEN (non-MCQ) responses no longer '
  'abort the submission. Each response is classified into an MCQ lane or a '
  'written lane from SERVER state only (the serve-time options_snapshot plus '
  'question_bank.question_type — the client cannot elect its lane). The '
  'session_not_started P0001 RAISE is preserved for MCQ responses with no '
  'snapshot row. Written correctness is derived from the AI rubric marks '
  '(marks_awarded >= marks_possible * 0.5 — the same rule the student was '
  'shown), regex-guarded and clamped, and the answer text + marks + rubric '
  'feedback are now persisted to the pre-existing quiz_responses columns. '
  'Before this fix ANY quiz containing at least one non-MCQ question could '
  'not be submitted at all: the RPC raised before any anti-cheat check, no '
  'quiz_sessions row was written and the student lost the whole attempt. '
  'ADDITIVE 2026-08-24 (20260824090000): quiz_responses.bloom_level is now '
  'populated from question_bank at INSERT time -- v_q_bloom was already in '
  'scope and passed to update_learner_state_post_quiz, but was omitted from '
  'the INSERT column list, so the Aug-2026 cohort had 0/45 responses stamped '
  'while the Apr-2026 cohort (older writer) had 390/390. Also: the '
  'learner-state write failure is no longer silent -- RAISE WARNING plus an '
  'error-isolated metadata-only row in public.learner_state_write_failures, '
  'including the previously implicit no-op topic_id IS NULL branch '
  '(failure_kind = topic_unresolvable). Telemetry is wrapped so it can never '
  'abort the submit (P4), and stores ids only, never text (P13). '
  'P1/P2/P3/P4/P5 formulas, the 11-param signature and the RETURN shape are '
  'byte-identical to 20260814000022.';

-- Re-pin the grant posture (idempotent; the signature is unchanged so the
-- existing grants survive CREATE OR REPLACE, but pin it explicitly per
-- 20260515000002 + 20260707020000).
REVOKE ALL ON FUNCTION public.submit_quiz_results_v2(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_quiz_results_v2(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, UUID, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_quiz_results_v2(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, UUID, INTEGER, INTEGER) TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Backfill quiz_responses.bloom_level from question_bank
-- ═════════════════════════════════════════════════════════════════════════════
-- question_id is populated on 435/435 production rows, so this repairs every
-- historical response the current writer left blank (Aug-2026 cohort: 0/45).
-- Idempotent: the qr.bloom_level IS NULL guard makes a re-run touch 0 rows.
UPDATE public.quiz_responses qr
   SET bloom_level = qb.bloom_level
  FROM public.question_bank qb
 WHERE qr.question_id = qb.id
   AND qr.bloom_level IS NULL
   AND qb.bloom_level IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. question_bank.topic_id becomes SELF-MAINTAINING (the durable fix)
-- ═════════════════════════════════════════════════════════════════════════════
-- The 2026-06-21 repair (20260621000500) was a one-shot anonymous DO block and it
-- regressed: 6,025 / 18,750 active questions are NULL again, because the admin
-- write path and both bulk drivers never derive topic_id. A trigger is the only
-- placement that a new writer cannot bypass.
--
-- SECURITY INVOKER (no privilege escalation — the trigger only derives a value
-- for a row the caller is already inserting into a table it can write) with
-- SET search_path = '' and fully-qualified object names, so no caller-controlled
-- search_path can redirect curriculum_topics / subjects.
--
-- P5: NEW.grade is TEXT and curriculum_topics.grade is TEXT. The comparison is
-- text = text; no integer comparison is introduced anywhere. The key is the
-- QUESTION's own grade, never a session grade.
CREATE OR REPLACE FUNCTION public.resolve_question_topic_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
BEGIN
  -- Only ever FILLS a NULL. An explicitly supplied topic_id is never
  -- overwritten, so a curator can always override the derivation.
  IF NEW.topic_id IS NULL
     AND NEW.subject IS NOT NULL
     AND NEW.grade IS NOT NULL
     AND NEW.chapter_number IS NOT NULL THEN
    SELECT ct.id
      INTO NEW.topic_id
      FROM public.curriculum_topics ct
      JOIN public.subjects s ON s.id = ct.subject_id
     WHERE s.code            = NEW.subject
       AND ct.grade          = NEW.grade          -- TEXT = TEXT (P5)
       AND ct.chapter_number = NEW.chapter_number
       AND ct.is_active      = true
     ORDER BY ct.display_order ASC, ct.id ASC     -- ct.id tiebreak => deterministic
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.resolve_question_topic_id() IS
  'BEFORE INSERT OR UPDATE trigger on question_bank: fills a NULL topic_id from '
  'curriculum_topics keyed on (subjects.code = NEW.subject, ct.grade = '
  'NEW.grade, ct.chapter_number = NEW.chapter_number, ct.is_active). Keys on the '
  'QUESTION''s own grade, never a session grade. Never overwrites a supplied '
  'topic_id. Added 20260824090000 because the one-shot 20260621000500 backfill '
  'regressed to 32.1% NULL — the admin content route and both bulk drivers '
  'never derived topic_id, so only a trigger holds. SECURITY INVOKER with '
  'search_path pinned to the empty string and fully-qualified names.';

DROP TRIGGER IF EXISTS trg_question_bank_resolve_topic_id ON public.question_bank;
CREATE TRIGGER trg_question_bank_resolve_topic_id
  BEFORE INSERT OR UPDATE OF subject, grade, chapter_number, topic_id
  ON public.question_bank
  FOR EACH ROW
  EXECUTE FUNCTION public.resolve_question_topic_id();

-- Narrow supporting index for the exact 3-key lookup the trigger performs on
-- every question_bank write. The baseline's idx_ct_sg covers (subject_id, grade)
-- WHERE is_active; this adds chapter_number so the probe is a single lookup.
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_subject_grade_chapter_active
  ON public.curriculum_topics (subject_id, grade, chapter_number)
  WHERE is_active = true;

-- Re-run the backfill for the rows the one-shot repair left behind. The EXISTS
-- guard means a row with no resolvable topic is NOT touched (no NULL -> NULL
-- churn), so once converged a re-run of this migration updates 0 rows.
-- 4,537 of the 6,025 NULLs are UNRESOLVABLE (no curriculum_topics rows exist for
-- those subjects at all) and will correctly remain NULL — surfacing those is
-- what section 1's telemetry is for, and 62.3% of the bank is unreachable by
-- students anyway (is_active=false AND absent from grade_subject_map).
UPDATE public.question_bank qb
   SET topic_id = (
     SELECT ct.id
       FROM public.curriculum_topics ct
       JOIN public.subjects s ON s.id = ct.subject_id
      WHERE s.code            = qb.subject
        AND ct.grade          = qb.grade
        AND ct.chapter_number = qb.chapter_number
        AND ct.is_active      = true
      ORDER BY ct.display_order ASC, ct.id ASC
      LIMIT 1
   )
 WHERE qb.topic_id       IS NULL
   AND qb.is_active       = true
   AND qb.chapter_number IS NOT NULL
   AND EXISTS (
     SELECT 1
       FROM public.curriculum_topics ct
       JOIN public.subjects s ON s.id = ct.subject_id
      WHERE s.code            = qb.subject
        AND ct.grade          = qb.grade
        AND ct.chapter_number = qb.chapter_number
        AND ct.is_active      = true
   );

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Ghost-column tombstone (explicitly NOT a drop)
-- ═════════════════════════════════════════════════════════════════════════════
-- concept_mastery.next_review_date is being repointed away from by a separate
-- change. It is deliberately NOT dropped here — dropping a column requires user
-- approval and a compensating migration plan. This comment is the tombstone so
-- the next reader does not re-adopt it.
DO $do$
BEGIN
  EXECUTE $c$COMMENT ON COLUMN public.concept_mastery.next_review_date IS
    'TOMBSTONE (2026-08-24): legacy/ghost column. Readers are being repointed '
    'off it; do not add new readers or writers. Deliberately NOT dropped — '
    'dropping a column needs user approval and a compensating migration plan.'$c$;
EXCEPTION
  WHEN undefined_column THEN NULL;
  WHEN undefined_table  THEN NULL;
END
$do$;

COMMIT;

-- End of migration: 20260824090000_quiz_bloom_capture_learner_state_failure_log_and_topic_id_trigger.sql
-- Tables touched:    learner_state_write_failures (NEW — RLS + policies here);
--                    quiz_responses (bloom_level backfill, no schema change);
--                    question_bank (topic_id backfill, no schema change)
-- Functions touched: submit_quiz_results_v2 (CREATE OR REPLACE, same signature),
--                    resolve_question_topic_id (NEW)
-- Triggers touched:  trg_question_bank_resolve_topic_id (NEW)
-- RLS touched:       learner_state_write_failures only (enabled + 2 policies)
