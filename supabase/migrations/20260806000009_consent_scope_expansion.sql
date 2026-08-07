-- Migration: Consent scope expansion (P2-6)
-- Audit remediation 2026-08-07 -- REBUILT against real schema.
--
-- Real schema fact (20260527000004_dpdp_parental_consent.sql):
--   parental_consent stores per-scope grants in consent_payload jsonb with shape
--   { scopes: { curriculum_access: true, ... }, locale: 'en' }. There are NO
--   boolean columns (curriculum_access_allowed etc.) -- adding them was a bug.
--   Column names: id, guardian_id, student_id, consent_version, granted_at,
--   revoked_at, consent_payload, ip_address, user_agent, created_at.
--   NOT NULL: guardian_id, student_id, consent_version, granted_at,
--   consent_payload, created_at.

-- 1. Consent-gating function reads the real jsonb shape
CREATE OR REPLACE FUNCTION public.is_ai_processing_consented(
  p_student_id uuid,
  p_purpose text DEFAULT 'ai_inference'
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.parental_consent
    WHERE student_id = p_student_id
      AND revoked_at IS NULL
      AND CASE p_purpose
        WHEN 'ai_inference' THEN
          COALESCE((consent_payload->'scopes'->>'ai_processing')::boolean, false)
        WHEN 'ai_training' THEN
          COALESCE((consent_payload->'scopes'->>'ai_processing')::boolean, false)
          AND COALESCE((consent_payload->>'allow_training')::boolean, false)
        WHEN 'analytics' THEN
          COALESCE((consent_payload->'scopes'->>'analytics')::boolean, false)
        WHEN 'embeddings' THEN
          COALESCE((consent_payload->'scopes'->>'embeddings')::boolean, false)
        ELSE false
      END
  );
$$;

REVOKE ALL ON FUNCTION public.is_ai_processing_consented(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_ai_processing_consented(uuid, text) TO authenticated, service_role;

-- 2. Student/guardian consent status view reads the real jsonb shape
CREATE OR REPLACE VIEW public.v_my_consent_status AS
SELECT
  pc.student_id,
  pc.consent_version,
  pc.granted_at,
  pc.revoked_at,
  COALESCE((pc.consent_payload->'scopes'->>'curriculum_access')::boolean, false) AS curriculum_access_allowed,
  COALESCE((pc.consent_payload->'scopes'->>'ai_processing')::boolean, false) AS ai_processing_allowed,
  COALESCE((pc.consent_payload->'scopes'->>'analytics')::boolean, false) AS analytics_allowed,
  COALESCE((pc.consent_payload->'scopes'->>'embeddings')::boolean, false) AS embeddings_allowed,
  CASE WHEN pc.revoked_at IS NOT NULL THEN 'revoked'
       WHEN COALESCE((pc.consent_payload->'scopes'->>'ai_processing')::boolean, false) THEN 'full'
       WHEN pc.granted_at IS NOT NULL THEN 'basic'
       ELSE 'none'
  END AS consent_tier
FROM public.parental_consent pc
WHERE pc.guardian_id IN (
  SELECT g.id FROM public.guardians g
  WHERE g.auth_user_id = auth.uid()
)
AND pc.revoked_at IS NULL;

-- 3. Index for active consent lookups (guardian+student, active only)
CREATE INDEX IF NOT EXISTS idx_parental_consent_active_student
  ON public.parental_consent (guardian_id, student_id)
  WHERE revoked_at IS NULL;
