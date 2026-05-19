-- Migration: 20260520000008_mock_test_attempts.sql
-- Author:    architect
-- Purpose:   PR-6 of the JEE/NEET/Olympiad scaling roadmap. Installs the
--            persistence + scoring loop for the mock-test runner. Without
--            this migration, every student attempt at /exams/mock evaporates
--            on reload because the UI persists only to localStorage.
--
-- Predecessors: 20260520000004 (PR-1 PYQ cols), 20260520000005 (PR-2
-- exam_papers + FK), 20260520000006 (PR-5 seed), 20260520000007 (PR-7
-- ff_competitive_exams_v1 substrate, default OFF). Closes the loop:
--   (a) Persist attempt header (mock_test_attempts) for analytics
--   (b) Persist per-question responses (mock_test_responses)
--   (c) Increment IRT counters on question_bank (times_shown/correct/wrong,
--       irt_response_count, last_served_at) so the nightly calibration cron
--       at /api/cron/irt-calibrate (02:50 UTC, REG-44) can recalibrate
--       (irt_a, irt_b). This RPC NEVER mutates irt_a/irt_b — cron's job.
--   (d) Award P2-conformant bracketed XP
--
-- The whole submission runs as a single SECURITY DEFINER plpgsql RPC
-- `submit_mock_test_attempt` — one atomic transaction (P4). Mirrors the
-- `atomic_quiz_profile_update` pattern. Creates: 2 tables, 5 indexes,
-- 1 trigger, 8 RLS policies, 1 RPC.
--
-- Does NOT: mutate irt_a/irt_b; touch student_learning_profiles or
-- students.xp_total (mock-test XP lives on the attempt row until a follow-
-- up PR plumbs it through atomic_quiz_profile_update once multi-subject
-- "subject" mapping is solved); touch quiz_sessions / quiz_responses; alter
-- ff_competitive_exams_v1 (API enforces the flag — P11 defense-in-depth).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; constraints + policies guarded
-- by pg_constraint / pg_policy; CREATE INDEX IF NOT EXISTS; CREATE OR
-- REPLACE FUNCTION; verification block is read-only.
--
-- Reviewers per P14: assessment (XP brackets ↔ xp-config.ts), backend
-- (API route /api/exams/mock/submit), testing (E2E + IRT counter
-- assertion), frontend (results screen reads RPC jsonb).
--
-- Rollback (manual, DROP requires user approval per CLAUDE.md):
--   DROP FUNCTION public.submit_mock_test_attempt(uuid,uuid,jsonb,integer,jsonb);
--   DROP TABLE public.mock_test_responses; DROP TABLE public.mock_test_attempts;
--   DROP FUNCTION public.mock_test_attempts_set_updated_at();
-- IRT counter increments are NOT reversed (statistical evidence).

BEGIN;

-- ============================================================================
-- 1. public.mock_test_attempts — header row per submitted attempt
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mock_test_attempts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exam_paper_id        uuid NOT NULL REFERENCES public.exam_papers(id) ON DELETE CASCADE,
  started_at           timestamptz NOT NULL DEFAULT now(),
  submitted_at         timestamptz,
  status               text NOT NULL DEFAULT 'in_progress',
  time_taken_seconds   integer,
  total_questions      integer NOT NULL,
  attempted_count      integer NOT NULL DEFAULT 0,
  correct_count        integer NOT NULL DEFAULT 0,
  wrong_count          integer NOT NULL DEFAULT 0,
  skipped_count        integer NOT NULL DEFAULT 0,
  raw_score            numeric(8,2) NOT NULL DEFAULT 0,
  max_score            numeric(8,2) NOT NULL,
  score_percent        numeric(5,2) NOT NULL DEFAULT 0,
  xp_earned            integer NOT NULL DEFAULT 0,
  client_metadata      jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ── 1a. mock_test_attempts CHECK constraints (one DO block per constraint) ──

DO $mta_constraints$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('chk_mta_status',
         'CHECK (status = ANY (ARRAY[''in_progress''::text, ''submitted''::text, ''abandoned''::text, ''expired''::text]))'),
      ('chk_mta_time_taken_positive',
         'CHECK (time_taken_seconds IS NULL OR time_taken_seconds > 0)'),
      ('chk_mta_score_bounds',
         'CHECK (score_percent >= 0 AND score_percent <= 100)'),
      ('chk_mta_count_consistency',
         'CHECK (attempted_count = correct_count + wrong_count AND attempted_count + skipped_count = total_questions)'),
      ('chk_mta_status_transition',
         'CHECK (status <> ''submitted'' OR submitted_at IS NOT NULL)')
    ) AS t(conname, defn)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
       WHERE c.conname = rec.conname
         AND t.relname = 'mock_test_attempts'
         AND t.relnamespace = 'public'::regnamespace
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.mock_test_attempts ADD CONSTRAINT %I %s',
        rec.conname, rec.defn
      );
    END IF;
  END LOOP;
END $mta_constraints$;

-- ============================================================================
-- 2. public.mock_test_responses — one row per (attempt, question)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mock_test_responses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id           uuid NOT NULL REFERENCES public.mock_test_attempts(id) ON DELETE CASCADE,
  question_id          uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  question_number      integer NOT NULL,
  response_index       integer,
  is_correct           boolean,
  marks_awarded        numeric(5,2) NOT NULL DEFAULT 0,
  time_taken_seconds   integer,
  marked_for_review    boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ── 2a. mock_test_responses constraints (CHECK + UNIQUE) ───────────────────

DO $mtr_constraints$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('chk_mtr_response_index',
         'CHECK (response_index IS NULL OR (response_index >= 0 AND response_index <= 3))'),
      ('chk_mtr_question_number_positive',
         'CHECK (question_number >= 1)'),
      ('chk_mtr_time_taken_positive',
         'CHECK (time_taken_seconds IS NULL OR time_taken_seconds > 0)'),
      ('uq_mtr_attempt_question',
         'UNIQUE (attempt_id, question_id)')
    ) AS t(conname, defn)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
       WHERE c.conname = rec.conname
         AND t.relname = 'mock_test_responses'
         AND t.relnamespace = 'public'::regnamespace
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.mock_test_responses ADD CONSTRAINT %I %s',
        rec.conname, rec.defn
      );
    END IF;
  END LOOP;
END $mtr_constraints$;

-- ============================================================================
-- 3. Indexes
-- ============================================================================
-- idx_mta_student_id: "my history, recent first"; NULLS LAST so in-progress
--   rows sink to the bottom.
-- idx_mta_paper_id: partial WHERE status='submitted' for percentile /
--   leaderboard.
-- idx_mta_status: partial WHERE status='in_progress' for stale-attempt
--   sweepers.
-- idx_mtr_attempt_id: review-screen fan-out.
-- idx_mtr_question_id: per-question IRT aggregation + curator drill-down.

CREATE INDEX IF NOT EXISTS idx_mta_student_id
  ON public.mock_test_attempts (student_id, submitted_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_mta_paper_id
  ON public.mock_test_attempts (exam_paper_id)
  WHERE status = 'submitted';

CREATE INDEX IF NOT EXISTS idx_mta_status
  ON public.mock_test_attempts (status)
  WHERE status = 'in_progress';

CREATE INDEX IF NOT EXISTS idx_mtr_attempt_id
  ON public.mock_test_responses (attempt_id);

CREATE INDEX IF NOT EXISTS idx_mtr_question_id
  ON public.mock_test_responses (question_id);

-- ============================================================================
-- 4. updated_at trigger on mock_test_attempts
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mock_test_attempts_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mta_set_updated_at ON public.mock_test_attempts;
CREATE TRIGGER trg_mta_set_updated_at
  BEFORE UPDATE ON public.mock_test_attempts
  FOR EACH ROW EXECUTE FUNCTION public.mock_test_attempts_set_updated_at();

-- ============================================================================
-- 5. Row Level Security
-- ============================================================================
-- Both tables: student SELECT/INSERT/UPDATE own; admin/super_admin FOR ALL;
-- service_role bypasses RLS automatically. Responses gate via JOIN through
-- mock_test_attempts so forged attempt_ids cannot leak.
-- Students cannot DELETE — admins can via admin_all FOR ALL.

ALTER TABLE public.mock_test_attempts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_test_responses ENABLE ROW LEVEL SECURITY;

DO $policies$
DECLARE
  v_admin_pred text := 'EXISTS (SELECT 1 FROM public.admin_users au '
                   || 'WHERE au.auth_user_id = auth.uid() '
                   || 'AND au.is_active = true '
                   || 'AND au.admin_level IN (''admin'', ''super_admin''))';
  v_resp_own  text := 'attempt_id IN (SELECT id FROM public.mock_test_attempts '
                   || 'WHERE student_id = auth.uid())';
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      -- table, policy name, command, using-clause, with-check-clause (NULL if same)
      ('mock_test_attempts',  'mock_test_attempts_select_own',
         'FOR SELECT TO authenticated',
         'USING (student_id = auth.uid())'),
      ('mock_test_attempts',  'mock_test_attempts_insert_own',
         'FOR INSERT TO authenticated',
         'WITH CHECK (student_id = auth.uid())'),
      ('mock_test_attempts',  'mock_test_attempts_update_own',
         'FOR UPDATE TO authenticated',
         'USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid())'),
      ('mock_test_attempts',  'mock_test_attempts_admin_all',
         'FOR ALL TO authenticated',
         'USING (' || v_admin_pred || ') WITH CHECK (' || v_admin_pred || ')'),
      ('mock_test_responses', 'mock_test_responses_select_own',
         'FOR SELECT TO authenticated',
         'USING (' || v_resp_own || ')'),
      ('mock_test_responses', 'mock_test_responses_insert_own',
         'FOR INSERT TO authenticated',
         'WITH CHECK (' || v_resp_own || ')'),
      ('mock_test_responses', 'mock_test_responses_update_own',
         'FOR UPDATE TO authenticated',
         'USING (' || v_resp_own || ') WITH CHECK (' || v_resp_own || ')'),
      ('mock_test_responses', 'mock_test_responses_admin_all',
         'FOR ALL TO authenticated',
         'USING (' || v_admin_pred || ') WITH CHECK (' || v_admin_pred || ')')
    ) AS t(tbl, polname, cmd, clauses)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
       WHERE p.polname = rec.polname
         AND c.relname = rec.tbl
         AND c.relnamespace = 'public'::regnamespace
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I %s %s',
        rec.polname, rec.tbl, rec.cmd, rec.clauses
      );
    END IF;
  END LOOP;
END $policies$;

-- ============================================================================
-- 6. Grants (RLS still gates per row; grants merely permit policy evaluation)
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON public.mock_test_attempts  TO authenticated;
GRANT SELECT, INSERT         ON public.mock_test_responses TO authenticated;

-- ============================================================================
-- 7. RPC public.submit_mock_test_attempt — atomic submission loop
-- ============================================================================
-- Steps (single plpgsql transaction):
--   (a) Authz: caller = p_student_id OR role='service_role' OR active admin
--   (b) Load paper; reject if inactive
--   (c) v_max_score = SUM(question_bank.marks_correct) for paper, falling
--       back to total_q * (marking_scheme->>'correct')::numeric or 4.00
--   (d) INSERT attempt header (status='submitted')
--   (e) For each response: resolve question (scoped to paper), compute
--       is_correct + marks_awarded, INSERT response row, UPDATE
--       question_bank IRT counters (NEVER irt_a/irt_b — cron's job REG-44)
--   (f) UPDATE attempt with aggregates + bracketed XP
--   (g) Return jsonb result
--
-- XP brackets (lockstep with src/lib/xp-config.ts — assessment owns
-- regression test pairing both): 0-39→10, 40-69→30, 70-89→60, 90-100→100.

CREATE OR REPLACE FUNCTION public.submit_mock_test_attempt(
  p_student_id          uuid,
  p_paper_id            uuid,
  p_responses           jsonb,
  p_time_taken_seconds  integer,
  p_client_metadata     jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid        uuid       := auth.uid();
  v_caller_role       text       := COALESCE(auth.jwt() ->> 'role', '');
  v_is_admin          boolean    := false;
  v_paper             record;
  v_default_correct   numeric    := 4.00;
  v_max_score         numeric(8,2);
  v_attempt_id        uuid;
  v_total_q           integer;
  v_attempted         integer    := 0;
  v_correct           integer    := 0;
  v_wrong             integer    := 0;
  v_skipped           integer    := 0;
  v_raw_score         numeric(8,2) := 0;
  v_score_percent     numeric(5,2) := 0;
  v_xp_earned         integer    := 0;
  v_submitted_at      timestamptz := now();
  v_elem              jsonb;
  v_q_id              uuid;
  v_q                 record;
  v_resp_idx          integer;
  v_is_correct        boolean;
  v_marks_awarded     numeric(5,2);
  v_q_time            integer;
  v_marked_for_review boolean;
  v_q_number          integer    := 0;
  v_inserted_id       uuid;
BEGIN
  -- (a) Authorization
  IF v_caller_role <> 'service_role' THEN
    IF v_caller_uid IS NULL THEN
      RAISE EXCEPTION 'submit_mock_test_attempt: not authenticated' USING ERRCODE = '42501';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.admin_users au
       WHERE au.auth_user_id = v_caller_uid
         AND au.is_active = true
         AND au.admin_level IN ('admin', 'super_admin')
    ) INTO v_is_admin;
    IF v_caller_uid <> p_student_id AND NOT v_is_admin THEN
      RAISE EXCEPTION 'submit_mock_test_attempt: caller % may not submit for student %',
        v_caller_uid, p_student_id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- (b) Load paper
  SELECT id, total_questions, marking_scheme INTO v_paper
    FROM public.exam_papers WHERE id = p_paper_id AND is_active = true;
  IF v_paper.id IS NULL THEN
    RAISE EXCEPTION 'submit_mock_test_attempt: exam_paper % not found or inactive', p_paper_id
      USING ERRCODE = '22023';
  END IF;
  v_total_q := COALESCE(v_paper.total_questions, 0);
  IF v_total_q <= 0 THEN
    RAISE EXCEPTION 'submit_mock_test_attempt: exam_paper % invalid total_questions=%', p_paper_id, v_total_q
      USING ERRCODE = '22023';
  END IF;

  -- (c) v_max_score: SUM(marks_correct), fallback total_q * scheme.correct or 4.00
  SELECT COALESCE(SUM(COALESCE(qb.marks_correct, 0)), 0) INTO v_max_score
    FROM public.question_bank qb WHERE qb.exam_paper_id = p_paper_id;
  IF v_max_score IS NULL OR v_max_score <= 0 THEN
    v_max_score := (v_total_q::numeric)
                 * COALESCE(NULLIF(v_paper.marking_scheme ->> 'correct', '')::numeric,
                            v_default_correct);
  END IF;

  -- (d) INSERT attempt header. Counters are placeholders; step (f) sets finals.
  INSERT INTO public.mock_test_attempts (
    student_id, exam_paper_id, started_at, submitted_at, status,
    time_taken_seconds, total_questions, attempted_count, correct_count,
    wrong_count, skipped_count, raw_score, max_score, score_percent,
    xp_earned, client_metadata
  ) VALUES (
    p_student_id, p_paper_id,
    v_submitted_at - make_interval(secs => COALESCE(p_time_taken_seconds, 0)),
    v_submitted_at, 'submitted',
    p_time_taken_seconds, v_total_q, 0, 0,
    0, v_total_q, 0, v_max_score, 0,
    0, p_client_metadata
  )
  RETURNING id INTO v_attempt_id;

  -- (e) Fan out responses + IRT counter updates
  IF p_responses IS NOT NULL AND jsonb_typeof(p_responses) = 'array' THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_responses)
    LOOP
      v_q_id := NULLIF(v_elem ->> 'question_id', '')::uuid;
      IF v_q_id IS NULL THEN
        CONTINUE;   -- defensive: skip malformed row
      END IF;

      -- Scope to this paper. Mismatched paper = skip silently (UI bug; the
      -- client_metadata audit trail supports investigation).
      SELECT id, correct_answer_index, marks_correct, marks_wrong
        INTO v_q
        FROM public.question_bank
       WHERE id = v_q_id
         AND exam_paper_id = p_paper_id;

      IF v_q.id IS NULL THEN
        CONTINUE;
      END IF;

      v_resp_idx := NULLIF(v_elem ->> 'response_index', '')::integer;
      v_q_time   := NULLIF(v_elem ->> 'time_taken_seconds', '')::integer;
      v_marked_for_review := COALESCE((v_elem ->> 'marked_for_review')::boolean, false);

      IF v_resp_idx IS NULL THEN
        v_is_correct := NULL;
        v_marks_awarded := 0;
      ELSIF v_q.correct_answer_index IS NOT NULL
            AND v_resp_idx = v_q.correct_answer_index THEN
        v_is_correct := true;
        v_marks_awarded := COALESCE(v_q.marks_correct, 1.00);
      ELSE
        v_is_correct := false;
        v_marks_awarded := COALESCE(v_q.marks_wrong, 0.00);
      END IF;

      -- INSERT first; only on a new row do we bump counters + IRT stats.
      -- The (attempt_id,question_id) UNIQUE catches duplicate payload entries
      -- (e.g. retried submit) so counters stay consistent with the persisted
      -- responses and the chk_mta_count_consistency CHECK holds in step (f).
      v_inserted_id := NULL;
      INSERT INTO public.mock_test_responses (
        attempt_id, question_id, question_number, response_index,
        is_correct, marks_awarded, time_taken_seconds, marked_for_review
      ) VALUES (
        v_attempt_id, v_q_id, v_q_number + 1, v_resp_idx,
        v_is_correct, v_marks_awarded, v_q_time, v_marked_for_review
      )
      ON CONFLICT (attempt_id, question_id) DO NOTHING
      RETURNING id INTO v_inserted_id;

      IF v_inserted_id IS NULL THEN
        CONTINUE;   -- duplicate question in payload — skip counter mutation
      END IF;

      v_q_number := v_q_number + 1;
      v_raw_score := v_raw_score + v_marks_awarded;
      IF v_is_correct IS TRUE THEN
        v_correct := v_correct + 1;  v_attempted := v_attempted + 1;
      ELSIF v_is_correct IS FALSE THEN
        v_wrong := v_wrong + 1;      v_attempted := v_attempted + 1;
      END IF;

      -- IRT counters: NEVER irt_a or irt_b (cron's job, REG-44).
      UPDATE public.question_bank qb
         SET times_shown        = COALESCE(qb.times_shown, 0) + 1,
             times_correct      = COALESCE(qb.times_correct, 0)
                                + CASE WHEN v_is_correct IS TRUE THEN 1 ELSE 0 END,
             times_wrong        = COALESCE(qb.times_wrong, 0)
                                + CASE WHEN v_is_correct IS FALSE THEN 1 ELSE 0 END,
             irt_response_count = COALESCE(qb.irt_response_count, 0) + 1,
             last_served_at     = now()
       WHERE qb.id = v_q_id;
    END LOOP;
  END IF;

  -- (f) Aggregate UPDATE; clamp score_percent to [0,100]; bracket XP.
  -- If v_attempted exceeds the snapshot (drift: question_bank rows > paper.total_questions),
  -- widen v_total_q to match so chk_mta_count_consistency holds.
  IF v_attempted > v_total_q THEN
    v_total_q := v_attempted;
  END IF;
  v_skipped := GREATEST(0, v_total_q - v_attempted);

  IF v_max_score > 0 THEN
    v_score_percent := LEAST(100, GREATEST(0, ROUND((v_raw_score / v_max_score) * 100, 2)));
  ELSE
    v_score_percent := 0;
  END IF;

  v_xp_earned := CASE
    WHEN v_score_percent >= 90 THEN 100
    WHEN v_score_percent >= 70 THEN 60
    WHEN v_score_percent >= 40 THEN 30
    ELSE 10
  END;

  UPDATE public.mock_test_attempts
     SET total_questions = v_total_q,
         attempted_count = v_attempted,
         correct_count   = v_correct,
         wrong_count     = v_wrong,
         skipped_count   = v_skipped,
         raw_score       = v_raw_score,
         score_percent   = v_score_percent,
         xp_earned       = v_xp_earned
   WHERE id = v_attempt_id;

  -- (g) Return result
  RETURN jsonb_build_object(
    'attempt_id',         v_attempt_id,
    'paper_id',           p_paper_id,
    'total_questions',    v_total_q,
    'attempted_count',    v_attempted,
    'correct_count',      v_correct,
    'wrong_count',        v_wrong,
    'skipped_count',      v_skipped,
    'raw_score',          v_raw_score,
    'max_score',          v_max_score,
    'score_percent',      v_score_percent,
    'xp_earned',          v_xp_earned,
    'submitted_at',       v_submitted_at,
    'time_taken_seconds', p_time_taken_seconds
  );
END;
$$;

COMMENT ON FUNCTION public.submit_mock_test_attempt(uuid, uuid, jsonb, integer, jsonb) IS
  'PR-6 (2026-05-20): atomic mock-test submission RPC. Persists attempt + responses, increments question_bank IRT counters (times_shown/correct/wrong/irt_response_count/last_served_at — NEVER irt_a/irt_b), awards bracketed XP (sync with src/lib/xp-config.ts). SECURITY DEFINER: caller must equal p_student_id OR be service_role OR be active admin_users (admin/super_admin). Single atomic transaction (P4). API route /api/exams/mock/submit enforces ff_competitive_exams_v1 flag (P11 defense-in-depth).';

GRANT EXECUTE ON FUNCTION public.submit_mock_test_attempt(uuid, uuid, jsonb, integer, jsonb)
  TO authenticated, service_role;

-- ============================================================================
-- 8. Table + column comments (selected, non-obvious)
-- ============================================================================

COMMENT ON TABLE public.mock_test_attempts IS
  'PR-6 (2026-05-20): header row per mock-test attempt. Persisted by submit_mock_test_attempt RPC. RLS: student own + admin FOR ALL.';
COMMENT ON TABLE public.mock_test_responses IS
  'PR-6 (2026-05-20): per-question response within a mock-test attempt. UNIQUE(attempt_id, question_id).';
COMMENT ON COLUMN public.mock_test_attempts.max_score IS
  'Sum of question_bank.marks_correct for the paper, or total_q * marking_scheme.correct (default 4.00) fallback. Captured at submit time.';
COMMENT ON COLUMN public.mock_test_attempts.xp_earned IS
  'Bracketed XP: 0-39→10, 40-69→30, 70-89→60, 90-100→100. Must stay in sync with src/lib/xp-config.ts.';
COMMENT ON COLUMN public.mock_test_attempts.client_metadata IS
  'Opaque jsonb for non-PII diagnostics. MUST NOT contain student-identifying data (P13).';
COMMENT ON COLUMN public.mock_test_responses.response_index IS
  '0..3 for an answered MCQ, NULL for skipped (chk_mtr_response_index).';
COMMENT ON COLUMN public.mock_test_responses.marks_awarded IS
  '0 for skipped; question_bank.marks_correct for correct; marks_wrong for wrong (negative for JEE/NEET).';

-- ============================================================================
-- 9. Verification block — read-only sanity checks
-- ============================================================================

DO $verify$
DECLARE
  v_mta_exists boolean; v_mtr_exists boolean; v_rpc_args_count integer;
  v_mta_rls boolean; v_mtr_rls boolean; v_policies integer;
  v_indexes integer; v_trigger_present boolean; v_all_ok boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='mock_test_attempts') INTO v_mta_exists;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='mock_test_responses') INTO v_mtr_exists;
  SELECT COALESCE(MAX(pronargs),0) INTO v_rpc_args_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='submit_mock_test_attempt';
  SELECT c.relrowsecurity INTO v_mta_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='mock_test_attempts';
  SELECT c.relrowsecurity INTO v_mtr_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='mock_test_responses';
  SELECT COUNT(*) INTO v_policies FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   WHERE c.relnamespace='public'::regnamespace
     AND c.relname IN ('mock_test_attempts','mock_test_responses');
  SELECT COUNT(*) INTO v_indexes FROM pg_indexes WHERE schemaname='public'
     AND indexname IN ('idx_mta_student_id','idx_mta_paper_id','idx_mta_status',
                       'idx_mtr_attempt_id','idx_mtr_question_id');
  SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_mta_set_updated_at'
       AND tgrelid='public.mock_test_attempts'::regclass) INTO v_trigger_present;

  RAISE NOTICE '[pr6] attempts=% responses=% rpc_args=% (expect 5) rls=%,% policies=% (expect 8) indexes=% (expect 5) trigger=%',
    v_mta_exists, v_mtr_exists, v_rpc_args_count, v_mta_rls, v_mtr_rls,
    v_policies, v_indexes, v_trigger_present;

  IF v_rpc_args_count <> 5 THEN
    RAISE WARNING '[pr6] submit_mock_test_attempt arg count = % (expected 5)', v_rpc_args_count;
  END IF;
  IF v_policies <> 8 THEN
    RAISE WARNING '[pr6] policy count = % (expected 8)', v_policies;
  END IF;
  IF v_indexes <> 5 THEN
    RAISE WARNING '[pr6] index count = % (expected 5)', v_indexes;
  END IF;

  v_all_ok := v_mta_exists AND v_mtr_exists AND v_rpc_args_count = 5
          AND COALESCE(v_mta_rls,false) AND COALESCE(v_mtr_rls,false)
          AND v_policies = 8 AND v_indexes = 5 AND v_trigger_present;

  IF NOT v_all_ok THEN
    RAISE WARNING '[pr6] migration did NOT land cleanly — see flags above';
  ELSE
    RAISE NOTICE 'PR-6 MIGRATION COMPLETE — mock-test submission loop installed';
  END IF;
END $verify$;

COMMIT;
