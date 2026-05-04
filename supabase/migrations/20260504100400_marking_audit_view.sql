-- Migration: 20260504100400_marking_audit_view.sql
-- Purpose:    Marking-Authenticity Phase 6.18 — forensic SQL view that
--             surfaces every quiz_responses row in the last 30 days where
--             the recorded is_correct disagrees with what the per-session
--             snapshot says it should have been (or where the snapshot is
--             missing entirely). Powers the super-admin "marking integrity"
--             dashboard and the nightly drift canary.
--
-- Read model:
--   For every quiz_responses row in the last 30 days:
--     * JOIN quiz_session_shuffles (snapshot of correct_answer_index +
--       shuffle_map captured at session start; never edited mid-session)
--     * JOIN quiz_sessions for student_id, score_percent, completed_at
--     * Map quiz_responses.selected_option (which is the SHUFFLED display
--       index, by v2 contract) → original-space index via shuffle_map.
--     * Compute expected_is_correct = (selected_orig = correct_idx_snapshot)
--     * Filter to rows where expected_is_correct != is_correct OR snapshot
--       is missing (the latter is the Phase 1.2 silent-zero footprint).
--
-- Privacy posture:
--   - SECURITY INVOKER (NOT DEFINER): the caller's RLS applies. service_role
--     bypasses RLS in PostgreSQL — that is the only role this view is granted
--     to. The `authenticated` role is NOT granted SELECT, so no student or
--     parent or teacher can ever query this view. Forensic-only.
--   - Columns are deliberately UUIDs only (no email, no name, no phone). The
--     ops dashboard joins to students table on its own when it needs a
--     display name, and that join is itself behind super-admin RBAC.
--
-- Performance:
--   - The 30-day window is a sliding range; the view is recomputed on every
--     SELECT. Backed by:
--       idx_quiz_sessions_created_at (baseline:17660)
--       idx_qs_student_done          (baseline:17555)
--       quiz_session_shuffles PK (session_id, question_id) (legacy:20260428160000)
--   - Cost-bound via WHERE qs.completed_at > now() - interval '30 days' and a
--     final ORDER BY in the dashboard layer (NOT in the view, to keep the
--     plan flexible).
--
-- Idempotent: CREATE OR REPLACE VIEW. Safe to re-apply.
--
-- Reversible: DROP VIEW IF EXISTS public.marking_audit_last_30d;

CREATE OR REPLACE VIEW public.marking_audit_last_30d
WITH (security_invoker = true)   -- caller's RLS applies; service_role bypasses
AS
WITH responses_30d AS (
  -- Cap the response set to the last 30 days BEFORE joining shuffles, so the
  -- planner can use the time-range index on quiz_sessions and prune the
  -- hash join down to the recent slice.
  SELECT qr.id              AS response_id,
         qr.quiz_session_id,
         qr.student_id,
         qr.question_id,
         qr.student_answer_index AS selected_option,                    -- shuffled display index per v2 contract
         qr.is_correct      AS recorded_is_correct,
         qs.score_percent,
         qs.completed_at
    FROM public.quiz_responses qr
    JOIN public.quiz_sessions  qs
      ON qs.id = qr.quiz_session_id
   WHERE qs.completed_at IS NOT NULL
     AND qs.completed_at > (now() - interval '30 days')
)
SELECT r.quiz_session_id   AS session_id,
       r.student_id,
       r.question_id,
       r.selected_option,
       qss.correct_answer_index_snapshot AS snapshot_correct_idx,
       r.recorded_is_correct,
       -- expected_is_correct: re-derive from snapshot. NULL when snapshot
       -- is missing (Phase 1.2 silent-zero footprint) — the dashboard
       -- treats NULL as "snapshot drift, audit manually".
       CASE
         WHEN qss.correct_answer_index_snapshot IS NULL THEN NULL
         WHEN qss.shuffle_map IS NOT NULL
              AND array_length(qss.shuffle_map, 1) = 4
              AND r.selected_option BETWEEN 0 AND 3
           THEN (qss.shuffle_map[r.selected_option + 1]
                 = qss.correct_answer_index_snapshot)
         ELSE
           -- No shuffle / out-of-range index: treat selected as already
           -- in original space (matches v1 fallback semantics).
           (r.selected_option = qss.correct_answer_index_snapshot)
       END AS expected_is_correct,
       r.completed_at
  FROM responses_30d r
  LEFT JOIN public.quiz_session_shuffles qss
    ON qss.session_id  = r.quiz_session_id
   AND qss.question_id = r.question_id
 -- Surface every disagreement OR missing snapshot. This is the forensic
 -- filter — operators investigate every row that comes through.
 WHERE qss.correct_answer_index_snapshot IS NULL
    OR (
      CASE
        WHEN qss.shuffle_map IS NOT NULL
             AND array_length(qss.shuffle_map, 1) = 4
             AND r.selected_option BETWEEN 0 AND 3
          THEN (qss.shuffle_map[r.selected_option + 1]
                = qss.correct_answer_index_snapshot)
        ELSE
          (r.selected_option = qss.correct_answer_index_snapshot)
      END
    ) IS DISTINCT FROM r.recorded_is_correct;

COMMENT ON VIEW public.marking_audit_last_30d IS
  'Marking-Authenticity Phase 6.18 forensic view. Surfaces every quiz_responses '
  'row in the last 30 days where the recorded is_correct disagrees with the '
  'per-session snapshot (or the snapshot is missing — the Phase 1.2 silent-zero '
  'footprint). SECURITY INVOKER + service_role-only GRANT. UUIDs only, no PII. '
  'Powers the super-admin "marking integrity" dashboard and the nightly drift '
  'canary. Example query: '
  'SELECT count(*) FROM marking_audit_last_30d WHERE recorded_is_correct != expected_is_correct;';

-- ───────────────────────────────────────────────────────────────────────────
-- GRANTs: service_role only. authenticated is NOT granted SELECT.
-- ───────────────────────────────────────────────────────────────────────────

-- Defensive REVOKE first so re-applying the migration cleans up any prior
-- accidental grant.
REVOKE ALL ON public.marking_audit_last_30d FROM PUBLIC;
REVOKE ALL ON public.marking_audit_last_30d FROM authenticated;
REVOKE ALL ON public.marking_audit_last_30d FROM anon;

GRANT SELECT ON public.marking_audit_last_30d TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Example queries for the operator runbook
-- ───────────────────────────────────────────────────────────────────────────
-- Drift count (use this as the daily canary metric):
--   SELECT count(*) FROM marking_audit_last_30d
--    WHERE recorded_is_correct IS DISTINCT FROM expected_is_correct;
--
-- Missing-snapshot footprint (Phase 1.2 verification):
--   SELECT count(*) FROM marking_audit_last_30d
--    WHERE snapshot_correct_idx IS NULL;
--
-- Top-N students with marking drift (for individual remediation):
--   SELECT student_id, count(*) AS drift_count
--     FROM marking_audit_last_30d
--    WHERE recorded_is_correct IS DISTINCT FROM expected_is_correct
--    GROUP BY student_id
--    ORDER BY drift_count DESC
--    LIMIT 10;

-- End of migration: 20260504100400_marking_audit_view.sql
