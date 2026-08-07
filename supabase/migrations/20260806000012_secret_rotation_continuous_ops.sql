-- Migration: Secret rotation drift + continuous operations setup (P2-8, P3-2)
-- Audit remediation 2026-08-06: Adds secret-expiry tracking and automated
-- drift detection for credential rotation.

-- Table: Secret and key inventory
-- Fix: generated columns cannot call now() (volatile). next_rotation_due stays
-- a generated column (interval+timestamptz is immutable); is_expired is removed
-- and computed live in the function/view instead.
CREATE TABLE IF NOT EXISTS public.secret_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_name text NOT NULL UNIQUE,      -- e.g., 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY'
  secret_type text NOT NULL CHECK (secret_type IN (
    'api_key', 'database_credential', 'signing_key', 'webhook_secret', 'encryption_key'
  )),
  provider text,                          -- e.g., 'supabase', 'anthropic', 'razorpay'
  environment text NOT NULL CHECK (environment IN ('production', 'staging', 'development')),
  owner text NOT NULL,
  consumers text[],                       -- Services that use this secret
  created_at_estimate timestamptz,       -- When the secret was first provisioned
  last_rotated_at timestamptz,
  rotation_interval interval DEFAULT '90 days',
  next_rotation_due timestamptz GENERATED ALWAYS AS (
    COALESCE(last_rotated_at, created_at_estimate) + rotation_interval
  ) STORED,
  rotation_status text DEFAULT 'on_track' CHECK (rotation_status IN (
    'on_track', 'due_soon', 'overdue', 'emergency_rotation_needed'
  )),
  rotation_method text,
  post_rotation_verification text,
  emergency_rotation_contact text,
  last_verified_at timestamptz,
  notes text
);

ALTER TABLE public.secret_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access secret_inventory"
  ON public.secret_inventory FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Only super-admin can read (no authenticated user access)
-- The table contains secret NAMES, not values, but still sensitive metadata

-- Seed with known secrets (names only, never values)
INSERT INTO public.secret_inventory
  (secret_name, secret_type, provider, environment, owner, consumers, rotation_interval, rotation_method, notes)
VALUES
  ('SUPABASE_SERVICE_ROLE_KEY', 'api_key', 'supabase', 'production', 'data-platform',
   ARRAY['nextjs-api-routes', 'edge-functions', 'cron-jobs', 'admin-operations'],
   '30 days', 'Generate new JWT in Supabase dashboard; update Vercel env; verify all consumers',
   'P0: most powerful key. All consumers must be verified after rotation. Past rotation outage (2026-07) is regression scenario.'),
  ('RAZORPAY_KEY_SECRET', 'api_key', 'razorpay', 'production', 'data-platform',
   ARRAY['payment-webhook', 'subscription-management'],
   '90 days', 'Generate new key in Razorpay dashboard; update webhook secret simultaneously to avoid signature mismatch',
   'Webhook secret must rotate together with key secret to maintain signature validity'),
  ('RAZORPAY_WEBHOOK_SECRET', 'webhook_secret', 'razorpay', 'production', 'data-platform',
   ARRAY['payment-webhook'],
   '90 days', 'Update in Razorpay dashboard + Vercel env simultaneously',
   'Must be rotated atomically with RAZORPAY_KEY_SECRET'),
  ('ANTHROPIC_API_KEY', 'api_key', 'anthropic', 'production', 'data-platform',
   ARRAY['foxy-route', 'ncert-solver', 'quiz-generator', 'cme-engine', 'grounded-answer', 'agent-mesh'],
   '90 days', 'Generate in Anthropic console; update Vercel + Supabase Edge Function secrets; verify all 6+ consumers',
   'Used by both Next.js routes and Deno Edge Functions. Both environments must be updated.'),
  ('VOYAGE_API_KEY', 'api_key', 'voyage', 'production', 'data-platform',
   ARRAY['generate-embeddings', 'embed-questions', 'embed-ncert-qa', 'rag-retrieval'],
   '90 days', 'Generate in Voyage console; update Supabase Edge Function secrets',
   'Embedding model version must match; re-embedding required if model changes'),
  ('CRON_SECRET', 'signing_key', 'internal', 'production', 'data-platform',
   ARRAY['vercel-cron-jobs', 'edge-functions'],
   '30 days', 'Generate new random token; update Vercel env + Supabase Edge Function secrets',
   'Used to authenticate cron-to-edge-function calls. Must match between Vercel and Supabase.'),
  ('INTERNAL_CALLER_SIGNING_SECRET', 'signing_key', 'internal', 'production', 'data-platform',
   ARRAY['python-ai-service', 'nextjs-api-routes'],
   '30 days', 'Generate new random token; update both Vercel and Cloud Run envs',
   'Used for service-to-service auth between Next.js and Python AI service')
ON CONFLICT (secret_name) DO UPDATE SET
  consumers = EXCLUDED.consumers,
  rotation_interval = EXCLUDED.rotation_interval,
  notes = EXCLUDED.notes;

-- Function: Detect secrets due for rotation.
-- is_expired is computed live (next_rotation_due < now()); the generated column
-- was removed because generated columns cannot call now().
CREATE OR REPLACE FUNCTION public.get_secrets_due_for_rotation()
RETURNS TABLE(
  secret_name text,
  provider text,
  days_overdue integer,
  rotation_status text,
  last_rotated timestamptz,
  consumer_count integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    secret_name,
    provider,
    CASE WHEN next_rotation_due < now()
      THEN GREATEST(0, EXTRACT(DAY FROM (now() - next_rotation_due))::integer)
      ELSE 0
    END AS days_overdue,
    rotation_status,
    last_rotated_at,
    array_length(consumers, 1) AS consumer_count
  FROM public.secret_inventory
  WHERE environment = 'production'
    AND next_rotation_due < now()
  ORDER BY days_overdue DESC;
$$;

REVOKE ALL ON FUNCTION public.get_secrets_due_for_rotation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_secrets_due_for_rotation() TO service_role;

-- View: Secret health summary (is_expired computed live)
CREATE OR REPLACE VIEW public.v_secret_rotation_health AS
SELECT
  (SELECT count(*) FROM public.secret_inventory WHERE environment = 'production') AS total_secrets,
  (SELECT count(*) FROM public.secret_inventory WHERE next_rotation_due < now() AND environment = 'production') AS expired_secrets,
  (SELECT count(*) FROM public.secret_inventory WHERE rotation_status = 'overdue' AND environment = 'production') AS overdue_secrets,
  (SELECT secret_name FROM public.secret_inventory WHERE next_rotation_due < now() ORDER BY next_rotation_due ASC LIMIT 1) AS most_overdue_secret,
  (SELECT MIN(next_rotation_due) FROM public.secret_inventory WHERE environment = 'production') AS next_rotation_due;
