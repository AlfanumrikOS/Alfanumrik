-- Migration: Feature-flag envelope RPC (P2-12)
-- Audit remediation 2026-08-07 -- REBUILT against real schema.
--
-- Real schema fact (baseline:11212): feature_flags columns are id, flag_name,
-- is_enabled, rollout_percentage, description, metadata, wave, etc.
-- There is NO is_active column. This RPC exposes a safe read envelope to
-- anon/authenticated so the voice route no longer needs a privileged key.

CREATE OR REPLACE FUNCTION public.get_feature_flag_envelope(
  p_flag_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row public.feature_flags%ROWTYPE;
  v_meta jsonb;
BEGIN
  SELECT * INTO v_row FROM public.feature_flags WHERE flag_name = p_flag_name;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enabled', false, 'killSwitch', false, 'rolloutPct', 0);
  END IF;

  v_meta := COALESCE(v_row.metadata, '{}'::jsonb);

  -- Envelope semantics (matches voice-route contract):
  --   enabled     <- metadata.enabled if boolean, else is_enabled column
  --   killSwitch  <- metadata.kill_switch
  --   rolloutPct  <- metadata.rollout_pct, else rollout_percentage, clamped [0,100]
  RETURN jsonb_build_object(
    'enabled',
      CASE
        WHEN v_meta ? 'enabled' AND jsonb_typeof(v_meta->'enabled') = 'boolean'
          THEN (v_meta->>'enabled')::boolean
        ELSE COALESCE(v_row.is_enabled, false)
      END,
    'killSwitch',
      COALESCE((v_meta->>'kill_switch')::boolean, false),
    'rolloutPct',
      LEAST(100, GREATEST(0,
        CASE
          WHEN v_meta ? 'rollout_pct' AND jsonb_typeof(v_meta->'rollout_pct') = 'number'
            THEN (v_meta->>'rollout_pct')::numeric
          ELSE COALESCE(v_row.rollout_percentage, 0)
        END
      ))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_feature_flag_envelope(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_feature_flag_envelope(text) TO anon, authenticated;
