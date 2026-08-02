-- Migration: 20260802100000_select_quiz_questions_rag_verification_gate.sql
-- Purpose: Close the verification-state gap in select_quiz_questions_rag —
--          the RPC that serves quiz questions to /api/quiz, /api/v2/quiz/
--          questions, and the WhatsApp Daily-6 top-up path. Wires the
--          existing, tested, hysteresis-protected ff_grounded_ai_enforced_pairs
--          mechanism into the serve path (it was previously a pure no-op with
--          respect to serving) and closes two incidental Tier-0 gaps.
--
-- Spec: docs/superpowers/specs/2026-08-02-quiz-rag-verification-gate-correctness.md
-- Owner: architect. Author: assessment (spec) -> architect (this migration).
-- Review chain (P14): ai-engineer (confirmation only), testing (§6),
--   backend (§3.6 caller-side gap, not implemented here), ops (§7 census
--   queries before enabling any new pair), quality (final gate).
-- CEO-authorized fix (per task framing); no new user approval required
--   beyond that authorization — see spec §8.
--
-- ─── Why ─────────────────────────────────────────────────────────────────────
-- select_quiz_questions_rag has never, across 7 historical versions since
-- 2026-04-03, filtered on question_bank.verified_against_ncert or
-- verification_state. A row the automated NCERT verifier has explicitly
-- DISPROVED (verification_state = 'failed') can be served to a student today
-- with no gate at all. The retroactive verifier (supabase/functions/
-- verify-question-bank/index.ts) sets verification_state='failed' on an
-- existing legacy row WITHOUT touching is_active, so disproved legacy rows
-- stay is_active=true and fully servable today (spec §1.1).
--
-- ─── Design (spec §2-§3, implemented verbatim) ──────────────────────────────
-- 1. Tier-0 hard predicates (spec §2.1) — apply ALWAYS, every pair, enforced
--    or not, never relaxed, identically across all four repeated predicate
--    blocks (pool-count, seen-count, reset/delete, candidate_pool CTE):
--      - deleted_at IS NULL              (soft-delete gap, spec §1.5 gap 1)
--      - content_status = 'published'    (draft/review/archived gap, §1.5 gap 2)
--      - verification_state != 'failed'  (no fallback rung — spec §3.4: a
--        verifier-disproved row must never serve, enforced or not)
--    Applying these identically across all four blocks (not just
--    candidate_pool) keeps the pool-count math in sync with the actual
--    candidate set — an inconsistency here could mis-trigger the unrelated
--    REG-172 80%-reset logic (spec §2.1, AC-7).
--
-- 2. Gating mechanism (spec §2.2) — wires the EXISTING
--    ff_grounded_ai_enforced_pairs table (real, tested, hysteresis-protected:
--    enable requires server-recomputed verified_ratio >= 0.9
--    (verification-queue route), auto-disable at < 0.85 (coverage-audit)).
--    NOT a global hard filter — only (grade, subject) pairs an admin has
--    explicitly enabled get the strict filter. This migration does not flip
--    any pair's enabled state; whatever is in ff_grounded_ai_enforced_pairs
--    today stays exactly as-is.
--
-- 3. Local-thinness fallback ladder (spec §2.3/§3.1) — the enable-workflow's
--    90% floor is computed at the (grade, subject) PAIR level, aggregated
--    across chapters. A pair can clear 90% in aggregate while a specific
--    chapter/difficulty slice is far thinner. So:
--      Rung E0 (strict):  pair enforced AND verified pool for the EXACT
--                          requested slice (chapter/type/difficulty, same
--                          scoping as candidate_pool) >= p_count
--                          -> filter verified_against_ncert=true AND
--                             verification_state='verified'
--      Rung E1 (relaxed): pair enforced but E0 pool < p_count for this slice
--                          -> Tier-0 only (no additional requirement)
--      default (unenforced): pair not enabled -> Tier-0 only, behaviorally
--                          identical to E1
--    Safety property (spec §3.1): the worst case this change can ever reach
--    for any pair is Rung E1/default — exactly today's live behavior minus
--    the three Tier-0 closures. This fix cannot make quiz availability worse
--    than today for any (grade, subject, chapter).
--
-- 4. Telemetry (spec §3.5) — fires ONLY when Rung E1 is used BECAUSE OF
--    THINNESS (pair enforced but locally thin), not the unenforced-default
--    case (which is expected, not a gap — AC-3: no telemetry there). Written
--    directly via INSERT INTO ops_events from inside this SECURITY DEFINER
--    function (ops_events RLS is `USING (false) WITH CHECK (false)` for
--    authenticated/anon — a SECURITY DEFINER function is the only way a
--    non-service-role caller's request can produce this row), matching the
--    established pattern in submit_quiz_results_v2
--    (20260702150000_p3w1_5_quiz_rpc_ownership_check.sql /
--    20260707010000_rca_final_fixes.sql: wrapped in its own
--    BEGIN...EXCEPTION WHEN OTHERS THEN NULL block so a telemetry failure can
--    never break question serving).
--
-- 5. Ranking preference (spec §3.3, explicitly a SHOULD not a MUST) —
--    verified_rank computed column added to the existing ORDER BY,
--    architecturally identical in style to the pre-existing ncert_rank
--    preference (prefer verified rows without making verification a filter
--    outside the strict rung). Zero availability risk: reorders an
--    already-passing pool only. Implemented here since it is low-risk,
--    directly recommended by the spec, and keeps the diff pattern-symmetric
--    with the existing ncert_rank column.
--
-- NOTE ON A SPEC AMBIGUITY (flagged, resolved conservatively — see this PR's
-- architect verdict for the full explanation): spec §3.1's table has a column
-- "`verification_tier` in response (recommended addition — see §3.3)", but
-- §3.3's own prose describes ONLY the verified_rank ordering column, never a
-- new response field, and none of §6's acceptance criteria assert on such a
-- field. This migration implements the well-specified verified_rank ordering
-- column and does NOT add an undocumented new JSON key to the response
-- (AC-1..AC-4 are checkable against question_bank directly via the returned
-- `id`s, not via a new response field) — adding one would be a caller-facing
-- contract change with no concrete spec, no test coverage, and no listed
-- reviewer for that specific surface.
--
-- ─── Out of scope (spec §5, confirmed unchanged by this migration) ─────────
-- select_quiz_questions_v2, supabase/functions/grounded-answer/coverage.ts,
-- chk_source_type / competition-tier exclusion, packages/lib/src/quiz/
-- question-validation.ts (validateQuestion — the P6 gate), is_verified
-- (human/SME flag — remains ranking/administrative metadata only).
--
-- ─── Overload-safety verification (function-signature parity) ──────────────
-- This is a pure CREATE OR REPLACE of the EXISTING single signature — NOT a
-- new overload. Verified by grepping every historical definition of this
-- function (baseline, 20260509161642, 20260514000000, 20260625000200,
-- 20260801100700): the 8-parameter signature below (names, types, order,
-- defaults) has been byte-identical across all five prior versions. This
-- migration changes ONLY the function body (WHERE clauses + new DECLARE
-- variables + the ladder/telemetry logic) — no parameter added, removed,
-- renamed, retyped, or reordered. This repo has a documented history of the
-- opposite mistake (see 20260702170000_p3w1_5b_revoke_orphan_atomic_quiz_5arg.sql
-- and 20260729130000_fix_6arg_quiz_xp_ledger_write.sql, where a genuinely
-- DIFFERENT argument shape created a real orphan overload that had to be
-- REVOKEd) — that risk does not apply here because nothing about the
-- parameter list changes.
--
-- ─── Security posture ────────────────────────────────────────────────────────
-- SECURITY DEFINER (pre-existing, unchanged, carried forward from
-- 20260801100700): required so the function can read question_bank and
-- read/write user_question_history across RLS on behalf of the resolved
-- student; search_path pinned to 'public'. This migration ADDS two more
-- reasons the DEFINER context is load-bearing:
--   (a) SELECT ... FROM ff_grounded_ai_enforced_pairs — this table's own RLS
--       (`ff_pairs_read_all`) already grants SELECT to any `authenticated`
--       role, so this specific read does not itself require DEFINER, but it
--       inherits the same execution context as everything else in this
--       function.
--   (b) INSERT INTO ops_events — this table's RLS is
--       `ops_events_no_client_access ... USING (false) WITH CHECK (false)`
--       for authenticated AND anon. A JWT-authenticated caller could NEVER
--       write this telemetry row directly; DEFINER is what makes it possible
--       inside this function, exactly as it already is for
--       submit_quiz_results_v2's own ops_events writes.
-- No new SQL-injection surface: every predicate uses bound parameters
-- (p_grade, p_subject, p_chapter_number, p_count, p_difficulty_mode,
-- p_question_types) or literal constants — no string concatenation into
-- executed SQL anywhere in this function, before or after this change.
-- Ownership guard (auth.uid() IS NOT NULL AND ... skip for service-role,
-- added 2026-08-01) is untouched.
--
-- ─── Idempotency / migration rules compliance ───────────────────────────────
-- CREATE OR REPLACE FUNCTION — idempotent, safe to re-run. No new table, so
-- no RLS-on-new-table requirement applies. No DROP of any kind. No
-- REVOKE/GRANT here — CREATE OR REPLACE preserves the function's existing
-- ACL, which this migration does not need to change (same rationale as
-- 20260801100700's own header).
--
-- ─── Rollback ────────────────────────────────────────────────────────────────
-- Re-apply the 20260801100700 definition of select_quiz_questions_rag (a
-- compensating CREATE OR REPLACE restoring the pre-verification-gate body).
-- No data migration needed in either direction — this migration writes no
-- new tables/columns, and ff_grounded_ai_enforced_pairs rows are untouched
-- (this migration only makes existing rows MATTER; it seeds/flips none).

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
    AND qb.verification_state != 'failed'
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
        AND qb.verification_state != 'failed'
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
          AND qb.verification_state != 'failed'
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
      AND qb.verification_state != 'failed'
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
  'Phase 1.5 (2026-05-09): question-type filter widened so '
  '''ncert'' in p_question_types matches qb.is_ncert=TRUE rows of any '
  'question_type_v2. Other types behave as before. '
  '2026-06-25: pool-reset guard added (MIN_POOL_FOR_RESET=10) to prevent '
  'infinite question-cycle on thin chapters (< 10 questions). '
  '2026-08-01: ownership guard now skips when auth.uid() IS NULL '
  '(service-role/cron/edge callers), matching start_quiz_session and '
  'submit_quiz_results_v2. Bot-side ownership lives at the '
  'resolveActiveStudent chokepoint (R6). '
  '2026-08-02: verification gate (spec docs/superpowers/specs/'
  '2026-08-02-quiz-rag-verification-gate-correctness.md). Tier-0 predicates '
  'added to all four repeated blocks: deleted_at IS NULL, content_status = '
  '''published'', verification_state != ''failed'' (no fallback rung -- a '
  'verifier-disproved row never serves). ff_grounded_ai_enforced_pairs now '
  'wired to serving: enforced pairs get a strict verified_against_ncert=true '
  'AND verification_state=''verified'' filter (Rung E0) UNLESS the verified '
  'pool for the exact requested chapter/type/difficulty slice is thinner '
  'than p_count, in which case Rung E1 (Tier-0 only) applies and an '
  'ops_events(category=''grounding.quiz_serving'') row is emitted. '
  'Unenforced pairs are unaffected beyond the three Tier-0 closures. '
  'verified_rank ordering preference added (ranks verified rows first, '
  'never filters). Safety property: this fix can only ever remove rows from '
  'what is servable versus pre-2026-08-02 behavior, never add any.';

COMMIT;
