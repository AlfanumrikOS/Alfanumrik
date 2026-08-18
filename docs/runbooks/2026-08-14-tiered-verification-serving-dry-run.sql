-- Dry-run / blast-radius sizing for migration
--   20260814000014_tiered_verification_serving_and_truthful_picker.sql
--   (SEV1 #12, Decision A — CEO-approved OPTION 3, tiered verification)
--
-- READ-ONLY. Every statement below is a SELECT. Nothing here writes, and
-- nothing here needs the migration to have been applied — that is the point:
-- run this FIRST, on production, to learn the numbers before the change lands.
--
-- Run as service_role (question_bank is RLS-protected).
--
-- Owner: assessment. Reviewers: architect (DB), ops (runs it), testing.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- HOW TO READ THE RESULTS
-- ═══════════════════════════════════════════════════════════════════════════
-- Q1 tells you how big the "AI-repaired but unservable" hole actually is —
--     the rows the picker counted and the quiz could not deliver. This is the
--     defect, quantified.
-- Q2 tells you how much practice availability option 3 unlocks per
--     (grade, subject). Expect a large number: is_verified DEFAULTs to false.
-- Q3/Q4 tell you what the Tier-0 floor REMOVES, which is the only direction
--     this migration can hurt. Q4 in particular is the number that matters for
--     select_quiz_questions_v2, which had no floor at all.
-- Q5 is the honesty check on the new badge: old count vs the two new counts.
-- Q6 proves the exam tier is unaffected.
-- Q7 sizes the content_status NULL population — the reason every floor this
--     migration ADDS is null-tolerant, and the census the (deliberately
--     unchanged, stricter) select_quiz_questions_rag predicate needs before
--     anyone relaxes it.
-- Q8 sizes the commit-fix.ts stale-sign-off rule.
--
-- STOP AND ESCALATE IF: Q3 or Q4 show a (grade, subject) losing more than a
-- few percent of its pool, or any (grade, subject) dropping below ~10 servable
-- questions for a chapter that students actively use. The floor is correct in
-- principle, but a large removal means the question bank has a content-quality
-- problem that must be fixed with content, not by relaxing the floor.


-- ═══════════════════════════════════════════════════════════════════════════
-- Q1. THE DEFECT, QUANTIFIED
--     Rows an automated agent verified but no human signed off — i.e. rows
--     that raised chapter readiness and the picker badge, and that
--     get_quiz_questions REFUSED TO SERVE.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  grade,
  subject,
  COUNT(*) AS agent_verified_but_not_sme_signed
FROM public.question_bank
WHERE is_active = true
  AND deleted_at IS NULL
  AND verification_state = 'verified'
  AND verified_against_ncert = true
  AND is_verified IS DISTINCT FROM true
GROUP BY grade, subject
ORDER BY agent_verified_but_not_sme_signed DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q2. PRACTICE AVAILABILITY UNLOCKED BY DROPPING THE is_verified FILTER
--     before  = what get_quiz_questions serves TODAY (is_verified only, no floor)
--     after   = what it serves after this migration (Tier-0 floor, no SME gate)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  grade,
  subject,
  COUNT(*) FILTER (
    WHERE is_active = true
      AND is_verified = true
  ) AS servable_before,
  COUNT(*) FILTER (
    WHERE is_active = true
      AND deleted_at IS NULL
      AND (content_status IS NULL OR content_status = 'published')
      AND verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
  ) AS servable_after,
  COUNT(*) FILTER (
    WHERE is_active = true
      AND deleted_at IS NULL
      AND (content_status IS NULL OR content_status = 'published')
      AND verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
  ) - COUNT(*) FILTER (
    WHERE is_active = true
      AND is_verified = true
  ) AS delta
FROM public.question_bank
GROUP BY grade, subject
ORDER BY delta DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q3. WHAT THE TIER-0 FLOOR REMOVES (the only direction this can hurt)
--     Rows that are is_active today but fail the new floor, by reason.
--     Reasons are mutually exclusive in this breakdown (first match wins).
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  CASE
    WHEN deleted_at IS NOT NULL THEN 'soft_deleted'
    WHEN content_status IS NOT NULL AND content_status <> 'published'
      THEN 'content_status_' || content_status
    WHEN verification_state = 'failed'               THEN 'disproved_failed'
    WHEN verification_state = 'failed_fix_in_flight' THEN 'disproved_fix_in_flight'
    WHEN verification_state = 'failed_unfixable'     THEN 'disproved_unfixable'
  END AS excluded_reason,
  COUNT(*) AS rows_excluded,
  COUNT(*) FILTER (WHERE is_verified = true) AS of_which_sme_signed
FROM public.question_bank
WHERE is_active = true
  AND (
    deleted_at IS NOT NULL
    OR (content_status IS NOT NULL AND content_status <> 'published')
    OR verification_state IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
  )
GROUP BY 1
ORDER BY rows_excluded DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q4. THE TWO NEWLY-EXCLUDED DISPROVED STATES
--     These rows are servable TODAY by select_quiz_questions_rag (which tests
--     only the literal 'failed') and by select_quiz_questions_v2 (which tests
--     nothing at all). Every one of them is a question the verifier PROVED
--     wrong. This is the answer-correctness number, not an availability one.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  verification_state,
  grade,
  subject,
  COUNT(*) AS servable_today_but_disproved
FROM public.question_bank
WHERE is_active = true
  AND deleted_at IS NULL
  AND verification_state IN ('failed_fix_in_flight', 'failed_unfixable')
GROUP BY verification_state, grade, subject
ORDER BY servable_today_but_disproved DESC;

-- Same question, whole-population totals including plain 'failed' for scale.
SELECT
  verification_state,
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE is_active = true AND deleted_at IS NULL) AS active_rows
FROM public.question_bank
GROUP BY verification_state
ORDER BY total_rows DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q5. THE BADGE, BEFORE AND AFTER
--     Per (grade, subject, chapter): the number the picker shows TODAY vs the
--     two numbers it will show. `overstatement` is the size of the lie — how
--     many questions we advertise that the practice path cannot serve.
--     Chapters with the largest overstatement are the ones students hit an
--     empty or short quiz on.
-- ═══════════════════════════════════════════════════════════════════════════
WITH per_chapter AS (
  SELECT
    grade,
    subject,
    chapter_number,
    -- Today's badge: verified_question_count.
    COUNT(*) FILTER (
      WHERE is_active = true
        AND deleted_at IS NULL
        AND verification_state = 'verified'
    ) AS verified_question_count,
    -- New: practice_ready_count.
    COUNT(*) FILTER (
      WHERE is_active = true
        AND deleted_at IS NULL
        AND (content_status IS NULL OR content_status = 'published')
        AND verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
    ) AS practice_ready_count,
    -- New: exam_ready_count.
    COUNT(*) FILTER (
      WHERE is_active = true
        AND deleted_at IS NULL
        AND (content_status IS NULL OR content_status = 'published')
        AND verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
        AND is_verified = true
    ) AS exam_ready_count,
    -- What get_quiz_questions could actually serve TODAY.
    COUNT(*) FILTER (
      WHERE is_active = true
        AND is_verified = true
    ) AS servable_today
  FROM public.question_bank
  WHERE chapter_number IS NOT NULL
  GROUP BY grade, subject, chapter_number
)
SELECT
  grade,
  subject,
  chapter_number,
  verified_question_count,
  servable_today,
  verified_question_count - servable_today AS overstatement_today,
  practice_ready_count,
  exam_ready_count
FROM per_chapter
WHERE verified_question_count > servable_today
ORDER BY overstatement_today DESC
LIMIT 100;

-- Headline: how many chapters currently advertise a count they cannot deliver?
WITH per_chapter AS (
  SELECT
    grade, subject, chapter_number,
    COUNT(*) FILTER (
      WHERE is_active = true AND deleted_at IS NULL AND verification_state = 'verified'
    ) AS verified_question_count,
    COUNT(*) FILTER (WHERE is_active = true AND is_verified = true) AS servable_today
  FROM public.question_bank
  WHERE chapter_number IS NOT NULL
  GROUP BY grade, subject, chapter_number
)
SELECT
  COUNT(*) FILTER (WHERE verified_question_count > servable_today) AS chapters_overstating,
  COUNT(*) FILTER (WHERE verified_question_count > 0 AND servable_today = 0)
    AS chapters_advertising_but_serving_zero,
  COUNT(*) AS chapters_total
FROM per_chapter;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q6. EXAM TIER — PROVE IT IS UNAFFECTED
--     start_mock_test_attempt (20260722097000) is not touched by the migration.
--     Its predicates are is_active + is_verified + source_type, at subject/grade
--     scope. This is the pool it draws on; the number must not change.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  grade,
  subject,
  COUNT(*) AS mock_test_eligible_pool
FROM public.question_bank
WHERE is_active = true
  AND is_verified = true
  AND source_type = ANY (ARRAY[
    'ncert_intext', 'ncert_exercise', 'ncert_example',
    'cbse_style', 'board_paper', 'practice'
  ])
GROUP BY grade, subject
ORDER BY mock_test_eligible_pool ASC;
-- Re-run this AFTER the migration applies. Row-for-row identical output is the
-- proof that option 3 preserved the human gate on the exam path.


-- ═══════════════════════════════════════════════════════════════════════════
-- Q7. content_status CENSUS
--     Why every floor this migration ADDS is null-tolerant, and the census
--     select_quiz_questions_rag's stricter `= 'published'` predicate needs
--     before anyone proposes relaxing it (a WIDENING — not shipped in a SEV1).
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  COALESCE(content_status, '(null)') AS content_status,
  COUNT(*) AS rows,
  COUNT(*) FILTER (WHERE is_active = true AND deleted_at IS NULL) AS active_rows
FROM public.question_bank
GROUP BY 1
ORDER BY rows DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q8. STALE SME SIGN-OFF EXPOSURE
--     commit-fix.ts now withdraws is_verified when the repair agent REWRITES
--     content a human had already approved. This is the population that rule
--     can touch: rows carrying a human sign-off that the automated verifier
--     has since disproved. Small is expected; large means the SME queue and
--     the verifier disagree systematically and that is a content escalation.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  verification_state,
  COUNT(*) AS sme_signed_but_verifier_disagrees
FROM public.question_bank
WHERE is_verified = true
  AND verification_state IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
GROUP BY verification_state
ORDER BY sme_signed_but_verifier_disagrees DESC;
