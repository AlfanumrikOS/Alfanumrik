-- Migration: Replace feature-flags/voice service_role with proper RLS (P2-12)
-- Audit remediation 2026-08-06: The voice route used service_role key via raw REST.
-- This replaces it with a SECURITY DEFINER RPC accessible to authenticated users,
-- properly gated by RLS.

-- Create an RPC that returns the full feature flag envelope including metadata,
-- but only for flags that are readable by authenticated users.
CREATE OR REPLACE FUNCTION public.get_feature_flag_envelope(
  p_flag_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_flag record;
BEGIN
  SELECT
    is_enabled,
    rollout_percentage,
    metadata,
    is_active
  INTO v_flag
  FROM public.feature_flags
  WHERE flag_name = p_flag_name
    AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'enabled', false,
      'killSwitch', false,
      'rolloutPct', 0
    );
  END IF;

  -- Build envelope matching the VoiceFlagEnvelope interface
  RETURN jsonb_build_object(
    'enabled',
      CASE
        WHEN v_flag.metadata ? 'enabled' AND v_flag.metadata->>'enabled' = 'false' THEN false
        WHEN v_flag.metadata ? 'enabled' THEN (v_flag.metadata->>'enabled')::boolean
        ELSE v_flag.is_enabled
      END,
    'killSwitch',
      COALESCE((v_flag.metadata->>'kill_switch')::boolean, false),
    'rolloutPct',
      LEAST(100, GREATEST(0,
        CASE
          WHEN v_flag.metadata ? 'rollout_pct' THEN (v_flag.metadata->>'rollout_pct')::numeric
          ELSE COALESCE(v_flag.rollout_percentage, 0)
        END
      ))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_feature_flag_envelope(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_feature_flag_envelope(text) TO anon, authenticated;
