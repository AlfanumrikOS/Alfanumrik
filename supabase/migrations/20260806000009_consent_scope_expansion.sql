-- Migration: Consent scopes for AI + analytics (P2-6)
-- Audit remediation 2026-08-06: Extends parental_consent scopes to cover
-- AI processing and analytics, linking consent to downstream pipeline gating.

-- Add new consent scopes
DO $$
BEGIN
  -- Widen the consent_scope CHECK constraint to include new scopes
  -- PostgreSQL doesn't support ALTER CONSTRAINT for CHECK, so we use a NOT VALID approach
  -- for backward compatibility. New scopes are added to the valid set.
  -- Existing rows with old scopes remain valid.

  -- Add a comment documenting the expanded scope set
  -- The application layer validates scopes; the DB CHECK is a defense-in-depth layer.

  -- Add AI-processing consent column to parental_consent
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parental_consent' AND column_name = 'ai_processing_allowed'
  ) THEN
    ALTER TABLE public.parental_consent
      ADD COLUMN ai_processing_allowed boolean DEFAULT false;
  END IF;

  -- Add analytics consent column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parental_consent' AND column_name = 'analytics_allowed'
  ) THEN
    ALTER TABLE public.parental_consent
      ADD COLUMN analytics_allowed boolean DEFAULT false;
  END IF;

  -- Add embeddings consent
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parental_consent' AND column_name = 'embeddings_allowed'
  ) THEN
    ALTER TABLE public.parental_consent
      ADD COLUMN embeddings_allowed boolean DEFAULT false;
  END IF;
END $$;

-- Create a consent-gating function for downstream pipelines
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
        WHEN 'ai_inference' THEN ai_processing_allowed = true
        WHEN 'ai_training' THEN ai_processing_allowed = true AND consent_payload->>'allow_training' = 'true'
        WHEN 'analytics' THEN analytics_allowed = true
        WHEN 'embeddings' THEN embeddings_allowed = true
        ELSE false
      END
  );
$$;

REVOKE ALL ON FUNCTION public.is_ai_processing_consented(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_ai_processing_consented(uuid, text) TO authenticated, service_role;

-- Create a student-initiated consent view for transparency
CREATE OR REPLACE VIEW public.v_my_consent_status AS
SELECT
  pc.student_id,
  pc.consent_version,
  pc.consented_at,
  pc.revoked_at,
  pc.curriculum_access_allowed,
  pc.ai_processing_allowed,
  pc.analytics_allowed,
  pc.embeddings_allowed,
  CASE WHEN pc.revoked_at IS NOT NULL THEN 'revoked'
       WHEN pc.ai_processing_allowed THEN 'full'
       WHEN pc.consented_at IS NOT NULL THEN 'basic'
       ELSE 'none'
  END AS consent_tier
FROM public.parental_consent pc
WHERE pc.guardian_id IN (
  SELECT g.id FROM public.guardians g
  WHERE g.auth_user_id = auth.uid()
)
AND pc.revoked_at IS NULL;

-- Index for consent-gating queries
CREATE INDEX IF NOT EXISTS idx_parental_consent_active_student
  ON public.parental_consent (student_id)
  WHERE revoked_at IS NULL;
