-- RCA-04/RCA-22/RCA-25 mobile legacy traffic telemetry.
-- Service-role writes only; clients have no direct read/write access.

CREATE TABLE IF NOT EXISTS public.api_request_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  path text NOT NULL,
  rpc text,
  client text,
  method text NOT NULL,
  request_id text,
  user_agent text,
  environment text NOT NULL DEFAULT 'production'
);

CREATE INDEX IF NOT EXISTS api_request_logs_occurred_at_idx
  ON public.api_request_logs (occurred_at DESC);

CREATE INDEX IF NOT EXISTS api_request_logs_path_occurred_at_idx
  ON public.api_request_logs (path, occurred_at DESC);

CREATE INDEX IF NOT EXISTS api_request_logs_rpc_occurred_at_idx
  ON public.api_request_logs (rpc, occurred_at DESC)
  WHERE rpc IS NOT NULL;

CREATE INDEX IF NOT EXISTS api_request_logs_client_occurred_at_idx
  ON public.api_request_logs (client, occurred_at DESC)
  WHERE client IS NOT NULL;

ALTER TABLE public.api_request_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_request_logs_no_client_access ON public.api_request_logs;
CREATE POLICY api_request_logs_no_client_access
  ON public.api_request_logs
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

GRANT ALL ON public.api_request_logs TO service_role;
