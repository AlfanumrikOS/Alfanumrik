-- Secure cron secret accessor: only service_role can call this.
-- Update the return value here if the cron secret ever rotates.
CREATE OR REPLACE FUNCTION public.get_cron_secret()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT 'alf_cron_8kP3xR7mW2vN9qT4jL6yB1dF5hS0cA'::text;
$$;
REVOKE ALL   ON FUNCTION public.get_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_cron_secret() TO service_role;
COMMENT ON FUNCTION public.get_cron_secret() IS
  'Returns expected x-cron-secret. Update body + pg_cron job if secret rotates.';
