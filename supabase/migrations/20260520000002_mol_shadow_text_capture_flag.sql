-- 20260520000002_mol_shadow_text_capture_flag.sql
-- C4.2b-ii (2026-05-20): seed the text-capture feature flag.
--
-- Companion to 20260520000001_mol_shadow_text_buffer.sql (the table itself).
-- This flag is INDEPENDENT of the shadow-routing flag — it gates only the
-- text-capture write path inside shadowFireOpenAI. Text capture fires when
-- BOTH this flag AND ff_grounded_answer_mol_shadow_v1 are enabled (since
-- the capture happens inside the shadow helper).
--
-- Why a separate flag (vs piggybacking on the shadow flag):
--   * Lets ops dial up shadow ROUTING (firing the OpenAI call, logging
--     mol_request_logs rows) WITHOUT writing question/answer text to the
--     new buffer table. Useful for pure-cost dashboards or for canary
--     shadow data where we don't yet want text in the buffer.
--   * Lets ops kill text capture instantly (set is_enabled=false) without
--     turning off the shadow signal that informs cost dashboards.
--   * Keeps the privacy posture explicit: a separate switch + audit row
--     when ops promotes text capture rather than implicit enablement.
--
-- Default DISABLED. Operator runbook (C4.2b promotion):
--   1. Confirm 24h+ of shadow rows exist (ff_grounded_answer_mol_shadow_v1
--      enabled and traffic flowing).
--   2. Promote on staging first: UPDATE feature_flags SET is_enabled=true
--      WHERE flag_name='ff_mol_shadow_text_capture_v1'. Verify
--      mol_shadow_text_buffer rows appear and PII redaction fires
--      (redaction_applied[] populated on rows with email/phone/RZP IDs).
--   3. Watch storage growth: each row is ~6-8 KB of text; at 100 rows/day
--      under canary that's ~700 KB/day, well below storage budget.
--   4. Once staging is clean for 24h, promote on production.
--
-- Migration is fully idempotent: pure ON CONFLICT DO NOTHING insert.

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  description,
  metadata,
  target_environments,
  created_at,
  updated_at
)
VALUES (
  'ff_mol_shadow_text_capture_v1',
  false,
  0,
  'C4.2b-ii: capture response text into mol_shadow_text_buffer for Sonnet grader. Default DISABLED. Independent of shadow flag — text capture only fires when both this flag AND ff_grounded_answer_mol_shadow_v1 are enabled (since capture happens inside shadowFireOpenAI).',
  jsonb_build_object('enabled', false),
  ARRAY['staging', 'production']::TEXT[],
  now(),
  now()
)
ON CONFLICT (flag_name) DO NOTHING;

-- Verify seed landed; emit NOTICE for runbook visibility.
DO $verify$
DECLARE
  v_count   integer;
  v_enabled boolean;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.feature_flags
   WHERE flag_name = 'ff_mol_shadow_text_capture_v1';

  IF v_count = 0 THEN
    RAISE WARNING 'C4.2b-ii: ff_mol_shadow_text_capture_v1 NOT seeded — investigate.';
  ELSE
    SELECT is_enabled INTO v_enabled
      FROM public.feature_flags
     WHERE flag_name = 'ff_mol_shadow_text_capture_v1';
    RAISE NOTICE 'C4.2b-ii: ff_mol_shadow_text_capture_v1 present count=% is_enabled=%', v_count, v_enabled;
    IF v_enabled THEN
      RAISE WARNING 'C4.2b-ii: ff_mol_shadow_text_capture_v1 is ENABLED — intent was OFF, verify.';
    END IF;
  END IF;
END $verify$;
