-- Migration: 20260504100300_server_only_quiz_submit_flag.sql
-- Purpose:    Marking-Authenticity Phase 2.7 (PREP) — register the
--             ff_server_only_quiz_submit feature flag without yet dropping
--             the client-INSERT RLS policy on quiz_sessions. The flag is the
--             coordination point between this migration and the Wave 2
--             /api/quiz/submit Next.js route delivery.
--
-- Why a two-step?
--   Today the web client writes quiz_sessions directly via a SECURITY
--   DEFINER RPC chain that ultimately leaves quiz_sessions writable from a
--   student-scoped session (the legacy student_id = self INSERT policy on
--   the table). The remediation goal is to funnel ALL quiz writes through
--   the new /api/quiz/submit server route so:
--     (a) the server is the only producer of quiz_sessions rows,
--     (b) idempotency keys (Phase 2.8) can be enforced server-side,
--     (c) marking_audit_last_30d (Phase 6.18) reports a clean attribution
--         chain (every row has a known server caller).
--
--   Dropping the INSERT policy BEFORE the route is deployed would break
--   submit-from-browser instantly. Dropping it AFTER the route is verified
--   is a single, separate, easily-rollback-able migration. This migration
--   is the prep step: register the kill-switch flag now so backend +
--   frontend agents in Wave 2 can read it from feature-flags.ts and gate
--   the new route behind it during rollout.
--
-- Rollout sequence (DO NOT SKIP STEPS):
--   1. THIS migration: register the flag, default OFF.
--      → quiz_sessions still client-writable. Nothing changes for users.
--   2. Wave 2 backend: deploy /api/quiz/submit Next.js route that calls
--      submit_quiz_results_v2 server-side. Flag still OFF; route is
--      reachable but the client still uses the direct RPC path.
--   3. Wave 2 frontend: switch QuizResults.tsx + the quiz orchestrator to
--      POST /api/quiz/submit. Verify on staging. Flag still OFF.
--   4. Operator: flip ff_server_only_quiz_submit to TRUE in staging via the
--      super-admin Flags console. Smoke-test 24h.
--   5. Operator: flip in prod with rollout_percentage 10 → 25 → 50 → 100.
--   6. FOLLOW-UP MIGRATION (NOT shipped here, intentionally):
--      `<future_ts>_drop_quiz_sessions_student_insert.sql`
--        - DROP POLICY IF EXISTS "quiz_sessions_student_insert"
--          ON public.quiz_sessions;
--        - The flag becomes the sole on/off; the RLS policy drop is the
--          irreversible enforcement. Architect approval required because
--          DROP POLICY is a security boundary change (P8/P9).
--
-- Idempotent: ON CONFLICT (flag_name) DO NOTHING — re-applying preserves
-- whatever value an operator has already set.
--
-- Rollback: DELETE FROM feature_flags WHERE flag_name = 'ff_server_only_quiz_submit';
-- The Wave 2 route reads the flag with a "default OFF if missing" guard, so
-- delete is equivalent to setting FALSE.

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  description,
  metadata
) VALUES (
  'ff_server_only_quiz_submit',
  false,
  'When true, the RLS policy quiz_sessions_student_insert is DROPPED in a '
  'follow-up migration — clients can no longer write quiz_sessions directly '
  'and MUST go through /api/quiz/submit (server-side, with idempotency_key + '
  'authorizeRequest). This flag MUST be enabled in production AND the '
  '/api/quiz/submit route MUST be deployed and verified in prod before the '
  'follow-up policy-drop migration is applied. Default OFF — flipping ON '
  'without the route deployed is a P0 quiz-submission outage.',
  jsonb_build_object(
    'phase', '2.7-prep',
    'owner', 'architect+backend',
    'follow_up_migration', '<future_ts>_drop_quiz_sessions_student_insert.sql',
    'follow_up_action', 'DROP POLICY IF EXISTS quiz_sessions_student_insert ON public.quiz_sessions',
    'preconditions',  jsonb_build_array(
      'route /api/quiz/submit deployed to prod',
      'route verified by backend + testing agents on staging for 24h',
      'idempotency_key flow exercised end-to-end (Phase 2.8 migration applied)',
      'mobile clients verified to be on the v2 submit path or grace-period plan in place'
    ),
    'kill_switch', 'flip is_enabled=false to instantly fall back to the legacy client RPC path. The follow-up policy-drop migration removes that fallback permanently — pair with regression test before applying.',
    'added', '2026-05-04'
  )
)
ON CONFLICT (flag_name) DO NOTHING;

DO $verify$
DECLARE
  v_count   INTEGER;
  v_enabled BOOLEAN;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.feature_flags
   WHERE flag_name = 'ff_server_only_quiz_submit';

  IF v_count = 0 THEN
    RAISE WARNING 'Phase 2.7-prep: ff_server_only_quiz_submit flag NOT seeded — investigate.';
  ELSE
    SELECT is_enabled INTO v_enabled
      FROM public.feature_flags
     WHERE flag_name = 'ff_server_only_quiz_submit';
    RAISE NOTICE 'Phase 2.7-prep: ff_server_only_quiz_submit present count=% is_enabled=%', v_count, v_enabled;

    IF v_enabled THEN
      RAISE WARNING 'Phase 2.7-prep: ff_server_only_quiz_submit is ENABLED — '
                    'verify /api/quiz/submit is deployed before the follow-up '
                    'policy-drop migration is applied.';
    END IF;
  END IF;
END $verify$;

-- End of migration: 20260504100300_server_only_quiz_submit_flag.sql
