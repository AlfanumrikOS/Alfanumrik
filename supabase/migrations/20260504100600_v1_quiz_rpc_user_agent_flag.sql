-- Migration: 20260504100600_v1_quiz_rpc_user_agent_flag.sql
-- Purpose:    Marking-Authenticity Phase 2.10 (PREP) — register the
--             ff_v1_quiz_rpc_web_blocked feature flag without yet
--             modifying the legacy `submit_quiz_results` (v1) RPC body.
--
-- Why a multi-step rollout?
--   The v1 RPC `submit_quiz_results` is still the path of record for:
--     - Mobile clients (Alfanumrik-Mobile/* User-Agent) that have not yet
--       adopted submit_quiz_results_v2 + the /api/quiz/submit route.
--     - Any web tab open from before the Phase 2.7 cutover (very small
--       tail, tracked by Sentry breadcrumb on the new route).
--   Phase 2.7 already added ff_server_only_quiz_submit to gate the web
--   client onto the new server route. Phase 2.10 is the corresponding
--   server-side belt-and-suspenders: once the web client is fully on
--   /api/quiz/submit, the v1 RPC should reject any web-originated call so
--   a stale tab or a malicious caller cannot bypass the new server route.
--   Mobile must remain unaffected — the User-Agent gate is the only safe
--   discriminator without touching mobile's release cycle.
--
-- This migration ONLY registers the flag for ops visibility. It does NOT
-- modify the v1 RPC. The actual User-Agent check goes in a follow-up
-- migration (see rollout sequence below) so each step is independently
-- reversible and observable on the super-admin Flags console.
--
-- Rollout sequence (DO NOT SKIP STEPS):
--   1. THIS migration (Phase 2.10-prep): register `ff_v1_quiz_rpc_web_blocked`
--      with default FALSE. v1 RPC body untouched. Operators can see the
--      flag in the super-admin Flags console; no behavior change.
--   2. Follow-up migration `<future_ts>_v1_quiz_rpc_user_agent_gate.sql`:
--      CREATE OR REPLACE submit_quiz_results to read the flag and reject
--      calls when (a) flag is TRUE AND (b) caller's User-Agent is web
--      (i.e. NOT matching `Alfanumrik-Mobile/%`). The detection uses
--      `current_setting('request.headers.user-agent', true)` — populated
--      by PostgREST and the Supabase API gateway. Mobile passes a stable
--      `Alfanumrik-Mobile/<version>` UA per `mobile/lib/api/api_client.dart`.
--      Web clients (browsers, server-side fetch from Next.js) do not. The
--      RPC raises `Access denied: legacy v1 quiz submission disabled for web
--      clients; use /api/quiz/submit` on rejection so the operator log is
--      unambiguous.
--   3. Production cutover: operator flips ff_v1_quiz_rpc_web_blocked to TRUE
--      via the super-admin Flags console (after verifying ff_server_only_quiz_submit
--      is fully rolled out and /api/quiz/submit is the sole web path).
--      Order constraint: ff_server_only_quiz_submit MUST be flipped TRUE
--      first so the web client is already on the new route — flipping this
--      flag without that precondition is a P0 outage for any straggler tab.
--   4. Cleanup (weeks later): once mobile has adopted v2 (separate effort,
--      not on this critical path), drop the v1 RPC entirely. That migration
--      requires user approval (DROP FUNCTION on a long-lived RPC) and is
--      explicitly OUT OF SCOPE for this PR.
--
-- Idempotent: ON CONFLICT (flag_name) DO NOTHING — re-applying preserves
-- whatever value an operator has already set in the super-admin console.
--
-- Rollback:
--   - This migration: `DELETE FROM feature_flags WHERE flag_name = 'ff_v1_quiz_rpc_web_blocked';`
--     The follow-up RPC reads with a "default OFF if missing" guard, so
--     deletion is equivalent to setting FALSE.
--   - Step 3 cutover (after follow-up migration ships): flip
--     ff_v1_quiz_rpc_web_blocked back to FALSE in the console. Instantly
--     re-enables the v1 RPC for web; no migration redeploy required.
--
-- Risk profile:
--   - LOW. Pure metadata insert. Zero behavior change at apply time.
--   - The flag is OFF by default, so even after the follow-up migration
--     ships the v1 RPC keeps working for everyone until an operator
--     explicitly flips it.

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  description,
  metadata
) VALUES (
  'ff_v1_quiz_rpc_web_blocked',
  false,
  'When TRUE, the legacy `submit_quiz_results` RPC rejects calls where the '
  'request originates from a web client. Mobile (User-Agent: '
  'Alfanumrik-Mobile/*) is unaffected. Requires backend route '
  '/api/quiz/submit deployed AND `ff_server_only_quiz_submit` flipped first. '
  'Default OFF — flipping ON without those preconditions is a P0 quiz-submission '
  'outage for any web client still on the legacy path.',
  jsonb_build_object(
    'phase', '2.10-prep',
    'owner', 'architect+backend',
    'follow_up_migration', '<future_ts>_v1_quiz_rpc_user_agent_gate.sql',
    'follow_up_action', 'CREATE OR REPLACE submit_quiz_results to read this flag and reject web User-Agents when TRUE',
    'cleanup_migration', '<future_weeks_later_ts>_drop_v1_submit_quiz_results.sql',
    'cleanup_action', 'DROP FUNCTION submit_quiz_results — requires user approval; mobile must be fully on v2 first',
    'preconditions',  jsonb_build_array(
      'ff_server_only_quiz_submit is enabled in the same environment',
      '/api/quiz/submit deployed and verified for at least 24h',
      'follow-up migration `<future_ts>_v1_quiz_rpc_user_agent_gate.sql` applied',
      'mobile UA contract `Alfanumrik-Mobile/*` confirmed in mobile/lib/api/api_client.dart at the cutover SHA'
    ),
    'mobile_safe', true,
    'mobile_user_agent_contract', 'Alfanumrik-Mobile/<version>',
    'kill_switch', 'flip is_enabled=false to instantly re-allow web v1 calls. The follow-up migration only adds the gate; it does not remove v1.',
    'rollout_order', jsonb_build_array(
      'step1: this migration (register flag, default FALSE)',
      'step2: follow-up migration adds UA check inside v1 RPC body',
      'step3: operator flips flag TRUE in production after ff_server_only_quiz_submit is fully rolled out',
      'step4: weeks later, separate migration drops v1 RPC entirely (requires user approval)'
    ),
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
   WHERE flag_name = 'ff_v1_quiz_rpc_web_blocked';

  IF v_count = 0 THEN
    RAISE WARNING 'Phase 2.10-prep: ff_v1_quiz_rpc_web_blocked flag NOT seeded — investigate.';
  ELSE
    SELECT is_enabled INTO v_enabled
      FROM public.feature_flags
     WHERE flag_name = 'ff_v1_quiz_rpc_web_blocked';

    RAISE NOTICE 'Phase 2.10-prep: ff_v1_quiz_rpc_web_blocked present count=% is_enabled=%', v_count, v_enabled;

    IF v_enabled THEN
      RAISE WARNING 'Phase 2.10-prep: ff_v1_quiz_rpc_web_blocked is ENABLED — '
                    'verify the follow-up migration with the User-Agent gate '
                    'has been applied AND ff_server_only_quiz_submit is also '
                    'enabled, otherwise web quiz submission will FAIL.';
    END IF;
  END IF;
END $verify$;

-- End of migration: 20260504100600_v1_quiz_rpc_user_agent_flag.sql
-- Tables touched:    public.feature_flags (one INSERT, ON CONFLICT DO NOTHING)
-- Functions touched: NONE — submit_quiz_results (v1) RPC body is intentionally untouched
-- Triggers touched:  none
-- RLS touched:       none
