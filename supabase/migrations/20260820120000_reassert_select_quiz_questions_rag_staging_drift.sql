-- Migration: 20260820120000_reassert_select_quiz_questions_rag_staging_drift.sql
-- Purpose: Defensive re-assertion (NOT a logic change) of
--   public.select_quiz_questions_rag, to close a HYPOTHESIS-driven gap in
--   `ci.yml`'s `Integration Tests (live DB)` job.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  CONTEXT
-- ═══════════════════════════════════════════════════════════════════════════
-- Since before commit cb0e9a1 (a docs-only PR) and confirmed again on
-- 218977f3 and ac0f225, every push to `main` fails 3 assertions in
-- `apps/host/src/__tests__/migrations/select-quiz-questions-rag-verification-
-- gate.test.ts` (AC-1/AC-2/AC-3 — each does `expect(rows.length).toBe(N)` and
-- observes 0). PR #1581 (already on `main` as of `ac0f225`) folded the
-- `integration-tests` job into the same `staging-db-push` concurrency group
-- as this repo's other staging-DB writers (`sync-staging-migrations.yml`,
-- `deploy-staging.yml`'s `migrations` job) to close an evidenced
-- overlapping-execution race (see `ci.yml`'s `integration-tests` job comment,
-- "2026-08-20: group renamed..."). A fresh CI run after that merge showed the
-- SAME 3 failures, so cross-workflow overlap is not the whole story.
--
-- Independent review of the `select_quiz_questions_rag` function body in
-- `20260814000014_tiered_verification_serving_and_truthful_picker.sql`
-- (lines 411-673) against the failing test's fixtures found the SQL
-- predicate logic internally consistent and expected to match the seeded
-- rows. RLS is ruled out (`question_bank` has a fully permissive
-- `questions_read_all ... USING (true)` policy). A stale/unconditional
-- ownership guard (the documented 2026-08-02 staging-sync incident, see that
-- test file's own header) is also ruled out: the suite's own
-- `verificationGateOwnershipSkipIsLive()` capability probe would catch and
-- skip that case via an "Access denied" error, and it is not triggering — we
-- observe real assertion failures (0 rows), not a probe-driven skip.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  HYPOTHESIS (stated plainly so it is falsifiable)
-- ═══════════════════════════════════════════════════════════════════════════
-- The live STAGING definition of select_quiz_questions_rag may not actually
-- match 20260814000014's source, despite the migration ledger
-- (supabase_migrations.schema_migrations) reporting that file as applied —
-- e.g. a partial apply, an out-of-band hotfix, or a sync that ran against an
-- intermediate commit. This sandbox has no staging DB credentials and no
-- Actions-dispatch access, so this cannot be confirmed directly here.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WHAT THIS MIGRATION DOES (and does not do)
-- ═══════════════════════════════════════════════════════════════════════════
-- Re-issues `CREATE OR REPLACE FUNCTION public.select_quiz_questions_rag`
-- with a body copied VERBATIM (byte-for-byte, including its own comments)
-- from 20260814000014 lines 411-684 — no behavior change, no "while I'm in
-- here" cleanup. Whatever staging is currently running for this function,
-- after this migration applies it will be running exactly what this source
-- tree says it should. Also re-issues the existing
-- `REVOKE EXECUTE ... FROM anon` grant statement from
-- `20260515000002_security_hardening_secdef_anon_searchpath_rls_view.sql:219`
-- verbatim, so this re-assertion covers the full grant posture, not just the
-- function body.
--
-- If the hypothesis above is correct, this fixes the observed failure
-- outright. If it is wrong (e.g. staging genuinely IS running this exact
-- definition and something else is going on), this is a safe no-op —
-- CREATE OR REPLACE against an identical definition changes nothing — and
-- the real problem is still open.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  IMPORTANT CAVEAT ON INTERPRETING THE NEXT CI RUN (found during this fix,
--  not previously documented)
-- ═══════════════════════════════════════════════════════════════════════════
-- This migration touches `supabase/migrations/**`, so merging it to `main`
-- triggers BOTH `sync-staging-migrations.yml` (push path-filtered on that
-- path) AND `ci.yml` in full (its `push` trigger has no path filter) on the
-- SAME commit. Both now share the `staging-db-push` concurrency group, which
-- guarantees mutual EXCLUSION but not ORDERING: whichever job's job/workflow
-- claims the group first runs first. `sync-staging-migrations.yml` has a
-- shorter setup (checkout + Supabase CLI only) than `integration-tests`
-- (checkout + full node workspace setup), so it will likely, but is not
-- guaranteed to, win the race and apply this migration before the
-- integration-tests job queries staging. If `integration-tests` wins the
-- race instead, the very next push-triggered run could still show the same
-- 3 failures even if this migration's hypothesis is entirely correct — that
-- outcome would be a race-ordering artifact, not proof the hypothesis is
-- wrong. See this PR's description for how to check which job actually ran
-- first before drawing a conclusion from a single run.
--
-- Idempotent: CREATE OR REPLACE (function) + REVOKE (grant, safe to repeat).
-- No table, column, or index is created, dropped, or altered. No RLS surface
-- changes (P8: nothing new to police — pre-existing SECURITY DEFINER RPC,
-- grants preserved verbatim). SECURITY DEFINER justification is unchanged
-- from 20260814000014/20260802100000: this function reads question_bank
-- across the full catalog regardless of caller RLS visibility, by design.

BEGIN;

CREATE OR REPLACE FUNCTION public.select_quiz_questions_rag(
  p_student_id uuid,
  p_subject text,
  p_grade text,
  p_chapter_number integer DEFAULT NULL,
  p_count integer DEFAULT 10,
  p_difficulty_mode text DEFAULT 'mixed',
  p_question_types text[] DEFAULT ARRAY['mcq']::text[],
  p_query_embedding vector DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_pool   INTEGER;
  v_seen_count   INTEGER;
  v_result       JSONB;
  MIN_POOL_FOR_RESET CONSTANT INTEGER := 10;
  -- ── Verification-gate ladder state (spec §2.2/§2.3/§3) ──────────────────
  v_pair_enforced  BOOLEAN := false;
  v_verified_pool  INTEGER := 0;
  v_use_strict     BOOLEAN := false;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- ── Pool-count query. Tier-0 (spec §2.1) added: deleted_at IS NULL,
  -- content_status = 'published', verification_state != 'failed'. Applied
  -- here identically to the seen-count, reset/delete, and candidate_pool
  -- blocks below (AC-7) so this count never disagrees with what
  -- candidate_pool can actually return.
  SELECT COUNT(*) INTO v_total_pool
  FROM question_bank qb
  WHERE qb.subject = p_subject
    AND qb.grade = p_grade
    AND qb.is_active = true
    AND qb.deleted_at IS NULL
    AND qb.content_status = 'published'
    AND qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
    AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
    AND (
      qb.question_type_v2 = ANY(p_question_types)
      OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
    );

  IF v_total_pool = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COUNT(*) INTO v_seen_count
  FROM user_question_history h
  WHERE h.student_id = p_student_id
    AND h.subject = p_subject
    AND h.grade = p_grade
    AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
    AND h.question_id IN (
      SELECT qb.id FROM question_bank qb
      WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
        AND qb.deleted_at IS NULL
        AND qb.content_status = 'published'
        AND qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
        AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
        AND (
          qb.question_type_v2 = ANY(p_question_types)
          OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
        )
    );

  -- 80% pool reset — guarded by minimum pool size to prevent infinite cycle on
  -- thin chapters (< 10 questions would reset on every call at 100% seen).
  -- (REG-172, unrelated to this fix, unchanged; Tier-0-consistent v_total_pool
  -- above is what keeps this heuristic sound after this migration.)
  IF v_total_pool >= MIN_POOL_FOR_RESET AND v_seen_count::REAL / v_total_pool >= 0.80 THEN
    DELETE FROM user_question_history h
    WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade
      AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
      AND h.question_id IN (
        SELECT qb.id FROM question_bank qb
        WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
          AND qb.deleted_at IS NULL
          AND qb.content_status = 'published'
          AND qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
          AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
          AND (
            qb.question_type_v2 = ANY(p_question_types)
            OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
          )
      );
    v_seen_count := 0;
  END IF;

  -- ── §2.2/§2.3: enforced-pairs lookup + local-thinness fallback ladder ───
  -- One cheap composite-PK (grade, subject_code) lookup. Deliberately SHORT-
  -- CIRCUITED: the verified-pool count query below only runs when the pair
  -- is enforced. For the ~100% of (grade, subject) pairs that are NOT
  -- enforced today, v_use_strict is false regardless of pool size and no
  -- telemetry fires (spec AC-3), so skipping the extra count query there is
  -- a pure performance win with zero observable behavior difference from
  -- computing it unconditionally.
  SELECT EXISTS (
    SELECT 1 FROM ff_grounded_ai_enforced_pairs
    WHERE grade = p_grade AND subject_code = p_subject AND enabled = true
  ) INTO v_pair_enforced;

  IF v_pair_enforced THEN
    -- Verified-pool count for the EXACT requested slice — same subject/
    -- grade/is_active/chapter/type/difficulty scoping as candidate_pool
    -- below (spec §2.3: the pair-level 90% aggregate can mask a
    -- locally-thin chapter/difficulty slice). verification_state='verified'
    -- is strictly narrower than != 'failed', so Tier-0's failed-exclusion is
    -- already implied here and not repeated separately.
    SELECT COUNT(*) INTO v_verified_pool
    FROM question_bank qb
    WHERE qb.subject = p_subject
      AND qb.grade = p_grade
      AND qb.is_active = true
      AND qb.deleted_at IS NULL
      AND qb.content_status = 'published'
      AND qb.verification_state = 'verified'
      AND qb.verified_against_ncert = true
      AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
      AND (
        qb.question_type_v2 = ANY(p_question_types)
        OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
      )
      AND (
        p_difficulty_mode = 'mixed' OR p_difficulty_mode = 'progressive'
        OR (p_difficulty_mode = 'easy' AND qb.difficulty = 1)
        OR (p_difficulty_mode = 'medium' AND qb.difficulty = 2)
        OR (p_difficulty_mode = 'hard' AND qb.difficulty = 3)
      );
  END IF;

  -- Rung E0 (strict) iff the pair is enforced AND the verified pool for this
  -- exact slice already meets the requested count (spec §3.1, inclusive >=).
  v_use_strict := v_pair_enforced AND v_verified_pool >= p_count;

  -- Telemetry (spec §3.5): fires ONLY for the enforced-but-locally-thin case
  -- (Rung E1 reached because of thinness), never for the unenforced-default
  -- case (AC-3 — that path is expected, not a gap). Fail-open: a telemetry
  -- failure must never break question serving, matching the established
  -- pattern in submit_quiz_results_v2 (20260702150000 / 20260707010000).
  IF v_pair_enforced AND v_verified_pool < p_count THEN
    BEGIN
      INSERT INTO ops_events (
        occurred_at, category, source, severity,
        subject_type, subject_id, message, context, environment
      ) VALUES (
        NOW(),
        'grounding.quiz_serving',
        'select_quiz_questions_rag',
        'warning',
        'quiz_verification_pair', p_grade || '::' || p_subject,
        'quiz_verification_gap',
        jsonb_build_object(
          'grade', p_grade,
          'subject', p_subject,
          'chapter_number', p_chapter_number,
          'difficulty_mode', p_difficulty_mode,
          'question_types', p_question_types,
          'verified_pool_count', v_verified_pool,
          'requested_count', p_count
        ),
        COALESCE(current_setting('app.environment', true), 'production')
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  WITH seen_ids AS (
    SELECT h.question_id FROM user_question_history h
    WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade
      AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
  ),
  candidate_pool AS (
    SELECT
      qb.id, qb.question_text, qb.question_hi, qb.question_type, qb.question_type_v2,
      qb.options, qb.correct_answer_index, qb.explanation, qb.explanation_hi, qb.hint,
      qb.difficulty, qb.bloom_level, qb.chapter_number,
      ch.title AS chapter_title,
      qb.concept_tag, qb.case_passage, qb.case_passage_hi,
      qb.expected_answer, qb.expected_answer_hi, qb.max_marks,
      qb.is_ncert, qb.ncert_exercise,
      CASE WHEN s.question_id IS NULL THEN 0 ELSE 1 END AS seen_rank,
      CASE WHEN qb.is_ncert = true THEN 0 ELSE 1 END AS ncert_rank,
      -- Ranking preference only (spec §3.3) — never a filter outside the
      -- strict rung's own WHERE predicate below. Zero availability impact.
      CASE WHEN qb.verification_state = 'verified' THEN 0 ELSE 1 END AS verified_rank,
      CASE
        WHEN p_query_embedding IS NOT NULL AND qb.embedding IS NOT NULL
        THEN 1 - (qb.embedding <=> p_query_embedding)
        ELSE random()
      END AS relevance_score,
      COALESCE(h.last_shown_at, '1970-01-01'::timestamptz) AS last_shown_at
    FROM question_bank qb
    LEFT JOIN seen_ids s ON s.question_id = qb.id
    LEFT JOIN user_question_history h ON h.student_id = p_student_id AND h.question_id = qb.id
    LEFT JOIN chapters ch ON ch.id = qb.chapter_id
    WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
      AND qb.deleted_at IS NULL
      AND qb.content_status = 'published'
      AND qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
      -- Rung E0/E1 ladder (spec §2.2/§2.3/§3.2): the strict verification
      -- predicate applies ONLY when v_use_strict is true (pair enforced AND
      -- this exact slice's verified pool already meets p_count). Otherwise
      -- this ANDs to TRUE and behaves exactly as the pre-existing Tier-0-only
      -- filter above (Rung E1 / unenforced default).
      AND (NOT v_use_strict OR (qb.verified_against_ncert = true AND qb.verification_state = 'verified'))
      AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
      AND (
        qb.question_type_v2 = ANY(p_question_types)
        OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
      )
      AND (
        p_difficulty_mode = 'mixed' OR p_difficulty_mode = 'progressive'
        OR (p_difficulty_mode = 'easy' AND qb.difficulty = 1)
        OR (p_difficulty_mode = 'medium' AND qb.difficulty = 2)
        OR (p_difficulty_mode = 'hard' AND qb.difficulty = 3)
      )
    ORDER BY seen_rank, ncert_rank, verified_rank, relevance_score DESC, last_shown_at
    LIMIT p_count * 3
  ),
  numbered AS (
    SELECT cp.*, ROW_NUMBER() OVER (ORDER BY seen_rank, ncert_rank, verified_rank, relevance_score DESC) AS rn
    FROM candidate_pool cp
  ),
  selected AS (
    SELECT * FROM numbered WHERE rn <= p_count
    ORDER BY CASE WHEN p_difficulty_mode = 'progressive' THEN
      CASE WHEN rn <= GREATEST(1,(p_count*0.3)::INTEGER) THEN difficulty
           WHEN rn <= GREATEST(2,(p_count*0.7)::INTEGER) THEN ABS(difficulty-2)
           ELSE ABS(difficulty-3) END
    ELSE rn END, rn
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'question_text', question_text, 'question_hi', question_hi,
    'question_type', COALESCE(question_type,'mcq'), 'question_type_v2', COALESCE(question_type_v2,'mcq'),
    'options', options, 'correct_answer_index', correct_answer_index,
    'explanation', explanation, 'explanation_hi', explanation_hi, 'hint', hint,
    'difficulty', difficulty, 'bloom_level', bloom_level, 'chapter_number', chapter_number,
    'chapter_title', chapter_title, 'concept_tag', concept_tag,
    'case_passage', case_passage, 'case_passage_hi', case_passage_hi,
    'expected_answer', expected_answer, 'expected_answer_hi', expected_answer_hi,
    'max_marks', max_marks, 'is_ncert', COALESCE(is_ncert, false), 'ncert_exercise', ncert_exercise
  ) ORDER BY rn) INTO v_result FROM selected;

  INSERT INTO user_question_history (student_id, question_id, subject, grade, chapter_number,
                                     first_shown_at, last_shown_at, times_shown)
  SELECT p_student_id, (q->>'id')::UUID, p_subject, p_grade, (q->>'chapter_number')::INTEGER,
         now(), now(), 1
  FROM jsonb_array_elements(COALESCE(v_result,'[]'::jsonb)) AS q
  ON CONFLICT (student_id, question_id) DO UPDATE SET
    last_shown_at = now(), times_shown = user_question_history.times_shown + 1;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;


COMMENT ON FUNCTION public.select_quiz_questions_rag IS
  'Primary quiz serving RPC. 2026-08-14: the Tier-0 disproved-state exclusion '
  'was widened from the literal ''failed'' to all three disproved states '
  '(''failed'', ''failed_fix_in_flight'', ''failed_unfixable''). The CHECK was '
  'widened to six states by 20260510064952 but every gate kept testing only '
  '''failed'', so rows the verifier had DISPROVED and the repair agent had '
  'claimed were still servable. Everything else (rung ladder, ff_grounded_ai_'
  'enforced_pairs gating, telemetry, pool-reset guard, ncert/verified ranking) '
  'is unchanged from 20260802100000.';

-- Re-affirm the full grant posture, not just the function body. Verbatim
-- from 20260515000002_security_hardening_secdef_anon_searchpath_rls_view.sql
-- line 219 (idempotent: REVOKE on an already-revoked grant is a no-op).
REVOKE EXECUTE ON FUNCTION public.select_quiz_questions_rag(p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer, p_count integer, p_difficulty_mode text, p_question_types text[], p_query_embedding vector) FROM anon;

COMMIT;
