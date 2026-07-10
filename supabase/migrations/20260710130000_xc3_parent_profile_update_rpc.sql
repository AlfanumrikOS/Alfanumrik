-- XC-3 RCA-01: scoped authenticated helper for parent own-profile updates.
-- Keeps validation in the Next route while moving the guardian-row ownership
-- boundary and mutation out of route-level service-role access.

CREATE OR REPLACE FUNCTION public.parent_update_own_profile(
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_update_name boolean DEFAULT false,
  p_update_phone boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guardian record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 401, 'error', 'Unauthorized');
  END IF;

  SELECT g.id
    INTO v_guardian
    FROM public.guardians g
   WHERE g.auth_user_id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 404, 'error', 'Guardian account not found');
  END IF;

  IF NOT coalesce(p_update_name, false) AND NOT coalesce(p_update_phone, false) THEN
    RETURN jsonb_build_object('success', true, 'data', jsonb_build_object('changed', false));
  END IF;

  UPDATE public.guardians
     SET name = CASE WHEN coalesce(p_update_name, false) THEN p_name ELSE name END,
         phone = CASE WHEN coalesce(p_update_phone, false) THEN p_phone ELSE phone END,
         updated_at = now()
   WHERE id = v_guardian.id;

  RETURN jsonb_build_object('success', true, 'data', jsonb_build_object('changed', true));
END;
$$;

REVOKE ALL ON FUNCTION public.parent_update_own_profile(text, text, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_update_own_profile(text, text, boolean, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_update_own_profile(text, text, boolean, boolean) TO authenticated;

COMMENT ON FUNCTION public.parent_update_own_profile(text, text, boolean, boolean) IS
  'XC-3 scoped authenticated helper for updating the caller-owned guardian profile.';
