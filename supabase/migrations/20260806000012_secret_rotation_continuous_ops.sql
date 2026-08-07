-- Migration: Secret rotation drift + continuous operations setup (P2-8, P3-2)
-- Audit remediation 2026-08-07 -- REBUILT against real schema.
--
-- Fix: generated columns must be immutable. `COALESCE(...) + interval_column`
-- is rejected by Postgres as non-immutable (SQLSTATE 42P17) because the
-- interval operand is a mutable column. next_rotation_due is therefore a plain
-- column; the due/expired dates are computed live in the functions/views.

-- Table: Secret and key inventory
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
-- next_rotation_due is computed live as
-- (COALESCE(last_rotated_at, created_at_estimate) + rotation_interval) because
-- generated columns with an interval column operand are non-immutable (42P17).
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
    CASE WHEN (COALESCE(last_rotated_at, created_at_estimate) + rotation_interval) < now()
      THEN GREATEST(0, EXTRACT(DAY FROM (now() - (COALESCE(last_rotated_at, created_at_estimate) + rotation_interval)))::integer)
      ELSE 0
    END AS days_overdue,
    rotation_status,
    last_rotated_at,
    array_length(consumers, 1) AS consumer_count
  FROM public.secret_inventory
  WHERE environment = 'production'
    AND (COALESCE(last_rotated_at, created_at_estimate) + rotation_interval) < now()
  ORDER BY days_overdue DESC;
$$;

REVOKE ALL ON FUNCTION public.get_secrets_due_for_rotation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_secrets_due_for_rotation() TO service_role;

-- View: Secret health summary (next_rotation_due computed live)
CREATE OR REPLACE VIEW public.v_secret_rotation_health AS
SELECT
  (SELECT count(*) FROM public.secret_inventory WHERE environment = 'production') AS total_secrets,
  (SELECT count(*) FROM public.secret_inventory WHERE (COALESCE(last_rotated_at, created_at_estimate) + rotation_interval) < now() AND environment = 'production') AS expired_secrets,
  (SELECT count(*) FROM public.secret_inventory WHERE rotation_status = 'overdue' AND environment = 'production') AS overdue_secrets,
  (SELECT secret_name FROM public.secret_inventory WHERE (COALESCE(last_rotated_at, created_at_estimate) + rotation_interval) < now() ORDER BY (COALESCE(last_rotated_at, created_at_estimate) + rotation_interval) ASC LIMIT 1) AS most_overdue_secret,
  (SELECT MIN(COALESCE(last_rotated_at, created_at_estimate) + rotation_interval) FROM public.secret_inventory WHERE environment = 'production') AS next_rotation_due;
